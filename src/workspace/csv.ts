// Chart-data export — the one TradingView layout verb Vela was missing.
//
// TradingView's "Export chart data…" writes the bars the chart is SHOWING as CSV and
// offers two scopes: the visible range and everything loaded. Both are here, and both
// export the SOURCE bars, never a style's re-bucketed output: a Renko brick or a Heikin
// Ashi candle is a rendering of the data, and a spreadsheet wants the data.
//
// Format decisions, all deliberate:
//   • `time` defaults to ISO-8601 UTC (`2024-01-02T03:04:05Z`) — unambiguous for every
//     spreadsheet, sortable as text, and honest about which instant a bar opened. A
//     `unix` export writes milliseconds since epoch instead, which is what a backtester
//     wants; TradingView's dialog offers exactly these two, so ours does too. Millis are
//     shown only when they are not zero: bar times are whole seconds, and `.000` on every
//     one of 5,000 rows is noise.
//   • numbers are plain JSON-style decimals, no locale, no thousands separators: a file
//     that changes meaning with the reader's locale is a trap.
//   • the header is exactly `time,open,high,low,close,volume`, the order every
//     crypto/trading import tool expects.
//   • a missing volume exports as an empty cell rather than `0` — "no data" and "zero
//     trades" are different facts.
import type { OHLCV } from '../core/model/ohlcv';

export type CsvScope = 'visible' | 'all';

/**
 * How the `time` column is written. `iso` = `2024-01-02T03:04:05Z` (human, sortable),
 * `unix` = milliseconds since epoch (machine, what most backtesters read).
 */
export type CsvTimeFormat = 'iso' | 'unix';

/** One timestamp cell in the chosen format. */
export function csvTime(time: number, format: CsvTimeFormat = 'iso'): string {
    if (format === 'unix') return String(Math.trunc(time));
    const iso = new Date(time).toISOString(); // …:ss.mmmZ, always UTC
    // Drop a zero-millisecond tail so the common case matches TradingView's own files;
    // a genuinely sub-second bar keeps its precision rather than rounding away.
    return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

export interface CsvResult {
    /** The file's text, header included. */
    text: string;
    /** How many bar rows it carries (header excluded). */
    rows: number;
    /** `SYMBOL_TIMEFRAME_bars.csv` — filesystem-safe for every OS we can land on. */
    filename: string;
}

/** One CSV field: quote when it could otherwise be misread, and double any quote. */
function field(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A price/volume cell: finite numbers only, full precision, no grouping. */
function num(value: number | undefined | null): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Strip anything that would need escaping or confuse a shell/file manager. */
function safeName(text: string): string {
    return text.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'chart';
}

/**
 * Serialise bars to CSV. Pure: no DOM, no clock, no locale — so the same range always
 * produces byte-identical output (a test can pin it, and a re-export never diffs).
 */
export function barsToCsv(bars: readonly OHLCV[], timeFormat: CsvTimeFormat = 'iso'): string {
    const out: string[] = ['time,open,high,low,close,volume'];
    for (const b of bars) {
        if (!b || !Number.isFinite(b.time)) continue;
        out.push(
            [
                field(csvTime(b.time, timeFormat)),
                num(b.open),
                num(b.high),
                num(b.low),
                num(b.close),
                num(b.volume),
            ].join(','),
        );
    }
    return `${out.join('\n')}\n`;
}

/** Build the export for a scope: the file text, its row count, and its filename. */
export function buildChartCsv(opts: {
    bars: readonly OHLCV[];
    scope: CsvScope;
    /** Visible bar index range, inclusive — required for `scope: 'visible'`. */
    visible?: { from: number; to: number };
    symbol: string;
    timeframe: string;
    timeFormat?: CsvTimeFormat;
}): CsvResult {
    const { bars, scope, symbol, timeframe } = opts;
    let slice: readonly OHLCV[] = bars;
    if (scope === 'visible') {
        const from = Math.max(0, Math.floor(opts.visible?.from ?? 0));
        const to = Math.min(bars.length - 1, Math.ceil(opts.visible?.to ?? bars.length - 1));
        slice = to >= from ? bars.slice(from, to + 1) : [];
    }
    const text = barsToCsv(slice, opts.timeFormat ?? 'iso');
    const rows = Math.max(0, text.split('\n').length - 2); // trailing newline ⇒ one empty tail
    const suffix = scope === 'visible' ? 'visible' : 'all';
    return { text, rows, filename: `${safeName(symbol)}_${safeName(timeframe)}_${suffix}_bars.csv` };
}
