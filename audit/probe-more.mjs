import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const facts = {};
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
facts.before = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.vela-md-row')].map((r) => r.textContent.trim());
  const input = document.querySelector('.vela-md-search input');
  return { nRows: rows.length, rows: rows.slice(0, 6), hasSearch: !!input, placeholder: input?.placeholder };
});
facts.inert = await page.evaluate(() => ({
  gridInert: document.querySelector('.vela-ws-grid')?.closest('[inert]') !== null,
  barInert: document.querySelector('.vela-mobilebar')?.closest('[inert]') !== null,
  sheetInert: document.querySelector('.vela-drawer-positioner')?.hasAttribute('inert'),
}));
await page.screenshot({ path: '/home/user/shots/30-more.png' });
await page.locator('.vela-md-search input').fill('alert');
await page.waitForTimeout(300);
facts.filtered = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.vela-md-row:not([hidden])')].map((r) => r.textContent.trim()),
  heads: [...document.querySelectorAll('.vela-md-section:not([hidden]), .vela-md-charthead:not([hidden])')].map((h) => h.textContent.trim()),
  nomatch: document.querySelector('.vela-md-nomatch')?.textContent ?? null,
}));
await page.screenshot({ path: '/home/user/shots/30-more-search.png' });
await page.locator('.vela-md-search input').fill('zzz');
await page.waitForTimeout(250);
facts.none = await page.evaluate(() => ({ nomatch: document.querySelector('.vela-md-nomatch')?.textContent ?? null, visibleRows: document.querySelectorAll('.vela-md-row:not([hidden])').length }));
// close and confirm inert lifts
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
facts.after = await page.evaluate(() => ({ anyInert: document.querySelectorAll('[inert]').length, gridInert: document.querySelector('.vela-ws-grid')?.closest('[inert]') !== null }));
console.log(JSON.stringify(facts, null, 1));
await browser.close();
