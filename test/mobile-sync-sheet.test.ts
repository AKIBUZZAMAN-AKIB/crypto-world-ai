// @vitest-environment jsdom
// The MOBILE layout surface: one sheet, two REAL tabs (Layout | Sync). The Sync tab is
// the phone's whole linking UI — the link x chart TABLE first (ten distinct marks, so ten
// charts can each wear their own), then the seven switches that decide what follows. The
// table scrolls sideways INSIDE itself; the sheet never does.
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
import { IMPLICIT_GROUP, SYNC_GROUP_MARKS, markOf, nextGroupMark } from '../src/workspace/sync';
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
        expect(nextGroupMark(undefined, [])).toBe('red'); // stable id, not the glyph
        expect(nextGroupMark('🔴', ['🔴'])).toBe('orange'); // legacy mark in, id out
    });

    it('the palette holds SIXTEEN distinct marks — one per chart of the biggest layout', () => {
        expect(SYNC_GROUP_MARKS.length).toBe(16);
        expect(new Set(SYNC_GROUP_MARKS).size).toBe(16);
        expect((SYNC_GROUP_MARKS as readonly string[]).includes(IMPLICIT_GROUP)).toBe(false);
        // What a SURFACE offers is a slice of that list — see group-marks-scale.test.ts:
        // a 2-chart grid offers two, a 4×4 sixteen.
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
        const all: string[] = [];
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
                    { id: 'btc', label: '1', symbol: 'AAA', active: true },
                    { id: 'eth', label: '2', symbol: 'BBB', active: false },
                    { id: 'sol', label: '3', symbol: 'CCC', active: false },
                ],
                onCycleCellGroup: (id, cellId) => cycles.push([id, cellId]),
                onAllInOneGroup: (id) => all.push(id),
                drawingsScope: () => 'layout',
                onToggleDrawingsScope: () => {},
                savedLayouts: () => [],
            },
        });
        return { drawer, state, cycles, all, toggles };
    };

    it('the main list has ONE layout entry — sync is a tab inside it, not a second row', () => {
        const { drawer } = setup();
        drawer.open();
        const labels = [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((r) => r.textContent);
        expect(labels).toContain('Layout');
        expect(labels).not.toContain('Sync');
        (document.querySelectorAll<HTMLElement>('.vela-md-row')[labels.indexOf('Layout')] as HTMLElement).click();
        const tabs = [...document.querySelectorAll<HTMLElement>('.vela-md-navbtn')];
        expect(tabs.map((t) => t.textContent)).toEqual(['Layout', 'Sync']);
        drawer.destroy();
    });

    it('the two tabs swap panes — one sheet, never both at once', () => {
        const { drawer } = setup();
        drawer.open('layout');
        const secs = [...document.querySelectorAll<HTMLElement>('.vela-md-sec')];
        expect(secs.length).toBe(2);
        // Layout is the landing tab.
        expect(secs[0]!.hidden).toBe(false);
        expect(secs[1]!.hidden).toBe(true);
        const [layoutTab, syncTab] = [...document.querySelectorAll<HTMLElement>('.vela-md-navbtn')];
        expect(layoutTab!.getAttribute('aria-selected')).toBe('true');
        syncTab!.click();
        expect(secs[0]!.hidden).toBe(true);
        expect(secs[1]!.hidden).toBe(false);
        expect(syncTab!.getAttribute('aria-selected')).toBe('true');
        expect(syncTab!.hasAttribute('data-active')).toBe(true);
        layoutTab!.click();
        expect(secs[0]!.hidden).toBe(false);
        expect(secs[1]!.hidden).toBe(true);
        drawer.destroy();
    });

    it('focus: sync lands on the Sync tab', () => {
        const { drawer } = setup();
        drawer.open('layout', { focus: 'sync' });
        const secs = [...document.querySelectorAll<HTMLElement>('.vela-md-sec')];
        expect(secs[0]!.hidden).toBe(true);
        expect(secs[1]!.hidden).toBe(false);
        drawer.destroy();
    });

    it('every link is a real switch (role + aria-checked), and a tap flips it IN PLACE', () => {
        const { drawer, state } = setup();
        drawer.open('layout');
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

    it('the switch is ONLY a switch — the per-chart chips live in the matrix', () => {
        const { drawer } = setup();
        drawer.open('layout', { focus: 'sync' });
        const rows = [...document.querySelectorAll<HTMLElement>('.vela-md-sync[role="switch"]')];
        expect(rows.length).toBe(2);
        expect(rows.every((r) => r.querySelector('.vela-md-chip') === null)).toBe(true);
        // One column per chart, plus the link column and the ALL column.
        expect([...document.querySelectorAll('.vela-md-matrix-head[data-cell]')].map((h) => h.textContent)).toEqual(['1', '2', '3']);
        drawer.destroy();
    });

    it('the matrix is link x chart: every chart gets a chip on every link, in its own scroller', () => {
        const { drawer, cycles } = setup();
        drawer.open('layout', { focus: 'sync' });
        const wrap = document.querySelector<HTMLElement>('.vela-md-matrixwrap')!;
        // The sideways scroll belongs to the TABLE, never to the sheet.
        expect(wrap.contains(document.querySelector('.vela-md-matrix'))).toBe(true);
        expect(document.querySelectorAll('.vela-md-matrix-label').length).toBe(2);
        // 2 links x 3 charts, plus one ALL chip per link.
        expect(document.querySelectorAll('.vela-md-matrix-chip[data-cell]').length).toBe(6);
        expect(document.querySelectorAll('.vela-md-matrix-chip[data-all]').length).toBe(2);
        const chip = document.querySelector<HTMLElement>('.vela-md-chip[data-kind="timeframe"][data-cell="sol"]')!;
        chip.click();
        expect(cycles).toEqual([['timeframe', 'sol']]);
        drawer.destroy();
    });

    it('a chart column header wears the distinct groups that chart sits in', () => {
        const { drawer, state } = setup();
        state.symbol!.group = 'A';
        state.symbol!.checked = true;
        drawer.open('layout', { focus: 'sync' });
        const btc = document.querySelector<HTMLElement>('.vela-md-matrix-head[data-cell="btc"]')!;
        expect(btc.dataset.marks).toBe('A');
        expect(btc.hasAttribute('data-linked')).toBe(true);
        // Every chart that follows the link wears its mark — the all-cells form is 'A'
        // for everyone, so a chart is never left looking unlinked while it actually follows.
        const sol = document.querySelector<HTMLElement>('.vela-md-matrix-head[data-cell="sol"]')!;
        expect(sol.dataset.marks).toBe('A');
        // …and a header PAINTS that fact as a colour dot: an emoji glyph is not
        // guaranteed to exist on the device, a dot always does.
        const dot = sol.querySelector<HTMLElement>('.vela-md-matrix-dots i');
        expect(dot).not.toBeNull();
        expect(dot!.style.background).not.toBe('');
        drawer.close();
        // With no link on, the columns stay bare — an empty column is information too.
        state.symbol!.checked = false;
        drawer.open('layout', { focus: 'sync' });
        expect(document.querySelectorAll('.vela-md-matrix-head[data-marks]').length).toBe(0);
        drawer.destroy();
    });

    it('tapping a chart header makes that chart active (picking without touching the grid)', () => {
        const picked: string[] = [];
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
                shape: () => ({ rows: 1, cols: 4 }),
                presets: () => [],
                onSelectGrid: () => {},
                onSelectPreset: () => {},
                syncs: () => [{ id: 'symbol', label: 'Symbol', checked: true, marks: { btc: 'A', eth: 'A', sol: 'A', bnb: 'A' } }],
                charts: () => [
                    // Slot numbers, like the workspace hands over: never tickers.
                    { id: 'btc', label: '1', symbol: 'AAA', active: true },
                    { id: 'eth', label: '2', symbol: 'BBB', active: false },
                    { id: 'sol', label: '3', symbol: 'CCC', active: false },
                    { id: 'bnb', label: '4', symbol: 'DDD', active: false },
                ],
                onCycleCellGroup: () => {},
                onSelectChart: (id) => picked.push(id),
            },
        });
        drawer.open('layout', { focus: 'sync' });
        document.querySelector<HTMLElement>('.vela-md-matrix-head[data-cell="eth"]')!.click();
        expect(picked).toEqual(['eth']);
        drawer.destroy();
    });

    it('saved layouts get Open + Delete buttons and the Save-as field', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const opened: string[] = [];
        const deleted: string[] = [];
        const saved: string[] = [];
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
                savedLayouts: () => [{ name: 'Scalp', active: true }, { name: 'Swing', active: false }],
                onOpenLayout: (n) => opened.push(n),
                onDeleteLayout: (n) => deleted.push(n),
                onSaveLayout: (n) => saved.push(n),
            },
        });
        // The library lives on the FIRST screen now (TradingView puts its layout verbs
        // up front too) — the Layout pane is the grid and its links, nothing else.
        drawer.open('main');
        const rows = [...document.querySelectorAll<HTMLElement>('.vela-md-saved')];
        expect(rows.map((r) => r.querySelector('.vela-md-row-label')?.textContent)).toEqual(['Scalp', 'Swing']);
        (rows[1]!.querySelector('.vela-md-saved-open') as HTMLElement).click();
        expect(opened).toEqual(['Swing']);
        (rows[0]!.querySelector('.vela-md-saved-del') as HTMLElement).click();
        expect(deleted).toEqual(['Scalp']);
        const input = document.querySelector<HTMLInputElement>('.vela-md-saveas input')!;
        input.value = 'Breakout';
        (document.querySelector('.vela-md-saveas button') as HTMLElement).click();
        expect(saved).toEqual(['Breakout']);
        // The Layout tab must not repeat the library — two homes for one list is how a
        // "move it to main" turns into "it is in both places and they disagree".
        drawer.open('layout');
        expect(document.querySelectorAll('.vela-md-saved')).toHaveLength(0);
        drawer.destroy();
    });

    it('the first screen carries the whole library: autosave, the open strip, the star', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const house: Array<string | null> = [];
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
                shape: () => ({ rows: 1, cols: 2 }),
                presets: () => [],
                onSelectGrid: () => {},
                onSelectPreset: () => {},
                savedLayouts: () => [
                    { name: 'A', active: true, dirty: true, charts: 2, indicators: 3 },
                    { name: 'B', active: false, charts: 2, indicators: 3 },
                    { name: 'C', active: false, charts: 2, indicators: 2 },
                    { name: 'D', active: false, charts: 1, indicators: 0 },
                ],
                activeLayout: () => 'A',
                onSaveChanges: () => {},
                autosave: () => false,
                onToggleAutosave: () => {},
                templates: () => [{ name: 'Trend', count: 1 }],
                onSaveTemplate: () => true,
                onSetDefaultTemplate: (n) => house.push(n),
                defaultTemplate: () => null,
            },
        });
        drawer.open('main');
        // The open layout, its drift and its one-tap write.
        expect(document.querySelector('.vela-md-open')?.textContent).toBe('Aunsaved changesSave');
        expect(document.querySelector('.vela-md-switchrow')?.getAttribute('aria-checked')).toBe('false');
        // Three rows, then an honest expander — not a truncated list with no way on.
        expect(document.querySelectorAll('.vela-md-saved')).toHaveLength(3);
        const more = document.querySelector<HTMLElement>('.vela-md-showall')!;
        expect(more.textContent).toContain('Show all 4 layouts');
        more.click();
        expect(document.querySelectorAll('.vela-md-saved')).toHaveLength(4);
        // The house template is a star on this screen too.
        const star = document.querySelector<HTMLElement>('.vela-md-tplstar')!;
        expect(star.getAttribute('aria-pressed')).toBe('false');
        star.click();
        expect(house).toEqual(['Trend']);
        drawer.destroy();
    });

    it('the ALL column puts every chart in one group, per link', () => {
        const { drawer, all } = setup();
        drawer.open('layout', { focus: 'sync' });
        const chips = [...document.querySelectorAll<HTMLElement>('.vela-md-matrix-chip[data-all]')];
        expect(chips.length).toBe(2);
        chips[0]!.click();
        expect(all).toEqual(['symbol']);
        drawer.destroy();
    });

});

/** Through the real workspace: the sheet reads and drives the live links. */
describe('the workspace’s Sync sheet', () => {
    const openSheet = (ws: VelaWorkspace): void => {
        ws.openSyncDrawer();
        // The sheet opens on the Sync tab (the status line's door); pin it for every
        // query below, because a plain `openMoreDrawer('layout')` lands on Layout.
        expect(ws.root.querySelector<HTMLElement>('.vela-md-sec:last-of-type')!.hidden).toBe(false);
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
        // The all-cells form reads as the implicit 'A' on every chart's chip.
        expect(ws.root.querySelector<HTMLElement>('.vela-md-chip[data-kind="symbol"][data-cell="btc"]')?.textContent).toBe(IMPLICIT_GROUP);
        expect(rows[0]!.getAttribute('aria-checked')).toBe('false');
    });

    it('a per-chart tap on an OFF link links the grid first, then pulls that chart out', () => {
        const ws = mount();
        expect(ws.sync.state().symbol).toBeUndefined();
        ws.openSyncDrawer();
        ws.root.querySelector<HTMLElement>('.vela-md-chip[data-kind="symbol"][data-cell="sol"]')!.click();
        // Not a half-link: everyone follows, and SOL steps out into its own group.
        expect(ws.sync.state().symbol).toEqual({ btc: 'A', eth: 'A', sol: 'red', bnb: 'A' });
    });

    it('a per-chart tap puts THAT chart in its own group and re-marks the charts', () => {
        const ws = mount();
        ws.sync.set('symbol', true, false);
        openSheet(ws);
        const chip = ws.root.querySelector<HTMLElement>('.vela-md-chip[data-kind="symbol"][data-cell="eth"]')!;
        chip.click();
        expect(ws.sync.groupOf('symbol', 'eth')).toBe('red');
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
        expect(ws.sync.state().symbol).toEqual({ btc: 'red', eth: 'green' });
        expect(ws.root.querySelector<HTMLElement>('.vela-md-chip[data-kind="symbol"][data-cell="btc"]')?.textContent).toBe('🔴');
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
