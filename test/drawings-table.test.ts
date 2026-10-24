// The table tool's cell grid: click-to-edit targets, the column-separator grab, and the
// per-column widths that survive a save. The text matrix stays the source of truth, so a
// cell edit and the settings panel's textarea can never disagree.
import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, TableDrawing, type Projector } from '../src/core/drawings';

/** 1 px per bar, 1 px per price unit, one 'price' pane, top-left at (0, 0). */
const proj: Projector = {
    xOf: (t) => t,
    yOf: (price, paneId) => (paneId === 'price' ? 200 - price : null),
    pxToPoint: (x, y) => ({ time: x, price: 200 - y }),
    paneIdAtY: () => 'price',
    width: 600,
    height: 400,
};

function table(text = 'Symbol | BTCUSDT\nEntry | 64,200\nTarget | 68,000'): TableDrawing {
    return createDrawing('table', {
        id: 't',
        paneId: 'price',
        anchors: [{ time: 20, price: 150 }],
        text: { value: text, size: 'normal', hAlign: 'left', vAlign: 'top' },
    }) as TableDrawing;
}

describe('table — cells', () => {
    it('parses a ragged matrix into a rectangle', () => {
        const t = table('A | B | C\nD\nE | F');
        expect(t.cells()).toEqual([
            ['A', 'B', 'C'],
            ['D', '', ''],
            ['E', 'F', ''],
        ]);
        expect(t.columnCount()).toBe(3);
    });

    it('finds the cell under a point, row-major, with its own rect', () => {
        const t = table();
        const L = t.layout(proj)!;
        const second = L.cells[1]!; // row 0, col 1 — "BTCUSDT"
        const hit = t.cellAt(second.box.x + 4, second.box.y + 4, proj)!;
        expect(hit.row).toBe(0);
        expect(hit.col).toBe(1);
        expect(hit.box).toEqual(second.box);
    });

    it('a point outside the box is nobody’s cell', () => {
        const t = table();
        const L = t.layout(proj)!;
        expect(t.cellAt(L.box.x - 20, L.box.y - 20, proj)).toBeNull();
        expect(t.cellAt(L.box.x + L.box.w + 20, L.box.y + 4, proj)).toBeNull();
    });

    it('writes one cell back into the text without disturbing the others', () => {
        const t = table();
        t.setCellText(1, 1, 'BTC');
        expect(t.cells()).toEqual([
            ['Symbol', 'BTCUSDT'],
            ['Entry', 'BTC'],
            ['Target', '68,000'],
        ]);
        expect(t.text!.value.split('\n')[1]).toBe('Entry | BTC'); // the matrix is the text
    });

    it('a typed value cannot invent rows or columns', () => {
        const t = table('A | B\nC | D');
        t.setCellText(0, 0, 'x|y\nz');
        expect(t.columnCount()).toBe(2);
        expect(t.cells()[0]).toEqual(['x/y z', 'B']);
        t.setCellText(4, 3, 'Far'); // past the grid → the grid grows to hold it
        expect(t.cells().length).toBe(5);
        expect(t.columnCount()).toBe(4);
        expect(t.cells()[4]![3]).toBe('Far');
    });
});

describe('table — column resize', () => {
    it('auto-sizes each column to its widest cell until one is dragged', () => {
        const t = table();
        const before = t.layout(proj)!;
        expect(before.cols).toBe(2);
        t.setColumnWidth(0, 140);
        const after = t.layout(proj)!;
        expect(after.cells[0]!.box.w).toBe(140);
        expect(after.cells[1]!.box.w).toBe(before.cells[1]!.box.w); // the neighbour is untouched
        expect(after.box.x + after.box.w).toBeCloseTo(before.box.x + before.box.w - before.cells[0]!.box.w + 140, 6);
    });

    it('clamps a drag to something still grabbable', () => {
        const t = table();
        t.setColumnWidth(0, 2);
        expect(t.layout(proj)!.cells[0]!.box.w).toBe(24);
        t.setColumnWidth(0, 5000);
        expect(t.layout(proj)!.cells[0]!.box.w).toBe(900);
    });

    it('finds the separator under the pointer, per column', () => {
        const t = table('AAAAAAAAAAAA | BBBBBBBBBBBB | C\nD | E | F');
        const L = t.layout(proj)!;
        const edge0 = L.cells[0]!.box.x + L.cells[0]!.box.w;
        expect(t.columnEdgeAt(edge0 + 2, L.box.y + 4, proj, 5)).toEqual({ col: 0, width: L.cells[0]!.box.w });
        expect(t.columnEdgeAt(edge0 + 40, L.box.y + 4, proj, 5)).toBeNull(); // mid-column, not a grab
        expect(t.columnEdgeAt(edge0 + 2, L.box.y - 30, proj, 5)).toBeNull(); // above the table
    });

    it('carries the widths through save/load', () => {
        const t = table();
        t.setColumnWidth(0, 120);
        t.setColumnWidth(1, 90);
        const doc = t.serialize();
        expect(doc.props).toEqual({ colWidths: [120, 90] });
        const back = deserializeDrawing(doc) as TableDrawing;
        expect(back.layout(proj)!.cells[0]!.box.w).toBe(120);
        expect(back.layout(proj)!.cells[1]!.box.w).toBe(90);
        back.resetColumnWidths();
        expect(back.serialize().props).toEqual({}); // back to hugging the text
    });
});
