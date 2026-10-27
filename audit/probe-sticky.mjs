import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);

const before = await page.evaluate(() => ({ stay: window.__ws.active.chart.drawings.getStayMode(), n: window.__ws.active.chart.drawings.all().length }));
await page.evaluate(() => window.__ws.active.chart.drawings.setTool('trendline'));
await page.waitForTimeout(250);

// two placements with the same armed tool
const draw = async (x1, y1, x2, y2) => {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};
await draw(60, 180, 160, 120);
await draw(60, 260, 160, 220);

const after = await page.evaluate(() => ({
  stay: window.__ws.active.chart.drawings.getStayMode(),
  tool: window.__ws.active.chart.drawings.getTool(),
  n: window.__ws.active.chart.drawings.all().length,
  bar: document.querySelector('.vela-mb-drawings')?.getAttribute('aria-label'),
  pillHidden: document.querySelector('.vela-drawpill')?.hidden,
}));
await page.screenshot({ path: '/tmp/vela-probes/13-sticky-draw.png' });
console.log(JSON.stringify({ before, after, errs }, null, 1));
await browser.close();
