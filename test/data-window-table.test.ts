// Bounded historical table contract: exact alignment, surface visibility, formatting,
// timezone and replay-safe replacement. Runtime scrolling is exercised in Chromium.
import { describe, it, expect, vi } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { RendererControl } from '../src/core/RendererControl';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

function make(): { r: NativeRenderer; internal: any; bars: OHLCV[] } {
    const r = new NativeRenderer();
    const internal = r as any;
    internal.coords.setSize(800, 200, 1);
    internal.scheduler ??= { invalidate() {} };
    internal.animator ??= { active: false, start() {}, stop() {} };
    internal.introPlayed = true;
    const bars = Array.from({ length: 5 }, (_, i) => ({
        time: Date.UTC(2024, 0, 1, 0, 0, i, 123), open: 100 + i, high: 103 + i,
        low: 99 + i, close: 102 + i, ...(i === 0 ? {} : { volume: 1234.56789 + i }),
    }));
    r.setBars(bars);
    return { r, internal, bars };
}

describe('historical Data Window slices', () => {
    it('returns bounded newest-first rows independently of the crosshair', () => {
        const { r, internal, bars } = make();
        internal.hoverLogical = 0;
        const first = r.getDataWindowTable(0, 2);
        expect(first.total).toBe(5);
        expect(first.rows.map((row) => row.timestamp)).toEqual([bars[4]!.time, bars[3]!.time]);
        expect(Number(first.rows[0]!.ohlc.c)).toBe(106);
        expect(first.rows[0]!.volume).toBe(String(bars[4]!.volume));
        const rest = r.getDataWindowTable(2, 1000);
        expect(rest.rows.map((row) => row.timestamp)).toEqual([bars[2]!.time, bars[1]!.time, bars[0]!.time]);
        expect(rest.rows[rest.rows.length - 1]!.volume).toBeNull();
        expect(r.getDataWindowTable(50, 2).rows).toEqual([]);
        expect(r.getDataWindowTable(-5, 0).rows).toEqual([]);
    });

    it('retains seconds and milliseconds in the chart timezone, including DST', () => {
        const { r, internal, bars } = make();
        internal.scene.timezone = 'Asia/Dhaka';
        expect(r.getDataWindowTable(0, 1).rows[0]).toMatchObject({ date: '2024-01-01', time: '06:00:04.123' });
        internal.scene.timezone = 'America/New_York';
        expect(r.getDataWindowTable(0, 1).rows[0]).toMatchObject({ date: '2023-12-31', time: '19:00:04.123' });
        r.setBars([{ ...bars[0]!, time: Date.UTC(2024, 6, 1, 12, 34, 56, 789) }]);
        expect(r.getDataWindowTable(0, 1).rows[0]).toMatchObject({ date: '2024-07-01', time: '08:34:56.789' });
    });

    it('keeps full candle precision even when a compact or zoomed-out axis rounds the readout', () => {
        const { r, internal, bars } = make();
        r.setBars([{ ...bars[0]!, open: 68000.1234567, high: 69000.3456789, low: 67000.5678912, close: 68427.3123456 }]);
        const pane = internal.scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 200 };
        pane.scale = { min: 67000, max: 69000 };
        internal.scene.priceMintick = 0.01;
        internal.axisLabelsCompact = true;
        const table = r.getDataWindowTable(0, 1).rows[0]!;
        expect(table.ohlc.o).toBe('68000.1234567');
        expect(table.ohlc.h).toBe('69000.3456789');
        expect(table.ohlc.l).toBe('67000.5678912');
        expect(table.ohlc.c).toBe('68427.3123456');
        expect(r.getDataWindowReadout().ohlc?.c).toBe('68427.31');
    });

    it('aligns only visible scalar plots, keeps gaps empty and honours suffix anchors', () => {
        const { r, internal, bars } = make();
        const line = (id: string, values: Array<number | null>, display?: object): object => ({
            id, title: id, kind: 'line', paneId: 'price', display,
            points: values.map((value, i) => ({ time: bars[i]!.time, value })),
            style: { color: '#333', width: 1, lineStyle: 'solid' },
        });
        internal.scene.indicators.set('ma', {
            id: 'ma', title: 'Study', paneId: 'price',
            series: [line('shown', [10, null, 30]), line('not-in-window', [40, 50, 60], { dataWindow: false })],
        });
        internal.scene.setAnchorOffset('ma', 2);
        const result = r.getDataWindowTable(0, 5);
        expect(result.columns.map((column) => column.label)).toEqual(['Study · shown']);
        expect(result.rows.map((row) => row.values[0] == null ? null : Number(row.values[0]))).toEqual([30, null, 10, null, null]);
        internal.scene.indicators.delete('ma'); // the hidden indicator is absent from the scene
        expect(r.getDataWindowTable(0, 1).columns).toEqual([]);
    });

    it('follows series replacement and never exposes bars beyond a replay cut', () => {
        const { r, bars } = make();
        r.setBars(bars.slice(0, 3));
        const cut = r.getDataWindowTable(0, 500);
        expect(cut.total).toBe(3);
        expect(cut.rows[0]!.timestamp).toBe(bars[2]!.time);
        expect(cut.rows.every((row) => row.timestamp <= bars[2]!.time)).toBe(true);
        r.setBars(bars);
        expect(r.getDataWindowTable(0, 1).rows[0]!.timestamp).toBe(bars[4]!.time);
    });

    it('reveals a loaded candle at constant zoom and leaves existing highlight bands alone', () => {
        const { r, internal, bars } = make();
        internal.coords.setSize(180, 200, 1);
        internal.coords.setViewport({ barSpacing: 20, rightOffset: 0 });
        internal.animScroll.set(0);
        const locator = { show: vi.fn(() => true), update: vi.fn(), cancelNavigation: vi.fn() };
        internal.candleLocator = locator;
        const highlights = [{ from: bars[0]!.time, to: bars[2]!.time, color: 'rgba(1,2,3,0.2)' }];
        internal.scene.highlights = highlights;
        expect(r.revealTableCandle(bars[1]!.time, 3)).toBe(true);
        expect(internal.coords.getViewport().barSpacing).toBe(20);
        expect(internal.coords.logicalToX(1)).toBeCloseTo(90);
        expect(locator.show).toHaveBeenCalledWith(1, bars[1]!.time, false, 5000);
        expect(internal.scene.highlights).toBe(highlights);
        expect(r.revealTableCandle(bars[4]!.time + 5000, 0)).toBe(false);
        expect(locator.show).toHaveBeenCalledTimes(1);
    });

    it('centers a candle when the initial zoom is temporarily outside resize limits', () => {
        const { r, internal, bars } = make();
        internal.coords.setSize(326, 200, 1);
        internal.coords.setViewport({ barSpacing: 8, rightOffset: 10 });
        internal.animScroll.set(0);
        internal.candleLocator = { show: vi.fn(() => true), update: vi.fn(), cancelNavigation: vi.fn() };
        expect(r.revealTableCandle(bars[0]!.time, 4)).toBe(true);
        expect(internal.coords.getViewport().barSpacing).toBeCloseTo(326 / 11);
        expect(internal.coords.logicalToX(0)).toBeCloseTo(163);
    });

    it('recalculates an in-flight target using spacing clamped after a resize', () => {
        const { internal } = make();
        internal.coords.setSize(326, 200, 1);
        internal.coords.setViewport({ barSpacing: 8, rightOffset: 10 });
        internal.targetBarSpacing = 8;
        internal.scrollTargetRO = 10;
        internal.candleLocator = { navigating: true, navigationIndex: () => 0, cancelNavigation: vi.fn() };
        for (const key of ['computeScales', 'paintData', 'refreshTrackingCrosshair', 'renderCrosshairLayer', 'updateLegendValues', 'notifyDataWindowFrameChange', 'emitViewportChange']) internal[key] = vi.fn();
        internal.easeScales = () => false;
        internal.easeLiveBar = () => false;
        internal.animTick(64);
        expect(internal.coords.getViewport().barSpacing).toBeCloseTo(326 / 11);
        expect(internal.scrollTargetRO).toBeCloseTo(1.5);
    });

    it('degrades gracefully when a third-party renderer has no history or navigation seam', () => {
        const control = new RendererControl({} as unknown as IChartRenderer);
        expect(control.dataWindowTable(0, 10)).toBeNull();
        expect(control.supportsCandleNavigation).toBe(false);
        expect(control.revealTableCandle(123, 2)).toBe(false);
        const result = { total: 0, columns: [], rows: [] };
        const reveal = vi.fn(() => true);
        const supported = new RendererControl({ getDataWindowTable: () => result, revealTableCandle: reveal } as unknown as IChartRenderer);
        expect(supported.dataWindowTable(3, 10)).toBe(result);
        expect(supported.supportsCandleNavigation).toBe(true);
        expect(supported.revealTableCandle(123, 2)).toBe(true);
        expect(reveal).toHaveBeenCalledWith(123, 2);
    });
});
