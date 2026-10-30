// The OFFLINE harness page for `test/browser/*.mjs`: the same workspace chrome as
// workspace.html, but every cell is fed the SAME synthetic bar array from `data`, with
// no network and no persistence unless the test explicitly opts in via ?persist=1.
// The live page is the better demo; this page is the better ORACLE — a crosshair
// instant, a click time and a visible range mean the same thing on every cell.
import { VelaWorkspace } from "../src/workspace";
import type { OHLCV } from "../src/core/model/ohlcv";

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS = Array.from({ length: 800 }, (_, i) => {
    const open = 100 + Math.sin(i / 9) * 4 + i * 0.05;
    const close = open + Math.sin(i / 3) * 1.2;
    return {
        time: T0 + i * HOUR,
        open,
        high: Math.max(open, close) + 0.8,
        low: Math.min(open, close) - 0.8,
        close,
        volume: 10 + (i % 17),
    };
});

/**
 * Every ticker resolves to the SAME array: a switch commits (the tab-link test needs a
 * real `market:changed`) while the geometry stays comparable across cells.
 */
const offlineProvider = {
    getBars: (): Promise<OHLCV[]> => Promise.resolve(BARS),
    listSymbols: (): Promise<Array<{ ticker: string }>> =>
        Promise.resolve(["AAA", "BBB", "CCC", "DDD", "ZZZ", "YYY"].map((ticker) => ({ ticker }))),
};

// The editor preview opts into the same engine used by the live playground. Keeping
// this conditional preserves the engine-free fixture for the other browser probes.
const params = new URLSearchParams(window.location.search);
const editorPreview = params.get("preview") === "editor";
const editorEngine = editorPreview ? await import("./vendor/pine-libre/index.js") : null;

const ws = new VelaWorkspace("#workspace", {
    layout: "4",
    ...(params.get("persist") === "1" ? { persist: "vela-offline-panel-test" } : {}),
    ...(editorEngine ? { engines: { pine: () => new editorEngine.PineEngine() }, defaultLanguage: "pine" } : {}),
    symbol: "AAA",
    timeframe: "60",
    bars: BARS.length,
    providers: { offline: () => offlineProvider },
    live: false,
    theme: "dark",
    autofocus: true,
    cells: {
        a: { symbol: "AAA" },
        b: { symbol: "BBB" },
        c: { symbol: "CCC" },
        d: { symbol: "DDD" },
    },
});

(window as unknown as { __ws: VelaWorkspace }).__ws = ws;
if (editorPreview) {
    document.title = "Pine editor preview · synthetic chart data";
    ws.openEditor();
}

// The shared preview can opt into an actual Pine backtest over these synthetic bars.
// The default offline test page remains unchanged and does not auto-run a strategy.
if (new URLSearchParams(window.location.search).get("preview") === "strategy") {
    void (async () => {
        const [{ PineEngine }, { PINE_SCRIPTS }] = await Promise.all([
            import("./vendor/pine-libre/index.js"),
            import("./pine-scripts"),
        ]);
        const chart = ws.active.chart;
        await chart.ready();
        chart.registerEngine("pine", new PineEngine());
        const example = PINE_SCRIPTS.find((entry) => entry.script?.includes('strategy("MACD Strategy"'));
        if (!example?.script) return;
        const source = example.script.replace('strategy("MACD Strategy",', 'strategy("MACD Strategy (demo)",');
        const result = await chart.runScript(source, { language: "pine" });
        if (!result.ok) console.warn("Demo strategy did not run", result.error);
    })();
}

// The opt-in Alerts preview uses the real form on the same synthetic feed. No
// demo notifications are injected; direct offline.html remains the test fixture.
if (new URLSearchParams(window.location.search).get("preview") === "alerts") {
    document.title = "Alerts preview · synthetic chart data";
    void ws.active.chart.ready().then(() => ws.openAlertCreate());
}
