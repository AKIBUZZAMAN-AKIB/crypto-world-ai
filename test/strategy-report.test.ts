import { describe, expect, it } from 'vitest';
import {
    buildStrategyReport,
    statsFor,
    statsFromState,
    tradeRows,
    type ReportStats,
} from '../src/core/strategy-report';
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

const near = (a: number | null, b: number): void => {
    expect(a).not.toBeNull();
    expect(a as number).toBeCloseTo(b, 10);
};

describe('strategy report — statistics', () => {
    it('reports nothing at all for an empty ledger', () => {
        const r = buildStrategyReport([]);
        expect(r.rows).toEqual([]);
        expect(r.equity).toEqual([]);
        expect(r.all.trades).toBe(0);
        expect(r.all.netProfit).toBe(0);
        expect(r.all.percentProfitable).toBeNull();
        expect(r.all.profitFactor).toBeNull();
        expect(r.all.avgTrade).toBeNull();
        expect(r.long).toBeNull();
        expect(r.short).toBeNull();
        expect(r.returnPct).toBeNull();
    });

    it('splits gross profit from gross loss and keeps the loss a positive magnitude', () => {
        const s = statsFor([trade({ id: 'a', pnl: 30 }), trade({ id: 'b', pnl: -12 }), trade({ id: 'c', pnl: 0 })]);
        expect(s.trades).toBe(3);
        expect(s.wins).toBe(1);
        expect(s.losses).toBe(1);
        expect(s.even).toBe(1);
        expect(s.grossProfit).toBe(30);
        expect(s.grossLoss).toBe(12);
        expect(s.netProfit).toBe(18);
        near(s.profitFactor, 2.5);
        // Three closed trades — the even one divides too (the reference's rule).
        near(s.percentProfitable, 100 / 3);
        near(s.avgTrade, 6);
        near(s.avgWin, 30);
        near(s.avgLoss, 12);
        near(s.ratioWinLoss, 2.5);
        expect(s.largestWin).toBe(30);
        expect(s.largestLoss).toBe(12);
    });

    it('nulls the ratios whose denominator is zero instead of inventing a number', () => {
        const s = statsFor([trade({ id: 'a', pnl: 5 }), trade({ id: 'b', pnl: 7 })]);
        expect(s.profitFactor).toBeNull();
        expect(s.ratioWinLoss).toBeNull();
        expect(s.avgLoss).toBeNull();
        expect(s.largestLoss).toBeNull();
    });

    it('leaves open trades out of every ratio but counts them', () => {
        const s = statsFor([
            trade({ id: 'a', pnl: 20 }),
            trade({ id: 'b', open: true, exit: undefined, pnl: undefined }),
        ]);
        expect(s.trades).toBe(1);
        expect(s.openTrades).toBe(1);
        expect(s.netProfit).toBe(20);
        expect(s.percentProfitable).toBe(100);
    });

    it('sums commission over every trade that reports one', () => {
        const s = statsFor([trade({ id: 'a', commission: 1.5 }), trade({ id: 'b', commission: 2 })]);
        expect(s.commission).toBe(3.5);
    });

    it('measures bar counts close-to-close only when the timeframe is known', () => {
        const t = trade({ id: 'a', entry: { id: 'E', time: 0, price: 100 }, exit: { id: 'X', time: 5 * HR, price: 110 } });
        near(statsFor([t], HR).avgBars, 5);
        expect(statsFor([t]).avgBars).toBeNull();
        expect(statsFor([t], 0).avgBars).toBeNull();
    });

    it('builds the account column from the broker state when there is no ledger', () => {
        const s = statsFromState(
            state({ wins: 3, losses: 1, grossProfit: 300, grossLoss: 100, netPnl: 200, maxDrawdown: -80, maxRunup: 250, position: 2 }),
        );
        expect(s.trades).toBe(4);
        expect(s.openTrades).toBe(1);
        expect(s.netProfit).toBe(200);
        near(s.profitFactor, 3);
        near(s.percentProfitable, 75);
        near(s.avgTrade, 50);
        expect(s.maxDrawdown).toBe(80); // magnitudes, never signed
        expect(s.maxRunup).toBe(250);
        expect(s.largestWin).toBeNull(); // only a ledger can answer this
    });

    it('takes the money rows from the state when the ledger reports no P&L', () => {
        const r = buildStrategyReport([trade({ id: 'a', pnl: undefined }), trade({ id: 'b', open: true, exit: undefined })], {
            state: state({ netPnl: 42, grossProfit: 42, wins: 1 }),
        });
        expect(r.all.netProfit).toBe(42);
        expect(r.all.trades).toBe(1); // the closed one, from the ledger
        expect(r.all.openTrades).toBe(1);
        expect(r.rows[0]!.pnl).toBeNull(); // per trade it is still unknown — not zero
    });

    it('merges the account drawdown / run-up into the All column only', () => {
        const r = buildStrategyReport([trade({ id: 'a', pnl: 10 }), trade({ id: 'b', side: 'short', pnl: -5 })], {
            state: state({ maxDrawdown: -70, maxRunup: 90 }),
        });
        expect(r.all.maxDrawdown).toBe(70);
        expect(r.all.maxRunup).toBe(90);
        expect(r.long!.maxDrawdown).toBe(0);
        expect(r.short!.maxDrawdown).toBe(0);
    });
});

describe('strategy report — columns and rows', () => {
    it('splits the long and short columns', () => {
        const r = buildStrategyReport([
            trade({ id: 'a', side: 'long', pnl: 30 }),
            trade({ id: 'b', side: 'short', pnl: -10 }),
            trade({ id: 'c', side: 'short', pnl: 5 }),
        ]);
        expect(r.long!.trades).toBe(1);
        expect(r.long!.netProfit).toBe(30);
        expect(r.short!.trades).toBe(2);
        expect(r.short!.netProfit).toBe(-5);
        expect(r.all.netProfit).toBe(25);
    });

    it('orders closed trades by exit, numbers them 1..n, and totals cumulatively', () => {
        const r = buildStrategyReport([
            trade({ id: 'late', entry: { id: 'E', time: 9 * HR, price: 1 }, exit: { id: 'X', time: 10 * HR, price: 2 }, pnl: 20 }),
            trade({ id: 'stillOpen', open: true, exit: undefined, pnl: undefined, entry: { id: 'E', time: 0, price: 1 } }),
            trade({ id: 'early', entry: { id: 'E', time: 1 * HR, price: 1 }, exit: { id: 'X', time: 2 * HR, price: 2 }, pnl: -5 }),
        ]);
        expect(r.rows.map((x) => x.n)).toEqual([1, 2, 3]);
        expect(r.rows.map((x) => x.pnl)).toEqual([-5, 20, null]);
        expect(r.rows.map((x) => x.cumulative)).toEqual([-5, 15, null]);
        expect(r.rows[2]!.open).toBe(true);
        expect(r.rows[2]!.exitTime).toBeNull();
    });

    it('draws the equity curve as cumulative P&L at each close, starting at zero', () => {
        const r = buildStrategyReport(
            [
                trade({ id: 'a', entry: { id: 'E', time: 1 * HR, price: 1 }, exit: { id: 'X', time: 2 * HR, price: 2 }, pnl: 10 }),
                trade({ id: 'b', entry: { id: 'E', time: 3 * HR, price: 1 }, exit: { id: 'X', time: 4 * HR, price: 2 }, pnl: -4 }),
            ],
            { barMs: HR },
        );
        expect(r.equity).toEqual([
            { time: 1 * HR, value: 0 },
            { time: 2 * HR, value: 10 },
            { time: 4 * HR, value: 6 },
        ]);
        near(r.rows[0]!.bars, 1);
    });

    it('reports the return on the initial capital the strategy declared', () => {
        const r = buildStrategyReport([trade({ id: 'a', pnl: 500 })], { state: state({ initialCapital: 10_000, netPnl: 500 }) });
        near(r.returnPct, 5);
        expect(r.initialCapital).toBe(10_000);
    });

    it('keeps the report well-formed when the state is missing', () => {
        const r = buildStrategyReport([trade({ id: 'a', pnl: 10 })]);
        expect(r.initialCapital).toBeNull();
        expect(r.returnPct).toBeNull();
        const all: ReportStats = r.all;
        expect(all.maxDrawdown).toBe(0);
        expect(all.netProfit).toBe(10);
    });
});
