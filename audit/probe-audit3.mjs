import { chromium } from 'playwright';
const OUT = '/tmp/vela-probes';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const facts = {};

// indicator picker: favourites? recents? how tall?
await page.locator('.vela-mb-indicators').tap();
await page.waitForTimeout(700);
facts.indicator = await page.evaluate(() => {
  const dlg = document.querySelector('.vela-ip, [class*="vela-ip"]');
  const r = dlg?.getBoundingClientRect();
  return {
    open: !!dlg,
    rect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    hasStar: document.querySelectorAll('.vela-ip [aria-label*="avorite"], .vela-ip-star').length,
    hasRecent: [...document.querySelectorAll('.vela-ip-group')].map((g) => g.textContent?.trim()).slice(0, 8),
    rows: document.querySelectorAll('.vela-ip-row').length,
  };
});
await page.screenshot({ path: `${OUT}/41-indicators.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// More drawer: does it scroll internally, and how many rows are off-screen initially?
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(600);
facts.more = await page.evaluate(() => {
  const body = document.querySelector('.vela-md-body, .vela-drawer-body, .vela-md-sheet');
  return {
    bodyScroll: body ? { sh: body.scrollHeight, ch: body.clientHeight } : null,
    hasSearch: !!document.querySelector('.vela-md-search, .vela-md input[type="search"]'),
    rows: document.querySelectorAll('.vela-md-row').length,
  };
});
await ctx.close();
await browser.close();
console.log(JSON.stringify(facts, null, 1));
