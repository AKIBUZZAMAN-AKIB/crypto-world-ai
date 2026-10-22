// @vitest-environment jsdom
// Round 16 — the phone's chart menu. A touch long-press on the plot no longer inspects
// (that was a second meaning for one gesture); it opens the SAME six rows the desktop
// body right-click shows, as a sheet. This pins the projection: same model, same order,
// same disabled rule, and a pick runs the row and dismisses.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { ChartMenuDrawer } from '../src/widget/chart-menu-drawer';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

/** The chart slice the sheet reads: drawings, indicators and the renderer's settings door. */
function chartStub(over: { drawings?: number; indicators?: number; openSettings?: () => void } = {}): Record<string, unknown> {
    const drawings = over.drawings ?? 0;
    const indicators = over.indicators ?? 0;
    return {
        drawings: {
            supported: true,
            all: () => Array.from({ length: drawings }, (_, i) => ({ id: `d${i}` })),
            remove: () => undefined,
        },
        indicators: () => Array.from({ length: indicators }, () => ({ remove: () => undefined })),
        renderer: { openSettings: over.openSettings ?? (() => undefined) },
    };
}

function open(over: Parameters<typeof chartStub>[0] = {}, opts: Partial<ConstructorParameters<typeof ChartMenuDrawer>[0]> = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const onResetView = vi.fn();
    const drawer = new ChartMenuDrawer({
        host,
        chart: () => chartStub(over) as never,
        resetView: onResetView,
        applySettingsToAll: () => undefined,
        chartSyncing: () => undefined,
        ...opts,
    });
    drawer.open();
    return { host, drawer, onResetView };
}

const rows = (host: HTMLElement): Array<{ label: string; disabled: boolean }> =>
    [...host.querySelectorAll<HTMLElement>('.vela-cmd-row')].map((r) => ({
        label: (r.querySelector('.vela-cmd-row-label')?.textContent ?? '').trim(),
        disabled: r.dataset.disabled === '1',
    }));

describe('the chart menu sheet', () => {
    it('projects the desktop body menu — same six rows, same order', () => {
        const { host, drawer } = open({ drawings: 0, indicators: 1 });
        expect(rows(host).map((r) => r.label)).toEqual([
            'Reset chart view',
            'Chart syncing…',
            'Remove drawings',
            'Remove indicators',
            'Apply settings to all charts',
            'Settings…',
        ]);
        drawer.destroy();
    });

    it('disables a bulk clear that would clear nothing, exactly like the desktop menu', () => {
        const { host, drawer } = open({ drawings: 0, indicators: 0 });
        const byLabel = new Map(rows(host).map((r) => [r.label, r.disabled]));
        expect(byLabel.get('Remove drawings')).toBe(true);
        expect(byLabel.get('Remove indicators')).toBe(true);
        drawer.destroy();
    });

    it('runs the picked row and dismisses the sheet', () => {
        const { host, drawer, onResetView } = open({ indicators: 1 });
        const row = [...host.querySelectorAll<HTMLElement>('.vela-cmd-row')].find((r) => /Reset chart view/.test(r.textContent ?? ''));
        row!.click();
        expect(onResetView).toHaveBeenCalledTimes(1);
        const positioner = host.querySelector<HTMLElement>('.vela-drawer-positioner');
        expect(positioner?.style.display).toBe('none');
        drawer.destroy();
    });

    it('hides the multi-chart rows on a single chart', () => {
        const { host, drawer } = open({}, { applySettingsToAll: undefined, chartSyncing: undefined });
        const labels = rows(host).map((r) => r.label);
        expect(labels).not.toContain('Apply settings to all charts');
        expect(labels).not.toContain('Chart syncing…');
        expect(labels).toContain('Settings…');
        drawer.destroy();
    });
});
