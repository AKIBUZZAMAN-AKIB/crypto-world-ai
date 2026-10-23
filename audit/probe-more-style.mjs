import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Chart type'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(600);
const facts = await page.evaluate(() => {
  const sheet = document.querySelector('.vela-cts');
  const drawer = document.querySelector('.vela-md-drawer, .vela-drawer');
  return {
    sheet: !!sheet && !!sheet.getBoundingClientRect().width,
    sheetBg: sheet ? getComputedStyle(sheet).backgroundColor : null,
    drawerVisible: drawer ? drawer.getBoundingClientRect().height > 0 && getComputedStyle(drawer).visibility !== 'hidden' : null,
    tiles: sheet?.querySelectorAll('.vela-cts-cell').length ?? 0,
  };
});
await page.screenshot({ path: '/home/user/shots/22-more-charttype.png' });
console.log(JSON.stringify({ facts, errs }, null, 1));
await browser.close();
