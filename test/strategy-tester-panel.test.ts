// @vitest-environment jsdom
// The Strategy Tester panel, rendered: a fake chart + a fake strategy run go in, and the
// four tabs' DOM comes out. This is the seam a unit test of the math cannot reach — the
// async ledger read, the tab switch, and the empty state a chart with no strategy shows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const panels: StrategyTester[] = [];
function makePanel(host: HTMLElement): StrategyTester {
    const panel = new StrategyTester(host);
    panels.push(panel);
    return panel;
}

type TestListener = (payload: unknown) => void;
function eventChart(symbol = 'BTCUSDT'): { chart: Vela; market: { symbol: string; timeframe: string }; emit: (name: string, payload?: unknown) => void } {
    const handlers = new Map<string, Set<TestListener>>();
    const market = { symbol, timeframe: '60' };
    const chart = {
        market, loading: false, indicators: () => [],
        on: (name: string, listener: TestListener) => {
            const list = handlers.get(name) ?? new Set<TestListener>();
            handlers.set(name, list);
            list.add(listener);
            return () => list.delete(listener);
        },
    } as unknown as Vela;
    return { chart, market, emit: (name, payload) => handlers.get(name)?.forEach((listener) => listener(payload)) };
}

function flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

function current(root: HTMLElement, selector: string): HTMLElement | null {
    return root.querySelector(`.vela-st-view:not([hidden]) ${selector}`);
}

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    for (const panel of panels.splice(0)) panel.destroy();
});

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
        const panel = makePanel(host);
        panel.onChart(fakeChart());
        panel.toggle(true);
        expect(host.textContent).toContain('Add a strategy to the chart');
        expect(texts(host, '.vela-st-tab')).toEqual(['Overview', 'Performance', 'Trades', 'Properties']);
    });

    it('fills the Overview with the four key stats and the run title', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
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
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="performance"]') as HTMLElement).click();
        expect(texts(host, 'thead th')).toEqual(['Metric', 'All', 'Long', 'Short']);
        const rows = Array.from(host.querySelectorAll('tbody tr'));
        const netRow = rows.find((r) => r.querySelector('th[scope="row"]')?.textContent === 'Net profit');
        expect(netRow).toBeDefined();
        expect(Array.from(netRow!.querySelectorAll('th, td')).map((cell) => cell.textContent)).toEqual(['Net profit', '18.00', '30.00', '−12.00']);
        // No metric label appears twice inside its own group.
        expect(texts(host, 'tbody tr.group').length).toBe(3);
    });

    it('lists each round trip with its running total', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLElement).click();
        const rows = Array.from(host.querySelectorAll('.vela-st-trade-row')).map((r) =>
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
        const panel = makePanel(host);
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
        const panel = makePanel(host);
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
        const rows = Array.from(host.querySelectorAll('.vela-st-trade-row')).map((r) =>
            Array.from(r.querySelectorAll('td')).map((td) => td.textContent),
        );
        expect(rows).toHaveLength(3);
        expect(rows[2]![4]).toBe('—');
        expect(rows[2]![5]).toBe('—');
        (host.querySelector('.vela-st-tab[data-tab="performance"]') as HTMLElement).click();
        const openRow = Array.from(host.querySelectorAll('tbody tr')).find(
            (r) => r.querySelector('th[scope="row"]')?.textContent === 'Open trades',
        );
        expect(openRow!.querySelectorAll('td')[0]!.textContent).toBe('1');
        // The table shows the short label; the full name rides the hover.
        expect(openRow!.querySelector('th')!.getAttribute('title')).toBe('Total open trades');
    });

    it('reads the ledger once for a run that arrives twice', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
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
        const panel = makePanel(host);
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
        expect(texts(host, '.vela-st-trade-row').length).toBe(1);
        expect(texts(host, '.vela-st-title')[0]).toBe('new');
    });

    it('uses the standard pane and accessible, keyboard-navigable tabs with unique relationships', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        panel.onChart(fakeChart());
        panel.toggle(true);
        const shell = host.querySelector<HTMLElement>('.vela-st')!;
        expect(shell.dataset.standardPane).toBe('1');
        const max = shell.querySelector<HTMLButtonElement>('.vela-panel-max')!;
        expect(max.getAttribute('aria-label')).toBe('Maximize');
        expect(max.getAttribute('aria-pressed')).toBe('false');
        const tabs = Array.from(shell.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
        for (const tab of tabs) {
            const view = shell.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!;
            expect(view.getAttribute('aria-labelledby')).toBe(tab.id);
            expect(view.getAttribute('role')).toBe('tabpanel');
        }
        tabs[0]!.focus();
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
        tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(document.activeElement).toBe(tabs[3]);
        tabs[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(tabs[0]!.tabIndex).toBe(0);
        const second = makePanel(host);
        second.onChart(fakeChart());
        second.toggle(true);
        const ids = Array.from(host.querySelectorAll('[role="tab"], [role="tabpanel"]')).map((el) => el.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('distinguishes a pending or unavailable ledger from a strategy with no trades', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        let release: ((trades: readonly StrategyTrade[]) => void) | undefined;
        panel.setRun(chart, fakeRun({ trades: () => new Promise((resolve) => { release = resolve; }) }));
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Loading');
        expect(current(host, '.vela-st-empty')?.textContent).not.toContain('has not traded');
        release!(TRADES);
        await flush();
        expect(current(host, '.vela-st-trades tbody')?.querySelectorAll('.vela-st-trade-row')).toHaveLength(2);
        panel.setRun(chart, fakeRun({ trades: () => { throw new Error('no ledger'); } }));
        await flush();
        expect(current(host, '.vela-st-empty')?.textContent).toContain('unavailable');
        expect(current(host, '.vela-st-status')?.textContent).toContain('unavailable');
        (host.querySelector('.vela-st-tab[data-tab="overview"]') as HTMLButtonElement).click();
        expect(current(host, '.vela-st-stat-value')?.textContent).toBe('+18.00');
        expect(current(host, '.vela-st-note')?.textContent).toContain('unavailable');
    });

    it('exposes full trade details to click and keyboard, including an open position', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun({ trades: async () => [
            TRADES[0]!,
            { id: 'open', side: 'short', qty: 3, entry: { id: 'E', time: 30 * HR, price: 130 }, open: true },
        ] }));
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        const toggle = current(host, '.vela-st-trade-toggle') as HTMLButtonElement;
        expect(toggle.getAttribute('aria-label')).toBe('Trade 1 details');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.focus();
        toggle.click();
        const expanded = current(host, '.vela-st-trade-toggle') as HTMLButtonElement;
        expect(expanded.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(expanded);
        const details = current(host, '.vela-st-trade-details')!;
        expect(expanded.getAttribute('aria-controls')).toBe(details.id);
        expect(details.textContent).toContain('Entry time (UTC)');
        expect(details.textContent).toContain('Exit time (UTC)');
        expect(details.textContent).toContain('115.00');
        expect(details.textContent).toContain('Bars held');
        const second = host.querySelectorAll<HTMLButtonElement>('.vela-st-view:not([hidden]) .vela-st-trade-toggle')[1]!;
        second.click();
        const open = current(host, '.vela-st-trade-details')!;
        expect(open.textContent).toContain('Open');
        expect(open.textContent).toContain('Exit price—');
        expect(host.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-details')).toHaveLength(1);
    });

    it('preserves table scroll, expanded details and keyboard focus across live updates', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        (current(host, '.vela-st-trade-toggle') as HTMLButtonElement).click();
        const scroll = current(host, '.vela-st-scroll')!;
        scroll.scrollTop = 120;
        scroll.scrollLeft = 80;
        (current(host, '.vela-st-trade-toggle') as HTMLButtonElement).focus();
        let release: ((trades: readonly StrategyTrade[]) => void) | undefined;
        panel.setRun(chart, fakeRun({ trades: () => new Promise((resolve) => { release = resolve; }) }));
        await flush();
        expect(current(host, '.vela-st-status')?.textContent).toBe('Updating…');
        expect(current(host, '.vela-st-trade-details')).not.toBeNull();
        release!([...TRADES, { ...TRADES[0]!, id: 'third', entry: { ...TRADES[0]!.entry, time: 50 * HR }, exit: { ...TRADES[0]!.exit!, time: 51 * HR } }]);
        await flush();
        const after = current(host, '.vela-st-scroll')!;
        expect(after.scrollTop).toBe(120);
        expect(after.scrollLeft).toBe(80);
        expect(current(host, '.vela-st-trade-details')).not.toBeNull();
        expect(document.activeElement).toBe(current(host, '.vela-st-trade-toggle'));
        expect(host.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row')).toHaveLength(3);
    });

    it('does not replace a pressed trade button until the click is delivered', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        const button = current(host, '.vela-st-trade-toggle') as HTMLButtonElement;
        const pointer = (name: string): Event => {
            const event = new Event(name, { bubbles: true });
            Object.defineProperty(event, 'pointerId', { value: 7 });
            return event;
        };
        button.dispatchEvent(pointer('pointerdown'));
        panel.setRun(chart, fakeRun({ trades: async () => TRADES }));
        await flush();
        expect(current(host, '.vela-st-trade-toggle')).toBe(button);
        button.dispatchEvent(pointer('pointerup'));
        button.click();
        await flush();
        expect(current(host, '.vela-st-trade-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(current(host, '.vela-st-trade-details')).not.toBeNull();
    });

    it('invalidates a chart report on load, drops its old answer and accepts a new market run', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const { chart, market, emit } = eventChart();
        panel.onChart(chart);
        panel.toggle(true);
        let release: ((trades: readonly StrategyTrade[]) => void) | undefined;
        panel.setRun(chart, fakeRun({ title: 'Old strategy', trades: () => new Promise((resolve) => { release = resolve; }) }));
        await flush();
        market.symbol = 'ETHUSDT';
        emit('load:start');
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Loading chart data');
        expect(current(host, '.vela-st-title')).toBeNull();
        release!(TRADES);
        await flush();
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Loading chart data');
        emit('load:end');
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Waiting for strategy');
        panel.setRun(chart, fakeRun({ title: 'New strategy', trades: async () => TRADES }));
        await flush();
        expect(current(host, '.vela-st-title')?.textContent).toBe('New strategy');
        expect(current(host, '.vela-st-scope')?.textContent).toContain('ETHUSDT');
        emit('indicator:removed', { id: 'strat-1' });
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Add a strategy');
    });

    it('does not revive invalidated or removed runs on an inactive chart', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const a = eventChart('AAA');
        const b = eventChart('BBB');
        panel.onChart(a.chart);
        panel.toggle(true);
        panel.setRun(a.chart, fakeRun({ id: 'a', title: 'A' }));
        await flush();
        panel.setRun(b.chart, fakeRun({ id: 'b', title: 'B' }));
        panel.onChart(b.chart);
        await flush();
        expect(current(host, '.vela-st-title')?.textContent).toBe('B');
        panel.invalidateMarket(a.chart);
        panel.onChart(a.chart);
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Add a strategy');
        panel.setRun(a.chart, fakeRun({ id: 'a', title: 'A new' }));
        await flush();
        panel.onChart(b.chart);
        panel.forgetRun(a.chart, 'a');
        panel.onChart(a.chart);
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Add a strategy');
    });


    it('discloses a broker-versus-ledger discrepancy without changing either calculation', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun({ strategy: state({ netPnl: 17.34 }), trades: async () => TRADES }));
        await flush();
        expect(current(host, '.vela-st-stat-value')?.textContent).toBe('+18.00');
        expect(current(host, '.vela-st-status')?.textContent).toContain('Broker net +17.34 ≠ ledger');
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        expect(current(host, '.vela-st-status')?.textContent).toContain('Broker net +17.34 ≠ ledger');
    });

    it('leaves selected report text intact until selection is cleared', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        const cell = current(host, '.vela-st-trade-row td:nth-child(4)')!;
        const range = document.createRange();
        range.selectNodeContents(cell);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        panel.setRun(chart, fakeRun({ trades: async () => [TRADES[0]!] }));
        await flush();
        expect(selection.toString()).toBe('100.50');
        expect(current(host, '.vela-st-trade-row td:nth-child(4)')).toBe(cell);
        selection.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
        await flush();
        expect(host.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row')).toHaveLength(1);
    });

    it('refreshes a previously hidden tab before revealing it during a market load', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const { chart, market, emit } = eventChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        expect(current(host, '.vela-st-trades')).not.toBeNull();
        (host.querySelector('.vela-st-tab[data-tab="overview"]') as HTMLButtonElement).click();
        market.symbol = 'ETHUSDT';
        emit('load:start');
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        expect(current(host, '.vela-st-trades')).toBeNull();
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Loading chart data');
        emit('indicator:removed', { id: 'strat-1' });
        emit('load:end');
        expect(current(host, '.vela-st-empty')?.textContent).toContain('Add a strategy');
    });


    it('virtualizes a large ledger while retaining row counts, disclosures and keyboard access', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        const trades: StrategyTrade[] = Array.from({ length: 1000 }, (_, i) => ({
            id: `trade-${i}`, side: i % 2 ? 'short' : 'long', qty: i + 1,
            entry: { id: 'E', time: i * 2 * HR, price: 100 + i },
            exit: { id: 'X', time: (i * 2 + 1) * HR, price: 101 + i },
            open: false, pnl: i % 2 ? -1 : 1,
        }));
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun({ trades: async () => trades, strategy: state({ netPnl: 0 }) }));
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        const table = current(host, '.vela-st-trades')!;
        const scroll = current(host, '.vela-st-scroll')!;
        expect(table.getAttribute('aria-rowcount')).toBe('1001');
        expect(table.querySelectorAll('.vela-st-trade-row').length).toBeLessThan(40);
        scroll.scrollTop = 500 * 36;
        scroll.dispatchEvent(new Event('scroll'));
        const middle = table.querySelector<HTMLTableRowElement>('.vela-st-trade-row[data-trade-index="500"]')!;
        expect(middle.getAttribute('aria-rowindex')).toBe('502');
        const button = middle.querySelector<HTMLButtonElement>('button')!;
        button.focus();
        button.click();
        expect(table.getAttribute('aria-rowcount')).toBe('1002');
        expect(table.querySelector('.vela-st-trade-details')?.getAttribute('aria-rowindex')).toBe('503');
        expect(middle.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Trade 1000 details');
        expect(table.querySelectorAll('.vela-st-trade-row').length).toBeLessThan(40);
        const last = table.querySelector('.vela-st-trade-row[data-trade-index="999"]')!;
        expect(last.getAttribute('aria-rowindex')).toBe('1002');
    });


    it('restores the trade scroll position after switching tabs', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        const trades: StrategyTrade[] = Array.from({ length: 100 }, (_, i) => ({
            id: `trade-${i}`, side: 'long', qty: 1,
            entry: { id: 'E', time: i * 2 * HR, price: 100 },
            exit: { id: 'X', time: (i * 2 + 1) * HR, price: 101 },
            open: false, pnl: 1,
        }));
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun({ trades: async () => trades }));
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        let scroll = current(host, '.vela-st-scroll')!;
        scroll.scrollTop = 700;
        scroll.scrollLeft = 90;
        scroll.dispatchEvent(new Event('scroll'));
        (host.querySelector('.vela-st-tab[data-tab="performance"]') as HTMLButtonElement).click();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        scroll = current(host, '.vela-st-scroll')!;
        expect([scroll.scrollTop, scroll.scrollLeft]).toEqual([700, 90]);
        expect(current(host, '.vela-st-trade-row[data-trade-index="19"]')).not.toBeNull();
    });


    it('waits for scrolling to settle before replacing a live trade table', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const panel = makePanel(host);
        const chart = fakeChart();
        panel.onChart(chart);
        panel.toggle(true);
        panel.setRun(chart, fakeRun());
        await flush();
        (host.querySelector('.vela-st-tab[data-tab="trades"]') as HTMLButtonElement).click();
        const scroll = current(host, '.vela-st-scroll')!;
        scroll.scrollTop = 24;
        scroll.dispatchEvent(new Event('scroll'));
        panel.setRun(chart, fakeRun({ trades: async () => [TRADES[0]!] }));
        await flush();
        expect(current(host, '.vela-st-scroll')).toBe(scroll);
        expect(host.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row')).toHaveLength(2);
        await new Promise((resolve) => setTimeout(resolve, 230));
        expect(current(host, '.vela-st-scroll')).not.toBe(scroll);
        expect(host.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row')).toHaveLength(1);
        panel.destroy();
    });

});
