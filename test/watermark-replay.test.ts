// @vitest-environment jsdom
// The watermark's "Replay" line: shown only while replaying, under its own toggle,
// independent of the symbol line's toggle.
import { describe, it, expect } from 'vitest';
import { Watermark } from '../src/widget/watermark';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

function make() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wm = new Watermark(host, 'BTCUSDT', '60');
    wm.setLoading(false);
    // The replay line is built by the first replay that shows it (R70) — so it is looked up
    // on demand, never at construction.
    const line = (): HTMLElement => wm.el.querySelector<HTMLElement>('.vela-watermark-replay')!;
    const symbol = wm.el.firstElementChild as HTMLElement;
    const shown = (): boolean => wm.el.style.display !== 'none';
    return { wm, line, symbol, shown };
}

describe('Watermark replay line', () => {
    it('shows "Replay" under the symbol line only while replaying', () => {
        const { wm, line, symbol, shown } = make();
        expect(symbol.textContent).toBe('BTCUSDT · 1h');
        expect(wm.el.querySelector('.vela-watermark-replay')).toBeNull(); // nothing until a replay
        wm.setReplaying(true);
        expect(line().textContent).toBe('Replay');
        // The glyph is a CSS mask (see src/ui/icons.ts): the icon element exists and carries
        // its icon class, and it owns no shapes.
        const glyph = line().querySelector('.vela-icon');
        expect(glyph).not.toBeNull();
        expect(glyph!.classList.contains('vela-ic-replay')).toBe(true);
        expect(glyph!.childElementCount).toBe(0);
        expect(line().hidden).toBe(false);
        expect(shown()).toBe(true);
        wm.setReplaying(false);
        expect(line().hidden).toBe(true);
    });

    it('its toggle hides it, and it stands alone when the symbol line is off', () => {
        const { wm, line, symbol, shown } = make();
        wm.setReplaying(true);
        wm.setReplayVisible(false);
        expect(line().hidden).toBe(true);
        wm.setReplayVisible(true);
        wm.setVisible(false);
        expect(symbol.hidden).toBe(true);
        expect(line().hidden).toBe(false);
        expect(shown()).toBe(true);
        wm.setReplaying(false);
        expect(shown()).toBe(false); // nothing left to show
    });
});
