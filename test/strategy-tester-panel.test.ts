// @vitest-environment jsdom
// The Strategy Tester panel, rendered: a fake chart + a fake strategy run go in, and the
// four tabs' DOM comes out. This is the seam a unit test of the math cannot reach — the
// async ledger read, the tab switch, and the empty state a chart with no strategy shows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyTester } from '../src/widget/strategy-tester';
import type { ScriptRun } from '../src/core/script-run';
import type { StrategyState, StrategyTrade } from '../src/core/model/strategy';
import type { Vela } from '../src/Vela';

const HR = 3_600_000;

function state(over: Partial<StrategyState> = {}): StrategyState {
    return {
        position: 0,
        avgPrice: 0,
        equity: 10_000,
        openPnl: 0,
        netPnl: 18,
        grossProfit: 30,
        grossLoss: 12,
        wins: 1,
        losses: 1,
        even: 0,
        maxDrawdown: 40,
        maxRunup: 55,
        initialCapital: 10_000,
        ...over,
    };
}

const TRADES: StrategyTrade[] = [
    {
        id: 't1',
        side: 'long',
        qty: 2,
        entry: { id: 'L', time: 10 * HR, price: 100.5 },
        exit: { id: 'X', time: 14 * HR, price: 115 },
        open: false,
        pnl: 30,
        commission: 1,
    },
    {
        id: 't2',
        side: 'short',
        qty: 1,
        entry: { id: 'S', time: 20 * HR, price: 120 },
        exit: { id: 'X', time: 23 * HR, price: 132 },
        open: false,
        pnl: -12,
        commission: 0.5,
    },
];

function fakeChart(handles: unknown[] = []): Vela {
    const chart = {
        on: vi.fn(() => () => undefined),
        market: { symbol: 'BTCUSDT', timeframe: '1h', provider: 'binance' },
        indicators: () => handles,
    };
    return chart as unknown as Vela;
}

function fakeRun(over: Partial<ScriptRun> = {}): ScriptRun {
    return {
        id: 'strat-1',
        title: 'SMA cross',
        kind: 'strategy',
        cause: 'first',
        first: true,
        bar: 499,
        time: 100 * HR,
        forming: false,
        complete: true,
        plots: {},
        vars: {},
        strategy: state(),
        warnings: [],
        trades: async () => TRADES,
        series: async () => [],
        ...over,
    } as ScriptRun;
}

function flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

function texts(root: HTMLElement, sel: string): string[] {
    return Array.from(root.querySelectorAll(sel)).map((el) => (el.textContent ?? '').trim());
}

beforeEach(() => {
    document.body.replaceChildren();
    // jsdom has no canvas backend; the panel degrades to no curve, which is what a
    // renderer without 2d support would see too.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

describe('strategy tester panel', () => {
    it('says so on a chart that runs no strategy', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        panel.onChart(fakeChart());
        panel.toggle(true);
        expect(host.textContent).toContain('Add a strategy to the chart');
        expect(texts(host, '.vela-st-tab')).toEqual(['Overview', 'Performance', 'Trades', 'Properties']);
    });

    it('fills the Overview with the four key stats and the run title', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        expect(texts(host, '.vela-st-title')[0]).toBe('SMA cross');
        const labels = texts(host, '.vela-st-stat-label');
        expect(labels).toEqual(['Total P&L', 'Max drawdown', 'Profitable trades', 'Profit factor']);
        const values = texts(host, '.vela-st-stat-value');
        expect(values[0]).toBe('+18.00');
        expect(values[1]).toBe('−40.00');
        expect(values[2]).toBe('50.00%');
        expect(values[3]).toBe('2.50');
        // The return row sits under the net P&L: 18 on 10 000 capital.
        expect(texts(host, '.vela-st-stat-sub')).toContain('+0.18%');
    });

    it('lays the Performance table out in All / Long / Short columns', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="performance"]') as HTMLElement).click();
        expect(texts(host, 'thead th')).toEqual(['', 'All', 'Long', 'Short']);
        const rows = Array.from(host.querySelectorAll('tbody tr'));
        const netRow = rows.find((r) => r.querySelector('td')?.textContent === 'Net profit');
        expect(netRow).toBeDefined();
        expect(Array.from(netRow!.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Net profit', '18.00', '30.00', '−12.00']);
        // No metric label appears twice inside its own group.
        expect(texts(host, 'tbody tr.group').length).toBe(3);
    });

    it('lists each round trip with its running total', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLElement).click();
        const rows = Array.from(host.querySelectorAll('tbody tr')).map((r) =>
            Array.from(r.querySelectorAll('td')).map((td) => td.textContent),
        );
        expect(rows).toHaveLength(2);
        // #, Side, Date, Price, P&L, Total — the date is the short form, the price the fill.
        expect(rows[0]).toEqual(['1', 'Long', '1 Jan 70', '100.50', '30.00', '30.00']);
        expect(rows[1]).toEqual(['2', 'Short', '1 Jan 70', '120.00', '−12.00', '18.00']);
        expect(rows[0]![1]).toBe('Long');
    });

    it('shows the declaration properties and inputs of the strategy', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const handle = {
            id: 'strat-1',
            props: [
                { key: 'initial_capital', title: 'Initial capital', type: 'float', defval: 10000 },
                { key: 'commission_value', title: 'Commission', type: 'float', defval: 0.04 },
            ],
            inputs: [{ key: 'length', title: 'Length', type: 'int', defval: 20 }],
            propValues: () => ({ commission_value: 0.1 }),
            inputValues: () => ({}),
        };
        const chart = fakeChart([handle]);
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="properties"]') as HTMLElement).click();
        const terms = texts(host, 'dt');
        expect(terms).toContain('Initial capital');
        expect(terms).toContain('Length');
        const kv = Array.from(host.querySelectorAll('.vela-st-kv')).map((dl) => dl.textContent);
        expect(kv.join('|')).toContain('10,000');
        // A prop the user overrode wins over the declared default.
        expect(kv.join('|')).toContain('0.10');
        expect(kv.join('|')).toContain('20');
    });

    it('keeps an open trade out of the money columns', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(
            chart,
            fakeRun({
                trades: async () => [
                    ...TRADES,
                    { id: 't3', side: 'long', qty: 1, entry: { id: 'E', time: 30 * HR, price: 130 }, open: true },
                ],
            }),
        );
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLElement).click();
        const rows = Array.from(host.querySelectorAll('tbody tr')).map((r) =>
            Array.from(r.querySelectorAll('td')).map((td) => td.textContent),
        );
        expect(rows).toHaveLength(3);
        expect(rows[2]![4]).toBe('—');
        expect(rows[2]![5]).toBe('—');
        (host.querySelector('.vela-st-tab[data-tab="performance"]') as HTMLElement).click();
        const openRow = Array.from(host.querySelectorAll('tbody tr')).find(
            (r) => r.querySelector('td')?.textContent === 'Open trades',
        );
        expect(openRow!.querySelectorAll('td')[1]!.textContent).toBe('1');
        // The table shows the short label; the full name rides the hover.
        expect(openRow!.querySelector('td')!.getAttribute('title')).toBe('Total open trades');
    });

    it('reads the ledger once for a run that arrives twice', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        let reads = 0;
        const run = fakeRun({
            trades: async () => {
                reads += 1;
                return TRADES;
            },
        });
        // The panel's own subscription and the workspace's relay both report this run.
        panel.setRun(chart, run);
        panel.setRun(chart, run);
        await flush();
        expect(reads).toBe(1);
        expect(texts(host, '.vela-st-stat-value')[0]).toBe('+18.00');
    });

    it('drops a stale ledger answer when a newer run lands', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = new StrategyTester(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        const slowAnswer: { release: ((t: readonly StrategyTrade[]) => void) | null } = { release: null };
        const slow = fakeRun({
            title: 'old',
            trades: () => new Promise<readonly StrategyTrade[]>((resolve) => {
                slowAnswer.release = (t) => resolve(t);
            }),
        });
        panel.setRun(chart, slow);
        panel.setRun(chart, fakeRun({ title: 'new', trades: async () => TRADES.slice(0, 1) }));
        await flush();
        slowAnswer.release?.(TRADES);
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLElement).click();
        expect(texts(host, 'tbody tr').length).toBe(1);
        expect(texts(host, '.vela-st-title')[0]).toBe('new');
    });
});
