// @vitest-environment jsdom
// The MOBILE sync surface: the kebab's Sync view is the phone's whole linking UI, so it
// has to be a real switchboard — seven switches that read ON/OFF, a group chip per link,
// and a chart × link matrix that can mark ANY chart (the desktop chip can only mark the
// active one, and a phone has no hover to pick with).
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { MoreDrawer } from '../src/widget/more-drawer';
import { Statusline } from '../src/widget/statusline';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { IMPLICIT_GROUP, markOf, nextGroupMark } from '../src/workspace/sync';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
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

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout: '4',
        symbol: 'AAA',
        timeframe: '60',
        bars: 400,
        live: false,
        data: BARS,
        cells: { btc: { symbol: 'AAA' }, eth: { symbol: 'BBB' }, sol: { symbol: 'CCC' }, bnb: { symbol: 'DDD' } },
        ...opts,
    } as never);
    live.push(ws);
    return ws;
}

/** The pure display twin: an all-cells link reports the implicit group on every chart. */
describe('markOf — the chip/status-line reading of a link', () => {
    it('all-cells ⇒ the implicit group on every chart; a record ⇒ its own group', () => {
        expect(markOf(true, 'btc')).toBe(IMPLICIT_GROUP);
        expect(markOf({ btc: '🔴', eth: 'A' }, 'btc')).toBe('🔴');
        expect(markOf({ btc: '🔴' }, 'eth')).toBeUndefined();
        expect(markOf(false, 'btc')).toBeUndefined();
        expect(markOf(undefined, 'btc')).toBeUndefined();
    });

    it('the implicit group is not a palette mark, so the first chip tap still hands out 🔴', () => {
        expect(nextGroupMark(undefined, [])).toBe('🔴');
        expect(nextGroupMark('🔴', ['🔴'])).toBe('🟢');
    });
});

/** The drawer's Sync view, driven with a stub layout (no workspace needed). */
describe('the kebab drawer’s Sync view', () => {
    type Link = { id: string; label: string; checked: boolean; group?: string; marks?: Record<string, string> };
    const setup = () => {
        const state: Record<string, Link> = {
            symbol: { id: 'symbol', label: 'Symbol', checked: false },
            timeframe: { id: 'timeframe', label: 'Interval', checked: false },
        };
        const marks = (): Record<string, string> => ({ btc: 'A', eth: 'A', sol: 'A', bnb: 'A' });
        const cycles: Array<[string, string]> = [];
        const toggles: string[] = [];
        const host = document.createElement('div');
        document.body.append(host);
        const drawer = new MoreDrawer({
            host,
            canUndo: () => false,
            canRedo: () => false,
            priceStyles: () => [{ id: 'candles', label: 'Candles' }],
            priceStyle: () => 'candles',
            onPriceStyle: () => {},
            panels: () => [],
            onTogglePanel: () => {},
            actions: () => [],
            layout: {
                shape: () => ({ rows: 2, cols: 2 }),
                presets: () => [],
                onSelectGrid: () => {},
                onSelectPreset: () => {},
                syncs: () =>
            Object.values(state).map((s) => ({
                ...s,
                ...(s.checked
                    ? {
                          marks: s.group
                              ? Object.fromEntries(Object.keys(marks()).map((id) => [id, id === 'btc' ? s.group! : 'A']))
                              : marks(),
                      }
                    : {}),
            })),
                onToggleSync: (id) => {
                    toggles.push(id);
                    const s = state[id]!;
                    s.checked = !s.checked;
                },
                onCycleGroup: (id) => {
                    // The model turns the link ON when a chart is given a group (the
                    // all-cells form seeds every chart into 'A' first).
                    const s = state[id]!;
                    s.group = s.group ? undefined : '🔴';
                    s.checked = true;
                },
                charts: () => [
                    { id: 'btc', label: 'BTC', active: true },
                    { id: 'eth', label: 'ETH', active: false },
                    { id: 'sol', label: 'SOL', active: false },
                ],
                onCycleCellGroup: (id, cellId) => cycles.push([id, cellId]),
                drawingsScope: () => 'layout',
                onToggleDrawingsScope: () => {},
                savedLayouts: () => [],
            },
        });
        return { drawer, state, cycles, toggles };
    };

    it('the main list offers a Sync row with an at-a-glance count', () => {
        const { drawer, state } = setup();
        drawer.open();
        const row = [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.startsWith('Sync'))!;
        expect(row.querySelector('.vela-md-row-value')?.textContent).toBe('off');
        state.symbol!.checked = true;
        drawer.close();
        drawer.open();
        expect(
            [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.startsWith('Sync'))!.querySelector('.vela-md-row-value')?.textContent,
        ).toBe('1/2');
        drawer.destroy();
    });

    it('every link is a real switch (role + aria-checked), and a tap flips it IN PLACE', () => {
        const { drawer, state } = setup();
        drawer.open('sync');
        const rows = [...document.querySelectorAll<HTMLElement>('.vela-md-sync[role="switch"]')];
        expect(rows.map((r) => r.querySelector('.vela-md-row-label')?.textContent)).toEqual(['Symbol', 'Interval']);
        const symbol = rows[0]!;
        expect(symbol.getAttribute('role')).toBe('switch');
        expect(symbol.getAttribute('aria-checked')).toBe('false');
        expect(symbol.querySelector('.vela-md-switch')).not.toBeNull();
        symbol.click();
        expect(state.symbol!.checked).toBe(true);
        // The SAME node now reads ON — the view is not rebuilt (a rebuild jumps the list
        // back to the top, which is what made the old rows feel unresponsive).
        expect(document.querySelector('.vela-md-sync')!.getAttribute('aria-checked')).toBe('true');
        expect(document.querySelector('.vela-md-sync')).toBe(symbol);
        drawer.destroy();
    });

    it('the chip cycles the active chart and never flips the switch', () => {
        const { drawer, state, toggles } = setup();
        drawer.open('sync');
        const row = document.querySelector<HTMLElement>('.vela-md-sync')!;
        const chip = row.querySelector<HTMLElement>('.vela-md-chip')!;
        expect(chip.textContent).toBe('–');
        chip.click();
        expect(toggles).toEqual([]); // no accidental toggle
        expect(state.symbol!.group).toBe('🔴');
        expect(row.querySelector('.vela-md-chip')?.textContent).toBe('🔴');
        drawer.destroy();
    });

    it('the matrix marks ANY chart per link, a chip per chart', () => {
        const { drawer, cycles } = setup();
        drawer.open('sync');
        const heads = [...document.querySelectorAll('.vela-md-matrix-head')].map((h) => h.textContent);
        expect(heads).toEqual(['BTC', 'ETH', 'SOL']);
        const chips = document.querySelectorAll('.vela-md-matrix .vela-md-chip');
        expect(chips.length).toBe(2 * 3); // one row per link, one chip per chart
        (chips[5] as HTMLElement).click(); // Interval × SOL (row 2, last column)
        expect(cycles).toEqual([['timeframe', 'sol']]);
        drawer.destroy();
    });
});

/** Through the real workspace: the sheet reads and drives the live links. */
describe('the workspace’s Sync sheet', () => {
    const openSheet = (ws: VelaWorkspace): void => {
        ws.openSyncDrawer();
    };

    it('lists the seven links, with the all-cells form showing the implicit group', () => {
        const ws = mount();
        ws.sync.set('symbol', true, false);
        openSheet(ws);
        const rows = [...ws.root.querySelectorAll<HTMLElement>('.vela-md-sync')];
        expect(rows.map((r) => r.querySelector('.vela-md-row-label')?.textContent)).toEqual([
            'Date range',
            'Time',
            'Symbol',
            'Interval',
            'Crosshair',
            'Drawings',
            'Style',
            'Drawing scope',
        ]);
        const symbol = rows[2]!;
        expect(symbol.getAttribute('aria-checked')).toBe('true');
        expect(symbol.querySelector('.vela-md-chip')?.textContent).toBe(IMPLICIT_GROUP);
        expect(rows[0]!.getAttribute('aria-checked')).toBe('false');
    });

    it('a matrix tap puts THAT chart in its own group and re-marks the charts', () => {
        const ws = mount();
        ws.sync.set('symbol', true, false);
        openSheet(ws);
        const chip = ws.root.querySelector<HTMLElement>('.vela-md-matrix .vela-md-chip[data-kind="symbol"][data-cell="eth"]')!;
        chip.click();
        expect(ws.sync.groupOf('symbol', 'eth')).toBe('🔴');
        expect(ws.sync.groupOf('symbol', 'btc')).toBe('A');
        // Every chart that follows the link WEARS the mark now — including the ones left
        // in the implicit group (they read 'A', the group's name).
        expect(ws.cell('eth')!.host.querySelector('.vela-sl-marks')?.textContent).toBe('🔴');
        expect(ws.cell('btc')!.host.querySelector('.vela-sl-marks')?.textContent).toBe('A');
        expect(chip.textContent).toBe('🔴');
    });

    it('off → on restores the grouping instead of collapsing it to all-cells', () => {
        const ws = mount();
        ws.sync.set('symbol', { btc: '🔴', eth: '🟢' }, false);
        openSheet(ws);
        const symbol = (): HTMLElement => [...ws.root.querySelectorAll<HTMLElement>('.vela-md-sync')][2]!;
        symbol().click(); // off
        expect(ws.sync.state().symbol).toBeUndefined();
        expect(symbol().getAttribute('aria-checked')).toBe('false');
        symbol().click(); // on again
        expect(ws.sync.state().symbol).toEqual({ btc: '🔴', eth: '🟢' });
        expect(symbol().querySelector('.vela-md-chip')?.textContent).toBe('🔴');
    });
});

/** The status line's badge is the sheet's door. */
describe('the status line’s marks chip', () => {
    it('is a button that reports its groups and runs the workspace’s action', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const line = new Statusline(host, 'BINANCE:BTCUSDT');
        let taps = 0;
        const marks = line.el.querySelector<HTMLElement>('.vela-sl-marks')!;
        expect(marks.hidden).toBe(true);
        line.setSyncMarks([
            { kind: 'Symbol', mark: '🔴' },
            { kind: 'Interval', mark: '🔴' },
        ]);
        // One glyph per DISTINCT group — two links in the same group wear one mark.
        expect(marks.textContent).toBe('🔴');
        expect(marks.hidden).toBe(false);
        line.setMarksHandler(() => {
            taps += 1;
        });
        marks.click();
        expect(taps).toBe(1);
        line.setMarksHandler(null);
        marks.click();
        expect(taps).toBe(1); // inert without a handler
    });
});
