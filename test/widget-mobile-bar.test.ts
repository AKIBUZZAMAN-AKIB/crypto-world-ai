// @vitest-environment jsdom
// The mobile bar's three MIRROR stops: maximize (present only when the shell passes a
// toggle, hideable at runtime), chart type (glyph = the active price style, tap = the
// style sheet) and drawings (glyph = the armed tool, lit while armed).
import { describe, it, expect, vi } from 'vitest';
import { MobileBar, type MobileBarOptions } from '../src/widget/mobile-bar';
import { getDrawingType } from '../src/core/drawings';
import type { Vela } from '../src/Vela';

// jsdom ships no `CSS.escape`; the style injector needs it for its id lookup.
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

function mount(extra: Partial<MobileBarOptions> = {}): { bar: MobileBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bar = new MobileBar(host, {
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '60',
        onSymbolClick: () => {},
        onTimeframeClick: () => {},
        onMoreClick: () => {},
        onSettingsClick: () => {},
        ...extra,
    });
    return { bar, host };
}

/** A chart stub: only the two drawing getters the bar reads, plus the event bus. */
function fakeChart(tool: string | null, mode: string | null = null) {
    const subs = new Map<string, Set<() => void>>();
    const state = { tool, mode };
    const chart = {
        on(evt: string, cb: () => void) {
            let set = subs.get(evt);
            if (!set) subs.set(evt, (set = new Set()));
            set.add(cb);
            return () => set!.delete(cb);
        },
        drawings: {
            supported: true,
            getTool: () => state.tool,
            getMode: () => state.mode,
        },
    };
    return {
        chart: chart as unknown as Vela,
        set(next: { tool?: string | null; mode?: string | null; evt?: string }) {
            if (next.tool !== undefined) state.tool = next.tool;
            if (next.mode !== undefined) state.mode = next.mode;
            for (const cb of subs.get(next.evt ?? 'drawing:tool') ?? []) cb();
        },
        listeners: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
    };
}

const STYLES = [
    { id: 'candles', label: 'Candles', icon: '<svg data-style="candles"></svg>' },
    { id: 'line', label: 'Line', icon: '<svg data-style="line"></svg>' },
    { id: 'renko', label: 'Renko', icon: '<svg data-style="renko"></svg>' },
];

describe('MobileBar maximize stop', () => {
    it('is absent when the shell has nothing to isolate (single-chart mode)', () => {
        const { host } = mount();
        expect(host.querySelector('.vela-mb-maximize')).toBeNull();
    });

    it('is shown by default and hidden/re-shown through setMaximizeVisible', () => {
        const { bar, host } = mount({ onMaximizeClick: () => {} });
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-maximize');
        expect(stop).not.toBeNull();
        expect(stop!.hidden).toBe(false);
        bar.setMaximizeVisible(false); // the grid dropped to one cell
        expect(stop!.hidden).toBe(true);
        bar.setMaximizeVisible(true); // back to a multi-chart layout
        expect(stop!.hidden).toBe(false);
    });

    it('keeps the lit state independent of visibility', () => {
        const { bar, host } = mount({ onMaximizeClick: () => {} });
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-maximize')!;
        bar.setMaximizeActive(true);
        bar.setMaximizeVisible(false);
        expect(stop.classList.contains('vela-mb-on')).toBe(true);
        expect(stop.hidden).toBe(true);
    });
});

describe('MobileBar chart-type stop', () => {
    const build = (onStyleSelect = vi.fn()) => {
        const current = { id: 'candles' };
        const m = mount({ styleOptions: () => STYLES, currentStyle: () => current.id, onStyleSelect });
        return { ...m, current, onStyleSelect };
    };

    it('is absent without style options, and replaces the old layout-count stop', () => {
        const { host } = mount();
        expect(host.querySelector('.vela-mb-style')).toBeNull();
        expect(host.querySelector('.vela-mb-layout')).toBeNull();
    });

    it('draws the active style’s glyph and names it for assistive tech', () => {
        const { bar, host } = build();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-style')!;
        expect(stop).not.toBeNull();
        expect(stop.querySelector('.vela-mb-glyph')!.innerHTML).toContain('data-style="candles"');
        expect(stop.getAttribute('aria-label')).toBe('Chart type — Candles. Open the chart type sheet');

        bar.setPriceStyle('renko'); // the active cell changed style
        expect(stop.querySelector('.vela-mb-glyph')!.innerHTML).toContain('data-style="renko"');
        expect(stop.getAttribute('aria-label')).toContain('Renko');
    });

    it('opens the style sheet with one tile per style and applies the pick', () => {
        const { host, onStyleSelect } = build();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-style')!;
        stop.click();
        const sheet = document.body.querySelector<HTMLElement>('.vela-cts')!;
        expect(sheet).not.toBeNull();
        const tiles = sheet.querySelectorAll<HTMLButtonElement>('.vela-cts-tile');
        expect([...tiles].map((t) => t.dataset.id)).toEqual(['candles', 'line', 'renko']);
        expect(tiles[0]!.dataset.on).toBe('1'); // the current style is the lit tile
        expect(stop.getAttribute('aria-expanded')).toBe('true');

        tiles[2]!.click();
        expect(onStyleSelect).toHaveBeenCalledWith('renko');
        expect(document.body.querySelector('.vela-cts')).toBeNull();
        expect(stop.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes again when the stop itself is tapped a second time', () => {
        const { host } = build();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-style')!;
        stop.click();
        expect(document.body.querySelector('.vela-cts')).not.toBeNull();
        stop.click(); // same stop = the sheet's own toggle
        expect(document.body.querySelector('.vela-cts')).toBeNull();
    });

    it('offers the layout door as one row inside the sheet, not as a bar stop', () => {
        const opened = vi.fn();
        const { host } = mount({
            styleOptions: () => STYLES,
            currentStyle: () => 'line',
            onStyleSelect: () => {},
            layoutLabel: () => '2×2',
            onLayoutClick: opened,
        });
        host.querySelector<HTMLButtonElement>('.vela-mb-style')!.click();
        const row = document.body.querySelector<HTMLButtonElement>('.vela-cts-layout')!;
        expect(row).not.toBeNull();
        expect(row.textContent).toContain('2×2');
        row.click();
        expect(opened).toHaveBeenCalledTimes(1);
    });
});

describe('MobileBar drawings stop', () => {
    const mountWithDrawings = () => mount({ onDrawingsClick: () => {} });

    it('shows the plain pencil when nothing is armed', () => {
        const { bar, host } = mountWithDrawings();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-drawings')!;
        expect(stop.querySelector('.vela-mb-glyph')!.innerHTML).toBeTruthy();
        expect(stop.classList.contains('vela-mb-armed')).toBe(false);
        expect(stop.getAttribute('aria-label')).toBe('Drawings');
        bar.onChart(fakeChart(null).chart);
        expect(stop.getAttribute('aria-label')).toBe('Drawings');
    });

    it('mirrors the armed tool and follows every arming path (event bus)', () => {
        const { bar, host } = mountWithDrawings();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-drawings')!;
        const fake = fakeChart('trendline');
        bar.onChart(fake.chart);

        expect(stop.classList.contains('vela-mb-armed')).toBe(true);
        expect(stop.getAttribute('aria-label')).toBe(`Drawing — ${getDrawingType('trendline')!.label}. Open drawing tools`);
        expect(getDrawingType('trendline')!.icon).toContain('x1="4" y1="19"');
        expect(stop.querySelector('.vela-mb-glyph')!.innerHTML).toContain('x1="4" y1="19"');

        fake.set({ tool: 'hline', evt: 'drawing:tool' }); // armed from the drawer / keyboard
        expect(getDrawingType('hline')!.icon).toContain('y1="12"');
        expect(stop.querySelector('.vela-mb-glyph')!.innerHTML).toContain('y1="12"');

        fake.set({ tool: null, evt: 'drawing:tool' }); // disarmed
        expect(stop.classList.contains('vela-mb-armed')).toBe(false);
        expect(stop.getAttribute('aria-label')).toBe('Drawings');
    });

    it('shows the eraser glyph while the eraser MODE is on, which is not a tool', () => {
        const { bar, host } = mountWithDrawings();
        const stop = host.querySelector<HTMLButtonElement>('.vela-mb-drawings')!;
        const fake = fakeChart(null, 'eraser');
        bar.onChart(fake.chart);
        expect(stop.classList.contains('vela-mb-armed')).toBe(true);
        expect(stop.getAttribute('aria-label')).toContain('Eraser');

        fake.set({ mode: null, evt: 'drawing:mode' });
        expect(stop.classList.contains('vela-mb-armed')).toBe(false);
    });

    it('drops the previous chart’s subscriptions when the active cell changes', () => {
        const { bar } = mountWithDrawings();
        const first = fakeChart('trendline');
        const second = fakeChart(null);
        bar.onChart(first.chart);
        expect(first.listeners()).toBe(2);
        bar.onChart(second.chart);
        expect(first.listeners()).toBe(0); // no ghost updates from the old cell
        expect(second.listeners()).toBe(2);
    });
});
