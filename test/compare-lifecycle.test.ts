import { describe, expect, it, vi } from 'vitest';
import { compareDescriptor } from '../src/core/native-indicators/compare';
import type { DataControl } from '../src/core/DataControl';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { NativeIndicatorContext, NativeIndicatorOutput } from '../src/core/native-indicators/NativeIndicator';
import type { LineLikeSeries } from '../src/core/model/series';

const bar = (time: number, close: number): OHLCV => ({ time, open: close, high: close, low: close, close, volume: 0 });
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

function fixture() {
    const pending = new Map<string, (bars: OHLCV[]) => void>();
    const outputs: NativeIndicatorOutput[] = [];
    const status = vi.fn();
    const fetchSeries = vi.fn((symbol: string) => new Promise<OHLCV[]>((resolve) => pending.set(symbol, resolve)));
    const context: NativeIndicatorContext = {
        id: 'compare-1', symbol: 'AAA', timeframe: '60', live: false,
        bars: () => [bar(1, 10), bar(2, 20)], data: {} as DataControl,
        fetchSeries,
        emit: (out) => outputs.push(out), pushData: () => {}, setStatus: status,
    };
    return { context, pending, outputs, status, fetchSeries, indicator: compareDescriptor.create() };
}

describe('Compare secondary-series lifecycle', () => {
    it('clearing the symbol invalidates an in-flight result and ends loading', async () => {
        const { context, pending, outputs, status, indicator } = fixture();
        indicator.start(context, { symbol: 'BBB', display: 'own-scale' });
        indicator.setInputs({ symbol: '', display: 'own-scale' });
        const count = outputs.length;
        expect(status).toHaveBeenLastCalledWith('idle');
        pending.get('BBB')!([bar(1, 50), bar(2, 70)]);
        await settle();
        expect(outputs).toHaveLength(count); // no old BBB data is painted under an empty symbol
        indicator.stop();
    });

    it('does not show the old symbol while its replacement is loading', async () => {
        const { context, pending, outputs, status, indicator } = fixture();
        indicator.start(context, { symbol: 'BBB', display: 'own-scale' });
        pending.get('BBB')!([bar(1, 50), bar(2, 70)]);
        await settle();
        expect((outputs[outputs.length - 1]?.series?.[0] as LineLikeSeries).points.map(p => p.value)).toEqual([50, 70]);
        indicator.setInputs({ symbol: 'CCC', display: 'own-scale' });
        const line = outputs[outputs.length - 1]?.series?.[0] as LineLikeSeries;
        expect(line.title).toBe('CCC');
        expect(line.points.map(p => p.value)).toEqual([null, null]);
        expect(status).toHaveBeenLastCalledWith('loading');
        indicator.stop();
    });

    it('reuses a pending symbol request while display mode changes', async () => {
        const { context, pending, outputs, fetchSeries, indicator } = fixture();
        indicator.start(context, { symbol: 'BBB', display: 'same-percent' });
        indicator.setInputs({ symbol: 'BBB', display: 'own-scale' });
        indicator.setInputs({ symbol: 'BBB', display: 'new-pane' });
        expect(fetchSeries).toHaveBeenCalledTimes(1);
        pending.get('BBB')!([bar(1, 50), bar(2, 70)]);
        await settle();
        expect((outputs[outputs.length - 1]?.series?.[0] as LineLikeSeries).points.map(p => p.value)).toEqual([50, 70]);
        indicator.stop();
    });

    it('ignores older replies when the chosen symbol changes', async () => {
        const { context, pending, outputs, indicator } = fixture();
        indicator.start(context, { symbol: 'BBB', display: 'own-scale' });
        indicator.setInputs({ symbol: 'CCC', display: 'own-scale' });
        pending.get('CCC')!([bar(1, 30), bar(2, 40)]);
        await settle();
        const count = outputs.length;
        expect(outputs[outputs.length - 1]?.series?.[0]?.title).toBe('CCC');
        pending.get('BBB')!([bar(1, 50), bar(2, 70)]);
        await settle();
        expect(outputs).toHaveLength(count);
        indicator.stop();
    });

    it('does not emit a pending reply after stop, including when a new context starts', async () => {
        const first = fixture(), second = fixture(), indicator = first.indicator;
        indicator.start(first.context, { symbol: 'BBB', display: 'own-scale' });
        indicator.stop();
        indicator.start(second.context, { symbol: 'CCC', display: 'own-scale' });
        const firstCount = first.outputs.length, secondCount = second.outputs.length;
        first.pending.get('BBB')!([bar(1, 50), bar(2, 70)]);
        await settle();
        expect(first.outputs).toHaveLength(firstCount);
        expect(second.outputs).toHaveLength(secondCount);
        second.pending.get('CCC')!([bar(1, 30), bar(2, 40)]);
        await settle();
        expect(second.outputs[second.outputs.length - 1]?.series?.[0]?.title).toBe('CCC');
        indicator.stop();
    });
});
