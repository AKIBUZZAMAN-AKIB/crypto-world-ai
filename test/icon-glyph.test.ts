// @vitest-environment jsdom
// `iconGlyph` — the masked-icon entry point the renderer's chrome uses. Two things it must
// never do, both learned the hard way: build a mask out of a string that is not an SVG (the
// mask then decodes to nothing and the glyph is silently invisible), and leave the caller
// guessing which form it accepts (the chrome's tool tables hold MARKUP, the kit's callers
// hold registry IDS).
import { describe, it, expect, afterEach } from 'vitest';
import { iconGlyph } from '../src/ui/icons';

const sheet = (): string => document.getElementById('vela-icon-styles')?.textContent ?? '';

afterEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
});

describe('iconGlyph', () => {
    it('takes a registry ID and paints the same mask an iconEl would', () => {
        const el = iconGlyph('gear', 14);
        expect(el.className).toBe('vela-icon vela-ic-gear');
        expect(el.childElementCount).toBe(0);
        expect(el.style.width).toBe('14px');
        expect(el.style.height).toBe('14px');
        expect(sheet()).toContain('.vela-ic-gear{');
        // The mask is a real, namespaced SVG document (luminance masking needs white ink).
        const uri = /\.vela-ic-gear\{[^}]*mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/.exec(sheet())?.[1];
        const svg = decodeURIComponent(uri ?? '');
        expect(svg).toContain('<svg xmlns=');
        expect(svg).toContain('#fff');
    });

    it('takes raw markup too — the renderer’s tool tables carry that', () => {
        const markup = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 8h12"/></svg>';
        const el = iconGlyph(markup, 18);
        expect(el.className).toBe('vela-icon');
        expect(el.style.width).toBe('18px');
        // Not in the registry → the mask rides inline on the element.
        expect(el.style.getPropertyValue('mask-image')).toContain('data:image/svg+xml');
    });

    it('a string that is neither an id nor markup paints NOTHING (never a broken mask)', () => {
        const el = iconGlyph('market-open-not-a-real-id', 12);
        expect(el.className).toBe('vela-icon');
        expect(el.childElementCount).toBe(0);
        expect(el.style.getPropertyValue('mask-image')).toBe('');
        expect(el.classList.contains('vela-ic-market-open-not-a-real-id')).toBe(false);
    });

    it('an empty string is an empty, silent span', () => {
        const el = iconGlyph('   ', 16);
        expect(el.childElementCount).toBe(0);
        expect(el.style.getPropertyValue('mask-image')).toBe('');
    });
});
