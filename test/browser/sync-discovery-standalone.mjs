// Build and exercise the actual delivered one-file workspace with all network blocked.
// The chart can be empty without a live provider; the UI must still be fully usable.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { assert, report } from './helpers.mjs';
const root = resolve('.');
execFileSync(process.execPath, ['tools/build-single-file.mjs'], { cwd: root, stdio: 'inherit' });
const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
let blocked = 0;
async function boot(viewport, phone = false) {
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.route('**/*', route => {
        if (/^https?:/.test(route.request().url())) { blocked++; void route.abort(); }
        else void route.continue();
    });
    if (context.routeWebSocket) await context.routeWebSocket('wss://**', ws => { blocked++; ws.close(); });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(e.stack ?? String(e)); });
    await page.goto(pathToFileURL(resolve(root, 'single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    return { context, page };
}
async function shape(pane) {
    return pane.evaluate(el => {
        const r = el.getBoundingClientRect(), h = el.parentElement.getBoundingClientRect();
        return { standard: el.dataset.standardPane, floating: el.dataset.freeFloating ?? null, width: r.width, bottom: r.bottom,
            hostWidth: h.width, hostBottom: h.bottom, radius: getComputedStyle(el).borderRadius,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
}
try {
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        await page.locator('.vela-widget-indicators').click();
        const indicators = page.locator('.vela-indicator-panel'); await indicators.waitFor({ state: 'visible' });
        const desktop = await shape(indicators);
        assert(desktop.standard === '1' && desktop.floating === null && desktop.radius === '0px', 'standalone opens Indicators as a square dock', desktop);
        await indicators.locator('.vela-ip-search').fill('Moving Average');
        await indicators.locator('.vela-ip-row[data-library] .vela-ip-pick').first().click();
        await indicators.locator('.vela-panel-dock-toggle').click();
        await indicators.locator('.vela-ip-templates-door').click();
        const templates = page.locator('.vela-templates-panel'); await templates.waitFor({ state: 'visible' });
        const flat = await templates.evaluate(el => {
            const root = getComputedStyle(el.querySelector('.vela-tm'));
            const tabs = getComputedStyle(el.querySelector('.vela-tm-tabs'));
            const active = getComputedStyle(el.querySelector('.vela-tm-tab[data-active]'));
            return { background: root.backgroundColor, border: root.borderTopWidth, radius: root.borderRadius,
                shadow: root.boxShadow, tabs: tabs.backgroundColor, selectedUnderline: active.borderBottomWidth };
        });
        assert(flat.background === 'rgba(0, 0, 0, 0)' && flat.border === '0px' && flat.radius === '0px' &&
            flat.shadow === 'none' && flat.tabs === 'rgba(0, 0, 0, 0)' && parseFloat(flat.selectedUnderline) >= 2,
            'the delivered offline template pane has the new flat interior', flat);
        assert(await indicators.isVisible() && await templates.locator('[role="tab"]').count() === 4,
            'standalone keeps Indicators floating beside the separate templates pane');
        const exported = await page.evaluate(() => {
            window.__ws.saveTemplate('Standalone source');
            return window.__ws.exportTemplate('Standalone source');
        });
        await templates.locator('.vela-tm-save').click(); await templates.locator('.vela-tm-input').fill('Offline setup');
        await templates.locator('.vela-tm-check input').check();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), templates.locator('.vela-tm-import').click()]);
        await chooser.setFiles({ name: 'standalone.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
        await templates.locator('.vela-tm-item[data-name="Standalone source (2)"]').waitFor();
        assert(await templates.locator('.vela-tm-input').inputValue() === 'Offline setup' &&
            await templates.locator('.vela-tm-check input').isChecked(), 'standalone import preserves an unfinished save form');
        await templates.locator('.vela-tm-primary').click();
        await templates.locator('.vela-tm-item[data-name="Offline setup"]').waitFor();
        assert(await page.evaluate(() => window.__ws.templateList().some(t => t.name === 'Offline setup')),
            'standalone can save an indicator template without network');
        await indicators.locator('.vela-panel-close').click();

        await page.evaluate(() => window.__ws.setCompareSymbol('TEST:AAA'));
        await page.locator('.vela-widget-compare').click();
        const compare = page.locator('.vela-compare-panel'); await compare.waitFor({ state: 'visible' });
        await compare.locator('[data-display="own-scale"]').click();
        assert(await compare.locator('[data-display="own-scale"]').getAttribute('aria-pressed') === 'true',
            'standalone retains real Compare display controls');
        await page.evaluate(() => window.__ws.destroy());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 30_000 });
        await compare.waitFor({ state: 'visible' });
        assert(await compare.locator('.vela-cmp-sym-name').textContent() === 'TEST:AAA' &&
            await compare.locator('[data-display="own-scale"]').getAttribute('aria-pressed') === 'true' &&
            await page.evaluate(() => window.__ws.templateList().some(t => t.name === 'Offline setup')),
            'standalone reload restores Compare and saved templates with the network blocked');
        await page.locator('.vela-widget-symbol').click();
        const search = page.locator('.vela-symbol-panel'); await search.waitFor({ state: 'visible' });
        assert(await search.locator('.vela-sp-input').count() === 1 && await search.locator('.vela-sp-tab').count() >= 5,
            'standalone shows search and filters even when the network is blocked');
        facts.desktop = { dock: desktop, templateSaved: true, compareMode: 'own-scale', restoredOffline: true };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        facts.phone = {};
        for (const [name, selector, entry] of [
            ['indicators', '.vela-indicator-panel', '.vela-mb-indicators'],
            ['symbol', '.vela-symbol-panel', '.vela-mb-symbol'],
            ['templates', '.vela-templates-panel', 'Indicator templates'],
            ['compare', '.vela-compare-panel', 'Compare'],
        ]) {
            if (entry.startsWith('.')) await page.locator(entry).click();
            else { await page.locator('.vela-mb-more').click(); await page.getByRole('button', { name: entry, exact: true }).last().click(); }
            const pane = page.locator(selector); await pane.waitFor({ state: 'visible' });
            const info = await shape(pane);
            assert(info.standard === '1' && Math.abs(info.width - info.hostWidth) < 3 && Math.abs(info.bottom - info.hostBottom) < 3 &&
                info.radius === '0px' && info.pageOverflow <= 1 && await pane.locator(':scope > .vela-panel-grip').count() === 1 &&
                await pane.locator('.vela-panel-max').isVisible(), `${name} is a standalone bottom-attached phone pane`, info);
            facts.phone[name] = info;
            await pane.locator('.vela-panel-close').click();
        }
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 240, height: 600 }, true);
        await page.locator('.vela-mb-more').tap();
        await page.getByRole('button', { name: 'Indicator templates', exact: true }).last().tap();
        const pane = page.locator('.vela-templates-panel');
        await pane.locator('.vela-tm-save').tap();
        const form = await pane.evaluate(el => {
            const root = el.querySelector('.vela-tm'), check = el.querySelector('.vela-tm-check');
            return { overflow: getComputedStyle(root).overflowY, available: root.getBoundingClientRect().bottom,
                checkBottom: check.getBoundingClientRect().bottom };
        });
        assert(form.checkBottom <= form.available + 1 || form.overflow === 'auto',
            'standalone short phone pane can scroll to the complete save form', form);
        const remember = pane.locator('.vela-tm-check input');
        await remember.scrollIntoViewIfNeeded(); await remember.tap();
        assert(await remember.isChecked(), 'standalone remembers its accessible checkbox state');
        facts.shortPhoneForm = form;
        await context.close();
    }
    assert(errors.length === 0, 'no standalone page errors', errors);
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`discovery-standalone-${engine}`, { ...facts, blocked, errors }); await browser.close(); }
