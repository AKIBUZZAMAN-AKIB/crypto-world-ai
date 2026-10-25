import { describe, expect, it } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import { classicSpecs } from '../src/core/native-indicators/classics/index';
import { classicPineSource } from '../src/core/native-indicators/classics/pine-source';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';

/**
 * MEASUREMENT, not a gate: the same built-in computed two ways — by the historical native
 * `compute`, and by the Pine script the legend's `{ }` icon opens — over identical bars.
 * Since a catalog type now RUNS its Pine source, any drift between the two is a place where
 * the built-in used to behave differently from the Pine code we publish as its source.
 *
 * Gated behind `PINE_PARITY=1` because it prints a table and tolerates known warm-up drift:
 *   PINE_PARITY=1 npx vitest run test/pine-parity.test.ts
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

const DATA = bars();

async function runPine(source: string): Promise<IndicatorModel | null> {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, 'parity-1');
    const out: { model: IndicatorModel | null } = { model: null };
    const session = engine.execute(
        {
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: { ticker: 'BTCUSDT', mintick: 0.01 } },
            bars: DATA,
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        },
        { onModel: (m: IndicatorModel) => { out.model = m; }, onError: () => undefined },
    );
    for (let i = 0; i < 200 && out.model === null; i++) await new Promise((r) => setTimeout(r, 10));
    session.stop();
    return out.model;
}

function runNative(type: string): { byTitle: Map<string, Array<number | null>> } {
    const spec = classicSpecs.find((s) => s.type === type);
    const byTitle = new Map<string, Array<number | null>>();
    if (!spec) return { byTitle };
    const inputs = Object.fromEntries(spec.inputs.map((i) => [i.key, i.defval]));
    const out = spec.compute(DATA, inputs);
    for (const plot of out.plots) {
        byTitle.set(plot.title, Array.from(plot.values, (v) => (Number.isFinite(v) ? v : null)));
    }
    return { byTitle };
}

/** Compare the first drawing series of each side: shared non-null tail, relative error. */
function compare(native: Array<number | null>, pine: Array<number | null>): { n: number; worst: number; at: number; abs: number; absAt: number } {
    let n = 0;
    let worst = 0;
    let at = -1;
    let abs = 0;
    let absAt = -1;
    for (let i = 0; i < Math.min(native.length, pine.length); i++) {
        const a = native[i];
        const b = pine[i];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        n++;
        const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
        const rel = Math.abs(a - b) / scale;
        if (rel > worst) {
            worst = rel;
            at = i;
        }
        if (Math.abs(a - b) > abs) {
            abs = Math.abs(a - b);
            absAt = i;
        }
    }
    return { n, worst, at, abs, absAt };
}

const SAMPLE = ['sma', 'ema', 'rma', 'bollinger-bands', 'rsi', 'stochastic', 'average-true-range', 'macd', 'on-balance-volume', 'commodity-channel-index', 'williams-percent-r', 'money-flow-index'];

const PARITY_ON = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PINE_PARITY;

describe.skipIf(!PARITY_ON)('native vs Pine parity', () => {
    for (const type of SAMPLE) {
        it(`${type}`, async () => {
            const source = classicPineSource(type);
            expect(source, `no Pine source for ${type}`).toBeTruthy();
            const model = await runPine(source as string);
            expect(model).not.toBeNull();
            const lineSeries = (model?.series ?? []).filter((s) => 'points' in s) as Array<{
                title: string;
                points: Array<{ time: number; value: number | null }>;
            }>;
            const pineByTitle = new Map<string, Array<number | null>>();
            for (const spec of lineSeries) {
                const values: Array<number | null> = DATA.map(() => null);
                for (const point of spec.points) {
                    const index = DATA.findIndex((b) => b.time === point.time);
                    if (index >= 0) values[index] = point.value ?? null;
                }
                pineByTitle.set(spec.title, values);
            }
            const { byTitle } = runNative(type);
            const rows: string[] = [];
            for (const [title, nativeValues] of byTitle) {
                const pineValues = pineByTitle.get(title);
                if (!pineValues) {
                    rows.push(`${title}: not plotted by the script`);
                    continue;
                }
                const { n, worst, at, abs, absAt } = compare(nativeValues, pineValues);
                rows.push(`${title}: n=${n} worst=${(worst * 100).toFixed(4)}%${at >= 0 ? ` @${at}` : ''} abs=${abs.toFixed(4)}${absAt >= 0 ? ` @${absAt}` : ''}`);
            }
            // eslint-disable-next-line no-console
            console.log(`[parity] ${type}\n  ${rows.join('\n  ')}`);
            expect(rows.length).toBeGreaterThan(0);
        });
    }
});
