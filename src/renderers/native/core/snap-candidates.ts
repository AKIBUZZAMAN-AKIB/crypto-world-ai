// The magnet's candidate set, kept pure so it can be reasoned about (and tested) without
// a renderer, a canvas, or a projector.
//
// Why this exists at all: "snap to indicators" does not change HOW the magnet pulls, only
// WHAT it can attach to. The reference platform states it exactly that way — an overlay
// indicator's value becomes an attachment point "just like they do with price" — so the
// strength (weak/strong) stays a single, separate control.

/** The four candle prices a magnet can attach to, in OHLC order. */
export function candlePrices(bar: { open: number; high: number; low: number; close: number } | undefined | null): number[] {
    if (!bar) return [];
    const out = [bar.open, bar.high, bar.low, bar.close];
    return out.every((v) => Number.isFinite(v)) ? out : out.filter((v) => Number.isFinite(v));
}

/**
 * Pick the candidate closest to the cursor IN PIXELS.
 *
 * Value distance is the wrong metric: on a log or percent axis the same price delta is a
 * different gap at the top of the pane than at the bottom, so a snap that "looks" nearest
 * would sometimes jump past the line under the cursor. A candidate whose projection is
 * undefined (outside the scale) is skipped rather than treated as nearest.
 *
 * Returns `fallback` when nothing can be projected — never NaN.
 */
export function nearestByPixel(
    candidates: readonly number[],
    cursorY: number,
    yOf: (value: number) => number | null | undefined,
    fallback: number,
): number {
    let best = fallback;
    let bestDist = Infinity;
    for (const value of candidates) {
        if (!Number.isFinite(value)) continue;
        const y = yOf(value);
        if (y == null || !Number.isFinite(y)) continue;
        const d = Math.abs(y - cursorY);
        // `<` (not `<=`) keeps the FIRST winner on a tie, which is the order the caller
        // built: OHLC before indicator values, so a candle wins a dead heat.
        if (d < bestDist) {
            bestDist = d;
            best = value;
        }
    }
    return best;
}
