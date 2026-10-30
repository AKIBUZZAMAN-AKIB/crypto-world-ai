// @vitest-environment jsdom
// More → Chart actions projects the desktop body model in a compact, non-modal menu.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Vela } from '../src/Vela';
import { registerWidgetAction, type WidgetContext } from '../src/widget/contributions';
import { ChartContextMenu, type ContextMenuCallbacks } from '../src/widget/context-menu';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.replaceChildren();
});

type Counts = { drawings?: number; indicators?: number };
function setup(counts: Counts = {}, options: Partial<ContextMenuCallbacks> = {}) {
    const root = document.createElement('div');
    root.className = 'vela-ui';
    const host = document.createElement('div');
    const anchor = document.createElement('button');
    anchor.className = 'vela-mb-more';
    root.append(host, anchor);
    document.body.append(root);
    const resetView = vi.fn();
    const chartSyncing = vi.fn();
    const applySettingsToAll = vi.fn();
    const removeDrawing = vi.fn();
    const removeIndicator = vi.fn();
    const openSettings = vi.fn();
    let crosshair: ((e: { price: number | null; time: number | null; paneKind: string | null }) => void) | null = null;
    const chart = {
        renderer: {
            onCrosshairMove: (fn: typeof crosshair) => { crosshair = fn; return () => { crosshair = null; }; },
            get: () => undefined,
            set: () => undefined,
            openSettings,
        },
        drawings: {
            supported: true,
            all: () => Array.from({ length: counts.drawings ?? 0 }, (_, i) => ({ id: `d${i}` })),
            remove: removeDrawing,
        },
        indicators: () => Array.from({ length: counts.indicators ?? 0 }, () => ({ remove: removeIndicator })),
    } as unknown as Vela;
    const menu = new ChartContextMenu(host, { resetView, chartSyncing, applySettingsToAll, ...options });
    menu.onChart(chart);
    cleanups.push(() => menu.destroy());
    menu.openBody(anchor);
    const list = root.querySelector<HTMLElement>('.vela-chart-actions')!;
    return { root, host, anchor, menu, list, chart, resetView, chartSyncing, applySettingsToAll, removeDrawing, removeIndicator, openSettings, move: (event: Parameters<NonNullable<typeof crosshair>>[0]) => crosshair?.(event) };
}

function row(list: HTMLElement, id: string): HTMLElement {
    const found = [...list.querySelectorAll<HTMLElement>('.vela-menu-item')].find((el) => el.dataset.veiId === id);
    if (!found) throw new Error(`No menu item ${id}`);
    return found;
}

const labels = (list: HTMLElement): string[] => [...list.querySelectorAll<HTMLElement>('.vela-menu-label')].map((el) => el.textContent ?? '');

describe('floating chart actions', () => {
    it('projects the same body actions without a drawer or modal', () => {
        const { root, list } = setup({ indicators: 1 });
        expect(labels(list)).toEqual([
            'Reset chart view', 'Chart syncing…', 'Remove drawings', 'Remove indicators', 'Apply settings to all charts', 'Settings…',
        ]);
        expect(list.getAttribute('role')).toBe('menu');
        expect(list.getAttribute('aria-label')).toBe('Chart actions');
        expect(list.hasAttribute('aria-labelledby')).toBe(false);
        expect(root.querySelector('.vela-drawer, .vela-dialog, .vela-size-grip')).toBeNull();
    });

    it('disables only the clears that have nothing to remove', () => {
        const empty = setup().list;
        expect(row(empty, 'remove-drawings').getAttribute('aria-disabled')).toBe('true');
        expect(row(empty, 'remove-indicators').getAttribute('aria-disabled')).toBe('true');
        const populated = setup({ drawings: 2, indicators: 1 }).list;
        expect(row(populated, 'remove-drawings').hasAttribute('aria-disabled')).toBe(false);
        expect(row(populated, 'remove-indicators').hasAttribute('aria-disabled')).toBe(false);
    });

    it('omits multi-chart rows when those capabilities are absent', () => {
        const { list } = setup({}, { applySettingsToAll: undefined, chartSyncing: undefined });
        expect(labels(list)).not.toContain('Apply settings to all charts');
        expect(labels(list)).not.toContain('Chart syncing…');
        expect(labels(list)).toContain('Settings…');
    });

    it.each([
        ['reset-view', 'resetView'],
        ['chart-syncing', 'chartSyncing'],
        ['apply-settings-all', 'applySettingsToAll'],
        ['remove-drawings', 'removeDrawing'],
        ['remove-indicators', 'removeIndicator'],
        ['settings:Canvas', 'openSettings'],
    ] as const)('runs %s through the existing chart action and dismisses', async (id, method) => {
        const result = setup({ drawings: 1, indicators: 1 });
        await vi.waitFor(() => expect(result.list.dataset.state).toBe('open'));
        const item = row(result.list, id);
        item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        await vi.waitFor(() => expect(item.hasAttribute('data-highlighted')).toBe(true));
        item.click();
        await vi.waitFor(() => expect(result[method]).toHaveBeenCalledTimes(1));
        expect(result.list.dataset.state).toBe('closed');
        if (id === 'remove-drawings') expect(result.removeDrawing).toHaveBeenCalledWith('d0');
        if (id === 'settings:Canvas') expect(result.openSettings).toHaveBeenCalledWith('Canvas');
    });

    it('retains contributed body actions and gives them an off-plot, live context', async () => {
        let symbol = 'BTCUSDT';
        const context = { get symbol() { return symbol; } } as unknown as WidgetContext;
        const seen: Array<WidgetContext> = [];
        cleanups.push(registerWidgetAction({
            id: 'test.floating-body', target: 'context:body', label: 'Contributed action', order: -100,
            when: (ctx) => { seen.push(ctx); return true; },
            run: (ctx) => { seen.push(ctx); },
        }));
        const { list } = setup({}, { getContext: () => context });
        expect(labels(list)[0]).toBe('Contributed action');
        expect(seen[0]?.pointer).toEqual({ price: null, time: null, paneKind: null });
        symbol = 'ETHUSDT';
        await vi.waitFor(() => expect(list.dataset.state).toBe('open'));
        const item = row(list, 'action:test.floating-body');
        item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        await vi.waitFor(() => expect(item.hasAttribute('data-highlighted')).toBe(true));
        item.click();
        await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3));
        expect(seen[seen.length - 1]?.symbol).toBe('ETHUSDT');
        expect(seen[seen.length - 1]?.pointer).toEqual({ price: null, time: null, paneKind: null });
    });
});
