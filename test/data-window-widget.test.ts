// @vitest-environment jsdom
// Data Window: live values, semantic history and chart identity, including renderers
// that do not implement the optional readout. Layout/touch are proved in Chromium.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Vela } from '../src/Vela';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { CrosshairEvent, DataWindowReadout } from '../src/core/ports/IChartRenderer';
import { DataWindow } from '../src/widget/data-window';

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

function sample(close = '12.34'): DataWindowReadout {
    return {
        date: '2026-10-28', time: '09:45',
        ohlc: { o: '12.00', h: '13.00', l: '11.00', c: close, vol: '4.5K', up: true },
        source: 'latest',
        groups: [
            { id: 'ma-1', name: 'Moving Average', rows: [{ label: 'MA', value: '12.11', color: '#ff0000' }] },
            { id: 'ma-2', name: 'Moving Average', rows: [{ label: 'MA', value: '11.22', color: '#00ff00' }] },
        ],
    };
}

class FakeChart {
    market = { symbol: 'BINANCE:BTCUSDT', timeframe: '60', offline: false };
    zone = 'UTC';
    loading = false;
    readout: DataWindowReadout | null = sample();
    bars: OHLCV[] = Array.from({ length: 500 }, (_, i) => ({
        time: Date.UTC(2024, 0, 1) + i * 60_000, open: i + 1, high: i + 3, low: i, close: i + 2, volume: i + 100,
    }));
    replay = { state: { active: false } };
    private readonly events = new Map<string, Set<() => void>>();
    private readonly crosshair = new Set<(e: CrosshairEvent) => void>();
    private readonly readoutChanges = new Set<() => void>();
    private readonly configChanges = new Set<() => void>();
    readonly renderer = {
        dataWindowReadout: () => this.readout,
        getBars: () => this.bars,
        supportsCandleNavigation: false,
        revealTableCandle: vi.fn((_time: number, _offset: number) => true),
        get: (key: string) => key === 'timezone' ? this.zone : undefined,
        onCrosshairMove: (fn: (e: CrosshairEvent) => void) => { this.crosshair.add(fn); return () => this.crosshair.delete(fn); },
        onDataWindowChange: (fn: () => void) => { this.readoutChanges.add(fn); return () => this.readoutChanges.delete(fn); },
        onConfigChanged: (fn: () => void) => { this.configChanges.add(fn); return () => this.configChanges.delete(fn); },
    };
    on(event: string, fn: () => void): () => void {
        const callbacks = this.events.get(event) ?? new Set();
        callbacks.add(fn);
        this.events.set(event, callbacks);
        return () => callbacks.delete(fn);
    }
    emit(event: string): void { for (const fn of this.events.get(event) ?? []) fn(); }
    emitCrosshair(time: number | null): void { for (const fn of this.crosshair) fn({ time } as CrosshairEvent); }
    emitReadout(): void { for (const fn of this.readoutChanges) fn(); }
    readoutObserverCount(): number { return this.readoutChanges.size; }
    emitConfig(): void { for (const fn of this.configChanges) fn(); }
    asVela(): Vela { return this as unknown as Vela; }
}

const mounted: DataWindow[] = [];
function mount(chart = new FakeChart()): { chart: FakeChart; panel: DataWindow; root: HTMLElement } {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const panel = new DataWindow(root);
    mounted.push(panel);
    panel.onChart(chart.asVela());
    panel.toggle(true);
    return { chart, panel, root };
}
function byLabel(root: HTMLElement, label: string): HTMLElement {
    const row = [...root.querySelectorAll<HTMLElement>('.vela-dw-row')].find((el) => el.querySelector('.vela-dw-label')?.textContent === label);
    if (!row) throw new Error(`No row ${label}`);
    return row.querySelector<HTMLElement>('.vela-dw-value')!;
}
function pointer(target: Element, type: string, pointerType: string, relatedTarget: EventTarget | null = null): void {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
}
afterEach(() => {
    document.getSelection()?.removeAllRanges();
    for (const panel of mounted.splice(0)) panel.destroy();
    document.body.replaceChildren();
    Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Data Window widget', () => {
    it('renders active market, timeframe, timezone, real values and an honest source', () => {
        const { root } = mount();
        expect(root.querySelector('.vela-dw-symbol')?.textContent).toBe('BINANCE:BTCUSDT');
        expect(root.querySelector('.vela-dw-period')?.textContent).toBe('1h');
        expect(root.querySelector('.vela-dw-zone')?.textContent).toBe('UTC');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Latest bar');
        expect(byLabel(root, 'Close').textContent).toBe('12.34');
        expect(root.querySelector('.vela-dw-data-view')?.getAttribute('role')).toBe('tabpanel');
        expect(root.querySelector('.vela-dw-tab[aria-selected="true"]')?.textContent).toBe('Data');
        expect(root.querySelector('.vela-dw-hold')).toBeNull();
        const max = root.querySelector<HTMLButtonElement>('.vela-panel-max')!;
        expect(max.getAttribute('aria-label')).toBe('Maximize');
        expect(max.getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelectorAll('.vela-dw-section[data-kind="indicator"]')).toHaveLength(2);
    });

    it('patches rows in place and preserves focus, scroll and per-ID collapsed state', () => {
        const { chart, root } = mount();
        const body = root.querySelector<HTMLElement>('.vela-dw-data-view')!;
        const firstValue = byLabel(root, 'Close');
        const firstButtons = root.querySelectorAll<HTMLButtonElement>('.vela-dw-disclosure');
        firstButtons[0]!.click();
        firstButtons[1]!.focus();
        body.scrollTop = 60;
        chart.readout = sample('12.99');
        chart.readout.groups.reverse();
        chart.readout.source = 'crosshair';
        chart.emit('bar');
        expect(byLabel(root, 'Close')).toBe(firstValue);
        expect(firstValue.textContent).toBe('12.99');
        expect(document.activeElement).toBe(firstButtons[1]);
        expect(body.scrollTop).toBe(60);
        expect(firstButtons[0]?.getAttribute('aria-expanded')).toBe('false');
        expect(firstButtons[1]?.getAttribute('aria-expanded')).toBe('true');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Crosshair');
    });

    it('keeps following live values even while text is selected or the pointer enters the panel', () => {
        const { chart, panel, root } = mount();
        const value = byLabel(root, 'Close');
        const range = document.createRange();
        range.selectNodeContents(value);
        document.getSelection()!.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        chart.readout = { ...sample('99.99'), date: '2026-10-29', time: '10:00' };
        chart.emit('bar');
        expect(byLabel(root, 'Close')).toBe(value);
        expect(value.textContent).toBe('99.99');
        expect(byLabel(root, 'Date').textContent).toBe('2026-10-29');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Latest bar');
        pointer(panel.el, 'pointerenter', 'mouse');
        chart.readout = { ...sample('88.88'), source: 'crosshair' };
        chart.emitCrosshair(123);
        expect(value.textContent).toBe('88.88');
        chart.readout = sample('77.77');
        chart.emitCrosshair(null);
        expect(value.textContent).toBe('77.77');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Latest bar');
    });

    it('hides stale values during a market load and rebinds to the active chart', () => {
        const { chart, panel, root } = mount();
        chart.readout!.ohlc!.c = '77.77';
        chart.emit('bar');
        expect(byLabel(root, 'Close').textContent).toBe('77.77');
        chart.market.symbol = 'ETHUSDT';
        chart.emit('load:start');
        expect(root.querySelector('.vela-dw-empty')?.textContent).toBe('Loading chart data…');
        expect(root.querySelector<HTMLElement>('.vela-dw-sections')?.hidden).toBe(true);
        expect(root.querySelector<HTMLButtonElement>('.vela-dw-copy')?.disabled).toBe(true);
        chart.readout = sample('22.00');
        chart.emit('load:end');
        expect(root.querySelector('.vela-dw-symbol')?.textContent).toBe('ETHUSDT');
        expect(byLabel(root, 'Close').textContent).toBe('22.00');
        const other = new FakeChart();
        other.market.symbol = 'SOLUSDT';
        other.readout = sample('33.00');
        panel.onChart(other.asVela());
        expect(root.querySelector('.vela-dw-symbol')?.textContent).toBe('SOLUSDT');
        expect(byLabel(root, 'Close').textContent).toBe('33.00');
        chart.emit('bar');
        expect(byLabel(root, 'Close').textContent).toBe('33.00');
    });

    it('reflects readout-only and config changes; unknown provenance stays unlabeled', () => {
        const { chart, root } = mount();
        chart.zone = 'Asia/Dhaka';
        chart.readout = { ...sample(), time: '15:45', source: 'synced' };
        chart.emitReadout();
        expect(root.querySelector('.vela-dw-zone')?.textContent).toBe('Asia/Dhaka');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Synced crosshair');
        expect(byLabel(root, 'Time').textContent).toBe('15:45');
        delete chart.readout.source;
        chart.emitConfig();
        expect(root.querySelector<HTMLElement>('.vela-dw-source')?.hidden).toBe(true);
    });

    it('pauses frame observation on close and rebinds it on reopen', () => {
        const { chart, panel, root } = mount();
        expect(chart.readoutObserverCount()).toBe(1);
        panel.toggle(false, true);
        expect(chart.readoutObserverCount()).toBe(0);
        chart.readout = sample('88.00');
        panel.toggle(true);
        expect(chart.readoutObserverCount()).toBe(1);
        expect(byLabel(root, 'Close').textContent).toBe('88.00');
        expect(root.querySelector('.vela-dw-source')?.textContent).toBe('Latest bar');
    });

    it('keeps old bars suppressed through a silently superseding market load', () => {
        const { chart, root } = mount();
        chart.market.symbol = 'FIRST';
        chart.emit('load:start');
        chart.market.symbol = 'LAST'; // superseded work may not emit another load:start
        chart.emit('market:changed');
        chart.emit('bar');
        expect(root.querySelector('.vela-dw-symbol')?.textContent).toBe('LAST');
        expect(root.querySelector<HTMLElement>('.vela-dw-sections')?.hidden).toBe(true);
        expect(root.querySelector('.vela-dw-empty')?.textContent).toBe('Loading chart data…');
        chart.readout = sample('55.00');
        chart.emit('load:end');
        expect(root.querySelector('.vela-dw-symbol')?.textContent).toBe('LAST');
        expect(byLabel(root, 'Close').textContent).toBe('55.00');
    });

    it('reflects replay cuts and restores even without bar events', () => {
        const { chart, root } = mount();
        chart.readout = { ...sample('7.00'), date: '2026-10-01' };
        chart.emit('replay:start');
        expect(byLabel(root, 'Date').textContent).toBe('2026-10-01');
        expect(byLabel(root, 'Close').textContent).toBe('7.00');
        chart.readout = sample('12.34');
        chart.emit('replay:end');
        expect(byLabel(root, 'Close').textContent).toBe('12.34');
    });

    it('distinguishes empty data from an unsupported renderer', () => {
        const { chart, root } = mount();
        chart.readout = { date: '', time: '', ohlc: null, groups: [] };
        chart.emit('bar');
        expect(root.querySelector('.vela-dw-empty')?.textContent).toBe('No chart data');
        expect(root.querySelector<HTMLButtonElement>('.vela-dw-copy')?.disabled).toBe(true);
        chart.readout = null;
        chart.emit('bar');
        expect(root.querySelector('.vela-dw-empty')?.textContent).toBe('This renderer provides no data readout.');
    });

    it('copies the complete snapshot, including collapsed plots, and reports permission failure', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const { root } = mount();
        root.querySelector<HTMLButtonElement>('.vela-dw-disclosure')!.click();
        root.querySelector<HTMLButtonElement>('.vela-dw-copy')!.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledOnce();
        const copied = writeText.mock.calls[0]![0] as string;
        expect(copied).toContain('BINANCE:BTCUSDT · 1h');
        expect(copied).toContain('Time (UTC)');
        expect(copied).toContain('Close\t12.34');
        expect(copied).toContain('MA\t12.11');
        expect(copied).toContain('MA\t11.22');
        expect(root.querySelector('[role="status"]')?.textContent).toBe('Copied');
        writeText.mockRejectedValue(new Error('denied'));
        root.querySelector<HTMLButtonElement>('.vela-dw-copy')!.click();
        await Promise.resolve();
        expect(root.querySelector('[role="status"]')?.textContent).toContain('Copy unavailable');
    });
    it('switches between accessible Data and Table tabs with keyboard navigation', () => {
        const { root } = mount();
        const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        expect(tabs).toHaveLength(2);
        tabs[0]!.focus();
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
        expect(root.querySelector<HTMLElement>('.vela-dw-data-view')!.hidden).toBe(true);
        expect(root.querySelector<HTMLElement>('.vela-dw-table-view')!.hidden).toBe(false);
        tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tabs[0]);
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
        tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    });

    it('virtualizes newest-first loaded candles, with full volume and semantic row indices', () => {
        const { chart, root } = mount();
        root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
        const table = root.querySelector<HTMLTableElement>('.vela-dw-table')!;
        const scroller = root.querySelector<HTMLElement>('.vela-dw-table-scroll')!;
        const rows = (): HTMLTableRowElement[] => [...table.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.vela-dw-table-spacer)')];
        expect(table.getAttribute('aria-rowcount')).toBe('501');
        expect(table.getAttribute('aria-colcount')).toBe('6');
        expect(rows().length).toBeLessThan(30);
        expect(rows()[0]!.dataset.timestamp).toBe(String(chart.bars[499]!.time));
        expect(rows()[0]!.cells[4]!.textContent).toBe('501');
        expect(rows()[0]!.cells[5]!.textContent).toBe('599');
        expect(rows()[0]!.getAttribute('aria-rowindex')).toBe('2');
        scroller.scrollTop = 3200;
        scroller.dispatchEvent(new Event('scroll'));
        expect(rows()[0]!.getAttribute('aria-rowindex')).toBe('97');
        expect(rows().length).toBeLessThan(30);
        scroller.scrollTop = 16_000;
        scroller.dispatchEvent(new Event('scroll'));
        const last = rows()[rows().length - 1]!;
        expect(last.getAttribute('aria-rowindex')).toBe('501');
        expect(last.dataset.timestamp).toBe(String(chart.bars[0]!.time));
    });

    it('keeps the table live, replay-bounded and loading-safe on chart changes', () => {
        const { chart, panel, root } = mount();
        root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
        const table = root.querySelector<HTMLTableElement>('.vela-dw-table')!;
        const firstRow = (): HTMLTableRowElement => table.querySelector('tbody tr:not(.vela-dw-table-spacer)')!;
        chart.bars[499]!.close = 999.1234;
        chart.emit('bar');
        expect(firstRow().cells[4]!.textContent).toBe('999.1234');
        chart.bars = chart.bars.slice(0, 200);
        chart.replay.state.active = true;
        chart.emit('replay:start');
        expect(table.getAttribute('aria-rowcount')).toBe('201');
        expect(firstRow().dataset.timestamp).toBe(String(chart.bars[199]!.time));
        expect(root.querySelector('.vela-dw-table-scope')!.textContent).toContain('Replay · 200 loaded');
        chart.market.symbol = 'ETHUSDT';
        chart.emit('load:start');
        expect(table.hidden).toBe(true);
        expect(root.querySelector('.vela-dw-table-empty')!.textContent).toBe('Loading chart data…');
        chart.market.symbol = 'FAST';
        chart.emit('market:requested');
        expect(table.hidden).toBe(true);
        expect(root.querySelector('.vela-dw-table-identity')!.textContent).toContain('FAST');
        const other = new FakeChart();
        other.market.symbol = 'SOLUSDT';
        other.bars = other.bars.slice(0, 3);
        other.loading = true; // rebind after this chart's load:start was already emitted
        panel.onChart(other.asVela());
        expect(table.hidden).toBe(true);
        expect(root.querySelector('.vela-dw-table-identity')!.textContent).toContain('SOLUSDT');
        other.loading = false;
        other.emit('load:end');
        expect(table.hidden).toBe(false);
        expect(table.getAttribute('aria-rowcount')).toBe('4');
    });

    it('navigates the clicked virtual row or its keyboard button without breaking text selection', () => {
        const chart = new FakeChart();
        chart.renderer.supportsCandleNavigation = true;
        const { root, panel } = mount(chart);
        root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
        const scroller = root.querySelector<HTMLElement>('.vela-dw-table-scroll')!;
        scroller.scrollTop = 3200;
        scroller.dispatchEvent(new Event('scroll'));
        const row = root.querySelector<HTMLTableRowElement>('.vela-dw-table tr[data-offset="100"]')!;
        const button = row.querySelector<HTMLButtonElement>('.vela-dw-time-link')!;
        expect(button.getAttribute('aria-label')).toContain('Show candle for');
        expect(button.getAttribute('aria-label')).toContain('UTC');
        button.click(); // native button activation is also what Enter/Space produce
        expect(chart.renderer.revealTableCandle).toHaveBeenLastCalledWith(chart.bars[399]!.time, 100);
        row.cells[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(chart.renderer.revealTableCandle).toHaveBeenCalledTimes(2);
        const range = document.createRange();
        range.selectNodeContents(row.cells[2]!);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        row.cells[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(chart.renderer.revealTableCandle).toHaveBeenCalledTimes(2);
        selection.removeAllRanges();
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll'));
        const latest = root.querySelector<HTMLButtonElement>('.vela-dw-table tr[data-offset="0"] button')!;
        const pressedTime = chart.bars[499]!.time;
        latest.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, detail: 1 }));
        chart.bars.push({ ...chart.bars[499]!, time: pressedTime + 60_000 });
        chart.emit('bar');
        latest.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
        expect(chart.renderer.revealTableCandle).toHaveBeenLastCalledWith(pressedTime, 0);
        expect(chart.renderer.revealTableCandle).toHaveBeenCalledTimes(3);
        latest.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, detail: 1 }));
        chart.emit('load:start');
        chart.emit('load:end');
        latest.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }));
        expect(chart.renderer.revealTableCandle).toHaveBeenCalledTimes(3); // not a new market's replacement row
        chart.emit('load:start');
        latest.click();
        expect(chart.renderer.revealTableCandle).toHaveBeenCalledTimes(3);
        const unsupported = new FakeChart();
        panel.onChart(unsupported.asVela());
        const other = root.querySelector<HTMLTableRowElement>('.vela-dw-table tbody tr:not(.vela-dw-table-spacer)')!;
        expect(other.querySelector('.vela-dw-time-link')).toBeNull();
        other.cells[0]!.click();
        expect(unsupported.renderer.revealTableCandle).not.toHaveBeenCalled();
    });

    it('preserves seconds, milliseconds, timezone and missing-volume semantics in the fallback', () => {
        const { chart, root } = mount();
        chart.zone = 'Asia/Dhaka';
        chart.bars = [{ time: Date.UTC(2024, 0, 1, 0, 0, 1, 123), open: 1, high: 3, low: 0, close: 2 }];
        root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
        const row = root.querySelector<HTMLTableRowElement>('.vela-dw-table tbody tr:not(.vela-dw-table-spacer)')!;
        expect(row.cells[0]!.textContent).toBe('2024-01-01 06:00:01.123');
        expect(row.cells[5]!.textContent).toBe('—');
        expect(root.querySelector('.vela-dw-table-zone')!.textContent).toBe('Asia/Dhaka');
    });

});
