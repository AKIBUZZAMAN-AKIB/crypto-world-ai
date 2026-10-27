import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};
for (const w of [320, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  facts[`w${w}`] = {};
  // E1 fold chip
  facts[`w${w}`].fold = await page.evaluate(() => [...document.querySelectorAll('.vela-ind-fold')].map((f) => { const r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }).slice(0, 4));
  // E2 expanded signals
  await page.locator('.vela-mb-tf').tap();
  await page.waitForTimeout(400);
  facts[`w${w}`].tfExpanded = await page.evaluate(() => document.querySelector('.vela-mb-tf')?.getAttribute('aria-expanded'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  facts[`w${w}`].tfClosed = await page.evaluate(() => ({ exp: document.querySelector('.vela-mb-tf')?.getAttribute('aria-expanded'), popup: document.querySelector('.vela-mb-tf')?.getAttribute('aria-haspopup') }));
  // E4 symbol tabs mask
  await page.locator('.vela-mb-symbol').tap();
  await page.waitForTimeout(600);
  facts[`w${w}`].symTabs = await page.evaluate(() => {
    const t = document.querySelector('.vela-sp-tabs');
    const last = t?.lastElementChild?.getBoundingClientRect();
    const box = t?.getBoundingClientRect();
    return { mask: !!getComputedStyle(t).maskImage.tail, maskImage: getComputedStyle(t).maskImage.slice(0, 40), clipped: last && box ? Math.round(last.right - box.right) : null };
  });
  await page.screenshot({ path: `/tmp/vela-probes/32-symbol-${w}.png` });
  await ctx.close();
}
console.log(JSON.stringify(facts, null, 1));
await browser.close();
