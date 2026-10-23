import { chromium } from 'playwright';
const OUT = '/home/user/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};

async function open(vp, mobile = true) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

// ── 1. the bar at 320 / 390 / 430 ──
for (const w of [320, 390, 430]) {
  const { ctx, page } = await open({ width: w, height: 780 });
  facts[`bar${w}`] = await page.evaluate(() => {
    const bar = document.querySelector('.vela-mobilebar');
    const stops = [...bar.children].map((el) => {
      const r = el.getBoundingClientRect();
      const glyph = el.querySelector('.vela-mb-glyph');
      const gr = glyph?.getBoundingClientRect();
      return { c: el.className.replace('vela-mb-item ', '').replace('vela-mb-', ''), w: Math.round(r.width), gw: gr ? Math.round(gr.width) : null };
    });
    return { h: Math.round(bar.getBoundingClientRect().height), stops, overflow: bar.scrollWidth > bar.clientWidth };
  });
  await ctx.close();
}

// ── 2. the plot's own chrome over the canvas (legend fold chips) ──
{
  const { ctx, page } = await open({ width: 390, height: 844 });
  facts.legend = await page.evaluate(() => {
    const folds = [...document.querySelectorAll('.vela-ind-fold')].map((f) => {
      const r = f.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), label: f.getAttribute('aria-label') };
    });
    const legend = document.querySelector('[class*="legend"]');
    const lr = legend?.getBoundingClientRect();
    return { folds, legend: lr ? { w: Math.round(lr.width), h: Math.round(lr.height) } : null };
  });

  // ── 3. what the phone can reach, and in how many taps ──
  await page.locator('.vela-mb-more').tap();
  await page.waitForTimeout(500);
  facts.moreDrawer = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vela-md-row')].map((r) => r.textContent?.trim());
    const actions = [...document.querySelectorAll('.vela-md-action')].map((a) => a.textContent?.trim());
    const secs = [...document.querySelectorAll('.vela-md-section')].map((s) => s.textContent?.trim());
    const b = document.querySelector('.vela-md-drawer, .vela-drawer')?.getBoundingClientRect();
    return { rows, actions, secs, h: b ? Math.round(b.height) : null };
  });
  await page.screenshot({ path: `${OUT}/30-more.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // timeframe drawer
  await page.locator('.vela-mb-tf').tap();
  await page.waitForTimeout(500);
  facts.timeframe = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.vela-tf-chip, .vela-tfd-chip')].map((c) => c.textContent?.trim());
    const fav = [...document.querySelectorAll('[class*="fav"]')].length;
    return { chips: chips.slice(0, 20), n: chips.length, fav };
  });
  await page.screenshot({ path: `${OUT}/31-timeframe.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // symbol picker
  await page.locator('.vela-mb-symbol').tap();
  await page.waitForTimeout(600);
  facts.symbol = await page.evaluate(() => {
    const dlg = document.querySelector('.vela-sym, .vela-symbol-picker, [class*="sym-pick"], dialog, .vela-dlg');
    const rows = [...document.querySelectorAll('.vela-sym-row, [class*="sym-row"]')].map((r) => r.textContent?.trim()).slice(0, 10);
    return { present: !!dlg, rows };
  });
  await page.screenshot({ path: `${OUT}/32-symbol.png` });
  await ctx.close();
}

// ── 4. landscape: does the phone shell still work? ──
{
  const { ctx, page } = await open({ width: 844, height: 390 });
  facts.landscape = await page.evaluate(() => {
    const bar = document.querySelector('.vela-mobilebar');
    const r = bar?.getBoundingClientRect();
    return { shell: getComputedStyle(bar).display, h: r ? Math.round(r.height) : 0, vh: innerHeight };
  });
  await page.locator('.vela-mb-style').tap();
  await page.waitForTimeout(500);
  facts.landscapeSheet = await page.evaluate(() => {
    const s = document.querySelector('.vela-cts');
    const r = s?.getBoundingClientRect();
    const sc = s?.querySelector('.vela-cts-scroll');
    return { rect: r ? { y: Math.round(r.y), h: Math.round(r.height) } : null, scroll: sc ? { ch: sc.clientHeight, sh: sc.scrollHeight } : null };
  });
  await page.screenshot({ path: `${OUT}/33-landscape.png` });
  await ctx.close();
}

console.log(JSON.stringify(facts, null, 1));
await browser.close();
