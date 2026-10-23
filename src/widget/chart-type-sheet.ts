// CHART-TYPE SHEET (mobile) — the phone's answer to "what kind of chart is this?".
//
// The mobile bar used to spend its widest fixed stop on the layout COUNT ("2×2"), which is
// a number a trader reads once and then never touches again, while the chart TYPE — the
// thing you switch while reading — was three taps away inside More. This sheet is the
// replacement's other half: the bar shows the current style's glyph and this panel opens
// above the bar with every registered style, as a grid of tiles.
//
// The FAVOURITES layer follows TradingView: every tile carries a star, the starred styles
// sit in their own section at the top, and the header's star chip flips the whole sheet to
// "favourites only" — the two ways TradingView lets a trader keep a short list of the
// styles they actually use out of a menu of twenty.
//
// It is a popover-class surface, not a modal: no scrim, no focus trap, outside-tap and
// Escape close it, and it announces itself through the kit's surface events so a host can
// close whatever else was open. It mounts INSIDE the kit host: a body-mounted layer
// inherits none of the `--vela-*` tokens (no surface, no z-index) and the plot's own
// chrome paints over it.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { announceSurface } from '../ui/surface-events';
import { holdForExit, type SurfaceExit } from '../ui/surface-exit';
import { isFavorite, onFavoritesChange, toggleFavorite } from './favorites';

const STYLE_ID = 'vela-widget-chart-type-sheet';

const CSS = `
.vela-cts {
    position: absolute;
    left: 50%;
    bottom: calc(58px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: var(--vela-z-popover, 6000);
    width: min(384px, calc(100% - 12px));
    max-height: min(62vh, 460px);
    display: flex;
    flex-direction: column;
    padding: 9px 9px 7px;
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 14px;
    box-shadow: var(--vela-shadow-dialog), inset 0 1px 0 rgb(255 255 255 / 6%);
    transform-origin: bottom center;
    animation: vela-cts-in 160ms var(--vela-ease);
}
.vela-cts[data-closing] { animation: vela-cts-out 120ms var(--vela-ease) forwards; pointer-events: none; }
@keyframes vela-cts-in { from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.98); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
@keyframes vela-cts-out { from { opacity: 1; } to { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.985); } }
@media (prefers-reduced-motion: reduce) {
    .vela-cts, .vela-cts[data-closing] { animation: none; }
}
/* A phone on its side has ~390px of height, not 844: the sheet must use the width it
   suddenly has instead of squeezing two rows of tiles under a 46px bar. Six columns and
   a taller scroll area turn 19 styles into four comfortable rows. */
@media (max-height: 560px) {
    .vela-cts {
        bottom: calc(52px + env(safe-area-inset-bottom, 0px));
        max-height: min(84vh, 420px);
        width: min(560px, calc(100% - 16px));
        padding: 7px 9px 6px;
    }
    .vela-cts-grid { grid-template-columns: repeat(6, 1fr); gap: 4px; }
    .vela-cts-tile { min-height: 52px; padding: 4px 3px 4px; }
    .vela-cts-tile svg { width: 18px; height: 18px; }
    .vela-cts-head { padding-bottom: 4px; min-height: 30px; }
    .vela-cts-scroll { max-height: calc(84vh - 108px); }
    .vela-cts-layout { min-height: 34px; }
}

/* ── header ── */
.vela-cts-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 2px 7px;
    min-height: 34px;
}
.vela-cts-title { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex: 1 1 auto; }
.vela-cts-kicker {
    flex: none;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-cts-title b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 600;
}
/* The star filter: the guardrail against a 20-item menu — one tap and the sheet is only
   the styles this trader stars. */
.vela-cts-only {
    all: unset;
    flex: none;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 9px 0 7px;
    border-radius: 999px;
    border: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 120ms var(--vela-ease), border-color 120ms var(--vela-ease), background 120ms var(--vela-ease);
}
.vela-cts-only .vela-icon { font-size: 13px; width: 13px; height: 13px; }
.vela-cts-only:active { background: var(--vela-hover); }
.vela-cts-only[aria-pressed='true'] {
    color: var(--vela-star, var(--vela-accent));
    border-color: color-mix(in srgb, var(--vela-star, var(--vela-accent)) 55%, transparent);
    background: color-mix(in srgb, var(--vela-star, var(--vela-accent)) 12%, transparent);
}
.vela-cts-only:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }

/* ── body ── */
.vela-cts-scroll {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    scroll-padding-block: 4px;
    padding-bottom: 2px;
}
.vela-cts-sec {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px 4px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
}
.vela-cts-sec::after {
    content: '';
    flex: 1 1 auto;
    height: 1px;
    background: var(--vela-border-faint);
}
.vela-cts-sec[hidden] { display: none; }
.vela-cts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
}
.vela-cts-grid:empty { display: none; }
.vela-cts-cell { position: relative; min-width: 0; }
.vela-cts-tile {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    min-height: 60px;
    padding: 6px 3px 5px;
    border-radius: 9px;
    border: 1px solid transparent;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 120ms var(--vela-ease), color 120ms var(--vela-ease), border-color 120ms var(--vela-ease);
}
.vela-cts-tile svg { width: 20px; height: 20px; }
.vela-cts-tile:active { background: var(--vela-hover-strong); }
.vela-cts-cell[data-on='1'] .vela-cts-tile {
    color: var(--vela-fg-bright);
    background: var(--vela-hover);
    border-color: var(--vela-border-strong);
}
.vela-cts-cell[data-on='1'] .vela-cts-tile svg { color: var(--vela-accent, var(--vela-fg-bright)); }
.vela-cts-tile:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }
.vela-cts-name {
    font-size: 9.5px;
    line-height: 1.15;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
}
/* Below 360px the four columns are ~72px wide: the label has to fit TWO lines of 9.5px
   text or it wraps to a third and the tile grows under its neighbours. Tighten the type
   and the padding instead of clamping the name away — "Hollow candles" must stay legible. */
@media (max-width: 360px) {
    .vela-cts-tile { min-height: 56px; padding: 5px 2px 4px; gap: 4px; }
    .vela-cts-tile svg { width: 18px; height: 18px; }
    .vela-cts-name { font-size: 9px; line-height: 1.1; hyphens: none; }
}
/* The star sits on the tile's corner, quiet until it is the point: a star is a small
   deliberate act, not a second primary action. 24px is the smallest comfortable thumb
   target that does not eat the 86px tile. */
.vela-cts-star {
    all: unset;
    position: absolute;
    top: 0;
    right: 0;
    box-sizing: border-box;
    /* 30px: the smallest target that is reliably hittable with a thumb on an 86px tile,
       without stealing the tile's own press (the star sits in the corner, the glyph in
       the middle). The visible star stays 12px — the target is the invisible box. */
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-faint);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    opacity: 0.6;
    transition: opacity 120ms var(--vela-ease), color 120ms var(--vela-ease), transform 120ms var(--vela-ease);
}
.vela-cts-star .vela-icon { font-size: 12px; width: 12px; height: 12px; }
.vela-cts-star:active { transform: scale(0.88); background: var(--vela-hover); }
.vela-cts-star[aria-pressed='true'] { color: var(--vela-star, var(--vela-accent)); opacity: 1; }
.vela-cts-star:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
.vela-cts-empty {
    padding: 4px 6px 8px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--vela-fg-muted);
}
.vela-cts-empty[hidden] { display: none; }

/* ── footer: the layout door the bar gave up ── */
.vela-cts-layout {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 8px;
    margin-top: 3px;
    border-top: 1px solid var(--vela-border-faint);
    border-radius: 8px;
    color: var(--vela-fg-muted);
    font-size: 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cts-layout:active { background: var(--vela-hover); }
.vela-cts-layout .vela-cts-lglyph { display: inline-flex; width: 18px; height: 18px; }
.vela-cts-layout .vela-cts-lglyph svg { width: 18px; height: 18px; }
.vela-cts-layout b { color: var(--vela-fg-bright); font-weight: 600; }
.vela-cts-layout .vela-cts-chev { margin-left: auto; display: inline-flex; opacity: 0.7; }
`;

export interface ChartTypeOption {
    id: string;
    label: string;
    /** Raw `<svg>` markup (registered by `priceStyleIcon`). */
    icon?: string;
}

export interface ChartTypeSheetOptions {
    /** Where the panel mounts (the kit host — the workspace root). */
    host: HTMLElement;
    /** The bar stop that opens it (kept for `aria-expanded` + surface announcements). */
    trigger: HTMLElement;
    /** Every selectable style, in picker order. Read on every open. */
    styles: () => ChartTypeOption[];
    /** The style in effect now. Read on every open. */
    current: () => string;
    onSelect: (id: string) => void;
    /** Multi-chart shells only: the layout door the bar stop gave up. */
    layout?: { label: () => string; glyph: () => string; onOpen: () => void };
    /**
     * The starring channel. A shell that PERSISTS the set (the workspace writes it into
     * the document, beside the drawing/timeframe favourites) injects both; with neither,
     * the sheet falls back to the local store so a standalone host still gets stars.
     */
    isFavorite?: (id: string) => boolean;
    onToggleFavorite?: (id: string, on: boolean) => void;
}

const COLS = 4;

interface Cell {
    root: HTMLElement;
    tile: HTMLButtonElement;
    star: HTMLButtonElement;
    option: ChartTypeOption;
}

export class ChartTypeSheet {
    private readonly doc: Document;
    private readonly opts: ChartTypeSheetOptions;
    private el: HTMLElement | null = null;
    private exit: SurfaceExit | null = null;
    private isOpen = false;
    /** Roving focus: the tile index the arrow keys move from. */
    private cursor = 0;
    /** Live refs for in-place updates while the sheet is open (a style change from the
     *  API or the desktop chrome must repaint the sheet, not silently leave it stale). */
    private cells: Cell[] = [];
    private nowEl: HTMLElement | null = null;
    private layoutValue: HTMLElement | null = null;
    private layoutRow: HTMLButtonElement | null = null;
    private favSection: HTMLElement | null = null;
    private favLabel: HTMLElement | null = null;
    private allSection: HTMLElement | null = null;
    private favGrid: HTMLElement | null = null;
    private allGrid: HTMLElement | null = null;
    private emptyEl: HTMLElement | null = null;
    private onlyBtn: HTMLButtonElement | null = null;
    private allSecLabel: HTMLElement | null = null;
    private kickerEl: HTMLElement | null = null;
    /** The star filter: only starred styles. */
    private onlyFavorites = false;
    /** Detach the favourites subscription when the sheet closes. */
    private unsubFavorites: (() => void) | null = null;

    constructor(opts: ChartTypeSheetOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
    }

    get visible(): boolean {
        return this.isOpen;
    }

    /** Star state — the shell's set when it owns one, else the local store. */
    private fav(id: string): boolean {
        return this.opts.isFavorite ? this.opts.isFavorite(id) : isFavorite('chartTypes', id);
    }

    private toggleFav(id: string): boolean {
        const next = !this.fav(id);
        if (this.opts.onToggleFavorite) this.opts.onToggleFavorite(id, next);
        else toggleFavorite('chartTypes', id);
        return next;
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        if (this.isOpen) return;
        const doc = this.doc;
        injectStyles(STYLE_ID, CSS, doc);
        this.isOpen = true;
        this.exit?.finish();
        this.exit = null;
        this.el?.remove();
        this.cells = [];

        const styles = this.opts.styles();
        const current = this.opts.current();

        const el = doc.createElement('div');
        el.className = 'vela-cts';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Chart type');

        // ── header ──
        const head = doc.createElement('div');
        head.className = 'vela-cts-head';
        const title = doc.createElement('div');
        title.className = 'vela-cts-title';
        const kicker = doc.createElement('span');
        kicker.className = 'vela-cts-kicker';
        kicker.textContent = 'Chart type';
        const now = doc.createElement('b');
        now.textContent = styles.find((s) => s.id === current)?.label ?? current;
        title.append(kicker, now);
        this.kickerEl = kicker;
        this.nowEl = now;

        const only = doc.createElement('button');
        only.type = 'button';
        only.className = 'vela-cts-only';
        only.setAttribute('aria-pressed', this.onlyFavorites ? 'true' : 'false');
        only.setAttribute('aria-label', 'Show favourites only');
        only.append(iconEl(this.onlyFavorites ? 'star-filled' : 'star', doc));
        const onlyText = doc.createElement('span');
        onlyText.textContent = 'Favourites';
        only.appendChild(onlyText);
        only.addEventListener('click', () => {
            this.onlyFavorites = !this.onlyFavorites;
            only.setAttribute('aria-pressed', this.onlyFavorites ? 'true' : 'false');
            only.replaceChildren(iconEl(this.onlyFavorites ? 'star-filled' : 'star', doc), onlyText);
            this.syncFavorites();
            const first = this.cells.find((c) => !c.root.hidden);
            first?.tile.focus({ preventScroll: false });
        });
        this.onlyBtn = only;
        head.append(title, only);

        // ── body: a favourites section over the full list ──
        const scroll = doc.createElement('div');
        scroll.className = 'vela-cts-scroll';

        const mkSection = (key: 'fav' | 'all', label: string): { section: HTMLElement; grid: HTMLElement; label: HTMLElement } => {
            const section = doc.createElement('section');
            section.dataset.sec = key;
            const head = doc.createElement('div');
            head.className = 'vela-cts-sec';
            head.textContent = label;
            const grid = doc.createElement('div');
            grid.className = 'vela-cts-grid';
            section.append(head, grid);
            scroll.appendChild(section);
            return { section, grid, label: head };
        };
        const fav = mkSection('fav', 'Favourites');
        const all = mkSection('all', 'All styles');
        this.favSection = fav.section;
        this.favLabel = fav.label;
        this.favGrid = fav.grid;
        this.allSection = all.section;
        this.allGrid = all.grid;
        this.allSecLabel = all.label;

        const empty = doc.createElement('div');
        empty.className = 'vela-cts-empty';
        empty.textContent = 'No favourites yet — tap a star on any style to pin it here.';
        scroll.appendChild(empty);
        this.emptyEl = empty;

        for (const s of styles) {
            const cell = doc.createElement('div');
            cell.className = 'vela-cts-cell';
            cell.dataset.id = s.id;
            if (s.id === current) cell.dataset.on = '1';

            const tile = doc.createElement('button');
            tile.type = 'button';
            tile.className = 'vela-cts-tile';
            tile.dataset.id = s.id;
            tile.setAttribute('aria-pressed', s.id === current ? 'true' : 'false');
            tile.setAttribute('aria-label', s.label);
            if (s.icon) tile.innerHTML = s.icon;
            else tile.appendChild(iconEl('style-candles', doc));
            const name = doc.createElement('span');
            name.className = 'vela-cts-name';
            name.textContent = s.label;
            tile.appendChild(name);
            tile.addEventListener('click', () => {
                if (s.id !== this.opts.current()) this.opts.onSelect(s.id);
                this.close();
                this.focusTrigger(); // the tile is gone — focus must not fall to <body>
            });
            tile.addEventListener('focus', () => {
                this.cursor = this.cells.findIndex((c) => c.option.id === s.id);
            });

            const star = doc.createElement('button');
            star.type = 'button';
            star.className = 'vela-cts-star';
            const painted = (on: boolean): void => {
                star.setAttribute('aria-pressed', on ? 'true' : 'false');
                star.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites — ${s.label}`);
                star.replaceChildren(iconEl(on ? 'star-filled' : 'star', doc));
            };
            painted(this.fav(s.id));
            star.addEventListener('click', () => {
                painted(this.toggleFav(s.id));
                this.syncFavorites();
            });

            cell.append(tile, star);
            this.cells.push({ root: cell, tile, star, option: s });
        }

        el.append(head, scroll);

        // ── footer: the layout door ──
        if (this.opts.layout) {
            const layout = this.opts.layout;
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'vela-cts-layout';
            const glyph = doc.createElement('span');
            glyph.className = 'vela-cts-lglyph';
            glyph.innerHTML = layout.glyph();
            const text = doc.createElement('span');
            text.textContent = 'Layout · ';
            const value = doc.createElement('b');
            value.textContent = layout.label();
            text.appendChild(value);
            const chev = doc.createElement('span');
            chev.className = 'vela-cts-chev';
            chev.appendChild(iconEl('chevron-right', doc));
            row.append(glyph, text, chev);
            row.setAttribute('aria-label', `Layout ${layout.label()}. Open the layout sheet`);
            row.addEventListener('click', () => {
                this.close();
                layout.onOpen();
            });
            el.appendChild(row);
            this.layoutRow = row;
            this.layoutValue = value;
        }

        this.opts.host.appendChild(el);
        this.el = el;
        this.cursor = Math.max(
            0,
            styles.findIndex((s) => s.id === current),
        );

        this.syncFavorites();

        this.opts.trigger.setAttribute('aria-expanded', 'true');
        doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        doc.addEventListener('keydown', this.onDocKeydown, true);
        this.unsubFavorites = onFavoritesChange(() => {
            for (const c of this.cells) {
                const on = this.fav(c.option.id);
                c.star.setAttribute('aria-pressed', on ? 'true' : 'false');
                c.star.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites — ${c.option.label}`);
                c.star.replaceChildren(iconEl(on ? 'star-filled' : 'star', doc));
            }
            this.syncFavorites();
        });
        announceSurface(el, true, 'popover', this.opts.trigger);
        // Land on the CURRENT tile: the sheet opens where the user already is, so a
        // thumb reach to change style is one tap on a neighbour, not a scroll hunt.
        try {
            this.cells.find((c) => c.option.id === current)?.tile.focus({ preventScroll: true });
        } catch {
            /* detached */
        }
    }

    /** Place every tile in the right section, in picker order, and paint the section
     *  chrome. Moving the CELL (not re-creating it) keeps focus and the star's own
     *  pressed state intact across a toggle. */
    private syncFavorites(): void {
        const favGrid = this.favGrid;
        const allGrid = this.allGrid;
        if (!favGrid || !allGrid) return;
        for (const c of this.cells) {
            const on = this.fav(c.option.id);
            (on ? favGrid : allGrid).appendChild(c.root);
        }
        const favCount = this.cells.filter((c) => this.fav(c.option.id)).length;
        if (this.favSection) this.favSection.hidden = favCount === 0; // the filtered list IS this section
        // …and in that mode the header already says "Favourites" — no second title over the
        // same three tiles.
        if (this.favLabel) this.favLabel.hidden = this.onlyFavorites;
        if (this.allSection) this.allSection.hidden = this.onlyFavorites;
        if (this.allSecLabel) this.allSecLabel.hidden = favCount === 0;
        if (this.emptyEl) this.emptyEl.hidden = !(this.onlyFavorites && favCount === 0);
        if (this.kickerEl) this.kickerEl.textContent = this.onlyFavorites ? 'Favourites' : 'Chart type';
        for (const c of this.cells) c.root.hidden = this.onlyFavorites && !this.fav(c.option.id);
        if (this.onlyBtn) this.onlyBtn.setAttribute('aria-label', this.onlyFavorites ? 'Show every chart type' : 'Show favourites only');
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        const doc = this.doc;
        doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.unsubFavorites?.();
        this.unsubFavorites = null;
        this.opts.trigger.setAttribute('aria-expanded', 'false');
        const el = this.el;
        this.el = null;
        this.cells = [];
        this.nowEl = null;
        this.layoutValue = null;
        this.layoutRow = null;
        this.favSection = this.allSection = this.favGrid = this.allGrid = null;
        this.favLabel = null;
        this.emptyEl = null;
        this.onlyBtn = null;
        this.allSecLabel = null;
        this.kickerEl = null;
        if (!el) return;
        announceSurface(el, false, 'popover', this.opts.trigger);
        this.exit?.cancel();
        this.exit = holdForExit(el, () => el.remove());
    }

    // ── live updates while open ─────────────────────────────────────────────────
    /** Repaint the selected tile (the style changed under an open sheet). */
    setCurrent(id: string): void {
        if (!this.isOpen || this.cells.length === 0) return;
        for (const c of this.cells) {
            const on = c.option.id === id;
            if (on) c.root.dataset.on = '1';
            else delete c.root.dataset.on;
            c.tile.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        const label = this.cells.find((c) => c.option.id === id)?.option.label ?? id;
        if (this.nowEl) this.nowEl.textContent = label;
        const idx = this.cells.findIndex((c) => c.option.id === id);
        if (idx >= 0) this.cursor = idx;
    }

    /** Repaint every star + the pinned section from the CURRENT set (the shell wrote it,
     *  or the desktop menu did) without rebuilding the sheet. */
    refreshFavorites(): void {
        if (!this.isOpen) return;
        const doc = this.doc;
        for (const c of this.cells) {
            const on = this.fav(c.option.id);
            c.star.setAttribute('aria-pressed', on ? 'true' : 'false');
            c.star.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites — ${c.option.label}`);
            c.star.replaceChildren(iconEl(on ? 'star-filled' : 'star', doc));
        }
        this.syncFavorites();
    }

    /** Repaint the layout row's caption (the grid changed while the sheet is open). */
    setLayoutLabel(label: string): void {
        if (!this.layoutValue || !this.layoutRow) return;
        this.layoutValue.textContent = label;
        this.layoutRow.setAttribute('aria-label', `Layout ${label}. Open the layout sheet`);
    }

    destroy(): void {
        const el = this.el;
        this.close();
        this.exit?.finish();
        this.exit = null;
        el?.remove();
        this.el = null;
    }

    private focusTrigger(): void {
        try {
            this.opts.trigger.focus({ preventScroll: true });
        } catch {
            /* detached */
        }
    }

    private readonly onDocPointerDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (this.el && t && this.el.contains(t)) return;
        if (t && this.opts.trigger.contains(t)) return;
        this.close();
    };

    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (!this.isOpen || !this.el) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
            this.focusTrigger();
            return;
        }
        const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
        const step = move[e.key];
        if (step === undefined) return;
        // Rove over the tiles that are ON SCREEN (a filtered sheet has gaps).
        const tiles = this.cells.filter((c) => !c.root.hidden).map((c) => c.tile);
        if (tiles.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const at = tiles.indexOf(this.doc.activeElement as HTMLButtonElement);
        const from = at >= 0 ? at : this.cursor;
        const next = Math.max(0, Math.min(tiles.length - 1, from + step));
        this.cursor = next;
        tiles[next]?.focus({ preventScroll: false });
    };
}
