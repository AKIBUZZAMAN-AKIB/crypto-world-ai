import type { Millis } from './time';

/** A single price bar. `time` is the bar's open time in epoch ms. */
export interface OHLCV {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    /**
     * Style-private PAINT HINT — set only on the synthetic bars a re-bucketing style
     * emits (Renko/Range/Line break/Kagi/Point & figure), where volume carries no
     * meaning and the geometry alone cannot say everything the painter needs:
     *   - `yang`  Kagi: a thick (yang) line vs a thin (yin) one.
     *   - `box`   Point & figure: this column's box size, in price units.
     *   - `mark`  Point & figure: the glyph this column stacks (`x` rising, `o` falling).
     * Never present on provider bars; never persisted; never read by indicators.
     */
    styleHint?: { yang?: boolean; box?: number; mark?: 'x' | 'o' };
}
