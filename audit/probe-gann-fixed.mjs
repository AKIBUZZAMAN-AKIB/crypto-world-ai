import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
await page.goto(process.env.URL ?? 'http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ws && window.__ws.cells().length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const cell = page.locator('.vela-cell').first();
const b = await cell.boundingBox();
await page.evaluate(() => window.__ws.cells()[0].chart.drawings.setTool('gannsquarefixed'));
await page.waitForTimeout(200);
// a deliberately NON-square drag: 300 px wide, 60 px tall
const x0 = b.x + 200, y0 = b.y + 200;
await page.mouse.click(x0, y0);
await page.waitForTimeout(150);
await page.mouse.click(x0 + 300, y0 + 60);
await page.waitForTimeout(500);
await page.evaluate(() => window.__ws.cells()[0].chart.drawings.setTool(null));
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/vela-probes/r22-gann-fixed-only.png', clip: { x: b.x, y: b.y, width: Math.min(700, b.width), height: Math.min(500, b.height) } });
const info = await page.evaluate(() => {
  const d = window.__ws.cells()[0].chart.drawings.all()[0];
  return d ? { type: d.type, anchors: d.anchors } : null;
});
console.log(JSON.stringify(info));
await browser.close();
