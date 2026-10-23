import { registerNativeIndicator } from '../NativeIndicator';
import { classicDescriptor } from './define';
import type { ClassicIndicatorSpec } from './define';
import { averageSpecs } from './averages';
import { bandSpecs } from './bands';
import { oscillatorSpecs } from './oscillators';
import { trendSpecs } from './trend';
import { volatilitySpecs } from './volatility';
import { volumeSpecs } from './volume';
import { overlaySpecs } from './overlays';

/**
 * The classic indicator catalog — the standard technical-analysis studies every
 * charting host expects (moving averages, oscillators, bands, volume studies),
 * each a pure compute over the chart's own bars riding the native-indicator
 * pipeline (picker, legend, panes, settings, persistence).
 */
export const classicSpecs: ClassicIndicatorSpec[] = [
    ...averageSpecs,
    ...bandSpecs,
    ...oscillatorSpecs,
    ...trendSpecs,
    ...volatilitySpecs,
    ...volumeSpecs,
    ...overlaySpecs,
];

/**
 * The catalog's picker groups, in the order a trader scans them: the price-overlay
 * families first, the oscillators (its own pane) after. A file = a family, so the group
 * a study lands in is a property of where it is DEFINED, never of its title's spelling.
 */
export const CLASSIC_CATEGORIES: ReadonlyArray<readonly [string, readonly ClassicIndicatorSpec[]]> = [
    ['Moving averages', averageSpecs],
    ['Bands & channels', bandSpecs],
    ['Overlays', overlaySpecs],
    ['Trend', trendSpecs],
    ['Oscillators', oscillatorSpecs],
    ['Volatility', volatilitySpecs],
    ['Volume', volumeSpecs],
];

/** Register the classic indicator catalog (idempotent). Called by the composition root. */
export function registerClassicIndicators(): void {
    for (const [category, specs] of CLASSIC_CATEGORIES) {
        for (const spec of specs) registerNativeIndicator({ ...classicDescriptor(spec), category });
    }
}

export { classicDescriptor } from './define';
export type { ClassicIndicatorSpec, ClassicOutput, ClassicPlot, ClassicBand, ClassicLevel } from './define';
