// @vitest-environment jsdom
// The status line re-walks its width ladder only when the readout's width can change:
// a crosshair move that changes digits alone rewrites the values in place, unmeasured.
import { describe, it, expect, vi } from 'vitest';
import { Statusline } from '../src/widget/statusline';
import type { Vela } from '../src/Vela';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

interface Bar {
    open: number;
    high: number;
    low: number;
    close: number;
}

function make() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const line = new Statusline(host, 'BINANCE:BTCUSDT');
    let move: (e: { ohlc: Bar | null }) => void = () => {};
    const chart = {
        on: () => () => {},
        renderer: {
            onCrosshairMove: (cb: typeof move) => {
                move = cb;
                return () => {};
            },
        },
        replay: { state: { active: false } },
    } as unknown as Vela;
    line.onChart(chart);
    // Every fit() reads the chip's scrollWidth — count the reads (jsdom never overflows).
    let measures = 0;
    Object.defineProperty(line.el, 'scrollWidth', {
        get: () => {
            measures++;
            return 0;
        },
    });
    const close = () => line.el.querySelectorAll('.vela-sl-ohlc b')[3]?.textContent;
    return { line, hover: (ohlc: Bar | null) => move({ ohlc }), measures: () => measures, close };
}

describe('Statusline market loading', () => {
    it('clears the previous market OHLC while new data loads and restores the new bar', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const line = new Statusline(host, 'BTCUSDT');
        const handlers = new Map<string, (payload: unknown) => void>();
        const current = { time: 2000, open: 20, high: 23, low: 19, close: 22 };
        const barAt = vi.fn(() => current);
        const chart = {
            on: (name: string, cb: (payload: unknown) => void) => { handlers.set(name, cb); return () => {}; },
            getVisibleRange: () => ({ from: 1000, to: 2000 }),
            renderer: { onCrosshairMove: () => () => {}, barAt },
            replay: { state: { active: false } },
        } as unknown as Vela;
        line.onChart(chart);
        const old = { time: 1000, open: 10, high: 12, low: 9, close: 11 };
        handlers.get('bar')?.(old);
        line.setSyncedCrosshair(old);
        expect(line.el.querySelector('.vela-sl-ohlc')?.textContent).not.toBe('');
        handlers.get('load:start')?.({ symbol: 'NEW', timeframe: '60', firstLoad: false });
        expect(line.el.querySelector('.vela-sl-ohlc')?.textContent).toBe('');
        handlers.get('load:end')?.({ bars: 1 });
        expect(barAt).toHaveBeenCalledWith(2000); // range.to is an inclusive bar time
        expect(line.el.querySelectorAll('.vela-sl-ohlc b')[3]?.textContent).toBe('22.00');
        line.destroy();
    });
});

describe('Statusline fit — the phone rungs', () => {
    // A chip that only fits once the bar delta has left the values row: the measured
    // shape of a 360–430px phone, where four O/H/L/C values plus a delta do not fit on
    // one row but the values alone do.
    it('keeps all four values and moves the delta onto the symbol line', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const line = new Statusline(host, 'BINANCE:BTCUSDT');
        const chart = {
            on: () => () => {},
            renderer: { onCrosshairMove: (cb: (e: { ohlc: Bar | null }) => void) => { move = cb; return () => {}; } },
            replay: { state: { active: false } },
        } as unknown as Vela;
        let move: (e: { ohlc: Bar | null }) => void = () => {};
        line.onChart(chart);
        // Overflow while the delta shares the values row; it fits the moment it rides up.
        Object.defineProperty(line.el, 'clientWidth', { get: () => 320 });
        Object.defineProperty(line.el, 'scrollWidth', {
            get: () => (line.el.querySelector('.vela-sl-identity .vela-sl-change') ? 300 : 520),
        });
        move({ ohlc: { open: 80300.5, high: 80500.25, low: 80100, close: 80478.75 } });
        expect(line.el.classList.contains('vela-sl-stacked')).toBe(true);
        expect(line.el.querySelectorAll('.vela-sl-ohlc b')).toHaveLength(4);
        expect(line.el.querySelector('.vela-sl-identity .vela-sl-change')).not.toBeNull();
        expect(line.el.querySelector('.vela-sl-values .vela-sl-change')).toBeNull();
        line.destroy();
    });

    it('drops the delta back to the values row when the chip measures enough room', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const line = new Statusline(host, 'BINANCE:BTCUSDT');
        let move: (e: { ohlc: Bar | null }) => void = () => {};
        const chart = {
            on: () => () => {},
            renderer: { onCrosshairMove: (cb: typeof move) => { move = cb; return () => {}; } },
            replay: { state: { active: false } },
        } as unknown as Vela;
        line.onChart(chart);
        // The measured width shrinks after the first fit: a resize (or a shorter readout)
        // gives the chip room, and the ladder must walk back UP to the widest rung.
        let width = 520;
        Object.defineProperty(line.el, 'clientWidth', { get: () => 320 });
        Object.defineProperty(line.el, 'scrollWidth', { get: () => width });
        move({ ohlc: { open: 80300.5, high: 80500.25, low: 80100, close: 80478.75 } });
        width = 300;
        move({ ohlc: { open: 80300.5, high: 80500.25, low: 80100, close: 80479.75 } });
        expect(line.el.querySelector('.vela-sl-values .vela-sl-change')).not.toBeNull();
        line.destroy();
    });
});

describe('Statusline fit', () => {
    it('rewrites a digits-only change in place, without measuring', () => {
        const { line, hover, measures, close } = make();
        hover({ open: 61234.5, high: 61300.25, low: 61200, close: 61250.75 });
        const after = measures();
        hover({ open: 61987.5, high: 62010.25, low: 61900, close: 62003.75 });
        hover({ open: 61111.5, high: 61199.25, low: 61100, close: 61188.75 });
        expect(measures()).toBe(after);
        expect(close()).toBe('61,188.75');
        line.destroy();
    });

    it('re-fits when a value gains a digit', () => {
        const { line, hover, measures, close } = make();
        hover({ open: 9.5, high: 9.99, low: 9.4, close: 9.9 });
        const after = measures();
        hover({ open: 9.5, high: 10.25, low: 9.4, close: 10.1 });
        expect(measures()).toBeGreaterThan(after);
        expect(close()).toBe('10.10');
        line.destroy();
    });

    it('re-fits when the change flips sign', () => {
        const { line, hover, measures } = make();
        hover({ open: 100, high: 101, low: 99, close: 100.5 });
        const after = measures();
        hover({ open: 100, high: 101, low: 99, close: 99.5 });
        expect(measures()).toBeGreaterThan(after);
        line.destroy();
    });

    it('re-fits when the price style changes the readout shape', () => {
        const { line, hover, measures } = make();
        hover({ open: 100, high: 101, low: 99, close: 100.5 });
        const after = measures();
        line.setDirectionColors(null, null, null, 'value');
        expect(measures()).toBeGreaterThan(after);
        expect(line.el.querySelectorAll('.vela-sl-ohlc b')).toHaveLength(1);
        line.destroy();
    });

    it('sets the values in tabular figures, so digits alone never move the width', () => {
        make().line.destroy();
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
        expect(css).toMatch(/\.vela-statusline \.vela-sl-values \{[^}]*font-variant-numeric: tabular-nums/);
    });
});
