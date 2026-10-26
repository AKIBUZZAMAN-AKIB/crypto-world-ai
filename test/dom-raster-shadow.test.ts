// @vitest-environment jsdom
// `box-shadow` in the PNG export. The legend's control cluster wears `inset 0 0 0 1px`, so
// a rasterizer that only knew backgrounds/borders dropped the ring the moment the row was
// hovered — the same class of silent gap the masked-icon fix closed.
import { describe, it, expect, afterEach } from 'vitest';
import { rasterizeOverlay } from '../src/renderers/shared/dom-raster';

interface Call {
    op: 'fill' | 'stroke';
    color: string;
    lineWidth?: number;
    shadow?: { color: string; blur: number; x: number; y: number };
}

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
    const calls: Call[] = [];
    const state = {
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        globalAlpha: 1,
        shadowColor: 'rgba(0, 0, 0, 0)',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
    };
    const shadow = (): Call['shadow'] => ({ color: state.shadowColor, blur: state.shadowBlur, x: state.shadowOffsetX, y: state.shadowOffsetY });
    const ctx = {
        save() {},
        restore() {},
        scale() {},
        translate() {},
        beginPath() {},
        rect() {},
        roundRect() {},
        arc() {},
        ellipse() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        clip() {},
        fillText() {},
        drawImage() {},
        fill() {
            calls.push({ op: 'fill', color: state.fillStyle, shadow: shadow() });
        },
        stroke() {
            calls.push({ op: 'stroke', color: state.strokeStyle, lineWidth: state.lineWidth, shadow: shadow() });
        },
        get fillStyle() {
            return state.fillStyle;
        },
        set fillStyle(v: string) {
            state.fillStyle = v;
        },
        get strokeStyle() {
            return state.strokeStyle;
        },
        set strokeStyle(v: string) {
            state.strokeStyle = v;
        },
        get lineWidth() {
            return state.lineWidth;
        },
        set lineWidth(v: number) {
            state.lineWidth = v;
        },
        get globalAlpha() {
            return state.globalAlpha;
        },
        set globalAlpha(v: number) {
            state.globalAlpha = v;
        },
        get shadowColor() {
            return state.shadowColor;
        },
        set shadowColor(v: string) {
            state.shadowColor = v;
        },
        get shadowBlur() {
            return state.shadowBlur;
        },
        set shadowBlur(v: number) {
            state.shadowBlur = v;
        },
        get shadowOffsetX() {
            return state.shadowOffsetX;
        },
        set shadowOffsetX(v: number) {
            state.shadowOffsetX = v;
        },
        get shadowOffsetY() {
            return state.shadowOffsetY;
        },
        set shadowOffsetY(v: number) {
            state.shadowOffsetY = v;
        },
        lineCap: 'butt' as CanvasLineCap,
        lineJoin: 'miter' as CanvasLineJoin,
        font: '',
        textBaseline: 'middle' as CanvasTextBaseline,
        textAlign: 'left' as CanvasTextAlign,
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
}

class FakePath2D {
    constructor(_d?: string) {}
    arc() {}
    ellipse() {}
    rect() {}
    roundRect() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
}
(globalThis as { Path2D: unknown }).Path2D = FakePath2D;

const FRAME = { left: 0, top: 0, dpr: 1 };

function chip(css: string, w = 242, h = 28): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `width:${w}px;height:${h}px;${css}`;
    document.body.appendChild(el);
    (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h, toJSON: () => ({}) }) as DOMRect;
    return el;
}

afterEach(() => document.body.replaceChildren());

describe('rasterizeOverlay — box-shadow', () => {
    it('paints an inset ring on top of the fill (the legend cluster’s 1px ring)', () => {
        const el = chip('background-color:rgb(10, 10, 12);box-shadow:rgb(42, 43, 48) 0px 0px 0px 1px inset;');
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        const ring = calls.filter((c) => c.op === 'stroke');
        expect(ring).toHaveLength(1);
        expect(ring[0]!.color).toBe('rgb(42, 43, 48)');
        expect(ring[0]!.lineWidth).toBe(1);
        // …and the fill it rides on is still there, first.
        expect(calls[0]!.op).toBe('fill');
    });

    it('paints an outer shadow BEFORE the fill, with its blur carried over', () => {
        const el = chip('background-color:rgb(10, 10, 12);box-shadow:rgba(0, 0, 0, 0.6) 0px 4px 12px 0px;');
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        const halo = calls[0]!;
        expect(halo.op).toBe('fill');
        expect(halo.shadow?.blur).toBe(12);
        expect(halo.shadow?.y).toBe(4);
        expect(calls[1]!.color).toBe('rgb(10, 10, 12)'); // the box itself, after its halo
    });

    it('a shadow list is split on its TOP-LEVEL commas (colours contain commas too)', () => {
        const el = chip('box-shadow:rgba(1, 2, 3, 0.5) 1px 1px 2px,rgb(9, 9, 9) 0px 0px 0px 1px inset;');
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        expect(calls.filter((c) => c.op === 'fill' && c.shadow?.blur === 2)).toHaveLength(1);
        expect(calls.filter((c) => c.op === 'stroke' && c.color === 'rgb(9, 9, 9)')).toHaveLength(1);
    });

    it('no shadow, no extra paints — a plain chip stays a single fill', () => {
        const el = chip('background-color:rgb(20, 20, 20);');
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.op).toBe('fill');
        expect(calls[0]!.shadow?.blur).toBe(0);
    });
});
