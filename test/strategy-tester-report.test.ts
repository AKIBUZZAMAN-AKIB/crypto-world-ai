// The strategy-tester panel's pure half: how a report is FORMATTED into the rows the
// Performance table shows, and how a money figure is signed. The panel renders exactly
// this data, so a mislabelled or duplicated row is caught here rather than by eye.
import { describe, expect, it } from 'vitest';
import { buildStrategyReport } from '../src/core/strategy-report';
import { ink, money, moneyCell, pct, performanceRows, ratio, stamp, type CellView } from '../src/widget/strategy-tester';
import type { StrategyState, StrategyTrade } from '../src/core/model/strategy';

const HR = 3_600_000;

function trade(over: Partial<StrategyTrade> & { id: string }): StrategyTrade {
    return {
        side: 'long',
        qty: 1,
        entry: { id: 'E', time: 0, price: 100 },
        exit: { id: 'X', time: HR, price: 110 },
        open: false,
        pnl: 10,
        ...over,
    };
}

function state(over: Partial<StrategyState> = {}): StrategyState {
    return {
        position: 0,
        avgPrice: 0,
        equity: 10_000,
        openPnl: 0,
        netPnl: 0,
        grossProfit: 0,
        grossLoss: 0,
        wins: 0,
        losses: 0,
        even: 0,
        maxDrawdown: 0,
        maxRunup: 0,
        initialCapital: 10_000,
        ...over,
    };
}

const report = buildStrategyReport([trade({ id: 'a', pnl: 30 }), trade({ id: 'b', side: 'short', pnl: -12 })], {
    state: state({ netPnl: 18, maxDrawdown: -40, initialCapital: 10_000 }),
});

describe('strategy tester — formatting', () => {
    it('signs money with a true minus glyph and never a bare negative', () => {
        expect(money(1234.5)).toBe('+1,234.50');
        expect(money(-12)).toBe('−12.00');
        expect(money(0)).toBe('0.00');
        expect(money(null)).toBe('—');
        expect(money(Number.NaN)).toBe('—');
        expect(money(-5, false)).toBe('5.00');
    });

    it('leaves a ratio an em dash when it cannot exist', () => {
        expect(ratio(2.5)).toBe('2.50');
        expect(ratio(null)).toBe('—');
        expect(ratio(Number.POSITIVE_INFINITY)).toBe('—');
    });

    it('signs a percentage only where it is a change', () => {
        expect(pct(42.678)).toBe('42.68%');
        expect(pct(-3.5, true)).toBe('−3.50%');
        expect(pct(2.25, true)).toBe('+2.25%');
        expect(pct(null)).toBe('—');
    });

    it('inks a value by its direction', () => {
        expect(ink(5)).toBe('vela-st-up');
        expect(ink(-5)).toBe('vela-st-down');
        expect(ink(0)).toBe('vela-st-flat');
        expect(ink(null)).toBe('vela-st-flat');
    });

    it('stamps a trade in UTC', () => {
        expect(stamp(Date.UTC(2026, 0, 2, 3, 4))).toBe('2 Jan 2026  03:04');
        expect(stamp(Number.NaN)).toBe('—');
    });
});

describe('strategy tester — Performance table', () => {
    it('has no duplicated metric label inside its own group', () => {
        const seen: string[] = [];
        let group = '';
        for (const row of performanceRows(report)) {
            if (row.kind === 'group') {
                group = row.label;
                seen.length = 0;
                continue;
            }
            expect(seen, `${row.label} repeats in group ${group}`).not.toContain(row.label);
            seen.push(row.label);
        }
    });

    it('fills the three columns from the three slices', () => {
        const rows = performanceRows(report);
        const net = rows.find((r) => r.kind === 'metric' && r.label === 'Net profit');
        expect(net).toBeDefined();
        if (net?.kind !== 'metric') throw new Error('unreachable');
        expect(net.all.text).toBe('18.00');
        expect(net.long.text).toBe('30.00');
        expect(net.short.text).toBe('−12.00');
    });

    it('shows an em dash for a column the data cannot answer', () => {
        const noLedger = buildStrategyReport([], { state: state({ netPnl: 10, wins: 1, grossProfit: 10 }) });
        const rows = performanceRows(noLedger);
        const net = rows.find((r) => r.kind === 'metric' && r.label === 'Net profit');
        if (net?.kind !== 'metric') throw new Error('unreachable');
        expect(net.all.text).toBe('10.00');
        expect(net.long.text).toBe('—');
        expect(net.short.text).toBe('—');
    });

    it('keeps the loss rows negative and the profit rows positive', () => {
        const rows = performanceRows(report);
        const pick = (label: string): { all: CellView; long: CellView; short: CellView } => {
            const r = rows.find((x) => x.kind === 'metric' && x.hint === label);
            if (r?.kind !== 'metric') throw new Error(`missing row ${label}`);
            return r;
        };
        expect(pick('Gross profit').all.text).toBe('30.00');
        expect(pick('Gross loss').all.text).toBe('−12.00');
        expect(pick('Largest losing trade').all.text).toBe('−12.00');
        expect(pick('Percent profitable').all.text).toBe('50.00%');
        expect(pick('Profit factor').all.text).toBe('2.50');
        expect(pick('Total closed trades').all.text).toBe('2');
    });

    it('carries each money cell’s direction as data', () => {
        const rows = performanceRows(report);
        const cell = (label: string): CellView => {
            const r = rows.find((x) => x.kind === 'metric' && x.hint === label);
            if (r?.kind !== 'metric') throw new Error(`missing row ${label}`);
            return r.all;
        };
        expect(cell('Net profit').dir).toBe(1);
        expect(cell('Gross loss').dir).toBe(-1);
        expect(cell('Avg losing trade').dir).toBe(-1);
        // A count or a ratio has no direction: its ink stays the panel's normal text.
        expect(cell('Total closed trades').dir).toBe(0);
        expect(cell('Profit factor').dir).toBe(0);
        // A column the data cannot answer is neutral, not "losing".
        expect(cell('Max equity run-up').dir === 1 || cell('Max equity run-up').dir === 0).toBe(true);
    });

    it('drops the plus sign in a table cell but keeps the minus', () => {
        expect(moneyCell(1234.5)).toBe('1,234.50');
        expect(moneyCell(-1234.5)).toBe('−1,234.50');
        expect(moneyCell(null)).toBe('—');
    });

    it('groups the rows without leaving an empty group', () => {
        const rows = performanceRows(report);
        const groups = rows.filter((r) => r.kind === 'group');
        expect(groups.length).toBe(3);
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i]!;
            if (row.kind === 'group') {
                const next = rows[i + 1];
                expect(next?.kind, `group ${row.label} has no rows`).toBe('metric');
            }
        }
    });
});
