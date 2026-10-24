// Performance baseline for the round-28 deep audit.
// Measures, in one deterministic pass:
//   1. cold first-paint of the workspace (navigation → first painted frame)
//   2. pan frame times at 1 / 4 / 8 cells (the number a "premium" claim stands on)
//   3. long tasks (>50 ms) during a timeframe switch and an indicator add
//   4. JS heap + DOM node count at 8 cells
//   5. applyState() cost for an 8-cell document (what "open my saved layout" feels like)
// Run: LD_LIBRARY_PATH=… node audit/probe-perf.mjs
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));

// ── long-task collector installed before any app code runs ──
await p.addInitScript(() => {
    window.__long = [];
    try {
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
        }).observe({ entryTypes: ['longtask'] });
    } catch { /* not supported */ }
});

const t0 = Date.now();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
const navToCells = Date.now() - t0;
await p.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 30000 });
const navToCanvas = Date.now() - t0;
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

/** Frame times over N animation frames while the probe drags the active chart. */
async function panFrames(ms = 1200) {
    return p.evaluate(async (dur) => {
        const canvas = [...document.querySelectorAll('canvas')].find((c) => c.clientWidth > 200);
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        const x = r.left + r.width * 0.6;
        const y = r.top + r.height * 0.5;
        const send = (type, cx) => canvas.dispatchEvent(new PointerEvent(type, {
            clientX: cx, clientY: y, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true, buttons: 1, isPrimary: true,
        }));
        const deltas = [];
        let last = performance.now();
        let raf = 0;
        const stop = performance.now() + dur;
        send('pointerdown', x);
        const tick = () => {
            const now = performance.now();
            deltas.push(now - last);
            last = now;
            if (now < stop) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        let cx = x;
        while (performance.now() < stop) {
            cx -= 3;
            send('pointermove', cx);
            await new Promise((res) => setTimeout(res, 16));
        }
        send('pointerup', cx);
        cancelAnimationFrame(raf);
        const sorted = deltas.slice(2).sort((a, z) => a - z);
        const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
        return {
            frames: sorted.length,
            median: +pct(0.5).toFixed(1),
            p95: +pct(0.95).toFixed(1),
            worst: +(sorted[sorted.length - 1] || 0).toFixed(1),
            over16: sorted.filter((d) => d > 16.7).length,
            over33: sorted.filter((d) => d > 33.4).length,
        };
    }, ms);
}

const pan1 = await panFrames();

// ── grow to 8 cells and add indicators, then pan again ──
const grow = await p.evaluate(async () => {
    const ws = window.__ws;
    const t = performance.now();
    ws.setLayout('8');
    await new Promise((r) => setTimeout(r, 3000));
    const layoutMs = Math.round(performance.now() - t);
    const addT = performance.now();
    for (const cell of ws.cells()) {
        cell.chart.addNativeIndicator('rsi', {});
        cell.chart.addNativeIndicator('ema', {});
    }
    await new Promise((r) => setTimeout(r, 2500));
    return { layoutMs, add20Ms: Math.round(performance.now() - addT), cells: ws.cells().length };
});
const pan8 = await panFrames();

const mem = await p.evaluate(() => ({
    heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
    domNodes: document.getElementsByTagName('*').length,
    canvases: document.querySelectorAll('canvas').length,
    longTasks: (window.__long || []).slice().sort((a, b) => b - a).slice(0, 8),
    longTotal: (window.__long || []).length,
}));

// ── timeframe switch latency (hot path: refetch + rebuild + repaint) ──
const tf = await p.evaluate(async () => {
    const ws = window.__ws;
    const t = performance.now();
    for (const c of ws.cells()) c.chart.setTimeframe?.('15');
    await new Promise((r) => setTimeout(r, 2000));
    return Math.round(performance.now() - t);
});

// ── applyState cost: what "open my saved layout" costs ──
const apply = await p.evaluate(async () => {
    const ws = window.__ws;
    const doc = ws.getState();
    const t = performance.now();
    ws.applyState(doc);
    await new Promise((r) => setTimeout(r, 1500));
    return Math.round(performance.now() - t);
});

console.log(JSON.stringify({
    firstPaint: { msToFirstCells: navToCells, msToFirstCanvas: navToCanvas },
    pan1, grow, pan8, mem, tfSwitchMs: tf, applyStateMs: apply,
    errors: errors.slice(0, 3),
}, null, 1));
await b.close();
