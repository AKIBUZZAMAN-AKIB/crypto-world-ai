import { describe, expect, it } from 'vitest';
import {
    barRefAt, barWindowIntact, deserializeBarRef, indexOfTime, resolveBarRef, resolveBarWindow, serializeBarRef, shiftBarRef,
} from '../src/core/model/bar-ref';
import type { OHLCV } from '../src/core/model/ohlcv';

const series = (n: number, start = 0): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: (start + i) * 60_000, open: 1, high: 2, low: 0, close: 1, volume: 1 }));

describe('bar-ref/resolve', () => {
    it('finds a bar by time without the hint', () => {
        const bars = series(5);
        expect(resolveBarRef(bars, { time: 2 * 60_000 })).toBe(2);
    });

    it('SURVIVES A PREPEND: the time still resolves, the stale index does not', () => {
        const before = series(5);
        const ref = barRefAt(before, 3)!;
        const after = [...series(100, -100), ...before]; // 100 older bars arrive
        expect(resolveBarRef(after, ref)).toBe(103);
    });

    it('returns -1 for a bar that is gone, never a wrong bar', () => {
        const bars = series(3);
        expect(resolveBarRef(bars, { time: 99 * 60_000 })).toBe(-1);
        expect(resolveBarRef(bars, null)).toBe(-1);
    });

    it('binary-searches a long series (and finds the ends)', () => {
        const bars = series(5000);
        expect(indexOfTime(bars, 0)).toBe(0);
        expect(indexOfTime(bars, 4999 * 60_000)).toBe(4999);
        expect(indexOfTime(bars, 1234 * 60_000)).toBe(1234);
    });

    it('shifts a ref by a known delta', () => {
        expect(shiftBarRef({ time: 5, index: 5 }, 100)).toEqual({ time: 5, index: 105 });
        expect(shiftBarRef({ time: 5 }, 100)).toEqual({ time: 5, index: undefined });
    });
});

describe('bar-ref/window', () => {
    it('resolves a window to its bars, clipped at the end of the series', () => {
        const bars = series(10);
        const win = { from: barRefAt(bars, 7)!, count: 5 };
        const r = resolveBarWindow(bars, win);
        expect(r.from).toBe(7);
        expect(r.to).toBe(9);
        expect(r.bars).toHaveLength(3);
    });

    it('reports whether a stored window still has all its bars', () => {
        const bars = series(10);
        const win = { from: barRefAt(bars, 4)!, count: 3 };
        expect(barWindowIntact(bars, win)).toBe(true);
        expect(barWindowIntact(series(6), win)).toBe(false);
    });
});

describe('bar-ref/storage', () => {
    it('round-trips through the untrusted reader', () => {
        expect(deserializeBarRef(serializeBarRef({ time: 7, index: 3 }))).toEqual({ time: 7, index: 3 });
        expect(deserializeBarRef({ time: 7 })).toEqual({ time: 7 });
    });

    it('drops garbage instead of storing NaN', () => {
        expect(deserializeBarRef(null)).toBeNull();
        expect(deserializeBarRef({ time: 'x' })).toBeNull();
        expect(deserializeBarRef({ time: Infinity })).toBeNull();
        expect(serializeBarRef({ time: 7, index: Number.NaN })).toEqual({ time: 7 });
    });
});
