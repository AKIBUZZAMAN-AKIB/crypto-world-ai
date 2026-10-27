import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
// open the sheet from the More drawer and capture the moving conditions
await p.locator('.vela-mb-more').tap();
await p.waitForTimeout(500);
await p.locator('.vela-md-navbtn, .vela-md-row', { hasText: 'Alerts' }).first().tap();
await p.waitForTimeout(400);
await p.locator('.vela-md-createalert').tap();
await p.waitForTimeout(600);
const sheet = await p.evaluate(() => ({
  conditions: [...document.querySelectorAll('.vela-ac-opt')].map((b) => b.textContent),
  barsHidden: document.querySelectorAll('.vela-ac-value')[1]?.hidden,
}));
await p.locator('.vela-ac-opt', { hasText: 'Moving up %' }).tap();
await p.waitForTimeout(250);
const movingSheet = await p.evaluate(() => ({
  barsHidden: document.querySelectorAll('.vela-ac-value')[1]?.hidden,
  bars: document.querySelectorAll('.vela-ac-value input')[1]?.value,
  hint: document.querySelector('.vela-ac-hint')?.textContent,
  placeholder: document.querySelectorAll('.vela-ac-value input')[0]?.placeholder,
}));
await p.screenshot({ path: '/tmp/vela-probes/90-alert-moving.png' });
// create it and check the armed row + state round-trip
await p.evaluate(() => {
  const input = document.querySelectorAll('.vela-ac-value input')[0];
  input.value = '0.01';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.locator('.vela-ac-create').tap();
await p.waitForTimeout(700);
const armed = await p.evaluate(() => ({
  state: window.__ws.getState().priceAlerts ?? null,
  rows: [...document.querySelectorAll('.vela-md-list .vela-md-row')].map((r) => r.textContent),
}));
console.log(JSON.stringify({ sheet, movingSheet, armed, errors: errors.slice(0, 3) }, null, 1));
await b.close();
