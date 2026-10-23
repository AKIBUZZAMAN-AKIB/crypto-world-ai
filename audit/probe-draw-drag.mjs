import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__ws.cells()[0].chart.drawings.setTool('trendline'));
await page.waitForTimeout(300);
const box = await page.locator('.vela-ws-grid canvas').first().boundingBox();
const out = {};
if (box) {
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
out.state = await page.evaluate(() => {
  const d = window.__ws.cells()[0].chart.drawings;
  return { n: d.all().length, canUndo: d.canUndo(), canRedo: d.canRedo(), tool: d.getTool() };
});
out.btns = await page.evaluate(() => [...document.querySelectorAll('.vela-drawpill-btn')].slice(0, 2).map((b) => b.disabled));
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: '/home/user/shots/40-pill-drawn.png' });
await browser.close();
