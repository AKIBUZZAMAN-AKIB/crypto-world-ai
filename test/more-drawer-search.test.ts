// @vitest-environment jsdom
// The More drawer got a search field (60+ rows with no way to narrow them) — this pins the
// three promises it makes: matching rows survive, a section with no survivors collapses,
// and an empty result says so instead of showing a blank sheet.
import { describe, it, expect, beforeEach } from 'vitest';
import { MoreDrawer } from '../src/widget/more-drawer';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

function mount(): MoreDrawer {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const drawer = new MoreDrawer({
        host,
        canUndo: () => true,
        canRedo: () => false,
        priceStyles: () => [
            { id: 'candles', label: 'Candles' },
            { id: 'bars', label: 'Bars' },
        ],
        priceStyle: () => 'candles',
        onPriceStyle: () => {},
        panels: () => [
            { id: 'objects', title: 'Object tree', icon: 'objects' },
            { id: 'data', title: 'Data window', icon: 'datawindow' },
        ],
        onTogglePanel: () => {},
        onResetView: () => {},
        onTimeZone: () => {},
        timezone: () => 'Etc/UTC',
        actions: () => [{ label: 'Keyboard shortcuts', icon: 'kbd', run: () => {} }],
    });
    drawer.open();
    return drawer;
}

beforeEach(() => {
    document.body.replaceChildren();
});

const input = () => document.querySelector<HTMLInputElement>('.vela-md-search input')!;
const visibleRows = () => [...document.querySelectorAll<HTMLElement>('.vela-md-row')].filter((r) => !r.hidden);
const visibleSections = () => [...document.querySelectorAll<HTMLElement>('.vela-md-section')].filter((s) => !s.hidden);
const type = (q: string) => {
    const el = input();
    el.value = q;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('More drawer — search', () => {
    it('opens with an empty search and every row showing', () => {
        mount();
        expect(input().value).toBe('');
        expect(visibleRows().length).toBeGreaterThan(1);
    });

    it('keeps only matching rows and collapses the sections that empty out', () => {
        mount();
        const before = visibleRows().length;
        type('object');
        const rows = visibleRows();
        expect(rows.length).toBeLessThan(before);
        expect(rows.map((r) => r.textContent)).toEqual(['Object tree']);
        expect(visibleSections().map((s) => s.textContent)).toEqual(['Chart']);
    });

    it('is case-insensitive and matches the row value text too', () => {
        mount();
        type('CANDLES');
        expect(visibleRows().map((r) => r.textContent?.trim())).toEqual(['Chart typeCandles']);
    });

    it('says so when nothing matches', () => {
        mount();
        type('zzzz');
        expect(visibleRows()).toHaveLength(0);
        expect(document.querySelector('.vela-md-nomatch')?.textContent).toContain('Nothing matches');
    });

    it('the clear button restores the full list', () => {
        mount();
        type('object');
        const clear = document.querySelector<HTMLElement>('.vela-md-search-clear')!;
        expect(clear.hidden).toBe(false);
        clear.click();
        expect(input().value).toBe('');
        expect(visibleRows().length).toBeGreaterThan(1);
        expect(document.querySelector('.vela-md-nomatch')).toBeNull();
    });

    it('a fresh open never inherits the last query', () => {
        const drawer = mount();
        type('object');
        drawer.close();
        drawer.open();
        expect(input().value).toBe('');
        expect(visibleRows().length).toBeGreaterThan(1);
    });
});
