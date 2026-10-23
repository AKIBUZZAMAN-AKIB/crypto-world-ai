import type { Projector } from '../geometry';
import { GannSquare, type GannSquareBox } from './GannSquare';

/**
 * The Gann Square Fixed — a square in SCREEN space.
 *
 * The two Gann squares differ in exactly one thing, and it is an analytical choice, not
 * a cosmetic variant:
 *   • {@link GannSquare} keeps a constant PRICE/TIME ratio between its corners, so it
 *     stays "square" in chart units however the scales stretch;
 *   • this one keeps a constant PIXEL ratio: the reference platform draws it by taking
 *     the width dragged on the time axis and extending "an equal amount of pixels" on
 *     the price axis. An equal-side box only stays square while the chart's scale is
 *     locked — which is the point of the tool, and why the reference ships both.
 *
 * So the clamp lives in the PAINT geometry, never in the anchors: the anchors keep the
 * trader's time/price (and survive a scale change), only the drawn box is squared.
 */
export class GannSquareFixed extends GannSquare {
    override readonly type = 'gannsquarefixed' as const;

    /** The grid divides the squared box, not a price span it no longer matches. */
    protected override get priceAxisFollowsBox(): boolean {
        return true;
    }

    /** The origin corner plus a box whose height equals its WIDTH in pixels. */
    protected override box(proj: Projector): GannSquareBox | null {
        const base = super.box(proj);
        if (!base) return null;
        const side = Math.abs(base.bx);
        if (!(side > 0)) return base;
        // Keep the drag's vertical DIRECTION (dragging up must still square upward). A
        // dead-horizontal drag has no direction to keep, so it squares downward — the way
        // the pointer was travelling when the width was set.
        const py = base.py === 0 ? side : Math.sign(base.py) * side;
        return {
            ox: base.ox,
            oy: base.oy,
            bx: base.bx,
            py,
            left: Math.min(base.ox, base.ox + base.bx),
            right: Math.max(base.ox, base.ox + base.bx),
            top: Math.min(base.oy, base.oy + py),
            bot: Math.max(base.oy, base.oy + py),
        };
    }
}
