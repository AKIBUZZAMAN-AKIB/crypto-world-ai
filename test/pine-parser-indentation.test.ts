import { describe, expect, it } from 'vitest';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';
import type { OHLCV } from '../src/core/model/ohlcv';

const source = `//@version=5
indicator("Nested control flow", overlay=true)
showMtf = input.bool(false, "Show MTF")
level(string tf) =>
    request.security(syminfo.tickerid, tf, close)
choose(bool outer, bool inner, bool lower) =>
    if outer
        if inner
            if lower
                close
        else
            open
plot(close)
if showMtf
    value = level("D")
    plot(value)
`;

function bars(): OHLCV[] {
    const start = Date.UTC(2024, 0, 1);
    const hour = 3_600_000;
    return Array.from({ length: 20 }, (_, i) => ({
        time: start + i * hour,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10,
    }));
}

describe('Pine nested if/else parsing', () => {
    it('binds a dedented else to its same-indent if, not a deeper nested if', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(source, 'nested-else');
        expect(prepared.meta.title).toBe('Nested control flow');
        expect(prepared.inputs?.[0]?.key).toBe('showMtf');
    });

    it('does not reject a valid request.security helper just because its branch is disabled', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(source, 'nested-else-runtime');
        let model: unknown = null;
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
            { onModel: (next) => { model = next; }, onError: (error) => errors.push(error) },
        );
        for (let i = 0; i < 100 && model === null && errors.length === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        session.stop();
        expect(model).not.toBeNull();
        expect(errors).toEqual([]);
    });
});
