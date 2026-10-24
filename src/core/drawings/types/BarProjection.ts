import { type AnchorSlot, type SerializedDrawing, Drawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS } from '../schema';
import { handleAt, pointInBox } from '../hittest';

/** One projected candle, already in pixels (the painter only fills rects). */
export interface ProjectedCandle {
    x: number;
    /** Bar width in px. */
    w: number;
    /** Body top/bottom in px (top is the SMALLER y). */
    bodyTop: number;
    bodyBottom: number;
    /** Wick extremes in px. */
    wickTop: number;
    wickBottom: number;
    up: boolean;
}

/** Visual weight of a projection — a ghost feed reads as a hint, a bars pattern as a copy. */
export interface ProjectionStyle {
    /** Overall opacity multiplier (0..1). */
    opacity: number;
    /** Fill the bodies (otherwise outline only). */
    filled: boolean;
}

function defaultProjectionStyle(): ProjectionStyle {
    return { opacity: 0.9, filled: true };
}

/**
 * Shared base for the two **bar projections**: a source window of bars is re-drawn further
 * along the time axis. The source is whatever `barsInRange` returns for the first two anchors
 * (so the copy always tracks the live series — a reloaded chart re-reads it, nothing is baked
 * in at creation), and the destination is a time this class names.
 *
 * Geometry is computed once, in pixels, by {@link columns}; the painter has no bar math of its
 * own and no data access — which is also what makes the tool testable without a canvas.
 */
export abstract class BarProjection extends Drawing {
    /** Extra behaviour knobs (opacity / filled bodies), persisted through props. */
    projection!: ProjectionStyle;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.projection) this.projection = defaultProjectionStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 3, slots: [{ role: 'from', free: 'x' }, { role: 'to', free: 'x' }, { role: 'place', free: 'x' }] };
    }

    /** Where the copy BEGINS, in ms — null while the tool cannot place it yet. */
    protected abstract destinationTime(): number | null;

    /** The source window as `[from, to]` (either order), or null without both anchors. */
    protected sourceSpan(): [number, number] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return [Math.min(a.time, b.time), Math.max(a.time, b.time)];
    }

    /** The shift applied to every source timestamp (destination − source start). */
    protected shiftMs(): number | null {
        const span = this.sourceSpan();
        const dest = this.destinationTime();
        if (!span || dest == null) return null;
        return dest - span[0];
    }

    /** Extra shift so a copy whose destination IS a bar does not paint on top of it. */
    protected shiftPadding(_span: [number, number], _bars: readonly { time: number }[]): number {
        return 0;
    }

    /** Pixel columns for the projected copy; empty while placing or without bars. */
    columns(proj: Projector): ProjectedCandle[] {
        const span = this.sourceSpan();
        const dst = this.shiftMs();
        if (!span || dst == null) return [];
        const bars = proj.barsInRange?.(span[0], span[1]) ?? [];
        if (bars.length === 0) return [];
        const shift = dst + this.shiftPadding(span, bars);
        const n = bars.length;
        // Column width comes from the SOURCE spacing, so the copy is the same shape as the
        // pattern it was taken from even when the destination sits on a different zoom.
        const srcW = Math.abs(proj.xOf(span[1]) - proj.xOf(span[0]));
        const step = n > 1 ? srcW / (n - 1) : 12;
        const w = Math.max(1, Math.min(14, step * 0.7));
        const out: ProjectedCandle[] = [];
        for (const bar of bars) {
            const y = (p: number): number | null => proj.yOf(p, this.paneId);
            const yh = y(bar.high);
            const yl = y(bar.low);
            const yo = y(bar.open);
            const yc = y(bar.close);
            if (yh == null || yl == null || yo == null || yc == null) continue;
            const x = proj.xOf(bar.time + shift);
            const bodyTop = Math.min(yo, yc);
            const bodyBottom = Math.max(yo, yc);
            out.push({
                x,
                w,
                bodyTop,
                bodyBottom: Math.max(bodyBottom, bodyTop + 1),
                wickTop: Math.min(yh, yl),
                wickBottom: Math.max(yh, yl),
                up: bar.close >= bar.open,
            });
        }
        return out;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const out: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) continue;
            out.push([proj.xOf(a.time), y]);
        }
        return out;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    /** Clicking any projected candle (or the source band) selects the tool. */
    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        for (const c of this.columns(proj)) {
            if (pointInBox(px, py, c.x - c.w / 2, c.wickTop, c.x + c.w / 2, c.wickBottom, tol)) return true;
        }
        const span = this.sourceSpan();
        if (span) {
            const x0 = proj.xOf(span[0]);
            const x1 = proj.xOf(span[1]);
            if (Math.abs(px - x0) <= tol || Math.abs(px - x1) <= tol) return true;
        }
        return false;
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const cols = this.columns(proj);
        const pts = this.handlePoints(proj);
        if (cols.length === 0 && pts.length === 0) return null;
        const xs = [...cols.map((c) => c.x - c.w / 2), ...cols.map((c) => c.x + c.w / 2), ...pts.map((p) => p[0])];
        const ys = [...cols.map((c) => c.wickTop), ...cols.map((c) => c.wickBottom), ...pts.map((p) => p[1])];
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    /** Bounds of the projected copy, so the price axis holds it. */
    priceRange(): { min: number; max: number } | null {
        const span = this.sourceSpan();
        if (!span) return null;
        const a = this.anchors[0];
        const b = this.anchors[1];
        return a && b ? { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) } : null;
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                ...FILL_FIELDS,
                { path: 'projection.opacity', label: 'Opacity', kind: 'number', min: 0.1, max: 1, step: 0.05, group: 'line' },
                { path: 'projection.filled', label: 'Filled bodies', kind: 'boolean', group: 'line' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { projection: { ...this.projection } };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const p = props.projection as Partial<ProjectionStyle> | undefined;
        if (p && typeof p === 'object') {
            const base = defaultProjectionStyle();
            if (typeof p.opacity === 'number') base.opacity = Math.min(1, Math.max(0, p.opacity));
            if (typeof p.filled === 'boolean') base.filled = p.filled;
            this.projection = base;
        }
    }
}

/**
 * Bars pattern: copy a range of real bars and place the copy anywhere on the time axis — the
 * classic "this pattern repeated here" tool. Three anchors: the source start, the source end
 * (those two select the pattern), and where the copy starts.
 */
export class BarsPattern extends BarProjection {
    readonly type = 'barspattern' as const;

    protected destinationTime(): number | null {
        return this.anchors[2]?.time ?? null;
    }
}

/**
 * Ghost feed: replay a range of bars immediately AFTER itself, faded — projecting the recent
 * past forward so a setup can be judged against what usually follows it. Two anchors (source
 * start / end); the copy begins where the source ends, so the chart reads as one continuous
 * series that turns into a ghost.
 */
export class GhostFeed extends BarProjection {
    readonly type = 'ghostfeed' as const;

    /** Two clicks only: the feed's destination is the window's own end, not a third anchor. */
    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'from', free: 'x' }, { role: 'to', free: 'x' }] };
    }

    protected destinationTime(): number | null {
        const span = this.sourceSpan();
        return span ? span[1] : null;
    }

    /** The feed continues the series: the copy starts one source step PAST the last bar, so
     *  not even the window's final candle is painted over. */
    protected override shiftPadding(span: [number, number], bars: readonly { time: number }[]): number {
        return bars.length > 1 ? (span[1] - span[0]) / (bars.length - 1) : 0;
    }

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        // A ghost is a hint, not a second series.
        if (this.projection.opacity > 0.6) this.projection.opacity = 0.45;
    }
}
