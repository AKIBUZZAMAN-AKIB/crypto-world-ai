// UX-behaviour probe: the small promises a "premium" chart makes. Each check is a
// user-visible behaviour, measured on the real shell — no fixtures.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const vp = () => p.evaluate(() => {
  const c = window.__ws.cells()[0].chart;
  const v = c.currentVisibleRange?.() ?? c.renderer.get?.('visibleRange');
  return v ? { from: v.left ?? v.from, to: v.right ?? v.to, bars: c.inspect?.().bars } : null;
});

const out = {};
out.start = await vp();

// 1. timeframe switch: is the visible TIME range kept? (premium: yes)
out.afterTf = await p.evaluate(async () => {
  const cell = window.__ws.cells()[0];
  const c = cell.chart;
  const before = c.currentVisibleRange?.();
  cell.setTimeframe('5');
  await new Promise((r) => setTimeout(r, 1600));
  const after = c.currentVisibleRange?.();
  return {
    before: before && { l: before.left, r: before.right },
    after: after && { l: after.left, r: after.right },
    leftDeltaMin: before && after ? Math.round((after.left - before.left) / 60000) : null,
  };
});

// 2. symbol switch: timeframe + zoom kept?
out.afterSymbol = await p.evaluate(async () => {
  const cell = window.__ws.cells()[0];
  const c = cell.chart;
  cell.setSymbol('ETHUSDT');
  await new Promise((r) => setTimeout(r, 1600));
  return { tf: cell.getState?.().timeframe ?? null, bars: c.inspect?.().bars ?? null };
});

// 3. crosshair long-press behaviour is documented as toggle — verify ESC/edge cases not needed here.
// 4. undo after an accidental drawing delete
out.undoDelete = await p.evaluate(async () => {
  const ws = window.__ws;
  const chart = ws.cells()[0].chart;
  const d = chart.drawings.add('hline', { anchors: [{ time: Date.now(), price: 100 }] });
  await new Promise((r) => setTimeout(r, 300));
  const before = chart.drawings.all().length;
  chart.drawings.remove(d.id);
  await new Promise((r) => setTimeout(r, 300));
  const mid = chart.drawings.all().length;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  return { before, mid, after: chart.drawings.all().length };
});

// 5. keyboard: can you reach the toolbar / open the palette without a mouse?
out.keyboard = await p.evaluate(async () => {
  const shortcuts = [];
  for (const k of ['?', '/', 'i', 'a', 'v', 'Escape']) shortcuts.push(k);
  return { helpExists: !!document.querySelector('[aria-label*="shortcut" i]') };
});

// 6. does an armed alert survive a symbol change? (a level on BTC must not watch ETH)
out.alertVsSymbol = await p.evaluate(async () => {
  const ws = window.__ws;
  ws.openAlertCreate();
  await new Promise((r) => setTimeout(r, 400));
  const input = document.querySelectorAll('.vela-ac-value input')[0];
  input.value = '999999';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.vela-ac-create').click();
  await new Promise((r) => setTimeout(r, 700));
  const cell = ws.cells()[0];
  const before = ws.getState().priceAlerts?.map((a) => ({ s: a.symbol, c: a.condition, v: a.value }));
  cell.setSymbol('SOLUSDT');
  await new Promise((r) => setTimeout(r, 1400));
  const after = ws.getState().priceAlerts?.map((a) => ({ s: a.symbol, c: a.condition, v: a.value }));
  return { before, after, lines: cell.chart.drawings.all().map((d) => d.anchors?.[0]?.price) };
});

console.log(JSON.stringify({ ...out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
