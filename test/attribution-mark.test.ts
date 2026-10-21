import { describe, expect, it } from 'vitest';
import { attributionMarkColor, createAttributionMark, createCustomMark } from '../src/renderers/native/chrome/AttributionMark';

/** The DOM subset the mark builders touch — tests run in a plain node environment. */
function stubDocument(): Document {
    const makeEl = (): Record<string, unknown> => ({
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        style: { setProperty: () => undefined },
        dataset: {},
        setAttribute: () => undefined,
        children: [] as unknown[],
        append(...nodes: unknown[]) {
            (this.children as unknown[]).push(...nodes);
        },
        appendChild: () => undefined,
    });
    return {
        getElementById: () => null,
        createElement: () => makeEl(),
        head: { appendChild: () => undefined },
    } as unknown as Document;
}

describe('attributionMarkColor', () => {
    it('is white on dark chart backgrounds', () => {
        expect(attributionMarkColor('#151619')).toBe('#ffffff');
        expect(attributionMarkColor('#000000')).toBe('#ffffff');
        expect(attributionMarkColor('rgb(30, 32, 38)')).toBe('#ffffff');
    });

    it('is black on light chart backgrounds', () => {
        expect(attributionMarkColor('#ffffff')).toBe('#000000');
        expect(attributionMarkColor('#f8fafc')).toBe('#000000');
        expect(attributionMarkColor('#fff')).toBe('#000000');
        expect(attributionMarkColor('rgb(240, 240, 240)')).toBe('#000000');
    });

    it('switches with no mid-tone in between as the background brightens', () => {
        const ramp = ['#101010', '#404040', '#606060', '#a0a0a0', '#d0d0d0', '#ffffff'];
        const inks = ramp.map((bg) => attributionMarkColor(bg));
        expect(new Set(inks)).toEqual(new Set(['#ffffff', '#000000']));
        expect(inks[0]).toBe('#ffffff');
        expect(inks[inks.length - 1]).toBe('#000000');
        // one crossover only — never white → gray → black
        const flips = inks.filter((ink, i) => i > 0 && ink !== inks[i - 1]).length;
        expect(flips).toBe(1);
    });
});

describe('the built-in attribution mark is neutralized', () => {
    // This distribution renders no brand mark: the builder returns an inert,
    // invisible placeholder so callers can keep appending/positioning it freely.
    it('renders nothing: no anchor, no link, no SVG, hidden by default', () => {
        const mark = createAttributionMark(stubDocument(), '#151619') as unknown as {
            className: string;
            style: { display?: string };
            children: unknown[];
        };
        expect(mark.className).toBe('vela-attribution');
        expect(mark.style.display).toBe('none');
        expect(mark.children).toHaveLength(0);
        expect(JSON.stringify(mark)).not.toContain('velacharts.dev');
    });

    it('carries no screenshot payload (nothing visible to export)', () => {
        const mark = createAttributionMark(stubDocument(), '#151619') as unknown as {
            dataset: Record<string, string>;
        };
        expect(mark.dataset.velaScreenshot).toBeUndefined();
    });
});

describe('host-supplied custom marks keep working', () => {
    it('opts into the PNG export the same way', () => {
        const mark = createCustomMark(stubDocument(), 'ACME', '#151619') as unknown as {
            dataset: Record<string, string>;
            innerHTML: string;
        };
        expect(mark.dataset.velaScreenshot).toBe('1');
        expect(mark.innerHTML).toBe('ACME');
    });
});
