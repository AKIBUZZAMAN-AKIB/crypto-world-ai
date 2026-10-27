// Objective pixel sampling: screenshot regions and read the ACTUAL rendered colour.
// Eyeballing a screenshot is how a half-applied theme stays "looks fine" for months.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const px = (buf) => {
    const png = PNG.sync.read(buf);
    const at = (x, y) => {
        const i = (png.width * y + x) << 2;
        return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    // average of a small patch, robust to a single 1px border line
    const patch = (x, y, w = 6, h = 6) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
            const [R, G, B] = at(xx, yy); r += R; g += G; b += B; n += 1;
        }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };
    return { at, patch, w: png.width, h: png.height };
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

// region centres (CSS px), read from the live DOM so the probe follows the layout
const spots = await p.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) }; };
    return {
        topbar: r('.vela-widget-topbar'),
        bottombar: r('.vela-widget-bottombar'),
        rail: r('[class*=toolbar], [class*=rail]'),
        cellHeader: r('[class*=cell] [class*=head]'),
        gap: { x: 640, y: 8 },
    };
});

async function sample(label) {
    const shot = await p.screenshot();
    const img = px(shot);
    const out = {};
    for (const [k, pos] of Object.entries(spots)) {
        if (!pos) continue;
        const c = img.patch(pos.x, pos.y);
        out[k] = { hex: hex(c), lum: lum(c) };
    }
    return { label, ...out };
}

const dark = await sample('dark');
await p.evaluate(() => window.__ws.setTheme('light'));
await p.waitForTimeout(1400);
const light = await sample('light');
await p.screenshot({ path: '/tmp/vela-probes/A1-light-measured.png' });

console.log(JSON.stringify({ spots, dark, light }, null, 1));
await b.close();
