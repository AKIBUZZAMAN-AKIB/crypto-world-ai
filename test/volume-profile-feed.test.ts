// Tier-3 #13 — the volume-at-price FEED (data before rendering).
import { describe, expect, it } from 'vitest';
import { bucketAt, buildTradeProfile, buildVolumeProfile, profileDelta } from '../src/core/volume-profile/feed';
import type { ProfileBar } from '../src/core/volume-profile/feed';

const bar = (o: number, h: number, l: number, c: number, v: number): ProfileBar => ({ open: o, high: h, low: l, close: c, volume: v });

describe('volume-profile/bars', () => {
    it('places the whole volume of a flat bar in one bucket', () => {
        const p = buildVolumeProfile([bar(100, 100, 100, 100, 500)], { bucket: 10 })!;
        expect(p.total).toBeCloseTo(500, 6);
        expect(p.buckets.filter((b) => b.volume > 0)).toHaveLength(1);
        expect(bucketAt(p, 100)?.volume).toBeCloseTo(500, 6);
    });

    it('spreads a bar across the buckets it touches, conserving volume', () => {
        // 100.5 → 110 spans 10.0 → the 100-110 bucket gets all of it (one bucket touched)
        const p = buildVolumeProfile([bar(105, 110, 100, 108, 900)], { bucket: 10 })!;
        expect(p.total).toBeCloseTo(900, 6);
        // 100 → 130 spans three buckets
        const q = buildVolumeProfile([bar(101, 130, 100, 129, 900)], { bucket: 10 })!;
        expect(q.total).toBeCloseTo(900, 6);
        expect(q.buckets.filter((b) => b.volume > 1e-9).length).toBeGreaterThan(1);
    });

    it('splits buy/sell by the bar’s own direction', () => {
        const up = buildVolumeProfile([bar(100, 110, 100, 108, 100)], { bucket: 10 })!;
        expect(profileDelta(up)).toBeCloseTo(100, 6);
        const down = buildVolumeProfile([bar(108, 110, 100, 100, 100)], { bucket: 10 })!;
        expect(profileDelta(down)).toBeCloseTo(-100, 6);
    });

    it('POC is the heaviest bucket; VAH/VAL bracket it and hold ≥ the value area', () => {
        const bars = [
            bar(100, 102, 99, 101, 50),
            bar(112, 113, 111, 112, 400), // the heavy shelf
            bar(120, 122, 119, 121, 40),
        ];
        const p = buildVolumeProfile(bars, { bucket: 1, valueAreaPct: 70 })!;
        expect(p.poc).toBeGreaterThan(110);
        expect(p.poc).toBeLessThan(114);
        expect(p.val).toBeLessThanOrEqual(p.poc);
        expect(p.vah).toBeGreaterThanOrEqual(p.poc);
    });

    it('the value area is monotone in the percentage asked for', () => {
        const bars = [bar(100, 101, 99, 100, 10), bar(110, 111, 109, 110, 90)];
        const narrow = buildVolumeProfile(bars, { bucket: 1, valueAreaPct: 50 })!;
        const wide = buildVolumeProfile(bars, { bucket: 1, valueAreaPct: 95 })!;
        expect(wide.vah - wide.val).toBeGreaterThanOrEqual(narrow.vah - narrow.val);
    });

    it('an auto bucket resolves to a sane count, not one giant bucket', () => {
        const p = buildVolumeProfile([bar(100, 200, 100, 199, 1000)], { bucket: 'auto' })!;
        expect(p.buckets.length).toBeGreaterThan(40);
        expect(p.total).toBeCloseTo(1000, 6);
    });

    it('returns null for bars with no volume (a rebucketed series carries none)', () => {
        expect(buildVolumeProfile([bar(100, 110, 100, 105, 0)])).toBeNull();
        expect(buildVolumeProfile([])).toBeNull();
    });
});

describe('volume-profile/trades', () => {
    it('lands each trade whole in its bucket and keeps the sign', () => {
        const p = buildTradeProfile(
            [
                { price: 100.2, size: 5 },
                { price: 100.8, size: -3 },
                { price: 110.4, size: 2 },
            ],
            { bucket: 10 },
        )!;
        const first = bucketAt(p, 100)!;
        expect(first.volume).toBeCloseTo(8, 6);
        expect(first.buy).toBeCloseTo(5, 6);
        expect(first.sell).toBeCloseTo(3, 6);
        expect(profileDelta(p)).toBeCloseTo(4, 6);
    });

    it('ignores zero-size prints and empty input', () => {
        expect(buildTradeProfile([{ price: 100, size: 0 }])).toBeNull();
        expect(buildTradeProfile([])).toBeNull();
    });
});
