import { describe, expect, it } from 'vitest';
import { barsToCsv, buildChartCsv, csvTime } from '../src/workspace/csv';
import type { OHLCV } from '../src/core/model/ohlcv';

const bar = (t: number, o = 1, h = 2, l = 0.5, c = 1.5, v?: number): OHLCV => ({
    time: t,
    open: o,
    high: h,
    low: l,
    close: c,
    ...(v === undefined ? {} : { volume: v }),
});

describe('CSV export', () => {
    it('writes the header every import tool expects, in OHLCV order', () => {
        const text = barsToCsv([bar(0)]);
        expect(text.split('\n')[0]).toBe('time,open,high,low,close,volume');
    });

    it('stamps each bar with an ISO-8601 UTC instant', () => {
        const text = barsToCsv([bar(Date.UTC(2024, 0, 2, 3, 4, 5))]);
        expect(text).toContain('2024-01-02T03:04:05Z');
    });

    it('keeps full precision and never adds thousands separators', () => {
        const text = barsToCsv([bar(0, 63123.456789, 64000, 62000, 63500.5, 1234567.891)]);
        const row = text.trim().split('\n')[1]!;
        expect(row.split(',')).toEqual([
            '1970-01-01T00:00:00Z',
            '63123.456789',
            '64000',
            '62000',
            '63500.5',
            '1234567.891',
        ]);
    });

    it('leaves a missing volume EMPTY — "no data" is not "zero trades"', () => {
        const row = barsToCsv([bar(0)]).trim().split('\n')[1]!;
        const cells = row.split(',');
        expect(cells).toHaveLength(6);
        expect(cells[5]).toBe(''); // empty, NOT '0'
    });

    it('skips malformed rows instead of writing NaN cells', () => {
        const text = barsToCsv([
            bar(0),
            { time: Number.NaN, open: 1, high: 1, low: 1, close: 1 },
            { time: 60_000, open: Number.NaN, high: 1, low: 1, close: 1 },
        ]);
        const rows = text.trim().split('\n');
        expect(rows).toHaveLength(3); // header + 2 usable rows
        expect(text).not.toContain('NaN');
    });

    it('ends with exactly one newline so `wc -l` matches the row count', () => {
        const text = barsToCsv([bar(0), bar(60_000)]);
        expect(text.endsWith('\n')).toBe(true);
        expect(text.endsWith('\n\n')).toBe(false);
        expect(text.split('\n').filter(Boolean)).toHaveLength(3);
    });

    it('is deterministic — the same bars always produce identical bytes', () => {
        const bars = [bar(0), bar(60_000)];
        expect(barsToCsv(bars)).toBe(barsToCsv(bars.map((b) => ({ ...b }))));
    });

    describe('time formats', () => {
        const t = Date.UTC(2024, 0, 2, 3, 4, 5);

        it('drops a zero-millisecond tail so the common case matches TradingView', () => {
            expect(csvTime(t, 'iso')).toBe('2024-01-02T03:04:05Z');
        });

        it('keeps sub-second precision rather than rounding it away', () => {
            expect(csvTime(t + 12, 'iso')).toBe('2024-01-02T03:04:05.012Z');
        });

        it('`unix` writes milliseconds since epoch', () => {
            expect(csvTime(t, 'unix')).toBe(String(t));
            expect(barsToCsv([bar(t)], 'unix').trim().split('\n')[1]!.split(',')[0]).toBe(String(t));
        });

        it('defaults to ISO', () => {
            expect(barsToCsv([bar(t)]).trim().split('\n')[1]!.split(',')[0]).toBe('2024-01-02T03:04:05Z');
        });
    });

    describe('scopes', () => {
        const bars = Array.from({ length: 10 }, (_, i) => bar(i * 60_000));

        it('`all` exports every loaded bar', () => {
            const out = buildChartCsv({ bars, scope: 'all', symbol: 'BTCUSD', timeframe: '60' });
            expect(out.rows).toBe(10);
            expect(out.text.trim().split('\n')).toHaveLength(11);
        });

        it('`visible` narrows to the inclusive index window', () => {
            const out = buildChartCsv({
                bars,
                scope: 'visible',
                visible: { from: 2, to: 4 },
                symbol: 'BTCUSD',
                timeframe: '60',
            });
            expect(out.rows).toBe(3);
            const rows = out.text.trim().split('\n').slice(1);
            expect(rows.map((r) => r.split(',')[0])).toEqual([
                '1970-01-01T00:02:00Z',
                '1970-01-01T00:03:00Z',
                '1970-01-01T00:04:00Z',
            ]);
        });

        it('clamps a window that runs past either end of the data', () => {
            const out = buildChartCsv({
                bars,
                scope: 'visible',
                visible: { from: -5, to: 99 },
                symbol: 'BTCUSD',
                timeframe: '60',
            });
            expect(out.rows).toBe(10);
        });

        it('an inverted window writes the header only, not a crash', () => {
            const out = buildChartCsv({
                bars,
                scope: 'visible',
                visible: { from: 7, to: 3 },
                symbol: 'BTCUSD',
                timeframe: '60',
            });
            expect(out.rows).toBe(0);
            expect(out.text).toBe('time,open,high,low,close,volume\n');
        });
    });

    describe('filenames', () => {
        it('names the symbol, the timeframe and the scope', () => {
            const out = buildChartCsv({ bars: [bar(0)], scope: 'all', symbol: 'BTCUSD', timeframe: '60' });
            expect(out.filename).toBe('BTCUSD_60_all_bars.csv');
        });

        it('sanitises a pair and a timeframe that carry punctuation', () => {
            const out = buildChartCsv({ bars: [bar(0)], scope: 'visible', symbol: 'BTC/USDT:PERP', timeframe: '1h' });
            expect(out.filename).toBe('BTC_USDT_PERP_1h_visible_bars.csv');
            expect(out.filename).not.toMatch(/[^A-Za-z0-9._-]/);
        });

        it('falls back to a usable name when the symbol is entirely punctuation', () => {
            const out = buildChartCsv({ bars: [bar(0)], scope: 'all', symbol: '///', timeframe: '' });
            expect(out.filename.startsWith('chart_')).toBe(true);
        });
    });
});
