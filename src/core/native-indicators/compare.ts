// Compare — the chart's second symbol, with the reference's three display modes.
//
// TradingView's Compare tool offers **Same % scale** (both series in percent on the chart's
// own axis), **New price scale** (the symbol on its own axis column beside the price), and
// **New pane** (its own section below). All three are this one study — the mode decides the
// numbers it emits and the pane/scale it is placed on:
//
//  · `same-percent` — the symbol is re-based into the CHART's price space
//    (`chartAnchor × other / otherAnchor`, anchored at the first visible bar). The price
//    axis is switched to percent by the host, and because the renderer's percent baseline
//    is that same first visible bar, both lines then read 0% at the left edge and track
//    each other's performance exactly as the reference does. Pan or zoom and the anchor —
//    hence every percentage — follows.
//  · `own-scale` — the symbol's real closes, on the price pane, with its own axis column
//    (`ownScale`), so two price levels can be read at once.
//  · `new-pane` — the same real closes in a pane of its own.
//
// The series is fetched through the engine's own `fetchSeries` gateway (the path
// `request.security` uses), so a compare symbol resolves its provider exactly like the
// chart does — cross-exchange prefixes included.
import { registerNativeIndicator } from './NativeIndicator';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor, NativeIndicatorOutput } from './NativeIndicator';
import type { InputSchema, InputValue } from '../model/inputs';
import type { OHLCV } from '../model/ohlcv';
import type { LineLikeSeries, SeriesPoint } from '../model/series';
import { stableSeriesId } from '../model/identity';
import { ACCENT } from '../palette';

export const COMPARE_TYPE = 'compare';

/** The reference's three placements, by their own names. */
export type CompareDisplay = 'same-percent' | 'own-scale' | 'new-pane';

export const COMPARE_DISPLAY_LABELS: Readonly<Record<CompareDisplay, string>> = {
    'same-percent': 'Same % scale',
    'own-scale': 'New price scale',
    'new-pane': 'New pane',
};

/** The compare symbol's line — the accent, so the eye finds the newcomer. */
const COMPARE_COLOR = ACCENT;

export interface CompareInputs {
    symbol: string;
    display: CompareDisplay;
}

const INPUTS: InputSchema[] = [
    {
        key: 'symbol',
        title: 'Compare symbol',
        type: 'symbol',
        defval: '',
        group: 'Symbol',
        tooltip: 'The symbol to measure against the chart.',
    },
    {
        key: 'display',
        title: 'Display',
        type: 'string',
        defval: 'same-percent',
        options: ['same-percent', 'own-scale', 'new-pane'],
        group: 'Symbol',
        tooltip: 'Same % scale — both series in percent from the first visible bar. New price scale — the symbol on its own axis. New pane — its own section below the chart.',
    },
];

/**
 * Align the fetched series onto the chart's bar times. Two markets keep different
 * holidays and sessions, so a bar-for-bar zip is wrong — the value in force at each chart
 * bar is the compare symbol's LAST CLOSE AT OR BEFORE it (a step, the way a daily series
 * reads against an intraday chart). PURE — the interesting arithmetic, tested directly.
 */
export function alignCloses(chartTimes: readonly number[], other: readonly OHLCV[]): Array<number | null> {
    const out: Array<number | null> = [];
    let j = 0;
    let last: number | null = null;
    for (const t of chartTimes) {
        while (j < other.length && other[j]!.time <= t) {
            last = other[j]!.close;
            j += 1;
        }
        out.push(last);
    }
    return out;
}

/** Percent change from the first non-null value — the Same-% arithmetic. PURE. */
export function percentFrom(values: readonly (number | null)[]): Array<number | null> {
    const first = values.find((v) => v != null && Number.isFinite(v)) ?? null;
    if (first == null || first === 0) return values.map(() => null);
    return values.map((v) => (v == null || !Number.isFinite(v) ? null : (v / first - 1) * 100));
}

/**
 * Re-base the compare series into the CHART's price space, anchored at `start` (the first
 * visible bar): the value a bar would need so that the percent axis prints its own change.
 * `null` anywhere before both anchors exist. PURE.
 */
export function rebaseIntoChart(
    chartCloses: readonly number[],
    other: readonly (number | null)[],
    start: number,
): Array<number | null> {
    const chartAnchor = chartCloses[start];
    const otherAnchor = other[start];
    if (chartAnchor == null || otherAnchor == null || !Number.isFinite(chartAnchor) || !Number.isFinite(otherAnchor) || otherAnchor === 0) {
        return chartCloses.map(() => null);
    }
    return other.map((v) => (v == null || !Number.isFinite(v) ? null : (chartAnchor * v) / otherAnchor));
}

class CompareIndicator implements NativeIndicator {
    private ctx: NativeIndicatorContext | null = null;
    private inputs: CompareInputs = { symbol: '', display: 'same-percent' };
    private series: OHLCV[] = [];
    private loadedSymbol = '';
    private pending = 0;

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = readInputs(inputs);
        void this.load();
    }

    onBars(): void {
        this.emit();
    }

    onViewport(): void {
        // The anchor follows the LEFT EDGE of the visible window, so a scroll/zoom re-plots
        // every percentage. The ranges themselves come from `visibleBars()` at emit time —
        // `onViewport`'s argument is the visible TIME range, not bar indices.
        this.emit();
    }

    setInputs(inputs: Record<string, InputValue>): void {
        const next = readInputs(inputs);
        const reload = next.symbol !== this.inputs.symbol;
        this.inputs = next;
        if (reload || next.symbol !== this.loadedSymbol) void this.load();
        else this.emit(); // a display switch only re-plots what is already fetched
    }

    suspend(): void {
        /* nothing streams */
    }

    resume(): void {
        this.emit();
    }

    stop(): void {
        this.ctx = null;
        this.series = [];
    }

    /** Fetch the compare series (idempotent per symbol; a stale reply is dropped by token). */
    private async load(): Promise<void> {
        const ctx = this.ctx;
        if (!ctx) return;
        const symbol = this.inputs.symbol.trim();
        if (!symbol) {
            this.series = [];
            this.emit();
            return;
        }
        const token = ++this.pending;
        ctx.setStatus('loading');
        try {
            const bars = ctx.bars();
            const fetchSeries = ctx.fetchSeries;
            if (!fetchSeries) throw new Error('this chart cannot fetch another symbol');
            const fetched = await fetchSeries(symbol, ctx.timeframe, {
                ...(bars.length > 0 ? { from: bars[0]!.time } : {}),
                limit: Math.max(600, bars.length * 2),
            });
            if (token !== this.pending || !this.ctx) return; // superseded or torn down
            this.series = fetched;
            this.loadedSymbol = symbol;
            ctx.setStatus('idle');
            this.emit();
        } catch (err) {
            if (token !== this.pending || !this.ctx) return;
            this.series = [];
            this.loadedSymbol = symbol;
            ctx.setStatus('idle');
            this.emit(err instanceof Error ? err.message : 'the compare symbol could not be loaded');
        }
    }

    private emit(error?: string): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const bars = ctx.bars();
        const times = bars.map((b) => b.time);
        const aligned = this.series.length > 0 ? alignCloses(times, this.series) : times.map(() => null);
        const view = ctx.visibleBars?.() ?? null;
        // Everything before the visible window stays blank: the anchor must be the bar the
        // user is looking at, and a line that starts mid-slope reads as a bug.
        const start = view ? Math.max(0, Math.min(Math.max(0, bars.length - 1), Math.floor(view.from))) : 0;
        const mode = this.inputs.display;
        const percent = mode === 'same-percent';
        const values = percent ? rebaseIntoChart(bars.map((b) => b.close), aligned, start) : aligned.map((v, i) => (i < start ? null : v));
        const instanceId = ctx.id;
        const label = this.inputs.symbol.trim() || error || 'Compare';
        const series: LineLikeSeries[] = [
            {
                id: stableSeriesId({ instanceId, kind: 'line', title: 'compare', ordinal: 0 }),
                title: percent ? `${label} %` : label,
                paneId: '',
                kind: 'line',
                points: toPoints(times, values),
                style: { color: COMPARE_COLOR, width: 2, lineStyle: 'solid' },
                // Same-% mode re-bases the symbol into the CHART's price space, so the line
                // must ride the price pane's own scale (it IS a price series there). In the
                // other two modes the values are the symbol's real prices, which belong to
                // the indicator's own axis column — `overlay` would drag them onto the
                // price scale and leave that column measuring nothing.
                overlay: percent,
            },
        ];
        const out: NativeIndicatorOutput = { series };
        ctx.emit(out);
    }
}

function toPoints(times: readonly number[], values: readonly (number | null)[]): SeriesPoint[] {
    return times.map((time, i) => ({ time, value: values[i] ?? null }));
}

function readInputs(inputs: Record<string, InputValue>): CompareInputs {
    const display = inputs['display'];
    return {
        symbol: typeof inputs['symbol'] === 'string' ? inputs['symbol'] : '',
        display: display === 'own-scale' || display === 'new-pane' ? display : 'same-percent',
    };
}

export const compareDescriptor: NativeIndicatorDescriptor = {
    type: COMPARE_TYPE,
    title: 'Compare',
    shortTitle: 'Compare',
    // Mounts ON the price pane sharing its scale — the default mode ("Same % scale") needs
    // no move at all; the host moves it for the other two.
    paneHint: 'price',
    overlay: true,
    category: 'Overlays',
    reactsToViewport: true,
    inputsSchema: () => INPUTS,
    defaultInputs: () => Object.fromEntries(INPUTS.map((i) => [i.key, i.defval])),
    create: () => new CompareIndicator(),
};

/** Register the Compare study (idempotent). */
export function registerCompareIndicator(): void {
    registerNativeIndicator(compareDescriptor);
}
