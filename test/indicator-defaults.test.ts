// @vitest-environment jsdom
// TradingView's indicator-settings "Defaults" menu: save a type's settings as ITS default
// (so every new instance opens with them), load or clear that default, copy the current
// settings onto every instance of the type — and the document round-trip that makes the
// defaults outlive the session.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { ChartCell, type CellBoot, type CellDeps, type IndicatorDefaultsService } from '../src/workspace/ChartCell';
import { sanitizeState } from '../src/state/document';
import { IndicatorInputsDialog, type IndicatorDefaultsMenuHost } from '../src/renderers/shared/IndicatorInputsDialog';
import type { IChartRenderer, RendererCapabilities, IndicatorRenderHandle, VisibleRange, InputChangeEvent, ClickEvent, CrosshairEvent } from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { InputValue } from '../src/core/model/inputs';
import type { InputSchema } from '../src/core/model/inputs';
import type { IndicatorModel, Pane, ScenePatch } from '../src/core/model';
import type { PriceStyle } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import { DARK_THEME } from '../src/core/theme';

const FIVE_MIN = 300_000;
const makeBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({
        time: 1_700_000_000_000 + i * FIVE_MIN,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10 + i,
    }));

class MockDataFeed implements MarketDataFeed {
    load(): Promise<OHLCV[]> {
        return Promise.resolve(makeBars(60));
    }
    subscribe(): Unsubscribe {
        return () => {};
    }
}

/** The same minimal renderer the cell-persistence suite uses (only what the cell calls). */
class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true,
        paneManagement: false,
        fills: 'primitive',
        bgcolor: 'primitive',
        hline: 'native',
        markers: true,
        barcolor: 'approximated',
        perPointColor: true,
        drawings: true,
        userDrawings: false,
        tables: true,
        inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    /** The defaults host the cell published (what the indicator dialog would receive). */
    defaultsHost: unknown = null;
    setIndicatorDefaults(host: unknown): void {
        this.defaultsHost = host;
    }
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    style = 'candles';
    applyFeature(key: string, value: unknown): void {
        if (key === 'priceStyle' && typeof value === 'string') this.style = value;
    }
    readFeature(key: string): unknown {
        return key === 'priceStyle' ? this.style : undefined;
    }
    applyConfig(): void {}
    onConfigChanged(_cb: () => void): Unsubscribe {
        return () => {};
    }
    destroy(): void {}
    setBars(): void {}
    updateBar(): void {}
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        return { id: model.id };
    }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe {
        return () => {};
    }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe {
        return () => {};
    }
    onToggleIndicatorVisible(_cb: (id: string, visible: boolean) => void): Unsubscribe {
        return () => {};
    }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe {
        return () => {};
    }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe {
        return () => {};
    }
    getVisibleRange(): VisibleRange | null {
        return null;
    }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe {
        return () => {};
    }
    onPriceStyleChange(_cb: (style: PriceStyle) => void): Unsubscribe {
        return () => {};
    }
    setNativeData(): void {}
    setIndicatorStatus(): void {}
}

let lastRenderer: FakeRenderer | null = null;
class TrackedRenderer extends FakeRenderer {
    constructor() {
        super();
        lastRenderer = this;
    }
}

function makeDeps(over: Partial<CellDeps> = {}): CellDeps {
    return {
        feed: new MockDataFeed(),
        engines: {},
        chartDefaults: { renderer: TrackedRenderer, drawings: false } as CellDeps['chartDefaults'],
        theme: DARK_THEME,
        live: false,
        volume: true,
        statusline: false,
        watermark: false,
        nativeBackend: 'canvas2d',
        dialogHost: document.body,
        timezone: () => 'Etc/UTC',
        setTimezone: () => {},
        context: () => ({}) as never,
        manifestSettled: () => true,
        activate: () => {},
        multiCell: () => false,
        isMaximized: () => false,
        toggleMaximize: () => {},
        cellDragTarget: () => null,
        previewDropTarget: () => {},
        dropCell: () => {},
        onMarketChanged: () => {},
        onPriceStyleChanged: () => {},
        onIndicatorsChanged: () => {},
        onStatusPrefsChanged: () => {},
        onStateDirty: () => {},
        toast: () => {},
        ...over,
    };
}

const SEED = { symbol: 'BINANCE:BTCUSDT', timeframe: '60', priceStyle: 'candles' } as CellBoot;

function makeCell(deps: Partial<CellDeps> = {}): ChartCell {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new ChartCell('c1', host, SEED, makeDeps(deps));
}

/** A defaults service over a Map — the workspace's store without the workspace. */
function makeService(onSave = vi.fn(), onApplyToAll = vi.fn()): IndicatorDefaultsService & { bag: Map<string, { inputs: Record<string, InputValue>; props: Record<string, InputValue> }> } {
    const bag = new Map<string, { inputs: Record<string, InputValue>; props: Record<string, InputValue> }>();
    return {
        bag,
        has: (type) => bag.has(type),
        get: (type) => bag.get(type) ?? null,
        save: (type, inputs, props) => {
            onSave(type, inputs, props);
            bag.set(type, { inputs: { ...inputs }, props: { ...props } });
        },
        clear: (type) => {
            bag.delete(type);
        },
        applyToAll: (type, inputs, props) => {
            onApplyToAll(type, inputs, props);
            return 2;
        },
        chartCount: () => 1,
    };
}

describe('indicator defaults — the document', () => {
    it('round-trips primitive bags and drops everything else', () => {
        const state = sanitizeState({
            version: 1,
            layout: '1',
            charts: [],
            indicatorDefaults: {
                rsi: { inputs: { length: 21, source: 'close' }, props: { precision: 4 } },
                bad: { inputs: { nested: { no: true }, fn: () => 1 } },
                nothing: { inputs: {} },
            },
        });
        expect(state?.indicatorDefaults?.rsi).toEqual({ inputs: { length: 21, source: 'close' }, props: { precision: 4 } });
        expect(state?.indicatorDefaults?.bad).toBeUndefined();
        expect(state?.indicatorDefaults?.nothing).toBeUndefined();
    });

    it('keeps at most 200 types', () => {
        const many: Record<string, unknown> = {};
        for (let i = 0; i < 240; i++) many[`t${i}`] = { inputs: { length: i } };
        const state = sanitizeState({ version: 1, layout: '1', charts: [], indicatorDefaults: many });
        expect(Object.keys(state?.indicatorDefaults ?? {}).length).toBe(200);
    });
});

describe('a new instance opens with the saved default', () => {
    it('seeds inputs on mount', async () => {
        const service = makeService();
        service.bag.set('rsi', { inputs: { length: 21 }, props: {} });
        const cell = makeCell({ indicatorDefaults: service });
        await new Promise((r) => setTimeout(r, 20));
        cell.addNative('rsi');
        const rsi = cell.chart.indicators().find((h) => h.nativeType === 'rsi');
        expect(rsi?.inputValues().length).toBe(21);
        cell.destroy();
    });

    it('publishes the host the indicator dialog asks', async () => {
        const service = makeService();
        const cell = makeCell({ indicatorDefaults: service });
        await new Promise((r) => setTimeout(r, 20));
        const host = lastRenderer?.defaultsHost as IndicatorDefaultsMenuHost | null;
        expect(host).toBeTruthy();
        host?.save('rsi', { length: 30 }, {});
        expect(service.bag.get('rsi')).toEqual({ inputs: { length: 30 }, props: {} });
        expect(host?.has('rsi')).toBe(true);
        host?.clear('rsi');
        expect(host?.has('rsi')).toBe(false);
        cell.destroy();
    });
});

describe('apply to every instance of the type', () => {
    it('writes the values onto each instance and counts them', async () => {
        const cell = makeCell();
        await new Promise((r) => setTimeout(r, 20));
        cell.addNative('rsi');
        cell.addNative('rsi');
        const touched = cell.applyIndicatorSettingsToType('rsi', { length: 34 }, {});
        const lengths = cell.chart
            .indicators()
            .filter((h) => h.nativeType === 'rsi')
            .map((h) => h.inputValues().length);
        expect(touched).toBe(2);
        expect(lengths).toEqual([34, 34]);
        cell.destroy();
    });
});

describe('the dialog footer', () => {
    const input: InputSchema = { key: 'length', title: 'Length', type: 'int', defval: 14, min: 1, max: 500, step: 1 };
    const row = {
        id: 'i1',
        title: 'RSI',
        indicatorType: 'rsi',
        siblings: 3,
        inputs: [input],
        values: { length: 20 } as Record<string, InputValue>,
        props: [] as InputSchema[],
        propValues: {} as Record<string, InputValue>,
    };

    beforeAll(() => {
        Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    function openDialog(host: IndicatorDefaultsMenuHost | null, over: Partial<typeof row> = {}): { dialog: IndicatorInputsDialog; row: typeof row; changes: InputValue[] } {
        const changes: InputValue[] = [];
        const dialog = new IndicatorInputsDialog({
            container: document.body,
            theme: () => DARK_THEME,
            mobile: () => false,
            dialogHost: () => document.body,
            symbolPicker: () => null,
            onChange: (c) => changes.push(c.value),
            onBackdropClose: () => {},
        });
        dialog.setDefaultsHost(host);
        const merged = { ...row, ...over };
        dialog.open(merged as never);
        return { dialog, row: merged, changes };
    }

    const labels = (): string[] => [...document.querySelectorAll('.vela-ind-defmenu .vela-ind-defrow-label')].map((el) => el.textContent ?? '');
    const clickLabel = (text: string): void => {
        const btn = [...document.querySelectorAll<HTMLButtonElement>('.vela-ind-defmenu .vela-ind-defrow')].find((b) => b.textContent === text);
        expect(btn, `row “${text}” exists`).toBeTruthy();
        btn!.click();
    };

    it('replaces the reset chip with Defaults ▾ and offers the whole menu', () => {
        const host: IndicatorDefaultsMenuHost = {
            has: () => false,
            saved: () => null,
            save: () => {},
            clear: () => {},
            chartCount: () => 2,
            applyToAll: () => 1,
        };
        const { dialog } = openDialog(host);
        const btn = document.querySelector<HTMLButtonElement>('.vela-ind-defaults');
        expect(btn?.textContent).toContain('Defaults');
        expect(document.querySelector('.vela-sd-reset')).toBeNull();
        btn!.click();
        expect(labels()).toEqual([
            'Save as default',
            'Load saved default',
            'Clear saved default',
            'Apply to every RSI on this chart',
            'Apply to every RSI in the layout',
            'Reset to factory defaults',
        ]);
        dialog.close();
    });

    it('saves the form the user is looking at', () => {
        const saved: unknown[] = [];
        const host: IndicatorDefaultsMenuHost = {
            has: () => false,
            saved: () => null,
            save: (type, inputs, props) => saved.push([type, inputs, props]),
            clear: () => {},
        };
        const { dialog } = openDialog(host);
        document.querySelector<HTMLButtonElement>('.vela-ind-defaults')!.click();
        clickLabel('Save as default');
        expect(saved).toEqual([['rsi', { length: 20 }, {}]]);
        dialog.close();
    });

    it('loads a saved default through the same commit path an edit takes', () => {
        const host: IndicatorDefaultsMenuHost = {
            has: () => true,
            saved: () => ({ inputs: { length: 9 }, props: {} }),
            save: () => {},
            clear: () => {},
        };
        const { dialog, row: live, changes } = openDialog(host);
        document.querySelector<HTMLButtonElement>('.vela-ind-defaults')!.click();
        clickLabel('Load saved default');
        expect(live.values.length).toBe(9);
        expect(changes).toContain(9);
        // The rebuild closes the menu with the dialog it hung off; the new footer is live.
        expect(document.querySelector('.vela-ind-defmenu')).toBeNull();
        expect(document.querySelector('.vela-ind-defaults')).toBeTruthy();
        dialog.close();
    });

    it('greys the rows that need a saved default', () => {
        const host: IndicatorDefaultsMenuHost = { has: () => false, saved: () => null, save: () => {}, clear: () => {} };
        const { dialog } = openDialog(host);
        document.querySelector<HTMLButtonElement>('.vela-ind-defaults')!.click();
        const disabled = [...document.querySelectorAll<HTMLButtonElement>('.vela-ind-defmenu .vela-ind-defrow')]
            .filter((b) => b.disabled)
            .map((b) => b.textContent);
        expect(disabled).toEqual(['Load saved default', 'Clear saved default']);
        dialog.close();
    });

    it('offers the chart row only with siblings, the layout row only with charts', () => {
        const host: IndicatorDefaultsMenuHost = { has: () => false, saved: () => null, save: () => {}, clear: () => {}, chartCount: () => 1 };
        const { dialog } = openDialog(host, { siblings: 1 });
        document.querySelector<HTMLButtonElement>('.vela-ind-defaults')!.click();
        expect(labels()).not.toContain('Apply to every RSI on this chart');
        expect(labels()).not.toContain('Apply to every RSI in the layout');
        dialog.close();
    });

    it('keeps the plain chip for a script indicator (no type)', () => {
        const { dialog } = openDialog(null);
        expect(document.querySelector('.vela-ind-defaults')).toBeNull();
        expect(document.querySelector('.vela-dialog-footer .vela-dialog-btn')?.textContent).toBe('Reset defaults');
        dialog.close();
    });
});
