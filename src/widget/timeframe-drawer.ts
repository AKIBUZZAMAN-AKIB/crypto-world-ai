// Timeframe drawer (mobile) — the bottom-sheet counterpart of the topbar timeframe menu
// PLUS the desktop bottombar's range chips.
//
// The sheet reads top-down the way you narrow a chart: FAVOURITES (the handful you
// actually use, starred from here, persisted with the layout), then DATE RANGE (a
// WINDOW — "the last 3 months" — so each chip is a pill with a calendar mark), then
// TIMEFRAMES (an INTERVAL — "one bar is 1 hour" — squared chips). "1D" appears in both
// on purpose: it is a different thing each time, and the two treatments say which.
// Selection state is re-read on every open, so the sheet always mirrors whatever path
// last changed the timeframe (quick entry, API, a range chip).
import { Drawer } from '../ui/components/drawer';
import { injectStyles } from '../ui/styles';
import { iconMarkup } from '../ui/icons';
import type { RangePreset } from './bottombar';
import { timeframeLabel } from './timeframe';

const STYLE_ID = 'vela-widget-tf-drawer';
const CSS = `
.vela-tfd-heading {
    padding: 4px 2px 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-bright);
}
.vela-tfd-heading + .vela-tfd-ranges,
.vela-tfd-heading + .vela-tfd-grid { padding-top: 0; }
.vela-tfd-ranges {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    /* Sideways-scrolling strip: keep its touches native scroll (the drawer body is pan-y). */
    touch-action: pan-x;
    padding: 0 2px 14px;
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
}
.vela-tfd-ranges::-webkit-scrollbar { display: none; }
.vela-tfd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 6px;
    padding-bottom: 4px;
}
.vela-tfd-grid + .vela-tfd-heading { padding-top: 14px; }
.vela-tfd-chip {
    all: unset;
    position: relative;
    box-sizing: border-box;
    min-height: 44px;
    min-width: 76px;
    padding: 0 4px 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 2px;
    flex: none;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tfd-chip:active { background: var(--vela-hover); }
.vela-tfd-chip[data-active='1'] {
    color: var(--vela-fg-bright);
    border-color: var(--vela-fg-bright);
    background: var(--vela-hover);
}
/* A range is a WINDOW, not an interval: a calendar mark and a fully rounded pill say so
   without a second label, and the aria-label spells it out for a screen reader. */
.vela-tfd-chip[data-kind='range'] {
    min-width: 0;
    justify-content: center;
    gap: 5px;
    padding: 0 13px;
    border-radius: 999px;
}
.vela-tfd-chip[data-kind='range'] .vela-tfd-mark {
    display: inline-flex;
    color: var(--vela-fg-muted);
}
.vela-tfd-chip[data-kind='range'] .vela-tfd-mark svg { width: 14px; height: 14px; }
.vela-tfd-chip[data-kind='range'][data-active='1'] .vela-tfd-mark { color: inherit; }
/* The star sits INSIDE the chip on the right, a full 30px target (a 12px glyph floating
   in a corner would be a miss waiting to happen). It never fires the chip's own select. */
.vela-tfd-star {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--vela-star);
    opacity: 0.4;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tfd-star svg { width: 14px; height: 14px; }
.vela-tfd-star[data-on='1'] { opacity: 1; }
.vela-tfd-star:active { background: var(--vela-hover); opacity: 1; }
.vela-tfd-empty {
    padding: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--vela-fg-muted);
}
`;

/** What a range id means in words — the sheet's aria-labels, and the thing that makes
 *  the "1D" range and the "1D" timeframe stop reading as the same choice. */
const RANGE_WORDS: Readonly<Record<string, string>> = {
    '1D': 'last day',
    '7D': 'last 7 days',
    '1M': 'last month',
    '3M': 'last 3 months',
    '6M': 'last 6 months',
    YTD: 'year to date',
    '1Y': 'last year',
    '5Y': 'last 5 years',
    ALL: 'all history',
};

const STAR_ICON = iconMarkup('star-filled') ?? '';
const STAR_OUTLINE = iconMarkup('star') ?? STAR_ICON;
const CALENDAR_ICON = iconMarkup('calendar') ?? '';

export interface TimeframeDrawerOptions {
    host: HTMLElement;
    timeframes: readonly string[];
    ranges: readonly RangePreset[];
    /** Read live at open — the current timeframe (highlights its chip). */
    currentTimeframe: () => string;
    /** Read live at open — the active range chip id, or null. */
    activeRange: () => string | null;
    onTimeframe: (tf: string) => void;
    onRange: (preset: RangePreset) => void;
    onOpenChange?: (open: boolean) => void;
    /** Starred timeframes (interval ids), most recent first. */
    favorites?: () => readonly string[];
    onFavorite?: (tf: string, on: boolean) => void;
}

export class TimeframeDrawer {
    private readonly drawer: Drawer;
    private readonly rangeChips = new Map<string, HTMLButtonElement>();
    private readonly tfChips = new Map<string, HTMLButtonElement>();
    private readonly stars = new Map<string, { btn: HTMLButtonElement; mirror: HTMLButtonElement | null }>();
    private readonly favSection: HTMLElement;
    private readonly favGrid: HTMLElement;
    private readonly tfGrid: HTMLElement;

    constructor(private readonly opts: TimeframeDrawerOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });

        const heading = (text: string): HTMLElement => {
            const el = doc.createElement('div');
            el.className = 'vela-tfd-heading';
            el.textContent = text;
            return el;
        };

        // ── favourites ──────────────────────────────────────────────────────────
        this.favSection = doc.createElement('div');
        this.favSection.className = 'vela-tfd-favs';
        this.favGrid = doc.createElement('div');
        this.favGrid.className = 'vela-tfd-grid';
        this.favSection.append(heading('Favourites'), this.favGrid);
        this.favSection.hidden = true; // no dead space until something is starred

        // ── date ranges (a window) ──────────────────────────────────────────────
        const ranges = doc.createElement('div');
        ranges.className = 'vela-tfd-ranges';
        for (const preset of opts.ranges) {
            const chip = doc.createElement('button');
            chip.className = 'vela-tfd-chip';
            chip.dataset.kind = 'range';
            const words = RANGE_WORDS[preset.id] ?? preset.id;
            chip.setAttribute('aria-label', `${preset.id} — ${words}`);
            chip.title = `${preset.id} — ${words}`;
            const mark = doc.createElement('span');
            mark.className = 'vela-tfd-mark';
            mark.innerHTML = CALENDAR_ICON;
            const label = doc.createElement('span');
            label.textContent = preset.id;
            chip.append(mark, label);
            chip.addEventListener('click', () => {
                opts.onRange(preset);
                this.drawer.hide();
            });
            this.rangeChips.set(preset.id, chip);
            ranges.appendChild(chip);
        }

        // ── timeframes (an interval) ────────────────────────────────────────────
        this.tfGrid = doc.createElement('div');
        this.tfGrid.className = 'vela-tfd-grid';
        for (const tf of opts.timeframes) {
            const chip = doc.createElement('button');
            chip.className = 'vela-tfd-chip';
            const label = doc.createElement('span');
            label.textContent = timeframeLabel(tf);
            chip.appendChild(label);
            const star = this.makeStar(tf);
            if (star) chip.appendChild(star);
            chip.addEventListener('click', () => {
                opts.onTimeframe(tf);
                this.drawer.hide();
            });
            this.tfChips.set(tf, chip);
            this.tfGrid.appendChild(chip);
        }

        this.drawer.body.append(
            this.favSection,
            heading('Date range'),
            ranges,
            heading('Timeframes'),
            this.tfGrid,
        );
    }

    /** A 30px star toggle for one timeframe. Clicking it stars the interval WITHOUT
     *  changing it — the side action a chip's corner is for. */
    private makeStar(tf: string): HTMLButtonElement | null {
        if (!this.opts.onFavorite) return null;
        const doc = this.opts.host.ownerDocument;
        const star = doc.createElement('button');
        star.type = 'button';
        star.className = 'vela-tfd-star';
        star.dataset.on = '';
        star.setAttribute('aria-label', `Favourite ${timeframeLabel(tf)}`);
        star.setAttribute('aria-pressed', 'false');
        star.innerHTML = STAR_OUTLINE;
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            const on = star.dataset.on !== '1';
            this.opts.onFavorite?.(tf, on);
            this.paintFavorites();
        });
        this.stars.set(tf, { btn: star, mirror: null });
        return star;
    }

    /** Rebuild the favourites strip + repaint every star from the live store. */
    private paintFavorites(): void {
        const favs = this.opts.favorites?.() ?? [];
        const set = new Set(favs);
        for (const [tf, { btn }] of this.stars) {
            const on = set.has(tf);
            btn.dataset.on = on ? '1' : '';
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.innerHTML = on ? STAR_ICON : STAR_OUTLINE;
            btn.setAttribute('aria-label', on ? `Unfavourite ${timeframeLabel(tf)}` : `Favourite ${timeframeLabel(tf)}`);
        }
        // The top strip is a MIRROR of the starred chips (same look, same stars) — one
        // press anywhere keeps both in step, so the sheet never shows a stale favourite.
        this.favGrid.replaceChildren();
        for (const tf of favs) {
            if (!this.tfChips.has(tf)) continue;
            const doc = this.opts.host.ownerDocument;
            const chip = doc.createElement('button');
            chip.className = 'vela-tfd-chip';
            const label = doc.createElement('span');
            label.textContent = timeframeLabel(tf);
            chip.appendChild(label);
            const star = doc.createElement('button');
            star.type = 'button';
            star.className = 'vela-tfd-star';
            star.dataset.on = '1';
            star.setAttribute('aria-label', `Unfavourite ${timeframeLabel(tf)}`);
            star.setAttribute('aria-pressed', 'true');
            star.innerHTML = STAR_ICON;
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                this.opts.onFavorite?.(tf, false);
                this.paintFavorites();
            });
            chip.appendChild(star);
            chip.addEventListener('click', () => {
                this.opts.onTimeframe(tf);
                this.drawer.hide();
            });
            this.favGrid.appendChild(chip);
        }
        this.favSection.hidden = favs.length === 0;
    }

    /** The star set changed somewhere else (the desktop dropdown, a document restore):
     *  repaint from the live store so an open sheet never shows a stale favourite. */
    refreshFavorites(): void {
        this.paintFavorites();
    }

    open(): void {
        const tf = this.opts.currentTimeframe();
        const range = this.opts.activeRange();
        for (const [id, chip] of this.rangeChips) {
            if (range !== null && id === range) chip.dataset.active = '1';
            else delete chip.dataset.active;
        }
        for (const [id, chip] of this.tfChips) {
            // While a RANGE is driving the window the interval chips stay unselected:
            // the range is the choice, the interval is its consequence.
            if (range === null && id === tf) chip.dataset.active = '1';
            else delete chip.dataset.active;
        }
        this.paintFavorites();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }
}
