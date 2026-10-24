/**
 * The "Stats" readout every two-point drawing can carry: the same set the reference
 * platform prints beside a line (price range, percent change, bars, date/time range and
 * the inclination angle). Pure data math — the painter formats the numbers and places the
 * plate, so the arithmetic is testable without a canvas.
 *
 * TV's own list also has "Change in pips" and "Distance"; both are symbol/feed specific
 * (a pip size and a bar-spacing convention the model does not own), so they are not
 * invented here — the five below are exactly computable from the anchors plus the series.
 */
import type { Drawing } from './Drawing';
import type { Projector } from './geometry';

/** Which stats a drawing shows, and whether they show all the time. */
export interface DrawingStatsStyle {
    /** Price range between the first and last anchor. */
    range?: boolean;
    /** Percent change from the first anchor's price. */
    percent?: boolean;
    /** Whole bars between the anchors (0 when the projector has no series). */
    bars?: boolean;
    /** Time distance, as a duration. */
    time?: boolean;
    /** Inclination angle in degrees, measured on screen (+ rises to the right). */
    angle?: boolean;
    /** Show even when the drawing is not selected (the reference's "Always show stats"). */
    always?: boolean;
}

/** The numbers themselves, in the drawing's own data space. */
export interface DrawingStats {
    /** |price2 − price1|. */
    priceRange: number;
    /** (price2 − price1) / price1 · 100, in percent (0 when price1 is 0). */
    percent: number;
    /** Whole bars between the anchors (absolute). */
    bars: number;
    /** |time2 − time1| in ms. */
    timeMs: number;
    /** Screen inclination in degrees; + = the second anchor lies higher. */
    angle: number;
    /** Whether the drawing points up (drives the +/− sign and the colour). */
    up: boolean;
}

/** Whether this drawing can carry a stats plate at all (it needs two points). */
export function hasStats(d: Drawing): boolean {
    return d.anchors.length >= 2;
}

/** Whether any stat is switched on — an untouched drawing paints nothing. */
export function statsEnabled(style: DrawingStatsStyle | undefined): boolean {
    if (!style) return false;
    return !!(style.range || style.percent || style.bars || style.time || style.angle);
}

/**
 * The stats of a drawing, or null when it cannot have any. Uses the FIRST and LAST anchor,
 * which is what the reference measures for multi-point tools (a pitchfork's spread, a
 * channel's height); single-anchor stamps have nothing to measure.
 */
export function computeDrawingStats(d: Drawing, proj: Projector): DrawingStats | null {
    if (!hasStats(d)) return null;
    const a = d.anchors[0]!;
    const b = d.anchors[d.anchors.length - 1]!;
    const priceRange = Math.abs(b.price - a.price);
    const percent = Math.abs(a.price) > 1e-12 ? ((b.price - a.price) / a.price) * 100 : 0;
    const bars = proj.barsBetween ? Math.abs(Math.round(proj.barsBetween(a.time, b.time))) : 0;
    const timeMs = Math.abs(b.time - a.time);
    const y1 = proj.yOf(a.price, d.paneId);
    const y2 = proj.yOf(b.price, d.paneId);
    const x1 = proj.xOf(a.time);
    const x2 = proj.xOf(b.time);
    // Screen-space angle: canvas y grows downward, so a rising line is a NEGATIVE dy.
    const angle = y1 != null && y2 != null && Math.abs(x2 - x1) > 1e-9 ? (Math.atan2(-(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI : 0;
    return { priceRange, percent, bars, timeMs, angle, up: b.price >= a.price };
}
