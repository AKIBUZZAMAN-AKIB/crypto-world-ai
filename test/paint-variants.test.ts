import { describe, it, expect } from 'vitest';
import {
    PAINT_VARIANTS,
    paintVariant,
    isPaintVariant,
    paintVariantIds,
    paintFamily,
    volumeWidthShare,
    normalizeVariantSettings,
    DEFAULT_VARIANT_SETTINGS,
} from '../src/core/price-styles/variants';
import { BUILTIN_PRICE_STYLES, priceStyleIds, basePaintingOf, hasOwnCandlePaint, mergeConfig, factoryResetConfig } from '../src/renderers/native/core/chartConfig';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { iconMarkup } from '../src/core/icons';

describe('painting variants — the catalogue', () => {
    it('ships the eight TradingView painting styles', () => {
        expect(paintVariantIds()).toEqual([
            'hollow-candles',
            'volume-candles',
            'line-markers',
            'stepline',
            'hlc-area',
            'columns',
            'high-low',
            'hlc-bars',
        ]);
    });

    it('gives every variant a label, a glyph and a cosmetics family', () => {
        for (const v of PAINT_VARIANTS) {
            expect(v.label.length).toBeGreaterThan(0);
            expect(v.icon).toMatch(/^<svg/);
            expect(['candles', 'bars', 'line', 'area']).toContain(v.paints);
        }
    });

    it('registers each glyph under style-<id> so the pickers can find it', () => {
        for (const v of PAINT_VARIANTS) expect(iconMarkup(`style-${v.id}`)).toBeTruthy();
    });

    it('resolves a variant by id and rejects everything else', () => {
        expect(paintVariant('stepline')?.label).toBe('Step line');
        expect(paintVariant('candles')).toBeUndefined();
        expect(paintVariant('nope')).toBeUndefined();
        expect(isPaintVariant('columns')).toBe(true);
        expect(isPaintVariant('baseline')).toBe(false);
    });
});

describe('painting variants — the painting family', () => {
    it('maps the classic styles onto their own painters', () => {
        expect(paintFamily('candles')).toBe('candles');
        expect(paintFamily('heikinashi')).toBe('candles');
        expect(paintFamily('bars')).toBe('bars');
        expect(paintFamily('line')).toBe('line');
        expect(paintFamily('area')).toBe('area');
        expect(paintFamily('baseline')).toBe('baseline');
    });

    it('returns the variant id itself so one switch serves both backends', () => {
        for (const id of paintVariantIds()) expect(paintFamily(id)).toBe(id);
    });

    it('returns null for a plugin chart type (it paints itself)', () => {
        expect(paintFamily('some-plugin-type')).toBeNull();
    });
});

describe('painting variants — volume → width', () => {
    it('is linear in volume against the visible max, so neighbours stay comparable', () => {
        const share = volumeWidthShare(50, 100, 20);
        expect(share).toBeCloseTo(0.6, 5); // 0.2 + 0.8 × 0.5
        expect(volumeWidthShare(100, 100, 20)).toBeCloseTo(1, 5);
        expect(volumeWidthShare(25, 100, 20)).toBeCloseTo(0.4, 5);
    });

    it('floors a dead bar at the configured minimum so it still reads as a candle', () => {
        expect(volumeWidthShare(0, 100, 20)).toBeCloseTo(0.2, 5);
        expect(volumeWidthShare(1, 1e9, 35)).toBeCloseTo(0.35, 2);
    });

    it('never returns a share outside (0, 1] for garbage input', () => {
        for (const [v, max, min] of [
            [0, 0, 22],
            [-5, 100, 22],
            [Number.NaN, 100, 22],
            [10, 0, 22],
            [10, 100, 0],
            [10, 100, 500],
        ]) {
            const s = volumeWidthShare(v as number, max as number, min as number);
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThanOrEqual(1);
        }
    });
});

describe('painting variants — settings', () => {
    it('defaults are the documented first-run state', () => {
        expect(normalizeVariantSettings(undefined)).toEqual(DEFAULT_VARIANT_SETTINGS);
        expect(DEFAULT_VARIANT_SETTINGS.hollowUp).toBe(true);
        expect(DEFAULT_VARIANT_SETTINGS.columnBaseline).toBe('zero');
    });

    it('clamps numbers and drops malformed fields', () => {
        const s = normalizeVariantSettings({ volumeMinWidthPct: 999, markerRadius: -3, columnBaseline: 'nope', hollowUp: 'yes', highLowColor: 12 });
        expect(s.volumeMinWidthPct).toBe(100);
        expect(s.markerRadius).toBe(0.5);
        expect(s.columnBaseline).toBe('zero');
        expect(s.hollowUp).toBe(true);
        expect(s.highLowColor).toBeNull();
    });
});

describe('painting variants — config plumbing', () => {
    it('the built-in list carries them after the classic six', () => {
        expect(BUILTIN_PRICE_STYLES.slice(0, 6)).toEqual(['candles', 'bars', 'line', 'area', 'baseline', 'heikinashi']);
        for (const id of paintVariantIds()) expect(priceStyleIds()).toContain(id);
    });

    it('none of them is a plugin type, so none gets its own candle bag', () => {
        for (const id of paintVariantIds()) {
            expect(basePaintingOf(id)).toBe('candles');
            expect(hasOwnCandlePaint(id)).toBe(false);
        }
    });

    it('a partial patch merges per key instead of wiping the rest', () => {
        const r = new NativeRenderer();
        const base = r.getConfig();
        const merged = mergeConfig({ ...base, ...({} as object) } as never, {
            variants: { markerRadius: 5 },
        });
        expect(merged.variants.markerRadius).toBe(5);
        // every other knob kept the value it had, not the default
        expect(merged.variants.hollowUp).toBe(base.variants.hollowUp);
        expect(merged.variants.columnBaseline).toBe(base.variants.columnBaseline);
    });

    it('round-trips through the renderer: style accepted, knobs persisted', () => {
        const r = new NativeRenderer();
        for (const id of paintVariantIds()) {
            r.applyFeature('priceStyle', id);
            expect(r.readFeature('priceStyle')).toBe(id);
        }
        r.applyConfig({ variants: { hollowUp: false, markerRadius: 4 } });
        const cfg = r.getConfig();
        expect(cfg.variants.hollowUp).toBe(false);
        expect(cfg.variants.markerRadius).toBe(4);
        // …and the untouched keys kept their defaults
        expect(cfg.variants.volumeMinWidthPct).toBe(DEFAULT_VARIANT_SETTINGS.volumeMinWidthPct);
    });

    it('a factory reset restores the variant defaults', () => {
        const r = new NativeRenderer();
        r.applyConfig({ variants: { hollowUp: false, columnBaseline: 'first' } });
        const factory = r.getConfig();
        // The reset document is built from a pristine snapshot + a live style; the variant
        // block must come back at its defaults, not at whatever the user had set.
        const doc = factoryResetConfig({ ...factory, variants: { ...DEFAULT_VARIANT_SETTINGS } }, r.readFeature('priceStyle') as never);
        expect(doc.variants).toEqual(DEFAULT_VARIANT_SETTINGS);
        r.applyConfig(doc);
        expect(r.getConfig().variants).toEqual(DEFAULT_VARIANT_SETTINGS);
    });
});
