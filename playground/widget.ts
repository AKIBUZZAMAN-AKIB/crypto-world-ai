// The bare playground page: a SINGLE-CHART workspace (topbar + chart, `layout: false`)
// with the Binance provider (public API, no key, no server needed), the vendored Pine
// engine, and the in-chart script editor — the OSS integration surface exercised end to
// end.
//
// Vela SHIPS NO SCRIPTING ENGINE; this page registers one itself (vela-pine-libre, MIT,
// vendored under playground/vendor so a plain checkout runs with no sibling repo). With
// an engine present the shell offers its Pine editor panel — write, version, "Add to
// chart"/"Update on chart" — and every script row's legend grows a "Source code" chip.
// `demo-engine.ts` stays next to this file as the runnable companion to
// docs/contributing/adding-an-engine.md (see playground/workspace.ts for it live).
import { VelaWorkspace } from '../src/workspace';
import { BinanceProvider } from '../src/data/providers/binance';
import { addSampleMarks } from './marks';
import { PineEngine } from './vendor/pine-libre/index.js';
import { playgroundStorage } from './persistence';

// The playground's CUSTOM persistence (shared with the workspace page): with `persist`
// on, the shell saves and restores EVERYTHING through this adapter — prefs, renderer
// config, and user drawings. The key is pinned so this page never collides with the
// multi-chart page's own document ('vela-workspace') in the same adapter namespace.

const storage = playgroundStorage();

const ws = new VelaWorkspace('#chart', {
    layout: false, // SINGLE-CHART mode: one cell, no layout picker, no sync switches
    symbol: 'BTCUSDT', // bare = first declared provider (binance); 'coinbase:BTC-USD' pins a venue
    timeframe: '60',
    live: true,
    theme: 'dark',
    autofocus: true, // the chart IS the page — shortcuts work from the first keystroke
    persist: 'vela-widget', // → 'vela-play:vela-widget' in devtools (the page's historical key)
    storage,
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineEngine() }, // the vendored engine (swap for a worker build to move Off-main-thread)
    defaultLanguage: 'pine', // scripts added without a `language` run on the engine above
    // No script manifest: the indicators dialog lists the built-in catalog only. Scripts
    // reach the chart through the Code panel below (or an `indicators` manifest — see the
    // commented option further down).

    // ── The rest of the CHART options, at their defaults — uncomment to play ─────────
    // bars: 1000,                     // history depth to load (paints progressively: newest window first)
    // settings: { hidden: ['advanced'] }, // hide settings-dialog entries by id — a tab ('advanced'), a
    //                                 //  group ('canvas.grid'), or a row; ids via chart.renderer.listSettingsIds()
    // data: myBars,                   // offline OHLCV[] — replaces the provider entirely (no fetches, no live)
    // visibleRange: '3M',             // initial window: '1D'|'1W'|'1M'|'3M'|'6M'|'1Y'|'5Y'|'YTD'|'ALL' or {from,to} in ms (default: frame the tail)
    // priceStyle: 'candles',          // 'candles'|'bars'|'line'|'area'|'baseline'|'heikinashi' or a registered chart-type id
    // volume: true,                   // the built-in volume columns (native indicator); false opts out
    // logScale: false,                // logarithmic price scale
    // currentPriceLine: true,         // dashed line + axis chip at the latest price
    // upColor: '#089981',             // bullish candles (default: the palette's bullish green)
    // downColor: '#f23645',           // bearish candles (default: the palette's bearish red)
    // glow: 0,                        // neon glow on line series, 0..~0.6 — WebGL2 backend only
    // animations: { zoom: true, pan: true, liveBar: false }, // eased zoom + inertial pan + forming-bar glide (true = 90 ms, or a duration in ms); false disables all
    // nativeBackend: 'auto',          // 'auto' = WebGL2 when available, else canvas2d; or force either
    // renderer: NativeRenderer,       // a custom IChartRenderer class (default: the native renderer)
    // drawings: true,                 // user drawings — default: toolbar VISIBLE; false removes the whole
    //                                 //  surface (the chart.drawings API stays); {tools/groups, toolbar} customizes
    // alertCap: 50,                   // alerts the topbar bell keeps (oldest drop beyond it)

    // ── The rest of the SHELL options, at their defaults ──────────────────────────────
    // indicators: [{ name: 'My script', script: DEMO_SCRIPTS.ema, language: 'demo' }], // a script
    //                                 //  manifest: rows the dialog lists next to the built-in catalog
    // indicators: async () => (await fetch('/my/manifest.json')).json(), // the manifest can also
    //                                 //  be an ASYNC LOADER (filesystem, authenticated API, …)
    // timeframes: ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'], // topbar timeframe presets
    // timezone: 'Etc/UTC',            // display timezone (IANA), switchable from the bottom bar
    // statusline: true,               // chrome: the status line
    // watermark: true,                // chrome: the symbol watermark behind the candles
    // bottombar: true,                // chrome: the range-presets + timezone bar
    // topbar: {                       // COMPOSE the topbar: each side lists its VISIBLE
    //     left: ['symbol', 'timeframes', 'style', 'layout', 'indicators', 'actions', 'undo-redo'],
    //     right: ['actions', 'alerts', 'panels', 'screenshot'],
    // },
    //                                 // These values ARE the defaults (an undeclared side keeps
    //                                 //  them; 'layout' simply never renders on this single-chart
    //                                 //  page). Entries render in LIST ORDER; omitting an id also
    //                                 //  removes its mobile entry and keyboard chord (mod+alt+S
    //                                 //  with 'screenshot', `/` with 'indicators'). 'actions' is
    //                                 //  the flow slot for contributed actions — naming an
    //                                 //  action's ID instead pins it at that spot. An explicit
    //                                 //  list is the side's complete (and frozen) contract.
});

void ws.chart.ready().then(() => console.log('[vela-dev] chart ready'));

// Sample timeline marks (chart.marks) — see marks.ts: a cluster, a fanning stack, a custom
// icon with details loaded on click… spread over the visible range once the chart painted.
void ws.chart.ready().then(() => addSampleMarks(ws.chart));

// The page shell follows the app theme — flip it from chart settings → Canvas → Theme
// (or `ws.setTheme('light')` in the console) and the body around the chart follows.
ws.chart.on('theme:changed', (t) => {
    document.body.style.background = t.background;
});

// Handy for poking around from the browser console.
(window as unknown as { ws: VelaWorkspace }).ws = ws;

// ── State surface demo (uncomment to try) ─────────────────────────────────────
// Single-chart mode speaks the SAME state triplet and document format as the grid —
// it is the single-cell case (layout '1', one `c1` cell). `persist` above writes
// exactly this document; the calls below are how a host composes custom flows
// (server snapshots, share links, templates) on top of it.
//
// // READ — one versioned document: market, prefs, renderer config, user drawings,
// // and the indicator ledger. JSON-safe: `JSON.stringify(snapshot)` is the payload.
// const snapshot = ws.getState();
// console.log('[state] document:', snapshot);
//
// // EVENT — fires debounced (~500ms) after ANY persistable change (draw a line,
// // switch the symbol, add an indicator…). Re-pull getState() for the fresh doc.
// // Returns an unsubscribe function.
// const offState = ws.on('state:changed', () => {
//     console.log('[state] changed →', ws.getState().charts[0]);
// });
//
// // WRITE — a same-shape document applies IN PLACE: the chart instance survives
// // (the market switches via setMarket), config/drawings/indicators are replaced.
// // Untrusted-safe: malformed fields are dropped by the shared codec, never thrown on.
// setTimeout(() => {
//     const doc = ws.getState();
//     doc.charts[0]!.symbol = 'SOLUSDT'; // retarget the chart…
//     doc.charts[0]!.drawings = { version: 1, drawings: [] }; // …and wipe its drawings
//     ws.applyState(doc);
//     offState();
// }, 5000);


// One re-projection of the chrome after the contributed actions above were registered
// (a plugin's, the editor button's). The editor PANEL needs no such call: the shell owns
// it, so it is in the topbar's panel group, the ⋯ drawer, and every script row's
// "Source code" chip from the moment the workspace exists.
ws.refreshActions();

// ── Execution-context listener demo — how host code intercepts Vela's engine context.
// 'context:changed' fires after the initial run and (throttled ~1/s) on live candles;
// pull a read-only snapshot and inspect it. Subscriptions survive symbol/timeframe
// changes — the shell switches markets IN PLACE (setMarket), same chart instance.
void ws.chart.ready().then(() => {
    const chart = ws.chart;
    chart.on('context:changed', ({ id }) => {
        void (async () => {
            const handle = chart.indicators().find((h) => h.id === id);
            const snap = await handle?.context(['plots', 'barIndex']);
            if (!handle || !snap) return;
            const keys = Object.keys(snap.plots);
            const points = Object.values(snap.plots).reduce((n, p) => n + p.length, 0);
            console.log(
                `[vela-ctx] ${handle.title || id} — ${keys.length} plot(s) [${keys.join(', ')}], ` +
                    `${points} points, last bar #${snap.barIndex} (${snap.phase})`,
            );
        })();
    });
});
