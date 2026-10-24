import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { handleAt } from '../hittest';
import {
    computeFixedRangeProfile,
    defaultFrvpStyle,
    type FrvpBar,
    type FrvpCompute,
    type FrvpLayout,
    type FrvpStyle,
} from './FixedRangeVolumeProfile';

/**
 * An **anchored volume profile**: one anchor marks the bar the profile starts at, and the
 * window runs from there to the newest bar in the series — so the profile follows the market
 * forward instead of sitting on a fixed range. Rows, value area, POC and VAH/VAL all use the
 * same proportional distribution as the fixed-range tool (volume is conserved).
 */
export class AnchoredVolumeProfile extends Drawing {
    readonly type = 'anchoredvp' as const;

    /** Same cosmetics bag as the fixed-range profile. */
    frvp!: FrvpStyle;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.frvp) this.frvp = defaultFrvpStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // One anchor on the time axis: the profile always runs to the live edge.
        return { min: 1, max: 1, slots: [{ role: 'anchor', free: 'x' }] };
    }

    /** Bars from the anchor to the end of the series (inclusive), or null. */
    private barsFromAnchor(proj: Projector): FrvpBar[] | null {
        const a = this.anchors[0];
        if (!a) return null;
        const raw = proj.barsInRange?.(a.time, Number.MAX_SAFE_INTEGER) ?? null;
        if (!raw || raw.length < 1) return null;
        return raw.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
    }

    compute(proj: Projector): FrvpCompute | null {
        const bars = this.barsFromAnchor(proj);
        if (!bars) return null;
        const s = this.frvp;
        return computeFixedRangeProfile(bars, s.rows, s.valueAreaPct / 100, s.showDevelopingPoc || s.showDevelopingVa);
    }

    /** The same pixel contract the fixed-range painter consumes. */
    layout(proj: Projector): FrvpLayout | null {
        const a = this.anchors[0];
        if (!a) return null;
        const computed = this.compute(proj);
        if (!computed) return null;
        const { profile } = computed;
        this.cachedRange = { min: profile.min, max: profile.min + profile.rowH * profile.rows.length };
        const x0 = proj.xOf(a.time);
        const lastX = proj.xOf(profileLastBarTime(proj, a.time));
        const spanW = Math.max(1, Math.abs(lastX - x0));
        const maxW = Math.max(1, (Math.min(100, Math.max(0, this.frvp.widthPct)) / 100) * spanW);
        const yEdges: number[] = [];
        for (let k = 0; k <= profile.rows.length; k += 1) {
            const y = proj.yOf(profile.min + k * profile.rowH, this.paneId);
            if (y == null) return null;
            yEdges.push(y);
        }
        const yAt = (price: number): number | null => proj.yOf(price, this.paneId);
        return {
            x0: Math.min(x0, lastX),
            x1: Math.max(x0, lastX),
            anchorX: x0,
            maxW,
            grow: 1,
            profile,
            yEdges,
            vahY: yAt(profile.rows[profile.vaTo]!.price + profile.rowH),
            valY: yAt(profile.rows[profile.vaFrom]!.price),
            pocY: yAt(profile.rows[profile.poc]!.price + profile.rowH / 2),
            developingPoc: [],
            developingVaHigh: [],
            developingVaLow: [],
        };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        if (!L) return false;
        const top = Math.min(...L.yEdges);
        const bottom = Math.max(...L.yEdges);
        return px >= L.x0 - tol && px <= L.x1 + tol && py >= top - tol && py <= bottom + tol;
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
        if (!L) {
            const p = this.handlePoints(proj)[0];
            return p ? { x: p[0], y: p[1], w: 1, h: 1 } : null;
        }
        const top = Math.min(...L.yEdges);
        return { x: L.x0, y: top, w: Math.max(1, L.x1 - L.x0), h: Math.max(...L.yEdges) - top };
    }

    priceRange(): { min: number; max: number } | null {
        const L = this.cachedRange;
        return L ?? null;
    }

    /** Price span of the last computed profile (kept so autoscale has something to read). */
    private cachedRange: { min: number; max: number } | null = null;

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS] };
    }
}

/** Time of the newest bar at or after `from` — the profile's right edge. */
function profileLastBarTime(proj: Projector, from: number): number {
    const bars = proj.barsInRange?.(from, Number.MAX_SAFE_INTEGER) ?? [];
    return bars.length > 0 ? bars[bars.length - 1]!.time : from;
}
