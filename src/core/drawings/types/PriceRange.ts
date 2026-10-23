import { MeasureBox } from './MeasureBox';

/**
 * The Price Range measurer — TradingView's vertical-only ruler.
 *
 * It is the Date & Price Range box with the date line switched off, not a second
 * implementation: one drag, one tinted box, one label, and the label reads `Δprice (Δ%)`
 * only. Keeping the box (rather than a bare vertical segment) means the trader still gets
 * the direction-tinted area and the same handles, and toggling `Show date` in settings
 * turns it back into the combined ruler — which is exactly how TV's three rulers relate.
 */
export class PriceRange extends MeasureBox {
    readonly type = 'pricerange' as const;

    constructor(init: ConstructorParameters<typeof MeasureBox>[0]) {
        super(init);
        // The base constructor has already defaulted both toggles to `true`, so the only
        // way to tell "the tool's default" from "the trader's saved choice" is the raw
        // document: a restored drawing that switched the date line back on keeps it.
        if (init.props?.['showDate'] === undefined) this.showDate = false;
    }
}
