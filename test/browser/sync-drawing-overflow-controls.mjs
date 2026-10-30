// Real selected drawings: schema controls hidden from the one-line bar still work
// through its original ellipsis, including swatches, numeric fields and text.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = [];
const inside = (r, b) => r.left >= b.left - 1 && r.top >= b.top - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1;
async function boot(width, height = 640) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    return { context, page };
}
try {
    for (const { type, width, theme } of [
        { type: 'regressionchannel', width: 320, theme: 'dark' },
        { type: 'highlighter', width: 190, theme: 'light' },
        { type: 'text', width: 190, theme: 'dark' },
    ]) {
        const { context, page } = await boot(width);
        await page.evaluate(({ type, theme }) => {
            window.__ws.setTheme(theme);
            const chart = window.__ws.active.chart, last = chart.lastBar;
            const drawing = chart.drawings.add(type, { anchors: [{ time: last.time - 3600000, price: last.close + 3 }, { time: last.time, price: last.close + 5 }], text: { value: 'Before' } });
            window.__overflowDrawing = drawing.id; chart.drawings.openSettings(drawing.id);
        }, { type, theme });
        const bar = page.locator('.vela-dpop'), more = bar.locator('[data-tip="More"]'); await more.waitFor({ state: 'visible' });
        const before = await bar.evaluate((el) => {
            const strip = el.querySelector('.vela-dpop-bar');
            return { wrap: getComputedStyle(strip).flexWrap, box: el.getBoundingClientRect().toJSON(),
                hidden: [...strip.querySelectorAll('[data-overflowed]')].map((c) => c.dataset.tip),
                dividers: strip.querySelectorAll('[data-dpop-divider]').length };
        });
        await more.tap(); const menu = page.locator('.vela-dpop-more'); await menu.waitFor({ state: 'visible' });
        const details = await menu.evaluate((el) => ({ box: el.getBoundingClientRect().toJSON(), radius: getComputedStyle(el).borderRadius,
            background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
            labels: [...el.querySelectorAll('[data-overflow]')].map((item) => item.dataset.menuLabel),
            actions: [...el.querySelectorAll('button')].map((item) => item.dataset.menuLabel),
            horizontal: { client: el.clientWidth, scroll: el.scrollWidth },
            icons: [...el.querySelectorAll('[role="menuitem"] > span:first-child')].map((node) => node.innerHTML.trim().length > 0) }));
        assert(before.wrap === 'nowrap' && before.dividers === 1 && before.hidden.length > 0 && before.hidden.every((label) => details.labels.includes(label)),
            'all hidden controls, but not the divider, appear in the existing More menu', { type, before, details });
        assert(details.radius === '0px' && details.background !== 'rgba(0, 0, 0, 0)' && inside(details.box, { left: 0, top: 0, right: width, bottom: 640 }) &&
            details.box.width <= 200 && details.horizontal.scroll <= details.horizontal.client + 1 && details.icons.every(Boolean),
            'the icon-led compact menu fits the viewport without horizontal scrolling', { type, theme, details });
        await page.keyboard.press('End');
        assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Reset settings', 'End navigates to the last menu action', type);
        await page.keyboard.press('Home');
        assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === details.actions[0], 'Home navigates to the first menu action', type);
        await page.keyboard.press('Escape');
        assert(!(await menu.isVisible()) && await more.evaluate((el) => document.activeElement === el), 'Escape closes only the menu and returns focus', type);
        await more.tap();
        if (type === 'regressionchannel') {
            await menu.getByRole('menuitem', { name: 'Upper fill', exact: true }).tap();
            const picker = page.locator('.vela-popover:has(.vela-color-picker)'); await picker.waitFor({ state: 'visible' });
            await picker.locator('button[data-c="#33adeb"]').tap();
            const color = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__overflowDrawing).props.upperFill);
            assert(color === '#33adeb26', 'overflowed swatch changes the actual fill and retains alpha', color);
        } else if (type === 'highlighter') {
            await menu.getByRole('menuitem', { name: 'Line width', exact: true }).tap();
            const field = bar.locator('input[aria-label="Line width"]'); await field.waitFor({ state: 'visible' });
            const geometry = await field.evaluate((el) => ({ field: el.getBoundingClientRect().toJSON(), bar: el.closest('.vela-dpop').getBoundingClientRect().toJSON(),
                more: el.closest('.vela-dpop').querySelector('[data-tip="More"]').getBoundingClientRect().toJSON() }));
            assert(inside(geometry.field, geometry.bar) && inside(geometry.more, geometry.bar), 'numeric field and ellipsis remain fully reachable in a tiny cell', geometry);
            await field.fill('28'); await field.press('Enter');
            const value = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__overflowDrawing).style.lineWidth);
            assert(value === 28, 'overflowed numeric field commits to the real drawing', value);
        } else {
            await menu.getByRole('menuitem', { name: 'Text', exact: true }).tap();
            const field = bar.locator('textarea'); await field.waitFor({ state: 'visible' }); await field.fill('After');
            const value = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__overflowDrawing).text.value);
            assert(value === 'After', 'overflowed text editor updates the actual drawing', value);
        }
        if (type === 'highlighter') {
            if (!(await menu.isVisible())) await more.tap();
            const settingAction = page.getByRole('menuitem', { name: 'Settings', exact: true });
            await settingAction.tap();
            const settingsPanel = page.locator('.vela-dialog.vela-dsp'); await settingsPanel.waitFor({ state: 'visible' });
            assert(before.hidden.includes('Settings') && await settingsPanel.locator('.vela-dialog-title').isVisible(),
                'the selected drawing Settings action works even when routed through the narrow More menu');
            await settingsPanel.locator('.vela-dialog-close').tap();
            await page.waitForTimeout(120);
        }
        facts.push({ type, width, theme, hidden: before.hidden, box: details.box });
        await context.close();
    }

    // Existing ellipsis verbs still operate on the chart, not a new unrelated menu.
    {
        const { context, page } = await boot(320);
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }], style: { lineColor: '#12abef' } });
            window.__sourceDrawing = drawing.id; chart.drawings.openSettings(drawing.id);
        });
        const bar = page.locator('.vela-dpop'), more = bar.locator('[data-tip="More"]');
        await more.tap(); await page.getByRole('menuitem', { name: 'Copy style', exact: true }).tap();
        await more.tap(); await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).tap();
        const copied = await page.evaluate(() => {
            const drawings = window.__ws.active.chart.drawings.all(); window.__clonedDrawing = drawings.at(-1).id;
            return drawings.map((d) => ({ id: d.id, color: d.style.lineColor }));
        });
        assert(copied.length === 2 && copied[1].color === '#12abef', 'Duplicate makes a real drawing with its style', copied);
        await page.evaluate(() => window.__ws.active.chart.drawings.openSettings(window.__clonedDrawing));
        await more.tap(); await page.getByRole('menuitem', { name: 'Reset settings', exact: true }).tap();
        const reset = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__clonedDrawing).style.lineColor);
        assert(reset !== '#12abef', 'Reset settings restores the clone default', reset);
        await more.tap(); await page.getByRole('menuitem', { name: 'Paste style', exact: true }).tap();
        const pasted = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__clonedDrawing).style.lineColor);
        assert(pasted === '#12abef', 'Paste style applies the copied real drawing style', pasted);
        await more.tap(); await page.evaluate(() => window.__ws.destroy()); await page.waitForTimeout(200);
        assert(await page.locator('.vela-dpop-more, .vela-dpop, .vela-dsp').count() === 0, 'destroy removes the toolbar and its portaled menu');
        facts.push({ actions: { copied, reset, pasted } }); await context.close();
    }
    assert(errors.length === 0, 'no uncaught page errors', errors);
    report('drawing-overflow-controls', { engine, facts, errors });
} finally { await browser.close(); }
