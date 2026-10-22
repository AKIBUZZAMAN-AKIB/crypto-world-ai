// @vitest-environment jsdom
// Round-8 gaps 5, 8, 13 and 15 — the structural half (the browser checks in
// test/browser/ own the measured half):
//   5  the 16-chart ceiling is REACHABLE from the picker's canvas, not just the API
//   8  the matrix carries grid semantics, pressed chips and a polite live region
//   13 the desktop popover and the phone sheet expose the SAME link rows and table
//   15 every chart wears its slot number while a sync surface is up
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { SyncMatrix } from '../src/widget/sync-matrix';
import { layoutForGrid, layoutShape } from '../src/workspace/layouts';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS: OHLCV[] = Array.from({ length: 400 }, (_, i) => ({
    time: T0 + i * HOUR,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
}));

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '4', symbol: 'AAA', timeframe: '60', bars: 400, live: false, data: BARS, ...opts } as never);
    live.push(ws);
    return ws;
}

/** The private shell surface, as tests reach it (the browser checks use `window.__ws`). */
type Shell = {
    topbar: { openLayoutPicker(cellId?: string): void; layoutPicker: { close(): void } };
};
const shell = (ws: VelaWorkspace): Shell => ws as unknown as Shell;

const openPicker = (ws: VelaWorkspace): void => {
    shell(ws).topbar.openLayoutPicker();
};

const tick = async (ms = 160): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('gap 5 — the 16-chart grid', () => {
    it('the picker canvas maps a 4×4 square onto the 16 layout', () => {
        // The canvas square and the preset row are the SAME layout — one id, no duplicates.
        expect(layoutForGrid(4, 4).id).toBe('16');
        expect(layoutForGrid(2, 2).id).toBe('4');
        expect(layoutForGrid(3, 3).id).toBe('g3x3');
    });

    it('setLayout("16") builds sixteen live charts, and the picker reads the shape back', () => {
        const ws = mount();
        ws.setLayout('16');
        expect(ws.cells().length).toBe(16);
        expect(ws.getState().charts.length).toBe(16);
        expect(layoutShape(ws.layout)).toEqual({ rows: 4, cols: 4 });
    });

    it('a 16-cell workspace shrinks back to four and restores the same identities', () => {
        const ws = mount();
        const before = ws.cells().map((c) => c.id);
        ws.setLayout('16');
        ws.setLayout('4');
        expect(ws.cells().map((c) => c.id)).toEqual(before);
        expect(ws.hiddenChartCount).toBe(12);
    });
});

describe('gap 8 — grid semantics', () => {
    const mountMatrix = (setGroup?: (kind: string, cellId: string, mark: string | null) => void): { el: HTMLElement; matrix: SyncMatrix } => {
        const doc = document;
        const matrix = new SyncMatrix({
            doc,
            shell: 'desktop',
            onCycleCellGroup: () => {},
            onAllInOneGroup: () => {},
            ...(setGroup ? { onSetCellGroup: setGroup } : {}),
        });
        matrix.update(
            [
                { id: 'a', label: '1', symbol: 'AAA', active: true },
                { id: 'b', label: '2', symbol: 'BBB' },
            ],
            [
                { id: 'symbol', label: 'Symbol', marks: { a: '🔴', b: '🔴' } },
                { id: 'crosshair', label: 'Crosshair', marks: {} },
            ],
        );
        document.body.append(matrix.el);
        return { el: matrix.el, matrix };
    };

    it('the scroller is a grid with an explicit row/column count', () => {
        const { el } = mountMatrix();
        expect(el.getAttribute('role')).toBe('grid');
        expect(el.getAttribute('aria-label')).toContain('Chart syncing');
        expect(el.getAttribute('aria-rowcount')).toBe('3'); // header + 2 links
        expect(el.getAttribute('aria-colcount')).toBe('4'); // label + 2 charts + ALL
        // The header row is a row too (a grid's children must all be rows), and its cells
        // are column headers. The label column is a row header.
        const rows = [...el.querySelectorAll('.vela-md-matrix-row')];
        expect(rows.length).toBe(3);
        expect(rows.every((r) => r.getAttribute('role') === 'row')).toBe(true);
        expect(el.querySelectorAll('[role="columnheader"]').length).toBe(4); // corner + 2 charts + ALL
        expect(el.querySelector('.vela-md-matrix-label')?.getAttribute('role')).toBe('rowheader');
    });

    it('every chip says which link, which chart, and whether it is in a group', () => {
        const { el } = mountMatrix();
        const chips = [...el.querySelectorAll<HTMLElement>('.vela-md-matrix-chip[data-cell]')];
        expect(chips.length).toBe(4);
        // A <button> may not be a gridcell (ARIA in HTML). The CELL is the wrapper; the
        // control keeps its native button role.
        expect(chips.every((c) => c.tagName === 'BUTTON' && c.getAttribute('role') === null)).toBe(true);
        expect(chips.every((c) => c.parentElement?.getAttribute('role') === 'gridcell')).toBe(true);
        expect(chips.every((c) => c.getAttribute('aria-haspopup') === 'menu')).toBe(true);
        const red = el.querySelector<HTMLElement>('.vela-md-matrix-chip[data-kind="symbol"][data-cell="a"]')!;
        expect(red.getAttribute('aria-label')).toBe('Symbol for chart 1: 🔴');
        expect(red.dataset.on).toBe('1');
        const none = el.querySelector<HTMLElement>('.vela-md-matrix-chip[data-kind="crosshair"][data-cell="a"]')!;
        expect(none.getAttribute('aria-label')).toBe('Crosshair for chart 1: not linked');
        expect(none.dataset.on).toBeUndefined();
    });

    it('a group change is announced once, politely', () => {
        const { el, matrix } = mountMatrix();
        const live = el.querySelector('[aria-live="polite"]')!;
        expect(live.textContent).toBe(''); // arriving is not an edit
        matrix.update(
            [
                { id: 'a', label: '1', symbol: 'AAA', active: true },
                { id: 'b', label: '2', symbol: 'BBB' },
            ],
            [
                { id: 'symbol', label: 'Symbol', marks: { a: '🟡', b: '🔴' } },
                { id: 'crosshair', label: 'Crosshair', marks: {} },
            ],
        );
        expect(live.textContent).toBe('Symbol · chart 1: 🟡');
    });
});

describe('gap 13 — one surface, two shells', () => {
    it('the desktop popover and the phone sheet expose the same link rows', async () => {
        const ws = mount();
        openPicker(ws);
        await tick(); // the popover renders its rows on the next frame
        const desktop = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-sync-row .vela-lp-label')].map((e) => e.textContent);
        // The phone sheet is built by the drawer; build it through the workspace's own door.
        ws.openSyncDrawer?.();
        await tick(400);
        const phone = [...ws.root.querySelectorAll<HTMLElement>('.vela-md-sync[role="switch"] .vela-md-row-label')].map((e) => e.textContent);
        expect(desktop.length).toBeGreaterThan(0);
        expect(phone.length).toBeGreaterThan(0);
        expect(phone).toEqual(desktop);
    });

    it('both shells build the same table (rows and columns)', async () => {
        const ws = mount();
        openPicker(ws);
        await tick();
        ws.openSyncDrawer?.();
        const tables = [...ws.root.querySelectorAll<HTMLElement>('.vela-md-matrixwrap')];
        const shapes = tables.map((t) => ({
            shell: t.closest('.vela-lp') ? 'desktop' : 'phone',
            rows: [...t.querySelectorAll<HTMLElement>('.vela-md-matrix-label')].map((l) => l.textContent),
            cols: t.querySelectorAll('.vela-md-matrix-head[data-cell]').length,
            cells: t.querySelectorAll('.vela-md-matrix-chip[data-cell]').length,
        }));
        const desktop = shapes.find((s) => s.shell === 'desktop');
        const phone = shapes.find((s) => s.shell === 'phone');
        expect(desktop && phone).toBeTruthy();
        expect(phone!.rows).toEqual(desktop!.rows);
        expect(phone!.cols).toBe(desktop!.cols);
        expect(phone!.cells).toBe(desktop!.cells);
    });
});

describe('gap 15 — the numbers are on the charts', () => {
    it('every live chart wears its slot number, and the surface toggles the reveal', () => {
        const ws = mount();
        const numbers = [...ws.root.querySelectorAll<HTMLElement>('.vela-sl-symbol[data-chart-no]')].map((e) => e.dataset.chartNo);
        expect(numbers).toEqual(['1', '2', '3', '4']);
        expect(ws.root.hasAttribute('data-sync-open')).toBe(false);
        openPicker(ws);
        expect(ws.root.hasAttribute('data-sync-open')).toBe(true);
        shell(ws).topbar.layoutPicker.close();
        expect(ws.root.hasAttribute('data-sync-open')).toBe(false);
    });

    it('renumbering follows a layout switch (slot order, not declaration order)', () => {
        const ws = mount();
        ws.setLayout('2v');
        const numbers = ws.cells().map((c) => c.host.querySelector('.vela-sl-symbol')?.getAttribute('data-chart-no'));
        expect(numbers).toEqual(['1', '2']);
    });
});
