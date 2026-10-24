// A pinned note belongs to the SCREEN, not to a candle: its place is a fraction of the pane,
// so panning/zooming leave it alone and it never drags the price scale with it.
import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, PinnedNote, type Projector } from '../src/core/drawings';

const HR = 3600_000;

/** A 400×300 data area whose price pane starts at y = 40 (a legend strip above it). */
const proj: Projector = {
    xOf: (t) => t / HR,
    yOf: (price, paneId) => (paneId === 'price' ? 300 - price : null),
    pxToPoint: (x, y) => ({ time: x * HR, price: 300 - y }),
    paneIdAtY: () => 'price',
    paneRect: (paneId) => (paneId === 'price' ? { top: 40, height: 260 } : null),
    width: 400,
    height: 300,
};

function note(): PinnedNote {
    return createDrawing('pinnednote', {
        id: 'p',
        paneId: 'price',
        anchors: [{ time: 0, price: 0 }],
        text: { value: 'Thesis', size: 'normal', hAlign: 'left', vAlign: 'top' },
    }) as PinnedNote;
}

describe('pinned note — screen position', () => {
    it('starts near the pane’s top-left corner', () => {
        const p = note();
        const [x, y] = p.handlePoints(proj)[0]!;
        expect(x).toBeCloseTo(0.04 * 400, 9);
        expect(y).toBeCloseTo(40 + 0.06 * 260, 9); // inside the pane, not the whole canvas
    });

    it('resolves its fraction against the live pane, so a resize keeps the proportion', () => {
        const p = note();
        p.moveTo(0.5, 0.5);
        const [x, y] = p.handlePoints(proj)[0]!;
        expect(x).toBeCloseTo(200, 9);
        expect(y).toBeCloseTo(40 + 130, 9);
        const wide: Projector = { ...proj, width: 800, paneRect: () => ({ top: 0, height: 600 }) };
        expect(p.handlePoints(wide)[0]).toEqual([400, 300]);
    });

    it('clamps a drag that runs off the pane', () => {
        const p = note();
        p.moveTo(-2, 9);
        expect(p.position()).toEqual({ x: 0, y: 1 });
    });

    it('is never part of the price scale', () => {
        expect(note().priceRange()).toBeNull();
    });

    it('keeps its place across save/load', () => {
        const p = note();
        p.moveTo(0.25, 0.75);
        const back = deserializeDrawing(p.serialize()) as PinnedNote;
        expect(back.position()).toEqual({ x: 0.25, y: 0.75 });
    });

    it('drops where it was clicked', () => {
        const p = note();
        p.anchors = [{ time: 200 * HR, price: 100 }]; // the click: x = 200px, y = 200px
        p.onPlaced(proj);
        expect(p.position().x).toBeCloseTo(200 / 400, 9);
        expect(p.position().y).toBeCloseTo((200 - 40) / 260, 9);
    });

    it('a data drag leaves it where it is (it follows the screen, not the bars)', () => {
        const p = note();
        p.moveTo(0.3, 0.4);
        const before = p.handlePoints(proj)[0]!;
        p.anchors = [{ time: 5 * HR, price: 55 }]; // a whole-body drag rewrites the anchor
        expect(p.handlePoints(proj)[0]).toEqual(before);
    });
});
