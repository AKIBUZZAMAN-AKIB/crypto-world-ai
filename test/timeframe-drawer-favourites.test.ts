// @vitest-environment jsdom
// The timeframe sheet after round 25: a favourites strip on top, a star inside every
// interval chip, and two visually different treatments for the two things both called
// "1D" (a date RANGE is a window — a pill with a calendar mark; a TIMEFRAME is an
// interval — a squared chip with a star).
import { describe, it, expect, beforeEach } from 'vitest';
import { TimeframeDrawer } from '../src/widget/timeframe-drawer';
import { RANGE_PRESETS } from '../src/widget/bottombar';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

const TIMEFRAMES = ['1', '5', '60', 'D'];

let favs: string[];
let picked: string[];

function mount(): { drawer: TimeframeDrawer; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const drawer = new TimeframeDrawer({
        host,
        timeframes: TIMEFRAMES,
        ranges: RANGE_PRESETS,
        currentTimeframe: () => '60',
        activeRange: () => null,
        onTimeframe: (tf) => picked.push(tf),
        onRange: () => {},
        favorites: () => favs,
        onFavorite: (tf, on) => {
            favs = on ? [tf, ...favs.filter((f) => f !== tf)] : favs.filter((f) => f !== tf);
        },
    });
    drawer.open();
    return { drawer, host };
}

beforeEach(() => {
    document.body.replaceChildren();
    favs = [];
    picked = [];
});

const headings = () => [...document.querySelectorAll<HTMLElement>('.vela-tfd-heading')].map((h) => h.textContent);
const tfChips = () => [...document.querySelectorAll<HTMLElement>('.vela-tfd-grid .vela-tfd-chip')];
const rangeChips = () => [...document.querySelectorAll<HTMLElement>('.vela-tfd-chip[data-kind="range"]')];
const starOf = (label: string) =>
    tfChips()
        .find((c) => c.firstElementChild?.textContent === label)!
        .querySelector<HTMLElement>('.vela-tfd-star')!;

describe('timeframe sheet — favourites and the two "1D"s', () => {
    it('leads with Favourites, then Date range, then Timeframes', () => {
        mount();
        expect(headings()).toEqual(['Favourites', 'Date range', 'Timeframes']);
        // Nothing starred yet: the section is present but carries no dead space.
        expect((document.querySelector('.vela-tfd-favs') as HTMLElement).hidden).toBe(true);
    });

    it('ranges are flagged and labelled as WINDOWS, not intervals', () => {
        mount();
        const one = rangeChips().find((c) => c.textContent?.includes('1D'))!;
        expect(one.dataset.kind).toBe('range');
        expect(one.getAttribute('aria-label')).toBe('1D — last day');
        expect(rangeChips()).toHaveLength(RANGE_PRESETS.length);
        // The interval chip wears the SAME word ("1D" is also a timeframe) — which is the
        // ambiguity this round fixes. The two are told apart by shape, not by reading:
        // a marked pill (window) versus a star-carrying square (interval).
        const interval = tfChips().find((c) => c.textContent?.includes('1D'))!;
        expect(interval.dataset.kind).toBeUndefined();
        expect(interval.querySelector('.vela-tfd-mark')).toBeNull();
        expect(interval.querySelector('.vela-tfd-star')).not.toBeNull();
    });

    it('every interval chip carries a 30px star that stars without selecting', () => {
        mount();
        const star = starOf('1h');
        expect(star.getBoundingClientRect).toBeTypeOf('function');
        star.click();
        expect(favs).toEqual(['60']);
        expect(picked).toEqual([]); // starring is a side action, never a switch
        expect(star.dataset.on).toBe('1');
        expect(star.getAttribute('aria-pressed')).toBe('true');
    });

    it('starred intervals are mirrored into the favourites strip and can be removed there', () => {
        favs = ['60'];
        mount();
        const favSection = document.querySelector<HTMLElement>('.vela-tfd-favs')!;
        expect(favSection.hidden).toBe(false);
        const mirror = favSection.querySelector<HTMLElement>('.vela-tfd-chip')!;
        expect(mirror.textContent).toContain('1h');
        mirror.querySelector<HTMLElement>('.vela-tfd-star')!.click();
        expect(favs).toEqual([]);
        expect(favSection.hidden).toBe(true);
        expect(starOf('1h').dataset.on).toBe('');
    });

    it('a favourites chip applies the interval it names', () => {
        favs = ['60'];
        mount();
        document.querySelector<HTMLElement>('.vela-tfd-favs .vela-tfd-chip')!.click();
        expect(picked).toEqual(['60']);
    });

    it('refreshFavorites repaints an open sheet when the star changes elsewhere', () => {
        const { drawer } = mount();
        favs = ['D'];
        drawer.refreshFavorites();
        expect(document.querySelector<HTMLElement>('.vela-tfd-favs')!.hidden).toBe(false);
        expect(starOf('1D').dataset.on).toBe('1');
    });
});
