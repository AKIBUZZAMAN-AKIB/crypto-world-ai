import type { OHLCV } from '../model/ohlcv';
import type { MarketConfig } from '../options';
import type { Unsubscribe } from '../util/types';

/**
 * Symbol metadata an engine may need (e.g. Pine `syminfo.*`). Free-form beyond
 * `ticker` — engines read the keys they understand and synthesize a fallback for
 * the rest.
 */
export interface SymbolInfo {
    ticker: string;
    [key: string]: unknown;
}

/**
 * The market-data abstraction. Vela OWNS the candles: it loads history and
 * streams live ticks through this port, holds the one canonical bar array, and
 * hands it to whichever engine executes. Decoupled from scripting so every
 * registered engine shares the same dataset (no per-engine re-fetch).
 *
 * Swappable: the default is `MultiProviderFeed` (a registry of `DataProvider`s); tests
 * inject a fake; a host app can supply its own backend.
 */
/** A bounded fetch window (epoch ms). `from`/`to` inclusive-ish; `limit` caps the count. */
export interface BarRange {
    /** Oldest bar open-time to fetch from (inclusive). */
    from?: number;
    /** Newest bar open-time to fetch to (defaults to "now" when omitted). */
    to?: number;
    /** Max bars. */
    limit?: number;
    /**
     * Trading session to serve (`'regular'` | `'extended'`) — rides every request on
     * markets that have sessions; absent = the provider's default. A provider without
     * a session concept ignores it.
     */
    session?: string;
}

/** A last-trade reading — what a watchlist or details panel shows above the chart. */
export interface QuoteSnapshot {
    /** The last traded price. */
    last: number;
    /** The previous session's close — the base of the change. Absent ≡ derive from bars. */
    prevClose?: number;
    /** Absolute change. Absent ≡ `last − prevClose`. */
    change?: number;
    /** Percentage change. Absent ≡ derived from `last`/`prevClose`. */
    changePct?: number;
    /** When the reading was taken (epoch ms). */
    time?: number;
}

/** The venue's trading state, when the source knows it (a 24/7 market is always `open`). */
export interface MarketStatusInfo {
    /** The statusline's vocabulary (`open`, `pre`, `post`, `extended`, `closed`, `holiday`)
     *  — an unknown word passes through to the panel as-is. */
    status: string;
    /** A ready-to-read label ("Market open", "Closed · opens 09:30"). */
    label?: string;
    /** The next session boundary (epoch ms), for a countdown. */
    nextChange?: number;
}

/** One headline, as a news panel lists it. */
export interface NewsItem {
    /** Stable id — the row's key (a URL is a fine id). */
    id: string;
    title: string;
    /** Publication time (epoch ms). */
    time: number;
    /** The outlet ("Reuters"). */
    source?: string;
    /** The article, opened on click. */
    url?: string;
    /** A one-line standfirst. */
    summary?: string;
    /** The tickers the story is tagged with. */
    symbols?: readonly string[];
}

export interface MarketDataFeed {
    /** Load the initial history (from a provider or the offline `data` array). */
    load(cfg: MarketConfig): Promise<OHLCV[]>;
    /**
     * Progressive load: emit growing snapshots while the source heals a cold symbol,
     * resolve with the final answer — `DataProvider.getBarsProgressive` semantics
     * (cumulative, confirmed-from-the-newest-bar snapshots; each extends the last).
     * Resolves NULL when the resolved source lacks the capability — the caller then
     * runs its non-progressive paths (single load, deep head + backfill) untouched.
     */
    loadProgressive?(cfg: MarketConfig, onBatch: (bars: OHLCV[]) => void, opts?: { signal?: AbortSignal }): Promise<OHLCV[] | null>;
    /** Subscribe to live forming-candle ticks. Returns an unsubscribe fn. */
    subscribe(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe;
    /** Optional symbol metadata for engines that need it; absent/undefined ≡ engine synthesizes. */
    symbolInfo?(cfg: MarketConfig): SymbolInfo | undefined;
    /**
     * Fetch a bounded range. Used by the cache to pull ONLY the uncached tail
     * (newly-closed + forming bars) instead of re-downloading the whole window.
     * Absent ≡ no ranged support; the cache falls back to a full `load`.
     */
    loadRange?(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]>;
    /**
     * Report that a symbol cannot be served by anything registered — the load is PARKED
     * (it resumes if a capable provider registers later). Hosts surface this instead of
     * leaving a silently blank chart. Absent ≡ the feed never parks.
     */
    onUnresolved?(cb: (info: { symbol: string; providers: string[] }) => void): Unsubscribe;
    /**
     * A last-trade reading for a symbol that is NOT the chart's — the watchlist and the
     * details panel. Absent ≡ those panels derive everything from bars (the default).
     * Resolve `null` when the source has no L1 for this symbol right now.
     */
    quote?(cfg: MarketConfig): Promise<QuoteSnapshot | null>;
    /**
     * Live L1 updates for the same off-chart symbol. Absent ≡ the panels follow the daily
     * bar stream instead, so a bars-only host still shows a moving number.
     */
    subscribeQuote?(cfg: MarketConfig, onQuote: (quote: QuoteSnapshot) => void): Unsubscribe;
    /**
     * The venue's trading state for a symbol. Absent ≡ the shell derives it from the
     * provider's calendar when it has one, and says nothing when it doesn't.
     */
    marketStatus?(cfg: MarketConfig): Promise<MarketStatusInfo | null>;
    /**
     * Headlines for a symbol (or the whole tape when `cfg.symbol` is empty/omitted).
     * Absent ≡ the news panel explains that this host has no news source — it never
     * invents one.
     */
    news?(cfg: MarketConfig, opts?: { limit?: number }): Promise<NewsItem[]>;
    /** Release feed-owned resources (parked waits, timers). Absent ≡ nothing to release. */
    destroy?(): void;
}
