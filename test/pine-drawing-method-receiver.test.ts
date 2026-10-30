import { describe, expect, it } from 'vitest';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';
import type { OHLCV } from '../src/core/model/ohlcv';

const source = `//@version=5
indicator("Method receiver drawing test", overlay=true)
var line trend = line.new(na, na, na, na, xloc=xloc.bar_time, color=color.red)
var box zone = box.new(na, na, na, na, xloc=xloc.bar_time, bgcolor=color.new(color.blue, 80))
if bar_index > 0
    trend.set_first_point(chart.point.new(time[1], na, low[1]))
    trend.set_second_point(chart.point.new(time, na, high))
    zone.set_top_left_point(chart.point.new(time[1], na, high[1]))
    zone.set_bottom_right_point(chart.point.new(time, na, low))
`;

function bars(): OHLCV[] {
    const start = Date.UTC(2024, 0, 1);
    const hour = 3_600_000;
    return Array.from({ length: 4 }, (_, i) => ({
        time: start + i * hour,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 10,
    }));
}

describe('Pine drawing method receivers', () => {
    it('applies chart.point setters to line and box IDs in Pine method syntax', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(source, 'drawing-method-receiver');
        let model: Record<string, any> | null = null;
        const errors: Error[] = [];
        const session = engine.execute(
            {
                prepared,
                market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: { ticker: 'BTCUSDT', mintick: 0.01 } },
                bars: bars(),
                fetchSeries: async () => bars(),
                inputs: {},
                mode: 'static',
                historyState: 'complete',
            },
            { onModel: (next) => { model = next as unknown as Record<string, any>; }, onError: (error) => errors.push(error) },
        );
        for (let i = 0; i < 100 && model === null && errors.length === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        session.stop();

        expect(errors).toEqual([]);
        const output = model as Record<string, any> | null;
        expect(output?.lines?.[0]).toMatchObject({
            x1: bars()[2]!.time,
            y1: bars()[2]!.low,
            x2: bars()[3]!.time,
            y2: bars()[3]!.high,
        });
        expect(output?.boxes?.[0]).toMatchObject({
            left: bars()[2]!.time,
            top: bars()[2]!.high,
            right: bars()[3]!.time,
            bottom: bars()[3]!.low,
        });
    });
});
