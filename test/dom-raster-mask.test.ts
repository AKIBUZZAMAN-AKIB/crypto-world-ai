// @vitest-environment jsdom
// The PNG export's DOM rasterizer must understand MASKED icons. On screen an icon is
// `background-color: currentColor` cut by a CSS mask; a rasterizer that only knows
// backgrounds would export a solid square where every glyph should be — and that is
// exactly what the kit's icon change (R75) walked into.
import { describe, it, expect, afterEach } from 'vitest';
import { rasterizeOverlay } from '../src/renderers/shared/dom-raster';

interface Call { op: string; color?: string; kind?: string }
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
    const calls: Call[] = [];
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
        fill(this: { fillStyle: string }, p?: Path2D) {
            calls.push({ op: 'fill', color: String(this.fillStyle), kind: p ? 'path' : 'rect' });
        },
        stroke(this: { strokeStyle: string }) {
            calls.push({ op: 'stroke', color: String(this.strokeStyle) });
        },
        fillStyle: '#000',
        strokeStyle: '#000',
        globalAlpha: 1,
        lineWidth: 1,
        lineCap: 'butt' as CanvasLineCap,
        lineJoin: 'miter' as CanvasLineJoin,
        font: '',
        textBaseline: 'middle' as CanvasTextBaseline,
        textAlign: 'left' as CanvasTextAlign,
    } as unknown as CanvasRenderingContext2D & { fillStyle: string; strokeStyle: string };
    return { ctx, calls };
}

const FRAME = { left: 0, top: 0, dpr: 1 };

/** jsdom lays nothing out and ships no Path2D: give every box a real size and record paths. */
class FakePath2D {
    static made = 0;
    constructor(_d?: string) {
        FakePath2D.made += 1;
    }
    arc() {}
    ellipse() {}
    rect() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D;
(globalThis as { Path2D: unknown }).Path2D = FakePath2D;

function box(el: Element): void {
    (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ x: 0, y: 0, left: 0, top: 0, width: 16, height: 16, right: 16, bottom: 16, toJSON: () => ({}) }) as DOMRect;
}
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><path d="M2 8h12"/><circle cx="8" cy="8" r="2"/></svg>';

function maskedIcon(uri: string | null, color: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'vela-icon';
    el.style.cssText = `width:16px;height:16px;background-color:${color};color:${color};`;
    if (uri) el.style.setProperty('mask-image', uri);
    document.body.appendChild(el);
    box(el);
    return el;
}

afterEach(() => document.body.replaceChildren());

describe('rasterizeOverlay — masked icons', () => {
    it('draws the mask’s shapes in the element’s colour, not a filled box', () => {
        const el = maskedIcon(`url("data:image/svg+xml,${encodeURIComponent(ICON)}")`, 'rgb(255, 0, 0)');
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        // Two shapes, each stroked (fill="none") — and NOT one big filled rectangle.
        expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(2);
        expect(calls.filter((c) => c.op === 'fill')).toHaveLength(0);
        expect(calls.every((c) => c.color !== 'rgba(0, 0, 0, 0)')).toBe(true);
        // The ink is the element's own colour (what currentColor paints on screen).
        expect(calls[0]!.color).toBe('rgb(255, 0, 0)');
    });

    it('a normal chip still rasterizes as a background box (nothing else changed)', () => {
        const el = document.createElement('span');
        el.style.cssText = 'width:20px;height:20px;background-color:rgb(9, 9, 9);';
        document.body.appendChild(el);
        box(el);
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        expect(calls).toEqual([{ op: 'fill', color: 'rgb(9, 9, 9)', kind: 'rect' }]);
    });

    it('an icon with no mask paints nothing at all (never a square)', () => {
        // Exactly what `iconGlyph('not-an-id')` builds: the class, the size, no mask —
        // and, because the paint travels WITH the mask, no background either.
        const el = document.createElement('span');
        el.className = 'vela-icon';
        el.style.cssText = 'width:16px;height:16px;';
        document.body.appendChild(el);
        box(el);
        const { ctx, calls } = recorder();
        rasterizeOverlay(ctx, el, FRAME);
        expect(calls).toHaveLength(0);
    });
});
