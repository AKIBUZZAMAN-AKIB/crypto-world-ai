// @vitest-environment jsdom
// A DRAWING SET template is a real bundle: geometry is relative (time offset + price
// ratio), insertion is one undo step, and the document round-trips it. These tests pin
// the contract the object tree and the phone library both drive.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { sanitizeDrawingSetTemplates } from '../src/state/document';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mount(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1' } as never);
    live.push(ws);
    return ws;
}

const T0 = Date.UTC(2024, 0, 2);
const HOUR = 3_600_000;

function seed(ws: VelaWorkspace): string[] {
    const d = ws.cells()[0]!.chart.drawings;
    const a = d.add('trendline', { anchors: [{ time: T0, price: 100 }, { time: T0 + 4 * HOUR, price: 120 }] })!;
    const b = d.add('hline', { anchors: [{ time: T0 + 2 * HOUR, price: 110 }] })!;
    return [a.id, b.id];
}

describe('drawing set templates', () => {
    it('saves a bundle with RELATIVE geometry, not absolute prices and times', () => {
        const ws = mount();
        const ids = seed(ws);
        expect(ws.saveDrawingSetTemplate('Breakout', ids)).toBe(true);

        const list = ws.drawingSetTemplateList();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ name: 'Breakout', count: 2 });

        const saved = ws.getState().drawingSetTemplates?.Breakout;
        expect(saved?.version).toBe(1);
        expect(saved?.spanMs).toBe(4 * HOUR);
        expect(saved?.basePrice).toBe(100);
        expect(saved?.drawings[0]?.anchors.map((a) => a.dt)).toEqual([0, 4 * HOUR]);
        expect(saved?.drawings[0]?.anchors.map((a) => a.ratio)).toEqual([1, 1.2]);
        expect(saved?.drawings[1]?.anchors[0]?.dt).toBe(2 * HOUR);
        expect(saved?.drawings[1]?.anchors[0]?.ratio).toBe(1.1);
    });

    it('inserts the set as one step, preserving the shape and selecting the bundle', () => {
        const ws = mount();
        const ids = seed(ws);
        ws.saveDrawingSetTemplate('Breakout', ids);
        const before = ws.cells()[0]!.chart.drawings.all().length;
        expect(ws.insertDrawingSetTemplate('Breakout')).toBe(2);
        const all = ws.cells()[0]!.chart.drawings.all();
        expect(all).toHaveLength(before + 2);
        const fresh = all.slice(-2);
        expect(fresh.map((d) => d.type)).toEqual(['trendline', 'hline']);
        // Relative geometry survives: 4h span, 20% rise, hline halfway up.
        const line = fresh[0]!.anchors;
        expect(line[1]!.time - line[0]!.time).toBe(4 * HOUR);
        expect(line[1]!.price / line[0]!.price).toBeCloseTo(1.2, 6);
        const h = fresh[1]!.anchors[0]!;
        expect(h.time - line[0]!.time).toBe(2 * HOUR);
        expect(h.price / line[0]!.price).toBeCloseTo(1.1, 6);
    });

    it('renames, exports/imports and deletes without silently overwriting', () => {
        const ws = mount();
        seed(ws);
        ws.saveDrawingSetTemplate('Breakout', ws.cells()[0]!.chart.drawings.all().map((d) => d.id));
        expect(ws.renameDrawingSetTemplate('Breakout', 'Breakout v2')).toBe(true);
        const json = ws.exportDrawingSetTemplate('Breakout v2');
        expect(json).toContain('drawing-set-template');
        expect(ws.importDrawingSetTemplate(json!)).toBe('Breakout v2 2');
        expect(ws.drawingSetTemplateList().map((t) => t.name)).toEqual(['Breakout v2', 'Breakout v2 2']);
        expect(ws.deleteDrawingSetTemplate('Breakout v2')).toBe(true);
        expect(ws.drawingSetTemplateList().map((t) => t.name)).toEqual(['Breakout v2 2']);
    });

    it('rejects an empty pick, a bad name and an unknown drawing id', () => {
        const ws = mount();
        expect(ws.saveDrawingSetTemplate('', [])).toBe(false);
        expect(ws.saveDrawingSetTemplate('Ghost', ['does-not-exist'])).toBe(false);
        expect(ws.drawingSetTemplateList()).toEqual([]);
    });
});

describe('drawing set template sanitizer', () => {
    it('keeps finite geometry and bounded style bags, drops malformed entries', () => {
        const clean = sanitizeDrawingSetTemplates({
            Good: {
                version: 1,
                basePrice: 100,
                spanMs: 3600000,
                createdAt: 1,
                drawings: [
                    { type: 'trendline', paneId: 'price', anchors: [{ dt: 0, ratio: 1 }, { dt: 3600000, ratio: 1.1 }], z: 0, visible: true, locked: false, style: { lineColor: '#fff' } },
                    { type: 'hline', paneId: 'price', anchors: [{ dt: 'bad', ratio: Number.NaN }], z: 1, style: {} },
                ],
            },
            Bad: { version: 2, drawings: [] },
            Nope: { version: 1, drawings: [{ type: 'hline', paneId: 'price', anchors: [] }] },
        });
        expect(Object.keys(clean ?? {})).toEqual(['Good']);
        const good = clean?.Good;
        expect(good?.drawings).toHaveLength(2);
        expect(good?.drawings[1]?.anchors[0]).toEqual({ dt: 0, ratio: 1 });
        expect(good?.drawings[0]?.style).toEqual({ lineColor: '#fff' });
    });
});
