// @vitest-environment jsdom
// EVERY registered icon must survive the trip from "inline markup" to "CSS mask".
//
// The registry writes icons the way HTML likes them: `svg16(body, extra)` puts the icon's
// own root attributes BEFORE the tier defaults, so `fill="currentColor"` beats `fill="none"`
// (HTML keeps the first of a duplicate). A mask is not HTML, though — it is an XML document
// loaded through an <image>, where a repeated attribute is a fatal parse error. The image
// then fails to decode and the glyph is simply not there: the kebab's three dots, the code
// chevrons and a dozen others went blank exactly this way.
import { describe, it, expect } from 'vitest';
import { iconIds, iconMarkup } from '../src/core/icons';
import { dedupeSvgAttrs, iconGlyph } from '../src/ui/icons';

/** The mask a glyph ends up wearing, decoded back to markup. */
function maskMarkupFor(id: string): string {
    const el = iconGlyph(id, 16, document);
    if (el.style.maskImage) {
        const m = /url\("?data:image\/svg\+xml,([^")]+)"?\)/.exec(el.style.maskImage);
        return m ? decodeURIComponent(m[1]!) : '';
    }
    const rule = [...document.querySelectorAll('style#vela-icon-styles')].map((s) => s.textContent ?? '').join('');
    const m = new RegExp(`\\.vela-ic-${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`).exec(rule);
    const uri = m ? /data:image\/svg\+xml,([^")]+)/.exec(m[0]) : null;
    return uri ? decodeURIComponent(uri[1]!) : '';
}

const ATTR = /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
function duplicateAttrs(tag: string): string[] {
    const open = /^<([\w:-]+)([\s\S]*?)(\/?)>$/.exec(tag);
    if (!open) return [];
    const seen = new Set<string>();
    const dupes: string[] = [];
    let m: RegExpExecArray | null;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(open[2] ?? '')) !== null) {
        const key = (m[1] ?? '').toLowerCase();
        if (seen.has(key)) dupes.push(key);
        seen.add(key);
    }
    return dupes;
}

describe('every icon decodes as a mask', () => {
    it('the registry is not empty (so a green result means something)', () => {
        expect(iconIds().length).toBeGreaterThan(50);
    });

    it('no icon’s mask repeats an attribute — the kebab/code class of bug', () => {
        const broken: string[] = [];
        for (const id of iconIds()) {
            const svg = maskMarkupFor(id);
            if (!svg) {
                broken.push(`${id}: no mask`);
                continue;
            }
            for (const tag of svg.match(/<[^>]+>/g) ?? []) {
                const dupes = duplicateAttrs(tag);
                if (dupes.length) broken.push(`${id}: ${tag.slice(0, 60)} → ${dupes.join(',')}`);
            }
        }
        expect(broken).toEqual([]);
    });

    it('and parses as XML (which is how a mask is loaded, not how inline SVG is)', () => {
        const broken: string[] = [];
        for (const id of iconIds()) {
            const svg = maskMarkupFor(id);
            if (!svg) continue;
            const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            const err = doc.querySelector('parsererror');
            if (err || doc.documentElement.nodeName.toLowerCase() !== 'svg') broken.push(`${id}: ${(err?.textContent ?? doc.documentElement.nodeName).slice(0, 90)}`);
        }
        expect(broken).toEqual([]);
    });

    it('dedupe keeps the FIRST copy — the one HTML would have kept', () => {
        expect(dedupeSvgAttrs('<svg fill="#fff" stroke="none" fill="none" stroke="#fff">')).toBe('<svg fill="#fff" stroke="none">');
        expect(dedupeSvgAttrs('<circle cx="8" cy="8" r="1.2"/>')).toBe('<circle cx="8" cy="8" r="1.2"/>');
        expect(dedupeSvgAttrs('</svg>')).toBe('</svg>');
    });

    it('an icon that overrides a tier default keeps its override (kebab stays a FILLED dot)', () => {
        const markup = iconMarkup('kebab')!;
        expect(markup).toContain('fill="currentColor"');
        const svg = maskMarkupFor('kebab');
        expect(svg).toMatch(/<svg[^>]*fill="#fff"/);
        expect(svg).not.toMatch(/fill="none"/); // the override survived, the default was dropped
    });
});
