// Is the theme applied atomically? Sample the SAME pixels at several offsets after
// setTheme('light'). A surface that flips late (or never, until something else repaints)
// is a race the user sees as "half the app changed colour".
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const px = (buf) => {
    const png = PNG.sync.read(buf);
    return (x, y, w = 8, h = 8) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
            const i = (png.width * yy + xx) << 2;
            r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n += 1;
        }
        return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / n);
    };
};
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());
const spots = await p.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x + 30), y: Math.round(b.y + Math.floor(b.height / 2)) }; };
    return { topbar: r('.vela-widget-topbar'), bottom: r('.vela-widget-bottombar'), rail: r('.vela-widget-toolbar, [class*=toolbar]') };
});
const lum = async () => {
    const img = px(await p.screenshot());
    const o = {};
    for (const [k, s] of Object.entries(spots)) if (s) o[k] = img(s.x, s.y);
    return o;
};
const before = await lum();
await p.evaluate(() => window.__ws.setTheme('light'));
const seq = [];
for (const t of [0, 50, 150, 400, 900, 1800]) {
    await p.waitForTimeout(t === 0 ? 0 : t - (seq.length ? [0, 50, 150, 400, 900][seq.length - 1] : 0));
    seq.push({ t, ...(await lum()) });
}
// and again after any interaction (a hover forces a repaint)
await p.mouse.move(400, 400);
await p.waitForTimeout(300);
const afterHover = await lum();
console.log(JSON.stringify({ spots, before, seq, afterHover }, null, 1));
await b.close();
