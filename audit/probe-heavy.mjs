// Heavy-load probe: one chart carrying 20 indicators (TradingView's Ultimate allows 50),
// then a pan measurement + a picker-search latency measurement. This answers "does the
// app stay premium when a power user piles studies on", which the 8-cell test does not.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const t = await p.evaluate(async () => {
    const chart = window.__ws.cells()[0].chart;
    const cell = window.__ws.cells()[0];
    // Ask the cell for the REAL catalog instead of guessing type ids.
    const ids = (cell.nativeCatalog ?? []).filter((n) => n.supported && n.type !== 'volume' && n.type !== 'vpvr').slice(0, 20).map((n) => n.type);
    const started = performance.now();
    const added = [];
    for (const id of ids) {
        try { const h = chart.addNativeIndicator(id, {}); if (h) added.push(id); } catch { /* unknown id */ }
    }
    await new Promise((r) => setTimeout(r, 2500));
    return { ms: Math.round(performance.now() - started - 2500), requested: added.length,
        live: chart.inspect().indicators.length,
        types: chart.inspect().indicators.map((i) => i.nativeType).slice(0, 8),
        panes: chart.panes.list().length };
});

const pan = await p.evaluate(async () => {
    const canvas = [...document.querySelectorAll('canvas')].find((c) => c.clientWidth > 200);
    const r = canvas.getBoundingClientRect();
    const send = (type, cx) => canvas.dispatchEvent(new PointerEvent(type, {
        clientX: cx, clientY: r.top + r.height * 0.4, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true, buttons: 1, isPrimary: true }));
    const deltas = []; let last = performance.now();
    const stop = performance.now() + 1200;
    send('pointerdown', r.left + r.width * 0.6);
    const tick = () => { const n = performance.now(); deltas.push(n - last); last = n; if (n < stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    let cx = r.left + r.width * 0.6;
    while (performance.now() < stop) { cx -= 3; send('pointermove', cx); await new Promise((res) => setTimeout(res, 16)); }
    send('pointerup', cx);
    const s = deltas.slice(2).sort((a, z) => a - z);
    return { frames: s.length, median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), over33: s.filter((d) => d > 33.4).length };
});

// picker search latency: type "mac" and time to the filtered list
const search = await p.evaluate(async () => {
    const ws = window.__ws;
    ws.openIndicators?.();
    await new Promise((r) => setTimeout(r, 800));
    const input = [...document.querySelectorAll('input')].find((i) => /search/i.test(i.placeholder || i.getAttribute('aria-label') || ''));
    if (!input) return null;
    const t0 = performance.now();
    input.value = 'mac';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r()));
    const visible = [...document.querySelectorAll('[class*=ind-item], [class*=ind-row]')].filter((e) => e.offsetHeight > 0).length;
    return { ms: Math.round(performance.now() - t0), rows: visible };
});

const mem = await p.evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), nodes: document.getElementsByTagName('*').length }));
console.log(JSON.stringify({ add: t, pan, search, mem, errors: errors.slice(0, 3) }, null, 1));
await b.close();
