// Probe: run a Pine script through the VENDORED engine and print exactly what fails.
// Usage: node pine-probe.mjs <file.pine>   (or paste the source in PROBE_SOURCE)
//
// The synthetic series carries deterministic NOISE on top of the trend/cycle. That matters:
// a pure sine wave is perfectly periodic, so successive pivots always sit at the same price
// and a divergence study reporting "0 signals" looks like an engine bug when the DATA simply
// cannot diverge.
import { readFileSync } from 'node:fs';
import { PineEngine } from './playground/vendor/pine-libre/index.js';

const T0 = 1_700_002_800_000;
const HOUR = 3_600_000;
function bars(n = 400) {
    const out = [];
    let prev = 100;
    for (let i = 0; i < n; i++) {
        // x - floor(x): a POSITIVE fraction. `% 1` can be negative and would bias the walk.
        const x = Math.sin(i * 12.9898) * 43758.5453;
        const noise = x - Math.floor(x);
        const close = 100 + 0.02 * i + Math.sin(i / 5) * 6 + Math.sin(i / 1.7) * 1.2 + (noise - 0.5) * 9;
        const open = prev;
        out.push({ time: T0 + i * HOUR, open, high: Math.max(open, close) + 0.4, low: Math.min(open, close) - 0.4, close, volume: 500 + (i % 37) });
        prev = close;
    }
    return out;
}

const source = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : process.env.PROBE_SOURCE;
const engine = new PineEngine();
let prepared;
try {
    prepared = await engine.prepare(source, 'probe');
} catch (err) {
    console.log('PREPARE ERROR:', err?.message ?? err);
    process.exit(1);
}
const out = { model: null };
const errors = [];
const session = engine.execute(
    { prepared, market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: { ticker: 'BTCUSDT', mintick: 0.01 } }, bars: bars(), inputs: {}, mode: 'static', historyState: 'complete' },
    { onModel: (m) => { out.model = m; }, onError: (e) => errors.push(e) },
);
for (let i = 0; i < 300 && out.model === null && errors.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
session.stop();

if (errors.length) {
    console.log('RUNTIME ERRORS:', errors.map((e) => `${e.message}${e.line ? ` (line ${e.line})` : ''}`).join('\n'));
} else if (!out.model) {
    console.log('NO MODEL, NO ERROR');
} else {
    const m = out.model;
    console.log('OK title=%j overlay=%s series=%d', m.title, m.overlay, m.series.length);
    console.log('series kinds:', JSON.stringify(m.series.map((s) => `${s.kind}:${s.title ?? ''}:${s.kind === 'markers' ? (s.markers?.length ?? 0) : (s.points?.length ?? '-')}`)));
    console.log('model keys:', Object.keys(m).join(','));
    if (m.hlines) console.log('hlines:', JSON.stringify(m.hlines.map((h) => h.value)));
    if (m.fills) console.log('fills:', JSON.stringify(m.fills).slice(0, 300));
    for (const marker of m.series.filter((s) => s.kind === 'markers')) {
        console.log(`markers "${marker.title}" (${marker.markers.length}):`, JSON.stringify(marker.markers.slice(0, 2)));
    }
    if (m.priceLines) console.log('priceLines:', JSON.stringify(m.priceLines).slice(0, 500));
    if (m.backgrounds) console.log('backgrounds:', m.backgrounds.length);
    console.log('pane/overlay:', JSON.stringify({ overlay: m.overlay, pane: m.pane ?? null }));
}
