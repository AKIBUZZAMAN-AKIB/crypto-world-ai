import { CalloutBase } from './CalloutBase';

/**
 * A Pin: a marker stuck into the chart at the target, with the note hanging off it.
 *
 * Same two-anchor rig as the other pinned annotations (the reference's annotation family
 * shares one), so the target pins to a price and the plate is dragged where it reads
 * best. Only the painter differs: a round-headed pin with a tapered stem, plus the plate.
 * It exists because a trader marking a level wants a MARK, not a speech bubble — the pin
 * glyph reads as "this exact price" at a glance, which text alone does not.
 */
export class Pin extends CalloutBase {
    readonly type = 'pin' as const;

    protected override defaultLabel(): string {
        return 'Pin';
    }
}
