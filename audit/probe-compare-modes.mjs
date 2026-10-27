import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(2500);

const snap = () =>
  page.evaluate(() => {
    const chart = window.__ws.active.chart;
    const info = chart.inspect();
    const mine = info.indicators.find((i) => i.nativeType === 'compare');
    const panes = chart.panes.list();
    const holder = panes.find((p) => p.indicators.some((i) => i.id === mine?.id));
    return {
      compare: mine ? { id: mine.id, pane: mine.paneId, series: mine.series } : null,
      ownScale: holder?.indicators.find((i) => i.id === mine?.id)?.ownScale ?? null,
      holderPane: holder?.id ?? null,
      scaleMode: chart.renderer.get('scaleMode'),
      paneCount: panes.length,
      axisLabels: [...document.querySelectorAll('canvas')].length,
    };
  });

// 1) open Compare sheet via the More drawer
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
await page.locator('.vela-md-action', { hasText: 'Compare' }).first().tap();
await page.waitForTimeout(700);
const sheet0 = await page.evaluate(() => ({
  title: [...document.querySelectorAll('.vela-drawer-title, [data-part="title"]')].map((e) => e.textContent).slice(-2),
  modes: [...document.querySelectorAll('.vela-cmp-mode')].map((b) => ({ id: b.dataset.display, on: b.dataset.on, name: b.querySelector('.vela-cmp-mode-name')?.textContent })),
  symbol: document.querySelector('.vela-cmp-sym-name')?.textContent,
  disabled: [...document.querySelectorAll('.vela-cmp-mode')].map((b) => b.disabled),
  removeHidden: document.querySelector('.vela-cmp-remove')?.hidden,
}));
await page.screenshot({ path: '/tmp/vela-probes/70-compare-sheet.png' });

// 2) pick a symbol
await page.locator('.vela-cmp-sym').tap();
await page.waitForTimeout(600);
await page.evaluate((own) => {
  const rows = [...document.querySelectorAll('.vela-sp-row')];
  (rows.find((r) => r.textContent && !r.textContent.includes(own)) ?? rows[0])?.click();
}, await page.evaluate(() => window.__ws.active.symbol));
await page.waitForTimeout(2000);
const afterPick = await snap();
await page.screenshot({ path: '/tmp/vela-probes/71-compare-percent.png' });

// 3) New price scale
await page.evaluate(() => document.querySelector('.vela-cmp-mode[data-display="own-scale"]').click());
await page.waitForTimeout(2000);
const ownScale = await snap();
await page.screenshot({ path: '/tmp/vela-probes/72-compare-own-scale.png' });

// 4) New pane
await page.evaluate(() => document.querySelector('.vela-cmp-mode[data-display="new-pane"]').click());
await page.waitForTimeout(2000);
const newPane = await snap();
await page.screenshot({ path: '/tmp/vela-probes/73-compare-new-pane.png' });

// 5) back to Same % scale, then remove
await page.evaluate(() => document.querySelector('.vela-cmp-mode[data-display="same-percent"]').click());
await page.waitForTimeout(1800);
const backToPercent = await snap();
await page.evaluate(() => document.querySelector('.vela-cmp-remove').click());
await page.waitForTimeout(1500);
const removed = await snap();

console.log(JSON.stringify({ sheet0, afterPick, ownScale, newPane, backToPercent, removed, errors: errors.slice(0, 4) }, null, 1));
await browser.close();
