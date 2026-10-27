// Round 23 UI proof: the minimal layout-picker glyphs and the new pattern tools.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('audit', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/CORS|Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });

await page.goto('http://127.0.0.1:5190/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.vela-cell', { timeout: 30_000 });
await page.waitForTimeout(2500);

const out = {};

// 1. Layout picker — the preset glyph grid.
const layoutBtn = page.locator('button[aria-label*="layout" i]').first();
await layoutBtn.click({ force: true });
await page.waitForTimeout(700);
const card = page.locator('.vela-lp').first();
await card.screenshot({ path: '/tmp/vela-probes/r23-layout-icons.png' });
out.presets = await page.locator('.vela-lp-preset[data-icon="1"]').count();
out.scrollCss = await page.evaluate(() => {
    const el = document.querySelector('.vela-lp');
    return el ? getComputedStyle(el).scrollBehavior : null;
});
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 2. Drawing toolbar → the Patterns flyout (new tools).
const patternsBtn = page.locator('.vela-dtb-group, .vela-dtb button').nth(4);
await patternsBtn.click({ force: true }).catch(() => {});
await page.waitForTimeout(500);
const flyout = page.locator('.vela-dtb-flyout').first();
if (await flyout.count()) {
    await flyout.screenshot({ path: '/tmp/vela-probes/r23-pattern-tools.png' }).catch(() => {});
    out.flyoutText = (await flyout.innerText()).slice(0, 400);
}
out.errors = errors;
writeFileSync('audit/r23-ui.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
