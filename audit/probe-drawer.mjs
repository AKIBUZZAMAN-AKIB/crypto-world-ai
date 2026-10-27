import { chromium } from 'playwright';
const OUT = '/tmp/vela-probes';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);

await page.locator('.vela-mb-drawings').tap();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/20-drawer.png` });
const before = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.vela-dd-tab')].map((t) => t.textContent || t.getAttribute('aria-label')),
  rows: [...document.querySelectorAll('.vela-dd-row .vela-dd-label')].map((l) => l.textContent),
}));
// star two tools in different groups
for (const label of ['Trend Line']) {
  await page.evaluate((l) => {
    const row = [...document.querySelectorAll('.vela-dd-row')].find((r) => r.textContent?.includes(l));
    row?.querySelector('.vela-dd-star')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, label);
  await page.waitForTimeout(200);
}
await page.locator('.vela-dd-tab[data-fav="1"]').tap();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/21-drawer-fav.png` });
const after = await page.evaluate(() => ({
  active: document.querySelector('.vela-dd-tab[data-fav="1"]')?.getAttribute('data-active'),
  rows: [...document.querySelectorAll('.vela-dd-row .vela-dd-label')].map((l) => l.textContent),
  sections: [...document.querySelectorAll('.vela-dd-section')].map((s) => s.textContent),
}));
console.log(JSON.stringify({ before, after, errs }, null, 1));
await browser.close();
