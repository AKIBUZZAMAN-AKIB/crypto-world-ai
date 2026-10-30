// @vitest-environment jsdom
// Only the trading pair is pinned; the whole rest of the desktop strip scrolls.
// Pixel geometry and touch gestures are checked in sync-topbar-overflow.mjs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

import { Topbar } from '../src/widget/topbar';

const mount = () => {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.appendChild(host);
    const step = vi.fn();
    const bar = new Topbar(host, {
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '60',
        timeframes: ['1', '5', '60', '240', 'D'],
        priceStyle: 'candles',
        onSymbolStep: step,
        onTimeframe: () => {},
        onPriceStyle: () => {},
        layout: {
            current: '1x1', shape: () => null, presets: () => [],
            onSelectGrid: () => {}, onSelectPreset: () => {},
            syncs: () => [], onToggleSync: () => {},
        },
    } as never);
    const strip = host.querySelector<HTMLElement>('.vela-widget-topbar')!;
    const symbol = host.querySelector<HTMLElement>('.vela-widget-symbol')!;
    // jsdom has no layout; simulate the scrollable dimensions for the wheel handlers.
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 1200 });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 500 });
    Object.defineProperty(symbol, 'offsetWidth', { configurable: true, value: 92 });
    bar.syncChrome();
    return { bar, host, strip, symbol, step };
};

describe('scrollable desktop toolbar', () => {
    beforeEach(() => document.body.replaceChildren());
    afterEach(() => document.body.replaceChildren());

    it('keeps one pair button and the entire right group in the same scrolling strip', () => {
        const { bar, strip, symbol } = mount();
        expect(strip.querySelectorAll('.vela-widget-symbol')).toHaveLength(1);
        expect(strip.contains(symbol)).toBe(true);
        expect(strip.querySelector('.vela-topbar-right')).not.toBeNull();
        expect(strip.querySelector('.vela-topbar-endpad')).toBeNull();
        expect(strip.dataset.scroll).toBe('1');
        expect(strip.style.getPropertyValue('--vela-topbar-symbol-width')).toBe('100px');
        bar.destroy();
    });

    it('wheels the bar without changing the pair', () => {
        const { bar, strip, step } = mount();
        strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        expect(strip.scrollLeft).toBe(100);
        expect(step).not.toHaveBeenCalled();
        bar.destroy();
    });

    it('wheels the pair without also scrolling the toolbar', () => {
        const { bar, strip, symbol, step } = mount();
        strip.scrollLeft = 80;
        symbol.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        expect(step).toHaveBeenCalled();
        expect(strip.scrollLeft).toBe(80);
        bar.destroy();
    });

    it('destroy removes the bar and its listeners', () => {
        const { bar, host } = mount();
        bar.destroy();
        expect(host.querySelector('.vela-widget-topbar')).toBeNull();
    });
});
