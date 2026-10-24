import { describe, expect, it } from 'vitest';
import { lineBreak, rangeBars, renko, kagi, pointFigure, atrSeries, DEFAULT_RENKO, DEFAULT_KAGI } from '../src/core/price-styles/rebucket';
import { atr as indicatorAtr } from '../src/core/native-indicators/classics/math';
import type { OHLCV } from '../src/core/model/ohlcv';

const bar = (t: number, c: number, h = c, l = c): OHLCV => ({ time: t, open: c, high: h, low: l, close: c, volume: 1 });
/** A close-only series on a 1-minute grid. */
const series = (...closes: number[]): OHLCV[] => closes.map((c, i) => bar(i * 60_000, c));

describe('rebucket/Renko', () => {
    const opts = { ...DEFAULT_RENKO, boxSize: 10, atrLength: 0, wicks: false };

    it('prints nothing until the price covers a whole box', () => {
        const out = renko(series(100, 104, 109), opts);
        expect(out).toHaveLength(0);
    });

    it('prints one brick per box travelled, in the direction of travel', () => {
        const out = renko(series(100, 111), opts);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ open: 100, close: 110, high: 110, low: 100 });
    });

    it('a gap prints a RUN of consecutive bricks (not one)', () => {
        const out = renko(series(100, 135), opts);
        expect(out).toHaveLength(3);
        expect(out.map((b) => [b.open, b.close])).toEqual([
            [100, 110],
            [110, 120],
            [120, 130],
        ]);
    });

    it('a reversal needs TWO boxes — one to erase, one to print', () => {
        // up to 120 (two bricks), then back down to 109: only 11 down, not 20 → nothing.
        expect(renko(series(100, 120, 109), opts)).toHaveLength(2);
        // 20 down from the 120 anchor: the reversal brick costs two boxes, then the move
        // continues — 120→110 (the turn) and 110→100 (the continuation).
        const rev = renko(series(100, 120, 100), opts);
        expect(rev).toHaveLength(4);
        expect(rev[2]).toMatchObject({ open: 120, close: 110 });
        expect(rev[3]).toMatchObject({ open: 110, close: 100 });
    });

    it('every brick edge is an exact multiple of the box (the anchor invariant)', () => {
        const out = renko(series(107, 140, 95, 160), opts);
        for (const b of out) {
            expect(Math.abs((b.open / 10) % 1)).toBeLessThan(1e-9);
            expect(Math.abs((b.close / 10) % 1)).toBeLessThan(1e-9);
        }
    });

    it('stamps strictly increasing times so the axis stays a function of index', () => {
        const out = renko(series(100, 135), opts);
        for (let i = 1; i < out.length; i += 1) expect(out[i]!.time).toBeGreaterThan(out[i - 1]!.time);
    });

    it('wicks record the sub-threshold excursion that did NOT print a brick', () => {
        const withWicks = { ...opts, wicks: true };
        // one up brick to 110, then a dip to 95: below the brick's open, nowhere near the
        // 2-box reversal (90) — so no brick prints and the dip becomes the wick.
        const out = renko(series(100, 111, 95), withWicks);
        expect(out).toHaveLength(1);
        expect(out[0]!.low).toBe(95); // the wick
    });

    it('ATR sizing produces a box that scales with volatility', () => {
        const calm = renko(series(...Array.from({ length: 40 }, (_, i) => 100 + i * 0.1)), { ...DEFAULT_RENKO, boxSize: 0, atrLength: 14, atrFactor: 1, wicks: false });
        const wild = renko(Array.from({ length: 40 }, (_, i) => ({ time: i * 60_000, open: 100, high: 100 + i * 5 + 5, low: 95, close: 100 + i * 5, volume: 1 })), {
            ...DEFAULT_RENKO,
            boxSize: 0,
            atrLength: 14,
            atrFactor: 1,
            wicks: false,
        });
        expect(calm.length).toBeGreaterThan(wild.length); // a calm market makes smaller boxes ⇒ more bricks
    });

    it('is deterministic and never mutates the input', () => {
        const raw = series(100, 111, 122, 99, 140);
        const copy = JSON.parse(JSON.stringify(raw)) as OHLCV[];
        expect(renko(raw, opts)).toEqual(renko(raw, opts));
        expect(raw).toEqual(copy);
    });

    it('an empty series yields an empty result, not a throw', () => {
        expect(renko([], opts)).toEqual([]);
    });
});

describe('rebucket/Range bars', () => {
    const opts = { method: 'traditional' as const, range: 10, atrLength: 14, atrFactor: 1, source: 'close' as const };

    it('every bar spans exactly the range', () => {
        const out = rangeBars(series(100, 112, 96, 130), opts);
        for (const b of out) expect(Math.abs(Math.abs(b.close - b.open) - 10)).toBeLessThan(1e-9);
    });

    it('closes at its extreme in the direction of travel', () => {
        const out = rangeBars(series(100, 121), opts);
        expect(out.length).toBe(2);
        expect(out.every((b) => b.close === b.high)).toBe(true);
    });

    it('a reversal bar closes at its LOW', () => {
        const out = rangeBars(series(100, 120, 100), opts);
        const last = out[out.length - 1]!;
        expect(last.close).toBe(last.low);
    });

    it('ignores wicks in close mode and reacts in ohlc mode', () => {
        const raw = [bar(0, 100), bar(60_000, 102, 115, 99)];
        expect(rangeBars(raw, opts)).toHaveLength(0); // close 102 does not span 10
        const ohlc = rangeBars(raw, { ...opts, source: 'ohlc' });
        expect(ohlc.length).toBeGreaterThan(0); // the 115 high does
    });
});

describe('rebucket/Line break', () => {
    it('a 3-line break needs a close above the last three highs', () => {
        // rising closes build lines; each new line must beat the prior three
        const out = lineBreak(series(100, 101, 102, 103, 104, 105), { lines: 3, reverse: false });
        expect(out.length).toBeGreaterThan(0);
        expect(out[0]!.close).toBeGreaterThan(out[0]!.open);
    });

    it('a close that fails to break the last N prints nothing', () => {
        const raw = series(100, 110, 105, 104, 103, 102);
        const out = lineBreak(raw, { lines: 3, reverse: false });
        // after the first up line, a slow drift down that never breaks three lows prints nothing
        expect(out.length).toBeLessThanOrEqual(2);
    });

    it('alternates direction: an up line then a down line', () => {
        const out = lineBreak(series(100, 120, 80, 130), { lines: 1, reverse: false });
        expect(out.length).toBe(3);
        expect([out[0]!.close > out[0]!.open, out[1]!.close < out[1]!.open, out[2]!.close > out[2]!.open]).toEqual([true, true, true]);
    });
});

describe('rebucket/Kagi', () => {
    it('rides a trend in ONE leg and only turns on a reversal', () => {
        // 4% of ~100 ⇒ a 4-point reversal. A steady climb must not print extra legs.
        const out = kagi(series(100, 105, 110, 115), { ...DEFAULT_KAGI, reversalPct: 4 });
        expect(out).toHaveLength(1);
        expect(out[0]!.open).toBe(100);
        expect(out[0]!.close).toBe(115);
    });

    it('turns at the extreme when the price retraces the reversal size', () => {
        const out = kagi(series(100, 120, 110), { ...DEFAULT_KAGI, reversalPct: 4 });
        expect(out).toHaveLength(2);
        expect(out[0]!.close).toBe(120); // the up leg closed at its extreme
        expect(out[1]!.open).toBe(120); // and the down leg opens there
        expect(out[1]!.close).toBe(110); // the forming leg follows the price live
    });

    it('marks a leg YANG only when it breaks the previous same-direction extreme', () => {
        const out = kagi(series(100, 120, 110, 130), { ...DEFAULT_KAGI, reversalPct: 4 });
        expect(out.map((b) => b.styleHint?.yang)).toEqual([false, false, true]);
    });

    it('flags HISTORICAL legs too — thickness is the signal, not a live-tail artifact', () => {
        // 100 → 120 (leg 1, yin: nothing to break yet) → 110 (leg 2, yin: first down leg)
        // → 130 (leg 3, YANG: carries past the 120 high) → 120 (leg 4, yin: 120 holds
        // above the 110 low) → the forming leg (YANG: past the 130 high).
        // `traditional` pins the reversal to 4% of price, so the legs are deterministic
        // (the ATR method would move the turn points with every Wilder update).
        const out = kagi(series(100, 120, 110, 130, 120, 140), { ...DEFAULT_KAGI, method: 'traditional', reversalPct: 4 });
        expect(out.map((b) => b.styleHint?.yang)).toEqual([false, false, true, false, true]);
        // Every leg still reports a real body — the flag must not disturb the geometry.
        for (const b of out) expect(b.open).not.toBe(b.close);
    });

    it('never emits an inverted bar', () => {
        for (const b of kagi(series(100, 130, 90, 140, 80), { ...DEFAULT_KAGI, reversalPct: 2 })) {
            expect(b.low).toBeLessThanOrEqual(b.open);
            expect(b.high).toBeGreaterThanOrEqual(b.open);
            expect(b.high).toBeGreaterThanOrEqual(b.close);
            expect(b.low).toBeLessThanOrEqual(b.close);
        }
    });
});

describe('rebucket/Point & figure', () => {
    const opts = { boxMethod: 'traditional' as const, boxSize: 10, atrLength: 14, atrFactor: 1, reversal: 3, source: 'close' as const };

    it('a rise fills whole boxes into one X column', () => {
        const out = pointFigure(series(100, 145), opts);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ open: 100, close: 140, low: 100, high: 140 });
        expect(out[0]!.styleHint).toMatchObject({ box: 10, mark: 'x' });
    });

    it('a small pullback prints NOTHING (the 3-box rule)', () => {
        const out = pointFigure(series(100, 140, 115), opts);
        expect(out).toHaveLength(1); // 25 back < 3 boxes
    });

    it('a full reversal opens an O column of the reversal size', () => {
        const out = pointFigure(series(100, 140, 100), opts);
        expect(out).toHaveLength(2);
        expect(out[1]!.styleHint?.mark).toBe('o');
        expect(out[1]!.high - out[1]!.low).toBeGreaterThanOrEqual(30);
        expect(out[1]!.high).toBe(130); // one box below the top of the X column
    });

    it('every column edge sits on the box grid', () => {
        for (const b of pointFigure(series(100, 137, 91, 168), opts)) {
            for (const v of [b.open, b.close, b.high, b.low]) expect(Math.abs((v / 10) % 1)).toBeLessThan(1e-9);
        }
    });

    it('alternates X and O', () => {
        const marks = pointFigure(series(100, 140, 90, 150, 80), opts).map((b) => b.styleHint?.mark);
        for (let i = 1; i < marks.length; i += 1) expect(marks[i]).not.toBe(marks[i - 1]);
    });
});

describe('rebucket/ATR sizing', () => {
    // The chart types scale their boxes with volatility. That number has to be the ATR the
    // ATR study prints — this used to be an SMA of true range, ~3% off both the study and
    // the reference, so every volatility-scaled chart was cut on a slightly different grid.
    const bars: OHLCV[] = Array.from({ length: 80 }, (_, i) => {
        const base = 100 + Math.sin(i / 7) * 6 + i * 0.4;
        return { time: i * 60_000, open: base - 0.8, high: base + 1.6, low: base - 1.9, close: base + 0.3, volume: 10 };
    });

    it('matches the ATR study (Wilder RMA) bar for bar after the warm-up', () => {
        const theirs = indicatorAtr(bars, 14);
        const ours = atrSeries(bars, 14);
        for (let i = 14; i < bars.length; i += 1) expect(ours[i]!).toBeCloseTo(theirs[i]!, 10);
    });

    it('is seeded with the SMA of the first window, exactly like the study', () => {
        const theirs = indicatorAtr(bars, 14);
        const ours = atrSeries(bars, 14);
        expect(ours[13]!).toBeCloseTo(theirs[13]!, 10);
        expect(ours[0]!).toBeGreaterThan(0); // warm-up stays usable (a chart cannot start late)
    });
});
