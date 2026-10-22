// @vitest-environment jsdom
// The layout MANAGER — the four TradingView settings this build was missing, each one
// tested at the seam where it can silently lie:
//
//   1. Autosave       — the open layout follows the chart, debounced, and stops dead
//                       when it is switched off (no orphan timer writes a later edit).
//   2. The dirty dot  — "saved" must mean saved: any edit sets it, either save clears it,
//                       and opening a different snapshot starts clean.
//   3. Make a copy    — "Name copy", then "Name copy 2"; the copy is an archive action
//                       (it does not yank the workspace into the duplicate).
//   4. Default template — new charts open with it, the pointer follows a rename, dies
//                       with a delete, and round-trips through the persisted document.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace, layoutFingerprint } from '../src/workspace/VelaWorkspace';
import { sanitizeState } from '../src/state/document';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS: OHLCV[] = Array.from({ length: 240 }, (_, i) => ({
    time: T0 + i * HOUR,
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
    vi.useRealTimers();
});

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '4', symbol: 'AAA', timeframe: '60', bars: 240, live: false, data: BARS, ...opts } as never);
    live.push(ws);
    return ws;
}

/** A REAL edit: one more chart in the grid, which the snapshot does not have. */
function edit(ws: VelaWorkspace): void {
    ws.setLayout(ws.getState().charts.length >= 5 ? '2-4' : '2-3');
}

/** The workspace's own housekeeping — it marks the document, but changes nothing. */
function housekeeping(ws: VelaWorkspace): void {
    (ws as unknown as { markStateDirty: () => void }).markStateDirty();
}

const TEMPLATE = JSON.stringify({
    app: 'vela',
    kind: 'template',
    version: 1,
    name: 'Trend',
    template: { version: 1, indicators: [{ type: 'moving-average', inputs: {} }, { type: 'volume', inputs: {} }] },
});

/** Every native type a chart's persisted state lists. */
function nativeTypes(ws: VelaWorkspace, cellId: string): string[] {
    const chart = ws.getState().charts.find((c) => c.id === cellId);
    return (chart?.indicators?.natives ?? []).map((e) => (typeof e === 'string' ? e : String((e as { type?: string }).type)));
}

describe('autosave', () => {
    it('follows the open layout after a short pause, silently', () => {
        vi.useFakeTimers();
        const ws = mount();
        // Before the first save: turning it on has nothing to write yet.
        ws.setAutosave(true);
        ws.saveLayout('Desk');
        const saved = vi.fn();
        ws.on('layout:saved', saved);
        const before = ws.layoutSavedAt('Desk');

        edit(ws);
        expect(ws.isActiveLayoutDirty()).toBe(true); // the write is pending, not done

        vi.advanceTimersByTime(1200);
        expect(ws.isActiveLayoutDirty()).toBe(false);
        expect(saved).toHaveBeenCalledTimes(1);
        // Autosave never toasts — the picker's own state is the feedback.
        expect(saved.mock.calls[0]?.[0]).toMatchObject({ name: 'Desk', silent: true });
        expect(ws.layoutSavedAt('Desk')).toBeGreaterThanOrEqual(before ?? 0);
        // …and having written, it does NOT schedule another write behind itself.
        vi.advanceTimersByTime(5000);
        expect(saved).toHaveBeenCalledTimes(1);
    });

    it('stops writing the moment it is switched off', () => {
        vi.useFakeTimers();
        const ws = mount();
        ws.saveLayout('Desk');
        ws.setAutosave(true);
        edit(ws);
        ws.setAutosave(false);
        vi.advanceTimersByTime(5000);
        // Off means off: the edit is still unsaved, and no timer wrote behind the user.
        expect(ws.isActiveLayoutDirty()).toBe(true);
    });

    it('does nothing at all with no layout open', () => {
        vi.useFakeTimers();
        const ws = mount();
        ws.setAutosave(true);
        edit(ws);
        vi.advanceTimersByTime(5000);
        // Nothing to write to — and, crucially, no snapshot invented under a guessed name.
        expect(ws.savedLayoutList()).toHaveLength(0);
    });
});

describe('the unsaved dot', () => {
    it('marks the OPEN layout as soon as the document changes, and clears on save', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        ws.saveLayout('Night');
        expect(ws.savedLayoutList().every((l) => !l.dirty)).toBe(true);

        ws.openLayout('Desk');
        expect(ws.isActiveLayoutDirty()).toBe(false);
        edit(ws);
        expect(ws.isActiveLayoutDirty()).toBe(true);
        expect(ws.savedLayoutList().find((l) => l.active)).toMatchObject({ name: 'Desk', dirty: true });
        // The inactive one is never flagged: it has not changed, it is not open.
        expect(ws.savedLayoutList().find((l) => l.name === 'Night')?.dirty).toBe(false);

        ws.saveLayout('Desk');
        expect(ws.isActiveLayoutDirty()).toBe(false);
    });

    it('is NOT raised by the workspace\'s own housekeeping', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        // Measured in the browser: right after an open, a market reload marks the
        // document twice while the document is byte-identical to its snapshot. The dot
        // must stay off — a counter is a reason to look, not the answer.
        housekeeping(ws);
        housekeeping(ws);
        expect(ws.isActiveLayoutDirty()).toBe(false);
    });

    it('starts clean after opening a different snapshot', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        ws.saveLayout('Night');
        edit(ws);
        expect(ws.isActiveLayoutDirty()).toBe(true);
        ws.openLayout('Desk');
        expect(ws.isActiveLayoutDirty()).toBe(false);
    });

    it('lets Ctrl/⌘+S write the open layout in place', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        edit(ws);
        // The keymap listens on the workspace root; mod maps to Ctrl off macOS.
        ws.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
        expect(ws.isActiveLayoutDirty()).toBe(false);
        expect(ws.savedLayoutList()).toHaveLength(1); // overwrote, never created a second one
    });

    it('says so instead of inventing a name when nothing is open', () => {
        const ws = mount();
        edit(ws);
        ws.root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
        expect(ws.savedLayoutList()).toHaveLength(0);
    });
});

describe('the fingerprint the dot compares', () => {
    it('ignores the manager\'s bookkeeping and one-time tip acknowledgements', () => {
        const ws = mount();
        const base = JSON.parse(JSON.stringify(ws.getState()));
        const same = {
            ...base,
            savedLayouts: { Desk: { version: 1 } },
            layoutPrefs: { autosave: true },
            layoutMeta: { Desk: { savedAt: 1, thumb: 'data:image/jpeg;base64,AA' } },
            seenTips: ['group-badge'],
        };
        expect(layoutFingerprint(same)).toBe(layoutFingerprint(base));
        // …but a real document change is still a change.
        expect(layoutFingerprint({ ...base, activeCellId: 'other' })).not.toBe(layoutFingerprint(base));
    });
});

describe('make a copy', () => {
    it('names copies "copy", "copy 2", and leaves the workspace where it was', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        expect(ws.duplicateLayout('Desk')).toBe('Desk copy');
        expect(ws.duplicateLayout('Desk')).toBe('Desk copy 2');
        expect(ws.savedLayoutList().map((l) => l.name).sort()).toEqual(['Desk', 'Desk copy', 'Desk copy 2']);
        // A duplicate is an archive action — the open layout is still the original.
        expect(ws.savedLayoutList().find((l) => l.active)?.name).toBe('Desk');
    });

    it('copies the snapshot, not a reference to it', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        const was = ws.savedLayoutList().find((l) => l.name === 'Desk')?.charts ?? 0;
        expect(was).toBeGreaterThan(0);
        ws.duplicateLayout('Desk');
        ws.setLayout('2-3'); // one more chart…
        ws.saveLayout('Desk'); // …saved into the ORIGINAL only
        const byName = new Map(ws.savedLayoutList().map((l) => [l.name, l]));
        expect(byName.get('Desk')?.charts).toBe(was + 1);
        expect(byName.get('Desk copy')?.charts).toBe(was);
    });

    it('returns null for a name that is not there', () => {
        const ws = mount();
        expect(ws.duplicateLayout('Ghost')).toBeNull();
    });
});

describe('default template', () => {
    it('decides what a new chart opens with, and outranks sibling inheritance', () => {
        const ws = mount({ inheritIndicators: true });
        // Sibling inheritance would give the new chart the FIRST chart's ledger; the
        // house template is the user's explicit instruction, so it wins.
        expect(ws.importTemplate(TEMPLATE)).toBe('Trend');
        ws.setDefaultTemplate('Trend');
        expect(ws.defaultTemplate()).toBe('Trend');

        const before = new Set(ws.cells().map((c) => c.id));
        ws.setLayout('2-3'); // grows the grid: one chart is genuinely new
        const newcomers = ws.cells().map((c) => c.id).filter((id) => !before.has(id));
        expect(newcomers).toHaveLength(1);
        expect(nativeTypes(ws, newcomers[0]!)).toContain('moving-average');
    });

    it('follows a rename and dies with the template', () => {
        const ws = mount();
        ws.importTemplate(TEMPLATE);
        ws.setDefaultTemplate('Trend');
        expect(ws.renameTemplate('Trend', 'Momentum')).toBe(true);
        expect(ws.defaultTemplate()).toBe('Momentum');
        ws.deleteTemplate('Momentum');
        // Never leave a pointer at a template that no longer exists.
        expect(ws.defaultTemplate()).toBeNull();
    });

    it('refuses a name no template owns', () => {
        const ws = mount();
        ws.setDefaultTemplate('Nope');
        expect(ws.defaultTemplate()).toBeNull();
    });

    it('survives the persisted document, with autosave, and drops what is off', () => {
        const ws = mount();
        ws.importTemplate(TEMPLATE);
        ws.setDefaultTemplate('Trend');
        ws.setAutosave(true);

        const state = sanitizeState(JSON.parse(JSON.stringify(ws.getState())));
        expect(state?.layoutPrefs).toEqual({ autosave: true, defaultTemplate: 'Trend' });

        const second = mount({ initial: undefined });
        second.applyState(state);
        expect(second.autosaveEnabled()).toBe(true);
        expect(second.defaultTemplate()).toBe('Trend');
    });

    it('is not copied into a saved snapshot', () => {
        const ws = mount();
        ws.importTemplate(TEMPLATE);
        ws.setDefaultTemplate('Trend');
        ws.saveLayout('Desk');
        // A snapshot carries the chart, not the manager's own preferences.
        const raw = (ws as unknown as { savedLayouts: Map<string, Record<string, unknown>> }).savedLayouts.get('Desk');
        expect(raw && 'layoutPrefs' in raw).toBe(false);
    });
});
