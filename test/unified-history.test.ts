// @vitest-environment jsdom
// TradingView's Undo/Redo covers ALL chart changes, not just drawing CRUD. The workspace
// keeps precise per-object steps and coalesced state snapshots in one composite timeline.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { sanitizeState } from '../src/state/document';

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const anchors = [{ time: 1, price: 1 }, { time: 2, price: 2 }];

describe('composite chart history', () => {
    it('captures a chart-setting change and its redo, then restores the exact state', async () => {
        const ws = mount();
        await wait(140);
        const before = ws.active.priceStyle;
        ws.active.setPriceStyle('line');
        await wait(140);
        expect(ws.active.priceStyle).toBe('line');
        expect(ws.canUndo).toBe(true);

        ws.undo();
        await wait(180);
        expect(ws.active.priceStyle).toBe(before);
        expect(ws.canRedo).toBe(true);

        ws.redo();
        await wait(180);
        expect(ws.active.priceStyle).toBe('line');
    });

    it('captures layout-management preferences that are not chart objects', async () => {
        const ws = mount();
        await wait(140);
        ws.setLayoutSharing(true);
        await wait(140);
        expect(ws.getState().layoutPrefs?.sharing).toBe(true);

        ws.undo();
        await wait(180);
        expect(ws.getState().layoutPrefs?.sharing).toBeUndefined();
        ws.redo();
        await wait(180);
        expect(ws.getState().layoutPrefs?.sharing).toBe(true);
    });

    it('records one delegate step for a multi-drawing transaction, not one per drawing', async () => {
        const ws = mount();
        await wait(140);
        const drawings = ws.active.chart.drawings;
        let a = '';
        let b = '';
        ws.active.history.silently(() => {
            a = drawings.add('hline', { anchors: [anchors[0]!] })!.id;
            b = drawings.add('hline', { anchors: [anchors[1]!] })!.id;
        });
        await wait(140);
        const before = new Map(drawings.all().map((d) => [d.id, d.zIndex]));
        drawings.updateMany([
            { id: a, patch: { zIndex: 21 } },
            { id: b, patch: { zIndex: 22 } },
        ]);
        await wait(140);
        expect(drawings.all().map((d) => d.zIndex)).toEqual([21, 22]);
        expect(ws.canUndo).toBe(true);

        ws.undo();
        await wait(180);
        expect(drawings.all().map((d) => [d.id, d.zIndex])).toEqual([...before].map(([id, z]) => [id, z]));
        // No surplus drawing delegate and no duplicate snapshot entry remain.
        const cellHistory = ws.active.history;
        expect(cellHistory.canUndo).toBe(false);
    });

    it('one visual-order transaction does not leave duplicate drawing history steps', async () => {
        const ws = mount();
        await wait(140);
        const drawings = ws.active.chart.drawings;
        let a = '';
        let b = '';
        ws.active.history.silently(() => {
            a = drawings.add('hline', { anchors: [anchors[0]!] })!.id;
            b = drawings.add('hline', { anchors: [anchors[1]!] })!.id;
        });
        await wait(140);
        drawings.updateMany([
            { id: a, patch: { zIndex: 11 } },
            { id: b, patch: { zIndex: 12 } },
        ]);
        await wait(140);
        ws.undo();
        await wait(180);
        expect(ws.active.history.canUndo).toBe(false);
    });
});

describe('durable history fields', () => {
    it('sanitizes pane stack, runtime flags and object-tree groups', () => {
        const state = sanitizeState({
            version: 1,
            layout: '1',
            charts: [
                {
                    id: 'c1',
                    runtime: { candleVisible: false, autoScale: false, malicious: 1 },
                    panes: [
                        { id: 'price', kind: 'price', order: 0, collapsed: false, maximized: false, indicators: [{ id: 'native-2', ownScale: true, title: 'ignored' }] },
                        { id: 'pane-1', kind: 'study', order: 1, collapsed: true, maximized: false, indicators: [] },
                    ],
                    objectTreeGroups: [{ id: 'grp-1', name: 'Levels', ids: ['dw-1', 'dw-2'], parent: 'grp-0', junk: true }],
                },
            ],
        });
        expect(state).not.toBeNull();
        const cell = state!.charts[0]!;
        expect(cell.runtime).toEqual({ candleVisible: false, autoScale: false });
        expect(cell.panes?.map((p) => p.id)).toEqual(['price', 'pane-1']);
        expect(cell.panes?.[0]?.indicators).toEqual([{ id: 'native-2', ownScale: true }]);
        expect(cell.objectTreeGroups).toEqual([{ id: 'grp-1', name: 'Levels', ids: ['dw-1', 'dw-2'], parent: 'grp-0' }]);
    });
});
