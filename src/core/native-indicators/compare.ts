// Compare — the chart's second symbol, plotted as a study.
//
// The reference's Compare tool offers three modes: **Same % scale** (both series drawn on
// the price pane in percent), **New price scale** (the symbol on its own right-hand axis)
// and **New pane** (its own section below). Two of the three need a SECOND value axis, and
// a pane here carries exactly one — so this indicator ships the mode that needs none and
// still answers the question people open Compare for ("did it beat the chart?"):
//
//  · `percent` — both series normalised to % change from the first bar the two share, in
//    their own pane. This IS the Same % scale arithmetic, moved into a pane because the
//    price axis cannot be relabelled per series.
//  · `price` — the other symbol in its own units, own pane (the New pane mode).
//
// The series is fetched through the engine's own `fetchSeries` gateway (the path
// `request.security` uses), so a compare symbol resolves its provider exactly like the
// chart does — cross-exchange prefixes included.
import { registerNativeIndicator } from './NativeIndicator';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor, NativeIndicatorOutput } from './NativeIndicator';
import type { InputSchema, InputValue } from '../model/inputs';
import type { OHLCV } from '../model/ohlcv';
import type { LineLikeSeries, SeriesPoint } from '../model/series';
import type { PriceLine } from '../model/scene';
import { stableSeriesId } from '../model/identity';

export const COMPARE_TYPE = 'compare';

/** Chart series colour (the "base" line in percent mode) — read like the candles: neutral. */
const BASE_COLOR = '#9aa4b2';
/** The compare symbol's own line — the accent, so the eye finds the newcomer. */
const COMPARE_COLOR = '#2962ff';

export interface CompareInputs {
    symbol: string;
    mode: 'percent' | 'price';
    base: boolean;
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
        key: 'mode',
        title: 'Display',
        type: 'string',
        defval: 'percent',
        options: ['percent', 'price'],
        group: 'Symbol',
        tooltip: 'Percent — both series from 0% at the first shared bar. Price — the symbol in its own units.',
    },
    {
        key: 'base',
        title: 'Chart series',
        type: 'bool',
        defval: true,
        group: 'Symbol',
        when: { key: 'mode', equals: 'percent' },
        tooltip: 'Draw the chart’s own % change beside the compare line.',
    },
];

/**
 * Align the fetched series onto the chart's bar times. Compare markets keep different
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

class CompareIndicator implements NativeIndicator {
    private ctx: NativeIndicatorContext | null = null;
    private inputs: CompareInputs = { symbol: '', mode: 'percent', base: true };
    private series: OHLCV[] = [];
    private loadedSymbol = '';
    private pending = 0;
    /** The visible window in bar indices, when the host reports one. The percent base is
     *  anchored at its LEFT EDGE — the reference's rule ("0% at the first visible bar"),
     *  which is what makes the line readable instead of starting mid-climb. */
    private viewport: { from: number; to: number } | null = null;

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = readInputs(inputs);
        void this.load();
    }

    onBars(): void {
        this.emit();
    }

    onViewport(range: { from: number; to: number }): void {
        this.viewport = range;
        this.emit();
    }

    setInputs(inputs: Record<string, InputValue>): void {
        const next = readInputs(inputs);
        const symbolChanged = next.symbol !== this.inputs.symbol || next.mode !== this.inputs.mode;
        this.inputs = next;
        if (symbolChanged || next.symbol !== this.loadedSymbol) void this.load();
        else this.emit();
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
        const mode = this.inputs.mode;
        // Everything before the visible window stays blank: the anchor must be the bar the
        // user is looking at, and a line that starts mid-slope reads as a bug.
        const view = this.viewport ?? ctx.visibleRange?.() ?? null;
        const start = view ? Math.max(0, Math.min(bars.length, view.from)) : 0;
        const aligned = this.series.length > 0 ? alignCloses(times, this.series) : times.map(() => null);
        const windowed = aligned.map((v, i) => (i < start ? null : v));
        const compareValues = mode === 'percent' ? percentFrom(windowed) : windowed;
        const series: LineLikeSeries[] = [];
        const instanceId = ctx.id;
        const label = this.inputs.symbol.trim() || error || 'Compare';

        series.push({
            id: stableSeriesId({ instanceId, kind: 'line', title: 'compare', ordinal: 0 }),
            title: label,
            paneId: '',
            kind: 'line',
            points: toPoints(times, compareValues),
            style: { color: COMPARE_COLOR, width: 2, lineStyle: 'solid' },
        });
        if (mode === 'percent' && this.inputs.base) {
            const base = percentFrom(bars.map((b, i) => (i < start ? null : b.close)));
            series.push({
                id: stableSeriesId({ instanceId, kind: 'line', title: 'base', ordinal: 1 }),
                title: 'Chart',
                paneId: '',
                kind: 'line',
                points: toPoints(times, base),
                style: { color: BASE_COLOR, width: 1, lineStyle: 'solid' },
            });
        }
        // A dashed 0% rail: without it a flat compare (two identical series, or a market
        // that has not moved) reads as an EMPTY pane — the line sits on the pane's own
        // bottom edge and the axis has nothing to label.
        const priceLines: PriceLine[] =
            mode === 'percent'
                ? [
                      {
                          id: stableSeriesId({ instanceId, kind: 'hline', title: 'zero', ordinal: 0 }),
                          paneId: '',
                          price: 0,
                          color: '#5a6270',
                          lineStyle: 'dashed' as const,
                          width: 1,
                      },
                  ]
                : [];
        const out: NativeIndicatorOutput = { series, priceLines };
        ctx.emit(out);
    }
}

function toPoints(times: readonly number[], values: readonly (number | null)[]): SeriesPoint[] {
    return times.map((time, i) => ({ time, value: values[i] ?? null }));
}

function readInputs(inputs: Record<string, InputValue>): CompareInputs {
    const mode = inputs['mode'];
    return {
        symbol: typeof inputs['symbol'] === 'string' ? inputs['symbol'] : '',
        mode: mode === 'price' ? 'price' : 'percent',
        base: inputs['base'] !== false,
    };
}

export const compareDescriptor: NativeIndicatorDescriptor = {
    type: COMPARE_TYPE,
    title: 'Compare',
    shortTitle: 'Compare',
    paneHint: 'new',
    overlay: false,
    reactsToViewport: true,
    category: 'Overlays',
    inputsSchema: () => INPUTS,
    defaultInputs: () => Object.fromEntries(INPUTS.map((i) => [i.key, i.defval])),
    create: () => new CompareIndicator(),
};

/** Register the Compare study (idempotent). */
export function registerCompareIndicator(): void {
    registerNativeIndicator(compareDescriptor);
}
