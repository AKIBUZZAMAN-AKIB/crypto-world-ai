// @vitest-environment jsdom
// The multi-chart UX work: the layout dropdown tells the TRUTH (every link, grouped
// links included), groups are reachable from the UI, the grid has TradingView's two
// keyboard chords, drawings respect the symbol, new charts inherit indicators, the
// timezone is per chart, and named layouts / tab links / replay scope exist.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { SplitterLayer } from '../src/workspace/splitters';
import { bodyItems } from '../src/widget/context-menu-model';
import { SYNC_GROUP_MARKS, alignedRangeAround, groupSetting, syncEnabled, syncGroups } from '../src/workspace/sync';
import { resizeAllTracks, resizeTracks } from '../src/workspace/splitters';
import { layoutDefinition, layouts, occupancyGrid } from '../src/workspace/layouts';
import { decodeState, encodeState } from '../src/state/document';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS: OHLCV[] = Array.from({ length: 400 }, (_, i) => ({
    time: T0 + i * HOUR,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
}));

/** Let the market switch (and its event) land. */
const settle = async (ws: VelaWorkspace): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 5));
    void ws;
};

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mountWorkspace(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', symbol: 'AAA', timeframe: '60', bars: 400, live: false, data: BARS, ...opts } as never);
    live.push(ws);
    return ws;
}

const PAGE = {
    layout: '4',
    cells: {
        btc: { symbol: 'BTCUSDT', timeframe: '60', data: BARS },
        eth: { symbol: 'ETHUSDT', timeframe: '15', data: BARS },
        sol: { symbol: 'SOLUSDT', timeframe: '240', data: BARS },
        bnb: { symbol: 'BNBUSDT', timeframe: 'D', data: BARS },
    },
} as const;

const openPicker = (ws: VelaWorkspace): void => {
    ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click();
};
const syncRow = (ws: VelaWorkspace, label: string): HTMLElement | null =>
    [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-sync-row')].find((r) => r.textContent?.startsWith(label)) ?? null;

describe('the layout dropdown exposes every link and reads grouped links as ON', () => {
    it('lists all seven links, in TradingView order', () => {
        const ws = mountWorkspace(PAGE);
        openPicker(ws);
        const rows = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-sync-row')].map((r) => r.querySelector('.vela-lp-label')?.textContent);
        expect(rows).toEqual(['Date range', 'Time', 'Symbol', 'Interval', 'Crosshair', 'Drawings', 'Style']);
    });

    it('a group record renders its switch ON (the old picker compared with === true)', () => {
        const ws = mountWorkspace(PAGE);
        ws.sync.set('symbol', { btc: 'A', eth: 'A', sol: 'B', bnb: 'B' }, false);
        openPicker(ws);
        expect(syncRow(ws, 'Symbol')!.getAttribute('aria-checked')).toBe('true');
        expect(syncRow(ws, 'Interval')!.getAttribute('aria-checked')).toBe('false');
    });

    it('clicking a switch off a grouped link turns the link off — one visible flip, not a silent no-op', () => {
        const ws = mountWorkspace(PAGE);
        ws.sync.set('symbol', { btc: 'A', eth: 'A' }, false);
        openPicker(ws);
        syncRow(ws, 'Symbol')!.click();
        expect(ws.sync.state().symbol).toBeUndefined();
        expect(syncRow(ws, 'Symbol')!.getAttribute('aria-checked')).toBe('false');
    });

    it('the table cycles a chart through all ten groups, then unlinks it — TV\'s uncheck', () => {
        const ws = mountWorkspace(PAGE);
        ws.sync.set('symbol', true, false); // all-cells form
        openPicker(ws);
        const chip = (): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-md-chip[data-kind="symbol"][data-cell="btc"]')!;
        // The all-cells form is the IMPLICIT group — every chart follows, so the cell
        // names it ('A', dashed). It used to read '–' while the switch said ON, which is
        // the "switch on, nothing marked" reading this suite exists to prevent.
        expect(chip().textContent).toBe('A');
        expect(chip().dataset.implicit).toBe('1');
        chip().click();
        expect(ws.sync.groupOf('symbol', 'btc')).toBe('🔴');
        expect(chip().textContent).toBe('🔴');
        // …and the chart's OWN status line wears the same emoji (TV's placement).
        expect(ws.cell('btc')!.host.querySelector('.vela-sl-marks')?.textContent).toBe('🔴');
        // The palette is ten marks deep: the cell walks it in order, and the last tap
        // unlinks the chart — TV's "uncheck the emoji to leave the group".
        for (let i = 1; i < 10; i += 1) {
            chip().click();
            expect(ws.sync.groupOf('symbol', 'btc')).toBe(SYNC_GROUP_MARKS[i]);
        }
        chip().click();
        expect(ws.sync.groupOf('symbol', 'btc')).toBeUndefined();
        // Unlinked, but the badge STAYS on a multi-chart grid: it is the door into
        // marking (TradingView keeps the chart-syncing entry in the status line too), so
        // it reads as the empty ring instead of disappearing.
        const badge = ws.cell('btc')!.host.querySelector<HTMLElement>('.vela-sl-marks')!;
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBe('◌');
        expect(badge.hasAttribute('data-empty')).toBe(true);
    });

    it('the desktop popover has the SAME table — any chart is marked without activating it', async () => {
        const ws = mountWorkspace(PAGE);
        ws.sync.set('symbol', true, false); // all-cells form
        openPicker(ws);
        const table = ws.root.querySelector<HTMLElement>('.vela-lp-charts')!;
        expect(table.hidden).toBe(false);
        // Slot numbers, never tickers: the chart called 'btc' may be showing XRPUSDT.
        const heads = [...table.querySelectorAll<HTMLElement>('.vela-md-matrix-head[data-cell]')];
        expect(heads.map((h) => h.textContent)).toEqual(['1', '2', '3', '4']);
        expect(heads[1]!.title).toContain('Chart 2');
        expect(heads[1]!.title).toContain('ETHUSDT');
        // The ticker in that tooltip is LIVE — a chart can switch market under the table.
        ws.cell('eth')!.setSymbol('XRPUSDT');
        await settle(ws);
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click(); // close
        openPicker(ws); // reopen: the table re-reads every chart
        expect(ws.root.querySelector<HTMLElement>('.vela-lp-charts .vela-md-matrix-head[data-cell="eth"]')!.title).toContain('XRPUSDT');
        // One cell per chart, for the Symbol link — no strip, no row chip: one surface.
        const cell = (id: string): HTMLElement => table.querySelector<HTMLElement>(`.vela-md-chip[data-kind="symbol"][data-cell="${id}"]`)!;
        expect(ws.root.querySelector('.vela-lp-target')).toBeNull();
        expect(ws.root.querySelector('.vela-lp-group')).toBeNull();
        expect(cell('eth').textContent).toBe('A');
        // Mark ETH without ever making it active.
        cell('eth').click();
        expect(ws.sync.groupOf('symbol', 'eth')).toBe('🔴');
        expect(ws.sync.groupOf('symbol', 'btc')).toBe('A'); // the active chart untouched
        expect(ws.active.id).toBe('btc');
        expect(ws.cell('eth')!.host.querySelector('.vela-sl-marks')?.textContent).toBe('🔴');
        expect(cell('eth').textContent).toBe('🔴');
        expect(cell('btc').textContent).toBe('A');
        // The ALL cell drops every chart back into one group in one click.
        table.querySelector<HTMLElement>('.vela-md-chip-all[data-kind="symbol"]')!.click();
        expect(ws.sync.state().symbol).toBe(true);
        expect(cell('eth').textContent).toBe('A');
    });

    it('opening the table numbers the charts — column 3 IS the chart wearing 3', () => {
        const ws = mountWorkspace(PAGE);
        const nos = (): Array<string | null> =>
            [...ws.root.querySelectorAll<HTMLElement>('.vela-sl-symbol')].map((el) => el.getAttribute('data-chart-no'));
        expect(nos()).toEqual(['1', '2', '3', '4']);
        // …but a number is only shown while the surface that uses it is up.
        expect(ws.root.hasAttribute('data-sync-open')).toBe(false);
        openPicker(ws);
        expect(ws.root.getAttribute('data-sync-open')).toBe('1');
        // After a layout change the numbers follow the NEW slots, not the old ids.
        ws.setLayout('8');
        expect(nos()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click(); // close
        expect(ws.root.hasAttribute('data-sync-open')).toBe(false);
    });

    it('a cell offers the WHOLE palette on right-click — one pick, not seven taps', () => {
        const ws = mountWorkspace(PAGE);
        openPicker(ws);
        const cell = ws.root.querySelector<HTMLElement>('.vela-lp-charts .vela-md-chip[data-kind="symbol"][data-cell="eth"]')!;
        cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
        // The list portals to the floating layer (the document body here), so it is
        // found from the document, not from the mount.
        const palette = document.querySelector<HTMLElement>('.vela-menu-item[data-vei-id^="mark:"]')?.closest('.vela-menu');
        expect(palette).not.toBeNull();
        const rows = [...palette!.querySelectorAll<HTMLElement>('.vela-menu-item')];
        expect(rows.map((r) => r.textContent?.trim().split(' ').slice(0, 2).join(' '))).toEqual([
            'Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5',
            'Group 6', 'Group 7', 'Group 8', 'Group 9', 'Group 10',
            'No group',
        ]);
        // The rows carry the whole palette, in order, with the emoji alongside the
        // number (a font-less device still reads "Group 8").
        expect(rows[7]!.textContent).toContain('⚫');
        expect(rows[10]!.textContent).toContain('No group');
        // The pick itself goes through the workspace's direct setter. (Zag menus select
        // on real pointer events, which jsdom does not synthesise — the click path is
        // covered by the browser probe, `test/browser/sync-doors.mjs`.)
        ws.setGroupFor('symbol', 'eth', SYNC_GROUP_MARKS[7]!);
        expect(ws.sync.groupOf('symbol', 'eth')).toBe(SYNC_GROUP_MARKS[7]);
        expect(ws.sync.groupOf('symbol', 'btc')).toBe('A'); // everyone else untouched
        // One call, one group — no cycle: group 8 lands in a single step.
        ws.setGroupFor('symbol', 'sol', null);
        expect(ws.sync.groupOf('symbol', 'sol')).toBeUndefined();
    });

    it('the table is ONE tab stop and the arrow keys walk it', () => {
        const ws = mountWorkspace(PAGE);
        openPicker(ws);
        const chips = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-charts .vela-md-chip[data-cell]')];
        // Exactly one cell is reachable with Tab; the rest are reached by arrow keys.
        expect(chips.filter((c) => c.tabIndex === 0)).toHaveLength(1);
        const wrap = ws.root.querySelector<HTMLElement>('.vela-lp-charts .vela-md-matrixwrap')!;
        expect(wrap.getAttribute('role')).toBe('grid');
        expect(chips[0]!.tabIndex).toBe(0);
        const press = (k: string): void => {
            (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        };
        const focused = (): string => {
            const el = document.activeElement as HTMLElement;
            return `${el.dataset.kind}/${el.dataset.cell}`;
        };
        // Column order comes from the workspace (slot order), not from the test.
        const cols = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-charts .vela-md-chip[data-kind="viewport"][data-cell]')].map((c) => c.dataset.cell);
        expect(cols).toHaveLength(4);
        ws.root.querySelector<HTMLElement>(`.vela-lp-charts .vela-md-chip[data-kind="viewport"][data-cell="${cols[0]}"]`)!.focus();
        // Right moves along the row; Down moves down the column (the row order is the
        // workspace's: Date range, Time, Symbol, …).
        press('ArrowRight');
        press('ArrowRight');
        expect(focused()).toBe(`viewport/${cols[2]}`);
        press('ArrowDown');
        press('ArrowDown');
        expect(focused()).toBe(`symbol/${cols[2]}`);
        expect(ws.root.querySelector<HTMLElement>(`.vela-lp-charts .vela-md-chip[data-kind="symbol"][data-cell="${cols[2]}"]`)!.tabIndex).toBe(0);
        // Home/End jump to the row's ends.
        press('Home');
        expect(focused()).toBe(`symbol/${cols[0]}`);
        press('End');
        expect(focused()).toBe(`symbol/${cols[3]}`);
    });


    it('the drawable scope chip flips the drawing scope in place', () => {
        const ws = mountWorkspace(PAGE);
        openPicker(ws);
        const chip = (): HTMLElement => syncRow(ws, 'Drawings')!.querySelector<HTMLElement>('.vela-lp-scope')!;
        expect(chip().textContent).toBe('layout');
        chip().click(); // the row is re-rendered, so re-query
        expect(chip().textContent).toBe('global');
        expect(ws.getState().drawingsScope).toBe('global');
    });
});

describe("the grid keyboard (TradingView's two chords)", () => {
    const press = (ws: VelaWorkspace, init: KeyboardEventInit): boolean => ws.keymap.handleKeydown(new KeyboardEvent('keydown', init));

    it('Tab walks the active chart and wraps', () => {
        const ws = mountWorkspace(PAGE);
        expect(ws.active.id).toBe('btc');
        press(ws, { key: 'Tab' });
        expect(ws.active.id).toBe('eth');
        press(ws, { key: 'Tab' });
        press(ws, { key: 'Tab' });
        expect(ws.active.id).toBe('bnb');
        press(ws, { key: 'Tab' });
        expect(ws.active.id).toBe('btc'); // wrapped
    });

    it('Alt+Enter maximizes the active chart, and again restores the grid', () => {
        const ws = mountWorkspace(PAGE);
        press(ws, { key: 'Enter', altKey: true });
        expect(ws.maximizedCell).toBe('btc');
        expect(ws.root.querySelector('.vela-ws-grid')!.getAttribute('data-maximized')).toBe('1');
        press(ws, { key: 'Enter', altKey: true });
        expect(ws.maximizedCell).toBeNull();
    });

    it('both chords are inert on a single-chart grid', () => {
        const ws = mountWorkspace({ layout: '1', data: BARS });
        press(ws, { key: 'Tab' });
        press(ws, { key: 'Enter', altKey: true });
        expect(ws.active.id).toBe('c1');
        expect(ws.maximizedCell).toBeNull();
    });
});

describe('the time link (click-to-align)', () => {
    it('re-centers followers on the clicked instant WITHOUT changing their span', async () => {
        // jsdom never paints, so `getVisibleRange` is null without a stub: the follower's
        // window is faked and the workspace's own call is what gets checked.
        const ws = mountWorkspace({ ...PAGE, sync: { time: true } });
        const eth = ws.cell('eth')!.chart;
        vi.spyOn(eth, 'getVisibleRange').mockReturnValue({ from: T0 + 100 * HOUR, to: T0 + 180 * HOUR });
        const write = vi.spyOn(eth, 'setVisibleRange').mockImplementation((() => eth) as never);
        await settle(ws);

        ws.alignTimeAt('btc', T0 + 200 * HOUR);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0]![0]).toEqual({ from: T0 + 200 * HOUR - 40 * HOUR, to: T0 + 200 * HOUR + 40 * HOUR });
    });

    it('the pure helper keeps the span exactly', () => {
        expect(alignedRangeAround({ from: 0, to: 100 }, 500)).toEqual({ from: 450, to: 550 });
        expect(alignedRangeAround({ from: 10, to: 10 }, 500)).toBeNull();
    });

    it('the link is off on a cell that never joined it', async () => {
        const ws = mountWorkspace({ ...PAGE, sync: { time: { btc: 'A', eth: 'A', sol: 'B' } } });
        const bnb = ws.cell('bnb')!.chart;
        const write = vi.spyOn(bnb, 'setVisibleRange').mockImplementation((() => bnb) as never);
        await settle(ws);
        ws.alignTimeAt('btc', T0 + 300 * HOUR);
        expect(write).not.toHaveBeenCalled();
    });

});

describe('drawings belong to a symbol', () => {
    const ANCHORS = [
        { time: T0 + 10 * HOUR, price: 100 },
        { time: T0 + 40 * HOUR, price: 120 },
    ];

    it('the link never paints across symbols (TradingView’s rule)', () => {
        const ws = mountWorkspace({ ...PAGE, sync: { drawings: true } });
        ws.cell('btc')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        expect(ws.cell('eth')!.chart.drawings.all()).toHaveLength(0);
        expect(ws.cell('sol')!.chart.drawings.all()).toHaveLength(0);
    });

    it('same-symbol charts DO follow, and the copies stay linked', () => {
        const ws = mountWorkspace({
            layout: '2h',
            cells: { a: { symbol: 'AAA' }, b: { symbol: 'AAA' } },
            data: BARS,
            sync: { drawings: true },
        });
        const a = ws.cell('a')!.chart.drawings;
        const original = a.add('trendline', { anchors: ANCHORS })!;
        const b = ws.cell('b')!.chart.drawings;
        expect(b.all()).toHaveLength(1);
        a.update(original.id, { anchors: [ANCHORS[0]!, { time: T0 + 50 * HOUR, price: 130 }] });
        expect(b.all()[0]!.anchors[1]!.price).toBe(130);
    });

    it('a widening option lets a host cross symbols deliberately', () => {
        const ws = mountWorkspace({ ...PAGE, drawingsSameSymbol: false, sync: { drawings: true } });
        ws.cell('btc')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        expect(ws.cell('eth')!.chart.drawings.all()).toHaveLength(1);
    });

    it('the GLOBAL scope parks drawings under the old symbol and restores them on return', async () => {
        // A switch has to go through the feed, so the provider resolves either ticker.
        const provider = {
            getBars: () => Promise.resolve(BARS),
            listSymbols: () => Promise.resolve([{ ticker: 'AAA' }, { ticker: 'BBB' }]),
        };
        const ws = mountWorkspace({
            layout: '1',
            cells: { a: { symbol: 'AAA', data: BARS } },
            drawingsScope: 'global',
            providers: { fake: () => provider },
        });
        const cell = ws.cell('a')!;
        cell.chart.drawings.add('trendline', { anchors: ANCHORS });
        await settle(ws);

        ws.setDrawingsScope('global'); // seed the store from the live chart
        expect(ws.getState().drawingsBySymbol?.AAA).toBeDefined();

        cell.setSymbol('BBB');
        await settle(ws);
        expect(cell.chart.drawings.all()).toHaveLength(0); // BBB has none yet

        cell.chart.drawings.add('hline', { anchors: [{ time: ANCHORS[0]!.time, price: 105 }] });
        await settle(ws);
        cell.setSymbol('AAA');
        await settle(ws);
        // AAA's trend line is back, BBB's line stayed with BBB.
        expect(cell.chart.drawings.all().map((d) => d.type)).toEqual(['trendline']);
        expect(Object.keys((ws.getState().drawingsBySymbol ?? {}) as object)).toContain('BBB');
    });
});

describe("new charts inherit the leader's indicators", () => {
    it('a chart added by a bigger layout arrives with the first chart’s set', () => {
        const ws = mountWorkspace({ layout: '1', symbol: 'AAA', timeframe: '60', data: BARS });
        ws.cell('c1')!.chart.addNativeIndicator('volume');
        expect(ws.cell('c1')!.chart.indicators()).toHaveLength(1);

        ws.setLayout('2h');
        const c2 = ws.cell('c2')!;
        expect(c2.chart.indicators().map((h) => h.nativeType)).toEqual(['volume']);
    });

    it('`inheritIndicators: false` keeps the old behavior', () => {
        const ws = mountWorkspace({ layout: '1', symbol: 'AAA', timeframe: '60', data: BARS, inheritIndicators: false });
        ws.cell('c1')!.chart.addNativeIndicator('volume');
        ws.setLayout('2h');
        expect(ws.cell('c2')!.chart.indicators()).toHaveLength(0);
    });
});

describe('per-chart timezone', () => {
    it('one chart can leave the workspace default alone', () => {
        const ws = mountWorkspace(PAGE);
        ws.setTimezone('Etc/UTC');
        ws.setCellTimezone('btc', 'America/New_York');
        expect(ws.cell('btc')!.displayTimezone).toBe('America/New_York');
        expect(ws.cell('eth')!.displayTimezone).toBe('Etc/UTC');
        // The document keeps both, per cell.
        const state = ws.getState();
        expect(state.charts.find((c) => c.id === 'btc')!.timezone).toBe('America/New_York');
        expect(state.charts.find((c) => c.id === 'eth')!.timezone).toBeUndefined();
    });

    it('a workspace-wide change leaves the overridden chart where it was', () => {
        const ws = mountWorkspace(PAGE);
        ws.setCellTimezone('sol', 'Asia/Tokyo');
        ws.setTimezone('America/Chicago');
        expect(ws.cell('sol')!.displayTimezone).toBe('Asia/Tokyo');
        expect(ws.cell('btc')!.displayTimezone).toBe('America/Chicago');
    });

    it('clearing the override falls back to the default again', () => {
        const ws = mountWorkspace(PAGE);
        ws.setCellTimezone('btc', 'Asia/Tokyo');
        ws.setCellTimezone('btc', null);
        expect(ws.cell('btc')!.displayTimezone).toBe(ws.getState().timezone);
    });
});

describe('named layouts', () => {
    it('save → change → open restores the snapshot', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Mine');
        expect(ws.getState().savedLayouts).toHaveProperty('Mine');

        ws.setLayout('1');
        ws.cell('btc')!.setSymbol('XRPUSDT');
        expect(ws.getState().layout).toBe('1');

        ws.openLayout('Mine');
        const state = ws.getState();
        expect(state.layout).toBe('4');
        expect(state.charts.find((c) => c.id === 'btc')!.symbol).toBe('BTCUSDT');
    });

    it('delete removes it from the document', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Temp');
        ws.deleteLayout('Temp');
        expect(ws.getState().savedLayouts).toBeUndefined();
    });

    it('a snapshot never embeds the snapshot set (no recursion)', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('One');
        ws.saveLayout('Two');
        const doc = ws.getState().savedLayouts as Record<string, { savedLayouts?: unknown }>;
        expect(doc.One?.savedLayouts).toBeUndefined();
        expect(doc.Two?.savedLayouts).toBeUndefined();
    });

    it('the picker footer lists them and opens on a name click', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Alpha');
        ws.setLayout('1');
        openPicker(ws);
        const row = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-saved')].find((r) => r.textContent?.includes('Alpha'))!;
        row.querySelector<HTMLElement>('.vela-lp-name')!.click();
        expect(ws.getState().layout).toBe('4');
    });

    it('rename keeps the row order and refuses a name another snapshot owns', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('One');
        ws.saveLayout('Two');
        ws.saveLayout('Three');

        expect(ws.renameLayout('Two', 'Deux')).toBe(true);
        expect(Object.keys(ws.getState().savedLayouts!)).toEqual(['One', 'Deux', 'Three']);

        // Taken / blank / unchanged are refused, and nothing is overwritten.
        expect(ws.renameLayout('Deux', 'Three')).toBe(false);
        expect(ws.renameLayout('Deux', '   ')).toBe(false);
        expect(ws.renameLayout('Deux', 'Deux')).toBe(false);
        expect(Object.keys(ws.getState().savedLayouts!)).toEqual(['One', 'Deux', 'Three']);
    });

    it('the active flag follows a rename', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Live');
        expect(ws.savedLayoutList()).toEqual([{ name: 'Live', active: true }]);
        ws.renameLayout('Live', 'Renamed');
        expect(ws.savedLayoutList()).toEqual([{ name: 'Renamed', active: true }]);
    });

    it('export → import round-trips the snapshot, suffixing a colliding name', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Scalp');
        const json = ws.exportLayout('Scalp')!;
        expect(JSON.parse(json)).toMatchObject({ app: 'vela', kind: 'layout', version: 1, name: 'Scalp' });

        // Same workspace: the name is taken, so the import lands beside it.
        expect(ws.importLayout(json)).toBe('Scalp (2)');
        expect(Object.keys(ws.getState().savedLayouts!)).toEqual(['Scalp', 'Scalp (2)']);

        // A different workspace gets the name back verbatim and the snapshot works.
        const other = mountWorkspace({ layout: '1', symbol: 'AAA', timeframe: '60', bars: 400, live: false, data: BARS });
        other.openLayout('nope'); // no-op, not a throw
        expect(other.importLayout(json)).toBe('Scalp');
        other.setLayout('1');
        other.openLayout('Scalp');
        expect(other.getState().layout).toBe('4');
        expect(other.getState().charts.find((c) => c.id === 'btc')!.symbol).toBe('BTCUSDT');
    });

    it('import refuses garbage and a snapshot cannot smuggle in the whole set', () => {
        const ws = mountWorkspace(PAGE);
        expect(ws.importLayout('not json')).toBeNull();
        expect(ws.importLayout('{"hello":1}')).toBeNull();
        expect(ws.getState().savedLayouts).toBeUndefined();

        ws.saveLayout('A');
        ws.saveLayout('B');
        const nested = JSON.stringify({ app: 'vela', kind: 'layout', name: 'C', state: ws.getState() });
        expect(ws.importLayout(nested)).toBe('C');
        const doc = ws.getState().savedLayouts as Record<string, { savedLayouts?: unknown }>;
        expect(doc.C?.savedLayouts).toBeUndefined(); // stripped on the way in
    });

    it('the picker footer offers rename, export and import', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Alpha');
        openPicker(ws);
        const row = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-saved')].find((r) => r.dataset.layout === 'Alpha')!;
        const labels = [...row.querySelectorAll<HTMLElement>('button')].map((b) => b.getAttribute('aria-label'));
        expect(labels).toEqual(['Rename Alpha', 'Export Alpha as JSON', 'Delete Alpha']);
        expect(ws.root.querySelector('.vela-lp-import')?.textContent).toBe('Import layout file…');
    });

    it('an inline rename commits on Enter and cancels on Escape', () => {
        const ws = mountWorkspace(PAGE);
        ws.saveLayout('Alpha');
        openPicker(ws);
        const row = (): HTMLElement => [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-saved')].find((r) => r.dataset.layout !== undefined && r.querySelector('.vela-lp-name, .vela-lp-rename') !== null)!;
        row().querySelector<HTMLElement>('button[aria-label="Rename Alpha"]')!.click();
        const input = ws.root.querySelector<HTMLInputElement>('.vela-lp-rename')!;
        expect(input.value).toBe('Alpha');
        input.value = 'Beta';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(ws.savedLayoutList().map((l) => l.name)).toEqual(['Beta']);

        row().querySelector<HTMLElement>('button[aria-label="Rename Beta"]')!.click();
        const again = ws.root.querySelector<HTMLInputElement>('.vela-lp-rename')!;
        again.value = 'Nope';
        again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(ws.savedLayoutList().map((l) => l.name)).toEqual(['Beta']);
    });
});

/** A workspace fed by a provider that resolves any ticker (a switch must go through it). */
function mountLive(cellId: string, symbol: string): VelaWorkspace {
    const provider = {
        getBars: () => Promise.resolve(BARS),
        listSymbols: () => Promise.resolve(['AAA', 'BBB', 'CCC', 'DDD'].map((ticker) => ({ ticker }))),
    };
    return mountWorkspace({ layout: '1', cells: { [cellId]: { symbol } }, providers: { fake: () => provider }, live: false, bars: 400 });
}

describe('tab linking', () => {
    it('two workspaces on one tag mirror their active market', async () => {
        const a = mountLive('a', 'AAA');
        const b = mountLive('b', 'BBB');
        await settle(a);
        await settle(b);
        a.setLinkGroup('red');
        b.setLinkGroup('red');
        a.cell('a')!.setSymbol('CCC');
        await settle(a);
        await settle(b);
        expect(a.cell('a')!.symbol).toBe('CCC');
        expect(b.cell('b')!.symbol).toBe('CCC');
    });

    it('an unlinked workspace is untouched', async () => {
        const a = mountLive('a', 'AAA');
        const b = mountLive('b', 'BBB');
        await settle(a);
        await settle(b);
        a.setLinkGroup('red');
        a.cell('a')!.setSymbol('CCC');
        await settle(a);
        await settle(b);
        expect(b.cell('b')!.symbol).toBe('BBB');
    });

    it('the tag round-trips through the document', () => {
        const ws = mountWorkspace(PAGE);
        ws.setLinkGroup('blue');
        expect(ws.getState().linkedGroup).toBe('blue');
        expect(decodeState(encodeState(ws.getState()))!.linkedGroup).toBe('blue');
    });
});

describe('replay scope', () => {
    it('a `cell` scope rewinds only the reference chart', async () => {
        const ws = mountWorkspace(PAGE);
        await settle(ws);
        await ws.replay.start({ from: T0 + 200 * HOUR, cell: 'btc', scope: 'cell' });
        expect(ws.cell('btc')!.chart.replay.state.active).toBe(true);
        expect(ws.cell('eth')!.chart.replay.state.active).toBe(false);
        ws.replay.stop();
    });

    it('the default scope still rewinds the whole grid', async () => {
        const ws = mountWorkspace(PAGE);
        await settle(ws);
        await ws.replay.start({ from: T0 + 200 * HOUR, cell: 'btc' });
        expect(ws.cell('btc')!.chart.replay.state.active).toBe(true);
        expect(ws.cell('eth')!.chart.replay.state.active).toBe(true);
        ws.replay.stop();
    });
});

describe('asymmetric layouts', () => {
    it('register the TradingView family and expose their shapes', () => {
        for (const [id, cells] of [
            ['1-2', 3],
            ['2-1', 3],
            ['1-3', 4],
            ['3-1', 4],
            ['2-3', 5],
            ['3-2', 5],
            ['4s', 4],
            ['4s-r', 4],
            ['4s-l', 4],
        ] as const) {
            const def = layoutDefinition(id);
            expect(def, id).toBeDefined();
            expect(def!.cells, id).toHaveLength(cells);
            expect(def!.areas, id).toBeDefined();
        }
    });

    it("the remaining TradingView ids are registered too: 6c's big centre and 8h's row", () => {
        expect(layoutDefinition('6c')!.cells).toHaveLength(6);
        const grid = occupancyGrid(layoutDefinition('6c')!);
        // The centre tile owns the middle 2×2 …
        expect(grid[1]![1]).toBe('a');
        expect(grid[1]![2]).toBe('a');
        expect(grid[2]![1]).toBe('a');
        // … and the six satellites each own their own tile.
        const names = new Set(grid.flat());
        expect(names.size).toBe(6);
        expect(grid[0]![1]).toBe('c'); // the wide top tile (2 columns)

        // The 16-chart ceiling: our pool holds 16 dormant charts, and the canvas is 4x4.
        expect(layoutDefinition('16')!.cells).toHaveLength(16);
        expect(occupancyGrid(layoutDefinition('16')!)).toHaveLength(4);
        expect(occupancyGrid(layoutDefinition('16')!)[0]).toHaveLength(4);
        expect(layoutDefinition('8h')!.cells).toHaveLength(8);
        expect(occupancyGrid(layoutDefinition('8h')!)[0]).toHaveLength(8); // one row of 8
    });

    it('every registered layout is a well-formed grid of named tiles (TV’s whole family)', () => {
        // The family is now large, so the invariants get a blanket check: rectangular
        // rows, one tile per cell, no cell without a tile (a ragged `areas` block would
        // silently drop a chart).
        const problems: string[] = [];
        for (const l of layouts()) {
            const def = layoutDefinition(l.id)!;
            const grid = occupancyGrid(def);
            const cols = Math.max(...grid.map((r) => r.length));
            const rowLens = new Set(grid.map((r) => r.length));
            const tiles = new Set(grid.flat().filter(Boolean));
            if (rowLens.size > 1) problems.push(`${l.id}: ragged rows ${[...rowLens]}`);
            if (def.areas && def.areas.length !== grid.length) problems.push(`${l.id}: ${def.areas.length} area rows vs ${grid.length} grid rows`);
            if (def.areas && def.areas.some((r) => r.trim().split(/\s+/).length !== cols)) problems.push(`${l.id}: an area row is not ${cols} wide`);
            if (tiles.size !== def.cells.length) problems.push(`${l.id}: ${tiles.size} tiles for ${def.cells.length} cells`);
            if (def.cells.some((c) => !c.area && def.areas)) problems.push(`${l.id}: an area layout cell without an area`);
            if (def.cols.length !== cols) problems.push(`${l.id}: cols ${def.cols.length} vs grid ${cols}`);
        }
        expect(problems).toEqual([]);
        // TradingView's `MultipleChartsLayoutType` names all resolve here.
        const tv = '2h 2v 3h 3v 3s 3r 2-1 1-2 4 4v 4h 4s 4s-l 1-3 3-1 2-2-l 2-2-r 2-2 1-4 5h 5v 5s 5s-l 2-3 3-2 4-1 2-3-l 2-3-r 6 6h 6v 6c 2-4 4-2 4-3 7h 7s 8 8c 8h 8v'.split(' ');
        const have = new Set(layouts().map((l) => l.id));
        expect(tv.filter((id) => !have.has(id))).toEqual([]);
    });

    it('occupancyGrid names the tiles the splitters will segment against', () => {
        const grid = occupancyGrid(layoutDefinition('4s')!);
        expect(grid).toEqual([
            ['a', 'b'],
            ['a', 'c'],
            ['a', 'd'],
        ]);
    });

    it('a workspace can switch to one and build its cells with grid areas', () => {
        const ws = mountWorkspace({ layout: '1', symbol: 'AAA', timeframe: '60', data: BARS });
        ws.setLayout('4s');
        expect(ws.cells()).toHaveLength(4);
        expect(ws.cell('c1')!.host.style.gridArea).toBe('a');
        expect(ws.cell('c2')!.host.style.gridArea).toBe('b');
    });
});

describe('splitter math', () => {
    it('Shift+drag slides every boundary: the outer tracks trade weight, the inner keep their size', () => {
        const out = resizeAllTracks([1, 1, 1], 100, 300);
        expect(out[0]!).toBeGreaterThan(1);
        expect(out[2]!).toBeLessThan(1);
        expect(out[1]).toBe(1); // untouched middle
        expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 6); // total preserved
    });

    it('the clamp never pushes an outer track under the 10% floor', () => {
        const out = resizeAllTracks([1, 1], 10_000, 100);
        expect(out[1]!).toBeCloseTo(0.2, 6);
        expect(out[0]!).toBeCloseTo(1.8, 6);
    });

    it('one-boundary resize is unchanged by the new helper', () => {
        expect(resizeTracks([1, 1, 1], 1, 100, 300)).toEqual(resizeTracks([1, 1, 1], 1, 100, 300));
    });
});

describe('sync helpers', () => {
    it('syncEnabled treats both forms of on as on', () => {
        expect(syncEnabled(undefined)).toBe(false);
        expect(syncEnabled(true)).toBe(true);
        expect(syncEnabled({})).toBe(false);
        expect(syncEnabled({ a: 'A' })).toBe(true);
    });

    it('groupSetting upgrades an all-cells link without unlinking anyone', () => {
        expect(groupSetting(true, 'b', 'B', ['a', 'b', 'c'])).toEqual({ a: 'A', b: 'B', c: 'A' });
        expect(groupSetting({ a: 'A', b: 'A' }, 'a', null)).toEqual({ b: 'A' });
        expect(groupSetting({ a: 'A' }, 'a', null)).toBeUndefined();
    });

    it('syncGroups lists distinct groups in first-seen order', () => {
        expect(syncGroups({ a: 'B', b: 'A', c: 'B' })).toEqual(['B', 'A']);
    });
});

describe('"apply to all" (TradingView’s layout-wide entries)', () => {
    it('the generic settings row exists only on a multi-chart grid', () => {
        expect(bodyItems({ drawings: 0, indicators: 0, multi: true }).map((i) => i.id)).toContain('apply-settings-all');
        expect(bodyItems({ drawings: 0, indicators: 0 }).map((i) => i.id)).not.toContain('apply-settings-all');
    });

    it('`applySettingsToAll` mirrors the style slice onto every other chart', () => {
        const ws = mountWorkspace(PAGE);
        ws.cell('btc')!.chart.renderer.applyConfig({ candles: { upColor: '#123456' }, margins: { top: 20 } });
        ws.applySettingsToAll('btc');
        for (const id of ['eth', 'sol', 'bnb']) {
            const cfg = ws.cell(id)!.chart.renderer.getConfig() as { candles: { upColor: string }; margins: { top: number } };
            expect(cfg.candles.upColor).toBe('#123456');
            expect(cfg.margins.top).toBe(20);
        }
        // …and the chart type stays per cell, exactly like the style link.
        expect(ws.cell('eth')!.chart.renderer.getConfig()).toMatchObject({ series: { style: 'candles' } });
    });

    it('`applyIndicatorsToAll` replaces each chart’s set with the source’s', () => {
        const ws = mountWorkspace(PAGE);
        ws.cell('btc')!.chart.addNativeIndicator('volume');
        ws.applyIndicatorsToAll('btc');
        for (const id of ['eth', 'sol', 'bnb']) {
            expect(ws.cell(id)!.chart.indicators().map((h) => h.nativeType)).toEqual(['volume']);
        }
    });
});

describe('the follower side of the crosshair link', () => {
    it('a follower’s status line reads the leader’s instant, then lets go', async () => {
        const ws = mountWorkspace(PAGE);
        const cell = ws.cell('eth')!;
        await settle(ws);
        cell.setSyncedCrosshair(BARS[120]!);
        const values = (): string => cell.host.querySelector('.vela-sl-ohlc')?.textContent ?? '';
        expect(values()).toContain(String(Math.round(BARS[120]!.close * 2) / 2) === '0' ? '' : values());
        expect(values()).not.toBe('');
        const shown = values();
        cell.setSyncedCrosshair(null);
        expect(values()).not.toBe(shown); // back to the resting (last) bar
    });
});

describe('splitters', () => {
    /** A 2-column grid whose seams are laid out against a fake 300px width. */
    function layer(): { el: HTMLElement; applied: Array<{ axis: string; weights: number[] }> } {
        const el = document.createElement('div');
        document.body.append(el);
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const applied: Array<{ axis: string; weights: number[] }> = [];
        const l = new SplitterLayer(el, {
            tracks: () => ({ cols: [1, 1, 1], rows: [1] }),
            grid: () => [['a', 'b', 'c']],
            apply: (axis, weights) => applied.push({ axis, weights }),
            reset: () => {},
            gapPx: () => 0,
        });
        l.layout();
        (el as HTMLElement & { layer?: SplitterLayer }).layer = l;
        return { el, applied };
    }
    const drag = (el: HTMLElement, init: { shiftKey?: boolean; toX: number }): void => {
        const strip = el.querySelector<HTMLElement>('.vela-ws-splitter')!;
        const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, shiftKey: init.shiftKey ?? false });
        strip.dispatchEvent(down as unknown as PointerEvent);
        strip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: init.toX }) as unknown as PointerEvent);
        strip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }) as unknown as PointerEvent);
    };

    it('a plain drag trades weight between the two tracks around ONE boundary', () => {
        const { el, applied } = layer();
        drag(el, { toX: 130 });
        expect(applied).toHaveLength(1);
        expect(applied[0]!.weights[0]).toBeGreaterThan(1);
        expect(applied[0]!.weights[1]).toBeLessThan(1);
        expect(applied[0]!.weights[2]).toBe(1); // the far track never moved
    });

    it('Shift+drag slides EVERY boundary: the far track moves too', () => {
        const { el, applied } = layer();
        drag(el, { toX: 130, shiftKey: true });
        expect(applied).toHaveLength(1);
        expect(applied[0]!.weights[0]).toBeGreaterThan(1);
        expect(applied[0]!.weights[2]).toBeLessThan(1);
        expect(applied[0]!.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 6);
    });

    it('double-click evens the axis out', () => {
        const el = document.createElement('div');
        document.body.append(el);
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const resets: string[] = [];
        const l = new SplitterLayer(el, {
            tracks: () => ({ cols: [2, 1], rows: [1] }),
            grid: () => [['a', 'b']],
            apply: () => {},
            reset: (axis) => resets.push(axis),
            gapPx: () => 0,
        });
        l.layout();
        el.querySelectorAll('.vela-ws-splitter').forEach((s) => s.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect(resets).toEqual(['cols']);
    });
});

describe('hidden charts (the pool)', () => {
    it('shrinking the layout pools the surplus charts, and the footer row drops them', () => {
        const ws = mountWorkspace(PAGE);
        ws.setLayout('1');
        expect(ws.hiddenChartCount).toBe(3);
        openPicker(ws);
        const row = (): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-lp-pool:not(.vela-lp-undo)')!;
        expect(row().textContent).toBe('Remove 3 hidden charts');
        row().click(); // arms, does not destroy
        expect(row().textContent).toBe('Remove 3 hidden charts — click to confirm');
        row().click();
        expect(ws.hiddenChartCount).toBe(0);
        expect(ws.root.querySelector('.vela-lp-pool:not(.vela-lp-undo)')).toBeNull();
    });

    it('removing hidden charts takes two clicks and can be undone', () => {
        const ws = mountWorkspace(PAGE);
        ws.setLayout('1');
        expect(ws.hiddenChartCount).toBe(3);
        openPicker(ws);
        const row = (): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-lp-pool:not(.vela-lp-undo)')!;

        row().click(); // arm
        expect(ws.hiddenChartCount).toBe(3);
        expect(row().dataset.armed).toBe('1');
        row().click(); // commit
        expect(ws.hiddenChartCount).toBe(0);
        expect(ws.clearedChartCount).toBe(3);

        const undo = ws.root.querySelector<HTMLElement>('.vela-lp-undo')!;
        expect(undo.textContent).toContain('bring back 3');
        undo.click();
        expect(ws.hiddenChartCount).toBe(3);
        expect(ws.clearedChartCount).toBe(0);

        // The restored state is REAL: growing back brings the old charts, not defaults.
        ws.setLayout('4');
        expect(ws.cell('eth')?.symbol).toBe('ETHUSDT');
    });

    it('an armed removal disarms when the row is rebuilt', () => {
        const ws = mountWorkspace(PAGE);
        ws.setLayout('1');
        openPicker(ws);
        ws.root.querySelector<HTMLElement>('.vela-lp-pool:not(.vela-lp-undo)')!.click();
        expect(ws.root.querySelector<HTMLElement>('.vela-lp-pool:not(.vela-lp-undo)')!.dataset.armed).toBe('1');
        ws.setLayout('4'); // the picker's footer re-reads live state
        expect(ws.hiddenChartCount).toBe(0);
        expect(ws.root.querySelector<HTMLElement>('.vela-lp-pool:not(.vela-lp-undo)')).toBeNull();
    });

    it('growing back before removal still restores the pooled charts', () => {
        const ws = mountWorkspace(PAGE);
        ws.setLayout('1');
        ws.setLayout('4');
        expect(ws.hiddenChartCount).toBe(0);
        expect(ws.getState().charts.map((c) => c.id)).toEqual(['btc', 'eth', 'sol', 'bnb']);
    });
});
