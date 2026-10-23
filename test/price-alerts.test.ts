// @vitest-environment jsdom
// The price-alert engine's truth table. A missed or spurious crossing is a trading
// mistake, so every operator is pinned in BOTH directions, plus the two cases people get
// wrong in a hand-rolled version: an alert created AT the price (no side to come from) and
// a repeat alert that must not re-fire while the price sits past the level.
import { describe, it, expect } from 'vitest';
import { advanceAlert, alertFires, formatLevel, nextAlertId, type PriceAlert } from '../src/workspace/price-alerts';

const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: 'a1',
    cellId: 'c1',
    symbol: 'AAA',
    condition: 'cross',
    value: 100,
    frequency: 'once',
    state: 'active',
    createdAt: 0,
    anchorPrice: null,
    firedAt: 0,
    fires: 0,
    lineId: '',
    ...over,
});

const fires = (condition: PriceAlert['condition'], prev: number | null, now: number, value = 100): boolean =>
    alertFires({ condition, value }, { prev, now });

describe('price alert — crossing arithmetic', () => {
    it('Crossing fires from both directions, and only when the level is actually crossed', () => {
        expect(fires('cross', 99, 100.5)).toBe(true);
        expect(fires('cross', 101, 99.5)).toBe(true);
        expect(fires('cross', 99, 99.5)).toBe(false); // still below
        expect(fires('cross', 101, 100.5)).toBe(false); // still above
    });

    it('Crossing up / down only take their own direction', () => {
        expect(fires('cross-up', 99, 101)).toBe(true);
        expect(fires('cross-up', 101, 99)).toBe(false);
        expect(fires('cross-down', 101, 99)).toBe(true);
        expect(fires('cross-down', 99, 101)).toBe(false);
    });

    it('Greater/Less than wait until the price is PAST the level, not on it', () => {
        expect(fires('gt', 99, 100)).toBe(false); // touch is not "greater"
        expect(fires('gt', 99, 100.01)).toBe(true);
        expect(fires('lt', 101, 100)).toBe(false);
        expect(fires('lt', 101, 99.99)).toBe(true);
    });

    it('a repeat (`each`) alert above the level does not re-fire on every bar', () => {
        expect(fires('gt', 100.2, 100.3)).toBe(false);
        expect(fires('gt', 100.3, 100.9)).toBe(false);
    });

    it('the first tick of a watch never crosses — but a state condition is already true', () => {
        expect(fires('cross', null, 120)).toBe(false);
        expect(fires('cross-up', null, 120)).toBe(false);
        // "greater than 100" armed while the market prints 120 is true at birth…
        expect(fires('gt', null, 120)).toBe(true);
        expect(fires('lt', null, 120)).toBe(false);
    });

    it('non-finite prices and levels are inert', () => {
        expect(fires('cross', 99, Number.NaN)).toBe(false);
        expect(fires('cross', 99, 101, Number.NaN)).toBe(false);
    });
});

describe('price alert — lifecycle', () => {
    it('an alert created at the current price adopts it and stays quiet on the next tick', () => {
        const first = advanceAlert(alert({ value: 143.5 }), { prev: null, now: 143.5 });
        expect(first.fired).toBe(false);
        expect(first.alert.anchorPrice).toBe(143.5);
        const second = advanceAlert(first.alert, { prev: 143.5, now: 143.5 });
        expect(second.fired).toBe(false);
    });

    it('`once` retires after firing; `each` stays active', () => {
        const once = advanceAlert(alert({ frequency: 'once', value: 100 }), { prev: 99, now: 101 });
        expect(once.fired).toBe(true);
        expect(once.alert.state).toBe('fired');
        expect(advanceAlert(once.alert, { prev: 101, now: 99 }).fired).toBe(false);

        const each = advanceAlert(alert({ frequency: 'each', value: 100 }), { prev: 99, now: 101 });
        expect(each.fired).toBe(true);
        expect(each.alert.state).toBe('active');
        expect(each.alert.fires).toBe(1);
        // …and it fires again on the next genuine crossing
        expect(advanceAlert(each.alert, { prev: 101, now: 99 }).fired).toBe(true);
    });

    it('a paused alert is inert', () => {
        expect(advanceAlert(alert({ state: 'paused' }), { prev: 99, now: 101 }).fired).toBe(false);
    });

    it('ids never collide', () => {
        expect(nextAlertId([])).toBe('a1');
        expect(nextAlertId([{ id: 'a1' }, { id: 'a2' }])).toBe('a3');
        // 'a3' is taken even though only two alerts exist — the count is not the id.
        expect(nextAlertId([{ id: 'a1' }, { id: 'a3' }])).toBe('a4');
    });

    it('levels print readably at every magnitude', () => {
        expect(formatLevel(143.5)).toBe('143.50');
        expect(formatLevel(0.0000123)).toMatch(/^0\.00001230|^1\.23e-5/);
        expect(formatLevel(Number.NaN)).toBe('—');
    });
});
