import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt, pointInBox } from '../hittest';

/** Approximate glyph advance for the box maths (the painter measures exactly). */
const CHAR_W = 0.6;
const LINE_H = 1.4;
const PAD = 8;

/** One table cell resolved to pixels. */
export interface TableCell {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Row 0 is the header row (drawn with the bold flag of the text style). */
    header: boolean;
}

/** The painted table: the outer box, the cell rects, and the grid lines. */
export interface TableLayout {
    box: { x: number; y: number; w: number; h: number };
    cells: TableCell[];
    rows: number;
    cols: number;
    /** Vertical/horizontal separators, `[x1, y1, x2, y2]`. */
    lines: Array<[number, number, number, number]>;
    fontSize: number;
}

const SIZE_PX: Record<string, number> = { tiny: 10, small: 12, normal: 14, large: 18, huge: 24, auto: 14 };

/**
 * A table: a grid of text cells pinned to one chart point. The text IS the content — each
 * LINE is a row and `|` separates the cells in it, so the ordinary text editor in the
 * settings panel is the cell editor (no bespoke grid UI to learn):
 *
 *     Symbol | BTCUSDT
 *     Entry  | 64,200
 *     Target | 68,000
 *
 * The first row is treated as the header. Row/column counts follow the text, so adding a
 * column is one more `|`.
 */
export class TableDrawing extends Drawing {
    readonly type = 'table' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'corner', free: 'both' }] };
    }

    /** The cell matrix parsed from the text: lines are rows, `|` splits columns. */
    cells(): string[][] {
        const raw = this.text?.value ?? 'Header | Value\nRow | 0';
        const rows = raw.split('\n').map((line) => line.split('|').map((c) => c.trim()));
        const cols = Math.max(1, ...rows.map((r) => r.length));
        return rows.map((r) => {
            const out = r.slice();
            while (out.length < cols) out.push('');
            return out;
        });
    }

    layout(proj: Projector): TableLayout | null {
        const a = this.anchors[0];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        if (y == null) return null;
        const x = proj.xOf(a.time);
        const matrix = this.cells();
        const rows = matrix.length;
        const cols = Math.max(1, ...matrix.map((r) => r.length));
        const fontSize = SIZE_PX[this.text?.size ?? 'normal'] ?? 14;
        const lineH = fontSize * LINE_H;
        // Column widths follow the widest cell in each column.
        const colW: number[] = [];
        for (let c = 0; c < cols; c += 1) {
            const widest = Math.max(1, ...matrix.map((r) => (r[c] ?? '').length));
            colW.push(Math.max(24, widest * fontSize * CHAR_W + PAD * 2));
        }
        const totalW = colW.reduce((s, w) => s + w, 0);
        const totalH = rows * lineH + PAD;
        const box = { x, y, w: totalW, h: totalH };
        const cells: TableCell[] = [];
        const lines: Array<[number, number, number, number]> = [];
        let cx = x;
        for (let c = 0; c < cols; c += 1) {
            cx += colW[c]!;
            lines.push([cx, y, cx, y + totalH]);
        }
        for (let r = 1; r < rows; r += 1) {
            const ly = y + PAD / 2 + r * lineH;
            lines.push([x, ly, x + totalW, ly]);
        }
        for (let r = 0; r < rows; r += 1) {
            let cellX = x;
            for (let c = 0; c < cols; c += 1) {
                cells.push({
                    text: matrix[r]![c] ?? '',
                    x: cellX + PAD,
                    y: y + PAD / 2 + r * lineH + fontSize,
                    w: colW[c]!,
                    h: lineH,
                    header: r === 0 && rows > 1,
                });
                cellX += colW[c]!;
            }
        }
        return { box, cells, rows, cols, lines, fontSize };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        return L != null && pointInBox(px, py, L.box.x, L.box.y, L.box.x + L.box.w, L.box.y + L.box.h, tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        if (!a) return [];
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? [] : [[proj.xOf(a.time), y]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const L = this.layout(proj);
        return L ? L.box : null;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS], textIsContent: true };
    }
}
