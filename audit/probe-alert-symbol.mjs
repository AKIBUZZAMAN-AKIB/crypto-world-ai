// Does an armed alert keep watching ITS OWN symbol when the chart switches?
// TradingView: the alert is bound to the symbol it was created on. Here the evaluator
// matches on cellId only, so a BTC alert can legitimately be triggered by ETH's price.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const out = await p.evaluate(async () => {
    const ws = window.__ws;
    const cell = ws.cells()[0];
    const btcPrice = cell.chart.inspect().lastBar?.close ?? null;
    // Arm a "Greater than 1000" on BTC — true for BTC (80k), false for ETH (2.4k).
    ws.openAlertCreate();
    await new Promise((r) => setTimeout(r, 400));
    [...document.querySelectorAll('.vela-ac-opt')].find((o) => o.textContent === 'Less than')?.click();
    const input = document.querySelectorAll('.vela-ac-value input')[0];
    input.value = '50000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.vela-ac-create').click();
    await new Promise((r) => setTimeout(r, 800));
    const armed = ws.getState().priceAlerts;
    // Switch the same cell to a symbol that is BELOW the level.
    cell.setSymbol('SOLUSDT');
    await new Promise((r) => setTimeout(r, 9000));
    const afterSwitch = ws.getState().priceAlerts;
    const sym = cell.state?.symbol ?? null;
    const price = cell.chart.inspect?.().lastBar?.close ?? null;
    // Now flip back and force a tick by switching timeframe? instead read the recorded alerts log
    const log = ws.alertEntries?.() ?? [];
    return {
        btcPrice, armedSymbol: armed?.[0]?.symbol, armedState: armed?.[0]?.state,
        nowSymbol: sym, nowPrice: price,
        afterSwitch, logCount: log.length,
        lines: cell.chart.drawings.all().map((d) => ({ t: d.type, p: d.anchors?.[0]?.price })),
    };
});
console.log(JSON.stringify({ ...out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
