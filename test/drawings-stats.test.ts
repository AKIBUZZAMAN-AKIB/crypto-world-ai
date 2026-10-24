// The "Stats" readout every two-point drawing can carry, and the look-clipboard behind the
// popup's Copy style / Paste style pair. Both are data-level behaviours, so they are pinned
// here without a canvas: the painter only formats and places what these functions return.
import { describe, it, expect } from 'vitest';
import { createDrawing, computeDrawingStats, hasStats, statsEnabled, deserializeDrawing, type Drawing, type Projector } from '../src/core/drawings';

/** x = time in hours, y = 100 − price (so a rising price is a smaller y). */
function proj(barsBetween?: (a: number, b: number) => number): Projector {
    const HR = 3600_000;
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 400,
        height: 200,
        barsBetween: barsBetween ?? ((a, b) => Math.abs(b - a) / HR),
    };
}

const at = (time: number, price: number) => ({ time, price });
const HR = 3600_000;

describe('drawings/stats', () => {
    it('measures range, percent, bars, time and angle from the first and last anchor', () => {
        const d = createDrawing('trendline', { id: 'a', paneId: 'price', anchors: [at(0, 90), at(48 * HR, 110)] })!;
        const s = computeDrawingStats(d, proj())!;
        expect(s.priceRange).toBeCloseTo(20, 9);
        expect(s.percent).toBeCloseTo((20 / 90) * 100, 9);
        expect(s.bars).toBe(48);
        expect(s.timeMs).toBe(48 * HR);
        expect(s.up).toBe(true);
        // y = 100 − price, so price 90 → y 10 and price 110 → y −10: a RISE of 20px over
        // 48px of travel is atan(20/48) ≈ 22.62°.
        expect(s.angle).toBeCloseTo((Math.atan2(20, 48) * 180) / Math.PI, 6);
    });

    it('reports a fall as a negative angle and a negative percent', () => {
        const d = createDrawing('trendline', { id: 'b', paneId: 'price', anchors: [at(0, 110), at(24 * HR, 100)] })!;
        const s = computeDrawingStats(d, proj())!;
        expect(s.percent).toBeLessThan(0);
        expect(s.angle).toBeCloseTo((-Math.atan2(10, 24) * 180) / Math.PI, 6);
        expect(s.up).toBe(false);
    });

    it('has nothing to measure on a single-anchor stamp', () => {
        const d = createDrawing('note', { id: 'c', paneId: 'price', anchors: [at(0, 100)] })!;
        expect(hasStats(d)).toBe(false);
        expect(computeDrawingStats(d, proj())).toBeNull();
    });

    it('counts no bars when the projector has no series access', () => {
        const d = createDrawing('trendline', { id: 'd', paneId: 'price', anchors: [at(0, 90), at(5 * HR, 95)] })!;
        const noSeries: Projector = { ...proj(), barsBetween: undefined };
        expect(computeDrawingStats(d, noSeries)!.bars).toBe(0);
    });

    it('is off until a stat is switched on', () => {
        const d = createDrawing('trendline', { id: 'e', paneId: 'price', anchors: [at(0, 90), at(HR, 95)] })!;
        expect(statsEnabled(d.style.stats)).toBe(false);
        d.applySettings({ 'style.stats.range': true });
        expect(statsEnabled(d.style.stats)).toBe(true);
    });

    it('round-trips the stats bag through serialization', () => {
        const d = createDrawing('trendline', { id: 'f', paneId: 'price', anchors: [at(0, 90), at(HR, 95)] })!;
        d.applySettings({ 'style.stats.percent': true, 'style.stats.always': true });
        const back = deserializeDrawing(d.serialize())!;
        expect(back.style.stats).toEqual({ percent: true, always: true });
    });

    it('never lets two drawings share one stats bag (no aliasing on clone)', () => {
        const d = createDrawing('trendline', { id: 'g', paneId: 'price', anchors: [at(0, 90), at(HR, 95)] })!;
        d.applySettings({ 'style.stats.range': true });
        // A clone goes through serialize → deserialize, exactly as Ctrl-drag and undo do.
        const copy = deserializeDrawing(d.serialize()) as Drawing;
        copy.applySettings({ 'style.stats.angle': true });
        expect(d.style.stats).toEqual({ range: true }); // the source is untouched
        expect(copy.style.stats).toEqual({ range: true, angle: true });
    });
});
