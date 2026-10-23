// @vitest-environment jsdom
// The indicator picker's three doors beside the list: ★ favourites, a clock for recents,
// and one tab per family. This file pins what makes those doors real — the tabs exist,
// a star reports through the HOST's store (not localStorage) without adding an instance,
// the favourites tab lists what was starred, and a family tab stops at its own family.
import { describe, it, expect, beforeEach } from 'vitest';
import { IndicatorPicker, indicatorKey, type IndicatorRow } from '../src/widget/indicator-picker';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

const LIBRARY: IndicatorRow[] = [
    { name: 'Simple Moving Average', category: 'Moving averages', native: true, nativeType: 'sma' },
    { name: 'Relative Strength Index', category: 'Oscillators', native: true, nativeType: 'rsi' },
    { name: 'Commodity Channel Index', category: 'Oscillators', native: true, nativeType: 'cci' },
    { name: 'Volume', category: 'Volume', native: true, nativeType: 'volume' },
    { name: 'My Script', category: 'General', language: 'pine' },
];

let favs: string[];
let recents: string[];
let added: number[];

async function mount(): Promise<{ picker: IndicatorPicker; host: HTMLElement }> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const picker = new IndicatorPicker({
        host,
        library: () => LIBRARY,
        onChart: () => [],
        onAdd: (i) => added.push(i),
        onRemove: () => {},
        favorites: () => favs,
        onFavorite: (key, on) => {
            favs = on ? [key, ...favs.filter((f) => f !== key)] : favs.filter((f) => f !== key);
            picker.sync();
        },
        recent: () => recents,
    });
    picker.open();
    // The dialog machine lands its open transition on a microtask; the picker renders on
    // that event, so the list exists one tick later.
    await new Promise((r) => setTimeout(r, 0));
    return { picker, host };
}

beforeEach(() => {
    document.body.replaceChildren();
    favs = [];
    recents = [];
    added = [];
});

const tabs = () => [...document.querySelectorAll<HTMLElement>('.vela-ip-tab')];
const tabLabels = () => tabs().map((t) => t.textContent ?? t.getAttribute('aria-label'));
const rows = () => [...document.querySelectorAll<HTMLElement>('.vela-ip-row .vela-ip-name')].map((n) => n.textContent);
const clickTab = (i: number) => tabs()[i]!.click();
const clickTabNamed = (label: string) => tabs().find((t) => t.textContent === label)!.click();

describe('indicator picker — family tabs, stars and recents', () => {
    it('leads with favourites and recents, then All, then one tab per family in scan order', async () => {
        await mount();
        // tab 0 = ★ (glyph only), tab 1 = clock (glyph only), tab 2 = All, then families.
        expect(tabs()[0]!.getAttribute('aria-label')).toBe('Favourites');
        expect(tabs()[1]!.getAttribute('aria-label')).toBe('Recent');
        expect(tabLabels().slice(2)).toEqual(['All', 'Moving averages', 'Oscillators', 'Volume', 'General']);
    });

    it('groups the All tab by family instead of one flat list', async () => {
        await mount();
        const heads = [...document.querySelectorAll<HTMLElement>('.vela-ip-group')].map((g) => g.textContent);
        expect(heads).toEqual(['Moving averages', 'Oscillators', 'Volume', 'General']);
        expect(rows()).toHaveLength(LIBRARY.length);
    });

    it('a family tab shows only that family, without repeating its own heading', async () => {
        await mount();
        clickTabNamed('Oscillators');
        expect(rows()).toEqual(['Relative Strength Index', 'Commodity Channel Index']);
        expect(document.querySelectorAll('.vela-ip-group')).toHaveLength(0);
    });

    it('starring reports through the host store and does NOT add an instance', async () => {
        await mount();
        const star = document.querySelector<HTMLElement>('.vela-ip-row:has(.vela-ip-star) .vela-ip-star')!;
        star.click();
        expect(favs).toEqual([indicatorKey(LIBRARY[0]!)]); // 'sma'
        expect(added).toEqual([]);
        // and the star repaints as pressed
        const again = document.querySelector<HTMLElement>('.vela-ip-row .vela-ip-star')!;
        expect(again.dataset.on).toBe('1');
        expect(again.getAttribute('aria-pressed')).toBe('true');
    });

    it('the favourites tab lists exactly the starred keys', async () => {
        favs = ['rsi'];
        await mount();
        clickTab(0);
        expect(rows()).toEqual(['Relative Strength Index']);
    });

    it('the favourites tab explains itself when empty', async () => {
        await mount();
        clickTab(0);
        expect(rows()).toEqual([]);
        expect(document.querySelector('.vela-ip-empty')?.textContent).toContain('No favourites yet');
    });

    it('the recents tab resolves keys through the library, newest first, dropping unknowns', async () => {
        recents = ['volume', 'gone-forever', 'sma'];
        await mount();
        clickTab(1);
        expect(rows()).toEqual(['Volume', 'Simple Moving Average']);
    });

    it('row clicks still add by library index', async () => {
        await mount();
        document.querySelectorAll<HTMLElement>('.vela-ip-row')[1]!.click(); // 2nd row = RSI
        expect(added).toEqual([1]);
    });
});
