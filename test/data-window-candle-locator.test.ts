// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import { DARK_THEME } from '../src/core/theme';
import { CandleLocator, displayedCandleIndex } from '../src/renderers/native/chrome/CandleLocator';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

const bar = (time: number): OHLCV => ({ time, open: 1, high: 2, low: 0, close: 1 });

describe('candle location', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

    it('resolves an exact current displayed bar, tolerating stale newest-first offsets', () => {
        const bars = [bar(10), bar(20), bar(20), bar(30)];
        expect(displayedCandleIndex(bars, 20, 1)).toBe(2); // exact duplicate via the row hint
        expect(displayedCandleIndex(bars, 20, 0)).toBe(1); // stale hint: exact time, never a neighbor
        expect(displayedCandleIndex(bars, 25, 0)).toBe(-1);
        expect(displayedCandleIndex(bars, 30, 1000)).toBe(3);
        expect(displayedCandleIndex(bars, Number.NaN, 0)).toBe(-1);
        expect(displayedCandleIndex(bars.slice(0, 2), 30, 0)).toBe(-1); // unrevealed replay bar
    });

    function setup(): { locator: CandleLocator; plot: HTMLElement; coords: CoordinateSystem; bars: OHLCV[] } {
        const plot = document.createElement('div');
        const backdrop = document.createElement('canvas');
        const data = document.createElement('canvas');
        plot.append(backdrop, data);
        document.body.append(plot);
        const coords = new CoordinateSystem();
        const bars = [bar(10), bar(20), bar(30), bar(40)];
        coords.setBars(bars.map((b) => b.time));
        coords.setSize(400, 200, 1);
        coords.setViewport({ barSpacing: 20, rightOffset: 2 });
        const locator = new CandleLocator(plot, backdrop, coords, () => bars, () => DARK_THEME);
        return { locator, plot, coords, bars };
    }

    it('is below the candle layer, follows the bar, and fades away without touching highlights', () => {
        const { locator, plot } = setup();
        expect(locator.show(2, 30, false)).toBe(true);
        locator.update();
        const root = plot.querySelector<HTMLElement>('.vela-candle-locator')!;
        expect(root.previousElementSibling?.tagName).toBe('CANVAS');
        expect(root.nextElementSibling?.tagName).toBe('CANVAS');
        expect(root.getAttribute('aria-hidden')).toBe('true');
        expect(root.style.pointerEvents).toBe('none');
        expect(root.dataset.index).toBe('2');
        expect(root.dataset.visible).toBe('true');
        vi.advanceTimersByTime(100);
        const band = root.firstElementChild as HTMLElement;
        expect(band.style.opacity).toBe('1');
        vi.advanceTimersByTime(1100);
        expect(band.style.opacity).toBe('0');
        vi.advanceTimersByTime(500);
        expect(plot.querySelector('.vela-candle-locator')).toBeNull();
    });

    it('retargets a repeated click, tracks a history prepend, and cleans up a missing bar', () => {
        const { locator, plot, coords, bars } = setup();
        locator.show(1, 20, false);
        locator.update();
        vi.advanceTimersByTime(900);
        locator.show(2, 30, true);
        locator.update();
        vi.advanceTimersByTime(500); // old click's timer must not remove the new marker
        expect(plot.querySelector<HTMLElement>('.vela-candle-locator')?.dataset.timestamp).toBe('30');
        bars.unshift(bar(0));
        coords.setBars(bars.map((b) => b.time));
        expect(locator.navigationIndex()).toBe(3);
        locator.update();
        expect(plot.querySelector<HTMLElement>('.vela-candle-locator')?.dataset.index).toBe('3');
        bars.splice(3, 1);
        coords.setBars(bars.map((b) => b.time));
        expect(locator.navigationIndex()).toBeNull();
        expect(plot.querySelector('.vela-candle-locator')).toBeNull();
        vi.advanceTimersByTime(20_000);
        expect(plot.querySelector('.vela-candle-locator')).toBeNull();
    });

    it('drops an invisible marker when the user interrupts its pending navigation', () => {
        const { locator, plot } = setup();
        locator.show(0, 10, true, 120_000);
        locator.update(); // this target has not reached the center yet
        expect(plot.querySelector('.vela-candle-locator')).not.toBeNull();
        locator.cancelNavigation(true);
        expect(plot.querySelector('.vela-candle-locator')).toBeNull();
    });

    it('uses a static indication and removes it without motion when reduced motion is requested', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const { locator, plot } = setup();
        locator.show(2, 30, false);
        locator.update();
        const band = plot.querySelector<HTMLElement>('.vela-candle-locator-band')!;
        expect(band.style.transition).toBe('none');
        expect(band.style.opacity).toBe('1');
        vi.advanceTimersByTime(1150);
        expect(plot.querySelector('.vela-candle-locator')).toBeNull();
    });
});
