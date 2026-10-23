import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.locator('.vela-mb-indicators').tap();
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.vela-ip-row')];
  return rows.filter((r) => r.querySelector('.vela-ip-star')).slice(0, 3).map((r) => ({ key: r.dataset.key, lib: r.dataset.library, name: r.querySelector('.vela-ip-name')?.textContent, starred: r.dataset.starred }));
});
const after = await page.evaluate(() => {
  const btn = document.querySelector('.vela-ip-row:has(.vela-ip-star) .vela-ip-star');
  btn.click();
  const rows = [...document.querySelectorAll('.vela-ip-row')];
  const on = rows.filter((r) => r.dataset.starred === '1').map((r) => r.dataset.key);
  return { on, starsOnCount: document.querySelectorAll('.vela-ip-star[data-on="1"]').length };
});
console.log(JSON.stringify({ first: info, after }, null, 1));
await browser.close();
