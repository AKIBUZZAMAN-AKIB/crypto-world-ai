// @vitest-environment jsdom
// Round 11 — the audit's regressions.
//
// The audit found four things that were wrong, not merely missing:
//   1. The BOOT path restored the grid and nothing else: saved layouts, templates, the
//      watchlist, group names/marks and the tab-link tag were read from disk and then
//      dropped — and the first debounced save wrote the empty maps back over them.
//   2. Each ALL chip in the sync table was its own tab stop, so one table cost eight.
//   3. The tab-link dots had no accessible state (colour and an outline only).
//   4. The layout canvas was sixteen tab stops and focus could not be moved out of the
//      first one by Tab at all.
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { encodeState, type WorkspaceState } from '../src/state/document';
import type { VelaStorage } from '../src/widget/persist';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const BARS: OHLCV[] = Array.from({ length: 90 }, (_, i) => ({
    time: Date.UTC(2024, 0, 2) + i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
}));

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

/** A synchronous in-memory storage — the shape `persist` reads at boot. */
function memoryStorage(seed: Record<string, string> = {}): VelaStorage & { data: Record<string, string> } {
    const data: Record<string, string> = { ...seed };
    return {
        data,
        get: (k) => (k in data ? data[k]! : null),
        set: (k, v) => {
            data[k] = v;
        },
        remove: (k) => {
            delete data[k];
        },
    };
}

function mount(storage: VelaStorage, layout = '4'): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout,
        symbol: 'AAA',
        timeframe: '60',
        bars: 90,
        live: false,
        data: BARS,
        persist: 'audit',
        storage,
    } as never);
    live.push(ws);
    return ws;
}

const SIDE_CARS: Partial<WorkspaceState> = {
    groupNames: { red: 'Scalp' },
    groupMarks: { red: '🦊' },
    watchlist: ['AAA', 'BBB'],
    seenTips: ['group-badge'],
    recentCommands: ['key:chart.toggle-log'],
    linkedGroup: 'red',
    drawingsScope: 'global',
    templates: { Scalp: { version: 1, indicators: [] } } as never,
    savedLayouts: { '4-up': { version: 1, layout: '4', timezone: 'Etc/UTC', charts: [] } },
    layoutMeta: { '4-up': { savedAt: 1 } },
};

describe('the boot path restores the side-cars, not only the grid', () => {
    it('keeps names, glyphs, watchlist, tips, recents, link tag, templates and snapshots', () => {
        const doc = { version: 1, layout: '4', timezone: 'Etc/UTC', charts: [], ...SIDE_CARS } as unknown as WorkspaceState;
        const ws = mount(memoryStorage({ audit: encodeState(doc) }));
        const st = ws.getState();
        expect(st.groupNames).toEqual({ red: 'Scalp' });
        expect(st.groupMarks).toEqual({ red: '🦊' });
        expect(st.watchlist).toEqual(['AAA', 'BBB']);
        expect(st.seenTips).toEqual(['group-badge']);
        expect(st.recentCommands).toEqual(['key:chart.toggle-log']);
        expect(st.linkedGroup).toBe('red');
        expect(st.drawingsScope).toBe('global');
        expect(ws.savedLayoutList().map((l) => l.name)).toEqual(['4-up']);
        expect(ws.templateList().map((t) => t.name)).toEqual(['Scalp']);
        // The glyph the chart wears comes from the same registry, so a reload keeps it.
        expect(ws.groupMark('red')).toBe('🦊');
        expect(ws.hasSeenTip('group-badge')).toBe(true);
    });

    it('a second mount on the same storage does not write the side-cars away', () => {
        const store = memoryStorage();
        const first = mount(store);
        first.setLayout('2h');
        first.setGroupMark('blue', '🐳');
        first.setGroupName('blue', 'Swing');
        first.saveLayout('Mine');
        first.addToWatchlist('CCC');
        live.pop()?.destroy(); // the user closes the tab

        const second = mount(store);
        const st = second.getState();
        expect(st.layout).toBe('2h');
        expect(st.groupMarks).toEqual({ blue: '🐳' });
        expect(st.groupNames).toEqual({ blue: 'Swing' });
        expect(st.watchlist).toContain('CCC');
        expect(second.savedLayoutList().map((l) => l.name)).toEqual(['Mine']);
        // …and the document it writes is still complete.
        const raw = JSON.parse(store.data.audit!);
        expect(raw.groupMarks).toEqual({ blue: '🐳' });
        expect(raw.savedLayouts).toBeTruthy();
    });
});

describe('the sync table is one tab stop', () => {
    it('only the seeded cell is tabbable; the ALL column joins it', () => {
        const ws = mount(memoryStorage());
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click();
        const chips = [...ws.root.querySelectorAll<HTMLButtonElement>('.vela-md-matrix-chip')];
        expect(chips.length).toBeGreaterThan(10);
        expect(chips.filter((c) => c.tabIndex === 0)).toHaveLength(1);
        // The ALL chips are IN the grid, not beside it: roving, never tab stops.
        const all = [...ws.root.querySelectorAll<HTMLButtonElement>('.vela-md-chip-all')];
        expect(all.length).toBeGreaterThan(0);
        expect(all.every((c) => c.tabIndex === -1)).toBe(true);
    });
});

describe('the tab-link picker says what is selected', () => {
    it('is a radiogroup with one checked radio and one tab stop', () => {
        const ws = mount(memoryStorage());
        ws.setLinkGroup('green');
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click();
        const group = ws.root.querySelector<HTMLElement>('.vela-lp-links');
        expect(group?.getAttribute('role')).toBe('radiogroup');
        const dots = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-linkdot')];
        expect(dots).toHaveLength(5);
        expect(dots.map((d) => d.getAttribute('role'))).toEqual(Array(5).fill('radio'));
        expect(dots.filter((d) => d.getAttribute('aria-checked') === 'true')).toHaveLength(1);
        // green is the second tag in the list (unlink, red, green…)
        expect(dots[2]!.getAttribute('aria-checked')).toBe('true');
        expect(dots.filter((d) => d.tabIndex === 0)).toEqual([dots[2]]);
    });
});

describe('the presets are one tab stop', () => {
    it('is a radiogroup with a roving stop, and the arrows walk it', () => {
        const ws = mount(memoryStorage());
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click();
        const group = ws.root.querySelector<HTMLElement>('.vela-lp-presets');
        expect(group?.getAttribute('role')).toBe('radiogroup');
        const presets = [...ws.root.querySelectorAll<HTMLElement>('.vela-lp-preset')];
        expect(presets.length).toBeGreaterThan(4);
        expect(presets.every((p) => p.getAttribute('role') === 'radio')).toBe(true);
        expect(presets.filter((p) => p.tabIndex === 0)).toHaveLength(1);
        // One arrow press moves the stop and the focus together.
        const first = presets.find((p) => p.tabIndex === 0)!;
        first.focus();
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).not.toBe(first);
        expect([...ws.root.querySelectorAll<HTMLElement>('.vela-lp-preset')].filter((p) => p.tabIndex === 0)).toHaveLength(1);
    });
});

describe('the layout canvas is one control', () => {
    it('focuses a control on keyboard open, and Escape gives focus back', () => {
        const ws = mount(memoryStorage());
        const trigger = ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!;
        trigger.focus();
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        // The canvas is the first control; it owns the arrow keys for all 16 squares.
        const grid = ws.root.querySelector<HTMLElement>('.vela-lp-grid');
        expect(grid).not.toBeNull();
        expect(document.activeElement).toBe(grid);
        expect(grid?.getAttribute('role')).toBe('group');
        expect(grid?.tabIndex).toBe(0);
        // …and no square is a tab stop.
        expect([...ws.root.querySelectorAll<HTMLElement>('.vela-lp-sq')].every((s) => s.tabIndex === -1)).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.activeElement).toBe(trigger);
    });

    it('arrows move the cursor, Enter applies that size', () => {
        const ws = mount(memoryStorage());
        ws.root.querySelector<HTMLElement>('button[aria-label^="Layout"]')!.click();
        const grid = ws.root.querySelector<HTMLElement>('.vela-lp-grid')!;
        grid.focus();
        const key = (k: string): void => {
            grid.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        };
        key('ArrowRight');
        key('ArrowRight'); // from 2×2 → 4 columns
        key('ArrowDown'); // → 3 rows
        expect(grid.getAttribute('aria-label')).toContain('4 by 3');
        key('Enter');
        expect(ws.getState().layout).toBe('g3x4');
    });
});
