import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * Cyclic lines: evenly spaced vertical lines across the whole plot. The two anchors set the
 * STEP — the first line sits on the first anchor, and every later line is one anchor-distance
 * further along, forwards and backwards until the plot is covered. Data-space anchors mean the
 * spacing is a fixed span of TIME, so the lines stay where they were put when the chart is
 * zoomed, scrolled or reloaded.
 */
export class CyclicLines extends SegmentDrawing {
    readonly type = 'cycliclines' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'p1', free: 'x' }, { role: 'p2', free: 'x' }] };
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a) return null;
        const x0 = proj.xOf(a.time);
        if (!b) return { segments: [[x0, 0, x0, proj.height]], fill: null }; // placing: one line
        const step = proj.xOf(b.time) - x0;
        if (Math.abs(step) < 1e-6) return { segments: [[x0, 0, x0, proj.height]], fill: null };
        // Cover the plot from the first line outwards in both directions.
        const back = Math.ceil(x0 / Math.abs(step));
        const fwd = Math.ceil((proj.width - x0) / Math.abs(step));
        const segments: Array<[number, number, number, number]> = [];
        for (let n = -back; n <= fwd; n += 1) {
            const x = x0 + n * step;
            segments.push([x, 0, x, proj.height]);
        }
        return { segments, fill: null };
    }

    priceRange(): { min: number; max: number } | null {
        return null; // vertical lines never constrain the price axis
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
