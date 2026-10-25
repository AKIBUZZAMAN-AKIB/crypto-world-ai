import { describe, expect, it } from 'vitest';
import type { MarkerPoint } from '../src/core/model/series';
import { renderPineMarkers, type PineMarkerDeps } from '../src/renderers/shared/pine-markers';

/**
 * The Pine marker painter is a PURE canvas function (coordinate closures in, ink out), so it
 * is testable without a renderer: a recording stub context captures every fill/fillText call.
 * These cases pin the three things a screenshot can hide — the label INK (textcolor), the
 * label PLACEMENT (the pill hangs off the anchor, the anchor is the marker's own price), and
 * the culling/clamping rules.
 */

interface Recorder {
    ctx: CanvasRenderingContext2D;
    texts: Array<{ text: string; x: number; y: number; color: string; font: string }>;
    fills: Array<{ style: string }>;
}

function recorder(): Recorder {
    const texts: Recorder['texts'] = [];
    const fills: Recorder['fills'] = [];
    const state = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic' };
    const noop = (): void => undefined;
    const ctx = {
        get fillStyle() { return state.fillStyle; },
        set fillStyle(v: string) { state.fillStyle = v; },
        get strokeStyle() { return state.strokeStyle; },
        set strokeStyle(v: string) { state.strokeStyle = v; },
        get font() { return state.font; },
        set font(v: string) { state.font = v; },
        get lineWidth() { return state.lineWidth; },
        set lineWidth(v: number) { state.lineWidth = v; },
        get textAlign() { return state.textAlign; },
        set textAlign(v: string) { state.textAlign = v; },
        get textBaseline() { return state.textBaseline; },
        set textBaseline(v: string) { state.textBaseline = v; },
        save: noop,
        restore: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        quadraticCurveTo: noop,
        arc: noop,
        stroke: noop,
        fillRect: () => fills.push({ style: state.fillStyle }),
        fill: () => fills.push({ style: state.fillStyle }),
        measureText: (t: string) => ({ width: t.length * 6 }),
        fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, color: state.fillStyle, font: state.font }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, texts, fills };
}

function deps(over: Partial<PineMarkerDeps> = {}): PineMarkerDeps {
    return {
        xOf: (ms) => (ms - 1_000) / 10, // 1 unit per 10 ms → easy expectations
        yOfPrice: (p) => 100 - p, // price 40 → y 60
        barYAt: () => ({ high: 30, low: 80 }),
        top: 0,
        bottom: 120,
        width: 400,
        ...over,
    };
}

const STYLE = { fontSize: 11, fontFamily: 'Inter', textColor: '#d1d4dc' };

describe('pine marker painter', () => {
    it('paints a labelUp pill with the marker ink and the textcolor as the label text', () => {
        const { ctx, texts, fills } = recorder();
        const marker: MarkerPoint = {
            time: 1_100,
            position: 'inBar',
            shape: 'labelUp',
            color: '#4caf50',
            text: ' Bull ',
            textColor: '#ffffff',
            price: 40,
        };
        renderPineMarkers(ctx, [marker], deps(), STYLE);
        expect(texts.length).toBe(1);
        expect(texts[0]?.text).toBe(' Bull ');
        // The pill body takes the marker colour; the INK is the marker's own textcolor.
        expect(fills.some((f) => f.style === '#4caf50')).toBe(true);
        expect(texts[0]?.color).toBe('#ffffff');
        // Anchored at the marker's price (y = 100 - 40) and drawn ABOVE it (label-up).
        expect(texts[0]?.y).toBeLessThan(60);
    });

    it('hangs a labelDown pill BELOW its anchor', () => {
        const { ctx, texts } = recorder();
        renderPineMarkers(
            ctx,
            [{ time: 1_100, position: 'inBar', shape: 'labelDown', color: '#f23645', text: ' Bear ', textColor: '#ffffff', price: 70 }],
            deps(),
            STYLE,
        );
        expect(texts.length).toBe(1);
        // price 70 → anchor y 30; the box starts below the notch.
        expect(texts[0]?.y).toBeGreaterThan(30);
    });

    it('falls back to the style ink when the marker has no textcolor', () => {
        const { ctx, texts } = recorder();
        renderPineMarkers(ctx, [{ time: 1_100, position: 'inBar', shape: 'labelUp', color: '#2196f3', text: 'x', price: 20 }], deps(), STYLE);
        expect(texts[0]?.color).toBe('#d1d4dc');
    });

    it('paints a relative marker off the bar extremes, and clamps a marker pinned to the pane edge', () => {
        const { ctx, texts } = recorder();
        // belowBar → under the bar's low (y 80), no text so nothing is written.
        renderPineMarkers(ctx, [{ time: 1_100, position: 'belowBar', shape: 'triangleUp', color: '#4caf50' }], deps(), STYLE);
        expect(texts.length).toBe(0);
        // A label whose price maps far outside the pane still paints, clamped inside it.
        const hi = recorder();
        renderPineMarkers(hi.ctx, [{ time: 1_100, position: 'inBar', shape: 'labelUp', color: '#4caf50', text: 'top', price: 500 }], deps(), STYLE);
        expect(hi.texts.length).toBe(1);
        // price 500 → y −400, clamped to the pane's top edge; the pill then hangs just above
        // it (a label that would otherwise be invisible). Callers clip to the pane.
        const y = hi.texts[0]?.y as number;
        expect(y).toBeGreaterThan(-40);
        expect(y).toBeLessThan(40);
    });

    it('culls markers outside the visible x range', () => {
        const { ctx, texts } = recorder();
        renderPineMarkers(
            ctx,
            [
                { time: -100_000, position: 'inBar', shape: 'labelUp', color: '#4caf50', text: 'gone', price: 40 },
                { time: 9_999_999, position: 'inBar', shape: 'labelUp', color: '#4caf50', text: 'gone', price: 40 },
            ],
            deps(),
            STYLE,
        );
        expect(texts.length).toBe(0);
    });
});
