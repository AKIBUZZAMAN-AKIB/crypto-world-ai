// The OFFLINE harness page for `test/browser/*.mjs`: the same workspace chrome as
// workspace.html, but every cell is fed the SAME synthetic bar array from `data`, with
// no network and no persistence. The live page is the better demo; this page is the
// better ORACLE — a crosshair instant, a click time and a visible range mean the same
// thing on every cell, on every machine, at every hour.
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

const ws = new VelaWorkspace("#workspace", {
    layout: "4",
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
