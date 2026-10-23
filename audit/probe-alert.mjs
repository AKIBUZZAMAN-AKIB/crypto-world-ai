import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(2000);

const price = await page.evaluate(() => window.__ws.lastPriceForProbe?.() ?? null);

// More → Alerts view
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
await page.locator('.vela-md-navbtn, .vela-md-row', { hasText: 'Alerts' }).first().tap();
await page.waitForTimeout(500);
const alertsView = await page.evaluate(() => ({
  create: !!document.querySelector('.vela-md-createalert'),
  empties: [...document.querySelectorAll('.vela-md-empty')].map((e) => e.textContent),
}));
await page.locator('.vela-md-createalert').tap();
await page.waitForTimeout(600);
const sheet = await page.evaluate(() => {
  const body = [...document.querySelectorAll('.vela-ui-drawer-body, [data-scope="dialog"]')];
  const panel = document.querySelector('.vela-al'); // noop
  const opts = [...document.querySelectorAll('.vela-ac-opt')].map((b) => ({ text: b.textContent, on: b.dataset.on }));
  const input = document.querySelector('.vela-ac-value input');
  return {
    sheetOpen: !!document.querySelector('.vela-ac-create'),
    title: document.querySelector('.vela-drawer-title, [data-part="title"]')?.textContent ?? null,
    symbol: document.querySelector('.vela-ac-symbol')?.textContent ?? null,
    opts,
    value: input ? input.value : null,
    hint: document.querySelector('.vela-ac-hint')?.textContent ?? null,
    createDisabled: document.querySelector('.vela-ac-create')?.disabled,
    bodies: body.length,
  };
});
await page.screenshot({ path: 'shots/50-alert-sheet.png' });

// pick "Crossing up" + a level just below the market so it fires on the next tick
await page.locator('.vela-ac-opt', { hasText: 'Crossing up' }).tap();
await page.evaluate(() => {
  const input = document.querySelector('.vela-ac-value input');
  input.value = '1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
await page.locator('.vela-ac-create').tap();
await page.waitForTimeout(800);
const afterCreate = await page.evaluate(() => ({
  sheetGone: !document.querySelector('.vela-ac-create')?.offsetParent,
  toast: document.querySelector('.vela-toast')?.textContent ?? null,
  alerts: window.__ws.alertEntries?.().length ?? null,
}));
await page.screenshot({ path: 'shots/51-alert-created.png' });

// Back into More → Alerts: the armed level must be listed with its state
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
await page.locator('.vela-md-navbtn, .vela-md-row', { hasText: 'Alerts' }).first().tap();
await page.waitForTimeout(500);
const manager = await page.evaluate(() => ({
  create: !!document.querySelector('.vela-md-createalert'),
  armed: [...document.querySelectorAll('.vela-md-list .vela-md-row')].map((r) => r.textContent),
  armedCount: document.querySelectorAll('.vela-md-lkebab').length,
  sections: [...document.querySelectorAll('.vela-md-section')].map((e) => e.textContent),
}));
await page.screenshot({ path: 'shots/52-alert-manager.png' });
// A "Greater than" level BELOW the market is already true — it must fire at creation.
await page.locator('.vela-md-createalert').tap();
await page.waitForTimeout(600);
await page.locator('.vela-ac-opt', { hasText: 'Greater than' }).tap();
await page.evaluate(() => {
  const input = document.querySelector('.vela-ac-value input');
  input.value = '1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.locator('.vela-ac-create').tap();
await page.waitForTimeout(900);
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(500);
await page.locator('.vela-md-navbtn, .vela-md-row', { hasText: 'Alerts' }).first().tap();
await page.waitForTimeout(500);
const fired = await page.evaluate(() => {
  const lines = window.__ws.active.chart.drawings.all().map((d) => ({ type: d.type, style: d.style?.lineStyle, price: d.anchors?.[0]?.price }));
  return {
    alerts: window.__ws.alertEntries().length,
    rows: [...document.querySelectorAll('.vela-md-list .vela-md-row')].map((r) => r.textContent),
    sections: [...document.querySelectorAll('.vela-md-section')].map((e) => e.textContent),
    lines,
  };
});
await page.screenshot({ path: 'shots/53-alert-fired.png' });
console.log(JSON.stringify({ price, alertsView, sheet, afterCreate, manager, fired, errors: errors.slice(0, 4) }, null, 1));
await browser.close();
