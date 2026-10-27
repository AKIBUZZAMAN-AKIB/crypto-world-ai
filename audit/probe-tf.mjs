import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const facts = {};
await page.locator('.vela-mb-tf').tap();
await page.waitForTimeout(500);
facts.before = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.vela-tfd-heading')].map((h) => h.textContent);
  const ranges = [...document.querySelectorAll('.vela-tfd-chip[data-kind="range"]')].map((c) => ({ t: c.textContent.trim(), a: c.getAttribute('aria-label'), h: Math.round(c.getBoundingClientRect().height), r: getComputedStyle(c).borderRadius }));
  const stars = [...document.querySelectorAll('.vela-tfd-star')].map((s) => ({ w: Math.round(s.getBoundingClientRect().width), h: Math.round(s.getBoundingClientRect().height), on: s.dataset.on, c: getComputedStyle(s).color }));
  const chips = [...document.querySelectorAll('.vela-tfd-favs .vela-tfd-chip')].length;
  const all = [...document.querySelectorAll('.vela-tfd-grid .vela-tfd-chip')].map((c) => c.textContent.trim());
  return { heads, ranges: ranges.slice(0, 3), nRanges: ranges.length, stars: stars.slice(0, 3), nStars: stars.length, favChips: chips, timeframes: all.slice(0, 8), nTf: all.length };
});
await page.screenshot({ path: '/tmp/vela-probes/31-timeframe.png' });
// star "1D" interval
await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.vela-tfd-grid .vela-tfd-chip')];
  const one = chips.find((c) => c.textContent.trim() === '1D');
  one.querySelector('.vela-tfd-star').click();
});
await page.waitForTimeout(400);
facts.after = await page.evaluate(() => ({
  favHidden: document.querySelector('.vela-tfd-favs')?.hidden,
  favChips: [...document.querySelectorAll('.vela-tfd-favs .vela-tfd-chip')].map((c) => c.textContent.trim()),
  starsOn: [...document.querySelectorAll('.vela-tfd-star[data-on="1"]')].map((s) => s.getAttribute('aria-label')),
  persisted: window.__ws.state?.().timeframeFavorites ?? null,
}));
await page.screenshot({ path: '/tmp/vela-probes/31-timeframe-fav.png' });
console.log(JSON.stringify(facts, null, 1));
await browser.close();
