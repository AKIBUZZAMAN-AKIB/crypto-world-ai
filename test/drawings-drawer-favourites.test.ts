// @vitest-environment jsdom
// The drawings drawer's favourites TAB: the star was decoration until it had a door.
// A lead ★ tab lists every starred tool (grouped), says how to fill it when empty, and
// drops a row the moment it is unstarred from inside that view.
import { describe, it, expect, beforeEach } from 'vitest';
import { DrawingsDrawer } from '../src/widget/drawings-drawer';
import type { ToolbarDefinition } from '../src/core/drawings/toolbar';
import type { DrawingTypeKey } from '../src/core/drawings/Drawing';

// jsdom ships no `CSS.escape`; the style injector needs it for its id lookup.
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

const TOOL = (type: string, label: string) => ({ type, label, icon: `<svg data-t="${type}"></svg>` });

const MODEL: ToolbarDefinition = {
    groups: [
        {
            id: 'lines',
            label: 'Lines',
            tools: [TOOL('trendline', 'Trend Line'), TOOL('hline', 'Horizontal Line'), TOOL('ray', 'Ray')] as never,
        },
        {
            id: 'fib',
            label: 'Fibonacci',
            tools: [TOOL('fibretracement', 'Fib Retracement'), TOOL('fibextension', 'Fib Extension')] as never,
        },
    ],
} as unknown as ToolbarDefinition;

let favourites: Set<string>;

function mount(): { drawer: DrawingsDrawer; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const drawer = new DrawingsDrawer({
        host,
        toolbar: () => MODEL,
        currentTool: () => null,
        isFavorite: (t: DrawingTypeKey) => favourites.has(t),
        onFavorite: (t: DrawingTypeKey, on: boolean) => {
            if (on) favourites.add(t);
            else favourites.delete(t);
        },
        onSelect: () => {},
    });
    return { drawer, host };
}

beforeEach(() => {
    document.body.replaceChildren();
    favourites = new Set<string>();
});

const tabStrip = () => [...document.querySelectorAll<HTMLElement>('.vela-dd-tab')];
const listRows = () => [...document.querySelectorAll<HTMLElement>('.vela-dd-row .vela-dd-label')].map((l) => l.textContent);
const sections = () => [...document.querySelectorAll<HTMLElement>('.vela-dd-section')].map((s) => s.textContent);

describe('drawings drawer — favourites tab', () => {
    it('leads the tab strip with a starred glyph tab and keeps the group tabs after it', () => {
        const { drawer } = mount();
        drawer.open();
        const tabs = tabStrip();
        expect(tabs[0]!.dataset.fav).toBe('1');
        expect(tabs[0]!.getAttribute('aria-label')).toBe('Favourites');
        expect(tabs.slice(1).map((t) => t.textContent)).toEqual(['Lines', 'Fibonacci']);
        expect(tabs[0]!.dataset.active).toBeUndefined();
    });

    it('lists every starred tool under its group heading', () => {
        favourites.add('hline');
        favourites.add('fibextension');
        const { drawer } = mount();
        drawer.open();
        tabStrip()[0]!.click();
        expect(sections()).toEqual(['Lines', 'Fibonacci']);
        expect(listRows()).toEqual(['Horizontal Line', 'Fib Extension']);
        expect(tabStrip()[0]!.dataset.active).toBe('1');
    });

    it('says how to fill it instead of showing a blank sheet', () => {
        const { drawer } = mount();
        drawer.open();
        tabStrip()[0]!.click();
        expect(listRows()).toEqual([]);
        const empty = document.querySelector('.vela-dd-empty');
        expect(empty?.textContent).toContain('tap the star');
    });

    it('unstarring from inside the tab removes the row it sits on', () => {
        favourites.add('trendline');
        favourites.add('hline');
        const { drawer } = mount();
        drawer.open();
        tabStrip()[0]!.click();
        expect(listRows()).toEqual(['Trend Line', 'Horizontal Line']);

        const firstStar = document.querySelector<HTMLButtonElement>('.vela-dd-row .vela-dd-star')!;
        firstStar.click();
        expect(favourites.has('trendline')).toBe(false);
        expect(listRows()).toEqual(['Horizontal Line']); // the row left with the star
    });

    it('keeps a group tab working after visiting favourites (the tab is a view, not a mode)', () => {
        favourites.add('hline');
        const { drawer } = mount();
        drawer.open();
        tabStrip()[0]!.click();
        tabStrip().find((t) => t.textContent === 'Fibonacci')!.click();
        expect(listRows()).toEqual(['Fib Retracement', 'Fib Extension']);
        expect(tabStrip()[0]!.dataset.active).toBeUndefined();
    });

    it('search still flattens the whole model, favourites tab or not', () => {
        favourites.add('hline');
        const { drawer } = mount();
        drawer.open();
        tabStrip()[0]!.click();
        const input = document.querySelector<HTMLInputElement>('.vela-dd-search input')!;
        input.value = 'fib';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(listRows()).toEqual(['Fib Retracement', 'Fib Extension']);
        expect(sections()).toEqual(['Fibonacci']);
    });
});
