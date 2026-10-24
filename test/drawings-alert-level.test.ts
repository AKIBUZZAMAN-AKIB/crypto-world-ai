// Per-drawing alerts: the level a drawing sits at over time, and the crossing arithmetic that
// runs against it. The alert engine itself is covered by its own spec; what matters here is
// that a SLOPED line re-reads at every bar instead of freezing the price it was armed at.
import { describe, it, expect } from 'vitest';
import { createDrawing, drawingLevelAt, canAlertOn, type Drawing } from '../src/core/drawings';
import { advanceAlert, type PriceAlert } from '../src/workspace/price-alerts';

const HR = 3600_000;
const at = (time: number, price: number) => ({ time, price });

function alertAt(value: number, extra: Partial<PriceAlert> = {}): PriceAlert {
    return {
        id: 'a1',
        cellId: 'c1',
        symbol: 'BTCUSDT',
        condition: 'cross',
        value,
        frequency: 'once',
        state: 'active',
        createdAt: 0,
        anchorPrice: null,
        bars: 5,
        firedAt: 0,
        fires: 0,
        lineId: '',
        ...extra,
    };
}

describe('drawings/alert level', () => {
    it('a horizontal line is the same level at every bar', () => {
        const d = createDrawing('hline', { id: 'h', paneId: 'price', anchors: [at(5 * HR, 120)] })!;
        expect(drawingLevelAt(d, 0)).toBe(120);
        expect(drawingLevelAt(d, 999 * HR)).toBe(120);
        expect(canAlertOn('hline')).toBe(true);
    });

    it('a horizontal ray has no level before its anchor', () => {
        const d = createDrawing('hray', { id: 'r', paneId: 'price', anchors: [at(10 * HR, 50)] })!;
        expect(drawingLevelAt(d, 9 * HR)).toBeNull();
        expect(drawingLevelAt(d, 10 * HR)).toBe(50);
        expect(drawingLevelAt(d, 11 * HR)).toBe(50);
    });

    it('a trend line interpolates and extrapolates linearly in time', () => {
        const d = createDrawing('trendline', { id: 't', paneId: 'price', anchors: [at(0, 100), at(10 * HR, 120)] })!;
        expect(drawingLevelAt(d, 0)).toBeCloseTo(100, 9);
        expect(drawingLevelAt(d, 5 * HR)).toBeCloseTo(110, 9);
        expect(drawingLevelAt(d, 10 * HR)).toBeCloseTo(120, 9);
        expect(drawingLevelAt(d, 15 * HR)).toBeCloseTo(130, 9); // extended past the second anchor
        expect(drawingLevelAt(d, -5 * HR)).toBeCloseTo(90, 9); // and before the first
    });

    it('a tool with no price over time cannot back an alert', () => {
        const v = createDrawing('vline', { id: 'v', paneId: 'price', anchors: [at(3 * HR, 100)] })!;
        expect(canAlertOn('vline')).toBe(false);
        expect(drawingLevelAt(v, 3 * HR)).toBeNull();
    });

    it('a vertical pair (both anchors on one time) degrades to its first price', () => {
        const d = createDrawing('trendline', { id: 'z', paneId: 'price', anchors: [at(HR, 70), at(HR, 90)] })!;
        expect(drawingLevelAt(d, HR)).toBe(70);
    });

    it('Drawing.levelAt uses the same definition', () => {
        const d = createDrawing('trendline', { id: 'q', paneId: 'price', anchors: [at(0, 100), at(10 * HR, 120)] }) as Drawing;
        expect(d.levelAt(5 * HR)).toBeCloseTo(drawingLevelAt(d, 5 * HR)!, 12);
    });

    it('fires where the LINE is at that bar, not where it was when armed', () => {
        // The line rises 2 per bar: level(t) = 100 + 2t. Armed at t=0 (level 100).
        const line = createDrawing('trendline', { id: 'l', paneId: 'price', anchors: [at(0, 100), at(10 * HR, 120)] })!;
        let alert = alertAt(100);
        const bars: Array<[time: number, price: number]> = [
            [1 * HR, 101], // level 102 → still below, no cross
            [2 * HR, 106], // level 104 → price crosses UP through it
        ];
        let firedAtBar = -1;
        for (const [time, price] of bars) {
            const level = drawingLevelAt(line, time)!;
            const next = advanceAlert({ ...alert, value: level }, { prev: alert.anchorPrice, now: price });
            alert = next.alert;
            if (next.fired) firedAtBar = time;
        }
        expect(firedAtBar).toBe(2 * HR);
        expect(alert.state).toBe('fired');
        // The stored level is the one it actually fired on, so the bell row reads the truth.
        expect(alert.value).toBeCloseTo(104, 9);
    });

    it('stays quiet when the price never reaches the moving line', () => {
        const line = createDrawing('trendline', { id: 'l2', paneId: 'price', anchors: [at(0, 100), at(10 * HR, 150)] })!;
        let alert = alertAt(100);
        for (const [time, price] of [[1 * HR, 99], [2 * HR, 99], [3 * HR, 99]] as Array<[number, number]>) {
            alert = advanceAlert({ ...alert, value: drawingLevelAt(line, time)! }, { prev: alert.anchorPrice, now: price }).alert;
        }
        expect(alert.state).toBe('active');
    });
});
