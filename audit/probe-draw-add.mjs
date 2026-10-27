import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const d = window.__ws.cells()[0].chart.drawings;
  d.setTool('trendline');
  d.add('trendline', { points: [{ time: 0, price: 130 }, { time: 10, price: 138 }] });
  return { n: d.all().length, canUndo: d.canUndo(), canRedo: d.canRedo() };
});
await page.waitForTimeout(400);
out.btns = await page.evaluate(() => [...document.querySelectorAll('.vela-drawpill-btn')].slice(0, 2).map((b) => ({ d: b.disabled, o: getComputedStyle(b).opacity })));
await page.screenshot({ path: '/tmp/vela-probes/40-pill-drawn.png' });
console.log(JSON.stringify(out));
await browser.close();
