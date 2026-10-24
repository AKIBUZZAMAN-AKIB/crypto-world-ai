import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/** Segments used to sweep a sector's arc. */
const ARC_SAMPLES = 48;

/**
 * A sector (pie slice): the centre, a point on the arc that fixes the radius and the opening
 * edge, and a third point that sets the closing angle. Drawn as two radii plus a swept arc,
 * filled when a fill color is set. Pixel-space, like every radial tool: an angle is an angle
 * on screen, not a price/time ratio.
 */
export class Sector extends SegmentDrawing {
    readonly type = 'sector' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [{ role: 'centre', free: 'both' }, { role: 'start', free: 'both' }, { role: 'end', free: 'both' }],
        };
    }

    private px(proj: Projector, i: number): [number, number] | null {
        const a = this.anchors[i];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const C = this.px(proj, 0);
        const A = this.px(proj, 1);
        if (!C || !A) return null;
        const r = Math.hypot(A[0] - C[0], A[1] - C[1]);
        if (!(r > 0.5)) return null;
        const start = Math.atan2(A[1] - C[1], A[0] - C[0]);
        const B = this.px(proj, 2);
        // While placing, sweep nothing: show the two radii at the same angle so the ghost is a line.
        const end = B ? Math.atan2(B[1] - C[1], B[0] - C[0]) : start;
        let sweep = end - start;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        const pts: Array<[number, number]> = [[C[0], C[1]]];
        for (let i = 0; i <= ARC_SAMPLES; i += 1) {
            const t = start + (sweep * i) / ARC_SAMPLES;
            pts.push([C[0] + r * Math.cos(t), C[1] + r * Math.sin(t)]);
        }
        pts.push([C[0], C[1]]);
        const segments: Array<[number, number, number, number]> = [];
        for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
        return { segments, fill: pts };
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
