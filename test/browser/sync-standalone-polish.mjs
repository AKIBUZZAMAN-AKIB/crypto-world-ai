// R115 in the actual delivered file:// HTML. Network access is blocked and synthetic
// bars feed the real chart; no generated HTML fixture or screenshots are used.
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, report } from './helpers.mjs';
const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [], facts = { menus: [] }; let blocked = 0;
await context.route('**/*', (route) => { if (/^https?:/.test(route.request().url())) { blocked++; void route.abort(); } else void route.continue(); });
if (context.routeWebSocket) await context.routeWebSocket('wss://**', (socket) => { blocked++; socket.close(); });
const page = await context.newPage();
page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
try {
    await page.goto(pathToFileURL(resolve('single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart, null, { timeout: 30000 });
    await page.evaluate(async () => {
        const bars = Array.from({ length: 100 }, (_, i) => ({ time: 1700000000000 + i * 3600000, open: 100 + i / 10, high: 102 + i / 10, low: 98 + i / 10, close: 101 + i / 10, volume: 20 }));
        await window.__ws.active.chart.setMarket({ data: bars });
    });
    await page.waitForFunction(() => window.__ws.active.chart.lastBar, null, { timeout: 30000 }); await page.waitForTimeout(500);
    await page.locator('.vela-mb-more').tap(); const more = page.locator('.vela-more-panel:visible'); await more.waitFor();
    assert(await more.locator('.vela-md-search, .vela-md-search-clear').count() === 0, 'delivered More has no search UI');
    for (const [name, selector] of [['Manage layouts', '.vela-lmp'], ['Cursor', '.vela-cursor-menu'], ['Time zone', '.vela-tzd-menu'], ['Chart actions', '.vela-chart-actions[data-state="open"]']]) {
        const row = more.locator('.vela-md-row', { hasText: name }).first(); await row.scrollIntoViewIfNeeded();
        const before = await more.evaluate((el) => ({ box: el.getBoundingClientRect().toJSON(), scroll: el.querySelector('.vela-panel-body').scrollTop }));
        await row.tap(); const child = page.locator(selector); await child.waitFor({ state: 'visible' });
        const after = await more.evaluate((el) => ({ box: el.getBoundingClientRect().toJSON(), scroll: el.querySelector('.vela-panel-body').scrollTop }));
        assert(await more.isVisible() && Math.abs(before.box.y - after.box.y) < 2 && Math.abs(before.box.height - after.box.height) < 2 && Math.abs(before.scroll - after.scroll) < 2,
            'bundled child preserves More geometry and scroll', { name, before, after });
        if (name === 'Time zone') {
            await child.getByLabel('Search time zone').fill('dhaka'); await child.locator('.vela-choice-row:visible').first().tap();
            assert(await page.evaluate(() => window.__ws.getState().timezone) === 'Asia/Dhaka' && await more.isVisible(), 'bundled timezone selects the real zone without closing More');
        } else { await page.keyboard.press('Escape'); assert(!(await child.isVisible()) && await more.isVisible(), 'bundled Escape closes only the child', name); }
        facts.menus.push(name);
    }
    await more.locator('.vela-panel-close').tap();
    await page.locator('.vela-mb-style').tap(); const types = page.locator('.vela-cts:visible'); await types.waitFor();
    const corners = await types.evaluate((el) => [getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderTopRightRadius, getComputedStyle(el).borderBottomRightRadius, getComputedStyle(el).borderBottomLeftRadius]);
    assert(corners.every((c) => c === '0px'), 'bundled chart-type surface has four square corners', corners);
    await types.locator('.vela-cts-cell[data-id="line"] .vela-cts-star').tap();
    assert(await types.locator('.vela-cts-cell[data-id="line"] .vela-cts-star').getAttribute('aria-pressed') === 'true', 'bundled chart type favorite still works');
    await types.locator('.vela-cts-tile[data-id="line"]').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('priceStyle')) === 'line', 'bundled chart type changes the real chart');
    await page.evaluate(() => window.__ws.setLayout('4')); await page.waitForTimeout(500);
    await page.evaluate(() => {
        const chart = window.__ws.active.chart, drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }] });
        window.__polishDrawing = drawing.id; chart.drawings.openSettings(drawing.id);
    });
    const bar = page.locator('.vela-dpop'), kebab = bar.locator('[data-tip="More"]'); await kebab.waitFor({ state: 'visible' });
    const drawing = await bar.evaluate((el) => ({ wrap: getComputedStyle(el.querySelector('.vela-dpop-bar')).flexWrap,
        hidden: [...el.querySelectorAll('[data-overflowed]')].map((c) => c.dataset.tip) }));
    await kebab.tap(); const actions = page.locator('.vela-dpop-more'); await actions.waitFor({ state: 'visible' });
    const labels = await actions.locator('[data-overflow]').allTextContents();
    assert(drawing.wrap === 'nowrap' && drawing.hidden.length > 0 && drawing.hidden.every((x) => labels.includes(x)), 'bundled drawing toolbar keeps one line and all overflow controls', { drawing, labels });
    await actions.getByRole('menuitem', { name: 'Line style', exact: true }).tap();
    await page.locator('.vela-dpop-item:visible', { hasText: 'Dashed' }).tap();
    assert(await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineStyle) === 'dashed', 'bundled overflow edits the real drawing');
    const gear = bar.locator('[data-tip="Settings"]');
    if (await gear.isVisible()) await gear.tap(); else { await kebab.tap(); await page.locator('.vela-dpop-more').getByRole('menuitem', { name: 'Settings', exact: true }).tap(); }
    const settings = page.locator('.vela-dialog.vela-dsp'); await settings.waitFor({ state: 'visible' });
    assert(await settings.evaluate((el) => getComputedStyle(el).borderRadius) === '0px', 'bundled drawing settings is square');
    const original = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineColor);
    await page.evaluate(() => window.__ws.active.chart.drawings.update(window.__polishDrawing, { style: { lineColor: '#12abef' } }));
    await settings.getByRole('button', { name: 'Cancel' }).tap();
    assert(await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineColor) === original, 'bundled Cancel restores the opening drawing snapshot');
    await page.evaluate(() => window.__ws.openAlertCreate()); const alert = page.locator('.vela-ap:visible'); await alert.waitFor();
    const condition = alert.getByRole('combobox', { name: 'Condition' }); await condition.tap();
    const choices = page.locator('.vela-alert-select-pop'); await choices.waitFor({ state: 'visible' });
    assert(await choices.evaluate((el) => getComputedStyle(el).borderRadius) === '0px', 'bundled alert dropdown is square and customized');
    await choices.locator('[data-value="cross-up"]').tap();
    await alert.getByLabel('Alert level').fill('120'); await alert.locator('.vela-ac-create').tap();
    const saved = await page.evaluate(() => window.__ws.getState().priceAlerts?.at(-1));
    assert(saved?.condition === 'cross-up' && saved?.value === 120, 'bundled alert creation retains its condition and value', saved);
    await alert.getByRole('tab', { name: /^Alerts/ }).tap();
    const filter = alert.getByRole('combobox', { name: 'Filter alerts by status' }); await filter.tap();
    await page.locator('.vela-alert-select-pop [data-value="paused"]').tap();
    assert(await alert.locator('.vela-ap-filter').inputValue() === 'paused', 'bundled alert status filter remains functional');
    assert(errors.length === 0, 'no uncaught page errors in delivered HTML', errors);
    report('standalone-polish', { engine, ...facts, corners, drawing, alert: saved, blocked, errors });
} finally { await browser.close(); }
