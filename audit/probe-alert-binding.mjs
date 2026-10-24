// Acceptance probe for the symbol-binding fix:
//   1. arm "Less than 50000" on BTC (true only for BTC)
//   2. switch the cell to SOL (way below 50000) → must NOT fire
//   3. the level line must be hidden while another symbol is shown
//   4. switch back to BTC → the alert resumes and the line returns
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const snap = () => p.evaluate(() => {
    const ws = window.__ws;
    const cell = ws.cells()[0];
    const a = ws.getState().priceAlerts?.[0] ?? null;
    const line = cell.chart.drawings.all().find((d) => d.type === 'hline');
    return {
        shown: cell.state.symbol,
        alert: a && { symbol: a.symbol, state: a.state, fires: a.fires },
        lineVisible: line ? line.visible !== false : null,
        rows: [...document.querySelectorAll('.vela-al-row')].map((r) => r.textContent),
    };
});

await p.evaluate(async () => {
    const ws = window.__ws;
    ws.openAlertCreate();
    await new Promise((r) => setTimeout(r, 400));
    [...document.querySelectorAll('.vela-ac-opt')].find((o) => o.textContent === 'Less than')?.click();
    const input = document.querySelectorAll('.vela-ac-value input')[0];
    input.value = '50000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.vela-ac-create').click();
    await new Promise((r) => setTimeout(r, 900));
});
const armedOnBtc = await snap();

await p.evaluate(() => window.__ws.cells()[0].setSymbol('SOLUSDT'));
await p.waitForTimeout(9000);
const onSol = await snap();

await p.evaluate(() => window.__ws.cells()[0].setSymbol('BTCUSDT'));
await p.waitForTimeout(6000);
const backOnBtc = await snap();

console.log(JSON.stringify({ armedOnBtc, onSol, backOnBtc, errors: errors.slice(0, 3) }, null, 1));
await b.close();
