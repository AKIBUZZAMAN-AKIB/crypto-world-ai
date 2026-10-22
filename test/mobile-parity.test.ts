// @vitest-environment jsdom
// Round 14 — the phone-parity audit's four defects, each pinned by a test.
//
//   1. The ◌ coach mark rendered INVISIBLE (transparent on black) because it portals to
//      <body>, where the theme's custom properties do not exist; and it swallowed the tap
//      meant for the chip it was pointing at (`pointer-events: auto` over the anchor).
//   2. The Object tree — the phone's ONLY indicator surface, because a grid cell folds its
//      legend rows away — offered two verbs (Hide, Remove) on a 32px row with hover-only
//      20px buttons: no settings, no move, no values.
//   3. The layout sheet on a phone had no share control at all, though the desktop card
//      copies a whole-workspace link.
//   4. The indicator picker's on-chart rows had a delete button and nothing else.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { Tip } from '../src/widget/tip';
import { MoreDrawer } from '../src/widget/more-drawer';
import { ObjectTree } from '../src/widget/object-tree';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
    Element.prototype.scrollIntoView ??= (() => undefined) as unknown as Element['scrollIntoView'];
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS: OHLCV[] = Array.from({ length: 200 }, (_, i) => ({
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

function mount(layout = '4'): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout,
        symbol: 'AAA',
        timeframe: '60',
        bars: 200,
        live: false,
        data: BARS,
        layoutMode: 'mobile',
    } as never);
    live.push(ws);
    return ws;
}

/** The stylesheet a component injected, as text (jsdom applies no cascade). */
function sheet(id: string): string {
    return document.getElementById(id)?.textContent ?? '';
}

describe('the coach mark', () => {
    it('is a kit layer, so the theme tokens it reads have a host', () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const tip = new Tip({ anchor, content: 'hello', onDismiss: () => undefined });
        expect(tip.el.classList.contains('vela-ui-layer')).toBe(true);
        expect(tip.el.classList.contains('vela-tip')).toBe(true);
        tip.dismiss();
    });

    it('never eats the press meant for what it explains', () => {
        const css = sheet('vela-widget-tip-v1');
        // The card and its arrow are pointer-transparent; the × is the one live target.
        expect(css).toMatch(/\.vela-tip\s*\{[^}]*pointer-events:\s*none/);
        expect(css).toMatch(/\.vela-tip-arrow\s*\{[^}]*pointer-events:\s*none/);
        expect(css).toMatch(/\.vela-tip-x\s*\{[^}]*pointer-events:\s*auto/);
    });

    it('dismisses on a press of its anchor even though the card floats above it', () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const onDismiss = vi.fn();
        new Tip({ anchor, content: 'hello', onDismiss });
        anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.vela-tip')).toBeNull();
        expect(document.querySelector('.vela-tip-arrow')).toBeNull();
    });
});

/**
 * A chart stub shaped like the slice `ObjectTree.snapshot()` reads. jsdom has no renderer, so
 * a real Vela paints only the price row — this is the smallest honest chart whose tree has
 * an indicator in it.
 */
function chartStub(): Record<string, unknown> {
    const handle = {
        id: 'ind-1',
        title: 'Relative Strength Index',
        visible: true,
        setVisible: () => undefined,
        remove: () => undefined,
    };
    const pane = {
        id: 'price',
        kind: 'price',
        label: 'Main chart',
        order: 0,
        collapsed: false,
        maximized: false,
        indicators: [{ id: 'ind-1', ownScale: false }],
    };
    return {
        panes: { list: () => [pane], supported: true },
        indicators: () => [handle],
        drawings: { supported: false, all: () => [] },
        renderer: {
            supports: () => false,
            get: () => undefined,
            dataWindowReadout: () => ({ date: '', time: '', ohlc: null, groups: [{ name: 'Relative Strength Index', rows: [{ label: 'RSI', value: '29.60', color: '' }] }] }),
            supportsIndicatorSettings: false,
        },
        on: () => () => undefined,
    };
}

describe('the object tree is the phone indicator manager', () => {
    it('gives an indicator row a value slot and an overflow menu with the full verb set', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const tree = new ObjectTree(host);
        tree.setSymbol('AAA');
        tree.onChart(chartStub() as never);
        tree.toggle(true);

        const row = [...host.querySelectorAll<HTMLElement>('.vela-ot-row')].find((r) => /Relative Strength/i.test(r.textContent ?? ''));
        expect(row).toBeTruthy();
        // The row keeps the legend's readout alive where the legend itself is folded.
        expect(row!.querySelector('.vela-ot-val')?.textContent).toBe('29.60');
        // …and its menu is the whole action set, not just Hide/Remove.
        const more = row!.querySelector<HTMLButtonElement>(".vela-ot-btn[data-icon='more']");
        expect(more).toBeTruthy();
        more!.click();
        const menu = document.body.querySelector('.vela-menu');
        expect(menu).toBeTruthy();
        const labels = [...menu!.querySelectorAll('li, [role="menuitem"]')].map((i) => (i.textContent ?? '').trim());
        expect(labels.some((l) => /Remove/.test(l))).toBe(true);
        tree.destroy();
    });

    it('keeps every row action visible and 44px on a coarse pointer', () => {
        mount('4');
        const css = sheet('vela-widget-objtree');
        const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
        expect(coarse).toMatch(/\.vela-ot-row\s*\{[^}]*min-height:\s*44px/);
        expect(coarse).toMatch(/\.vela-ot-btn\s*\{[^}]*visibility:\s*visible/);
        expect(coarse).toMatch(/\.vela-ot-val\s*\{/);
    });
});

describe('sharing from the phone', () => {
    it('the layout sheet offers a Share control that copies the workspace link', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const copy = vi.fn(async () => 'https://example.test/#s1=abc');
        const drawer = new MoreDrawer({
            host,
            undo: () => undefined,
            redo: () => undefined,
            canUndo: () => false,
            canRedo: () => false,
            onUndo: () => undefined,
            onRedo: () => undefined,
            priceStyles: () => [{ id: 'candles', label: 'Candles', icon: 'style-candles' }],
            priceStyle: () => 'candles',
            onPriceStyle: () => undefined,
            panels: () => [],
            onTogglePanel: () => undefined,
            actions: () => [],
            layout: {
                shape: () => ({ cols: 2, rows: 2 }),
                presets: () => [],
                onSelectGrid: () => undefined,
                onSelectPreset: () => undefined,
                onShareLink: copy,
            },
        } as never);
        drawer.open('layout');
        const share = host.querySelector<HTMLButtonElement>('.vela-md-share');
        expect(share).toBeTruthy();
        expect(share!.getAttribute('aria-label')).toBe('Copy share link');
        share!.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(copy).toHaveBeenCalledTimes(1);
        expect(share!.dataset.copied).toBe('1');
        expect(share!.getAttribute('aria-label')).toBe('Share link copied');
        drawer.destroy();
    });
});

describe('the phone doors a hold cannot reach', () => {
    /** The More drawer with the two rows this round added. */
    function drawerWith(over: Record<string, unknown> = {}) {
        const host = document.createElement('div');
        document.body.append(host);
        const onTimeZone = vi.fn();
        const onChartMenu = vi.fn();
        const drawer = new MoreDrawer({
            host,
            undo: () => undefined,
            redo: () => undefined,
            canUndo: () => false,
            canRedo: () => false,
            onUndo: () => undefined,
            onRedo: () => undefined,
            priceStyles: () => [{ id: 'candles', label: 'Candles', icon: 'style-candles' }],
            priceStyle: () => 'candles',
            onPriceStyle: () => undefined,
            panels: () => [],
            onTogglePanel: () => undefined,
            actions: () => [],
            timezone: () => 'Etc/UTC',
            onTimeZone,
            onChartMenu,
            ...over,
        } as never);
        drawer.open();
        return { host, drawer, onTimeZone, onChartMenu };
    }

    const rowLabels = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('.vela-md-row')].map((r) => (r.querySelector('.vela-md-row-label')?.textContent ?? '').trim());

    it('lists Time zone with the live zone, and opens the sheet from it', () => {
        const { host, drawer, onTimeZone } = drawerWith();
        expect(rowLabels(host)).toContain('Time zone');
        const row = [...host.querySelectorAll<HTMLElement>('.vela-md-row')].find((r) => /Time zone/.test(r.textContent ?? ''));
        expect(row?.querySelector('.vela-md-row-value')?.textContent).toBe('Etc/UTC');
        row!.click();
        expect(onTimeZone).toHaveBeenCalledTimes(1);
        drawer.destroy();
    });

    it('offers the chart-body menu as one row (the bulk clears a hold never reached)', () => {
        const { host, drawer, onChartMenu } = drawerWith();
        const row = [...host.querySelectorAll<HTMLElement>('.vela-md-row')].find((r) => /Chart actions/.test(r.textContent ?? ''));
        expect(row).toBeTruthy();
        row!.click();
        expect(onChartMenu).toHaveBeenCalledTimes(1);
        drawer.destroy();
    });

    it('omits both rows when the shell has no door for them', () => {
        const { host, drawer } = drawerWith({ onTimeZone: undefined, onChartMenu: undefined });
        const labels = rowLabels(host);
        expect(labels).not.toContain('Time zone');
        expect(labels.some((l) => /Chart actions/.test(l))).toBe(false);
        drawer.destroy();
    });
});
