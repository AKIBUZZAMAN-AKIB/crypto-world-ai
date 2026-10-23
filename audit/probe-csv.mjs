// Round 22 — CSV export, end to end in a real browser.
//
// Three things must be true and only a browser can say so:
//   1. the footer row exists in the layout sheet, with both scopes and the format chip;
//   2. clicking `All` actually downloads a file (Playwright captures it);
//   3. the file's bytes are the chart's bytes — header + real bar count + ISO times.
// Then the UNIX path is exercised through the same UI, and the receipt text is read.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://127.0.0.1:5190/workspace.html';
const OUT = 'audit';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ws && window.__ws.cells().length > 0, null, { timeout: 30000 });
await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 30000 });
await page.waitForTimeout(1200);

const barsInChart = await page.evaluate(() => window.__ws.cells()[0].chart.renderer.getBars().length);
console.log(`bars loaded: ${barsInChart}`);

// ── 1. open the layout sheet from the toolbar ────────────────────────────────
const layoutBtn = page.locator('button[aria-label^="Layout —"], button[aria-label="Layout"]').first();
await layoutBtn.click();
await page.waitForTimeout(500);
const footer = page.locator('.vela-lp-csv');
await footer.waitFor({ timeout: 5000 });
const caption = (await page.locator('.vela-lp-csvcap').first().textContent())?.trim();
const chips = await page.locator('.vela-lp-csvseg').allTextContents();
console.log(`footer caption: "${caption}" · chips: ${JSON.stringify(chips)}`);
await page.screenshot({ path: `${OUT}/r22-csv-sheet.png` });

// ── 2. click `All` and capture the download ─────────────────────────────────
const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.vela-lp-csvseg', { hasText: 'All' }).first().click(),
]);
const allPath = `${OUT}/r22-csv-all.csv`;
await dl.saveAs(allPath);
const allText = readFileSync(allPath, 'utf8');
const allLines = allText.trim().split('\n');
console.log(`download: ${dl.suggestedFilename()} · ${allLines.length - 1} rows`);
console.log(`header: ${allLines[0]}`);
console.log(`first:  ${allLines[1]}`);
console.log(`last:   ${allLines[allLines.length - 1]}`);

// receipt must be visible after the click
const receipt = (await page.locator('.vela-lp-csvcap').first().textContent())?.trim();
console.log(`receipt: "${receipt}"`);
await page.screenshot({ path: `${OUT}/r22-csv-receipt.png` });
await page.waitForTimeout(2800); // let the receipt revert

// ── 3. switch the time format, then export the VISIBLE window in UNIX ───────
await page.locator('.vela-lp-csvseg', { hasText: /^ISO$/ }).first().click();
const fmtAfter = (await page.locator('.vela-lp-csvseg').last().textContent())?.trim();
const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.vela-lp-csvseg', { hasText: 'Visible' }).first().click(),
]);
const visPath = `${OUT}/r22-csv-visible.csv`;
await dl2.saveAs(visPath);
const visLines = readFileSync(visPath, 'utf8').trim().split('\n');
console.log(`chip after toggle: ${fmtAfter} · ${dl2.suggestedFilename()} · ${visLines.length - 1} rows`);
console.log(`first unix cell: ${visLines[1]?.split(',')[0]}`);

// ── verdict ────────────────────────────────────────────────────────────────
const rowsMatchChart = allLines.length - 1 === barsInChart;
const isoOk = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(allLines[1].split(',')[0]);
const unixOk = /^\d{13}$/.test(visLines[1].split(',')[0]);
const visibleSubset = visLines.length - 1 <= allLines.length - 1 && visLines.length - 1 > 0;
const colsOk = allLines[1].split(',').length === 6;
const report = {
    barsInChart,
    csvRows: allLines.length - 1,
    rowsMatchChart,
    isoOk,
    unixOk,
    visibleSubset,
    colsOk,
    filename: dl.suggestedFilename(),
    errors,
};
writeFileSync(`${OUT}/r22-csv-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
