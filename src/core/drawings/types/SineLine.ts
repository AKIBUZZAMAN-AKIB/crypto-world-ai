import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/** Horizontal resolution of the sampled wave, in px per segment. */
const STEP_PX = 4;

/**
 * A sine line: the first anchor is a point ON the wave and the second sets its amplitude and
 * cycle length — the vertical distance is the amplitude, and the second click lands exactly on
 * the first crest, so the period is four times its horizontal distance. The wave starts at the
 * first anchor and projects forward across the plot, which is what makes it useful for cycle
 * work (matching past peaks/troughs and reading the next turns off the projection).
 */
export class SineLine extends SegmentDrawing {
    readonly type = 'sineline' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'start', free: 'both' }, { role: 'crest', free: 'both' }] };
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a) return null;
        const y0 = proj.yOf(a.price, this.paneId);
        if (y0 == null) return null;
        const x0 = proj.xOf(a.time);
        if (!b) return { segments: [[x0, y0, proj.width, y0]], fill: null }; // placing: the midline
        const yb = proj.yOf(b.price, this.paneId);
        if (yb == null) return null;
        const dx = proj.xOf(b.time) - x0;
        if (Math.abs(dx) < 1e-6) return { segments: [[x0, y0, proj.width, y0]], fill: null };
        const amp = y0 - yb; // screen-fixed amplitude: crest at the second anchor
        const quarter = Math.abs(dx);
        const len = Math.max(0, proj.width - x0);
        const segments: Array<[number, number, number, number]> = [];
        let prevX = x0;
        let prevY = y0;
        for (let x = STEP_PX; x <= len + STEP_PX; x += STEP_PX) {
            const px = x0 + x;
            const phase = ((dx >= 0 ? x : -x) / quarter) * (Math.PI / 2);
            const y = y0 - amp * Math.sin(phase);
            segments.push([prevX, prevY, px, y]);
            prevX = px;
            prevY = y;
        }
        return { segments, fill: null };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        if (!a) return null;
        const b = this.anchors[1];
        const amp = b ? Math.abs(b.price - a.price) : 0;
        return { min: a.price - amp, max: a.price + amp };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
