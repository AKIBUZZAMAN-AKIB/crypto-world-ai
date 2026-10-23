// The PAINTING VARIANTS — price styles that change how a bar is DRAWN, not what it is.
//
// This is the seam the chart-type registry was missing. `registerChartType` is the right
// door for a style that changes the DATA (Renko's bricks, an order-flow grid); a style
// that only repaints the same 1:1 bar stream should not have to carry a settings schema,
// a ticker modifier and a basePainting declaration to appear in the picker. Each variant
// here reuses one of the existing cosmetics blocks (`candles`, `bars`, `line`, `area`),
// plus the one `variants` bag for the few knobs those blocks cannot express.
//
// The painting semantics are TradingView's, checked against their support pages:
//   hollow-candles  — body is an OUTLINE when the close is at/above the open, filled
//                     when below (the fill/colour reading of a candle in one glance).
//   volume-candles  — the candle's WIDTH is proportional to its volume; OHLC is unchanged
//                     ("the greater the trading volume, the wider the candle").
//   line-markers    — the close line with a dot at every plotted point.
//   stepline        — the close line drawn as horizontal runs joined by vertical steps.
//   hlc-area        — a filled band between high and low with the close as a line through
//                     it; open is disregarded (that is the point of the style).
//   columns         — each close is a column from the zero line, coloured by direction
//                     ("extending from the zero line").
//   high-low        — a column spanning high→low in ONE colour, so the bar's range reads
//                     without a trend bias ("high-low charts use only one colour").
//   hlc-bars        — an OHLC bar with the open tick removed (high-low stick + close tick).
import { svg16 } from '../icons';
import type { PriceStyle } from '../options';

/** The painting variants' ids. Kept separate from `PriceStyle` (a string union) so the
 *  renderer can switch on a narrow type instead of guessing at runtime. */
export type PaintVariantId =
    | 'hollow-candles'
    | 'volume-candles'
    | 'line-markers'
    | 'stepline'
    | 'hlc-area'
    | 'columns'
    | 'high-low'
    | 'hlc-bars';

/** One variant: its id, picker label, picker glyph, and the cosmetics block it paints with. */
export interface PaintVariantDefinition {
    id: PaintVariantId;
    label: string;
    /** Raw `<svg>` for style pickers (registered as icon id `style-<id>`). */
    icon: string;
    /** Which existing cosmetics block supplies its colours/width — the settings dialog
     *  shows exactly that group while the variant is active, so no new colour UI. */
    paints: 'candles' | 'bars' | 'line' | 'area';
}

const S = svg16;

/** Every painting variant, in picker order (they sit after the classic five). */
export const PAINT_VARIANTS: readonly PaintVariantDefinition[] = [
    {
        id: 'hollow-candles',
        label: 'Hollow candles',
        paints: 'candles',
        icon: S('<path d="M4.5 2v2M4.5 12v2M11.5 2v1.5M11.5 11v3"/><rect x="2.8" y="4" width="3.4" height="8" rx="0.6"/><rect x="9.8" y="3.5" width="3.4" height="7.5" rx="0.6" fill="currentColor"/>'),
    },
    {
        id: 'volume-candles',
        label: 'Volume candles',
        paints: 'candles',
        icon: S('<path d="M3 2v2M3 12v2M12.5 2v1.5M12.5 11v3"/><rect x="1.6" y="4" width="2.8" height="8" rx="0.5" fill="currentColor" fill-opacity="0.3"/><rect x="9.6" y="3.5" width="5.8" height="7.5" rx="0.6" fill="currentColor"/>'),
    },
    {
        id: 'line-markers',
        label: 'Line with markers',
        paints: 'line',
        icon: S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/><circle cx="5.5" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="9.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="13.5" cy="3.5" r="1.3" fill="currentColor" stroke="none"/>'),
    },
    {
        id: 'stepline',
        label: 'Step line',
        paints: 'line',
        icon: S('<path d="M1.5 11.5H5V7.5h3.5V4H13.5"/>'),
    },
    {
        id: 'hlc-area',
        label: 'HLC area',
        paints: 'area',
        icon: S('<path d="M1.5 6.5 5.5 3.5l3 3 5-4" stroke-dasharray="0"/><path d="M1.5 10.5 5.5 9l3 2 5-3" opacity="0.75"/><path d="M1.5 6.5 5.5 3.5l3 3 5-4v4.5l-5 3-3-2-5 1.5z" fill="currentColor" fill-opacity="0.22" stroke="none"/>'),
    },
    {
        id: 'columns',
        label: 'Columns',
        paints: 'bars',
        icon: S('<path d="M1.5 13.5h13" stroke-dasharray="2 2"/><rect x="2.6" y="6" width="2.6" height="7.5" fill="currentColor" fill-opacity="0.85"/><rect x="6.8" y="3.5" width="2.6" height="10" fill="currentColor" fill-opacity="0.45"/><rect x="11" y="8" width="2.6" height="5.5" fill="currentColor" fill-opacity="0.85"/>'),
    },
    {
        id: 'high-low',
        label: 'High-low',
        paints: 'bars',
        icon: S('<rect x="4" y="2.5" width="2.6" height="11" fill="currentColor" fill-opacity="0.8"/><rect x="9.4" y="5" width="2.6" height="7" fill="currentColor" fill-opacity="0.55"/>'),
    },
    {
        id: 'hlc-bars',
        label: 'HLC bars',
        paints: 'bars',
        icon: S('<path d="M4.5 2.5v11M2.5 11h2"/><path d="M11.5 3.5v9M11.5 8.5h2"/>'),
    },
];

const byId = new Map<string, PaintVariantDefinition>(PAINT_VARIANTS.map((v) => [v.id, v]));

/** The variant behind a style id (undefined for the classic styles and plugin types). */
export function paintVariant(id: string): PaintVariantDefinition | undefined {
    return byId.get(id);
}

/** Whether a style is one of the painting variants. */
export function isPaintVariant(id: string): id is PaintVariantId {
    return byId.has(id);
}

/** Every variant id, in picker order. */
export function paintVariantIds(): PaintVariantId[] {
    return PAINT_VARIANTS.map((v) => v.id);
}

/**
 * The knobs the variants need and the shared block underneath cannot express. One bag
 * for all eight (they are mutually exclusive styles, so their settings never collide),
 * living in the chart config beside the other cosmetics.
 */
export interface PaintVariantSettings {
    /** `hollow-candles`: outline the body for up bars (TradingView's default). Off paints
     *  both directions filled — the pre-variant look, one toggle away. */
    hollowUp: boolean;
    /** `volume-candles`: the narrowest candle slot, as a percent of the bar pitch. A real
     *  floor, because a thin-volume bar in a quiet market must stay visible (and a body
     *  thinner than a device pixel is not a candle). */
    volumeMinWidthPct: number;
    /** `volume-candles`: colour by the PREVIOUS bar's close instead of the bar's own
     *  open→close — TradingView's "Color based on previous close" switch. */
    volumeColorByPrevClose: boolean;
    /** `line-markers`: dot radius in CSS px. */
    markerRadius: number;
    /** `columns`: measure from the zero line (TradingView's reading) or from the first
     *  visible bar's close, which keeps an index-scale series legible. */
    columnBaseline: 'zero' | 'first';
    /** `high-low`: the single ink. `null` ⇒ the line colour, so the style inherits a
     *  palette instead of shipping a hard-coded grey. */
    highLowColor: string | null;
}

/** The first-run variant settings. */
export const DEFAULT_VARIANT_SETTINGS: PaintVariantSettings = {
    hollowUp: true,
    volumeMinWidthPct: 22,
    volumeColorByPrevClose: false,
    markerRadius: 2.5,
    columnBaseline: 'zero',
    highLowColor: null,
};

/** Clamp/validate an untrusted settings bag onto the defaults (pure). */
export function normalizeVariantSettings(raw: unknown): PaintVariantSettings {
    const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
    const num = (x: unknown, d: number, lo: number, hi: number): number =>
        typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
    const color = (x: unknown): string | null => (typeof x === 'string' && x.trim().length > 0 ? x : null);
    return {
        hollowUp: bool(v.hollowUp, DEFAULT_VARIANT_SETTINGS.hollowUp),
        volumeMinWidthPct: num(v.volumeMinWidthPct, DEFAULT_VARIANT_SETTINGS.volumeMinWidthPct, 5, 100),
        volumeColorByPrevClose: bool(v.volumeColorByPrevClose, DEFAULT_VARIANT_SETTINGS.volumeColorByPrevClose),
        markerRadius: num(v.markerRadius, DEFAULT_VARIANT_SETTINGS.markerRadius, 0.5, 8),
        columnBaseline: v.columnBaseline === 'first' ? 'first' : 'zero',
        highLowColor: color(v.highLowColor),
    };
}

/**
 * Volume → body width for `volume-candles`: the share of the bar pitch a bar's body takes.
 *
 * The mapping is deliberately LINEAR in volume against the visible maximum, then floored:
 * a square-root or log curve exaggerates quiet bars until every candle looks the same, and
 * a trading chart is read by comparing neighbours. The floor keeps a 1-bar-in-1000 spike
 * from owning the whole slot while a dead bar still reads as a candle.
 */
export function volumeWidthShare(volume: number, maxVolume: number, minPct: number): number {
    const floor = Math.min(1, Math.max(0.05, minPct / 100));
    if (!(maxVolume > 0) || !(volume > 0)) return floor;
    const share = volume / maxVolume;
    return floor + (1 - floor) * Math.min(1, share);
}

/**
 * A style's PAINTING family — what the renderer switches on. Classic styles keep their own
 * ids; a variant reports its family so the two backends share one switch instead of two
 * nested ones. Returns `null` for a plugin chart type (it paints itself).
 */
export type PaintFamily = PaintVariantId | 'candles' | 'bars' | 'line' | 'area' | 'baseline' | 'kagi' | 'pnf' | 'linebreak';

export function paintFamily(style: PriceStyle): PaintFamily | null {
    if (isPaintVariant(style)) return style;
    if (style === 'candles' || style === 'heikinashi') return 'candles';
    if (style === 'bars') return 'bars';
    if (style === 'line') return 'line';
    if (style === 'area') return 'area';
    if (style === 'baseline') return 'baseline';
    // Re-bucketing styles whose own geometry the renderer paints (the bars arrived with
    // their paint hint: Kagi leg weight, P&F box + glyph).
    if (style === 'kagi') return 'kagi';
    if (style === 'pnf') return 'pnf';
    if (style === 'linebreak') return 'linebreak';
    return null;
}
