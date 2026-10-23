import { type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import { extendRay } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';
import { fibLevels } from '../levelPalette';

/**
 * Rays at the Fibonacci division points of the correction leg.
 *
 * Reference description, verbatim in substance: "first and second points are the trend's
 * extreme points, the third point is the extreme of the first correction wave", and the
 * rays are "inclined with the coefficients formed by a Fibonacci number sequence".
 *
 * The construction that satisfies all of that: each ray leaves the trend's ORIGIN (p1)
 * and passes through the point that sits `ratio` of the way from the trend extreme (p2)
 * to the correction extreme (p3). Ratio 0 is therefore the trend leg itself and ratio 1
 * lands exactly on the correction extreme — so the two anchors a trader placed by eye
 * are two of the drawn rays, and every level between them is a measured fraction of the
 * pullback. That is what makes a pitchfan readable: each ray is "price has retraced this
 * much of the first correction".
 *
 * Ratios above 1 are extensions (the correction overshot); they come free from the same
 * rule and are off by default, as on the reference.
 */
const PITCHFAN_LEVELS = fibLevels([
    { ratio: 0, enabled: true }, // the trend leg itself — the frame, not a signal
    0.236,
    0.382,
    0.5,
    0.618,
    0.786,
    { ratio: 1, enabled: true }, // through the correction extreme: the trader's own third click
]);

export class FibPitchfan extends FibRatios {
    readonly type = 'fibpitchfan' as const;

    defaultLevels(): readonly FibLevel[] {
        return PITCHFAN_LEVELS;
    }

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'p1', free: 'both' }, // trend origin
                { role: 'p2', free: 'both' }, // trend extreme
                { role: 'p3', free: 'both' }, // first correction extreme
            ],
        };
    }

    override entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b) return null;
        const y0 = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (y0 == null || yb == null) return null;
        const x0 = proj.xOf(a.time);
        // While placing (no third anchor yet) the trend leg alone is drawn, so the tool
        // gives feedback from the second click instead of showing nothing.
        if (!c) return [{ color: this.levels[0]?.color ?? '', x1: x0, y1: y0, x2: proj.xOf(b.time), y2: yb, numberText: '', numberX: 0, numberY: 0, numberAlign: 'left', labelX: 0, labelY: 0 }];
        const yc = proj.yOf(c.price, this.paneId);
        if (yc == null) return null;
        const xc = proj.xOf(c.time);
        const xb = proj.xOf(b.time);
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            // The division point measured ON the correction leg, in pixels — so the
            // fraction is what the trader sees, whatever the price scale or log mode.
            const throughX = xb + lv.ratio * (xc - xb);
            const ty = yb + lv.ratio * (yc - yb);
            const [x1, y1, x2, y2] = extendRay(x0, y0, throughX, ty, 'right', proj.width, proj.height);
            out.push({
                color: lv.color,
                label: lv.label,
                x1,
                y1,
                x2,
                y2,
                numberText: String(lv.ratio),
                numberX: x2 + 5,
                numberY: y2,
                numberAlign: 'left',
                labelX: x2 + 5,
                labelY: y2 + 13,
            });
        }
        // The correction leg itself (p2→p3), dashed by the painter's own style rules: it
        // is the measuring stick every ratio is taken from, so it must be visible.
        out.push({
            color: this.levels[0]?.color ?? '',
            x1: xb,
            y1: yb,
            x2: xc,
            y2: yc,
            numberText: '',
            numberX: 0,
            numberY: 0,
            numberAlign: 'left',
            labelX: 0,
            labelY: 0,
        });
        return out;
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }
}
