import { describe, it, expect } from 'vitest';
import { timeframeToMs } from '../src/data/timeframe';
import { normalizeTf } from '../src/data/providers/binance/BinanceProvider';
import { timeframeMs as widgetTfMs } from '../src/widget/timeframe';

// Seconds resolutions are the one place the timeframe string's CASE is load-bearing:
// `15S` is fifteen SECONDS, `15s` is an accepted alias of it, and a bare `15` is minutes.
describe('seconds timeframes', () => {
    it('parses NS as N seconds and keeps bare numbers as minutes', () => {
        expect(timeframeToMs('1S')).toBe(1_000);
        expect(timeframeToMs('15S')).toBe(15_000);
        expect(timeframeToMs('30s')).toBe(30_000); // alias, any case
        expect(timeframeToMs('15')).toBe(15 * 60_000);
        expect(timeframeToMs('60')).toBe(3_600_000);
    });

    it('leaves the named periods alone', () => {
        expect(timeframeToMs('D')).toBe(86_400_000);
        expect(timeframeToMs('W')).toBe(604_800_000);
        expect(timeframeToMs('M')).toBe(2_592_000_000); // month, not minutes
    });

    it('normalizes second aliases to the canonical NS key', () => {
        expect(normalizeTf('15s')).toBe('15S');
        expect(normalizeTf('15S')).toBe('15S');
        expect(normalizeTf('1h')).toBe('60');
        expect(normalizeTf('240')).toBe('240');
    });
});

// Months vs minutes: `M` is a MONTH, `m` is a minute. This used to resolve `3M` to three
// minutes — silent, and exported as public API.
describe('month and year resolutions', () => {
    it('reads M/mo as months and keeps m as minutes', () => {
        expect(timeframeToMs('M')).toBe(2_592_000_000);
        expect(timeframeToMs('3M')).toBe(3 * 2_592_000_000);
        expect(timeframeToMs('1mo')).toBe(2_592_000_000);
        expect(timeframeToMs('3m')).toBe(180_000);
        expect(timeframeToMs('12M')).toBe(12 * 2_592_000_000);
    });

    it('accepts years, and case-insensitive day/week/hour aliases', () => {
        expect(timeframeToMs('1y')).toBe(31_536_000_000);
        expect(timeframeToMs('2Y')).toBe(2 * 31_536_000_000);
        expect(timeframeToMs('1D')).toBe(86_400_000);
        expect(timeframeToMs('1w')).toBe(604_800_000);
        expect(timeframeToMs('4H')).toBe(14_400_000);
    });

    it('falls back to one hour for garbage, and says so once', () => {
        expect(timeframeToMs('banana')).toBe(3_600_000);
        expect(timeframeToMs('banana')).toBe(3_600_000); // second read is quiet, not a second warn
    });
});

// The chart's parser and the widget's parser are SEPARATE implementations of one grammar
// (the widget also turns a typed "3M" into the canonical chart value). They must agree on
// every form both accept, or a typed timeframe means one thing in the picker and another
// to the engine.
describe('the two timeframe parsers agree', () => {
    const SHARED = ['1', '15', '60', '240', '4h', '1d', '1S', '15S', '30s', '1D', '1W', '1M', '3M', '1y', '90'];

    it.each(SHARED)('reads %s the same way', (tf) => {
        expect(timeframeToMs(tf)).toBe(widgetTfMs(tf));
    });
});
