import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(2500);

const symbol = await page.evaluate(() => window.__ws.active.symbol);
// More drawer → Compare → symbol search
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
const hasCompare = await page.evaluate(() => [...document.querySelectorAll('.vela-md-action')].map((b) => b.textContent));
await page.locator('.vela-md-action', { hasText: 'Compare' }).first().tap();
await page.waitForTimeout(700);
const picker = await page.evaluate(() => ({
  title: document.querySelector('[data-part="title"], .vela-dialog-title')?.textContent ?? null,
  rows: [...document.querySelectorAll('.vela-sp-row')].slice(0, 4).map((r) => r.textContent?.trim().slice(0, 24)),
}));
await page.screenshot({ path: 'shots/61-compare-picker.png' });
// pick the first row that is not the chart's own symbol
await page.evaluate((own) => {
  const rows = [...document.querySelectorAll('.vela-sp-row')];
  const target = rows.find((r) => r.textContent && !r.textContent.includes(own)) ?? rows[0];
  target?.click();
}, symbol);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const info = window.__ws.active.chart.inspect();
  const mine = info.indicators.find((i) => i.nativeType === 'compare');
  return {
    compare: mine ? { id: mine.id, pane: mine.paneId, series: mine.series } : null,
    panes: info.totals.panes,
    toast: document.querySelector('.vela-toast')?.textContent ?? null,
  };
});
await page.screenshot({ path: 'shots/62-compare-pane.png' });
console.log(JSON.stringify({ symbol, hasCompare, picker, after, errors: errors.slice(0, 4) }, null, 1));
await browser.close();
