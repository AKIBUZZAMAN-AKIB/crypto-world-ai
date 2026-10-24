/**
 * Per-drawing alerts — the arithmetic behind "tell me when price crosses THIS line".
 *
 * The alert engine watches a LEVEL (see `workspace/price-alerts.ts`). A horizontal line is a
 * level forever, but a trend line is a level that MOVES: the price it sits at depends on the
 * bar. This module is the one place that answers "what price is this drawing at, at time t",
 * so the alert engine, the drawing popup and the tests all share a single definition.
 *
 * Only drawings that actually draw a price over time belong here: a vertical line or a
 * fibonacci fan's arcs have no single price at a bar. Anything unknown returns null and the
 * clock is simply not offered.
 */
import type { DrawingTypeKey } from './Drawing';
import type { DrawingPoint } from './geometry';

/** Types whose geometry is a price at (nearly) every time. */
const LEVEL_TYPES: ReadonlySet<string> = new Set<DrawingTypeKey>([
    'hline', // horizontal line: one price, always
    'hray', // horizontal ray: one price, from its anchor rightwards
    'crossline', // the cross's horizontal half
    'trendline',
    'ray',
    'extendedline',
    'infoline',
    'trendangle',
    'parallelchannel', // the baseline (the channel's own levels are offsets, not levels)
    'fibretracement', // its 0 level — the swing's end, which is the line users alert on
]);

/** Whether a tool can carry a price alert at all. */
export function canAlertOn(type: string): boolean {
    return LEVEL_TYPES.has(type);
}

/** The slice of a drawing this needs (a live instance or a serialized doc both fit). */
export interface LevelSource {
    type: string;
    anchors: readonly DrawingPoint[];
}

/**
 * The drawing's price at `time`, or null when it has none there.
 *
 * Two-anchor lines interpolate (and extrapolate) linearly in TIME, which is what they draw;
 * a horizontal ray simply has no level before its anchor. A single-anchor line is a level.
 */
export function drawingLevelAt(d: LevelSource, time: number): number | null {
    if (!canAlertOn(d.type)) return null;
    const a = d.anchors[0];
    if (!a) return null;
    if (d.type === 'hline' || d.type === 'crossline' || d.type === 'fibretracement') return a.price;
    if (d.type === 'hray') return time >= a.time ? a.price : null;
    const b = d.anchors[1];
    if (!b) return a.price;
    const span = b.time - a.time;
    if (Math.abs(span) < 1e-9) return a.price; // a vertical line has no price of its own
    return a.price + ((b.price - a.price) * (time - a.time)) / span;
}
