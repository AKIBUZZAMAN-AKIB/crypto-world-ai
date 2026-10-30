import { describe, expect, it, vi } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

/* eslint-disable @typescript-eslint/no-explicit-any -- inspect the renderer's retained scene */
function harness(withBars = true) {
    const renderer = new NativeRenderer();
    const r = renderer as any;
    r.coords.setSize(400, 200, 1);
    r.coords.setViewport({ barSpacing: 20, rightOffset: 1 });
    const bars: OHLCV[] = Array.from({ length: 6 }, (_, i) => ({ time: 1_700_000_000_000 + i * 60_000, open: 45, high: 55, low: 40, close: 50, volume: 1 }));
    r.bars = withBars ? bars : [];
    r.scene.bars = r.bars;
    r.coords.setBars(r.bars.map((bar: OHLCV) => bar.time));
    const pane = r.scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 200 };
    pane.scale = { min: 0, max: 100 };
    r.scheduler = { invalidate: vi.fn() };
    const event = vi.fn();
    renderer.onCrosshairMove(event);
    return { renderer, r, pane, event, x: r.coords.logicalToX(3) as number };
}

describe('crosshair coordinates and values', () => {
    it('resolves the forming bar for a linked crosshair at an instant within its interval', () => {
        const { renderer, r } = harness();
        const first = r.bars[0];
        const last = r.bars[r.bars.length - 1];
        expect(renderer.barAt(last.time + 30_000)).toEqual(last);
        expect(renderer.barAt(last.time + 60_000)).toBeNull();
        expect(renderer.barAt(first.time - 1)).toBeNull();
    });

    it('keeps a visible crosshair without inventing a price or time before data arrives', () => {
        const { r, event } = harness(false);
        r.handlePointerMove(120, 80);
        expect(r.scene.crosshair).toEqual({ x: 120, y: 80 });
        expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ time: null, price: null, ohlc: null }));
    });

    it('publishes the snapped price, not the raw finger price, when magnet is on', () => {
        const { r, pane, event, x } = harness();
        r.scene.style.crosshair.magnet = 'close';
        const snappedY = r.coords.priceToY(50, pane.scale, pane.bounds);
        r.handlePointerMove(x, snappedY + 10);
        expect(r.scene.crosshair.y).toBeCloseTo(snappedY);
        expect(event.mock.lastCall?.[0].price).toBeCloseTo(50);
    });

    it('does not snap a study pane to unrelated price-candle OHLC', () => {
        const { r, pane, event, x } = harness();
        pane.bounds = { top: 0, height: 100 };
        const study = r.scene.ensurePane('study', 'study', 1, 1);
        study.bounds = { top: 100, height: 100 };
        study.scale = { min: 0, max: 100 };
        r.scene.style.crosshair.magnet = 'close';
        const y = r.coords.priceToY(50, study.scale, study.bounds) + 6;
        r.handlePointerMove(x, y);
        expect(r.scene.crosshair.y).toBeCloseTo(y);
        expect(event.mock.lastCall?.[0].price).toBeCloseTo(r.coords.yToPrice(y, study.scale, study.bounds));
    });

    it('does not magnet-snap the line to an invisible value outside the pane', () => {
        const { r, event, x } = harness();
        r.bars[3] = { ...r.bars[3], close: 102.5 };
        r.scene.style.crosshair.magnet = 'close';
        r.handlePointerMove(x, 1);
        expect(r.scene.crosshair.y).toBe(1);
        expect(event.mock.lastCall?.[0].price).toBeCloseTo(99.5);
    });

    it('refreshes a stationary tracking readout on the first data and later changes without re-invalidating', () => {
        const { r, event } = harness(false);
        r.input = { isTracking: true };
        const bar: OHLCV = { time: 1_700_000_000_000, open: 45, high: 55, low: 40, close: 50, volume: 1 };
        // The same screen position becomes a real bar as data arrives.
        r.handlePointerMove(360, 100);
        expect(event.mock.lastCall?.[0].ohlc).toBeNull();
        r.bars = [bar];
        r.scene.bars = r.bars;
        r.coords.setBars([bar.time]);
        r.coords.setViewport({ barSpacing: 20, rightOffset: 2 });
        r.scheduler.invalidate.mockClear();
        r.refreshTrackingCrosshair();
        expect(event.mock.lastCall?.[0]).toMatchObject({ time: bar.time, ohlc: { close: 50 } });
        expect(r.scheduler.invalidate).not.toHaveBeenCalled();
        event.mockClear();
        r.refreshTrackingCrosshair();
        expect(event).not.toHaveBeenCalled(); // no redundant sync/DOM work on identical frames
        r.bars[0] = { ...bar, close: 53 };
        r.refreshTrackingCrosshair();
        expect(event.mock.lastCall?.[0].ohlc.close).toBe(53);
    });
});
