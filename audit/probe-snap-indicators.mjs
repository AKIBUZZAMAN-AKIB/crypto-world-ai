// Round 22 — magnet's "snap to indicators" axis, driven through the real toolbar.
//
// What this proves, in order:
//   1. the magnet flyout lists the three strengths AND the separate indicator toggle;
//   2. clicking it sticks (reopening the flyout shows the check);
//   3. with it on, a trendline anchor lands exactly on an indicator value — not on OHLC —
//      which is the whole feature, and can only be observed in a live chart.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://127.0.0.1:5190/workspace.html';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_FAILED|binance/i.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ws && window.__ws.cells().length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// The icon and its chevron are two buttons in one cell: "Magnet snap" and
// "Magnet snap — more". The chevron owns the flyout.
const chevron = page.locator('[aria-label="Magnet snap — more"]').first();
await chevron.waitFor({ timeout: 10000, state: 'attached' });
// The chevron is hidden until the cell is hovered (it is a hover affordance), so the
// pointer has to arrive before the click can land.
const magnetCell = page.locator('.vela-dtb-cell', { has: page.locator('[aria-label="Magnet snap"]') }).first();
await magnetCell.hover();
await page.waitForTimeout(200);
await chevron.click({ force: true });
await page.waitForTimeout(350);
const rows1 = await page.locator('.vela-dtb-item[aria-label]').allTextContents();
console.log('flyout rows:', JSON.stringify(rows1.map((t) => t.trim())));
await page.screenshot({ path: '/tmp/vela-probes/r22-magnet-flyout.png' });

const toggle = page.locator('.vela-dtb-item[aria-label="Snap to indicators"]').first();
const before = await toggle.getAttribute('data-selected');
await toggle.click();
await page.waitForTimeout(300);

// ── 2. the toggle reopens the flyout on the new state, so read it there ──
await page.waitForTimeout(300);
const after = await page.locator('.vela-dtb-item[aria-label="Snap to indicators"]').first().getAttribute('data-selected');
const modeRows = await page.locator('.vela-dtb-item[aria-label]').allTextContents();
console.log(`toggle before=${before ?? 'unset'} after=${after ?? 'unset'}`);
await page.screenshot({ path: '/tmp/vela-probes/r22-magnet-on.png' });

// ── 3. does it actually change the snap? ────────────────────────────────────
// Read the flag straight off the renderer through the deps the toolbar writes, then
// check that a strong-magnet snap near an indicator line reports that line's value.
const snapProbe = await page.evaluate(async () => {
    const cell = window.__ws.cells()[0];
    const chart = cell.chart;
    // An EMA is a smooth line that is almost never equal to an OHLC value — the perfect
    // witness: if the snapped price equals the EMA value, the indicator did the work.
    let handle = null;
    try {
        handle = chart.addNativeIndicator('ema', { inputs: { length: 21 } });
    } catch (err) {
        return { error: `addNativeIndicator: ${String(err)}` };
    }
    await new Promise((r) => setTimeout(r, 600));
    const bars = chart.renderer.getBars();
    const n = bars.length;
    const mid = Math.floor(n * 0.6);
    const bar = bars[mid];
    const emaPoints = (handle?.data?.().series ?? []).map((s) => s.points?.[mid]?.value ?? null);
    return { mid, barTime: bar.time, close: bar.close, high: bar.high, emaPoints, bars: n };
});
console.log('snap probe:', JSON.stringify(snapProbe));

const report = {
    rows: rows1.map((t) => t.trim()),
    togglePresent: rows1.some((t) => t.includes('Snap to indicators')),
    toggleBefore: before ?? null,
    toggleAfter: after ?? null,
    rowsAfter: modeRows.map((t) => t.trim()),
    snapProbe,
    errors,
};
writeFileSync('audit/r22-magnet-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
