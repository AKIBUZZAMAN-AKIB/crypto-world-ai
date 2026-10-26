// @vitest-environment jsdom
// The strip's END ROOM (src/widget/topbar.ts — `syncOverflow`). The bar pins two clusters
// with `position: sticky`, so content that slides under them is painted over and cannot be
// clicked: the scroll range has to END before the pinned cluster, not at it. That is what
// the `.vela-topbar-endpad` spacer is for. Widths are zero in jsdom, so this pins the
// STRUCTURE and the rest state; the real widths are measured in the browser probe
// (test/browser/sync-topbar-overflow.mjs — "at full scroll the last tool is clear").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

const mount = (): { bar: Topbar; host: HTMLElement } => {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.appendChild(host);
    const bar = new Topbar(host, {
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '60',
        timeframes: ['1', '5', '60', '240', 'D'],
        priceStyle: 'candles',
        onTimeframe: () => {},
        onPriceStyle: () => {},
        layout: {
            current: '1x1',
            shape: () => null,
            presets: () => [],
            onSelectGrid: () => {},
            onSelectPreset: () => {},
            syncs: () => [],
            onToggleSync: () => {},
        },
    } as never);
    return { bar, host };
};

describe('the strip reserves its end', () => {
    beforeEach(() => document.body.replaceChildren());
    afterEach(() => document.body.replaceChildren());

    it('the spacer sits between the last middle tool and the pinned cluster', () => {
        const { bar } = mount();
        const strip = document.querySelector('.vela-widget-topbar')!;
        const spacer = strip.querySelector<HTMLElement>('.vela-topbar-endpad');
        const right = strip.querySelector<HTMLElement>('.vela-topbar-right');
        expect(spacer).not.toBeNull();
        expect(right).not.toBeNull();
        // …immediately before the cluster: the room is BETWEEN the two, which is what makes
        // the last middle tool able to scroll clear of the pinned tools.
        expect(right!.previousElementSibling).toBe(spacer);
        expect(spacer!.parentElement).toBe(strip);
        bar.destroy();
    });

    it('a spacer is not a control: no focus stop, no name, nothing to press', () => {
        const { bar } = mount();
        const spacer = document.querySelector<HTMLElement>('.vela-topbar-endpad')!;
        expect(spacer.tagName).toBe('SPAN');
        expect(spacer.hasAttribute('tabindex')).toBe(false);
        expect(spacer.hasAttribute('role')).toBe(false);
        expect(spacer.getAttribute('aria-hidden')).toBe('true');
        // A button a user Tab-ed onto must never land here.
        expect(spacer.querySelector('button, a, input')).toBeNull();
        bar.destroy();
    });

    it('at rest (nothing overflows) the room is zero — no gap in a wide bar', () => {
        const { bar } = mount();
        const spacer = document.querySelector<HTMLElement>('.vela-topbar-endpad')!;
        const strip = document.querySelector<HTMLElement>('.vela-widget-topbar')!;
        // Nothing is written when the room is already zero (`''` = untouched = 0).
        expect(['', '0', '0px']).toContain(spacer.style.width);
        expect(spacer.getBoundingClientRect().width).toBe(0);
        expect(strip.dataset.scroll).toBe('0');
        // The published width is what `scroll-margin-inline-end` consumes; zero at rest.
        expect(['', '0px']).toContain(strip.style.getPropertyValue('--vela-topbar-pin-end'));
        bar.destroy();
    });

    it('destroy takes the spacer with the bar', () => {
        const { bar, host } = mount();
        bar.destroy();
        expect(host.querySelector('.vela-topbar-endpad')).toBeNull();
        expect(document.querySelector('.vela-widget-topbar')).toBeNull();
    });
});
