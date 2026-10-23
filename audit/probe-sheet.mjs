import { chromium } from 'playwright';
const OUT = '/home/user/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.evaluate(() => localStorage.removeItem('vela-favorites-v1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);

await page.locator('.vela-mb-style').tap();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-sheet-plain.png` });

// star three styles
for (const id of ['candles', 'line', 'renko']) {
  await page.locator(`.vela-cts-cell[data-id="${id}"] .vela-cts-star`).tap();
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `${OUT}/11-sheet-starred.png` });
const facts = await page.evaluate(() => {
  const el = document.querySelector('.vela-cts');
  const r = el?.getBoundingClientRect();
  return {
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    bg: el ? getComputedStyle(el).backgroundColor : null,
    starColor: el ? getComputedStyle(el.querySelector('.vela-cts-star[aria-pressed="true"]')).color : null,
    favCells: [...el.querySelectorAll('[data-sec="fav"] .vela-cts-cell')].map((c) => c.dataset.id),
    allCells: [...el.querySelectorAll('[data-sec="all"] .vela-cts-cell')].map((c) => c.dataset.id),
    scrollH: el?.querySelector('.vela-cts-scroll')?.scrollHeight,
    clientH: el?.querySelector('.vela-cts-scroll')?.clientHeight,
  };
});
await page.locator('.vela-cts-only').tap();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/12-sheet-only-fav.png` });
const only = await page.evaluate(() => ({
  pressed: document.querySelector('.vela-cts-only')?.getAttribute('aria-pressed'),
  visible: [...document.querySelectorAll('.vela-cts-cell')].filter((c) => !c.hidden).map((c) => c.dataset.id),
  kicker: document.querySelector('.vela-cts-kicker')?.textContent,
}));
console.log(JSON.stringify({ facts, only, errs }, null, 1));
await browser.close();
