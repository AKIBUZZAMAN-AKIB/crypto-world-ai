// BAR REFERENCES — a stable way to point at a bar (Tier-3 #12, the model half).
//
// Everything that hangs off "a bar" today stores a NUMBER: an index into `bars`. That is
// fine until the series changes shape under it — a history backfill prepends thousands of
// bars, a range-bar style re-cuts the series, a market switch replaces it — and every
// stored index silently points at a different bar. Time is the durable coordinate; the
// index is a hint that keeps the common case O(1).
//
// A `BarRef` therefore carries BOTH: `time` (authoritative) and an optional `index` (a
// guess). `resolveBarRef` trusts the hint only while it still matches the time, otherwise
// it binary-searches. That is the whole contract — cheap in the steady state, correct
// across any reshape — and it is what a "Bars pattern" drawing or a bar-anchored note
// needs to survive a reload.
import type { OHLCV } from './ohlcv';

export interface BarRef {
    /** The bar's open time — the durable identity. */
    time: number;
    /** Last known index. Only an optimisation: it is re-derived whenever it disagrees. */
    index?: number;
}

/** A half-open window of bars anchored at a reference: `[ref, ref+count)`. */
export interface BarWindow {
    from: BarRef;
    count: number;
}

/** Reference to the bar at `index` (null when the index is out of range). */
export function barRefAt(bars: readonly OHLCV[], index: number): BarRef | null {
    const bar = bars[index];
    if (!bar) return null;
    return { time: bar.time, index };
}

/** Index of `time` in a strictly-increasing time array; -1 when absent. */
export function indexOfTime(bars: readonly OHLCV[], time: number): number {
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = bars[mid]!.time;
        if (t === time) return mid;
        if (t < time) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/**
 * The current index of a reference, or -1 when the bar is gone. The stored hint wins only
 * while it still points at the right time, so a prepend costs one comparison, not a scan.
 */
export function resolveBarRef(bars: readonly OHLCV[], ref: BarRef | null | undefined): number {
    if (!ref) return -1;
    const hinted = typeof ref.index === 'number' ? ref.index : -1;
    if (hinted >= 0 && hinted < bars.length && bars[hinted]!.time === ref.time) return hinted;
    return indexOfTime(bars, ref.time);
}

/** Shift a reference by `delta` bars (a backfill prepended `delta` older bars). */
export function shiftBarRef(ref: BarRef, delta: number): BarRef {
    if (!Number.isFinite(delta) || delta === 0) return ref;
    return { time: ref.time, index: typeof ref.index === 'number' ? Math.max(0, ref.index + delta) : undefined };
}

/**
 * The bars a window covers, clipped to the series. Returns the resolved indices and the
 * bars themselves, so a caller never has to slice twice or guess what was clipped.
 */
export function resolveBarWindow(bars: readonly OHLCV[], win: BarWindow | null | undefined): { from: number; to: number; bars: readonly OHLCV[] } {
    if (!win) return { from: -1, to: -1, bars: [] };
    const start = resolveBarRef(bars, win.from);
    if (start < 0) return { from: -1, to: -1, bars: [] };
    const to = Math.min(bars.length - 1, start + Math.max(0, Math.floor(win.count)) - 1);
    return { from: start, to, bars: bars.slice(start, to + 1) };
}

/** Does this window still have all the bars it was made from? */
export function barWindowIntact(bars: readonly OHLCV[], win: BarWindow): boolean {
    const start = resolveBarRef(bars, win.from);
    return start >= 0 && start + win.count - 1 < bars.length;
}

/** Plain-object form for storage (drops the hint when it is not a number). */
export function serializeBarRef(ref: BarRef): { time: number; index?: number } {
    return typeof ref.index === 'number' && Number.isFinite(ref.index)
        ? { time: ref.time, index: Math.max(0, Math.round(ref.index)) }
        : { time: ref.time };
}

/** Read a ref back from untrusted storage (null when it is not a usable reference). */
export function deserializeBarRef(raw: unknown): BarRef | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { time?: unknown; index?: unknown };
    if (typeof r.time !== 'number' || !Number.isFinite(r.time)) return null;
    const ref: BarRef = { time: r.time };
    if (typeof r.index === 'number' && Number.isFinite(r.index)) ref.index = Math.max(0, Math.round(r.index));
    return ref;
}
