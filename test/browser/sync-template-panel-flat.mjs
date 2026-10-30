// The real template pane must be one flat surface, not a floating card inside a panel.
// Exercise its actual store, keyboard actions, long list, themes and phone/desktop layouts.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const isTransparent = c => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

async function boot(width, height, phone = false) {
    const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    if (phone) {
        await page.locator('.vela-mb-more').tap();
        await page.getByRole('button', { name: 'Indicator templates', exact: true }).last().tap();
    } else await page.locator('.vela-widget-templates').click();
    const pane = page.locator('.vela-templates-panel'); await pane.waitFor({ state: 'visible' });
    return { context, page, pane };
}

async function visual(pane) {
    return pane.evaluate(el => {
        const style = selector => {
            const n = el.querySelector(selector); if (!n) return null;
            const s = getComputedStyle(n), r = n.getBoundingClientRect();
            return { bg: s.backgroundColor, border: s.borderTopWidth, radius: s.borderRadius, shadow: s.boxShadow,
                outline: s.outlineStyle, bottom: s.borderBottomWidth, bottomColor: s.borderBottomColor,
                display: s.display, overflow: s.overflowY, w: Math.round(r.width), h: Math.round(r.height) };
        };
        const body = el.querySelector('.vela-panel-body');
        return { root: style('.vela-tm'), tabs: style('.vela-tm-tabs'), active: style('.vela-tm-tab[data-active]'),
            toolbar: style('.vela-tm-toolbar'), glyph: style('.vela-tm-glyph'), chip: style('.vela-tm-chip'),
            input: style('.vela-tm-input'), button: style('.vela-tm-primary'), list: style('.vela-tm-list'),
            bodyWidth: [body.clientWidth, body.scrollWidth], pageWidth: [document.documentElement.clientWidth, document.documentElement.scrollWidth] };
    });
}
function assertFlat(v, label) {
    assert(v.root?.shadow === 'none' && v.root.border === '0px' && v.root.radius === '0px' && isTransparent(v.root.bg), `${label}: one unframed pane surface`, v.root);
    assert(v.tabs?.shadow === 'none' && v.tabs.radius === '0px' && isTransparent(v.tabs.bg), `${label}: a flat tab strip`, v.tabs);
    assert(v.active?.shadow === 'none' && isTransparent(v.active.bg) && parseFloat(v.active.bottom) >= 2 && v.active.bottomColor !== 'rgba(0, 0, 0, 0)', `${label}: flat, clearly marked selected tab`, v.active);
    assert(v.bodyWidth[1] <= v.bodyWidth[0] + 1 && v.pageWidth[1] <= v.pageWidth[0] + 1, `${label}: no horizontal pane or page overflow`, v);
}

try {
    {
        const { context, page, pane } = await boot(1280, 800);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(t => window.__ws.setTheme(t), theme);
            await page.waitForTimeout(100);
            const initial = await visual(pane); assertFlat(initial, `desktop ${theme}`);
            const contrast = await pane.evaluate(el => {
                const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
                const lum = vals => vals.map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
                    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
                const fg = lum(rgb(getComputedStyle(el.querySelector('.vela-tm-tab[data-active]')).color));
                const bg = lum(rgb(getComputedStyle(el).backgroundColor));
                return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
            });
            assert(contrast >= 4.5, `${theme}: selected tab text has readable contrast`, contrast);
            assert(initial.toolbar?.display === 'flex', `${theme}: library controls share a compact toolbar`, initial.toolbar);
            assert(initial.list?.overflow === 'auto', `${theme}: templates own a scrollable list`, initial.list);
            await pane.locator('.vela-tm-tab[data-tab="technical"]').click();
            const builtin = await visual(pane);
            assert(builtin.glyph?.shadow === 'none' && builtin.glyph.border === '0px' && isTransparent(builtin.glyph.bg), `${theme}: built-in icons are not raised tiles`, builtin.glyph);
            await pane.locator('.vela-tm-tab[data-tab="my"]').click();
            facts[theme] = { root: initial.root, tabs: initial.tabs, glyph: builtin.glyph };
        }
        await pane.locator('.vela-tm-save').click();
        const form = await visual(pane);
        assert(form.input?.shadow === 'none' && form.button?.shadow === 'none', 'save form is flat without inset or raised controls', form);
        await pane.locator('.vela-tm-input').fill('Discard this draft');
        await pane.locator('.vela-tm-input').press('Escape');
        if (await pane.locator('.vela-tm-input').count()) await pane.locator('.vela-tm-input').press('Escape');
        assert(await pane.isVisible() && !(await pane.locator('.vela-tm-input').count()) &&
            await pane.locator('.vela-tm-save').evaluate(el => document.activeElement === el), 'Escape cancels the save form and returns focus without closing the pane');
        await pane.locator('.vela-tm-save').click();
        await pane.locator('.vela-tm-input').fill('Review set'); await pane.locator('.vela-tm-primary').click();
        const row = pane.locator('.vela-tm-item[data-name="Review set"]'); await row.waitFor();
        const pin = row.locator('.vela-tm-fav'); await pin.focus(); await page.keyboard.press('Enter');
        assert(await row.locator('.vela-tm-fav').getAttribute('aria-pressed') === 'true' &&
            await row.locator('.vela-tm-fav').evaluate(el => document.activeElement === el), 'keyboard favorite keeps focus and does not apply the template');
        const kebab = row.locator('.vela-tm-kebab'); await kebab.focus(); await page.keyboard.press('Enter');
        const expanded = await visual(pane);
        assert(expanded.chip?.shadow === 'none' && expanded.chip.border === '0px' && isTransparent(expanded.chip.bg), 'row actions are flat, not raised chips', expanded.chip);
        assert(await row.locator('.vela-tm-kebab').evaluate(el => document.activeElement === el), 'keyboard action toggle keeps focus');
        await page.keyboard.press('Escape');
        if (await pane.locator('.vela-tm-chip').count()) await page.keyboard.press('Escape');
        assert(await pane.isVisible() && !(await pane.locator('.vela-tm-chip').count()) &&
            await row.locator('.vela-tm-kebab').evaluate(el => document.activeElement === el), 'Escape closes row actions without closing their pane');
        // Restoring keyboard focus can reopen a hoverable tip; dismiss it before switching to the pointer.
        if (await page.locator('.vela-tooltip:visible').count()) await page.keyboard.press('Escape');
        const exported = await page.evaluate(() => window.__ws.exportTemplate('Review set'));
        await pane.locator('.vela-tm-save').click();
        await pane.locator('.vela-tm-form .vela-tm-input').fill('Unfinished draft');
        await pane.locator('.vela-tm-check input').check();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pane.locator('.vela-tm-import').click()]);
        await chooser.setFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
        await pane.locator('.vela-tm-item[data-name="Review set (2)"]').waitFor();
        assert(await pane.locator('.vela-tm-flash').textContent() === 'Imported “Review set (2)”',
            'the toolbar imports a real template without overwriting an existing name');
        assert(await pane.locator('.vela-tm-form .vela-tm-input').inputValue() === 'Unfinished draft' &&
            await pane.locator('.vela-tm-check input').isChecked(), 'import does not discard an unfinished save form');
        const [badChooser] = await Promise.all([page.waitForEvent('filechooser'), pane.locator('.vela-tm-import').click()]);
        await badChooser.setFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid') });
        await pane.getByText('That file is not a Vela template').waitFor();
        assert(await row.count() === 1 && await pane.locator('.vela-tm-item[data-name="Review set (2)"]').count() === 1,
            'invalid import reports an error and leaves the saved templates intact');
        assert(await pane.locator('.vela-tm-form .vela-tm-input').inputValue() === 'Unfinished draft' &&
            await pane.locator('.vela-tm-check input').isChecked(), 'an invalid import also preserves the draft');
        await pane.locator('.vela-tm-save').click();
        await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__ws.saveTemplate(`Set ${String(i).padStart(2, '0')}`); });
        await page.locator('.vela-widget-templates').click(); await page.locator('.vela-widget-templates').click();
        const scroll = await pane.locator('.vela-tm-list').evaluate(el => {
            el.scrollTop = el.scrollHeight; return { before: el.scrollTop, height: el.clientHeight, content: el.scrollHeight };
        });
        const tabs = await pane.locator('.vela-tm-tabs').boundingBox();
        assert(scroll.before > 0 && scroll.content > scroll.height && tabs?.y >= 39, 'long template lists scroll beneath persistent tabs', { scroll, tabs });
        const lastPin = pane.locator('.vela-tm-item[data-name="Set 29"] .vela-tm-fav');
        await lastPin.focus(); await page.keyboard.press('Enter');
        const preserved = await pane.locator('.vela-tm-list').evaluate(el => el.scrollTop);
        assert(preserved > 0, 'favoriting a template preserves the list scroll position', { scroll, preserved });
        facts.scroll = { ...scroll, preserved };
        await context.close();
    }
    for (const width of [390, 240]) {
        const { context, page, pane } = await boot(width, width === 240 ? 600 : 780, true);
        const initial = await visual(pane); assertFlat(initial, `phone ${width}`);
        assert(initial.toolbar?.display === 'flex', `phone ${width}: compact toolbar exists`, initial.toolbar);
        await pane.locator('.vela-tm-save').tap();
        if (width === 240) {
            const form = await pane.evaluate(el => {
                const root = el.querySelector('.vela-tm'), check = el.querySelector('.vela-tm-check');
                return { overflow: getComputedStyle(root).overflowY, root: root.getBoundingClientRect().toJSON(), check: check.getBoundingClientRect().toJSON() };
            });
            assert(form.check.bottom <= form.root.bottom + 1 || form.overflow === 'auto',
                'a short phone pane can scroll to the entire save form', form);
            if (engine === 'chromium') {
                const touch = await context.newCDPSession(page);
                const x = form.root.right - 6, start = form.root.bottom - 10, end = form.root.top + 40;
                await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start, id: 1 }] });
                for (let i = 1; i <= 8; i++) {
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * i / 8, id: 1 }] });
                    await page.waitForTimeout(18);
                }
                await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await touch.detach(); await page.waitForTimeout(400);
                const top = await pane.locator('.vela-tm').evaluate(el => el.scrollTop);
                assert(top > 0, 'a real touch swipe scrolls the short save form', top);
            }
            const remember = pane.locator('.vela-tm-check input');
            await remember.scrollIntoViewIfNeeded(); await remember.tap();
            assert(await remember.isChecked(), 'remember-market checkbox stays reachable in a short pane');
        }
        await pane.locator('.vela-tm-input').fill(`Phone ${width}`); await pane.locator('.vela-tm-primary').tap();
        const buttons = await pane.locator('.vela-tm-item .vela-tm-ico').evaluateAll(els => els.map(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]));
        assert(buttons.length >= 3 && buttons.every(([w, h]) => w >= 39 && h >= 39), `phone ${width}: row actions have touch-sized targets`, buttons);
        const name = await pane.locator('.vela-tm-item .vela-tm-name').evaluate(el => ({
            width: el.clientWidth, height: el.clientHeight, scrollHeight: el.scrollHeight,
            glyph: getComputedStyle(el.closest('.vela-tm-item').querySelector('.vela-tm-glyph')).display,
        }));
        if (width === 240) assert(name.width >= 75 && name.glyph === 'none', 'narrow rows give the template name room without reducing touch targets', name);
        assertFlat(await visual(pane), `phone ${width} after save`);
        let horizontal = null;
        if (width === 240) {
            const strip = pane.locator('.vela-tm-tabs');
            await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
            await pane.locator('.vela-tm-tab[data-tab="financial"]').tap();
            horizontal = await strip.evaluate(el => {
                const tab = el.querySelector('[data-tab="financial"]'), a = tab.getBoundingClientRect(), b = el.getBoundingClientRect();
                return { scroll: el.scrollLeft, max: el.scrollWidth - el.clientWidth, active: tab.getAttribute('aria-selected'),
                    left: a.left - b.left, right: a.right - b.right };
            });
            assert(horizontal.scroll > 0 && horizontal.active === 'true' && horizontal.left >= -1 && horizontal.right <= 1,
                'the selected narrow-screen tab stays visible after the pane rerenders', horizontal);
        }
        facts[`phone${width}`] = { width, buttons, horizontal };
        await context.close();
    }
    {
        const context = await browser.newContext({ viewport: { width: 1080, height: 820 } });
        const page = await context.newPage();
        page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        await page.evaluate(() => {
            document.getElementById('workspace').style.cssText = 'position:absolute;left:140px;top:120px;width:240px;height:500px;overflow:hidden';
            window.__ws.saveTemplate('Morning setup');
        });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.locator('.vela-mb-more').click();
        await page.getByRole('button', { name: 'Indicator templates', exact: true }).last().click();
        const pane = page.locator('.vela-templates-panel'); await pane.waitFor({ state: 'visible' });
        const embedded = await pane.evaluate(el => {
            const item = el.querySelector('.vela-tm-item'), name = item.querySelector('.vela-tm-name'), glyph = item.querySelector('.vela-tm-glyph');
            return { pane: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON(),
                nameWidth: name.clientWidth, glyph: getComputedStyle(glyph).display,
                page: [document.documentElement.clientWidth, document.documentElement.scrollWidth] };
        });
        assert(embedded.glyph === 'none' && embedded.nameWidth >= 75 && Math.abs(embedded.pane.bottom - embedded.host.bottom) < 3 &&
            embedded.page[1] <= embedded.page[0] + 1, 'an offset embedded narrow host gets the same readable, attached pane', embedded);
        facts.embedded = embedded;
        await context.close();
    }
    assert(errors.length === 0, 'no page errors', errors);
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`template-panel-flat-${engine}`, { ...facts, errors }); await browser.close(); }
