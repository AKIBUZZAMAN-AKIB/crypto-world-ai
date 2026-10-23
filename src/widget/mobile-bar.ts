// Mobile bottom bar — the ONE navigation surface of the mobile chrome: symbol
// (fullscreen search), timeframe (drawer), CHART TYPE (its glyph = the price style in
// force, opens the style sheet), indicators (fullscreen picker), contributed actions,
// drawings (its glyph = the armed tool), maximize, the three-dots drawer, chart
// settings. It replaces BOTH desktop bars: this stylesheet also carries the mobile
// visibility flips for the topbar and the desktop bottombar, so the whole swap lives in
// one place and follows the root's `data-layout` attribute with no JS.
//
// Two stops are MIRRORS, not doors: "chart type" and "drawings" show what is actually in
// force on the active chart — the same rule the desktop chrome plays by. A trader who
// switched charts or armed a tool from the keyboard, the drawer or the API must never
// read a stale glyph off the phone's most-used strip.
import { iconEl, iconMarkup } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { floatingLayerHost } from '../ui/tokens';
import { parseSymbol } from '../data/ProviderRegistry';
import { timeframeLabel } from './timeframe';
import { mobilePlacement, widgetActions, type WidgetContext } from './contributions';
import { TOPBAR_BUILTIN_IDS } from './topbar-composition';
import { getDrawingType } from '../core/drawings';
import type { Vela } from '../Vela';
import { ChartTypeSheet, type ChartTypeOption } from './chart-type-sheet';

const STYLE_ID = 'vela-widget-mobilebar';
const CSS = `
.vela-mobilebar {
    display: none;
    align-items: stretch;
    gap: 2px;
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    flex: none;
}
[data-layout='mobile'] .vela-mobilebar { display: flex; }
[data-layout='mobile'] .vela-widget-topbar { display: none; }
[data-layout='mobile'] .vela-widget-bottombar { display: none; }
.vela-mb-item {
    all: unset;
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
}
.vela-mb-item[hidden] { display: none !important; }
.vela-mb-item:active { background: var(--vela-hover); }
.vela-mb-item .vela-icon { font-size: 18px; width: 18px; height: 18px; }
/* A lit stop (the maximize toggle while something is isolated): the inverse
   "selected" chip — white on the dark theme, dark on the light one. */
.vela-mb-item.vela-mb-on, .vela-mb-item.vela-mb-on:active { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
/* Left-aligned contributed actions get their own stops (the built-in indicators
   slot) — the wrapper is layout-transparent so each stop flexes like a sibling. */
.vela-mb-actions { display: contents; }
/* The chart-type stop — a fixed slot (no text, so no reflow when the style changes) on
   the boundary between "what symbol/when" and "what the plot is made of". The dividers
   that used to bracket the layout count now bracket the style glyph. */
.vela-mb-style {
    flex: 0 0 auto;
    min-width: 40px;
    padding: 0 5px;
    border-left: 1px solid var(--vela-border);
    border-right: 1px solid var(--vela-border);
    margin: 0 1px;
}
.vela-mb-style .vela-mb-glyph { display: inline-flex; width: 19px; height: 19px; }
.vela-mb-style .vela-mb-glyph svg { width: 19px; height: 19px; }
.vela-mb-style[aria-expanded='true'] { background: var(--vela-hover); }
/* The drawings stop mirrors the armed tool: accent ink + a lit chip while a tool (or the
   eraser) is armed, the plain pencil when nothing is. No dot, no badge — the glyph IS the
   state, which is the whole point of the stop. */
.vela-mb-drawings .vela-mb-glyph { display: inline-flex; width: 18px; height: 18px; }
.vela-mb-drawings .vela-mb-glyph svg { width: 18px; height: 18px; }
.vela-mb-drawings.vela-mb-armed { color: var(--vela-accent); background: var(--vela-hover); }
.vela-mb-symbol {
    flex: 1.6 1 0;
    font-size: 14px;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    line-height: 44px;
    text-align: center;
}
`;

export interface MobileBarOptions {
    symbol: string;
    timeframe: string;
    onSymbolClick: () => void;
    onTimeframeClick: () => void;
    /** Omitted ⇒ no indicators stop (the composition hides the 'indicators' slot, or
     *  the deprecated `indicatorPicker: false`). A slot OVERRIDE keeps the stop — the
     *  shell passes a callback routed to the override. */
    onIndicatorsClick?: () => void;
    /** Omitted ⇒ no drawings stop (the shell disabled user drawings — `drawings: false`). */
    onDrawingsClick?: () => void;
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
    /** Omitted ⇒ no maximize stop (single-chart shells — nothing to isolate). The
     *  workspace passes a toggle that isolates the active chart over the grid;
     *  {@link setMaximizeActive} lights the stop while something is isolated. */
    onMaximizeClick?: () => void;
    onMoreClick: () => void;
    onSettingsClick: () => void;
    /** Live widget context — left-aligned contributed actions (`align: 'left'`)
     *  project as icon-only stops in the indicators slot. */
    getContext?: () => WidgetContext;
}

export class MobileBar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly tfEl: HTMLElement;
    /** The chart-type stop (null when the shell passes no style options). */
    private readonly styleEl: HTMLButtonElement | null;
    private readonly styleGlyph: HTMLElement | null;
    /** The maximize toggle stop (null when the shell has nothing to isolate). */
    private readonly maxEl: HTMLButtonElement | null;
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

    constructor(host: HTMLElement, opts: MobileBarOptions) {
        this.opts = opts;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-mobilebar';

        const item = (cls: string, label: string, onClick: () => void, icon?: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = `vela-mb-item ${cls}`;
            b.setAttribute('aria-label', label);
            if (icon) b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.symbolEl = item('vela-mb-symbol', 'Symbol search', opts.onSymbolClick);
        this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
        this.tfEl = item('vela-mb-tf', 'Timeframe', opts.onTimeframeClick);
        this.tfEl.textContent = timeframeLabel(opts.timeframe);

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
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-mb-actions';

        // ── drawings (glyph = armed tool) ──
        const onDrawings = opts.onDrawingsClick;
        if (onDrawings) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item vela-mb-drawings';
            b.setAttribute('aria-label', 'Drawings');
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
        const more = item('vela-mb-more', 'More', opts.onMoreClick, 'kebab');
        const settings = item('vela-mb-settings', 'Chart settings', opts.onSettingsClick, 'gear');

        this.el.append(
            this.symbolEl,
            this.tfEl,
            ...(this.styleEl ? [this.styleEl] : []),
            ...(indicators ? [indicators] : []),
            this.actionsHost,
            ...(this.drawingEl ? [this.drawingEl] : []),
            ...(this.maxEl ? [this.maxEl] : []),
            more,
            settings,
        );
        host.appendChild(this.el);
        this.renderActions();
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
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = parseSymbol(symbol).ticker;
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
    openSheet(): void {
        if (!this.styleEl || !this.opts.onStyleSelect) return;
        if (!this.sheet) {
            this.sheet = new ChartTypeSheet({
                // Inside the kit host (the sheet inherits the theme tokens from it).
                host: floatingLayerHost(this.el, this.el.parentElement ?? this.el.ownerDocument.body),
                trigger: this.styleEl,
                styles: () => this.opts.styleOptions?.() ?? [],
                current: () => this.styleId,
                onSelect: (id) => this.opts.onStyleSelect?.(id),
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
        this.maxEl.setAttribute('aria-label', on ? 'Restore layout' : 'Maximize chart');
        this.maxEl.replaceChildren(iconEl(on ? 'restore' : 'maximize', this.el.ownerDocument));
    }

    /** Show the maximize stop only while the grid holds more than one chart — on a
     *  one-cell layout there is nothing to isolate, so the stop would be a dead press. */
    setMaximizeVisible(visible: boolean): void {
        if (!this.maxEl) return;
        this.maxEl.hidden = !visible;
    }

    /** Kept for the shell's layout changes: the label now lives on the style sheet's
     *  layout row, not in the bar (the bar slot itself became the chart type). */
    setLayoutLabel(label: string): void {
        this.sheet?.setLayoutLabel(label);
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.sheet?.destroy();
        this.sheet = null;
        this.el.remove();
    }
}
