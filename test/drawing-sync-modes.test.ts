// @vitest-environment jsdom
// R86 Tasks 2 + 6 — TradingView-like per-object/group drawing sync modes and an explicit
// "sync to this chart" scope, applied on demand. These tests pin the workspace contract the
// object tree's Manage objects dialog and context menu drive.
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

function mount(layout = '1'): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout } as never);
    live.push(ws);
    return ws;
}

const T0 = Date.UTC(2024, 0, 2);
const HOUR = 3_600_000;

function seed(ws: VelaWorkspace): string[] {
    const d = ws.cell('c1')!.chart.drawings;
    const a = d.add('trendline', { anchors: [{ time: T0, price: 100 }, { time: T0 + 4 * HOUR, price: 120 }] })!;
    const b = d.add('hline', { anchors: [{ time: T0 + 2 * HOUR, price: 110 }] })!;
    return [a.id, b.id];
}

describe('drawing sync modes', () => {
    it('persists the three named scopes and a default for new objects', () => {
        const ws = mount();
        const [a, b] = seed(ws);
        ws.setDrawingSyncDefault('layout');
        ws.setDrawingSyncMode([a!], 'layout');
        ws.setDrawingSyncMode([b!], 'global');
        expect(ws.drawingSyncMode(a!)).toBe('layout');
        expect(ws.drawingSyncMode(b!)).toBe('global');
        const state = ws.getState();
        expect(state.drawingSyncDefault).toBe('layout');
        expect(state.drawingSync?.[a!]?.mode).toBe('layout');
        expect(state.drawingSync?.[b!]?.mode).toBe('global');
        expect(sanitizeState(state)?.drawingSync?.[a!]?.mode).toBe('layout');
    });

    it('syncs in the layout on demand and refreshes the copy without duplicating it', () => {
        const ws = mount('2h');
        const [a, b] = seed(ws);
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
        ws.setDrawingSyncMode([a!], 'layout');
        const copies = ws.cell('c2')!.chart.drawings.all();
        expect(copies).toHaveLength(1);
        expect(copies[0]!.type).toBe('trendline');
        expect(copies[0]!.anchors[1]!.price).toBe(120);
        // b is not synced, so it stays local.
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);

        ws.cell('c1')!.chart.drawings.update(a!, { anchors: [{ time: T0, price: 100 }, { time: T0 + 5 * HOUR, price: 150 }] });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors[1]!.price).toBe(120); // on demand, not live
        expect(ws.applyDrawingSync([a!])).toBe(1);
        const after = ws.cell('c2')!.chart.drawings.all();
        expect(after).toHaveLength(1);
        expect(after[0]!.anchors[1]!.price).toBe(150);

        ws.setDrawingSyncMode([a!], 'none');
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
    });

    it('syncs an object/group to one specific chart only', () => {
        const ws = mount('4');
        const [a, b] = seed(ws);
        // A group is just a list of member ids at the workspace seam.
        ws.setDrawingSyncMode([a!, b!], 'charts', ['c3']);
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
        expect(ws.cell('c3')!.chart.drawings.all()).toHaveLength(2);
        expect(ws.cell('c4')!.chart.drawings.all()).toHaveLength(0);
        expect(ws.drawingSyncRows().filter((r) => [a!, b!].includes(r.id)).map((r) => r.mode)).toEqual(['charts', 'charts']);
        expect(ws.drawingSyncRows().find((r) => r.id === a!)?.charts).toEqual(['c3']);
    });

    it('restores the scopes from a saved workspace state', () => {
        const ws = mount();
        const [a] = seed(ws);
        ws.setDrawingSyncMode([a!], 'global');
        const state = ws.getState();
        const restored = mount();
        restored.applyState(state);
        expect(restored.drawingSyncMode(a!)).toBe('global');
    });
});
