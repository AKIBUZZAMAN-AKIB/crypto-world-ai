import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.locator('.vela-mb-indicators').tap();
await page.waitForTimeout(700);
// one deterministic click
const n1 = await page.evaluate(() => {
  const btn = document.querySelector('.vela-ip-row:has(.vela-ip-star) .vela-ip-star');
  btn.click();
  return document.querySelectorAll('.vela-ip-star[data-on="1"]').length;
});
await page.waitForTimeout(200);
const favs = await page.evaluate(() => {
  document.querySelector('.vela-ip-tab').click();
  return [...document.querySelectorAll('.vela-ip-row .vela-ip-name')].map((n) => n.textContent);
});
console.log(JSON.stringify({ starsOn: n1, favs }));
await browser.close();
