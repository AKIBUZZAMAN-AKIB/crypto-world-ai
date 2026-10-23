import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log('storage', await page.evaluate(() => JSON.stringify(localStorage.getItem('vela-favorites-v1'))));
console.log('doc', await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('vela-workspace-v1') ?? '{}').indicatorFavorites ?? null)));
await page.locator('.vela-mb-indicators').tap();
await page.waitForTimeout(700);
const firstStarRowText = await page.evaluate(() => {
  const row = document.querySelector('.vela-ip-row:has(.vela-ip-star)');
  return { name: row?.querySelector('.vela-ip-name')?.textContent, key: row?.dataset.key, kind: row?.dataset.library, inst: row?.dataset.instance };
});
console.log('firstStarRow', JSON.stringify(firstStarRowText));
await browser.close();
