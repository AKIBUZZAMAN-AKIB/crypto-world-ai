import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

const SAMPLES = 48;

/**
 * The Double Curve — one cubic Bézier.
 *
 * The reference platform describes it exactly this way: start, end, then TWO control
 * points, "the first sets the bend of the arc, the second sets the bend of the second
 * arc". Two quadratic arcs joined would have a visible crease at the join; a cubic is
 * smooth by construction and is what a "double" curve means geometrically. That also
 * makes the family honest: Curve = quadratic (one bend), Double Curve = cubic (two).
 *
 * Anchor order is the reference's Coordinates order — anchor[0] start, anchor[1] end,
 * anchor[2]/[3] the controls — so a saved document reads the same in both apps.
 */
export class DoubleCurve extends SegmentDrawing {
    readonly type = 'doublecurve' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 4,
            max: 4,
            slots: [
                { role: 'p1', free: 'both' },
                { role: 'p2', free: 'both' },
                { role: 'control1', free: 'both' },
                { role: 'control2', free: 'both' },
            ],
        };
    }

    private px(proj: Projector, i: number): [number, number] | null {
        const a = this.anchors[i];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const P0 = this.px(proj, 0);
        const P3 = this.px(proj, 1);
        if (!P0 || !P3) return null;
        const C1 = this.px(proj, 2);
        const C2 = this.px(proj, 3);
        // While placing: start → cursor chord, then (with one control) that control is
        // used for both ends, which bends the whole arc one way instead of two.
        if (!C1) return { segments: [[P0[0], P0[1], P3[0], P3[1]]], fill: null };
        const c1 = C1;
        const c2 = C2 ?? C1;
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= SAMPLES; i += 1) {
            const t = i / SAMPLES;
            const u = 1 - t;
            const a = u * u * u;
            const b = 3 * u * u * t;
            const c = 3 * u * t * t;
            const d = t * t * t;
            pts.push([
                a * P0[0] + b * c1[0] + c * c2[0] + d * P3[0],
                a * P0[1] + b * c1[1] + c * c2[1] + d * P3[1],
            ]);
        }
        const segments: Array<[number, number, number, number]> = [];
        for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
        return { segments, fill: pts }; // the curve↔chord lens, painted only when a fill is set
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
