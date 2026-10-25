import { describe, expect, it } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import { classicSpecs } from '../src/core/native-indicators/classics/index';
import { classicPineIndex, classicPineSource } from '../src/core/native-indicators/classics/pine-source';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';

/**
 * The built-in catalog's Pine source is a CONTRACT, not a caption: every script the legend's
 * `{ }` icon can open must (a) be a real key of the catalog it claims to describe, and (b)
 * compile and emit a drawable model in the vendored engine. A typo'd type would silently
 * offer "Source code" for a study that does not exist; a script the engine cannot run would
 * open an editor onto dead code.
 */

const T0 = 1_700_002_800_000;
const HOUR = 3_600_000;

function bars(n = 400): OHLCV[] {
    const out: OHLCV[] = [];
    let prev = 100;
    const rnd = (k: number): number => {
        const x = Math.sin(k * 12.9898) * 43758.5453;
        return x - Math.floor(x);
    };
    for (let i = 0; i < n; i++) {
        const close = 100 + 0.02 * i + Math.sin(i / 5) * 6 + Math.sin(i / 1.7) * 1.2 + (rnd(i) - 0.5) * 9;
        const open = prev;
        out.push({
            time: T0 + i * HOUR,
            open,
            high: Math.max(open, close) + 0.4,
            low: Math.min(open, close) - 0.4,
            close,
            volume: 500 + (i % 37),
        });
        prev = close;
    }
    return out;
}

async function run(source: string): Promise<{ model: IndicatorModel | null; errors: Error[] }> {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, 'builtin-1');
    const out: { model: IndicatorModel | null } = { model: null };
    const errors: Error[] = [];
    const session = engine.execute(
        {
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: { ticker: 'BTCUSDT', mintick: 0.01 } },
            bars: bars(),
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        },
        { onModel: (m) => { out.model = m; }, onError: (e) => errors.push(e) },
    );
    for (let i = 0; i < 200 && out.model === null && errors.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
    }
    session.stop();
    return { model: out.model as IndicatorModel | null, errors };
}

describe('built-in indicator Pine sources', () => {
    const catalog = new Map(classicSpecs.map((s) => [s.type, s]));

    it('every source is keyed to a real catalog type', () => {
        const unknown = classicPineIndex()
            .map((e) => e.type)
            .filter((t) => !catalog.has(t));
        expect(unknown).toEqual([]);
    });

    it('covers the studies a trader opens most', () => {
        for (const type of ['sma', 'ema', 'rsi', 'macd', 'bollinger-bands', 'stochastic', 'average-true-range', 'on-balance-volume']) {
            expect(classicPineSource(type), `no Pine source for ${type}`).toBeTruthy();
        }
    });

    for (const { type, source } of classicPineIndex()) {
        it(`runs the built-in "${type}" source`, async () => {
            expect(source.startsWith('//@version=6')).toBe(true);
            const { model, errors } = await run(source);
            expect(errors.map((e) => e.message)).toEqual([]);
            expect(model, `${type} emitted no model`).not.toBeNull();
            if (!model) return;
            expect(model.series.length).toBeGreaterThan(0);
            // The overlay flag decides the PANE — the source must agree with the catalog,
            // or "Source code" would show a study that renders somewhere else.
            expect(model.overlay).toBe(catalog.get(type)?.overlay);
            const drawn = model.series.some((s) => {
                if (s.kind === 'markers') return s.markers.length > 0;
                if ('points' in s) return (s.points ?? []).some((p) => p.value !== null);
                return (s.bars?.length ?? 0) > 0;
            });
            expect(drawn, `${type} plotted nothing`).toBe(true);
        });
    }
});
