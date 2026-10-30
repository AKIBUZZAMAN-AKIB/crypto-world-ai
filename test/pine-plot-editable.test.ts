import { describe, expect, it } from 'vitest';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';
import type { OHLCV } from '../src/core/model/ohlcv';
import { indicatorStyleInputs } from '../src/renderers/shared/InputsUI';

const source = `//@version=5
indicator("Plot style metadata", overlay=true)
plot(close, "Editable", color=color.red, linewidth=2)
plot(close, "Locked", color=color.blue, editable=false)
plot(close, "Hidden by display", display=display.none)
`;

function bars(): OHLCV[] {
    return Array.from({ length: 5 }, (_, i) => ({
        time: Date.UTC(2024, 0, 1) + i * 60_000,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 10,
    }));
}

describe('Pine plot Style metadata', () => {
    it('preserves editable=false and constant plot colors for generated Style controls', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(source, 'plot-style-metadata');
        let model: Record<string, any> | null = null;
        const errors: Error[] = [];
        const data = bars();
        const session = engine.execute(
            {
                prepared,
                market: { symbol: 'BTCUSDT', timeframe: '1', symbolInfo: { ticker: 'BTCUSDT', mintick: 0.01 } },
                bars: data,
                fetchSeries: async () => data,
                inputs: {},
                mode: 'static',
                historyState: 'complete',
            },
            { onModel: (next) => { model = next as unknown as Record<string, any>; }, onError: (error) => errors.push(error) },
        );
        for (let i = 0; i < 100 && model === null && errors.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
        session.stop();

        expect(errors).toEqual([]);
        const output = model as Record<string, any> | null;
        expect(output?.series?.map((series: any) => ({ title: series.title, editable: series.editable }))).toEqual([
            { title: 'Editable', editable: true },
            { title: 'Locked', editable: false },
            { title: 'Hidden by display', editable: true },
        ]);
        expect(output?.series?.[2]?.display).toEqual({ pane: false, priceScale: false, legend: false, dataWindow: false });
        expect(new Set(output?.series?.[0]?.points?.map((point: any) => point.color))).toEqual(new Set(['#ff5252']));
        const styleInputs = indicatorStyleInputs(output?.series ?? []);
        expect(styleInputs.some((input) => input.group === 'Editable' && input.title === 'Color' && input.defval === '#ff5252')).toBe(true);
        expect(styleInputs.some((input) => input.group === 'Locked')).toBe(false);
        expect(styleInputs.some((input) => input.group === 'Hidden by display')).toBe(true);
        expect(styleInputs.some((input) => input.group === 'Hidden by display' && input.title === 'Visible' && input.defval === false)).toBe(true);
    });
});
