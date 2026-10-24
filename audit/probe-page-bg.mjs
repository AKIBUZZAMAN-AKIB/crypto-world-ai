// Acceptance probe for the page-background publish: after switching to the light theme the
// document root (the strip behind the workspace, and the overscroll rubber band) must be
// light too, not the host page's hard-coded dark.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const read = () =>
    p.evaluate(() => ({
        pageVar: getComputedStyle(document.documentElement).getPropertyValue('--vela-page-bg').trim(),
        body: getComputedStyle(document.body).backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor,
        wsBg: getComputedStyle(document.querySelector('.vela-workspace')).getPropertyValue('--vela-bg').trim(),
    }));

const dark = await read();
await p.evaluate(() => window.__ws.setTheme('light'));
await p.waitForTimeout(900);
const light = await read();
await p.evaluate(() => window.__ws.setTheme('dark'));
await p.waitForTimeout(700);
const backDark = await read();

const lum = (rgb) => {
    const m = /rgba?\(([^)]+)\)/.exec(rgb);
    if (!m) return null;
    const [r, g, bch] = m[1].split(',').map((n) => parseFloat(n));
    return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bch);
};
console.log(
    JSON.stringify(
        { dark, light, backDark, bodyLum: { dark: lum(dark.body), light: lum(light.body), backDark: lum(backDark.body) }, errors },
        null,
        1,
    ),
);
await b.close();
