/**
 * Right-gutter column geometry, shared by the renderer (which reserves the gutter and
 * routes input) and the chrome layer (which draws the tick labels). The gutter holds the
 * pane's master price scale in the leftmost column (nearest the data), and one extra
 * column per merged (own-scale) indicator to its right.
 */
export const AXIS_MASTER_W = 64; // px — the pane master-scale column (nearest the data)
export const AXIS_MERGED_W = 56; // px — each additional merged-indicator scale column

/**
 * The master column for a chart this wide. A phone cell in a 4×2 grid is ~90px: a fixed
 * 64px column would leave almost no plot, so the column narrows as the chart does (the
 * tick labels switch to compact 84.5K-style notation at the same time — see
 * {@link axisCompact}). Desktop cells keep the full column.
 */
export function axisMasterWidth(chartWidth: number): number {
    if (!Number.isFinite(chartWidth) || chartWidth <= 0) return AXIS_MASTER_W;
    if (chartWidth < 150) return 34;
    if (chartWidth < 220) return 44;
    if (chartWidth < 320) return 54;
    return AXIS_MASTER_W;
}

/** Do this chart's axis labels need compact notation? Asked by the label formatter and
 *  by the axis-button cluster (which hides itself when the column gets too small). */
export function axisCompact(chartWidth: number): boolean {
    return axisMasterWidth(chartWidth) < AXIS_MASTER_W;
}

/** Thickness of the horizontal separator drawn at each stacked pane's top edge (data + gutter). */
export const PANE_SEPARATOR_PX = 3;

/** Total right-gutter width for a given number of merged scale columns (and, when
 *  known, the chart's own width — the master column narrows with it). */
export function axisGutterWidth(mergedColumns: number, chartWidth = 0): number {
    return axisMasterWidth(chartWidth) + AXIS_MERGED_W * Math.max(0, mergedColumns);
}

/** Left x (relative to the data area's right edge `dataW`) of a scale column.
 *  Column 0 is the master scale; columns ≥ 1 are merged-indicator scales. */
export function axisColumnX(dataW: number, column: number): number {
    return column === 0 ? dataW : dataW + AXIS_MASTER_W + (column - 1) * AXIS_MERGED_W;
}

/** Width of a scale column (master vs merged). */
export function axisColumnWidth(column: number): number {
    return column === 0 ? AXIS_MASTER_W : AXIS_MERGED_W;
}
