// Mobile bottom bar — the ONE navigation surface of the mobile chrome, built the way a
// phone toolbar is built: TWO FIXED ZONES and a scrollable band between them.
//
//   ┌──────────────┬───────────────────────────────────────────────┬────────────┐
//   │ BTCUSDT  ⌄   │  1h   ▮style  ✎draw  ⤢  ƒx  {}  (contributed) │  ⋯①   │   ⚙    │
//   └──────────────┴───────────────────────────────────────────────┴────────────┘
//     leading: the pair          middle: tools, in reading order      trailing
//
// Why: a strip where EVERY stop scrolls is a strip where the two stops you cannot work
// without — the pair you are looking at, and More/Settings — eventually scroll out of
// reach on a 320px phone (that is what the old bar did: `overflow-x: auto` on the whole
// row, so the last two stops sat past the fold). Apple's HIG puts it plainly: a toolbar
// has a leading title, trailing actions and a More menu, and to "accommodate variable
// view widths" the width problem is solved by moving items, not by letting the frame
// slide. TradingView's own phone chart does the same — the pair and the interval answer
// "what am I looking at", the three-dot More sits pinned bottom-right with layouts and
// settings, and the tools between them scroll.
//
// So: the pair (a ≤15-character title, exactly what HIG asks a toolbar title to be) and
// More/Settings are OUTSIDE the scroller and never move; the tools in between — interval,
// chart type, drawings, full/short screen, indicators, script editor, then whatever a host
// contributes — live in a snapped, edge-faded band that scrolls sideways on narrow screens
// and simply fits on a wide one. Nothing is hidden at 320px any more, nothing is lost at
// 430px, and the two doors out of the bar are always a thumb away.
//
// Two stops are MIRRORS, not doors: "chart type" and "drawings" show what is actually in
// force on the active chart — the same rule the desktop chrome plays by. A trader who
// switched charts or armed a tool from the keyboard, the drawer or the API must never
// read a stale glyph off the phone's most-used strip.
import { iconEl, iconMarkup } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { floatingLayerHost } from '../ui/tokens';
import { parseSymbol } from '../data/ProviderRegistry';
import { installSymbolQuickSwitch, type SymbolQuickSwitchHandle } from './symbol-quick-switch';
import { timeframeLabel } from './timeframe';
import { mobilePlacement, widgetActions, type WidgetContext } from './contributions';
import { TOPBAR_BUILTIN_IDS } from './topbar-composition';
import { getDrawingType } from '../core/drawings';
import type { Vela } from '../Vela';
import { ChartTypeSheet, type ChartTypeOption } from './chart-type-sheet';
import { recordRecent } from './favorites';

const STYLE_ID = 'vela-widget-mobilebar';
const CSS = `
.vela-mobilebar {
    display: none;
    align-items: stretch;
    gap: 0;
    /* 48px of controls + the home-indicator inset: the bar clears an iPhone's safe area
       instead of sitting under it (the old bar only padded the bottom, so on a notched
       phone the stops sat in the gesture strip). */
    height: calc(48px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    border-top: 1px solid var(--vela-border);
    /* A translucent surface with the chart showing through — the platform's own material,
       never a flat slab. The plain colour is the fallback for engines without backdrop. */
    background: var(--vela-panel);
    background: color-mix(in srgb, var(--vela-panel) 94%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(1.15);
    backdrop-filter: blur(14px) saturate(1.15);
    color: var(--vela-fg-muted);
    flex: none;
    position: relative;
    z-index: 6;
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.12);
    /* The bar NEVER scrolls — the band inside it does (see .vela-mb-scroll). Without this
       the document itself grew 20px wide and the whole page panned sideways. */
    overflow: hidden;
}
[data-layout='mobile'] .vela-mobilebar { display: flex; }
[data-layout='mobile'] .vela-widget-topbar { display: none; }
[data-layout='mobile'] .vela-widget-bottombar { display: none; }

/* ── the leading zone: the pair, always where it is ─────────────────────────────
   A toolbar title, in HIG's sense: short, leading, and never scrolled away. It gets a
   hard ceiling (42%) so a long ticker cannot eat the tools, and it ellipsises instead of
   pushing them. 84px is the floor that still reads "BTCUSDT" on a 320px phone.
   Scoped to the bar on purpose: the zone is also a vela-mb-item (it shares the chip's
   reset), and that rule's 44px floor / max-width: unset land LATER in this sheet — an
   unscoped selector loses the cascade and the pair shrank to its text (53px) on a 390px
   phone with the band pushing it. Two classes beat one; the floor is now real. */
.vela-mobilebar .vela-mb-symbol {
    flex: 0 0 auto;
    min-width: 84px;
    max-width: 42%;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    padding: 0 6px 0 12px;
    border-radius: 10px;
    margin: 2px 0 2px 2px;
    font-size: 13.5px;
    font-weight: 650;
    letter-spacing: 0.2px;
    color: var(--vela-fg-bright);
    font-variant-numeric: tabular-nums;
}
.vela-mb-symbol-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-mb-symbol .vela-icon { flex: none; font-size: 12px; width: 12px; height: 12px; opacity: 0.5; }

/* The hairline between a FIXED zone and the scrolling band: it says "this edge holds". */
.vela-mb-rule { flex: none; width: 1px; align-self: center; height: 20px; background: var(--vela-border); margin: 0 4px; }

/* ── the middle band: the tools, and the only thing that scrolls ─────────────── */
.vela-mb-scroll {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    /* Dense, TradingView-style row: the 19px glyphs already carry the optical gap, so the
       stops sit flush. Kept at 0 because five 44px stops + padding are exactly what a
       430px phone can hold — 2px of gap each pushed the band 8px past the fit and left a
       permanent fade over an empty host slot. */
    gap: 0;
    padding: 0 2px;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    /* Snap so a flick lands on a chip, not between two — and so the band cannot come to
       rest showing half a target. Proximity, not mandatory: a short band (a shell
       without the editor) must still be able to sit at rest. */
    scroll-snap-type: x proximity;
}
.vela-mb-scroll::-webkit-scrollbar { display: none; }
.vela-mb-scroll > * { scroll-snap-align: center; }
/* The fade that says "there is more" without a scrollbar: a mask on the band, toggled by
   the bar's own data-edge (none / start / end / both) as the band scrolls. */
.vela-mobilebar[data-edge='end'] .vela-mb-scroll {
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 18px), transparent 100%);
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 18px), transparent 100%);
}
.vela-mobilebar[data-edge='start'] .vela-mb-scroll {
    -webkit-mask-image: linear-gradient(to left, #000 0, #000 calc(100% - 18px), transparent 100%);
    mask-image: linear-gradient(to left, #000 0, #000 calc(100% - 18px), transparent 100%);
}
.vela-mobilebar[data-edge='both'] .vela-mb-scroll {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%);
}

/* ── the trailing zone: More and Settings, pinned ────────────────────────────── */
.vela-mb-trail {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px 0 2px;
}

/* ── one stop ─────────────────────────────────────────────────────────────────
   44px is the floor for EVERY stop: a 33px icon button at 320px was a miss factory. */
.vela-mb-item {
    all: unset;
    flex: 0 0 auto;
    position: relative;
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 10px;
    cursor: pointer;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
    transition: background 120ms ease, color 120ms ease;
}
@media (prefers-reduced-motion: reduce) { .vela-mb-item { transition: none; } }
.vela-mb-item[hidden] { display: none !important; }
.vela-mb-item:active, .vela-mb-alerts[aria-pressed='true'] { background: var(--vela-hover); }
.vela-mb-item:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
/* A history stop with nothing to undo/redo: dimmed and inert, never hidden — the pair
 * must keep its place so the scrolling band never reflows under a thumb. */
.vela-mb-item[aria-disabled='true'] { opacity: .38; pointer-events: none; }
.vela-mb-item .vela-icon { font-size: 19px; width: 19px; height: 19px; }
/* A lit stop (the maximize toggle while something is isolated): the inverse
   "selected" chip — white on the dark theme, dark on the light one. */
.vela-mb-item.vela-mb-on, .vela-mb-item.vela-mb-on:active { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
/* Left-aligned contributed actions get their own stops — the wrapper is layout-transparent
   so each stop flexes like a sibling inside the band. */
.vela-mb-actions { display: contents; }

/* The interval: a value, not a glyph — tabular so 1h → 4h → 1D never shifts the row. */
.vela-mb-tf { padding: 0 10px; font-variant-numeric: tabular-nums; letter-spacing: 0.2px; }

/* The chart-type stop — a fixed slot (no text, so no reflow when the style changes). */
.vela-mb-style .vela-mb-glyph { display: inline-flex; width: 19px; height: 19px; }
.vela-mb-style .vela-mb-glyph svg { width: 19px; height: 19px; }
.vela-mb-style[aria-expanded='true'] { background: var(--vela-hover); }
/* Every stop that opens a surface washes the same way while it is open — one open-state
   language across the bar, not a special case for the chart-type stop. */
.vela-mb-item[aria-expanded='true'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-mb-item[aria-pressed='true'] { background: var(--vela-hover); color: var(--vela-accent-ink, var(--vela-accent)); }
/* The drawings stop mirrors the armed tool: accent ink + a lit chip while a tool (or the
   eraser) is armed, the plain pencil when nothing is. */
.vela-mb-drawings .vela-mb-glyph { display: inline-flex; width: 18px; height: 18px; }
.vela-mb-drawings .vela-mb-glyph svg { width: 18px; height: 18px; }
.vela-mb-drawings.vela-mb-armed { color: var(--vela-accent-ink, var(--vela-accent)); background: var(--vela-hover); }

/* The More stop's badge: how many charts a smaller layout set aside. A count the trader
   cannot get to otherwise, on the door that opens them (More → Hidden charts). */
.vela-mb-badge {
    position: absolute;
    top: 5px;
    right: 3px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
.vela-mb-badge[hidden] { display: none; }

/* 320px: the band gets narrow, so the chips keep their 44px floor and the band scrolls —
   nothing steps aside any more (the old bar hid the maximize stop here). The pair keeps a
   readable floor and More/Settings keep their full targets. */
@media (max-width: 380px) {
    .vela-mb-symbol { padding-left: 10px; font-size: 13px; }
    .vela-mb-rule { margin: 0 2px; }
}
`;

export interface MobileBarOptions {
    symbol: string;
    timeframe: string;
    onSymbolClick: () => void;
    /** Watchlist-style wheel/drag: +1 = next symbol, -1 = previous. No picker panel opens. */
    onSymbolStep?: (delta: number) => void;
    onTimeframeClick: () => void;
    /** Direct Alerts pane stop, omitted when composition hides the slot. */
    onAlertsClick?: () => void;
    /** Omitted ⇒ no indicators stop (the composition hides the 'indicators' slot, or
     *  the deprecated `indicatorPicker: false`). A slot OVERRIDE keeps the stop — the
     *  shell passes a callback routed to the override. */
    onIndicatorsClick?: () => void;
    /** Omitted ⇒ no drawings stop (the shell disabled user drawings — `drawings: false`). */
    onDrawingsClick?: () => void;
    /** Omitted ⇒ no script-editor stop (the shell has no scripting engine, so no editor).
     *  Sits between the indicators and the drawings stops: the phone's way into the
     *  editor pane, one tap and no drawer, exactly where a desktop's panel toggle is. */
    onEditorClick?: () => void;
    /**
     * The CHART-TYPE stop. It replaces the old layout-count stop: its glyph is the price
     * style currently on the active chart and tapping it raises the style sheet, because
     * "which chart is this" is read far more often than "how many panes are there".
     * Without {@link styleOptions} the stop is not built at all.
     */
    styleOptions?: () => ChartTypeOption[];
    /** The style in force on the active chart (read on every sync). */
    currentStyle?: () => string;
    onStyleSelect?: (id: string) => void;
    /** Optional right-side text chip on the style stop (off by default — the glyph is the
     *  statement; a 19-style menu does not need its name spelled out in the bar). */
    showStyleLabel?: boolean;
    /**
     * The LAYOUT door, now one quiet row inside the style sheet (the bar stop it used to
     * own became the chart type). Feeds that row's label/glyph, never the bar itself.
     */
    layoutLabel?: () => string;
    onLayoutClick?: () => void;
    /** Glyph of the current grid, for the sheet's layout row (defaults to `layout`). */
    layoutGlyph?: () => string;
    /** The starred chart types (a shell-owned, persisted set) — read on every open. */
    styleFavorites?: () => readonly string[];
    /** Star/unstar a chart type. Omitted ⇒ the sheet falls back to its local store. */
    onStyleFavorite?: (id: string, on: boolean) => void;
    /** Omitted ⇒ no maximize stop (single-chart shells — nothing to isolate). The
     *  workspace passes a toggle that isolates the active chart over the grid;
     *  {@link setMaximizeActive} lights the stop while something is isolated. */
    onMaximizeClick?: () => void;
    /** Undo / redo of the ACTIVE chart's history — TradingView keeps these on the chart's
     *  own bar, not buried in More: they are two of the most-tapped verbs on a phone.
     *  Omitted together ⇒ neither stop is built (a shell with no history). */
    onUndoClick?: () => void;
    onRedoClick?: () => void;
    onMoreClick: () => void;
    onSettingsClick: () => void;
    /** Live widget context — left-aligned contributed actions (`align: 'left'`)
     *  project as icon-only stops in the indicators slot. */
    getContext?: () => WidgetContext;
}

export class MobileBar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLButtonElement;
    private readonly symbolQuick: SymbolQuickSwitchHandle | null = null;
    /** The scrolling middle band — the only part of the bar that moves. */
    private readonly scroller: HTMLElement;
    /** The pinned right zone (More + Settings). */
    private readonly trail: HTMLElement;
    /** The More stop's hidden-chart count (null when the shell has no count to give). */
    private readonly badgeEl: HTMLElement;
    private readonly tfEl: HTMLElement;
    private readonly alertsEl: HTMLButtonElement | null;
    private readonly alertsBadge: HTMLElement | null;
    /** The chart-type stop (null when the shell passes no style options). */
    private readonly styleEl: HTMLButtonElement | null;
    private readonly styleGlyph: HTMLElement | null;
    /** The maximize toggle stop (null when the shell has nothing to isolate). */
    private readonly maxEl: HTMLButtonElement | null;
    /** Undo / redo of the active chart (null when the shell carries no history). */
    private readonly undoEl: HTMLButtonElement | null = null;
    private readonly redoEl: HTMLButtonElement | null = null;
    /** The drawings stop and the span that carries the armed tool's glyph. */
    private readonly drawingEl: HTMLButtonElement | null;
    private readonly drawingGlyph: HTMLElement | null;
    /** Left-aligned contributed actions — filled by {@link renderActions}. */
    private readonly actionsHost: HTMLElement;
    private readonly opts: MobileBarOptions;
    private sheet: ChartTypeSheet | null = null;
    private chart: Vela | null = null;
    private chartSubs: Array<() => void> = [];
    private styleId = '';
    private resizeObs: ResizeObserver | null = null;

    constructor(host: HTMLElement, opts: MobileBarOptions) {
        this.opts = opts;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-mobilebar';
        this.el.setAttribute('role', 'toolbar');
        this.el.setAttribute('aria-label', 'Chart tools');
        this.el.dataset.edge = 'none';

        const item = (cls: string, label: string, onClick: () => void, icon?: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = `vela-mb-item ${cls}`;
            b.setAttribute('aria-label', label);
            if (icon) b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        // ── leading: the pair ──
        // A toolbar TITLE, not a stop that can scroll: the ticker, a chevron that says
        // "this opens the symbol search", and nothing else.
        this.symbolEl = item('vela-mb-symbol', 'Symbol search', opts.onSymbolClick);
        this.symbolEl.setAttribute('aria-haspopup', 'dialog');
        this.symbolEl.setAttribute('aria-expanded', 'false');
        if (opts.onSymbolStep) this.symbolQuick = installSymbolQuickSwitch(this.symbolEl, opts.onSymbolStep);
        this.setSymbol(opts.symbol);
        this.tfEl = item('vela-mb-tf', 'Timeframe', opts.onTimeframeClick);
        this.tfEl.textContent = timeframeLabel(opts.timeframe);
        this.tfEl.setAttribute('aria-haspopup', 'dialog');
        this.tfEl.setAttribute('aria-expanded', 'false');

        this.alertsEl = opts.onAlertsClick ? item('vela-mb-alerts', 'Alerts', opts.onAlertsClick, 'bell') : null;
        this.alertsBadge = this.alertsEl ? doc.createElement('span') : null;
        if (this.alertsEl && this.alertsBadge) {
            this.alertsEl.setAttribute('aria-pressed', 'false');
            this.alertsBadge.className = 'vela-mb-badge';
            this.alertsBadge.hidden = true;
            this.alertsBadge.setAttribute('aria-hidden', 'true');
            this.alertsEl.appendChild(this.alertsBadge);
        }

        // ── chart type (the slot the layout count used to hold) ──
        if (opts.styleOptions) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item vela-mb-style';
            b.setAttribute('aria-haspopup', 'dialog');
            b.setAttribute('aria-expanded', 'false');
            const glyph = doc.createElement('span');
            glyph.className = 'vela-mb-glyph';
            b.appendChild(glyph);
            if (opts.showStyleLabel) {
                const text = doc.createElement('span');
                text.className = 'vela-mb-styletext';
                b.appendChild(text);
            }
            b.addEventListener('click', () => this.openSheet());
            this.styleEl = b;
            this.styleGlyph = glyph;
            this.setPriceStyle(opts.currentStyle?.() ?? '');
        } else {
            this.styleEl = null;
            this.styleGlyph = null;
        }

        const onIndicators = opts.onIndicatorsClick;
        const indicators = onIndicators ? item('vela-mb-indicators', 'Indicators', onIndicators, 'indicators') : null;
        if (indicators) {
            indicators.setAttribute('aria-haspopup', 'dialog');
            indicators.setAttribute('aria-expanded', 'false');
        }
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-mb-actions';

        // ── the script editor (a pane on the phone, not a page) ──
        const onEditor = opts.onEditorClick;
        const editor = onEditor ? item('vela-mb-editor', 'Pine editor', onEditor, 'code') : null;

        // ── drawings (glyph = armed tool) ──
        const onDrawings = opts.onDrawingsClick;
        if (onDrawings) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item vela-mb-drawings';
            b.setAttribute('aria-label', 'Drawings');
            b.setAttribute('aria-haspopup', 'dialog');
            b.setAttribute('aria-expanded', 'false');
            const glyph = doc.createElement('span');
            glyph.className = 'vela-mb-glyph';
            b.appendChild(glyph);
            b.addEventListener('click', onDrawings);
            this.drawingEl = b;
            this.drawingGlyph = glyph;
            glyph.innerHTML = iconMarkup('pen') ?? '';
        } else {
            this.drawingEl = null;
            this.drawingGlyph = null;
        }

        const onMaximize = opts.onMaximizeClick;
        this.maxEl = onMaximize ? item('vela-mb-maximize', 'Maximize chart', onMaximize, 'maximize') : null;

        // ── undo / redo: state-bound stops in the scrolling band's HEAD ──
        // Both are state-bound (a disabled stop says "nothing to undo"), so they read as
        // the chart's own history rather than as another door into a sheet.
        this.undoEl = opts.onUndoClick ? item('vela-mb-undo', 'Undo', opts.onUndoClick, 'undo') : null;
        this.redoEl = opts.onRedoClick ? item('vela-mb-redo', 'Redo', opts.onRedoClick, 'redo') : null;
        // Before the first history event there is nothing to undo — say so from the first
        // paint instead of offering two live-looking buttons that do nothing.
        this.setHistory(false, false);

        // ── trailing: More + Settings, pinned ──
        // The two doors out of the bar. TradingView parks its three-dot More in the
        // bottom-right corner and hangs layouts, chart type, settings and help off it;
        // here it is the same promise, and Settings gets its own stop because a chart's
        // settings are the one sheet a trader opens with a thumb mid-trade.
        const more = item('vela-mb-more', 'More', opts.onMoreClick, 'kebab');
        this.badgeEl = doc.createElement('span');
        this.badgeEl.className = 'vela-mb-badge';
        this.badgeEl.hidden = true;
        this.badgeEl.setAttribute('aria-hidden', 'true');
        more.appendChild(this.badgeEl);
        const settings = item('vela-mb-settings', 'Chart settings', opts.onSettingsClick, 'gear');

        // ── the middle band: tools in reading order ──
        // interval → chart type → undo/redo → drawings → full/short screen →
        // indicators → editor, then anything a host contributes. Only this part scrolls.
        this.scroller = doc.createElement('div');
        this.scroller.className = 'vela-mb-scroll';
        this.scroller.append(
            ...(this.alertsEl ? [this.alertsEl] : []),
            this.tfEl,
            ...(this.styleEl ? [this.styleEl] : []),
            // Undo / redo sit in the HEAD of the band, one stop off the chart type: the
            // band is ~3½ stops wide on a 390px phone, so anything parked at its tail
            // (the first cut) spent its life scrolled out of sight behind More.
            ...(this.undoEl ? [this.undoEl] : []),
            ...(this.redoEl ? [this.redoEl] : []),
            ...(this.drawingEl ? [this.drawingEl] : []),
            ...(this.maxEl ? [this.maxEl] : []),
            ...(indicators ? [indicators] : []),
            ...(editor ? [editor] : []),
            this.actionsHost,
        );
        this.trail = doc.createElement('div');
        this.trail.className = 'vela-mb-trail';
        this.trail.append(more, settings);

        const rule = (): HTMLElement => {
            const el = doc.createElement('span');
            el.className = 'vela-mb-rule';
            el.setAttribute('aria-hidden', 'true');
            return el;
        };
        this.el.append(this.symbolEl, rule(), this.scroller, rule(), this.trail);
        host.appendChild(this.el);

        // The band's fades follow its own scroll — and its own WIDTH (a rotation, a split
        // view, a host resizing the container all change whether it scrolls at all).
        this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
        this.scroller.addEventListener('focusin', this.onFocusIn);
        this.scroller.addEventListener('keydown', this.onKeydown);
        const win = doc.defaultView;
        if (typeof win?.ResizeObserver === 'function') {
            this.resizeObs = new win.ResizeObserver(() => this.syncEdges());
            this.resizeObs.observe(this.el);
            this.resizeObs.observe(this.scroller);
        }
        this.renderActions();
        this.syncEdges();
    }

    /** The band scrolled: re-aim the edge fades (cheap — two numbers and a lookup). */
    private readonly onScroll = (): void => this.syncEdges();

    /** A chip took focus (Tab, or an arrow key): bring it into the band's view, centred. */
    private readonly onFocusIn = (ev: FocusEvent): void => {
        const el = ev.target as HTMLElement | null;
        if (!el || el === this.scroller || !this.scroller.contains(el)) return;
        // Touch focus is dispatched between pointer-up and click. Moving the strip
        // synchronously then shifts the button out from under the finger, so the first
        // tap is lost on narrow phones. Reveal it only after that click has dispatched.
        setTimeout(() => {
            if (!el.isConnected || el.ownerDocument.activeElement !== el) return;
            el.scrollIntoView?.({ inline: 'center', block: 'nearest' });
            this.syncEdges();
        }, 0);
    };

    /**
     * Arrows walk the band (roving focus), Home/End jump to its ends. A toolbar is ONE
     * tab stop by convention; inside it, the keyboard moves between stops the way the eye
     * does — left and right — and the band scrolls to keep the focused chip visible.
     */
    private readonly onKeydown = (ev: KeyboardEvent): void => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(ev.key)) return;
        const stops = [...this.scroller.querySelectorAll<HTMLElement>('button:not([hidden]):not([disabled])')];
        if (stops.length === 0) return;
        const here = stops.indexOf(this.el.ownerDocument.activeElement as HTMLElement);
        let next = 0;
        if (ev.key === 'ArrowLeft') next = here <= 0 ? 0 : here - 1;
        else if (ev.key === 'ArrowRight') next = here < 0 ? 0 : Math.min(stops.length - 1, here + 1);
        else if (ev.key === 'End') next = stops.length - 1;
        ev.preventDefault();
        stops[next]?.focus({ preventScroll: true });
        stops[next]?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
        this.syncEdges();
    };

    /** Which edge of the band still has content: none / start / end / both. */
    private syncEdges(): void {
        const el = this.scroller;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 1) {
            this.el.dataset.edge = 'none';
            return;
        }
        const atStart = el.scrollLeft <= 1;
        const atEnd = el.scrollLeft >= max - 1;
        this.el.dataset.edge = atStart ? 'end' : atEnd ? 'start' : 'both';
    }

    /** Re-project the contributed actions placed on the bar (left-aligned by default —
     *  see `mobilePlacement`) as icon-only stops in the indicators slot (call after
     *  registrations change). The rest are three-dots drawer rows. */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        if (!ctx) return;
        const doc = this.el.ownerDocument;
        this.actionsHost.replaceChildren();
        // Built-in-id actions are slot OVERRIDES — they reach mobile through the slot's
        // own stop (the shell routes it), never as an extra flow stop here.
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        for (const action of widgetActions('topbar', ctx).filter((a) => mobilePlacement(a) === 'bar' && !builtin.has(a.id))) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item';
            b.setAttribute('aria-label', action.label);
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            else b.appendChild(doc.createTextNode(action.label));
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            this.actionsHost.appendChild(b);
        }
        this.syncEdges();
    }

    setSymbol(symbol: string): void {
        const doc = this.el.ownerDocument;
        const ticker = parseSymbol(symbol).ticker;
        const text = doc.createElement('span');
        text.className = 'vela-mb-symbol-text';
        text.textContent = ticker;
        this.symbolEl.replaceChildren(text, iconEl('chevron-down', doc));
        this.symbolEl.setAttribute('aria-label', `Symbol — ${ticker}. Scroll or drag for next symbol; tap to search`);
        this.symbolQuick?.label(ticker);
        this.symbolEl.title = `${ticker} — scroll or drag for next symbol; tap to search`;
    }

    /**
     * How many charts a smaller layout set aside (the workspace's `hiddenChartCount`).
     * The number rides the More stop as a badge because that is the door that opens them
     * (More → Hidden charts); with nothing hidden the stop stays clean.
     */
    setHiddenCount(count: number): void {
        if (this.badgeEl) {
            this.badgeEl.hidden = !(count > 0);
            this.badgeEl.textContent = count > 99 ? '99+' : String(count);
        }
        const more = this.el.querySelector<HTMLElement>('.vela-mb-more');
        if (!more) return;
        const label = count > 0 ? `More — ${count} hidden chart${count === 1 ? '' : 's'}` : 'More';
        more.setAttribute('aria-label', label);
        more.title = label;
    }

    /** Mirror the single Alerts pane and the number of retained log entries. */
    setAlertsActive(open: boolean): void { this.alertsEl?.setAttribute('aria-pressed', String(open)); }
    setAlertCount(count: number): void {
        if (!this.alertsBadge) return;
        this.alertsBadge.hidden = count <= 0;
        this.alertsBadge.textContent = count > 9 ? '9+' : String(count);
    }

    setTimeframe(tf: string): void {
        this.tfEl.textContent = timeframeLabel(tf);
    }

    // ── chart type ──────────────────────────────────────────────────────────────
    /** Mirror the active chart's price style: glyph of the style, and its name in the
     *  accessible label (the glyph alone is the visual, never the only affordance). */
    setPriceStyle(id: string): void {
        if (!this.styleEl || !this.styleGlyph) return;
        this.styleId = id;
        const option = this.opts.styleOptions?.().find((o) => o.id === id);
        const name = option?.label ?? id;
        const markup = option?.icon ?? '';
        if (markup) this.styleGlyph.innerHTML = markup;
        else this.styleGlyph.replaceChildren(iconEl('style-candles', this.el.ownerDocument));
        this.styleEl.setAttribute('aria-label', `Chart type — ${name}. Open the chart type sheet`);
        this.styleEl.title = name;
        const text = this.styleEl.querySelector<HTMLElement>('.vela-mb-styletext');
        if (text) text.textContent = name;
        this.sheet?.setCurrent(id);
    }

    /** Raise the chart-type sheet (tap on the stop). Built on first use so a single-chart
     *  phone session that never changes style pays nothing for it. */
    /**
     * Report a stop's surface as open/closed (E: an open sheet left no signal on the stop
     * that opened it — a screen reader heard the same six buttons either way). The shell
     * calls this from each surface's onOpenChange; `maximize` is a toggle, so it reports
     * aria-pressed instead of aria-expanded.
     */
    setExpanded(stop: 'symbol' | 'timeframe' | 'indicators' | 'drawings' | 'more' | 'maximize', open: boolean): void {
        // The stop NAMES and their classes diverge exactly once (the timeframe stop is
        // `.vela-mb-tf`), so the mapping lives here rather than in every caller.
        const cls = stop === 'timeframe' ? 'vela-mb-tf' : `vela-mb-${stop}`;
        const el = this.el.querySelector<HTMLElement>(`.${cls}`);
        if (!el) return;
        if (stop === 'maximize') el.setAttribute('aria-pressed', open ? 'true' : 'false');
        else el.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) el.dataset.open = '1';
        else delete el.dataset.open;
    }

    /** A workspace pane is not a modal dialog; connect its existing phone-bar door. */
    setPaneControl(stop: 'symbol' | 'indicators' | 'more', panelId: string, open: boolean): void {
        const el = this.el.querySelector<HTMLElement>(`.vela-mb-${stop}`);
        if (!el) return;
        el.removeAttribute('aria-haspopup');
        el.setAttribute('aria-controls', panelId);
        this.setExpanded(stop, open);
    }

    openSheet(): void {
        if (!this.styleEl || !this.opts.onStyleSelect) return;
        if (!this.sheet) {
            this.sheet = new ChartTypeSheet({
                // Inside the kit host (the sheet inherits the theme tokens from it).
                host: floatingLayerHost(this.el, this.el.parentElement ?? this.el.ownerDocument.body),
                trigger: this.styleEl,
                styles: () => this.opts.styleOptions?.() ?? [],
                current: () => this.styleId,
                onSelect: (id) => {
                    this.opts.onStyleSelect?.(id);
                    recordRecent('chartTypes', id);
                },
                ...(this.opts.styleFavorites || this.opts.onStyleFavorite
                    ? {
                          isFavorite: (id: string) => this.opts.styleFavorites?.().includes(id) ?? false,
                          onToggleFavorite: (id: string, on: boolean) => {
                              this.opts.onStyleFavorite?.(id, on);
                              this.sheet?.refreshFavorites();
                          },
                      }
                    : {}),
                ...(this.opts.onLayoutClick
                    ? {
                          layout: {
                              label: () => this.opts.layoutLabel?.() ?? '',
                              glyph: () => this.opts.layoutGlyph?.() ?? iconMarkup('layout') ?? '',
                              onOpen: () => this.opts.onLayoutClick?.(),
                          },
                      }
                    : {}),
            });
        }
        this.sheet.toggle();
    }

    // ── drawings ────────────────────────────────────────────────────────────────
    /** Rebind to another chart (a rebuild, or the workspace's active cell changing) —
     *  the previous chart's subscriptions are dropped so only one chart drives the stop. */
    onChart(chart: Vela | null): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.chart = chart;
        if (chart) {
            this.chartSubs = [
                chart.on('drawing:tool', () => this.syncDrawing()),
                chart.on('drawing:mode', () => this.syncDrawing()),
            ];
        }
        this.syncDrawing();
    }

    /** The penceil when idle, the armed tool's own glyph when one is — including the
     *  eraser, which is a MODE rather than a tool and needs the same honest mirror. */
    private syncDrawing(): void {
        if (!this.drawingEl || !this.drawingGlyph) return;
        const drawings = this.chart?.drawings;
        const tool = drawings?.supported ? drawings.getTool() : null;
        const eraser = drawings?.supported ? drawings.getMode() === 'eraser' : false;
        const armed = tool !== null || eraser;
        if (!armed) {
            this.drawingGlyph.innerHTML = iconMarkup('pen') ?? '';
            this.drawingEl.classList.remove('vela-mb-armed');
            this.drawingEl.setAttribute('aria-label', 'Drawings');
            return;
        }
        const name = tool !== null ? (getDrawingType(tool)?.label ?? tool) : 'Eraser';
        const markup = tool !== null ? (getDrawingType(tool)?.icon ?? '') : (iconMarkup('eraser') ?? '');
        this.drawingGlyph.innerHTML = markup || iconMarkup('pen') || '';
        this.drawingEl.classList.add('vela-mb-armed');
        this.drawingEl.setAttribute('aria-label', `Drawing — ${name}. Open drawing tools`);
    }

    // ── maximize ────────────────────────────────────────────────────────────────
    /** Light the maximize stop while something is isolated (a chart over the grid,
     *  or a maximized pane inside the active chart) — inverse chip + restore glyph. */
    setMaximizeActive(on: boolean): void {
        if (!this.maxEl) return;
        this.maxEl.classList.toggle('vela-mb-on', on);
        this.maxEl.setAttribute('aria-pressed', on ? 'true' : 'false');
        this.maxEl.setAttribute('aria-label', on ? 'Restore layout' : 'Maximize chart');
        this.maxEl.replaceChildren(iconEl(on ? 'restore' : 'maximize', this.el.ownerDocument));
    }

    /** Light the undo/redo stops from the ACTIVE chart's history: an empty stack dims
     *  the stop and drops it out of the tab order, so the bar never offers a dead press. */
    setHistory(canUndo: boolean, canRedo: boolean): void {
        const apply = (el: HTMLButtonElement | null, on: boolean, label: string): void => {
            if (!el) return;
            el.setAttribute('aria-disabled', on ? 'false' : 'true');
            el.tabIndex = on ? 0 : -1;
            el.setAttribute('aria-label', label);
        };
        apply(this.undoEl, canUndo, 'Undo');
        apply(this.redoEl, canRedo, 'Redo');
    }

    /** Show the maximize stop only while the grid holds more than one chart — on a
     *  one-cell layout there is nothing to isolate, so the stop would be a dead press. */
    setMaximizeVisible(visible: boolean): void {
        if (!this.maxEl) return;
        this.maxEl.hidden = !visible;
    }

    /** The shell re-wrote the starred set (a restore, or the desktop menu's star). */
    setStyleFavorites(_ids: readonly string[]): void {
        this.sheet?.refreshFavorites();
    }

    /** Kept for the shell's layout changes: the label now lives on the style sheet's
     *  layout row, not in the bar (the bar slot itself became the chart type). */
    setLayoutLabel(label: string): void {
        this.sheet?.setLayoutLabel(label);
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.resizeObs?.disconnect();
        this.resizeObs = null;
        this.scroller?.removeEventListener('scroll', this.onScroll);
        this.scroller?.removeEventListener('focusin', this.onFocusIn);
        this.scroller?.removeEventListener('keydown', this.onKeydown);
        this.sheet?.destroy();
        this.sheet = null;
        this.el.remove();
    }
}
