// @vitest-environment jsdom
// The phone bar's ANATOMY (R54): three zones — a fixed pair on the left, a fixed
// More/Settings pair on the right, and ONE scrollable band of tools between them. The
// point of the test is the thing the old bar got wrong: the pair and the two doors out
// of the bar must never live inside the scroller, whatever the shell composes.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { MobileBar } from '../src/widget/mobile-bar';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: MobileBar[] = [];
afterEach(() => {
    for (const bar of live.splice(0)) bar.destroy();
    document.body.replaceChildren();
});

function mount(over: Record<string, unknown> = {}): MobileBar {
    const host = document.createElement('div');
    document.body.append(host);
    const bar = new MobileBar(host, {
        symbol: 'BTCUSDT',
        timeframe: '60',
        onSymbolClick: () => undefined,
        onTimeframeClick: () => undefined,
        onIndicatorsClick: () => undefined,
        onDrawingsClick: () => undefined,
        onEditorClick: () => undefined,
        onMaximizeClick: () => undefined,
        styleOptions: () => [{ id: 'candles', label: 'Candles', icon: '' }],
        currentStyle: () => 'candles',
        onStyleSelect: () => undefined,
        onMoreClick: () => undefined,
        onSettingsClick: () => undefined,
        ...over,
    } as never);
    live.push(bar);
    return bar;
}

const kids = (el: Element | null): HTMLElement[] => (el ? ([...el.children] as HTMLElement[]) : []);
/** A stop's own class with the shared `vela-mb-item` (and the lead item) stripped. */
const name = (el: HTMLElement): string => el.className.replace(/\bvela-mb-item\b/g, '').replace(/^vela-(symbol|rule|scroll|trail)$/, 'vela-$1').trim().replace(/\s+/g, ' ');

describe('the phone bar is three zones', () => {
    it('is a toolbar: pair · rule · band · rule · trail', () => {
        const bar = mount();
        expect(bar.el.getAttribute('role')).toBe('toolbar');
        const zones = kids(bar.el).map(name);
        expect(zones).toEqual(['vela-mb-symbol', 'vela-mb-rule', 'vela-mb-scroll', 'vela-mb-rule', 'vela-mb-trail']);
    });

    it('the pair and the two doors are OUTSIDE the scrolling band', () => {
        const bar = mount();
        const band = bar.el.querySelector('.vela-mb-scroll')!;
        expect(band.contains(bar.el.querySelector('.vela-mb-symbol'))).toBe(false);
        expect(band.contains(bar.el.querySelector('.vela-mb-more'))).toBe(false);
        expect(band.contains(bar.el.querySelector('.vela-mb-settings'))).toBe(false);
        const trail = bar.el.querySelector('.vela-mb-trail')!;
        expect(kids(trail).map((el) => el.className.trim())).toEqual(['vela-mb-item vela-mb-more', 'vela-mb-item vela-mb-settings']);
    });

    it('the band holds the tools in reading order, and only the tools', () => {
        const bar = mount();
        const band = bar.el.querySelector('.vela-mb-scroll')!;
        const order = kids(band).map(name);
        expect(order).toEqual(['vela-mb-tf', 'vela-mb-style', 'vela-mb-drawings', 'vela-mb-maximize', 'vela-mb-indicators', 'vela-mb-editor', 'vela-mb-actions']);
    });

    it('a shell without a stop simply has a shorter band — nothing else moves', () => {
        const bar = mount({ onEditorClick: undefined, onMaximizeClick: undefined, onDrawingsClick: undefined });
        const band = bar.el.querySelector('.vela-mb-scroll')!;
        expect(kids(band).map(name)).toEqual(['vela-mb-tf', 'vela-mb-style', 'vela-mb-indicators', 'vela-mb-actions']);
        expect(bar.el.querySelector('.vela-mb-symbol')).not.toBeNull();
        expect(bar.el.querySelector('.vela-mb-more')).not.toBeNull();
        expect(bar.el.querySelector('.vela-mb-settings')).not.toBeNull();
    });

    it('the maximize stop is never hidden for being narrow — it scrolls instead', () => {
        const bar = mount();
        expect(bar.el.querySelector<HTMLElement>('.vela-mb-maximize')!.hidden).toBe(false);
        bar.setMaximizeVisible(false); // …but an inapplicable one (one pane) may go
        expect(bar.el.querySelector<HTMLElement>('.vela-mb-maximize')!.hidden).toBe(true);
    });
});

describe('the More stop carries the hidden-chart count', () => {
    it('shows the count, names it for a screen reader, and clears at zero', () => {
        const bar = mount();
        const more = bar.el.querySelector<HTMLElement>('.vela-mb-more')!;
        const badge = more.querySelector<HTMLElement>('.vela-mb-badge')!;
        expect(badge.hidden).toBe(true);
        expect(more.getAttribute('aria-label')).toBe('More');

        bar.setHiddenCount(3);
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBe('3');
        expect(more.getAttribute('aria-label')).toBe('More — 3 hidden charts');

        bar.setHiddenCount(1);
        expect(more.getAttribute('aria-label')).toBe('More — 1 hidden chart');
        bar.setHiddenCount(140);
        expect(badge.textContent).toBe('99+');

        bar.setHiddenCount(0);
        expect(badge.hidden).toBe(true);
        expect(more.getAttribute('aria-label')).toBe('More');
    });
});

describe('the pair is a title, not a stop', () => {
    it('renders the ticker with its disclosure chevron and an actionable label', () => {
        const bar = mount();
        const symbol = bar.el.querySelector<HTMLElement>('.vela-mb-symbol')!;
        expect(symbol.querySelector('.vela-mb-symbol-text')?.textContent).toBe('BTCUSDT');
        expect(symbol.querySelector('.vela-icon')).not.toBeNull();
        expect(symbol.getAttribute('aria-label')).toContain('BTCUSDT');
        bar.setSymbol('EXCHANGE:ETHUSDT');
        expect(symbol.querySelector('.vela-mb-symbol-text')?.textContent).toBe('ETHUSDT');
    });
});
