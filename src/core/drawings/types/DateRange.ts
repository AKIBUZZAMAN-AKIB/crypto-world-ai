import { MeasureBox } from './MeasureBox';

/**
 * The Date Range measurer — the horizontal half of the ruler: how much TIME a move
 * took, in bars and in wall-clock duration, with no price delta in the label.
 *
 * Same trade-off as {@link PriceRange}: one box, one toggle defaulted off, so the three
 * rulers on the toolbar cannot drift apart in behaviour or styling.
 */
export class DateRange extends MeasureBox {
    readonly type = 'daterange' as const;

    constructor(init: ConstructorParameters<typeof MeasureBox>[0]) {
        super(init);
        // See PriceRange: the saved document wins, the preset only fills the gap.
        if (init.props?.['showPrice'] === undefined) this.showPrice = false;
    }
}
