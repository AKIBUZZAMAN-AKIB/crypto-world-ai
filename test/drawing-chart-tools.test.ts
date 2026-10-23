// @vitest-environment jsdom
// The chart-management row on the shared drawing toolbar (the reference platform's
// Lock / Hide / Remove trio) plus the Zoom-in tool, and the workspace glue behind them:
// "lock all" really locks every drawing in one undoable step, "hide all" is a VIEW flag
// that touches nothing in the model, and a drawing TEMPLATE lands on what is selected.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

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

const ANCHORS = [
    { time: Date.UTC(2024, 0, 2), price: 100 },
    { time: Date.UTC(2024, 0, 9), price: 120 },
];

const btn = (host: HTMLElement, prefix: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>('.vela-dtb button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(prefix));

describe('the toolbar’s chart-management row', () => {
    it('renders Lock / Hide / Remove, disabled on an empty chart, and counts what it sees', () => {
        const ws = mount();
        const bar = [...document.querySelectorAll<HTMLElement>('.vela-dtb')].find((t) => t.getBoundingClientRect().height >= 0)!;
        expect(btn(bar, 'Lock all')).toBeTruthy();
        expect(btn(bar, 'Hide all')).toBeTruthy();
        expect(btn(bar, 'Remove')).toBeTruthy();
        expect([btn(bar, 'Lock all')!.disabled, btn(bar, 'Hide all')!.disabled, btn(bar, 'Remove')!.disabled]).toEqual([true, true, true]);

        ws.cells()[0]!.chart.drawings.add('trendline', { anchors: ANCHORS });
        expect(btn(bar, 'Lock all')!.disabled).toBe(false);
        expect(btn(bar, 'Hide all')!.getAttribute('aria-label')).toContain('(1)');
    });

    it('locks every drawing in one step and offers the unlock in the same button', () => {
        const ws = mount();
        const d = ws.cells()[0]!.chart.drawings;
        const a = d.add('trendline', { anchors: ANCHORS })!;
        const b = d.add('box', { anchors: ANCHORS })!;
        const bar = [...document.querySelectorAll<HTMLElement>('.vela-dtb')][0]!;
        btn(bar, 'Lock all')!.click();
        expect(d.all().map((x) => x.locked)).toEqual([true, true]);
        expect(btn(bar, 'Unlock all')?.dataset.active).toBe('1');
        btn(bar, 'Unlock all')!.click();
        expect(d.all().map((x) => x.locked)).toEqual([false, false]);
        void a;
        void b;
    });

    it('hide-all is a view flag: the model keeps every drawing and nothing is selected while hidden', () => {
        const ws = mount();
        const d = ws.cells()[0]!.chart.drawings;
        const one = d.add('trendline', { anchors: ANCHORS })!;
        d.select(one.id);
        const bar = [...document.querySelectorAll<HTMLElement>('.vela-dtb')][0]!;
        btn(bar, 'Hide all')!.click();
        expect(d.isHiddenAll()).toBe(true);
        expect(d.all()).toHaveLength(1);
        expect(d.selection()).toEqual([]);
        expect(btn(bar, 'Show all')?.dataset.active).toBe('1');
        btn(bar, 'Show all')!.click();
        expect(d.isHiddenAll()).toBe(false);
    });

    it('removes every drawing, and one undo brings them all back', () => {
        const ws = mount();
        const d = ws.cells()[0]!.chart.drawings;
        d.add('trendline', { anchors: ANCHORS });
        d.add('box', { anchors: ANCHORS });
        const bar = [...document.querySelectorAll<HTMLElement>('.vela-dtb')][0]!;
        btn(bar, 'Remove')!.click();
        expect(d.all()).toHaveLength(0);
        expect(ws.cells()[0]!.history.canUndo).toBe(true);
        ws.cells()[0]!.history.undo();
        expect(d.all()).toHaveLength(2);
    });
});

describe('a drawing template used from the library', () => {
    it('restyles the SELECTED drawings of its tool, merging — not replacing — the look', () => {
        const ws = mount();
        const d = ws.cells()[0]!.chart.drawings;
        const line = d.add('trendline', { anchors: ANCHORS, style: { lineColor: '#111111', lineWidth: 4, lineStyle: 'dotted' } })!;
        d.setToolTemplates({ trendline: [{ name: 'Blue', settings: { style: { lineColor: '#38c0fd' } } }] });
        d.select(line.id);
        ws.useDrawingTemplate('trendline', 'Blue');
        const after = d.all()[0]!;
        expect(after.style.lineColor).toBe('#38c0fd');
        expect(after.style.lineWidth).toBe(4); // a template names what it changes, nothing else
        expect(after.style.lineStyle).toBe('dotted');
    });

    it('seeds the next drawing when nothing of that tool is selected', () => {
        const ws = mount();
        const d = ws.cells()[0]!.chart.drawings;
        d.setToolTemplates({ trendline: [{ name: 'Blue', settings: { style: { lineColor: '#38c0fd', lineWidth: 3, lineStyle: 'dashed' } } }] });
        ws.useDrawingTemplate('trendline', 'Blue');
        expect(d.toolDefaults().trendline?.style?.lineColor).toBe('#38c0fd');
        const fresh = d.add('trendline', { anchors: ANCHORS })!;
        expect(fresh.style.lineWidth).toBe(3);
    });

    it('round-trips a template to JSON for export', () => {
        const ws = mount();
        ws.cells()[0]!.chart.drawings.setToolTemplates({ trendline: [{ name: 'Blue', settings: { style: { lineColor: '#38c0fd' } } }] });
        const json = ws.exportDrawingTemplate('trendline', 'Blue')!;
        expect(JSON.parse(json)).toMatchObject({ kind: 'drawing-template', tool: 'trendline', name: 'Blue' });
    });
});
