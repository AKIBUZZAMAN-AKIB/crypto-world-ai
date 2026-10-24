import { type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/** Segments per ring — enough that a large circle still reads as round at 1 px. */
const RING_SAMPLES = 72;

/**
 * Time cycles: concentric rings around a centre. The second anchor sets the RADIUS of the
 * innermost ring; the rest are drawn at 2×, 3×, … that radius (`rings` count, editable).
 * Rings are circles in PIXEL space — a cycle is a time/pixel distance on this chart, not a
 * price distance, so they must not be squashed by the price scale.
 */
export class TimeCycles extends SegmentDrawing {
    readonly type = 'timecycles' as const;

    /** How many rings to draw (1..12). Persisted through props. */
    rings!: number;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!Number.isFinite(this.rings) || this.rings < 1) this.rings = 5;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'centre', free: 'both' }, { role: 'radius', free: 'both' }] };
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a) return null;
        const cy = proj.yOf(a.price, this.paneId);
        if (cy == null) return null;
        const cx = proj.xOf(a.time);
        if (!b) return { segments: [], fill: null }; // placing: nothing to draw until the radius lands
        const by = proj.yOf(b.price, this.paneId);
        if (by == null) return null;
        const r = Math.hypot(proj.xOf(b.time) - cx, by - cy);
        if (!(r > 0.5)) return { segments: [], fill: null };
        const count = Math.max(1, Math.min(12, Math.round(this.rings)));
        const segments: Array<[number, number, number, number]> = [];
        for (let k = 1; k <= count; k += 1) {
            const rr = r * k;
            let prevX = cx + rr;
            let prevY = cy;
            for (let i = 1; i <= RING_SAMPLES; i += 1) {
                const t = (i / RING_SAMPLES) * Math.PI * 2;
                const x = cx + rr * Math.cos(t);
                const y = cy + rr * Math.sin(t);
                segments.push([prevX, prevY, x, y]);
                prevX = x;
                prevY = y;
            }
        }
        return { segments, fill: null };
    }

    /** The rings reach `rings ×` the base radius, so the price axis must hold the centre ±
     *  that radius — otherwise a ring can be drawn off-scale. */
    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return a ? { min: a.price, max: a.price } : null;
        const r = Math.abs(b.price - a.price);
        const count = Math.max(1, Math.min(12, Math.round(this.rings)));
        return { min: a.price - r * count, max: a.price + r * count };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                { path: 'rings', label: 'Rings', kind: 'number', min: 1, max: 12, step: 1, group: 'behavior' },
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { rings: this.rings };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.rings === 'number' && Number.isFinite(props.rings)) this.rings = props.rings;
    }
}
