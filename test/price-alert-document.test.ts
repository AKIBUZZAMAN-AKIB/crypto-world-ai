// @vitest-environment jsdom
// An armed alert is a DECISION about a market, so it rides the saved document — and a
// document written by a hostile/broken client must not re-arm something that can never
// fire. These specs pin both directions of `sanitizeState`'s `priceAlerts` handling.
import { describe, it, expect } from 'vitest';
import { sanitizeState } from '../src/state/document';

const base = { version: 1, layout: '4', charts: [{ id: 'a', symbol: 'AAA' }] };

describe('document — armed price alerts', () => {
    it('round-trips a valid row', () => {
        const doc = {
            ...base,
            priceAlerts: [
                {
                    cellId: 'a',
                    symbol: 'AAA',
                    condition: 'move-up-pct',
                    value: 1.5,
                    frequency: 'each',
                    bars: 8,
                    state: 'active',
                    createdAt: 1700000000000,
                    fires: 3,
                },
            ],
        };
        const out = sanitizeState(doc)!;
        expect(out.priceAlerts).toEqual(doc.priceAlerts);
    });

    it('drops rows that can never fire (no cell, no level, no condition)', () => {
        const out = sanitizeState({
            ...base,
            priceAlerts: [
                { cellId: 'a', symbol: 'AAA', condition: 'cross', value: Number.NaN },
                { symbol: 'AAA', condition: 'cross', value: 100 },
                { cellId: 'a', symbol: 'AAA', value: 100 },
                null,
                'nope',
            ],
        })!;
        expect(out.priceAlerts).toBeUndefined();
    });

    it('normalises the loose fields a hand-written document can carry', () => {
        const out = sanitizeState({
            ...base,
            priceAlerts: [{ cellId: 'a', symbol: 'AAA', condition: 'gt', value: 100, frequency: 'sometimes', bars: -2, state: 'weird', fires: -1 }],
        })!;
        expect(out.priceAlerts?.[0]).toMatchObject({ frequency: 'once', bars: 5, state: 'active', fires: 0 });
    });

    it('an absent field stays absent (old documents restore unchanged)', () => {
        expect(sanitizeState(base)!.priceAlerts).toBeUndefined();
    });
});
