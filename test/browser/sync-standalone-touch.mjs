// Verify the delivered single HTML with all network blocked. WebKit uses synthetic
// chart pointer events (not a physical iOS claim), then genuine Playwright menu taps.
import { chromium, webkit } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assert, report } from './helpers.mjs';
const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
let blocked = 0;
await context.route('**/*', route => {
    if (/^https?:/.test(route.request().url())) { blocked++; void route.abort(); }
    else void route.continue();
});
if (context.routeWebSocket) await context.routeWebSocket('wss://**', socket => { blocked++; socket.close(); });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
const send = async (type, x, y) => {
    if (engine === 'chromium') {
        await page.__touch.send('Input.dispatchTouchEvent', { type: `touch${type}`, touchPoints: type === 'End' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 42 }] });
    } else {
        await page.evaluate(({ type, x, y }) => {
            const event = type === 'Start' ? 'pointerdown' : type === 'Move' ? 'pointermove' : 'pointerup';
            if (type === 'Start') window.__standaloneTarget = document.elementFromPoint(x, y);
            window.__standaloneTarget.dispatchEvent(new PointerEvent(event, {
                bubbles: true, pointerType: 'touch', pointerId: 42, isPrimary: true,
                clientX: x, clientY: y, button: 0, buttons: type === 'End' ? 0 : 1,
            }));
        }, { type, x, y });
    }
};
const snapshot = () => page.evaluate(() => {
    const r = window.__ws.active.chart.renderer.renderer, ch = r.scene.crosshair;
    const idx = ch ? Math.round(r.coords.xToLogical(ch.x)) : -1;
    const pixels = r.cursorCanvas.getContext('2d').getImageData(0, 0, r.cursorCanvas.width, r.cursorCanvas.height).data;
    let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
    return { tracking: r.input.isTracking, ch, candle: r.bars[idx], event: window.__lastStandaloneReadout, pixels: count, view: r.coords.getViewport() };
});
try {
    await page.goto(pathToFileURL(resolve('single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 1, null, { timeout: 30000 });
    await page.evaluate(async () => {
        const bars = Array.from({ length: 100 }, (_, i) => ({ time: 1700000000000 + i * 3600000, open: 100 + i / 10,
            high: 103 + i / 10, low: 99 + i / 10, close: 102 + i / 10, volume: 1000 + i }));
        const chart = window.__ws.active.chart;
        await chart.setMarket({ data: bars });
        window.__ws.setCursorStyle('none');
        chart.renderer.onCrosshairMove(e => { window.__lastStandaloneReadout = { time: e.time, price: e.price, ohlc: e.ohlc }; });
    });
    await page.waitForFunction(() => window.__ws.active.chart.renderer.renderer.bars.length === 100); await page.waitForTimeout(800);
    await page.locator('.vela-mb-more').tap();
    const more = page.locator('.vela-more-panel:visible'); await more.waitFor();
    assert(await more.getAttribute('role') === 'region' && await more.getAttribute('aria-label') === 'More' && await more.locator('.vela-panel-grip').isVisible(), 'bundled More uses the standard phone pane');
    assert(await more.locator('.vela-md-search').count() === 0 && await more.locator('.vela-md-row', { hasText: 'Layout setup' }).count() === 1, 'bundled More keeps its actions without search');
    const cursorRow = more.locator('.vela-md-row', { hasText: 'Cursor' });
    await cursorRow.tap();
    assert(await more.isVisible() && await page.locator('.vela-cursor-menu [role="menuitemradio"]').count() === 7, 'bundled cursor is a compact child of More');
    await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'cross', 'bundled cursor supports Home and Enter');
    await cursorRow.tap(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'dot', 'bundled cursor supports arrow navigation');
    await cursorRow.tap(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'none', 'bundled cursor supports End');
    await more.locator('.vela-panel-max').tap();
    assert(await more.getAttribute('data-maximized') !== null, 'bundled More maximizes');
    await more.locator('.vela-panel-max').tap(); await more.locator('.vela-panel-close').tap(); await page.waitForTimeout(250);

    const point = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer, rect = r.dataCanvas.getBoundingClientRect();
        const pane = [...r.scene.panes.values()].find(p => p.kind === 'price');
        return { x: rect.x + r.coords.width * .55, y: rect.y + pane.bounds.top + pane.bounds.height * .55,
            axisX: rect.x + r.coords.width + (rect.width - r.coords.width) * .5, axisY: rect.y + pane.bounds.top + pane.bounds.height * .55 };
    });
    if (engine === 'chromium') page.__touch = await context.newCDPSession(page);
    await send('Start', point.x, point.y); await page.waitForTimeout(460); await send('End', point.x, point.y); await page.waitForTimeout(120);
    const held = await snapshot();
    assert(held.tracking && held.pixels > 500 && held.event?.time === held.candle?.time && held.event?.ohlc?.close === held.candle?.close,
        'bundled None cursor visibly tracks the real selected candle offline', held);
    await send('Start', point.x - 42, point.y - 22); await page.waitForTimeout(60);
    await send('Move', point.x - 22, point.y - 10); await page.waitForTimeout(100);
    const moved = await snapshot();
    assert(Math.abs(moved.ch.x - held.ch.x - 20) < 1 && Math.abs(moved.ch.y - held.ch.y - 12) < 1
        && Math.abs(moved.view.rightOffset - held.view.rightOffset) < 1e-8, 'bundled crosshair re-grab is relative and never pans', { held, moved });
    await send('End', point.x - 22, point.y - 10); await send('Start', point.x, point.y); await page.waitForTimeout(35); await send('End', point.x, point.y);
    await page.waitForTimeout(100); assert(!(await snapshot()).tracking, 'bundled tap exits tracking');

    await send('Start', point.axisX, point.axisY); await page.waitForTimeout(460); await send('End', point.axisX, point.axisY);
    const menu = page.locator('.vela-price-scale-menu:visible'); await menu.waitFor();
    const size = await menu.boundingBox();
    assert(size.width <= 241 && size.height < 500 && await page.locator('.vela-psd-list:visible').count() === 0, 'bundled price axis opens a compact menu', size);
    await menu.locator('[data-vei-id="labels"]').tap();
    const labels = page.locator('.vela-price-scale-submenu:visible'); await labels.waitFor();
    const before = await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels'));
    assert(await labels.locator('[data-vei-id="toggle:axisLabels"]').getAttribute('role') === 'menuitemcheckbox', 'bundled Labels has checkbox semantics');
    await labels.locator('[data-vei-id="toggle:axisLabels"]').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels')) === !before, 'bundled Labels updates its real chart');
    assert(errors.length === 0, 'no uncaught standalone errors', errors);
    report(`standalone-touch-${engine}`, { held: { time: held.event?.time, pixels: held.pixels }, moved: moved.ch, size, blocked, errors });
} finally {
    if (page.__touch) await page.__touch.detach();
    await context.close(); await browser.close();
}
