import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const facts = {};
await page.locator('.vela-mb-indicators').tap();
await page.waitForTimeout(700);
facts.all = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.vela-ip-tab')].map((t) => ({ t: t.textContent.trim(), a: t.getAttribute('aria-label'), act: t.dataset.active }));
  const rows = [...document.querySelectorAll('.vela-ip-row')];
  const groups = [...document.querySelectorAll('.vela-ip-group')].map((g) => g.textContent.trim());
  const star = rows[0]?.querySelector('.vela-ip-star');
  const sr = star?.getBoundingClientRect();
  const glyph = rows[0]?.querySelector('.vela-ip-glyph');
  return { tabs, nRows: rows.length, groups, star: sr ? { w: Math.round(sr.width), h: Math.round(sr.height) } : null, glyph: !!glyph?.querySelector('svg'), rowH: Math.round(rows[0]?.getBoundingClientRect().height ?? 0) };
});
await page.screenshot({ path: '/tmp/vela-probes/42-ind-all.png' });
// star the first row
await page.locator('.vela-ip-row .vela-ip-star').first().tap();
await page.waitForTimeout(300);
facts.starred = await page.evaluate(() => ({ on: document.querySelectorAll('.vela-ip-star[data-on="1"]').length, pressed: document.querySelector('.vela-ip-star')?.getAttribute('aria-pressed') }));
// open the favourites tab (first tab = star glyph)
await page.locator('.vela-ip-tab').first().tap();
await page.waitForTimeout(300);
facts.favTab = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.vela-ip-row .vela-ip-name')].map((n) => n.textContent), empty: document.querySelector('.vela-ip-empty')?.textContent ?? null }));
await page.screenshot({ path: '/tmp/vela-probes/43-ind-fav.png' });
// a category tab
const catTab = page.locator('.vela-ip-tab').nth(4);
await catTab.tap();
await page.waitForTimeout(250);
facts.catTab = await page.evaluate(() => ({ active: document.querySelector('.vela-ip-tab[data-active="1"]')?.textContent.trim(), n: document.querySelectorAll('.vela-ip-row').length, heads: [...document.querySelectorAll('.vela-ip-group')].map((g) => g.textContent.trim()) }));
await page.screenshot({ path: '/tmp/vela-probes/44-ind-cat.png' });
console.log(JSON.stringify(facts, null, 1));
await browser.close();
