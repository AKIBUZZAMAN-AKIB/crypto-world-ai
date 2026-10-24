import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt, pointInBox } from '../hittest';

/** Approximate glyph advance for the box maths (the painter measures exactly). */
const CHAR_W = 0.6;
const LINE_H = 1.4;
const PAD = 8;
/** The narrowest a dragged column may get / the widest, in px. */
const MIN_COL_W = 24;
const MAX_COL_W = 900;

/** One table cell resolved to pixels. */
export interface TableCell {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** The cell's own rect (its column's x range × its row's y range) — what a click and the
     *  inline editor work against, and the clip a long value is trimmed to. */
    box: { x: number; y: number; w: number; h: number };
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
 *
 * On the chart the same matrix is edited directly: a double-click on a cell edits that cell,
 * and dragging a column's separator sizes that column (kept per column in `props.colWidths`,
 * so a saved layout restores the widths).
 */
export class TableDrawing extends Drawing {
    readonly type = 'table' as const;
    /** Manual column widths (px), index = column. A 0/absent entry falls back to the text's
     *  own width, so a table that was never resized always fits its content.
     *  Declared WITHOUT an initializer on purpose: the base constructor calls `readProps`
     *  before subclass fields initialise, so a `= []` here would wipe the saved widths on load. */
    private colPx?: number[];

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
        // Column widths follow the widest cell in each column, unless the column was dragged
        // to a width of its own (then that width wins, and long text clips in its cell).
        const colW: number[] = [];
        for (let c = 0; c < cols; c += 1) {
            const widest = Math.max(1, ...matrix.map((r) => (r[c] ?? '').length));
            const auto = Math.max(24, widest * fontSize * CHAR_W + PAD * 2);
            const manual = this.colPx?.[c] ?? 0;
            colW.push(manual >= MIN_COL_W ? manual : auto);
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
            const rowTop = y + PAD / 2 + r * lineH;
            for (let c = 0; c < cols; c += 1) {
                cells.push({
                    text: matrix[r]![c] ?? '',
                    x: cellX + PAD,
                    y: rowTop + fontSize,
                    w: colW[c]!,
                    h: lineH,
                    box: { x: cellX, y: rowTop, w: colW[c]!, h: lineH },
                    header: r === 0 && rows > 1,
                });
                cellX += colW[c]!;
            }
        }
        return { box, cells, rows, cols, lines, fontSize };
    }

    /** The column count the text currently describes (the grid's own notion of "how wide"). */
    columnCount(): number {
        return Math.max(1, ...this.cells().map((r) => r.length));
    }

    /** The cell under a point, with the rect it paints in (what the inline editor overlays). */
    cellAt(px: number, py: number, proj: Projector): { row: number; col: number; box: { x: number; y: number; w: number; h: number } } | null {
        const L = this.layout(proj);
        if (!L) return null;
        if (px < L.box.x || px > L.box.x + L.box.w || py < L.box.y || py > L.box.y + L.box.h) return null;
        const lineH = L.cells[0]?.h ?? L.fontSize * LINE_H;
        const row = Math.min(L.rows - 1, Math.max(0, Math.floor((py - L.box.y) / lineH)));
        const cell = L.cells[row * L.cols + this.colAt(L, px)];
        return cell ? { row, col: this.colAt(L, px), box: cell.box } : null;
    }

    /** Which column a point falls in — the columns share their x range on every row. */
    private colAt(L: TableLayout, px: number): number {
        for (let c = 0; c < L.cols; c += 1) {
            const box = L.cells[c]!.box;
            if (px >= box.x && px <= box.x + box.w) return c;
        }
        return px < L.box.x ? 0 : L.cols - 1;
    }

    /** The column separator under a point (its right edge), or null — the resize grab. */
    columnEdgeAt(px: number, py: number, proj: Projector, tol: number): { col: number; width: number } | null {
        const L = this.layout(proj);
        if (!L) return null;
        if (py < L.box.y || py > L.box.y + L.box.h) return null;
        for (let c = 0; c < L.cols; c += 1) {
            const box = L.cells[c]!.box;
            if (Math.abs(px - (box.x + box.w)) <= tol) return { col: c, width: box.w };
        }
        return null;
    }

    /** Write one cell's text back into the matrix the drawing is made of. */
    setCellText(row: number, col: number, value: string): void {
        const clean = value.replace(/[\n\r]/g, ' ').replace(/\|/g, '/').trim();
        const rows = this.cells();
        const width = Math.max(col + 1, ...rows.map((r) => r.length));
        const matrix = rows.map((r) => {
            const out = r.slice();
            while (out.length < width) out.push('');
            return out;
        });
        while (matrix.length <= row) matrix.push(new Array(width).fill(''));
        matrix[row]![col] = clean;
        this.setTableText(matrix.map((r) => r.join(' | ')).join('\n'));
    }

    /** Give a column a width of its own (a separator drag). Clamped so it stays grabbable. */
    setColumnWidth(col: number, px: number): void {
        const widths = (this.colPx ??= []);
        while (widths.length <= col) widths.push(0);
        widths[col] = Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(px)));
    }

    /** Drop every manual width — the columns go back to hugging their text. */
    resetColumnWidths(): void {
        this.colPx = [];
    }

    /** Replace the whole text (the cell writer's commit path; also what the settings panel uses). */
    private setTableText(value: string): void {
        this.applySettings({ 'text.value': value });
    }

    protected override writeProps(): Record<string, unknown> {
        const widths = this.colPx ?? [];
        return widths.some((w) => w > 0) ? { colWidths: widths.slice() } : {};
    }

    protected override readProps(props: Record<string, unknown>): void {
        const raw = props.colWidths;
        this.colPx = Array.isArray(raw) ? raw.map((w) => (typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0)) : [];
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
