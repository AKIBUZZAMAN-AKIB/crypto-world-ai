// Indicator picker — a dialog over the widget's indicator manifest: toggle entries on/off
// (live add/remove on the current chart; state survives rebuilds via the widget).
//
// Layout, top to bottom: search · a lead tab row (★ Favourites, a clock for Recents, then
// All and one tab per family) · an "On chart" card · the library itself. Every library row
// carries a family glyph and a star, so the 77-row catalog reads as seven short lists
// instead of one wall of text — and the four studies a trader actually uses are one tap
// away in the favourites tab instead of eleven rows of scrolling.
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { downloadText } from '../ui/download';
import { favoritesOf, isFavorite as isStoredFavorite, onFavoritesChange, recentOf, toggleFavorite } from './favorites';
import type { Unsubscribe } from '../core/util/types';

export interface IndicatorRow {
    name: string;
    language?: string;
    category?: string;
    /** Core-computed (native) indicator — accent styling + 'native' routing. */
    native?: boolean;
    /** Native type id (routing key for add/remove). */
    nativeType?: string;
    /** Beta badge (native catalog flag). */
    beta?: boolean;
    /**
     * The study's Pine source, when it has one — the row then shows TradingView's `{ }`
     * chip and opens that code in the editor (read-only for a built-in, editable for a
     * library script). Absent ⇒ no chip, exactly like TV's non-Pine built-ins.
     */
    source?: string;
}

const STYLE_ID = 'vela-widget-indpicker';
const CSS = `
.vela-ip-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    margin-bottom: var(--vela-space-2);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
}
.vela-ip-searchrow[hidden] { display: none !important; }
.vela-ip-searchrow:focus-within { border-color: var(--vela-border-strong); }
.vela-ip-searchrow .vela-icon { color: var(--vela-fg-muted); }
.vela-ip-search { flex: 1; background: transparent; color: var(--vela-fg); border: none; font-size: 14px; outline: none; }
/* The tab strip scrolls sideways on a phone; it is a MODE over one list, not navigation. */
.vela-ip-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    touch-action: pan-x;
    margin-bottom: var(--vela-space-2);
    padding-bottom: 2px;
    /* The last visible tab fades instead of being cut in half — the cue that there are
       more families to the right. */
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
}
.vela-ip-tabs::-webkit-scrollbar { display: none; }
.vela-ip-tab {
    all: unset;
    flex: none;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 11px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-ip-tab:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-ip-tab[data-active='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-ip-tab[data-icon='1'] { padding: 0 9px; }
.vela-ip-tab[data-icon='1'] .vela-icon { font-size: 15px; width: 15px; height: 15px; }
.vela-ip-tab[data-fav='1'][data-active='1'] { color: var(--vela-star, var(--vela-highlight)); }
.vela-ip-list { max-height: 50vh; overflow: auto; min-width: 380px; }
/* Mobile (fullscreen dialog): no width floor — 380px would overflow a phone —
   and no height cap; the fullscreen body owns the scrolling. */
[data-layout='mobile'] .vela-ip-list { min-width: 0; max-height: none; }
.vela-ip-list::-webkit-scrollbar { width: 8px; }
.vela-ip-list::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
.vela-ip-group {
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 10px 4px 4px;
    border-bottom: 1px solid var(--vela-border);
    margin-bottom: 2px;
}
.vela-ip-oncard {
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-bottom: var(--vela-space-2);
}
.vela-ip-oncard .vela-ip-group { border-bottom: none; padding-top: 2px; }
.vela-ip-row {
    display: flex;
    align-items: center;
    gap: var(--vela-space-2);
    padding: 7px 6px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
}
.vela-ip-row:hover { background: var(--vela-hover); }
.vela-ip-row[data-present='1'] .vela-ip-name { color: var(--vela-accent); }
/* The family glyph in a squared badge: identical rows of text need a left edge to scan
   down, and a shape reads faster than the category heading three rows above. */
.vela-ip-glyph {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid var(--vela-border);
    background: var(--vela-surface-elev);
    color: var(--vela-fg-muted);
}
.vela-ip-glyph .vela-icon { font-size: 15px; width: 15px; height: 15px; }
.vela-ip-row:hover .vela-ip-glyph { color: var(--vela-fg); border-color: var(--vela-border-strong); }
.vela-ip-name { flex: 1; font-weight: 600; color: var(--vela-fg-bright); font-size: 13px; }
.vela-ip-badge {
    flex: none;
    padding: 1px 7px;
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.vela-ip-code,
.vela-ip-code:hover { color: var(--vela-fg); background: var(--vela-hover); }
.vela-ip-star {
    all: unset;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--vela-radius-sm);
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-ip-star:hover { background: var(--vela-hover); }
.vela-ip-star[data-on='1'] { color: var(--vela-star, var(--vela-highlight)); }
.vela-ip-trash, .vela-ip-gear {
    all: unset;
    cursor: pointer;
    color: var(--vela-fg-muted);
    padding: 2px 4px;
    border-radius: var(--vela-radius-sm);
    font-size: var(--vela-font-size-md);
}
.vela-ip-trash:hover { color: var(--vela-down); background: var(--vela-hover); }
.vela-ip-gear:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
@media (pointer: coarse) {
    .vela-ip-row { min-height: 46px; padding: 0 6px; }
    .vela-ip-star, .vela-ip-code { width: 36px; height: 36px; }
    .vela-ip-gear, .vela-ip-trash { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; }
    .vela-ip-tab { min-height: 36px; }
}
.vela-ip-empty { padding: var(--vela-space-3); color: var(--vela-fg-muted); text-align: center; }
.vela-ip-tab[data-templates='1'] { color: var(--vela-accent); font-weight: 700; }
.vela-ip-tab[data-templates='1'][data-active] { box-shadow: inset 0 -2px 0 var(--vela-accent); }
/* ── Templates tab ─────────────────────────────────────────────────────────── */
.vela-ip-tpl { cursor: default; }
.vela-ip-tpl .vela-ip-name { cursor: pointer; }
.vela-ip-tpl[data-default='1'] .vela-ip-name { color: var(--vela-fg-bright); font-weight: 600; }
.vela-ip-tplmeta { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vela-fg-muted); font-size: var(--vela-font-size-sm, 11px); font-variant-numeric: tabular-nums; }
.vela-ip-flash { margin: 6px 2px; padding: 8px 10px; border-radius: var(--vela-radius-sm); background: var(--vela-hover); color: var(--vela-fg); font-size: var(--vela-font-size-md); }
.vela-ip-flash[data-tone='bad'] { color: var(--vela-down); }
.vela-ip-rename { flex: 1 1 auto; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--vela-border-strong); border-radius: var(--vela-radius-sm); background: var(--vela-surface); color: var(--vela-fg-bright); font: inherit; }
.vela-ip-tplacts { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 8px 10px 34px; }
.vela-ip-verb {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--vela-border);
    border-radius: 999px;
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    cursor: pointer;
}
.vela-ip-verb:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-ip-verb[data-primary='1'] { border-color: var(--vela-accent); color: var(--vela-accent); }
.vela-ip-verb[data-danger='1'] { color: var(--vela-down); }
.vela-ip-verb[data-armed='1'] { background: var(--vela-down); color: var(--vela-fg-on-fill); border-color: transparent; }
.vela-ip-tplfoot { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 2px 4px; }
.vela-ip-saveform { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 2px; }
.vela-ip-market { display: inline-flex; align-items: center; gap: 6px; color: var(--vela-fg-muted); font-size: var(--vela-font-size-md); white-space: nowrap; }
.vela-ip-market input { width: 16px; height: 16px; accent-color: var(--vela-accent); }
@media (pointer: coarse) {
    .vela-ip-verb { min-height: 40px; padding: 0 14px; }
    .vela-ip-rename { height: 40px; }
}
`;

/** Tab sentinels — never real category names. */
const FAV_TAB = '\u0000fav';
const RECENT_TAB = '\u0000recent';
const ALL_TAB = '\u0000all';
const TEMPLATES_TAB = '\u0000templates';

/**
 * The order a trader scans the families in — price overlays first, then the studies that
 * get their own pane. The catalog's rows arrive title-sorted, so first-seen order would be
 * an accident of the alphabet; unknown families keep their first-seen place at the end.
 */
const CATEGORY_ORDER: readonly string[] = [
    'Moving averages',
    'Bands & channels',
    'Overlays',
    'Trend',
    'Oscillators',
    'Volatility',
    'Volume',
];

function rank(category: string): number {
    const i = CATEGORY_ORDER.indexOf(category);
    return i === -1 ? CATEGORY_ORDER.length : i;
}

/** The family glyph for a category — one shape per family, so the eye can jump straight
 *  to the oscillators without reading a heading. */
function categoryIcon(category: string): string {
    const c = category.toLowerCase();
    if (c.includes('oscillat') || c.includes('momentum')) return 'wave';
    if (c.includes('band') || c.includes('channel')) return 'bands';
    if (c.includes('volatil')) return 'price-delta';
    if (c.includes('volume')) return 'style-hlc-bars';
    if (c.includes('averag')) return 'indicators';
    if (c.includes('trend')) return 'arrow-up';
    if (c.includes('overlay')) return 'eye';
    return 'indicators';
}

/** A library row's stable identity for the star: the native type when there is one, the
 *  script's name otherwise (a manifest entry has no other key). */
export function indicatorKey(row: IndicatorRow): string {
    return row.native && row.nativeType ? row.nativeType : row.name;
}

export interface IndicatorPickerOptions {
    /** The manifest library — clicking a row ADDS an instance (repeatable). */
    library: () => readonly IndicatorRow[];
    /** The live instances on the chart — the trash removes one. */
    onChart: () => readonly IndicatorRow[];
    onAdd: (libraryIndex: number) => void;
    onRemove: (instanceIndex: number) => void;
    /** Open ONE live instance's settings from its row. Omitted ⇒ no gear (a host whose
     *  chart has no indicator settings surface keeps the plain remove-only row). */
    onSettings?: (instanceIndex: number) => void;
    /** Open the row's Pine source in the editor (`row.source` is set). */
    onSource?: (row: IndicatorRow) => void;
    /** The starred indicator keys. Omitted ⇒ the shared favourites store (localStorage)
     *  is the source of truth, which is what a lone chart wants. */
    favorites?: () => readonly string[];
    onFavorite?: (key: string, on: boolean) => void;
    /** Recently added keys, newest first. Omitted ⇒ the shared store's own recents. */
    recent?: () => readonly string[];
    /**
     * INDICATOR TEMPLATES — TradingView's own surface, given its own TAB here (the
     * desktop shell also has the labelled Templates dropdown in the topbar; a phone does
     * not, and a template stack is exactly what a thumb wants when it re-skins a chart).
     * Every verb the desktop menu carries is wired through the same host callbacks.
     */
    templates?: IndicatorTemplatesDoor;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
}

/** One saved indicator template, as the tab lists it. */
export interface IndicatorTemplateRow {
    name: string;
    count: number;
    symbol?: string;
    timeframe?: string;
}

/** The template verbs the picker's Templates tab drives — the same set the desktop
 *  dropdown offers: apply (this chart / every chart), save, rename, delete, export,
 *  import, set the default new charts open with, and the read-only built-ins. */
export interface IndicatorTemplatesDoor {
    rows: () => readonly IndicatorTemplateRow[];
    onApply: (name: string, target: 'active' | 'all') => number;
    onSave?: (name: string, includeMarket: boolean) => boolean;
    onRename?: (from: string, to: string) => boolean;
    onDelete?: (name: string) => void;
    onExport?: (name: string) => string | null;
    onImport?: (json: string) => string | null;
    defaultName?: () => string | null;
    onSetDefault?: (name: string | null) => void;
    /** Charts in the layout — gates "Apply to all charts". */
    chartCount?: () => number;
    builtins?: () => readonly { id: string; name: string; description: string; count: number }[];
    onApplyBuiltin?: (id: string) => void;
}

export class IndicatorPicker {
    private readonly dialog: Dialog;
    private readonly list: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly searchRow: HTMLElement;
    private readonly tabs: HTMLElement;
    private readonly opts: IndicatorPickerOptions;
    private readonly offFavorite: Unsubscribe;
    private isOpen = false;
    private activeTab = ALL_TAB;
    /** Templates tab state: the row whose verbs are unfolded, the row being renamed (and
     *  the draft in its field), the save form, two-tap delete, and inline feedback. */
    private tplOpenRow: string | null = null;
    private tplRenaming: string | null = null;
    private tplRenameDraft = '';
    private tplSaving = false;
    private tplArmed: string | null = null;
    private tplFlash: { text: string; tone: 'ok' | 'bad' } | null = null;

    constructor(opts: IndicatorPickerOptions) {
        this.opts = opts;
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.search = doc.createElement('input');
        this.search.className = 'vela-ip-search';
        this.search.placeholder = 'Search…';
        this.search.spellcheck = false;
        this.search.addEventListener('input', () => this.refresh());
        const searchRow = doc.createElement('div');
        searchRow.className = 'vela-ip-searchrow';
        searchRow.append(iconEl('search', doc), this.search);
        this.searchRow = searchRow;
        this.tabs = doc.createElement('div');
        this.tabs.className = 'vela-ip-tabs';
        this.list = doc.createElement('div');
        this.list.className = 'vela-ip-list';
        // A star pressed ANYWHERE (another picker, another chart) repaints an open list.
        this.offFavorite = opts.favorites ? () => undefined : onFavoritesChange(() => this.sync());
        this.dialog = new Dialog({
            title: 'Indicators',
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            // The picker adds/removes indicators live — keep the chart undimmed behind it.
            content: (body) => body.append(this.searchRow, this.tabs, this.list),
            onOpenChange: (open) => {
                this.isOpen = open;
                if (open) {
                    this.search.value = '';
                    this.refresh();
                    // Desktop only: focusing the search on a touch device would pop the
                    // on-screen keyboard over the just-opened fullscreen picker.
                    if (!this.search.closest('[data-layout="mobile"]')) setTimeout(() => this.search.focus(), 0);
                }
                opts.onOpenChange?.(open);
            },
        });
        this.list.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const trash = target.closest<HTMLElement>('.vela-ip-trash');
            const gear = target.closest<HTMLElement>('.vela-ip-gear');
            const star = target.closest<HTMLElement>('.vela-ip-star');
            const code = target.closest<HTMLElement>('.vela-ip-code');
            const row = target.closest<HTMLElement>('.vela-ip-row');
            if (!row) return;
            if (star) {
                // Starring is a SIDE action: it must not add a second instance.
                const key = row.dataset.key ?? '';
                const on = !this.isStarred(key);
                if (this.opts.onFavorite) this.opts.onFavorite(key, on);
                else {
                    const now = toggleFavorite('indicators', key);
                    void now;
                }
                this.refresh();
                return;
            }
            if (gear) {
                // One dialog at a time: on a phone both are full-screen, and stacking the
                // instance's form over the list leaves two ✕ buttons and no back.
                this.close();
                this.opts.onSettings?.(Number(row.dataset.instance));
            } else if (trash) {
                this.opts.onRemove(Number(row.dataset.instance));
            } else if (code) {
                // The `{ }` chip opens the study's code instead of adding it.
                const index = row.dataset.library !== undefined ? Number(row.dataset.library) : -1;
                const entry = index >= 0 ? this.opts.library()[index] : undefined;
                if (entry?.source) {
                    this.close();
                    this.opts.onSource?.(entry);
                }
                return;
            } else if (row.dataset.library !== undefined) {
                this.opts.onAdd(Number(row.dataset.library));
            }
            this.refresh();
        });
    }

    open(): void {
        this.dialog.show();
    }

    /** Re-render the lists if the dialog is open (async catalog updates land late). */
    sync(): void {
        if (this.isOpen) this.refresh();
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.offFavorite();
        this.dialog.destroy();
    }

    private isStarred(key: string): boolean {
        if (!key) return false;
        return this.opts.favorites ? this.opts.favorites().includes(key) : isStoredFavorite('indicators', key);
    }

    private recentKeys(): readonly string[] {
        return this.opts.recent ? this.opts.recent() : recentOf('indicators');
    }

    /** Every family in first-seen order — the tab order mirrors the catalog's own. */
    private categories(library: readonly IndicatorRow[]): string[] {
        const out: string[] = [];
        for (const r of library) {
            const cat = r.category ?? 'General';
            if (!out.includes(cat)) out.push(cat);
        }
        return out.sort((a, b) => rank(a) - rank(b) || out.indexOf(a) - out.indexOf(b));
    }

    private renderTabs(library: readonly IndicatorRow[]): void {
        const doc = this.tabs.ownerDocument;
        const cats = this.categories(library);
        if (this.activeTab !== ALL_TAB && this.activeTab !== FAV_TAB && this.activeTab !== RECENT_TAB && this.activeTab !== TEMPLATES_TAB && !cats.includes(this.activeTab)) {
            this.activeTab = ALL_TAB;
        }
        this.tabs.replaceChildren();
        const tab = (label: string, id: string, opts: { icon?: string; fav?: boolean } = {}): void => {
            const el = doc.createElement('button');
            el.className = 'vela-ip-tab';
            el.type = 'button';
            if (id === TEMPLATES_TAB) {
                el.dataset.templates = '1';
                el.title = 'Indicator templates';
            }
            if (opts.icon) {
                el.dataset.icon = '1';
                el.appendChild(iconEl(id === FAV_TAB && this.activeTab === FAV_TAB ? 'star-filled' : (opts.icon ?? 'indicators'), doc));
                el.setAttribute('aria-label', label);
                el.title = label;
            } else {
                el.textContent = label;
            }
            if (opts.fav) el.dataset.fav = '1';
            if (this.activeTab === id) el.dataset.active = '1';
            el.addEventListener('click', () => {
                this.activeTab = id;
                this.renderTabs(library);
                this.refresh();
            });
            this.tabs.appendChild(el);
        };
        tab('Favourites', FAV_TAB, { icon: 'star', fav: true });
        tab('Recent', RECENT_TAB, { icon: 'clock' });
        // Templates sits BEFORE the families, not at the tail: at 390 px a tab after ten
        // category names is scrolled out of sight — the labelled dropdown's whole point on
        // a phone is that a trader can SEE it. It lists STACKS to apply, not studies to add.
        if (this.opts.templates) tab('Templates', TEMPLATES_TAB);
        tab('All', ALL_TAB);
        for (const cat of cats) tab(cat, cat);
    }

    private refresh(): void {
        const doc = this.list.ownerDocument;
        const q = this.search.value.trim().toLowerCase();
        const library = this.opts.library();
        const instances = this.opts.onChart();
        this.list.replaceChildren();
        this.renderTabs(library);
        // Search narrows STUDIES, not template stacks — hide it on the Templates page
        // instead of leaving a dead field above a list it cannot filter.
        this.searchRow.hidden = this.activeTab === TEMPLATES_TAB;
        // The Templates tab is its own page: no "on chart" card, no search narrowing (the
        // field searches STUDIES), just the stack list and its verbs.
        if (this.activeTab === TEMPLATES_TAB && this.opts.templates) {
            this.renderTemplates(doc);
            return;
        }
        const match = (r: IndicatorRow): boolean => !q || r.name.toLowerCase().includes(q);

        const rowEl = (r: IndicatorRow, where: { library?: number; instance?: number }): HTMLElement => {
            const row = doc.createElement('div');
            row.className = 'vela-ip-row';
            if (where.library !== undefined) row.dataset.library = String(where.library);
            if (where.instance !== undefined) row.dataset.instance = String(where.instance);
            if (r.native) row.dataset.native = '1';
            const key = indicatorKey(r);
            row.dataset.key = key;
            if (this.isStarred(key)) row.dataset.starred = '1';
            if (this.opts.onChart().some((o) => o.native && o.nativeType && o.nativeType === r.nativeType)) row.dataset.present = '1';

            const glyph = doc.createElement('span');
            glyph.className = 'vela-ip-glyph';
            glyph.appendChild(iconEl(categoryIcon(r.category ?? ''), doc));
            row.appendChild(glyph);

            const name = doc.createElement('span');
            name.className = 'vela-ip-name';
            name.textContent = r.name;
            row.appendChild(name);
            if (r.beta) {
                const beta = doc.createElement('span');
                beta.className = 'vela-ip-badge';
                beta.textContent = 'beta';
                row.appendChild(beta);
            }
            if (where.instance !== undefined) {
                const badgeText = r.native ? 'vela' : r.language;
                if (badgeText) {
                    const badge = doc.createElement('span');
                    badge.className = 'vela-ip-badge';
                    badge.textContent = badgeText;
                    row.appendChild(badge);
                }
                // The gear is the row's way into the instance's settings — the legend's own
                // route is folded away on a phone grid, and the picker is where the user
                // already is when they think about an indicator.
                if (this.opts.onSettings) {
                    const gear = doc.createElement('button');
                    gear.className = 'vela-ip-gear';
                    gear.appendChild(iconEl('gear', doc));
                    gear.title = 'Indicator settings';
                    gear.setAttribute('aria-label', `${r.name} settings`);
                    row.appendChild(gear);
                }
                const trash = doc.createElement('button');
                trash.className = 'vela-ip-trash';
                trash.appendChild(iconEl('trash', doc));
                trash.title = 'Remove from chart';
                trash.setAttribute('aria-label', `Remove ${r.name}`);
                row.appendChild(trash);
            } else {
                // TradingView's `{ }` on a catalog row: open the study's code before adding
                // it. Only studies that HAVE Pine code get the chip.
                if (r.source && this.opts.onSource) {
                    const code = doc.createElement('button');
                    code.className = 'vela-ip-code';
                    code.appendChild(iconEl('braces', doc));
                    code.title = 'Source code';
                    code.setAttribute('aria-label', `${r.name} source code`);
                    row.appendChild(code);
                }
                // Library rows get the star — the on-chart card's rows are already chosen,
                // and a star there would sit beside a trash icon saying the opposite.
                const star = doc.createElement('button');
                star.className = 'vela-ip-star';
                const on = this.isStarred(key);
                star.dataset.on = on ? '1' : '';
                star.appendChild(iconEl(on ? 'star-filled' : 'star', doc));
                star.setAttribute('aria-label', on ? `Unfavourite ${r.name}` : `Favourite ${r.name}`);
                star.setAttribute('aria-pressed', on ? 'true' : 'false');
                row.appendChild(star);
            }
            return row;
        };

        // "ON CHART · n" — every live instance (the same script may appear several times).
        const onChart = instances.map((r, i) => [r, i] as const).filter(([r]) => match(r));
        if (onChart.length) {
            const card = doc.createElement('div');
            card.className = 'vela-ip-oncard';
            const title = doc.createElement('div');
            title.className = 'vela-ip-group';
            title.textContent = `On chart · ${onChart.length}`;
            card.appendChild(title);
            for (const [r, i] of onChart) card.appendChild(rowEl(r, { instance: i }));
            this.list.appendChild(card);
        }

        const heading = (text: string): HTMLElement => {
            const el = doc.createElement('div');
            el.className = 'vela-ip-group';
            el.textContent = text;
            return el;
        };

        if (this.activeTab === FAV_TAB) {
            const starred = library.map((r, i) => [r, i] as const).filter(([r]) => this.isStarred(indicatorKey(r)));
            if (starred.length === 0) {
                const empty = doc.createElement('div');
                empty.className = 'vela-ip-empty';
                empty.textContent = 'No favourites yet — tap the star on any indicator to pin it here.';
                this.list.appendChild(empty);
                return;
            }
            for (const [r, i] of starred) this.list.appendChild(rowEl(r, { library: i }));
            return;
        }

        if (this.activeTab === RECENT_TAB) {
            const byKey = new Map<string, readonly [IndicatorRow, number]>();
            library.forEach((r, i) => {
                const k = indicatorKey(r);
                if (!byKey.has(k)) byKey.set(k, [r, i] as const);
            });
            const used = this.recentKeys().map((k) => byKey.get(k)).filter((v): v is readonly [IndicatorRow, number] => !!v);
            if (used.length === 0) {
                const empty = doc.createElement('div');
                empty.className = 'vela-ip-empty';
                empty.textContent = 'Indicators you add appear here, newest first.';
                this.list.appendChild(empty);
                return;
            }
            for (const [r, i] of used) this.list.appendChild(rowEl(r, { library: i }));
            return;
        }

        // The library, grouped by category — clicking ADDS an instance (repeatable).
        const byCat = new Map<string, Array<readonly [IndicatorRow, number]>>();
        library.forEach((r, i) => {
            if (!match(r)) return;
            const cat = r.category ?? 'General';
            if (this.activeTab !== ALL_TAB && cat !== this.activeTab) return;
            const bucket = byCat.get(cat) ?? [];
            bucket.push([r, i] as const);
            byCat.set(cat, bucket);
        });
        // A search hits across families, so its headings stay; a single-family tab does not
        // need to repeat its own name above every row.
        const showHeads = this.activeTab === ALL_TAB;
        const ordered = [...byCat].sort((a, b) => rank(a[0]) - rank(b[0]));
        for (const [cat, bucket] of ordered) {
            if (showHeads) this.list.appendChild(heading(cat));
            for (const [r, i] of bucket) this.list.appendChild(rowEl(r, { library: i }));
        }
        if (!onChart.length && byCat.size === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ip-empty';
            empty.textContent = library.length ? 'No indicators match.' : 'No indicators in the manifest.';
            this.list.appendChild(empty);
        }
    }

    // ── Templates tab ───────────────────────────────────────────────────────────
    /**
     * The saved stacks, TradingView's own vocabulary on every row: the name and what it
     * holds (`4 indicators · BTCUSDT · 1h` when it was saved with the market), a star for
     * the DEFAULT template new charts open with, and a ⋯ that unfolds Apply / Apply to all
     * charts / Rename / Export / Delete. Saving and importing sit at the foot of the list,
     * where a thumb arrives after scrolling the stacks it already has.
     */
    private renderTemplates(doc: Document): void {
        const t = this.opts.templates;
        if (!t) return;
        if (this.tplFlash) {
            const flash = doc.createElement('div');
            flash.className = 'vela-ip-flash';
            flash.dataset.tone = this.tplFlash.tone;
            flash.textContent = this.tplFlash.text;
            this.list.appendChild(flash);
            this.tplFlash = null;
        }
        const rows = t.rows();
        const def = t.defaultName?.() ?? null;
        if (rows.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ip-empty';
            empty.textContent = 'No templates yet. Add the indicators you want, then Save the current stack as a template — it re-skins any chart in one tap.';
            this.list.appendChild(empty);
        }
        for (const r of rows) {
            const row = doc.createElement('div');
            row.className = 'vela-ip-row vela-ip-tpl';
            row.dataset.template = r.name;
            row.dataset.default = def === r.name ? '1' : '';

            const glyph = doc.createElement('span');
            glyph.className = 'vela-ip-glyph';
            glyph.appendChild(iconEl('templates', doc));
            row.appendChild(glyph);

            if (this.tplRenaming === r.name) {
                const field = doc.createElement('input');
                field.className = 'vela-ip-rename';
                field.value = this.tplRenameDraft;
                field.setAttribute('aria-label', 'Template name');
                field.addEventListener('input', () => { this.tplRenameDraft = field.value; });
                field.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') this.commitRename(r.name);
                    if (e.key === 'Escape') { this.tplRenaming = null; this.refresh(); }
                });
                const ok = doc.createElement('button');
                ok.type = 'button';
                ok.className = 'vela-ip-trash';
                ok.appendChild(iconEl('check', doc));
                ok.setAttribute('aria-label', 'Save name');
                ok.addEventListener('click', () => this.commitRename(r.name));
                row.append(field, ok);
                this.list.appendChild(row);
                setTimeout(() => { field.focus(); field.select(); }, 0);
                continue;
            }

            const name = doc.createElement('span');
            name.className = 'vela-ip-name';
            name.textContent = r.name;
            row.appendChild(name);
            const meta = doc.createElement('span');
            meta.className = 'vela-ip-tplmeta';
            meta.textContent = `${r.count} indicator${r.count === 1 ? '' : 's'}${r.symbol ? ` · ${r.symbol}` : ''}${r.timeframe ? ` · ${r.timeframe}` : ''}`;
            row.appendChild(meta);

            // Applying is the row's tap (TV's rule: click a template, the chart re-skins).
            name.addEventListener('click', () => this.applyTemplate(r.name, 'active'));

            if (t.onSetDefault) {
                const star = doc.createElement('button');
                star.className = 'vela-ip-star';
                const on = def === r.name;
                star.dataset.on = on ? '1' : '';
                star.appendChild(iconEl(on ? 'star-filled' : 'star', doc));
                star.setAttribute('aria-pressed', on ? 'true' : 'false');
                star.setAttribute('aria-label', on ? `${r.name} is the default template` : `Make ${r.name} the default template`);
                star.addEventListener('click', () => {
                    t.onSetDefault?.(on ? null : r.name);
                    this.tplFlash = { text: on ? 'Default template cleared.' : `New charts will open with “${r.name}”.`, tone: 'ok' };
                    this.refresh();
                });
                row.appendChild(star);
            }
            const more = doc.createElement('button');
            more.className = 'vela-ip-star vela-ip-tplmore';
            more.appendChild(iconEl('kebab', doc));
            more.setAttribute('aria-label', `${r.name} actions`);
            more.setAttribute('aria-expanded', this.tplOpenRow === r.name ? 'true' : 'false');
            more.addEventListener('click', () => {
                this.tplOpenRow = this.tplOpenRow === r.name ? null : r.name;
                this.tplArmed = null;
                this.refresh();
            });
            row.appendChild(more);
            this.list.appendChild(row);

            if (this.tplOpenRow === r.name) this.list.appendChild(this.templateActions(doc, r.name, (t.chartCount?.() ?? 1) > 1));
        }

        const builtins = t.builtins?.() ?? [];
        if (builtins.length > 0) {
            const head = doc.createElement('div');
            head.className = 'vela-ip-group';
            head.textContent = 'Built-in · read-only';
            this.list.appendChild(head);
            for (const b of builtins) {
                const row = doc.createElement('div');
                row.className = 'vela-ip-row vela-ip-tpl';
                row.dataset.builtin = b.id;
                const glyph = doc.createElement('span');
                glyph.className = 'vela-ip-glyph';
                glyph.appendChild(iconEl('templates', doc));
                const name = doc.createElement('span');
                name.className = 'vela-ip-name';
                name.textContent = b.name;
                const meta = doc.createElement('span');
                meta.className = 'vela-ip-tplmeta';
                meta.textContent = `${b.description} · ${b.count}`;
                row.append(glyph, name, meta);
                row.addEventListener('click', () => {
                    t.onApplyBuiltin?.(b.id);
                    this.tplFlash = { text: `Applied the built-in “${b.name}”.`, tone: 'ok' };
                    this.refresh();
                });
                this.list.appendChild(row);
            }
        }
        this.renderTemplatesSaveRow(doc);
    }

    private templateActions(doc: Document, name: string, multi: boolean): HTMLElement {
        const t = this.opts.templates;
        const strip = doc.createElement('div');
        strip.className = 'vela-ip-tplacts';
        if (!t) return strip;
        const verb = (label: string, run: () => void, opts: { danger?: boolean; armed?: boolean } = {}): void => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-ip-verb';
            b.textContent = opts.armed ? `Tap again to ${label.toLowerCase()}` : label;
            if (opts.danger) b.dataset.danger = '1';
            if (opts.armed) b.dataset.armed = '1';
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                run();
            });
            strip.appendChild(b);
        };
        verb('Apply to this chart', () => this.applyTemplate(name, 'active'));
        if (multi && t.onApply) {
            verb('Apply to all charts', () => {
                const n = t.onApply(name, 'all');
                this.tplOpenRow = null;
                this.tplFlash = { text: `Applied “${name}” to ${n} chart${n === 1 ? '' : 's'}.`, tone: 'ok' };
                this.refresh();
            });
        }
        if (t.onRename) {
            verb('Rename', () => {
                this.tplRenaming = name;
                this.tplRenameDraft = name;
                this.tplOpenRow = null;
                this.refresh();
            });
        }
        if (t.onExport) {
            verb('Export', () => {
                const json = t.onExport?.(name);
                if (json) downloadText(doc, `${name}.vela-template.json`, json);
                this.tplOpenRow = null;
                this.refresh();
            });
        }
        if (t.onDelete) {
            verb('Delete', () => {
                if (this.tplArmed !== name) {
                    this.tplArmed = name;
                    this.refresh();
                    return;
                }
                t.onDelete?.(name);
                this.tplArmed = null;
                this.tplOpenRow = null;
                this.tplFlash = { text: `Deleted “${name}”.`, tone: 'ok' };
                this.refresh();
            }, { danger: true, armed: this.tplArmed === name });
        }
        return strip;
    }

    private applyTemplate(name: string, target: 'active' | 'all'): void {
        const t = this.opts.templates;
        if (!t) return;
        const n = t.onApply(name, target);
        this.tplOpenRow = null;
        this.tplFlash = n > 0 ? { text: `Applied “${name}”.`, tone: 'ok' } : { text: `“${name}” could not be applied.`, tone: 'bad' };
        this.refresh();
    }

    private commitRename(from: string): void {
        const t = this.opts.templates;
        const to = this.tplRenameDraft.trim();
        if (!t?.onRename || !to) return;
        const ok = t.onRename(from, to);
        this.tplFlash = ok ? { text: `Renamed to “${to}”.`, tone: 'ok' } : { text: `“${to}” is already taken.`, tone: 'bad' };
        if (ok) this.tplRenaming = null;
        this.refresh();
    }

    /** Save the current stack + import, at the foot of the Templates tab. */
    private renderTemplatesSaveRow(doc: Document): void {
        const t = this.opts.templates;
        if (!t) return;
        if (this.tplSaving && t.onSave) {
            const form = doc.createElement('div');
            form.className = 'vela-ip-saveform';
            const input = doc.createElement('input');
            input.className = 'vela-ip-rename';
            input.placeholder = 'Template name';
            input.setAttribute('aria-label', 'Save indicator template as');
            const chip = doc.createElement('label');
            chip.className = 'vela-ip-market';
            const box = doc.createElement('input');
            box.type = 'checkbox';
            const chipText = doc.createElement('span');
            chipText.textContent = 'remember market';
            chip.append(box, chipText);
            const save = doc.createElement('button');
            save.type = 'button';
            save.className = 'vela-ip-verb';
            save.dataset.primary = '1';
            save.textContent = 'Save';
            const commit = (): void => {
                const name = input.value.trim();
                if (!name) { input.focus(); return; }
                const ok = t.onSave?.(name, box.checked) ?? false;
                this.tplFlash = ok ? { text: `Saved “${name}”.`, tone: 'ok' } : { text: 'That name is empty or already used.', tone: 'bad' };
                if (ok) { this.tplSaving = false; }
                this.refresh();
            };
            save.addEventListener('click', commit);
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { this.tplSaving = false; this.refresh(); }
            });
            form.append(input, chip, save);
            this.list.appendChild(form);
            setTimeout(() => input.focus(), 0);
            return;
        }
        const foot = doc.createElement('div');
        foot.className = 'vela-ip-tplfoot';
        if (t.onSave) {
            const save = doc.createElement('button');
            save.type = 'button';
            save.className = 'vela-ip-verb';
            save.dataset.primary = '1';
            save.appendChild(iconEl('plus', doc));
            save.appendChild(doc.createTextNode(`Save current (${this.opts.onChart().length}) as template`));
            save.addEventListener('click', () => { this.tplSaving = true; this.refresh(); });
            foot.appendChild(save);
        }
        if (t.onImport) {
            const file = doc.createElement('input');
            file.type = 'file';
            file.accept = 'application/json,.json';
            file.hidden = true;
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'vela-ip-verb';
            btn.appendChild(iconEl('download', doc));
            btn.appendChild(doc.createTextNode('Import'));
            btn.addEventListener('click', () => file.click());
            file.addEventListener('change', async () => {
                const f = file.files?.[0];
                if (!f) return;
                const text = await f.text();
                const name = t.onImport?.(text) ?? null;
                this.tplFlash = name ? { text: `Imported “${name}”.`, tone: 'ok' } : { text: 'That file is not a Vela template.', tone: 'bad' };
                this.refresh();
            });
            foot.append(file, btn);
        }
        this.list.appendChild(foot);
    }
}
