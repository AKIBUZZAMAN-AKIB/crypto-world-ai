import { describe, expect, it } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { MarkerSeries } from '../src/core/model/series';
import { PineEngine } from '../playground/vendor/pine-libre/index.js';

/**
 * Drawing builtins a REAL TradingView study leans on — the ones a plots-only engine drops:
 *
 *   • `plotshape(…, offset=-n, location=location.absolute, style=shape.labelup, text=…,
 *     textcolor=…)` — a text label pinned to the series value, n bars back.
 *   • `fill(hline1, hline2, color)` — the constant 70/30 wash of an RSI pane, which has no
 *     plot references to fill between.
 *
 * Both are contract points between the vendored engine and Vela's own `IndicatorModel`, so a
 * regression on either side fails here instead of silently rendering nothing in the browser.
 */

const T0 = 1_700_002_800_000;
const HOUR = 3_600_000;

/** Deterministic NOISY history — a pure sine has no divergences, so nothing would fire. */
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

async function runScript(source: string) {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, 'draw-1');
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

function markerSeries(model: IndicatorModel, title: string): MarkerSeries {
    const s = model.series.find((x) => x.title === title);
    expect(s, `no marker series titled "${title}"`).toBeDefined();
    expect(s && s.kind).toBe('markers');
    return s as MarkerSeries;
}

describe('pine drawing builtins', () => {
    it('pins a labelup marker at the series value, offset bars back', async () => {
        const { model, errors } = await runScript(`//@version=6
indicator("labels", overlay=false)
osc = ta.rsi(close, 14)
lbR = 5
hit = bar_index % 40 == 0
value = hit ? osc[lbR] : na
plot(value, title="Value")
plotshape(value, title="Label", offset=-lbR, text=" Bull ", style=shape.labelup, location=location.absolute, color=color.green, textcolor=color.white)
plotshape(hit, title="Under", style=shape.triangleup, location=location.belowbar, color=color.red)
`);
        expect(errors).toEqual([]);
        const label = markerSeries(model as IndicatorModel, 'Label');
        expect(label.markers.length).toBeGreaterThan(0);
        const m = label.markers[0];
        if (!m) throw new Error('no marker point');
        // A label is NOT an arrow: the host paints the TV pill from `labelUp`.
        expect(m.shape).toBe('labelUp');
        expect(m.text).toBe(' Bull ');
        expect(m.textColor).toBe('#ffffff');
        // `location.absolute` carries the exact y (the RSI value), not a relative edge.
        expect(typeof m.price).toBe('number');
        expect(Number.isFinite(m.price as number)).toBe(true);
        expect(m.price as number).toBeGreaterThan(0);
        expect(m.price as number).toBeLessThan(100);
        // `offset=-5` shifts the glyph 5 bars into the past.
        expect(m.time).toBe(T0 + (40 - 5) * HOUR);

        // A plain shape keeps the arrow token and carries no price.
        const under = markerSeries(model as IndicatorModel, 'Under');
        expect(under.markers[0]?.shape).toBe('triangleUp');
        expect(under.markers[0]?.price).toBeUndefined();
    });

    it('fills the band between two hlines (the RSI 70/30 wash)', async () => {
        const { model, errors } = await runScript(`//@version=6
indicator("band", overlay=false)
ob = hline(70, title="Overbought", color=#787B86, linestyle=hline.style_dotted)
os = hline(30, title="Oversold", color=#787B86, linestyle=hline.style_dotted)
hline(50, title="Middle", color=#787B86, linestyle=hline.style_dotted)
fill(ob, os, title="Background", color=color.rgb(33, 150, 243, 90))
plot(ta.rsi(close, 14), title="RSI")
`);
        expect(errors).toEqual([]);
        const m = model as IndicatorModel;
        expect(m.priceLines.length).toBe(3);
        expect(m.fills.length).toBe(1);
        const fill = m.fills[0] as unknown as { fromPrice?: number; toPrice?: number; color?: string; fromSeriesId?: string };
        expect(fill.fromPrice).toBe(70);
        expect(fill.toPrice).toBe(30);
        expect(fill.fromSeriesId).toBeUndefined();
        // color.rgb(r,g,b,transp) — 90% transparency holds through to the model.
        expect(fill.color).toBe('rgba(33, 150, 243, 0.1)');
    });

    it('keeps a plot band (fill of two plots) working alongside the hline overload', async () => {
        const { model, errors } = await runScript(`//@version=6
indicator("plots", overlay=false)
a = plot(60, title="A")
b = plot(40, title="B")
fill(a, b, color=color.new(color.blue, 80))
`);
        expect(errors).toEqual([]);
        const m = model as IndicatorModel;
        expect(m.fills.length).toBe(1);
        const fill = m.fills[0] as unknown as { fromSeriesId?: string; toSeriesId?: string; fromPrice?: number };
        expect(typeof fill.fromSeriesId).toBe('string');
        expect(typeof fill.toSeriesId).toBe('string');
        expect(fill.fromPrice).toBeUndefined();
    });
});
