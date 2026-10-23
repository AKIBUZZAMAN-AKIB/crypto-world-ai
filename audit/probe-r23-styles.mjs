// Round 23 — the five re-bucketing styles, live: switch the style from the topbar dropdown,
// wait for a repaint, and record an ink signature + a crop per style.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'audit';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:5190/', { waitUntil: 'networkidle' });
await page.waitForSelector('.vela-cell', { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.mouse.move(430, 330);
await page.mouse.click(430, 330); // activate the first cell, dismiss any tooltip
await page.waitForTimeout(600);

const report = {};
const styles = ['Renko', 'Range', 'Kagi', 'Point & figure', 'Line break'];

for (const label of styles) {
    // The style trigger is the topbar button whose aria-label names the current style.
    const trigger = page.locator('button[aria-label^="Chart style"]').first();
    await trigger.click({ force: true });
    await page.waitForTimeout(300);
    const item = page.getByRole('menuitem', { name: label, exact: true }).first();
    const hasItem = await item.count();
    if (!hasItem) {
        report[label] = { error: 'no menu item' };
        await page.keyboard.press('Escape');
        continue;
    }
    await item.click({ force: true });
    await page.mouse.move(430, 330); // off the toolbar: kills the sync tooltip
    await page.waitForTimeout(2000);
    const file = `${OUT}/r23-style-${label.toLowerCase().replace(/[^a-z]+/g, '-')}.png`;
    const cell = page.locator('.vela-cell').first();
    await cell.screenshot({ path: file });
    // ink signature: count of non-background pixels + their mean colour
    const sig = await page.evaluate(() => {
        const c = document.querySelector('.vela-cell canvas');
        if (!c) return null;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0, r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] + d[i + 1] + d[i + 2] > 120) { n += 1; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        }
        return { ink: n, mean: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null, w: c.width, h: c.height };
    });
    report[label] = { file, sig };
}

// Restore candles so the preview is left in its normal state.
await page.keyboard.press('Escape').catch(() => {});
writeFileSync(`${OUT}/r23-styles.json`, JSON.stringify({ report, errors }, null, 2));
console.log(JSON.stringify({ report, errors }, null, 2));
await browser.close();
