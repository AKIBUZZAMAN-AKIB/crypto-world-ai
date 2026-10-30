// Real phone touch stream: non-Cross cursor modes must visibly enter inspection, retain
// their saved preferences, and re-grab relative to the already painted location.
import { OFFLINE, open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ base: OFFLINE, viewport: { width: 390, height: 780 }, mobile: true, settle: 1000 });
const client = await page.context().newCDPSession(page);
const point = (x, y) => ({ x: Math.round(x), y: Math.round(y), id: 1 });
const touch = (type, points = []) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const down = (p) => touch('touchStart', [p]);
const move = (p) => touch('touchMove', [p]);
const up = () => touch('touchEnd');
const wait = (ms = 120) => page.waitForTimeout(ms);
const snapshot = () => page.evaluate(() => {
    const r = window.__ws.active.chart.renderer.renderer;
    const rect = r.dataCanvas.getBoundingClientRect();
    const ch = r.scene.crosshair;
    const { width, height, dpr } = r.coords;
    const data = r.cursorCanvas.getContext('2d').getImageData(0, 0, r.cursorCanvas.width, r.cursorCanvas.height).data;
    let pixels = 0, max = 0, ink = null;
    for (let y = 0; y < height * dpr; y++) for (let x = 0; x < width * dpr; x++) {
        const i = (y * r.cursorCanvas.width + x) * 4;
        if (data[i + 3]) pixels++;
        if (data[i + 3] > max) { max = data[i + 3]; ink = [data[i], data[i + 1], data[i + 2]]; }
    }
    return { tracking: r.input.isTracking, ch, width, height, x: rect.x, y: rect.y, pixels, max, ink,
        cursor: r.scene.cursorStyle, view: r.coords.getViewport(), config: r.getConfig().crosshair };
});
try {
    await page.evaluate(() => window.__ws.setLayout('1'));
    await page.waitForFunction(() => window.__ws.active.chart.renderer.renderer.bars.length > 0);
    for (const theme of ['dark', 'light']) for (const cursor of ['cross', 'dot', 'arrow', 'none']) {
        await page.evaluate(({ theme, cursor }) => {
            window.__ws.setTheme(theme);
            window.__ws.active.chart.renderer.set('cursorStyle', cursor);
        }, { theme, cursor });
        await wait(250);
        const before = await snapshot();
        const p = point(before.x + before.width * 0.38, before.y + before.height * 0.55);
        await down(p); await wait(460); await up(); await wait();
        const held = await snapshot();
        assert(held.tracking && held.pixels > 800 && held.ch, 'touch paints crosshair for each selected cursor', { theme, cursor, held });
        assert(held.cursor === cursor && JSON.stringify(held.config) === JSON.stringify(before.config), 'tracking does not rewrite cursor or config', { theme, cursor });
        assert(held.max >= 165 && held.ink && held.ink[0] === (theme === 'dark' ? 255 : 0), 'default tracking ink has strong theme contrast', { theme, cursor, ink: held.ink, alpha: held.max });
        const recontact = point(before.x + before.width * 0.20, before.y + before.height * 0.34);
        await down(recontact); await wait(100);
        const grabbed = await snapshot();
        assert(grabbed.ch && Math.abs(grabbed.ch.x - held.ch.x) < 1 && Math.abs(grabbed.ch.y - held.ch.y) < 1, 're-contact does not jump', { theme, cursor, held: held.ch, grabbed: grabbed.ch });
        await move(point(recontact.x + 36, recontact.y + 25)); await wait();
        const moved = await snapshot();
        assert(moved.ch && Math.abs(moved.ch.x - held.ch.x - 36) < 1 && Math.abs(moved.ch.y - held.ch.y - 25) < 1, 're-contact drag moves by finger delta', { theme, cursor, held: held.ch, moved: moved.ch });
        assert(Math.abs(moved.view.rightOffset - held.view.rightOffset) < 1e-8, 'inspection never pans', { theme, cursor });
        await up(); await wait();
        await down(recontact); await wait(35); await up(); await wait();
        const gone = await snapshot();
        assert(!gone.tracking && !gone.ch && gone.pixels === 0, 'single tap exits cleanly', { theme, cursor, gone });
    }
    // Explicit customization remains exactly the configured color and opacity; the
    // stronger adaptive ink applies only to the legacy unmodified default.
    const original = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        const before = r.getConfig().crosshair;
        r.applyConfig({ crosshair: { color: '#ff5500', opacity: 0.8, style: 'solid' } });
        window.__ws.setTheme('dark'); window.__ws.active.chart.renderer.set('cursorStyle', 'arrow');
        return before;
    });
    await wait(200);
    const customBefore = await snapshot(), customPoint = point(customBefore.x + customBefore.width * 0.4, customBefore.y + customBefore.height * 0.55);
    await down(customPoint); await wait(460); await up(); await wait();
    const custom = await snapshot();
    assert(custom.tracking && custom.ink?.join(',') === '255,85,0' && custom.max >= 200 && custom.max <= 205, 'explicit line color and opacity are honored during tracking', custom);
    await down(customPoint); await wait(35); await up(); await wait();
    await page.evaluate((before) => window.__ws.active.chart.renderer.renderer.applyConfig({ crosshair: before }), original);
    assert(errors.length === 0, 'no page errors', errors);
    report('touch-regrab', { themes: 2, cursors: 4, custom: { ink: custom.ink, alpha: custom.max }, errors });
} finally { await browser.close(); }
