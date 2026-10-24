// Leak probe: does the workspace give memory back? Switch layouts / reload the same
// document repeatedly and watch the heap, DOM nodes and canvas count. A premium chart
// must be flat here — a drift means a destroyed cell kept a listener, canvas or buffer.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2000);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const snap = () => p.evaluate(() => {
    const g = window.gc;
    if (g) g();
    return {
        heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
        nodes: document.getElementsByTagName('*').length,
        canvases: document.querySelectorAll('canvas').length,
    };
});

const baseline = await snap();
const rounds = [];
for (let i = 0; i < 6; i++) {
    await p.evaluate(async () => {
        const ws = window.__ws;
        ws.setLayout('8');
        await new Promise((r) => setTimeout(r, 900));
        ws.setLayout('1');
        await new Promise((r) => setTimeout(r, 900));
        ws.setLayout('4');
        await new Promise((r) => setTimeout(r, 900));
        ws.setLayout('1');
        await new Promise((r) => setTimeout(r, 900));
    });
    await p.waitForTimeout(500);
    rounds.push(await snap());
}

// also: add/remove an indicator 40 times on one chart
await p.evaluate(async () => {
    const ws = window.__ws;
    const chart = ws.cells()[0].chart;
    for (let i = 0; i < 40; i++) {
        chart.addIndicator('rsi', {});
        await new Promise((r) => setTimeout(r, 25));
        const last = chart.inspect().indicators.filter((x) => x.nativeType === 'rsi').pop();
        if (last) chart.removeIndicator?.(last.id);
        await new Promise((r) => setTimeout(r, 25));
    }
});
await p.waitForTimeout(1200);
const afterIndicators = await snap();

console.log(JSON.stringify({ baseline, rounds, afterIndicators, drift: +(afterIndicators.heap - baseline.heap).toFixed(1), errors: errors.slice(0, 3) }, null, 1));
await b.close();
