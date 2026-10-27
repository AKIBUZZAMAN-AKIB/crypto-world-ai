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

const RIBBON = ['#5b9cf6', '#4fb3bf', '#3fb98d', '#8fbf4d', '#d0a83f']; // palette-exempt: the template ribbon is a fixed five-step series ramp (a design constant, not a semantic colour)

/**
 * A classic native has TWO possible input key-spaces at apply time. With a scripting engine
 * present the study runs its own v6 Pine source, whose `input.*` variables are `len`, `src`,
 * `offset`, `ink`; WITHOUT an engine it is core-computed from the classic descriptor, whose
 * keys are `length`, `source`, `offset`, `color`. `ChartCell.applyNativeLedgerEntry` diffs an
 * entry's inputs against the LIVE declared schema, and `EngineOrchestrator.startIndicator`
 * merges them over the prepared Pine defaults — so an override only lands if its key matches
 * the schema the host actually booted. A built-in is static data applied on either host, so
 * every override is stored under BOTH spellings; the schema simply ignores the keys it does
 * not declare (they never reach `setInputs`), which keeps a value correct on both paths.
 */
const CLASSIC_KEY_ALIASES: Record<string, string> = {
    length: 'len', len: 'length',
    source: 'src', src: 'source',
    color: 'ink', ink: 'color',
};
const withMirrorKeys = (inputs: Record<string, InputValue>): Record<string, InputValue> => {
    const out: Record<string, InputValue> = { ...inputs };
    for (const [key, alias] of Object.entries(CLASSIC_KEY_ALIASES)) {
        if (key in out && !(alias in out)) out[alias] = out[key]!;
    }
    return out;
};

const ema = (length: number, inputs: Record<string, InputValue> = {}): PersistedNativeEntry => ({
    type: 'ema',
    inputs: withMirrorKeys({ length, ...inputs }),
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
