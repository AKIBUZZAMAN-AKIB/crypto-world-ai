import { describe, expect, it } from 'vitest';
import { candlePrices, nearestByPixel } from '../src/renderers/native/core/snap-candidates';

/** A linear price→pixel projector for the price pane (y grows downward). */
const yOf = (v: number): number => 400 - v * 2;

describe('magnet candidates', () => {
    it('offers the four candle prices in OHLC order', () => {
        expect(candlePrices({ open: 10, high: 14, low: 8, close: 12 })).toEqual([10, 14, 8, 12]);
    });

    it('drops a non-finite price instead of poisoning the candidate list', () => {
        expect(candlePrices({ open: 10, high: Number.NaN, low: 8, close: 12 })).toEqual([10, 8, 12]);
        expect(candlePrices(null)).toEqual([]);
    });

    describe('nearest by PIXEL distance', () => {
        it('picks the candle wick under the cursor', () => {
            // cursor at y=372 → price 14 (the high) is 2 px away, the close (12) is 4 px.
            expect(nearestByPixel([10, 14, 8, 12], 372, yOf, 12)).toBe(14);
        });

        it('an indicator value can win, which is the whole point of the toggle', () => {
            // yOf: 14 → 372, 13.9 → 372.2, 12 → 376. Cursor at 373 is 0.8 px from the
            // indicator and 1 px from the wick, so the indicator takes the snap — and it
            // would not exist as a candidate at all with the toggle off.
            expect(nearestByPixel([10, 14, 8, 12], 373, yOf, 12)).toBe(14);
            expect(nearestByPixel([10, 14, 8, 12, 13.9], 373, yOf, 12)).toBe(13.9);
        });

        it('is distance-based, not value-based — a log axis makes the top of the pane tighter', () => {
            // Same two prices, but the projector is now compressive near the top.
            const logY = (v: number): number => 400 - Math.log(v) * 60;
            // cursor near price 10 (y≈261.8): 12 is 34 px above, 9 is 21 px below.
            const cursor = logY(10);
            expect(nearestByPixel([9, 12], cursor, logY, 10)).toBe(9);
            // a value-based metric would have said 12 (|12-10| = |9-10|), so this pins
            // that the pixel distance is what decides.
        });

        it('breaks a dead heat in favour of the earlier candidate (candles first)', () => {
            const flat = (): number => 100;
            expect(nearestByPixel([5, 6, 7], 100, flat, 7)).toBe(5);
        });

        it('skips candidates that cannot be projected, rather than snapping to them', () => {
            const partial = (v: number): number | null => (v === 999 ? null : yOf(v));
            expect(nearestByPixel([999, 10], 380, partial, 12)).toBe(10);
        });

        it('returns the fallback when nothing projects — never NaN', () => {
            expect(nearestByPixel([], 300, yOf, 12)).toBe(12);
            expect(nearestByPixel([1, 2], 300, () => null, 12)).toBe(12);
        });

        it('ignores non-finite candidates', () => {
            expect(nearestByPixel([Number.NaN, Infinity, 10], 380, yOf, 12)).toBe(10);
        });
    });
});
