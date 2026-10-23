import { chromium } from 'playwright';
const OUT = '/home/user/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const facts = {};

// star hit size + nearest-neighbour spacing in the sheet
await page.locator('.vela-mb-style').tap();
await page.waitForTimeout(400);
facts.stars = await page.evaluate(() => {
  const s = [...document.querySelectorAll('.vela-cts-star')].slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  const tile = document.querySelector('.vela-cts-tile').getBoundingClientRect();
  const cell = document.querySelector('.vela-cts-cell').getBoundingClientRect();
  return { star: s[0], tile: { w: Math.round(tile.width), h: Math.round(tile.height) }, cell: { w: Math.round(cell.width) } };
});
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// drawings pill over the grid: what does it cover?
await page.evaluate(() => window.__ws.active.chart.drawings.setTool('trendline'));
await page.waitForTimeout(400);
facts.pill = await page.evaluate(() => {
  const pill = document.querySelector('.vela-drawpill');
  const r = pill?.getBoundingClientRect();
  const cells = [...document.querySelectorAll('.vela-ws-cell, [data-cell]')].map((c) => c.getBoundingClientRect()).slice(0, 4);
  const timeAxis = document.querySelectorAll('canvas');
  return {
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    coversBottomOf: cells.map((c) => Math.round(c.bottom)),
    vh: innerHeight,
  };
});
await page.screenshot({ path: `${OUT}/40-pill.png` });
await page.evaluate(() => window.__ws.active.chart.drawings.setTool(null));

// legend chips per chart (the plot's own indicators door vs the bar's)
facts.plotChrome = await page.evaluate(() => ({
  foldChips: document.querySelectorAll('.vela-ind-fold').length,
  cells: document.querySelectorAll('.vela-ws-cell').length,
}));

// double-tap reset zoom?
const before = await page.evaluate(() => window.__ws.active.chart.renderer.get?.('visibleRange') ?? null);
await page.mouse.move(150, 300);
await page.mouse.down(); await page.mouse.up();
await page.mouse.down(); await page.mouse.up();  // two clean taps
await page.waitForTimeout(400);
facts.dbltap = { before, errs: errs.slice(0, 2) };

console.log(JSON.stringify(facts, null, 1));
await browser.close();
