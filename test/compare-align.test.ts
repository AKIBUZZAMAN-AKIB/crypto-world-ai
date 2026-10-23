// @vitest-environment jsdom
// The Compare study's arithmetic. Two markets rarely share a bar clock, so "align" means
// the value in force at each chart bar (a step, not a zip), and the percent base is the
// first bar that HAS a value — the visible window's left edge, per the reference. Both are
// pure, so they are pinned here without a chart.
import { describe, it, expect } from 'vitest';
import { alignCloses, percentFrom } from '../src/core/native-indicators/compare';

const bar = (time: number, close: number) => ({ time, open: close, high: close, low: close, close, volume: 0 });

describe('compare — cross-market alignment', () => {
    it('carries the last close at or before each chart bar (a step, not a zip)', () => {
        const chart = [100, 200, 300, 400];
        const other = [bar(50, 5), bar(150, 6), bar(250, 7)];
        expect(alignCloses(chart, other)).toEqual([5, 6, 7, 7]);
    });

    it('is null before the other series starts — never a zero', () => {
        const chart = [100, 200, 300];
        const other = [bar(200, 9)];
        expect(alignCloses(chart, other)).toEqual([null, 9, 9]);
    });

    it('a longer other series is clipped to the chart (older bars are ignored)', () => {
        const chart = [300, 400];
        const other = [bar(100, 1), bar(300, 2), bar(500, 3)];
        expect(alignCloses(chart, other)).toEqual([2, 2]);
    });

    it('an empty other series leaves whitespace everywhere', () => {
        expect(alignCloses([1, 2], [])).toEqual([null, null]);
    });
});

describe('compare — percent normalisation', () => {
    it('anchors at the first VALUE, so the line starts at 0', () => {
        const out = percentFrom([null, 100, 110, 90]);
        expect(out[0]).toBeNull();
        expect(out[1]).toBe(0);
        out.slice(2).forEach((v) => expect(typeof v).toBe('number'));
        expect(out[2] as number).toBeCloseTo(10, 9);
        expect(out[3] as number).toBeCloseTo(-10, 9);
    });

    it('a leading gap does not shift the base (the old off-by-one)', () => {
        expect(percentFrom([null, null, 50, 75])).toEqual([null, null, 0, 50]);
    });

    it('nulls stay gaps inside the series', () => {
        expect(percentFrom([10, null, 20])).toEqual([0, null, 100]);
    });

    it('a zero or all-empty series is inert rather than Infinity', () => {
        expect(percentFrom([0, 5])).toEqual([null, null]);
        expect(percentFrom([null, null])).toEqual([null, null]);
    });

    it('non-finite prints are dropped, not plotted', () => {
        expect(percentFrom([10, Number.NaN, 20])).toEqual([0, null, 100]);
    });
});
