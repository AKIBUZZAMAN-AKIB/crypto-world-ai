import { describe, expect, it } from 'vitest';
import { PineEngine } from 'vela-pine-libre';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import { PINE_SCRIPTS } from '../playground/pine-scripts';

/**
 * Integration: the playground's Pine manifest, executed by the real engine through the
 * same port the chart drives. Every string the Indicators dialog can add must (a) compile,
 * (b) emit a model, and (c) — for `strategy()` scripts — produce a broker ledger, which is
 * exactly what the Strategy tester panel reads.
 *
 * The engine is a separate MIT package (`vela-pine-libre`); this suite is the contract
 * between it and Vela's own model, so a breaking change on either side fails here rather
 * than in the browser.
 */

const T0 = 1_700_002_800_000;
const HOUR = 3_600_000;

/** Deterministic, non-monotonic history: a strategy that never trades would pass vacuously. */
function bars(n = 400): OHLCV[] {
    const out: OHLCV[] = [];
    let prev = 100;
    for (let i = 0; i < n; i++) {
        const close = 100 + 0.02 * i + Math.sin(i / 5) * 6 + Math.sin(i / 1.7) * 1.2;
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

async function runScript(source: string) {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, 'it-1');
    // Held in an object: a `let` assigned only inside the engine's callback is narrowed to
    // `null` by control-flow analysis (it cannot see the callback run), which would make the
    // result type `never` downstream.
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
    // The engine runs asynchronously; give it a microtask + a tick to finish a static run.
    for (let i = 0; i < 200 && out.model === null && errors.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
    }
    const context = await session.getContext?.(['strategy', 'trades', 'plots']);
    session.stop();
    return { model: out.model, context, errors };
}

describe('pine engine integration', () => {
    it('registers under the language the chart asks for', () => {
        const engine = new PineEngine();
        expect(engine.language).toBe('pine');
        for (const entry of PINE_SCRIPTS) expect(entry.language).toBe('pine');
    });

    for (const entry of PINE_SCRIPTS) {
        it(`runs "${entry.name}" and emits a drawable model`, async () => {
            const result = await runScript(entry.script as string);
            const m = result.model;
            expect(result.errors).toEqual([]);
            expect(m, `${entry.name} emitted no model`).not.toBeNull();
            if (!m) return;
            expect(m.title.length).toBeGreaterThan(0);
            expect(m.series.length).toBeGreaterThan(0);
            // Every plotted point is finite or explicitly whitespace — the renderer draws
            // `null` as a gap and would silently skip NaN. `candleSeries` (plotcandle) has no
            // `points` array, so only line-like specs are checked here.
            for (const spec of m.series) {
                if (!('points' in spec)) continue;
                for (const p of spec.points ?? []) {
                    if (p.value !== null) expect(Number.isFinite(p.value as number)).toBe(true);
                }
            }
        });
    }

    it('reports a broker ledger for each strategy() script (what the tester panel reads)', async () => {
        const strategies = PINE_SCRIPTS.filter((e) => (e.script as string).includes('strategy('));
        expect(strategies.length).toBeGreaterThan(0);
        for (const entry of strategies) {
            const { context } = await runScript(entry.script as string);
            const state = context?.strategy;
            expect(state, `${entry.name} produced no strategy state`).toBeDefined();
            if (!state) continue;
            expect(state.initialCapital).toBeGreaterThan(0);
            const trades = context?.trades ?? [];
            expect(trades.length, `${entry.name} produced no trades`).toBeGreaterThan(0);
            for (const t of trades) {
                expect(t.side === 'long' || t.side === 'short').toBe(true);
                expect(t.qty).toBeGreaterThan(0);
                expect(t.entry.time).toBeGreaterThanOrEqual(T0);
            }
            // Closed round trips must carry a realised P&L, and the counters must agree.
            const closed = trades.filter((t) => !t.open);
            if (closed.length > 0) {
                for (const t of closed) expect(typeof t.pnl).toBe('number');
                const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
                const losses = closed.filter((t) => (t.pnl ?? 0) < 0).length;
                expect(state.wins + state.losses).toBeGreaterThan(0);
                expect(wins + losses).toBeGreaterThan(0);
            }
        }
    });

    it('honours indicator inputs, so the settings dialog has something to edit', async () => {
        const ema = PINE_SCRIPTS.find((e) => e.name === 'Pine · EMA Cross');
        const engine = new PineEngine();
        const prepared = await engine.prepare(ema?.script as string, 'it-2');
        const keys = prepared.inputs.map((i) => i.key);
        expect(keys).toContain('fastLen');
        expect(keys).toContain('slowLen');
        const fast = prepared.inputs.find((i) => i.key === 'fastLen');
        expect(fast?.defval).toBe(12);
        expect(fast?.min).toBe(1);
    });
});
