// RE-BUCKETING price styles — Renko, Range bars and Line break.
//
// Everything above this file is a 1:1 bar transform (Heikin Ashi): N raw bars in, N view
// bars out, same times. These three are different in kind — they DISCARDS time and emit a
// variable number of bars, so they cannot ride `BarTransform` (which maps index→index and
// whose live path is O(1) per tick). They share one narrow contract instead:
//
//     rebucket(raw) → OHLCV[]
//
// and the orchestrator swaps the view wholesale. That is affordable because the result is
// small by construction: a brick holds a whole price move, so a 5,000-bar day becomes a few
// hundred bricks, and a rebuild is cheaper than a repaint.
//
// TIME. A derived bar still needs a coordinate, and the renderer's axis is time-based, so
// every derived bar is stamped with the time of the RAW bar that completed it. Several
// bricks can complete on one raw bar; those get +1 ms each, which keeps the series strictly
// increasing (the renderer dedupes equal times) and is invisible at any realistic zoom.
// `srcTime`/the anchor rate are untouched — the axis keeps showing real dates.

import type { OHLCV } from '../model/ohlcv';

/** A style that rebuilds the price series instead of transforming it bar-by-bar. */
export interface BarRebucket {
    /**
     * Derive the whole derived series from the raw series. Deterministic.
     * `settings` is the type's persisted bag (`config.chartTypes[id]`) — the same values
     * its settings section edits; an entry parses ONLY what it owns and ignores the rest.
     */
    full(raw: readonly OHLCV[], settings?: Readonly<Record<string, unknown>>): OHLCV[];
}

/** Coerce an untrusted settings bag field. */
function numOf(v: unknown, d: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function strOf<T extends string>(v: unknown, options: readonly T[], d: T): T {
    return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : d;
}

/** The settings bag → Renko options (unknown keys and bad values fall back to defaults). */
export function renkoOptionsFrom(settings?: Readonly<Record<string, unknown>>): RenkoOptions {
    const s = settings ?? {};
    const method = strOf(s.boxMethod, ['atr', 'traditional'] as const, 'atr');
    return {
        boxSize: Math.max(0, numOf(s.boxSize, 0)),
        atrLength: method === 'atr' ? Math.max(1, Math.round(numOf(s.atrLength, 14))) : 0,
        atrFactor: Math.max(0.1, numOf(s.atrFactor, 1)),
        source: strOf(s.source, ['close', 'ohlc'] as const, 'close'),
        wicks: s.wicks !== false,
    };
}

/** Stamp derived bars: monotonic times taken from the source bar that completed them. */
function stamp(out: OHLCV[], bar: Omit<OHLCV, 'time'>, sourceTime: number): void {
    const prev = out[out.length - 1];
    const time = prev && sourceTime <= prev.time ? prev.time + 1 : sourceTime;
    out.push({ ...bar, time });
}

// ── Renko ────────────────────────────────────────────────────────────────────
//
// The rule, from the reference's own documentation: to add a brick in the SAME direction
// the price must travel one box beyond the last brick; to REVERSE it must travel TWO boxes
// (one to erase the last brick, one to print the other colour). A move that crosses the
// last brick's level but not far enough to print is exactly what a WICK records — high
// wicks only on down bricks, low wicks only on up bricks.
export interface RenkoOptions {
    /** Box size in price units. Ignored when `atrLength > 0`. */
    boxSize: number;
    /** ATR length for a volatility-scaled box; 0 = traditional fixed size. */
    atrLength: number;
    /** ATR multiplier (reference default 1). */
    atrFactor: number;
    /** `close` = the reference's default; `ohlc` also reacts to the bar's high/low. */
    source: 'close' | 'ohlc';
    /** Record sub-threshold excursions as wicks (on by default, as on the reference). */
    wicks: boolean;
}

export const DEFAULT_RENKO: RenkoOptions = { boxSize: 0, atrLength: 14, atrFactor: 1, source: 'close', wicks: true };

/** Wilder ATR over the raw series (a plain running average of true range). */
function atrSeries(raw: readonly OHLCV[], length: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < raw.length; i += 1) {
        const b = raw[i]!;
        const prevClose = raw[i - 1]?.close ?? b.open;
        const tr = Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
        sum += tr;
        if (i >= length) {
            const old = raw[i - length]!;
            const oldPrev = raw[i - length - 1]?.close ?? old.open;
            sum -= Math.max(old.high - old.low, Math.abs(old.high - oldPrev), Math.abs(old.low - oldPrev));
        }
        out.push(sum / Math.min(i + 1, length));
    }
    return out;
}

/**
 * Renko bricks.
 *
 * The first brick is anchored at the first bar's close rounded DOWN to a box multiple, so
 * brick edges are always exact multiples of the box — the property the reference describes
 * ("bricks' open and close are synthetic and always divisible by the box size"), which is
 * why two screenshots of the same symbol line up.
 */
export function renko(raw: readonly OHLCV[], opts: RenkoOptions = DEFAULT_RENKO): OHLCV[] {
    if (raw.length === 0) return [];
    const atr = opts.atrLength > 0 ? atrSeries(raw, opts.atrLength) : null;
    const out: OHLCV[] = [];
    let box = 0;
    let anchor = 0; // last brick's close, always on a box multiple
    let dir = 1; // 1 = last brick was up, -1 = down
    let started = false;
    // The forming brick's extreme, so a wick can be attached to the brick it belongs to.
    let pendingHigh = -Infinity;
    let pendingLow = Infinity;

    const boxAt = (i: number): number => {
        if (atr) {
            const a = (atr[i] ?? 0) * (opts.atrFactor > 0 ? opts.atrFactor : 1);
            if (a > 0) return a;
        }
        return opts.boxSize > 0 ? opts.boxSize : estimateBox(raw);
    };

    for (let i = 0; i < raw.length; i += 1) {
        const b = raw[i]!;
        const size = boxAt(i);
        if (!(size > 0)) continue;
        if (!started) {
            box = size;
            anchor = Math.round(b.close / box) * box;
            started = true;
            pendingHigh = b.high;
            pendingLow = b.low;
            continue;
        }
        // A box change (ATR mode) is absorbed by re-anchoring the NEXT brick to the new grid;
        // the brick already printed keeps its geometry, which is what the reference does.
        box = size;
        const up = opts.source === 'ohlc' ? b.high : b.close;
        const down = opts.source === 'ohlc' ? b.low : b.close;

        // Sub-threshold excursions become the wick of the brick that is already printed.
        if (opts.wicks && out.length > 0) {
            const last = out[out.length - 1]!;
            if (dir > 0) {
                // an up brick: a push below its open that did not reverse
                if (down < last.open) last.low = Math.min(last.low, down);
                last.high = Math.max(last.high, Math.min(up, last.close));
            } else {
                if (up > last.open) last.high = Math.max(last.high, up);
                last.low = Math.min(last.low, Math.max(down, last.close));
            }
        }
        pendingHigh = b.high;
        pendingLow = b.low;

        // Print every whole brick this bar covers, in order (a gap-up prints a run).
        // A brick IN the current direction needs one box; a brick AGAINST it needs two —
        // one to undo the last brick, one to print the other colour (the reference's own
        // reversal rule, and the reason every turn costs 2 × box). The trigger is
        // recomputedevery iteration because a gap moves the anchor inside this loop.
        let guard = 0;
        while (guard++ < 10_000) {
            const upTrigger = dir > 0 ? anchor + box : anchor + 2 * box;
            const downTrigger = dir < 0 ? anchor - box : anchor - 2 * box;
            if (up >= upTrigger) {
                const from = anchor;
                const to = anchor + box;
                stamp(out, { open: from, high: opts.wicks ? Math.max(to, Math.min(up, to)) : to, low: opts.wicks ? Math.min(from, Math.max(down, from)) : from, close: to, volume: 0 }, b.time);
                anchor = to;
                dir = 1;
                continue;
            }
            if (down <= downTrigger) {
                const from = anchor;
                const to = anchor - box;
                stamp(out, { open: from, high: opts.wicks ? Math.max(from, up) : from, low: opts.wicks ? Math.min(to, down) : to, close: to, volume: 0 }, b.time);
                anchor = to;
                dir = -1;
                continue;
            }
            break;
        }
    }
    void pendingHigh;
    void pendingLow;
    return out;
}

/** A sensible default box when the user has not set one: ~1/20th of price, like the guide says. */
function estimateBox(raw: readonly OHLCV[]): number {
    const mid = raw[Math.floor(raw.length / 2)]?.close ?? raw[0]?.close ?? 1;
    return mid > 0 ? mid / 20 : 1;
}

// ── Range bars ──────────────────────────────────────────────────────────────
//
// Each bar spans exactly `range` in price and closes at its extreme: an up bar runs from
// its open up to open+range, a down bar from open down to open-range. Direction flips only
// when price travels a full range the other way — which is what makes a range chart show
// equal-height bars and no time axis worth reading.
export interface RangeBarsOptions {
    /** `atr` scales the bar height with volatility; `traditional` is a fixed size. */
    method: 'atr' | 'traditional';
    /** Bar height in price units (traditional only). 0 ⇒ 1/20th of price. */
    range: number;
    atrLength: number;
    atrFactor: number;
    /** `close` (reference default) or `ohlc` (reacts to wicks). */
    source: 'close' | 'ohlc';
}

export const DEFAULT_RANGE_BARS: RangeBarsOptions = { method: 'atr', range: 0, atrLength: 14, atrFactor: 1, source: 'close' };

/** The settings bag → range-bar options. */
export function rangeOptionsFrom(settings?: Readonly<Record<string, unknown>>): RangeBarsOptions {
    const s = settings ?? {};
    return {
        method: strOf(s.method, ['atr', 'traditional'] as const, 'atr'),
        range: Math.max(0, numOf(s.range, 0)),
        atrLength: Math.max(1, Math.round(numOf(s.atrLength, 14))),
        atrFactor: Math.max(0.1, numOf(s.atrFactor, 1)),
        source: strOf(s.source, ['close', 'ohlc'] as const, 'close'),
    };
}

/** The settings bag → line-break options. */
export function lineBreakOptionsFrom(settings?: Readonly<Record<string, unknown>>): LineBreakOptions {
    const s = settings ?? {};
    return { lines: Math.min(10, Math.max(1, Math.round(numOf(s.lines, 3)))), reverse: s.reverse === true };
}

export function rangeBars(raw: readonly OHLCV[], opts: RangeBarsOptions = DEFAULT_RANGE_BARS): OHLCV[] {
    if (raw.length === 0) return [];
    const atr = opts.method === 'atr' ? atrSeries(raw, opts.atrLength) : null;
    const fixed = opts.range > 0 ? opts.range : estimateBox(raw);
    /** The size the OPEN bar was cut at — held for the whole bar, so it stays a rectangle. */
    let size = fixed;
    const out: OHLCV[] = [];
    let open = raw[0]!.close;
    let hi = open;
    let lo = open;

    /** Extend the forming bar toward `price`; print every full range it covers. */
    const push = (price: number, time: number): void => {
        hi = Math.max(hi, price);
        lo = Math.min(lo, price);
        let guard = 0;
        while (guard++ < 10_000) {
            if (hi - open >= size) {
                const close = open + size;
                stamp(out, { open, high: close, low: open, close, volume: 0 }, time);
                open = close;
                lo = open; // the dip below this level was consumed by the move up
                continue;
            }
            if (open - lo >= size) {
                const close = open - size;
                stamp(out, { open, high: open, low: close, close, volume: 0 }, time);
                open = close;
                hi = open;
                continue;
            }
            break;
        }
    };

    for (let i = 0; i < raw.length; i += 1) {
        const b = raw[i]!;
        if (atr) {
            const v = (atr[i] ?? 0) * opts.atrFactor;
            if (v > 0) size = v;
        }
        // The intrabar path a range bar has to assume: price reaches the extreme in the
        // direction of the bar FIRST, then the other side, then closes. (There is no tick
        // data here; this is the convention every OHLC-based range chart uses.)
        const rising = b.close >= b.open;
        if (opts.source === 'ohlc') {
            for (const p of rising ? [b.high, b.low, b.close] : [b.low, b.high, b.close]) push(p, b.time);
        } else {
            push(b.close, b.time);
        }
    }
    return out;
}

// ── Line break ──────────────────────────────────────────────────────────────
//
// The N-line break: a white line prints only when the close exceeds the HIGH of the last
// N lines, a black line only when it breaks below the LOW of the last N. Until then nothing
// prints — which is why a line-break chart has fewer, cleaner bars than a time chart.
export interface LineBreakOptions {
    /** How many lines must be broken (reference default 3). */
    lines: number;
    /** Draw the new line's body wide (a "thick" break) — reserved for theme parity. */
    reverse: boolean;
}

export const DEFAULT_LINE_BREAK: LineBreakOptions = { lines: 3, reverse: false };

export function lineBreak(raw: readonly OHLCV[], opts: LineBreakOptions = DEFAULT_LINE_BREAK): OHLCV[] {
    if (raw.length === 0) return [];
    const n = Math.max(1, Math.round(opts.lines) || 3);
    const out: OHLCV[] = [];
    let high = raw[0]!.close;
    let low = raw[0]!.close;
    for (const b of raw) {
        const c = b.close;
        const recent = out.slice(-n);
        const highN = recent.length === n ? Math.max(...recent.map((x) => x.high)) : high;
        const lowN = recent.length === n ? Math.min(...recent.map((x) => x.low)) : low;
        if (c > highN) {
            stamp(out, { open: highN, high: c, low: highN, close: c, volume: 0 }, b.time);
            high = c;
            low = highN;
        } else if (c < lowN) {
            stamp(out, { open: lowN, high: lowN, low: c, close: c, volume: 0 }, b.time);
            high = lowN;
            low = c;
        }
    }
    // The first line: without one, a series that never breaks shows nothing at all.
    if (out.length === 0 && raw.length > 1) {
        const b = raw[raw.length - 1]!;
        stamp(out, { open: raw[0]!.close, high: Math.max(raw[0]!.close, b.close), low: Math.min(raw[0]!.close, b.close), close: b.close, volume: 0 }, b.time);
    }
    return out;
}

// ── Kagi ────────────────────────────────────────────────────────────────────
//
// A Kagi chart is a single continuous line that only turns when price retraces by the
// reversal amount. Each leg is one "line": drawn from where the last one ended to the
// extreme reached, THICK (yang) when it breaks beyond the previous same-direction
// extreme and thin (yin) otherwise. The forming leg is re-emitted on every bar, so the
// newest leg grows with the price exactly as the reference's live chart does.
export interface KagiOptions {
    /** Reversal in price units; 0 disables the fixed size. */
    reversal: number;
    /** Reversal as a percentage of price (reference default 4%). */
    reversalPct: number;
    /** `traditional` = the percentage above; `atr` = ATR × multiplier. */
    method: 'traditional' | 'atr';
    atrLength: number;
    atrFactor: number;
    /** `close` (reference default) or `ohlc` extremes. */
    source: 'close' | 'ohlc';
}

export const DEFAULT_KAGI: KagiOptions = { reversal: 0, reversalPct: 4, method: 'atr', atrLength: 14, atrFactor: 1, source: 'close' };

export function kagiOptionsFrom(settings?: Readonly<Record<string, unknown>>): KagiOptions {
    const s = settings ?? {};
    return {
        reversal: Math.max(0, numOf(s.reversal, 0)),
        reversalPct: Math.max(0.01, numOf(s.reversalPct, 4)),
        method: strOf(s.method, ['traditional', 'atr'] as const, 'atr'),
        atrLength: Math.max(1, Math.round(numOf(s.atrLength, 14))),
        atrFactor: Math.max(0.1, numOf(s.atrFactor, 1)),
        source: strOf(s.source, ['close', 'ohlc'] as const, 'close'),
    };
}

interface KagiLeg {
    open: number;
    close: number;
    high: number;
    low: number;
    time: number;
    dir: 1 | -1;
}

export function kagi(raw: readonly OHLCV[], opts: KagiOptions = DEFAULT_KAGI): OHLCV[] {
    if (raw.length === 0) return [];
    const atr = opts.method === 'atr' ? atrSeries(raw, opts.atrLength) : null;
    const legs: KagiLeg[] = [];
    let dir: 1 | -1 | 0 = 0;
    let start = raw[0]!.close;
    let ext = start;
    let extHigh = start;
    let extLow = start;
    let startTime = raw[0]!.time;
    let prevUpExtreme = -Infinity;
    let prevDownExtreme = Infinity;

    const close = (time: number): void => {
        if (dir === 0 || ext === start) return;
        const d: 1 | -1 = dir as 1 | -1;
        legs.push({ open: start, close: ext, high: Math.max(start, ext), low: Math.min(start, ext), time, dir: d });
        if (d > 0) prevUpExtreme = Math.max(prevUpExtreme, ext);
        else prevDownExtreme = Math.min(prevDownExtreme, ext);
    };

    for (let i = 0; i < raw.length; i += 1) {
        const b = raw[i]!;
        const up = opts.source === 'ohlc' ? b.high : b.close;
        const down = opts.source === 'ohlc' ? b.low : b.close;
        const price = b.close;
        const size = atr ? (atr[i] ?? 0) * opts.atrFactor : (opts.reversal > 0 ? opts.reversal : (Math.abs(price) * opts.reversalPct) / 100);
        if (!(size > 0)) continue;
        extHigh = Math.max(extHigh, up);
        extLow = Math.min(extLow, down);
        if (dir === 0) {
            dir = price >= start ? 1 : -1;
            ext = price;
            continue;
        }
        if (dir > 0) {
            if (up > ext) {
                ext = up;
                continue;
            }
            if (down <= ext - size) {
                // Turn: the leg closes at its extreme, the next one opens there.
                close(b.time);
                dir = -1;
                start = ext;
                startTime = b.time;
                ext = down;
                extHigh = extLow = down;
                continue;
            }
        } else {
            if (down < ext) {
                ext = down;
                continue;
            }
            if (up >= ext + size) {
                close(b.time);
                dir = 1;
                start = ext;
                startTime = b.time;
                ext = up;
                extHigh = extLow = up;
                continue;
            }
        }
    }
    // The forming leg is always visible (the live tail of the line).
    const last = raw[raw.length - 1]!;
    if (dir !== 0 && ext !== start) {
        const d = dir as 1 | -1;
        const yang = d > 0 ? ext > prevUpExtreme : ext < prevDownExtreme;
        legs.push({ open: start, close: ext, high: Math.max(start, ext), low: Math.min(start, ext), time: last.time, dir: d, ...(yang ? { yang: true } : {}) } as KagiLeg);
    }
    void startTime;
    return legs.map((l) => ({
        time: l.time,
        open: l.open,
        high: l.high,
        low: l.low,
        close: l.close,
        volume: 0,
        styleHint: { yang: (l as KagiLeg & { yang?: boolean }).yang === true },
    }));
}

// ── Point & figure ──────────────────────────────────────────────────────────
//
// Columns of X (rising) and O (falling). A column grows one box at a time while the
// price keeps moving its way; it reverses only after the price travels `reversal` boxes
// back — the reference's default is 3, which is why P&F ignores small pullbacks.
// Each emitted bar IS one column: open/close are its price ends and `styleHint.box`
// carries the box size the glyph painter stacks glyphs by.
export interface PointFigureOptions {
    /** `atr` (reference default) scales the box with volatility; `traditional` is fixed. */
    boxMethod: 'atr' | 'traditional';
    /** Box size in price units (traditional only; 0 ⇒ 1/20th of price). */
    boxSize: number;
    atrLength: number;
    atrFactor: number;
    /** Boxes of adverse travel required to start a new column (default 3). */
    reversal: number;
    source: 'close' | 'ohlc';
}

export const DEFAULT_POINT_FIGURE: PointFigureOptions = { boxMethod: 'atr', boxSize: 0, atrLength: 14, atrFactor: 1, reversal: 3, source: 'close' };

export function pointFigureOptionsFrom(settings?: Readonly<Record<string, unknown>>): PointFigureOptions {
    const s = settings ?? {};
    return {
        boxMethod: strOf(s.boxMethod, ['atr', 'traditional'] as const, 'atr'),
        boxSize: Math.max(0, numOf(s.boxSize, 0)),
        atrLength: Math.max(1, Math.round(numOf(s.atrLength, 14))),
        atrFactor: Math.max(0.1, numOf(s.atrFactor, 1)),
        reversal: Math.min(20, Math.max(1, Math.round(numOf(s.reversal, 3)))),
        source: strOf(s.source, ['close', 'ohlc'] as const, 'close'),
    };
}

export function pointFigure(raw: readonly OHLCV[], opts: PointFigureOptions = DEFAULT_POINT_FIGURE): OHLCV[] {
    if (raw.length === 0) return [];
    const atr = opts.boxMethod === 'atr' ? atrSeries(raw, opts.atrLength) : null;
    const fallback = opts.boxSize > 0 ? opts.boxSize : estimateBox(raw);
    /** The box a column is built on: fixed for the whole column, so its grid never shifts
     *  under the glyphs once printed (ATR only picks the grid at the column's START). */
    const boxAt = (i: number): number => {
        if (!atr) return fallback;
        const v = (atr[i] ?? 0) * opts.atrFactor;
        return v > 0 ? v : fallback;
    };
    const rev = Math.max(1, opts.reversal);
    const out: OHLCV[] = [];
    let mark: 'x' | 'o' | null = null;
    let lo = 0;
    let hi = 0;
    let box = boxAt(0);
    let startTime = raw[0]!.time;
    let base = Math.floor(raw[0]!.close / box) * box;

    const write = (): void => {
        const bar: OHLCV = { time: startTime, open: lo, high: hi, low: lo, close: hi, volume: 0, styleHint: { box, mark: mark! } };
        if (out.length > 0 && out[out.length - 1]!.time === startTime) out[out.length - 1] = bar;
        else out.push(bar);
    };

    for (let i = 0; i < raw.length; i += 1) {
        const b = raw[i]!;
        const up = opts.source === 'ohlc' ? b.high : b.close;
        const down = opts.source === 'ohlc' ? b.low : b.close;
        if (mark === null) {
            // The first column takes whichever side covers a whole box first.
            if (Math.floor(up / box) * box > base) {
                lo = base;
                hi = Math.floor(up / box) * box;
                mark = 'x';
                write();
            } else if (Math.ceil(down / box) * box < base) {
                hi = base;
                lo = Math.ceil(down / box) * box;
                mark = 'o';
                write();
            }
            continue;
        }
        if (mark === 'x') {
            const want = Math.floor(up / box) * box;
            if (want > hi) {
                hi = want;
                write();
                continue;
            }
            if ((hi - down) / box >= rev) {
                box = boxAt(i);
                startTime = b.time;
                hi = hi - box;
                lo = Math.ceil(down / box) * box;
                if (lo > hi - box) lo = hi - box;
                mark = 'o';
                write();
            }
        } else {
            const want = Math.ceil(down / box) * box;
            if (want < lo) {
                lo = want;
                write();
                continue;
            }
            if ((up - lo) / box >= rev) {
                box = boxAt(i);
                startTime = b.time;
                lo = lo + box;
                hi = Math.floor(up / box) * box;
                if (hi < lo + box) hi = lo + box;
                mark = 'x';
                write();
            }
        }
    }
    void base;
    return out;
}
