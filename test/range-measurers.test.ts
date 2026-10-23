import { describe, expect, it } from 'vitest';
import { createDrawing, drawingTypes, getDrawingType } from '../src/core/drawings/registry';
import { MeasureBox } from '../src/core/drawings/types/MeasureBox';

const init = { paneId: 'p1' };

describe('range measurers — the ruler split into its halves', () => {
    it('registers all three in TradingView order: date & price, price, date', () => {
        const ids = drawingTypes().filter((t) => t.group === 'measure').map((t) => t.type as string);
        const mine = ids.filter((t) => t === 'datepricerange' || t === 'pricerange' || t === 'daterange');
        expect(mine).toEqual(['datepricerange', 'pricerange', 'daterange']);
    });

    it('Price Range hides the date line but keeps the price line', () => {
        const d = createDrawing('pricerange', init) as MeasureBox;
        expect(d).toBeInstanceOf(MeasureBox);
        expect(d.showPrice).toBe(true);
        expect(d.showDate).toBe(false);
    });

    it('Date Range hides the price line but keeps the date line', () => {
        const d = createDrawing('daterange', init) as MeasureBox;
        expect(d.showPrice).toBe(false);
        expect(d.showDate).toBe(true);
    });

    it('the combined ruler still shows both', () => {
        const d = createDrawing('datepricerange', init) as MeasureBox;
        expect([d.showPrice, d.showDate]).toEqual([true, true]);
    });

    it('all three are two-corner boxes with free handles', () => {
        for (const type of ['datepricerange', 'pricerange', 'daterange'] as const) {
            const d = createDrawing(type, init) as MeasureBox;
            const schema = d.anchorSchema();
            expect(schema.min).toBe(2);
            expect(schema.max).toBe(2);
            expect(schema.slots.map((s) => s.free)).toEqual(['both', 'both']);
        }
    });

    it('a TRADER’s saved toggle wins over the tool default', () => {
        // A Price Range drawing restored with "Show date" switched back on must keep it:
        // the preset is a starting point, never an override.
        const d = createDrawing('pricerange', { ...init, props: { showDate: true } }) as MeasureBox;
        expect(d.showDate).toBe(true);
    });

    it('every measurer serialises its toggles, so a reload cannot flip them', () => {
        for (const type of ['pricerange', 'daterange'] as const) {
            const d = createDrawing(type, init) as MeasureBox;
            const props = (d as unknown as { writeProps: () => Record<string, unknown> }).writeProps();
            expect(props).toEqual({ showPrice: d.showPrice, showDate: d.showDate });
        }
    });

    it('each has its own label and a glyph, so the flyout reads at a glance', () => {
        for (const type of ['pricerange', 'daterange'] as const) {
            const def = getDrawingType(type);
            expect(def?.label).toBeTruthy();
            expect(def?.icon).toContain('<svg');
        }
        expect(getDrawingType('pricerange')?.label).toBe('Price Range');
        expect(getDrawingType('daterange')?.label).toBe('Date Range');
    });
});
