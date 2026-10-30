// The four real workspace tools: keyboard doors and focus, Compare cancellation races,
// and anchored/resizable panes in a narrow offset embedded host (no synthetic UI harness).
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [];
async function boot(viewport) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.waitForTimeout(350);
    return { context, page };
}
const wait = page => page.waitForTimeout(130);
async function esc(page, pane) {
    await page.keyboard.press('Escape'); await wait(page);
    if (await pane.isVisible()) { await page.keyboard.press('Escape'); await wait(page); }
}
try {
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        const indicatorButton = page.locator('.vela-widget-indicators');
        const indicator = page.locator('.vela-indicator-panel');
        await indicatorButton.focus(); await page.keyboard.press('/');
        await indicator.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.activeElement?.matches('.vela-indicator-panel .vela-ip-search'));
        assert(await indicatorButton.getAttribute('aria-expanded') === 'true' &&
            await indicatorButton.getAttribute('aria-controls') === await indicator.getAttribute('id'), 'the / shortcut opens the named indicator region and its door is connected');
        await esc(page, indicator);
        assert(await indicatorButton.evaluate(el => document.activeElement === el) && await indicatorButton.getAttribute('aria-expanded') === 'false',
            'Escape returns focus to the indicator door and updates expanded state');

        const symbolButton = page.locator('.vela-widget-symbol');
        const search = page.locator('.vela-symbol-panel');
        await symbolButton.focus(); await page.keyboard.press('Alt+w');
        await search.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.activeElement?.matches('.vela-symbol-panel .vela-sp-input'));
        const stockFilter = search.locator('.vela-sp-tab', { hasText: 'Stocks' });
        await stockFilter.click();
        assert(await stockFilter.getAttribute('aria-pressed') === 'true' && (await search.locator('.vela-sp-empty').innerText()).includes('Try All'),
            'empty asset filters explain how to recover and expose pressed state');
        await search.locator('.vela-sp-tab', { hasText: 'All' }).click();
        await search.locator('.vela-sp-input').focus();
        await esc(page, search);
        assert(await symbolButton.evaluate(el => document.activeElement === el), 'Escape returns focus to the symbol-search door');

        // A normal chart key opens a seeded search; the original pair is not changed.
        const pairBefore = await page.evaluate(() => window.__ws.active.symbol);
        await page.locator('.vela-workspace').focus(); await page.keyboard.type('BB');
        await search.waitFor({ state: 'visible' });
        await page.waitForTimeout(100);
        assert((await search.locator('.vela-sp-input').inputValue()) === 'BB' && await page.evaluate(() => window.__ws.active.symbol) === pairBefore,
            'fast chart typing seeds Symbol Search instead of changing the pair');
        await search.locator('.vela-sp-input').focus(); await esc(page, search);

        const tplButton = page.locator('.vela-widget-templates'), templates = page.locator('.vela-templates-panel');
        await tplButton.focus(); await tplButton.press('Enter'); await templates.waitFor({ state: 'visible' });
        const activeTab = templates.locator('[role=tab][aria-selected=true]');
        await page.waitForFunction(() => document.activeElement?.matches('.vela-templates-panel [role=tab][aria-selected=true]'));
        const before = await activeTab.innerText();
        await page.keyboard.press('ArrowRight');
        const after = await templates.locator('[role=tab][aria-selected=true]').innerText();
        assert(before !== after && await templates.locator('[role=tab][aria-selected=true]').evaluate(el => document.activeElement === el),
            'template tabs support roving keyboard focus and selection', { before, after });
        await esc(page, templates);
        assert(await tplButton.evaluate(el => document.activeElement === el), 'template pane restores focus to its door');
        facts.shortcuts = { indicator: '/', search: 'Alt+W', typed: 'BB', templateTabs: [before, after] };

        // In one turn of the event loop, cancel Compare and immediately start a newer
        // normal search. The earlier cancellation microtask must not steal that search.
        await page.evaluate(() => {
            const ws = window.__ws;
            ws.openComparePicker();
            ws.symbolPicker.close();
            ws.openSymbolSearch();
        });
        await search.waitFor({ state: 'visible' }); await wait(page);
        assert(await search.getAttribute('aria-label') === 'Symbol Search' && !(await page.locator('.vela-compare-panel').isVisible()),
            'a stale Compare cancellation cannot re-open over a newer primary search');
        await search.locator('.vela-sp-input').fill('CCC');
        await search.locator('.vela-sp-pick').first().click();
        await page.waitForFunction(() => window.__ws.active.symbol.endsWith('CCC'));
        assert(await page.evaluate(() => window.__ws.active.chart.indicators().filter(h => h.nativeType === 'compare').length) === 0,
            'the newer primary search changes the pair, not the Compare series');

        // Cancellation must not reclaim the dock from an unrelated tool opened in the
        // same event loop turn, even though a Compare return was already scheduled.
        await page.evaluate(() => {
            const ws = window.__ws;
            ws.openComparePicker();
            ws.symbolPicker.close();
            ws.indicatorPicker.open();
        });
        await indicator.waitFor({ state: 'visible' }); await wait(page);
        assert(!(await page.locator('.vela-compare-panel').isVisible()), 'Compare cancellation respects a newly occupied dock');
        facts.compareRaces = { newerSearch: 'primary', newDock: 'indicators' };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 1050, height: 850 });
        // Resize/reposition the existing real host. Width 320 selects portrait-phone
        // chrome even in a desktop-sized page; it is offset from every viewport edge.
        await page.evaluate(() => {
            const host = document.getElementById('workspace');
            host.style.cssText = 'position:absolute;left:130px;top:115px;width:320px;height:500px;overflow:hidden;';
        });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        const doors = [
            ['indicators', '.vela-mb-indicators', '.vela-indicator-panel'],
            ['symbol', '.vela-mb-symbol', '.vela-symbol-panel'],
            ['templates', 'Indicator templates', '.vela-templates-panel'],
            ['compare', 'Compare', '.vela-compare-panel'],
        ];
        facts.embedded = {};
        for (const [name, door, selector] of doors) {
            if (door.startsWith('.')) await page.locator(door).click();
            else {
                await page.locator('.vela-mb-more').click();
                const entry = page.getByRole('button', { name: door, exact: true }).last();
                if (name === 'templates') { await entry.focus(); await entry.press('Enter'); }
                else await entry.click();
            }
            const pane = page.locator(selector); await pane.waitFor({ state: 'visible' }); await wait(page);
            const info = await pane.evaluate(el => {
                const p = el.getBoundingClientRect(), ws = el.parentElement.getBoundingClientRect();
                const head = el.querySelector('.vela-panel-header').getBoundingClientRect(), grip = el.querySelector('.vela-panel-grip').getBoundingClientRect();
                return { p: p.toJSON(), ws: ws.toJSON(), head: head.toJSON(), grip: grip.toJSON(),
                    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
            });
            assert(Math.abs(info.p.left - info.ws.left) < 3 && Math.abs(info.p.right - info.ws.right) < 3 &&
                Math.abs(info.p.bottom - info.ws.bottom) < 3 && info.grip.bottom <= info.head.top + 2 && info.scrollWidth <= info.clientWidth,
                `${name} is bottom attached to the offset embedded host with a separate upper grip and no page overflow`, info);
            facts.embedded[name] = { width: info.p.width, height: info.p.height, bottom: info.p.bottom, hostBottom: info.ws.bottom };
            await pane.locator('.vela-panel-close').click();
        }
        await context.close();
    }
    assert(errors.length === 0, 'no page errors', errors);
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`discovery-accessibility-${engine}`, { ...facts, errors }); await browser.close(); }
