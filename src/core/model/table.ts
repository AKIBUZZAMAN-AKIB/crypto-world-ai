// TEXT LAYOUT FOR TABLE OBJECTS (Tier-3 #14, second half).
//
// A Table drawing is not a special case of a box: it is text laid out in a grid, and the
// hard part is measuring — how wide each column wants to be, how tall a row is once a cell
// wraps, and what the whole thing does when the document's font changes. The renderer's
// drawing layer paints plates, not glyph runs, so the MEASURE has to happen in the model.
//
// This module is that measure, and it is deliberately font-agnostic: the caller supplies a
// character advance (`charWidth`) measured once from the chart's font, and the layout is
// pure arithmetic from there — deterministic, testable, and identical on every backend.
// Wrapping is by WORD (a long word is broken mid-token rather than overflowing the cell),
// which is what a trader expects from a table cell and what the reference does.
export interface TableCell {
    text: string;
}

/** Borders on each side; a table with none is a floating text block. */
export interface TableBorder {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
    /** Draw the inner rules between rows / columns. */
    innerH: boolean;
    innerV: boolean;
}

export interface TableSpec {
    /** One entry per column; `null` means "size to content". */
    cols: Array<number | null>;
    rows: string[][];
    /** Cell padding in px (applied on all four sides). */
    padding: number;
    /** Line height in px. */
    lineHeight: number;
    /** Character advance in px for the font the table is drawn in. */
    charWidth: number;
    /** Hard ceiling on the table's width in px (cells then wrap). */
    maxWidth: number;
    /** Header row styling hint (the first row is drawn bolder / with a rule under it). */
    header?: boolean;
    border?: Partial<TableBorder>;
}

export const DEFAULT_TABLE: Omit<TableSpec, 'rows'> = {
    cols: [null],
    padding: 6,
    lineHeight: 16,
    charWidth: 7,
    maxWidth: 320,
    header: true,
    border: { top: true, right: true, bottom: true, left: true, innerH: true, innerV: true },
};

/** Greedy word wrap to a character budget; a word longer than the budget is broken. */
export function wrapText(text: string, maxChars: number): string[] {
    const limit = Math.max(1, Math.floor(maxChars));
    const words = text.replace(/\r\n?/g, '\n').split(/(\s+)/); // keep the whitespace runs
    const lines: string[] = [];
    let line = '';
    const flush = (): void => {
        lines.push(line);
        line = '';
    };
    for (const token of words) {
        if (token === '\n') {
            flush();
            continue;
        }
        if (/^\s+$/.test(token)) {
            if (line.length > 0) line += ' ';
            continue;
        }
        let word = token;
        while (word.length > limit) {
            if (line.length > 0) flush();
            lines.push(word.slice(0, limit));
            word = word.slice(limit);
        }
        if (line.length + word.length > limit) {
            if (line.length > 0) flush();
            line = word;
        } else {
            line += word;
        }
    }
    if (line.length > 0 || lines.length === 0) flush();
    return lines.map((l) => l.replace(/\s+$/, ''));
}

export interface TableLayout {
    /** Resolved column widths in px (content or declared, capped by maxWidth). */
    colWidths: number[];
    /** Each row's height in px (after wrapping). */
    rowHeights: number[];
    /** Wrapped text per (row, col). */
    cellLines: string[][][];
    width: number;
    height: number;
    /** Column x offsets, relative to the table's left edge. */
    colX: number[];
    /** Row y offsets, relative to the table's top edge. */
    rowY: number[];
}

/** Lay a table out. Pure: same spec in, same geometry out — no fonts, no DOM. */
export function measureTable(spec: TableSpec): TableLayout {
    const pad = Math.max(0, spec.padding);
    const cw = Math.max(1, spec.charWidth);
    const rows = spec.rows.length > 0 ? spec.rows : [['']];
    const colCount = Math.max(spec.cols.length, ...rows.map((r) => r.length), 1);

    // Natural width = the longest cell in the column, in characters.
    const natural: number[] = [];
    for (let c = 0; c < colCount; c += 1) {
        let chars = 1;
        for (const row of rows) chars = Math.max(chars, (row[c] ?? '').length);
        natural.push(chars * cw + pad * 2);
    }
    // Declared widths win; content widths then share whatever room is left under maxWidth.
    const declared = Array.from({ length: colCount }, (_, c) => spec.cols[c]);
    const fixedTotal = declared.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
    const flexCols = declared.filter((w) => typeof w !== 'number').length;
    const room = Math.max(0, spec.maxWidth - fixedTotal);
    const flexNatural = declared.reduce<number>((s, w, c) => s + (typeof w === 'number' ? 0 : natural[c]!), 0);
    const scale = flexCols === 0 || flexNatural === 0 ? 1 : Math.min(1, room / flexNatural);
    const colWidths = declared.map((w, c) => Math.max(cw + pad * 2, Math.round(typeof w === 'number' ? w : natural[c]! * scale)));

    const cellLines: string[][][] = [];
    const rowHeights: number[] = [];
    for (const row of rows) {
        const lines: string[][] = [];
        let tallest = 1;
        for (let c = 0; c < colCount; c += 1) {
            const innerChars = Math.max(1, Math.floor((colWidths[c]! - pad * 2) / cw));
            const wrapped = wrapText(row[c] ?? '', innerChars);
            lines.push(wrapped);
            tallest = Math.max(tallest, wrapped.length);
        }
        cellLines.push(lines);
        rowHeights.push(tallest * spec.lineHeight + pad * 2);
    }

    const colX: number[] = [];
    let x = 0;
    for (const w of colWidths) {
        colX.push(x);
        x += w;
    }
    const rowY: number[] = [];
    let y = 0;
    for (const h of rowHeights) {
        rowY.push(y);
        y += h;
    }
    return { colWidths, rowHeights, cellLines, width: x, height: y, colX, rowY };
}

/** The border flags with the drawing defaults filled in. */
export function tableBorders(spec: TableSpec): TableBorder {
    return { top: true, right: true, bottom: true, left: true, innerH: true, innerV: true, ...spec.border };
}
