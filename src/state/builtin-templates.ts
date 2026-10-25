import type { InputValue } from '../core/model/inputs';
import type { PersistedNativeEntry } from './document';

/**
 * TradingView's SIX built-in indicator templates, in the same order its own menu lists
 * them. They are read-only: the store keeps them separate from the user's templates, so
 * they cannot be renamed, overwritten or deleted — applying one still REPLACES the chart's
 * indicator set, exactly as applying a saved template does.
 *
 * Each entry names native types the catalog registers today, so a built-in is never a
 * dangling reference: the settings below are the study's declaration defaults except where
 * the template's character needs a value (a displacement, a ribbon's lengths).
 */
export interface BuiltinTemplate {
    /** Stable id — what the menu applies and what a test can address. */
    id: string;
    name: string;
    /** One line under the name in the menu: what the trader is getting. */
    description: string;
    indicators: PersistedNativeEntry[];
}

const RIBBON = ['#5b9cf6', '#4fb3bf', '#3fb98d', '#8fbf4d', '#d0a83f'];

const ema = (length: number, inputs: Record<string, InputValue> = {}): PersistedNativeEntry => ({
    type: 'ema',
    inputs: { length, ...inputs },
});

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
    {
        id: 'bill-williams-3-lines',
        name: "Bill Williams' 3 Lines",
        description: 'Alligator — jaw, teeth and lips',
        indicators: [{ type: 'williams-alligator' }],
    },
    {
        id: 'displaced-ema',
        name: 'Displaced EMA',
        description: 'A 20-period EMA pushed 5 bars forward',
        indicators: [ema(20, { offset: 5 })],
    },
    {
        id: 'ma-exp-ribbon',
        name: 'MA Exp Ribbon',
        description: 'Five EMA ribbons — 8, 13, 21, 34, 55',
        indicators: RIBBON.map((color, i) => ema([8, 13, 21, 34, 55][i]!, { color })),
    },
    {
        id: 'oscillators',
        name: 'Oscillators',
        description: 'RSI, Stochastic and CCI, one pane each',
        indicators: [{ type: 'rsi' }, { type: 'stochastic' }, { type: 'commodity-channel-index' }],
    },
    {
        id: 'swing-trading',
        name: 'Swing Trading',
        description: 'ZigZag swings with Parabolic SAR and Aroon',
        indicators: [{ type: 'zigzag' }, { type: 'parabolic-sar' }, { type: 'aroon' }],
    },
    {
        id: 'volume-based',
        name: 'Volume Based',
        description: 'Volume with OBV and anchored VWAP',
        indicators: [{ type: 'volume' }, { type: 'on-balance-volume' }, { type: 'vwap' }],
    },
];

/** One built-in by id (null when the id is not one of the six). */
export function builtinTemplate(id: string): BuiltinTemplate | null {
    return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}
