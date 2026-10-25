// Off-chart quotes and session statistics — the data behind the shell's right-hand panels
// (Watchlist, Details). Both panels ask ONE tracker for a symbol's daily bars and a live
// subscription, so a symbol listed in both is fetched once and streams once.
//
// Everything here is pure except {@link QuoteTracker}, whose only jobs are refcounting and
// "the deepest request wins": a panel that asks for 3 bars and a panel that asks for 320
// share a single load, widened in place when the bigger request arrives.
import type { OHLCV } from '../core/model/ohlcv';

/** The shell's per-symbol data seam — what a panel needs to quote a market off-chart. */
export interface QuoteSource {
    /** Recent bars, oldest→newest (at least two for a change reading). */
    load(): Promise<OHLCV[]>;
    /** Live updates of the forming bar. Returns an unsubscribe. */
    subscribe(onBar: (bar: OHLCV) => void): () => void;
}

/** How a panel reads a market: `bars` is how much history it wants (daily). */
export type QuoteSourceFactory = (symbol: string, bars: number) => QuoteSource;

/** One market's current state, derived from its bars. Every field is null when unknown. */
export interface Quote {
    /** Latest close (the forming bar's close while it is live). */
    last: number | null;
    /** The previous session's close — the base of the day's change. */
    prev: number | null;
    /** last − prev. */
    change: number | null;
    /** Change as a percentage of prev. */
    changePct: number | null;
    /** The latest bar itself (its OHLC and volume). */
    bar: OHLCV | null;
}

/** Derive a {@link Quote} from a symbol's bars (oldest→newest). */
export function quoteOf(bars: readonly OHLCV[]): Quote {
    const bar = bars.length > 0 ? bars[bars.length - 1]! : null;
    const prevBar = bars.length > 1 ? bars[bars.length - 2]! : null;
    if (!bar) return { last: null, prev: null, change: null, changePct: null, bar: null };
    const last = bar.close;
    const prev = prevBar ? prevBar.close : null;
    const change = prev != null && Number.isFinite(prev) ? last - prev : null;
    const changePct = change != null && prev ? (change / prev) * 100 : null;
    return { last, prev, change, changePct, bar };
}

/** One session-range reading: where `value` sits between `low` and `high` (0…1). */
export function positionInRange(value: number | null, low: number | null, high: number | null): number | null {
    if (value == null || low == null || high == null || !Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
    if (!(high > low)) return null;
    return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

/** What the Details panel shows for one market, computed from its daily bars. */
export interface MarketStats {
    /** The last session (the forming one on a live market). */
    day: { open: number; high: number; low: number; close: number } | null;
    /** The day's change against the previous close. */
    change: number | null;
    changePct: number | null;
    /** The 52-week window, from the last 260 daily bars. */
    year: { high: number; low: number } | null;
    /** Today's volume against the mean of the previous 30 sessions. */
    volume: { last: number; average: number; ratio: number } | null;
    /** Wilder's ATR over 14 daily bars, in price and as a percentage of the last close. */
    atr: number | null;
    atrPct: number | null;
    /** Mean of the last 14 daily (high − low) ranges, as a percentage of price. */
    rangePct: number | null;
    /** Bars the panel actually read, and the newest one's time. */
    bars: number;
    lastTime: number | null;
}

const EMPTY_STATS: MarketStats = {
    day: null,
    change: null,
    changePct: null,
    year: null,
    volume: null,
    atr: null,
    atrPct: null,
    rangePct: null,
    bars: 0,
    lastTime: null,
};

/** Wilder's average true range over `period` bars (bars oldest→newest). */
export function atrOf(bars: readonly OHLCV[], period = 14): number | null {
    if (bars.length < period + 1) return null;
    const tr: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const prevClose = bars[i - 1]!.close;
        const b = bars[i]!;
        tr.push(Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose)));
    }
    if (tr.length < period) return null;
    let value = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) value = (value * (period - 1) + tr[i]!) / period;
    return value;
}

/** Everything the Details panel reads for one symbol. */
export function statsOf(bars: readonly OHLCV[]): MarketStats {
    if (bars.length === 0) return EMPTY_STATS;
    const last = bars[bars.length - 1]!;
    const prev = bars.length > 1 ? bars[bars.length - 2]! : null;
    const change = prev ? last.close - prev.close : null;
    const changePct = change != null && prev && prev.close !== 0 ? (change / prev.close) * 100 : null;

    const yearBars = bars.slice(-260);
    let yearHigh = Number.NEGATIVE_INFINITY;
    let yearLow = Number.POSITIVE_INFINITY;
    for (const b of yearBars) {
        if (b.high > yearHigh) yearHigh = b.high;
        if (b.low < yearLow) yearLow = b.low;
    }

    const prior = bars.slice(-31, -1);
    let volume: MarketStats['volume'] = null;
    if (prior.length > 0) {
        const average = prior.reduce((a, b) => a + (b.volume ?? 0), 0) / prior.length;
        const lastVolume = last.volume ?? 0;
        volume = { last: lastVolume, average, ratio: average > 0 ? lastVolume / average : 0 };
    }

    const atr = atrOf(bars, 14);
    const atrPct = atr != null && last.close !== 0 ? (atr / last.close) * 100 : null;
    const recent = bars.slice(-14);
    const rangePct =
        recent.length > 0 && last.close !== 0
            ? (recent.reduce((a, b) => a + (b.high - b.low), 0) / recent.length / last.close) * 100
            : null;

    return {
        day: { open: last.open, high: last.high, low: last.low, close: last.close },
        change,
        changePct,
        year: yearBars.length >= 2 ? { high: yearHigh, low: yearLow } : null,
        volume,
        atr,
        atrPct,
        rangePct,
        bars: bars.length,
        lastTime: last.time,
    };
}

interface Entry {
    symbol: string;
    bars: number;
    data: OHLCV[] | null;
    loading: boolean;
    quote: Quote;
    /** Listeners, by token — one per watcher. */
    listeners: Set<(q: Quote) => void>;
    unsubscribe: (() => void) | null;
    /** Bumped on every reload so a slow older load cannot overwrite a newer one. */
    revision: number;
}

/**
 * Refcounted quotes for the shell's panels. `watch()` returns an unsubscribe; the tracker
 * loads once per symbol, subscribes once, and widens the history when a deeper watcher
 * arrives instead of loading twice.
 */
export class QuoteTracker {
    private readonly entries = new Map<string, Entry>();

    constructor(private readonly source: QuoteSourceFactory) {}

    /** Start (or join) a watch on `symbol`. `onQuote` fires on the first load and on every live bar. */
    watch(symbol: string, bars: number, onQuote: (q: Quote) => void): () => void {
        const key = symbol;
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { symbol, bars, data: null, loading: false, quote: quoteOf([]), listeners: new Set(), unsubscribe: null, revision: 0 };
            this.entries.set(key, entry);
        }
        entry.listeners.add(onQuote);
        if (entry.quote.bar) onQuote(entry.quote); // a warm entry answers at once
        const widen = bars > entry.bars;
        if (widen) entry.bars = bars;
        if (!entry.loading && (entry.data === null || widen)) this.load(entry);
        const token = onQuote;
        return () => {
            const live = this.entries.get(key);
            if (!live) return;
            live.listeners.delete(token);
            if (live.listeners.size === 0) this.drop(key);
        };
    }

    /** The last quote this tracker knows for a symbol (null before the first load). */
    peek(symbol: string): Quote | null {
        const entry = this.entries.get(symbol);
        return entry && entry.quote.bar ? entry.quote : null;
    }

    /** One-shot read (no subscription) — used by anything that only needs a snapshot. */
    async read(symbol: string, bars: number): Promise<Quote> {
        const entry = this.entries.get(symbol);
        if (entry?.data && entry.bars >= bars) return entry.quote;
        const data = await this.source(symbol, bars).load();
        return quoteOf(data);
    }

    destroy(): void {
        for (const key of [...this.entries.keys()]) this.drop(key);
    }

    private drop(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        entry.unsubscribe?.();
        this.entries.delete(key);
    }

    private load(entry: Entry): void {
        const revision = ++entry.revision;
        entry.loading = true;
        const source = this.source(entry.symbol, entry.bars);
        source
            .load()
            .then((bars) => {
                if (entry.revision !== revision) return; // a wider load superseded this one
                entry.data = [...bars];
                entry.loading = false;
                this.emit(entry, quoteOf(entry.data));
                entry.unsubscribe?.();
                entry.unsubscribe = source.subscribe((bar) => this.onBar(entry, bar));
            })
            .catch(() => {
                if (entry.revision !== revision) return;
                entry.loading = false;
                this.emit(entry, quoteOf(entry.data ?? []));
            });
    }

    /** Fold a live forming bar in: replace the last bar when its time matches, else append. */
    private onBar(entry: Entry, bar: OHLCV): void {
        if (!entry.data) entry.data = [bar];
        else {
            const last = entry.data[entry.data.length - 1]!;
            if (bar.time === last.time) entry.data[entry.data.length - 1] = bar;
            else if (bar.time > last.time) {
                entry.data.push(bar);
                if (entry.data.length > Math.max(entry.bars, 2)) entry.data.shift();
            } else return;
        }
        this.emit(entry, quoteOf(entry.data));
    }

    private emit(entry: Entry, quote: Quote): void {
        entry.quote = quote;
        for (const listener of [...entry.listeners]) listener(quote);
    }
}
