import { describe, it, expect } from 'vitest';
import { timeframeToMs } from '../src/data/timeframe';
import { normalizeTf } from '../src/data/providers/binance/BinanceProvider';

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
