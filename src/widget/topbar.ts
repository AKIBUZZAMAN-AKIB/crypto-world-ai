// Topbar — symbol label, timeframe dropdown, and the price-style dropdown (built-ins +
// every chart type registered through the plugin SDK, labels from the registry).
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { LayoutMenu } from './layout-menu';
import { TemplatesMenu } from './templates-menu';
import { LayoutPicker, type LayoutPickerShape } from './layout-picker';
import { iconEl, iconMarkup, registerIcon } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { installSmoothScrolling } from '../ui/scrolling';
import { chartType } from '../chart-types/registry';
import { topbarActionOverride, widgetActions, type SidePanelButton, type WidgetContext } from './contributions';
import { resolveTopbarComposition, topbarHas, TOPBAR_BUILTIN_IDS, type ResolvedTopbarComposition, type TopbarComposition } from './topbar-composition';
import { BUILTIN_PRICE_STYLES, priceStyleIds } from '../renderers/native/core/chartConfig';
import { favoriteTimeframeChips, timeframeLabel } from './timeframe';
import { parseSymbol } from '../data/ProviderRegistry';

// The component owns its stylesheet (id-guarded, injected at construction) so EVERY
// host that mounts a Topbar — the widget, a multi-chart workspace — gets the same look.
const STYLE_ID = 'vela-topbar';
/** Prefixed id for a style's PINNED row in the style menu (same style, second row). */
const STYLE_PIN_PREFIX = 'pinned:';
const CSS = `
.vela-widget-topbar {
    display: flex;
    align-items: center;
    gap: var(--vela-space-1);
    padding: var(--vela-space-1) var(--vela-space-2);
    border-bottom: 1px solid var(--vela-border-soft);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    flex: none;
}
.vela-widget-symbol, .vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-templates, .vela-widget-action-left {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-symbol {
    color: var(--vela-fg-bright);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 0 10px;
    gap: 7px;
}
.vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-templates, .vela-widget-action-left {
    color: var(--vela-fg-bright);
}
.vela-widget-symbol:hover, .vela-widget-tf:hover, .vela-widget-style:hover, .vela-widget-indicators:hover, .vela-widget-templates:hover, .vela-widget-action-left:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* Timeframe cluster: duration-sorted favorite chips, highlight in place, caret
   opening the full dropdown. With no favorites the caret is the merged trigger
   (label + chevron). An unstarred current value sits as an extra chip by the caret. */
.vela-widget-tf-group { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips:empty { display: none; }
.vela-widget-tf[data-current='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-widget-tf-caret {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-widget-tf-caret:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* The merged trigger is a plain button (hover feedback only) — the highlight
   background marks the CURRENT chip among favorites, and a lone trigger with a
   permanent highlight would read as stuck-pressed. */
.vela-widget-tf-caret[data-solo='1'] {
    width: auto;
    padding: 0 6px 0 9px;
    gap: 4px;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-topbar .vela-widget-tf-caret .vela-icon { font-size: 14px; width: 14px; height: 14px; }
.vela-widget-topbar .vela-icon { color: inherit; font-size: 16px; width: 16px; height: 16px; }
/* Width is set in syncHairlines() to exactly one device pixel — a CSS 1px at
   fractional DPR (1.25, 1.5…) straddles two physical pixels and siblings end
   up looking like different thicknesses depending on subpixel placement. */
.vela-sep { height: 22px; margin: 0 2px; flex: none; background: var(--vela-border-strong); }
.vela-alerts-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 9px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
/* The right side of the bar — whatever the composition puts there rides this one
   auto-margin push (the flow-actions host used to carry it; composition can omit it). */
.vela-topbar-right { margin-left: auto; display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-actions { display: inline-flex; gap: var(--vela-space-1); }
/* Left-aligned contributed actions — the primary-chrome cluster after the dropdowns. */
.vela-widget-actions-left { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
/* One PINNED contributed action's slot (a composition entry naming the action's id). */
.vela-widget-action-pin { display: inline-flex; align-items: center; }
/* The side-panel toggles, one per docked panel — a group so the dock can rebuild them
   without disturbing the tools around it. */
.vela-widget-panels { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-tool {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-widget-tool:hover:not(:disabled) { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-tool:disabled { opacity: 0.35; cursor: default; }
.vela-widget-tool[data-active='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-action {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
    color: var(--vela-fg);
}
.vela-widget-action:hover { background: var(--vela-hover); }
/* ── the layout NAME chip (after undo/redo) ────────────────────────────────────
   TradingView's top toolbar ends in its layout name with a caret, and paints a save
   sign under it the moment the chart drifts. The name is the status: it is the one
   control that answers "is my work saved?" without a tooltip. */
.vela-widget-layoutname {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* Auto, not the icon tool's 32px: this one is a LABEL with a caret. It may SHRINK
       (min-width: 0 defeats the nowrap min-content floor) so a long layout name
       ellipsises instead of pushing the page sideways on a narrow desktop. */
    width: auto;
    flex: 0 1 auto;
    min-width: 0;
    max-width: min(190px, 26vw);
    min-width: 44px;
    height: 30px;
    padding: 0 6px 0 9px;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 12.5px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-layoutname:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-layoutname[aria-expanded='true'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-widget-layoutname-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vela-widget-layoutname[data-untitled='1'] .vela-widget-layoutname-text { font-style: italic; color: var(--vela-fg-faint); }
.vela-widget-layoutname .vela-icon { flex: none; font-size: 11px; opacity: 0.65; }
.vela-layout-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vela-accent);
}
.vela-layout-dot[hidden] { display: none !important; }
.vela-widget-layoutsave[data-dirty='1'] { color: var(--vela-accent); }
.vela-widget-layoutsave[data-dirty='1']:hover:not(:disabled) { background: var(--vela-hover); color: var(--vela-accent); }
/* Narrow DESKTOP widows: the glyphs stay, the word beside the Indicators glyph goes —
   chrome that would otherwise squeeze the layout name down to its caret. */
@media (max-width: 900px) {
    .vela-widget-indicators .vela-widget-btnlabel { display: none; }
    .vela-widget-indicators { gap: 0; padding: 0 8px; }
}
/* The Templates dropdown is a LABELLED control in TradingView ("Templates ▾"), the
   Indicators button's twin — same height, same padding, its own caret. It is NOT the
   32px icon tile the right-hand cluster uses. */
.vela-widget-templates { width: auto; font-size: 13px; }
.vela-widget-tplcaret { display: inline-flex; align-items: center; margin-left: -2px; opacity: 0.8; }
.vela-widget-tplcaret .vela-icon, .vela-widget-templates > .vela-icon { width: 14px; height: 14px; }
@media (max-width: 900px) {
    /* Glyph only: the fixed 32px tile, exactly like the icon tools around it. */
    .vela-widget-templates .vela-widget-btnlabel { display: none; }
    .vela-widget-templates { width: 32px; padding: 0; justify-content: center; }
    .vela-widget-tplcaret { display: none; }
}
/* The chip and its save button travel as one slot: no hairline between them. */
.vela-widget-layoutgroup { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; flex: 0 1 auto; min-width: 0; }
`;

const BUILTIN_STYLE_LABELS: Record<string, string> = {
    candles: 'Candles',
    bars: 'Bars',
    line: 'Line',
    area: 'Area',
    baseline: 'Baseline',
    heikinashi: 'Heikin Ashi',
    'hollow-candles': 'Hollow candles',
    'volume-candles': 'Volume candles',
    'line-markers': 'Line with markers',
    stepline: 'Step line',
    'hlc-area': 'HLC area',
    columns: 'Columns',
    'high-low': 'High-low',
    'hlc-bars': 'HLC bars',
};

export function priceStyleLabel(id: string): string {
    return chartType(id)?.label ?? BUILTIN_STYLE_LABELS[id] ?? id;
}

/** Icon id for a price style — registers a plugin type's `icon` markup on first use. */
export function priceStyleIcon(id: string): string | undefined {
    const iconId = `style-${id}`;
    if (iconMarkup(iconId)) return iconId;
    const svg = chartType(id)?.icon;
    if (svg) {
        registerIcon(iconId, svg);
        return iconId;
    }
    return undefined;
}

/** Raw `<svg>` markup for a price style — the mobile bar's chart-type stop and its
 *  sheet draw the glyph directly, so they need markup rather than an icon id. Registers
 *  a plugin type's `icon` on first use, exactly like {@link priceStyleIcon}. */
export function priceStyleMarkup(id: string): string | undefined {
    const iconId = priceStyleIcon(id);
    return iconId ? (iconMarkup(iconId) ?? undefined) : undefined;
}

export interface TopbarOptions {
    symbol: string;
    onSymbolClick?: () => void;
    timeframe: string;
    timeframes: readonly string[];
    /** Favorite timeframes — duration-sorted quick-switch chips, stars in the
     *  dropdown rows. Push later changes with {@link Topbar.setTimeframeFavorites}. */
    timeframeFavorites?: readonly string[];
    priceStyle: string;
    onTimeframe: (tf: string) => void;
    /** A dropdown star was toggled. Omitted, the dropdown carries no stars and the
     *  chips never render — the host owns (and persists) the favorite set. */
    onTimeframeFavorite?: (tf: string, on: boolean) => void;
    onPriceStyle: (style: string) => void;
    /** Chart-type stars in the style menu. Omitted ⇒ no stars there (a bare host keeps
     *  the plain list); provided ⇒ the menu reads/writes the SAME set as the phone's
     *  chart-type sheet. Push later changes with {@link Topbar.setStyleFavorites}. */
    onStyleFavorite?: (id: string, on: boolean) => void;
    /** The starred styles, read at build time (the host keeps them — see above). */
    styleFavorites?: readonly string[];
    /** Saved chart TEMPLATES — the dropdown beside the Indicators button (TradingView's
     *  "Indicator templates"). A template is an indicator set with its settings; the
     *  symbol/timeframe travel only when the trader asked for it. Its own group, not part
     *  of `layout`: a single-chart shell (`layout: false`) still has templates. */
    templates?: {
        templates: () => Array<{ name: string; count: number; symbol?: string; timeframe?: string }>;
        onApplyTemplate?: (name: string, target: 'active' | 'all') => number;
        onSaveTemplate?: (name: string, includeMarket: boolean) => boolean;
        onDeleteTemplate?: (name: string) => void;
        onRenameTemplate?: (from: string, to: string) => boolean;
        onExportTemplate?: (name: string) => string | null;
        onImportTemplate?: (json: string) => string | null;
        defaultTemplate?: () => string | null;
        onSetDefaultTemplate?: (name: string | null) => void;
        /** Charts in the layout — gates "Apply to all charts". */
        chartCount?: () => number;
        /** TradingView's six read-only built-ins, listed under the saved templates. */
        builtins?: () => Array<{ id: string; name: string; description: string; count: number }>;
        onApplyBuiltin?: (id: string) => void;
    };
    /** Optional workspace LAYOUT dropdown (rendered after the style dropdown when
     *  given) — the grid-canvas picker composing uniform grids, with the workspace
     *  SYNC switches beside it. Everything is read live, so plugin-registered
     *  layouts and setting flips appear automatically. */
    layout?: {
        current: string;
        /** Current layout's picker-canvas shape (null = not canvas-expressible). */
        shape: () => LayoutPickerShape | null;
        /** Registered layouts the canvas cannot express — glyph buttons, or labeled
         *  rows when a preset carries no icon. */
        presets: () => Array<{ id: string; label: string; icon?: string; checked?: boolean }>;
        onSelectGrid: (rows: number, cols: number) => void;
        onSelectPreset: (id: string) => void;
        /** SYNC switch rows (re-read on every open and after each toggle). */
        syncs: () => Array<{ id: string; label: string; checked: boolean; group?: string; marks?: Record<string, string> }>;
        onToggleSync: (id: string) => void;
        /** Cycle the ACTIVE cell through a link's groups (the row's chip). */
        onCycleGroup?: (id: string) => void;
        /** The charts the picker's link x chart table lists, in slot order. */
        charts?: () => Array<{ id: string; label: string; symbol?: string; active: boolean }>;
        onCycleCellGroup?: (kind: string, cellId: string) => void;
        /** Make a chart active from the table's column header. */
        onSelectChart?: (cellId: string) => void;
        /** Pick one group outright from a cell's palette (`null` = leave the group). */
        onSetCellGroup?: (kind: string, cellId: string, mark: string | null) => void;
        /** The popover opened/closed (the workspace numbers its charts while it is up). */
        onOpenChange?: (open: boolean) => void;
        onAllInOneGroup?: (kind: string) => void;
        /** The drawing scope the workspace holds (the chip on the Drawings row). */
        drawingsScope?: () => 'layout' | 'global';
        onToggleDrawingsScope?: () => void;
        /** Dormant (pooled) charts, and the row that drops them. */
        hiddenCharts?: () => number;
        onClearPooled?: () => void;
        clearedCharts?: () => number;
        onRestorePooled?: () => void;
        savedLayouts?: () => Array<{
            name: string;
            active: boolean;
            thumb?: string | null;
            savedAt?: number | null;
            charts?: number;
            indicators?: number;
            dirty?: boolean;
        }>;
        onSaveLayout?: (name: string) => void;
        onSaveLayoutWithThumb?: (name: string) => boolean;
        /** The open layout and the manager's verbs (autosave, save changes, copy). */
        activeLayout?: () => string | null;
        onSaveChanges?: () => void;
        autosave?: () => boolean;
        onToggleAutosave?: (on: boolean) => void;
        /** Duplicate a saved layout; returns the name the copy landed under (null when the
         *  name list refused it) so the panel can report what happened. */
        onDuplicateLayout?: (name: string) => string | null;
        templates?: () => Array<{ name: string; count: number; symbol?: string; timeframe?: string }>;
        onSaveTemplate?: (name: string, includeMarket: boolean) => boolean;
        onApplyTemplate?: (name: string, target: 'active' | 'all') => number;
        onDeleteTemplate?: (name: string) => void;
        onRenameTemplate?: (from: string, to: string) => boolean;
        defaultTemplate?: () => string | null;
        onSetDefaultTemplate?: (name: string | null) => void;
        onExportTemplate?: (name: string) => string | null;
        onImportTemplate?: (json: string) => string | null;
        legend?: () => Array<{ id: string; mark: string; color?: string; name: string; count: number }>;
        onRenameGroup?: (id: string, name: string | null) => void;
        /** Repaint a group's glyph (null restores the palette mark). */
        onSetGroupMark?: (id: string, glyph: string | null) => void;
        /** The user's name for a group id. */
        groupName?: (id: string) => string | undefined;
        onOpenLayout?: (name: string) => void;
        onDeleteLayout?: (name: string) => void;
        onRenameLayout?: (from: string, to: string) => boolean;
        onExportLayout?: (name: string) => string | null;
        /** Copy a link that carries THIS one saved layout (Tier-2 #8). */
        onShareLayout?: (name: string) => Promise<string | null>;
        /** Write the active chart's bars as CSV (visible window or everything loaded). */
        onExportData?: (scope: 'visible' | 'all', timeFormat: 'iso' | 'unix') => { rows: number; filename: string } | null;
        onImportLayout?: (json: string) => string | null;
        /** Copy a permalink for the whole workspace (null = clipboard refused). */
        onCopyLink?: () => Promise<string | null>;
        linkGroup?: () => string | null;
        onLinkGroup?: (tag: string | null) => void;
        /** The current layout's 16px glyph (`<svg>` markup) for the button, re-read on
         *  every {@link Topbar.setLayout}. Omitted ⇒ the registered `'layout'` icon. */
        glyph?: () => string;
    };
    onIndicatorsClick?: () => void;
    /** Unified undo/redo (same stack as Ctrl+Z / Ctrl+Y). Enabled state is pushed with
     *  {@link Topbar.setHistoryState}. */
    onUndoClick?: () => void;
    onRedoClick?: () => void;
    onScreenshotClick?: () => void;
    onAlertsClick?: (anchor: HTMLElement) => void;
    /** Bar-replay entry (the `'replay'` slot) — the shell opens its replay menu anchored
     *  on the button. Omitted ⇒ the slot renders nothing (a shell with no replay API
     *  never shows a dead button). */
    onReplayClick?: (anchor: HTMLElement) => void;
    /** Live widget context for contributed actions (topbar target). */
    getContext?: () => WidgetContext;
    /** The host's declarative composition (see {@link TopbarComposition}) — which
     *  entries render, per side, in list order. An undeclared side keeps its default.
     *  The shell that owns this bar also gates the matching mobile entries and
     *  keyboard chords on the same composition — the bar only handles its own DOM. */
    composition?: TopbarComposition;
}

export class Topbar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    /** Duration-sorted favorite chips (plus an unstarred current, when needed). */
    private readonly tfChipsHost: HTMLElement;
    private readonly tfCaret: HTMLButtonElement;
    private tfFavs: string[];
    /** Starred chart types (the style menu's stars + its pinned block). */
    private styleFavs: string[] = [];
    private readonly styleButton: HTMLElement;
    private layoutButton: HTMLElement | null = null;
    private layoutPicker: LayoutPicker | null = null;
    private layoutId: string | null = null;
    /** The layout NAME chip + its save button (the 'layouts' slot); null when the host
     *  supplied no layout block or the composition hides the entry. */
    private layoutsChip: HTMLButtonElement | null = null;
    private layoutsNameEl: HTMLElement | null = null;
    private layoutsDot: HTMLElement | null = null;
    private layoutSaveBtn: HTMLButtonElement | null = null;
    private layoutMenu: LayoutMenu | null = null;
    /** The templates dropdown, beside Indicators (see templates-menu.ts). */
    private templatesBtn: HTMLButtonElement | null = null;
    private templatesMenu: TemplatesMenu | null = null;
    private layoutsGroup: HTMLElement | null = null;
    private readonly tfMenu: Menu;
    private readonly styleMenu: Menu;
    private readonly tooltips: Tooltip[] = [];
    private readonly actionsHost: HTMLElement;
    /** Left-aligned contributed actions (`align: 'left'`) — right after the dropdowns. */
    private readonly leftActionsHost: HTMLElement;
    /** The hairline after the left cluster — hidden while the cluster is empty. */
    private readonly leftActionsSep: HTMLElement;
    /** The side-panel toggle group — filled by the dock through {@link setPanelButtons}. */
    private readonly panelsHost: HTMLElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private alertsBtn!: HTMLButtonElement;
    /** The bar-replay slot's button (`null` when the composition hides it or the host
     *  supplied no entry handler). */
    private replayBtn: HTMLButtonElement | null = null;
    private panelBtns = new Map<string, HTMLButtonElement>();
    private panelTooltips: Tooltip[] = [];
    private readonly host: HTMLElement;
    private alertsBadge!: HTMLElement;
    /** The resolved composition (defaults applied) — what renders, where, in order. */
    private readonly comp: ResolvedTopbarComposition;
    /** Pinned contributed-action slots, by action id (composition entries that name one,
     *  plus built-in slots taken over by an override). */
    private readonly pinned = new Map<string, { host: HTMLElement; left: boolean }>();
    /** Overrides that LEFT their native slot (default side + a declared `order`) — they
     *  render through the flow cluster like ordinary actions. */
    private readonly flowingOverrides = new Set<string>();
    /** Tooltips of the CURRENT icon-only action buttons — rebuilt with every
     *  renderActions pass (contributed buttons are replaceChildren'd away). */
    private actionTooltips: Tooltip[] = [];
    /** `iconOnly` misuse warned once per action id (renderActions re-runs freely). */
    private readonly warnedIconless = new Set<string>();
    private readonly opts: TopbarOptions;
    private timeframe: string;
    private priceStyle: string;
    private readonly onHairlineSync = (): void => {
        if (this.hairlineRaf) return;
        const win = this.el.ownerDocument.defaultView;
        this.hairlineRaf = win?.requestAnimationFrame(() => {
            this.hairlineRaf = 0;
            this.syncHairlines();
        }) ?? 0;
    };
    private hairlineRo: ResizeObserver | null = null;
    private hairlineRaf = 0;

    constructor(host: HTMLElement, opts: TopbarOptions) {
        this.opts = opts;
        this.host = host;
        this.timeframe = opts.timeframe;
        this.priceStyle = opts.priceStyle;
        this.comp = resolveTopbarComposition(opts.composition);
        const vis = (id: string): boolean => topbarHas(this.comp, id);
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        installSmoothScrolling(doc);

        this.el = doc.createElement('div');
        this.el.className = 'vela-widget-topbar';
        this.symbolEl = doc.createElement('button');
        this.symbolEl.className = 'vela-widget-symbol';
        // The button DISPLAYS the bare ticker; the venue-prefixed identity stays in the
        // shell's state (the statusline meta and the picker badges name the venue).
        this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
        if (opts.onSymbolClick) this.symbolEl.addEventListener('click', opts.onSymbolClick);
        // Duration-sorted chips with highlight in place; the caret is the dropdown
        // trigger (merged with the current label when there are no favorites).
        this.tfFavs = [...(opts.timeframeFavorites ?? [])];
        this.tfChipsHost = doc.createElement('span');
        this.tfChipsHost.className = 'vela-widget-tf-chips';
        this.tfCaret = doc.createElement('button');
        this.tfCaret.className = 'vela-widget-tf-caret';
        this.tfCaret.appendChild(iconEl('chevron-down', doc));
        this.tfCaret.setAttribute('aria-label', 'Timeframes');
        const tfGroup = doc.createElement('span');
        tfGroup.className = 'vela-widget-tf-group';
        tfGroup.append(this.tfChipsHost, this.tfCaret);
        this.styleButton = doc.createElement('button');
        this.styleButton.className = 'vela-widget-style';
        this.renderStyleButton(doc);
        // No callback ⇒ no button: a host hiding the built-in picker (composition
        // without 'indicators', or the deprecated `indicatorPicker: false`) must not
        // show a dead entry point. An OVERRIDE of the slot renders through
        // renderActions instead.
        let indicatorsBtn: HTMLButtonElement | null = null;
        if (opts.onIndicatorsClick && !topbarActionOverride('indicators')) {
            indicatorsBtn = doc.createElement('button');
            indicatorsBtn.className = 'vela-widget-indicators';
            // The word, in its own span: on a narrow desktop the toolbar keeps the glyph
            // and gives up the label (TradingView's own behaviour) instead of squeezing
            // the layout name to a chevron.
            const indLabel = doc.createElement('span');
            indLabel.className = 'vela-widget-btnlabel';
            indLabel.textContent = 'Indicators';
            indicatorsBtn.append(iconEl('indicators', doc), indLabel);
            indicatorsBtn.addEventListener('click', opts.onIndicatorsClick);
        }
        // TradingView keeps its chart templates in a dropdown IMMEDIATELY beside the
        // Indicators button ("Indicator templates", top toolbar). The verbs already live
        // on the workspace (saveTemplate / applyTemplate / …) — this is the door, not a
        // second store. A dedicated option group, so a single-chart shell has templates
        // even though it has no layout manager.
        const tpl = opts.templates;
        if (tpl?.templates && vis('templates')) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'vela-widget-tool vela-widget-templates';
            btn.setAttribute('aria-haspopup', 'dialog');
            btn.setAttribute('aria-expanded', 'false');
            // The word, exactly as Indicators carries it: TradingView's own Templates
            // dropdown is LABELLED, and an icon-only glyph left traders hunting for a
            // "Templates" option that was on screen all along. Same narrow-desktop rule —
            // the glyph keeps the door, the word goes first.
            btn.setAttribute('aria-label', 'Chart templates');
            btn.title = 'Chart templates';
            const tplLabel = doc.createElement('span');
            tplLabel.className = 'vela-widget-btnlabel';
            tplLabel.textContent = 'Templates';
            const caret = doc.createElement('span');
            caret.className = 'vela-widget-tplcaret';
            caret.appendChild(iconEl('chevron-down', doc));
            btn.append(iconEl('templates', doc), tplLabel, caret);
            this.templatesBtn = btn;
            this.templatesMenu = new TemplatesMenu({
                templates: () => tpl.templates?.() ?? [],
                ...(tpl.onApplyTemplate ? { onApply: (name: string, target: 'active' | 'all') => tpl.onApplyTemplate?.(name, target) ?? 0 } : {}),
                ...(tpl.onSaveTemplate ? { onSave: (name: string, includeMarket: boolean) => tpl.onSaveTemplate?.(name, includeMarket) ?? false } : {}),
                ...(tpl.onDeleteTemplate ? { onDelete: (name: string) => tpl.onDeleteTemplate?.(name) } : {}),
                ...(tpl.onRenameTemplate ? { onRename: (from: string, to: string) => tpl.onRenameTemplate?.(from, to) ?? false } : {}),
                ...(tpl.onExportTemplate ? { onExport: (name: string) => tpl.onExportTemplate?.(name) ?? null } : {}),
                ...(tpl.onImportTemplate ? { onImport: (json: string) => tpl.onImportTemplate?.(json) ?? null } : {}),
                ...(tpl.defaultTemplate ? { defaultTemplate: () => tpl.defaultTemplate?.() ?? null } : {}),
                ...(tpl.onSetDefaultTemplate ? { onSetDefault: (name: string | null) => tpl.onSetDefaultTemplate?.(name) } : {}),
                ...(tpl.chartCount ? { chartCount: () => tpl.chartCount?.() ?? 1 } : {}),
                ...(tpl.builtins ? { builtins: () => tpl.builtins?.() ?? [] } : {}),
                ...(tpl.onApplyBuiltin ? { onApplyBuiltin: (id: string) => tpl.onApplyBuiltin?.(id) } : {}),
                onOpenChange: (open: boolean) => btn.setAttribute('aria-expanded', String(open)),
            });
            btn.addEventListener('click', () => this.templatesMenu?.open(btn));
        }

        // Right-hand cluster: contributed actions, then icon-only tools — the side-panel
        // toggles (filled by the dock) and screenshot. Labels live in their tooltips.
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-widget-actions';
        this.leftActionsHost = doc.createElement('span');
        this.leftActionsHost.className = 'vela-widget-actions-left';
        this.panelsHost = doc.createElement('span');
        this.panelsHost.className = 'vela-widget-panels';
        const tool = (cls: string, icon: string, tip: string, onClick?: () => void): HTMLButtonElement =>
            this.toolButton(cls, icon, tip, onClick, this.tooltips);
        // Hidden tools get a DETACHED bare button instead: the state setters
        // (setHistoryState, setAlertCount) stay safe no-ops, and no tooltip machine
        // ever binds to chrome the composition removed.
        // Undo/redo sit beside Indicators (same icon-tool chrome as the right cluster).
        if (vis('undo-redo')) {
            this.undoBtn = tool('vela-widget-undo', 'undo', 'Undo', opts.onUndoClick);
            this.redoBtn = tool('vela-widget-redo', 'redo', 'Redo', opts.onRedoClick);
        } else {
            this.undoBtn = doc.createElement('button');
            this.redoBtn = doc.createElement('button');
        }
        this.setHistoryState(false, false);
        const screenshotBtn = vis('screenshot') && !topbarActionOverride('screenshot') ? tool('vela-widget-screenshot', 'camera', 'Download screenshot', opts.onScreenshotClick) : null;
        // Bar replay sits beside the bell (the right cluster's "tools", as in TradingView's
        // top toolbar). It only exists when the host can actually open a replay menu.
        this.replayBtn =
            vis('replay') && opts.onReplayClick ? tool('vela-widget-replay', 'replay', 'Bar replay') : null;
        if (this.replayBtn && opts.onReplayClick) {
            const open = opts.onReplayClick;
            this.replayBtn.addEventListener('click', () => open(this.replayBtn!));
        }
        this.alertsBtn = vis('alerts') ? tool('vela-widget-alerts', 'bell', 'Alerts') : doc.createElement('button');
        this.alertsBtn.style.position = 'relative';
        if (opts.onAlertsClick) this.alertsBtn.addEventListener('click', () => opts.onAlertsClick!(this.alertsBtn));
        this.alertsBadge = doc.createElement('span');
        this.alertsBadge.className = 'vela-alerts-badge';
        this.alertsBadge.style.display = 'none';
        this.alertsBtn.appendChild(this.alertsBadge);

        // Workspace layout dropdown — present only when the host supplies the option
        // (and the composition keeps it).
        if (opts.layout && vis('layout')) {
            this.layoutId = opts.layout.current;
            this.layoutButton = doc.createElement('button');
            this.layoutButton.className = 'vela-widget-style';
            this.renderLayoutButton(doc);
        }

        // ── the layout NAME chip (the 'layouts' slot) ──────────────────────────
        // TradingView's layout manager lives in the top toolbar, right after undo/redo:
        // the saved layout's name, a caret, and the save verb. The name IS the status —
        // the dot beside it is the unsaved-changes sign the guide tells traders to watch.
        if (opts.layout && vis('layouts')) {
            const layout = opts.layout;
            this.layoutsGroup = doc.createElement('span');
            this.layoutsGroup.className = 'vela-widget-layoutgroup';
            const chip = doc.createElement('button');
            chip.type = 'button';
            chip.className = 'vela-widget-tool vela-widget-layoutname';
            chip.setAttribute('aria-haspopup', 'dialog');
            chip.setAttribute('aria-expanded', 'false');
            this.layoutsNameEl = doc.createElement('span');
            this.layoutsNameEl.className = 'vela-widget-layoutname-text';
            this.layoutsDot = doc.createElement('span');
            this.layoutsDot.className = 'vela-layout-dot';
            this.layoutsDot.hidden = true;
            this.layoutsDot.setAttribute('aria-hidden', 'true');
            chip.append(this.layoutsNameEl, this.layoutsDot, iconEl('chevron-down', doc));
            this.layoutsChip = chip;
            this.layoutMenu = new LayoutMenu({
                layout,
                onChange: () => this.setLayoutState(),
                onOpenChange: (open) => chip.setAttribute('aria-expanded', String(open)),
            });
            chip.addEventListener('click', () => this.layoutMenu?.open(chip));
            const save = this.toolButton('vela-widget-layoutsave', 'save', 'Save layout — Ctrl+S', () => {
                // Untitled: there is nothing to overwrite, so the menu's naming flow is the
                // only honest destination (the button must never mint a name on its own).
                if (layout.activeLayout?.() === null || layout.activeLayout === undefined) {
                    this.layoutMenu?.open(chip);
                    return;
                }
                layout.onSaveChanges?.();
                this.setLayoutState();
            }, this.tooltips);
            this.layoutSaveBtn = save;
            this.layoutsGroup.append(chip, save);
        }

        const sep = (): HTMLElement => {
            const d = doc.createElement('span');
            d.className = 'vela-sep';
            return d;
        };
        // The left action cluster's trailing hairline shows only while the cluster is
        // non-empty (renderActions).
        this.leftActionsSep = sep();
        this.leftActionsSep.hidden = true;
        // ── assemble per the composition: each side is its list, in order. Primary
        // controls carry a trailing hairline (except as a side's last entry); `actions`
        // is the FLOW slot for unlisted contributed actions; any other unknown id is a
        // PINNED slot for the contributed action with that id (filled by renderActions).
        const primaries = new Set(['symbol', 'timeframes', 'style', 'layout', 'indicators', 'templates']);
        const pinSlot = (id: string, left: boolean): HTMLElement[] => {
            const slot = doc.createElement('span');
            slot.className = 'vela-widget-action-pin';
            this.pinned.set(id, { host: slot, left });
            return [slot];
        };
        // A built-in slot taken over by an OVERRIDE (an action registered under the
        // built-in id) renders the contributed action instead of the native button, at
        // the slot's position. One exception: on a side the host left on DEFAULTS, an
        // override that declares `order` opts back into ordinary flow placement — the
        // host's explicit list, when there is one, always has the last word.
        const overridden = (id: string, left: boolean): HTMLElement[] | null => {
            const ov = topbarActionOverride(id);
            if (!ov) return null;
            const sideDeclared = left ? opts.composition?.left != null : opts.composition?.right != null;
            if (!sideDeclared && ov.order !== undefined) {
                this.flowingOverrides.add(id);
                return [];
            }
            return pinSlot(id, left);
        };
        const elementsFor = (id: string, left: boolean): HTMLElement[] => {
            switch (id) {
                case 'symbol':
                    return [this.symbolEl];
                case 'timeframes':
                    return [tfGroup];
                case 'style':
                    return [this.styleButton];
                case 'layout':
                    return this.layoutButton ? [this.layoutButton] : [];
                case 'indicators':
                    return overridden(id, left) ?? (indicatorsBtn ? [indicatorsBtn] : []);
                case 'templates':
                    return this.templatesBtn ? [this.templatesBtn] : [];
                case 'actions':
                    return left ? [this.leftActionsHost, this.leftActionsSep] : [this.actionsHost];
                case 'undo-redo':
                    return [this.undoBtn, this.redoBtn];
                case 'layouts':
                    return this.layoutsGroup ? [this.layoutsGroup] : [];
                case 'replay':
                    return this.replayBtn ? [this.replayBtn] : [];
                case 'alerts':
                    return [this.alertsBtn];
                case 'panels':
                    return [this.panelsHost];
                case 'screenshot':
                    return overridden(id, left) ?? (screenshotBtn ? [screenshotBtn] : []);
                default:
                    return pinSlot(id, left);
            }
        };
        // What a list entry will actually render — needed to look PAST an entry the host's
        // composition hides when deciding whether a hairline still belongs there.
        const willRender = (id: string): boolean => {
            switch (id) {
                case 'symbol': return !!this.symbolEl;
                case 'timeframes': return true;
                case 'style': return !!this.styleButton;
                case 'layout': return !!this.layoutButton;
                case 'indicators': return !!topbarActionOverride(id) || !!indicatorsBtn;
                case 'templates': return !!this.templatesBtn;
                case 'layouts': return !!this.layoutsGroup;
                case 'replay': return !!this.replayBtn;
                case 'screenshot': return !!topbarActionOverride(id) || !!screenshotBtn;
                case 'undo-redo': return !!this.undoBtn;
                default: return true;
            }
        };
        const nextRendered = (list: readonly string[], from: number): string | null => {
            for (let j = from; j < list.length; j += 1) {
                const cand = list[j];
                if (cand && willRender(cand)) return cand;
            }
            return null;
        };
        const sideEls = (list: readonly string[], left: boolean): HTMLElement[] => {
            const out: HTMLElement[] = [];
            for (const [i, id] of list.entries()) {
                const els = elementsFor(id, left);
                if (els.length === 0) continue;
                out.push(...els);
                // The templates dropdown is Indicators' TWIN, not a sibling group: TV draws
                // no divider between them, so the hairline lands after the pair.
                if (primaries.has(id) && nextRendered(list, i + 1) !== null && nextRendered(list, i + 1) !== 'templates') out.push(sep());
            }
            return out;
        };
        const right = doc.createElement('span');
        right.className = 'vela-topbar-right';
        right.append(...sideEls(this.comp.right, false));
        this.el.append(...sideEls(this.comp.left, true), right);
        host.appendChild(this.el);
        this.renderTfChips();
        // Snap after layout; RO catches later reflows (symbol / timeframe length).
        this.onHairlineSync();
        this.hairlineRo = new ResizeObserver(this.onHairlineSync);
        this.hairlineRo.observe(this.el);
        doc.defaultView?.addEventListener('resize', this.onHairlineSync);
        this.renderActions();

        this.tooltips.push(new Tooltip(this.tfCaret, { content: 'Timeframe', triggerId: 'vela-topbar-tf', host }));
        this.tooltips.push(new Tooltip(this.styleButton, { content: 'Chart style', triggerId: 'vela-topbar-style', host }));
        if (this.layoutButton && opts.layout) {
            this.tooltips.push(new Tooltip(this.layoutButton, { content: 'Layout', triggerId: 'vela-topbar-layout', host }));
            const layout = opts.layout;
            this.layoutPicker = new LayoutPicker({
                trigger: this.layoutButton,
                host,
                shape: () => layout.shape(),
                presets: () => layout.presets().map((p) => ({ ...p, checked: p.id === this.layoutId })),
                onSelectGrid: (rows, cols) => layout.onSelectGrid(rows, cols),
                onSelectPreset: (id) => layout.onSelectPreset(id),
                syncs: () => layout.syncs(),
                onToggleSync: (id) => layout.onToggleSync(id),
                ...(layout.onCycleGroup ? { onCycleGroup: (id) => layout.onCycleGroup?.(id) } : {}),
                ...(layout.charts ? { charts: () => layout.charts?.() ?? [] } : {}),
                ...(layout.onCycleCellGroup ? { onCycleCellGroup: (kind: string, cellId: string) => layout.onCycleCellGroup?.(kind, cellId) } : {}),
                ...(layout.onSelectChart ? { onSelectChart: (cellId: string) => layout.onSelectChart?.(cellId) } : {}),
                ...(layout.onSetCellGroup ? { onSetCellGroup: (kind: string, cellId: string, mark: string | null) => layout.onSetCellGroup?.(kind, cellId, mark) } : {}),
                ...(layout.onOpenChange ? { onOpenChange: (open: boolean) => layout.onOpenChange?.(open) } : {}),
                ...(layout.onAllInOneGroup ? { onAllInOneGroup: (kind) => layout.onAllInOneGroup?.(kind) } : {}),
                ...(layout.drawingsScope ? { drawingsScope: () => layout.drawingsScope?.() ?? 'layout' } : {}),
                ...(layout.onToggleDrawingsScope ? { onToggleDrawingsScope: () => layout.onToggleDrawingsScope?.() } : {}),
                ...(layout.hiddenCharts ? { hiddenCharts: () => layout.hiddenCharts?.() ?? 0 } : {}),
                ...(layout.onClearPooled ? { onClearPooled: () => layout.onClearPooled?.() } : {}),
                ...(layout.clearedCharts ? { clearedCharts: () => layout.clearedCharts?.() ?? 0 } : {}),
                ...(layout.onRestorePooled ? { onRestorePooled: () => layout.onRestorePooled?.() } : {}),
                ...(layout.savedLayouts ? { savedLayouts: () => layout.savedLayouts?.() ?? [] } : {}),
                ...(layout.onSaveLayout ? { onSaveLayout: (name) => layout.onSaveLayout?.(name) } : {}),
                ...(layout.onSaveLayoutWithThumb ? { onSaveLayoutWithThumb: (name: string) => layout.onSaveLayoutWithThumb?.(name) ?? false } : {}),
                ...(layout.activeLayout ? { activeLayout: () => layout.activeLayout?.() ?? null } : {}),
                ...(layout.onSaveChanges ? { onSaveChanges: () => layout.onSaveChanges?.() } : {}),
                ...(layout.autosave ? { autosave: () => layout.autosave?.() === true } : {}),
                ...(layout.onToggleAutosave ? { onToggleAutosave: (on: boolean) => layout.onToggleAutosave?.(on) } : {}),
                ...(layout.onDuplicateLayout ? { onDuplicateLayout: (name: string) => layout.onDuplicateLayout?.(name) } : {}),
                ...(opts.templates?.onRenameTemplate ? { onRenameTemplate: (from: string, to: string) => opts.templates?.onRenameTemplate?.(from, to) ?? false } : {}),
                ...(opts.templates?.defaultTemplate ? { defaultTemplate: () => opts.templates?.defaultTemplate?.() ?? null } : {}),
                ...(opts.templates?.onSetDefaultTemplate ? { onSetDefaultTemplate: (name: string | null) => opts.templates?.onSetDefaultTemplate?.(name) } : {}),
                ...(opts.templates?.templates ? { templates: () => opts.templates?.templates() ?? [] } : {}),
                ...(opts.templates?.onSaveTemplate ? { onSaveTemplate: (name: string, withMarket: boolean) => opts.templates?.onSaveTemplate?.(name, withMarket) ?? false } : {}),
                ...(opts.templates?.onApplyTemplate ? { onApplyTemplate: (name: string, target: 'active' | 'all') => opts.templates?.onApplyTemplate?.(name, target) ?? 0 } : {}),
                ...(opts.templates?.onDeleteTemplate ? { onDeleteTemplate: (name: string) => opts.templates?.onDeleteTemplate?.(name) } : {}),
                ...(opts.templates?.onExportTemplate ? { onExportTemplate: (name: string) => opts.templates?.onExportTemplate?.(name) ?? null } : {}),
                ...(opts.templates?.onImportTemplate ? { onImportTemplate: (json: string) => opts.templates?.onImportTemplate?.(json) ?? null } : {}),
                ...(layout.legend ? { legend: () => layout.legend?.() ?? [] } : {}),
                ...(layout.onRenameGroup ? { onRenameGroup: (id: string, name: string | null) => layout.onRenameGroup?.(id, name) } : {}),
                ...(layout.onSetGroupMark ? { onSetGroupMark: (id: string, glyph: string | null) => layout.onSetGroupMark?.(id, glyph) } : {}),
                ...(layout.groupName ? { groupName: (id: string) => layout.groupName?.(id) } : {}),
                ...(layout.onOpenLayout ? { onOpenLayout: (name) => layout.onOpenLayout?.(name) } : {}),
                ...(layout.onDeleteLayout ? { onDeleteLayout: (name) => layout.onDeleteLayout?.(name) } : {}),
                ...(layout.onRenameLayout ? { onRenameLayout: (from, to) => layout.onRenameLayout?.(from, to) ?? false } : {}),
                ...(layout.onExportLayout ? { onExportLayout: (name) => layout.onExportLayout?.(name) ?? null } : {}),
                ...(layout.onShareLayout ? { onShareLayout: (name: string) => layout.onShareLayout?.(name) ?? Promise.resolve(null) } : {}),
                ...(layout.onExportData ? { onExportData: layout.onExportData } : {}),
                ...(layout.onImportLayout ? { onImportLayout: (json) => layout.onImportLayout?.(json) ?? null } : {}),
                ...(layout.onCopyLink ? { onCopyLink: () => layout.onCopyLink?.() ?? Promise.resolve(null) } : {}),
                ...(layout.linkGroup ? { linkGroup: () => layout.linkGroup?.() ?? null } : {}),
                ...(layout.onLinkGroup ? { onLinkGroup: (tag) => layout.onLinkGroup?.(tag) } : {}),
            });
        }
        this.tfMenu = new Menu({
            trigger: this.tfCaret,
            triggerId: 'vela-topbar-tf',
            host,
            items: this.tfItems(),
            onSelect: (id) => opts.onTimeframe(id),
            onFavorite: (id, on) => opts.onTimeframeFavorite?.(id, on),
            // Timeframe labels are two-or-three characters ("1m", "4h", "1D") — the
            // stylesheet's default min-width would leave the list mostly empty.
            minWidth: '84px',
        });
        this.styleMenu = new Menu({
            trigger: this.styleButton,
            triggerId: 'vela-topbar-style',
            host,
            items: this.styleItems(),
            // A pinned row carries a prefixed id; the style id is what the shell applies.
            onSelect: (id) => opts.onPriceStyle(id.startsWith(STYLE_PIN_PREFIX) ? id.slice(STYLE_PIN_PREFIX.length) : id),
            iconBadges: true,
            // The same star set the phone's chart-type sheet writes: a style pinned on
            // either surface is pinned on both.
            ...(opts.onStyleFavorite
                ? {
                      onFavorite: (id: string, on: boolean) => {
                          const style = id.startsWith(STYLE_PIN_PREFIX) ? id.slice(STYLE_PIN_PREFIX.length) : id;
                          this.setStyleFavorites(on ? [style, ...this.styleFavs.filter((f) => f !== style)] : this.styleFavs.filter((f) => f !== style));
                          opts.onStyleFavorite!(style, on);
                      },
                  }
                : {}),
        });
        if (opts.styleFavorites) this.styleFavs = [...opts.styleFavorites];
        // First paint of the layout chip: an empty name element would read as a blank
        // button until the first save.
        this.setLayoutState();
    }

    /** Open the layout popover (optionally on one chart's column) — the workspace's door
     *  for the status-line badge and the series context menu. */
    openLayoutPicker(cellId?: string): void {
        this.layoutPicker?.openFor(cellId);
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = parseSymbol(symbol).ticker;
    }

    setTimeframe(tf: string): void {
        this.timeframe = tf;
        this.tfMenu.setItems(this.tfItems());
        this.renderTfChips();
    }

    /** Reflect the favorite-timeframe set — the quick-switch chips and the dropdown stars. */
    setTimeframeFavorites(favs: readonly string[]): void {
        this.tfFavs = [...favs];
        this.renderTfChips();
        this.tfMenu.setItems(this.tfItems());
    }

    /** Rebuild the quick-switch chips (current value changed, or the favorite set did). */
    private renderTfChips(): void {
        const doc = this.el.ownerDocument;
        this.tfChipsHost.replaceChildren();
        const stars = this.opts.onTimeframeFavorite !== undefined;
        const chips = stars ? favoriteTimeframeChips(this.tfFavs) : [];
        const currentIsFav = chips.includes(this.timeframe);
        // Unstarred current sits next to the caret so the favorite row never jumps.
        const shown = currentIsFav || chips.length === 0 ? chips : [...chips, this.timeframe];
        for (const tf of shown) {
            const b = doc.createElement('button');
            b.className = 'vela-widget-tf';
            const label = timeframeLabel(tf);
            b.textContent = label;
            if (tf === this.timeframe) {
                b.dataset.current = '1';
                b.setAttribute('aria-current', 'true');
            } else {
                b.setAttribute('aria-label', `Switch timeframe to ${label}`);
                b.addEventListener('click', () => this.opts.onTimeframe(tf));
            }
            this.tfChipsHost.appendChild(b);
        }
        this.tfCaret.replaceChildren();
        if (chips.length === 0) {
            this.tfCaret.dataset.solo = '1';
            this.tfCaret.append(doc.createTextNode(timeframeLabel(this.timeframe)), iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', `Timeframe — ${timeframeLabel(this.timeframe)}`);
        } else {
            delete this.tfCaret.dataset.solo;
            this.tfCaret.appendChild(iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', 'Timeframes');
        }
        this.onHairlineSync(); // the cluster width changed
    }

    setPriceStyle(style: string): void {
        this.priceStyle = style;
        this.renderStyleButton(this.styleButton.ownerDocument);
        this.styleMenu.setItems(this.styleItems());
    }

    /** Reflect the current workspace layout (no-op without the layout dropdown). */
    /**
     * Repaint the layout name chip from the host's live state — the name, the unsaved dot
     * and the save button's weight. Push it after every verb (save, open, rename, copy,
     * autosave, delete) and after the document drifts.
     */
    setLayoutState(): void {
        const layout = this.opts.layout;
        const chip = this.layoutsChip;
        if (!layout || !chip || !this.layoutsNameEl) return;
        const name = layout.activeLayout?.() ?? null;
        const rows = layout.savedLayouts?.() ?? [];
        const dirty = rows.some((r) => r.active && r.dirty === true);
        this.layoutsNameEl.textContent = name ?? 'Untitled layout';
        if (name) delete chip.dataset.untitled;
        else chip.dataset.untitled = '1';
        chip.title = name ? `Layout — ${name}` : 'Layout — untitled';
        // The name is spoken with its state: a screen reader hears the same answer the
        // dot gives the eye.
        chip.setAttribute(
            'aria-label',
            `${name ?? 'Untitled layout'}${dirty ? ', unsaved changes' : ''}. Open the layout menu`,
        );
        if (this.layoutsDot) this.layoutsDot.hidden = !dirty;
        if (this.layoutSaveBtn) {
            if (dirty) this.layoutSaveBtn.dataset.dirty = '1';
            else delete this.layoutSaveBtn.dataset.dirty;
        }
        this.layoutMenu?.refresh();
        this.layoutPicker?.refresh();
    }

    setLayout(id: string): void {
        if (!this.layoutButton) return;
        this.layoutId = id;
        this.renderLayoutButton(this.layoutButton.ownerDocument);
        this.layoutPicker?.refresh();
    }

    private renderLayoutButton(doc: Document): void {
        if (!this.layoutButton) return;
        this.layoutButton.replaceChildren();
        // The host's glyph of the current layout, else the registered 'layout' icon;
        // with neither, the current layout id as text.
        const glyph = this.opts.layout?.glyph?.();
        if (glyph || iconMarkup('layout')) {
            const icon = iconEl('layout', doc);
            if (glyph) icon.innerHTML = glyph;
            this.layoutButton.appendChild(icon);
        } else {
            this.layoutButton.appendChild(doc.createTextNode(this.layoutId ?? ''));
        }
        this.layoutButton.setAttribute('aria-label', `Layout — ${this.layoutId ?? ''}`);
    }

    private renderStyleButton(doc: Document): void {
        this.styleButton.replaceChildren();
        const icon = priceStyleIcon(this.priceStyle);
        // Icon-only entry (like the reference app); the label lives in the tooltip and the
        // dropdown rows. Unknown plugin styles without an icon fall back to their label.
        if (icon) this.styleButton.appendChild(iconEl(icon, doc));
        else this.styleButton.appendChild(doc.createTextNode(priceStyleLabel(this.priceStyle)));
        this.styleButton.setAttribute('aria-label', `Chart style — ${priceStyleLabel(this.priceStyle)}`);
    }

    /** Re-project the contributed topbar actions (call after registrations change).
     *  An action PINNED by the composition renders into its named slot (list position
     *  wins over `align`/`order`); the rest flow into the side's `actions` slot — or
     *  not at all when an explicit list omits it (the list is the side's contract). */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        this.actionsHost.replaceChildren();
        this.leftActionsHost.replaceChildren();
        for (const pin of this.pinned.values()) pin.host.replaceChildren();
        // Icon-only action buttons carry kit tooltips — dispose the previous render's
        // machines before the buttons they were bound to are discarded.
        for (const t of this.actionTooltips) t.destroy();
        this.actionTooltips = [];
        const doc = this.actionsHost.ownerDocument;
        const flowLeft = this.comp.left.includes('actions');
        const flowRight = this.comp.right.includes('actions');
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        for (const action of widgetActions('topbar', ctx)) {
            const pin = this.pinned.get(action.id);
            // A built-in-id action renders only through its slot pin, or through the
            // flow when the override opted back into it (default side + `order`) —
            // never as an ordinary extra button beside a still-native slot.
            if (!pin && builtin.has(action.id) && !this.flowingOverrides.has(action.id)) continue;
            const left = pin ? pin.left : action.align === 'left';
            if (!pin && !(left ? flowLeft : flowRight)) continue;
            const iconOnly = action.iconOnly === true && !!action.icon;
            if (action.iconOnly === true && !action.icon && !this.warnedIconless.has(action.id)) {
                this.warnedIconless.add(action.id);
                console.warn(`[vela] widget action "${action.id}": iconOnly needs an \`icon\` — rendering the label instead.`);
            }
            const b = doc.createElement('button');
            // Left actions wear the primary-chrome styling (the built-in Indicators
            // button's own class list); right actions keep the compact tool look — and
            // icon-only ones on the right take the native 32px TOOL chrome outright,
            // so a slot override is pixel-faithful to the button it replaces.
            b.className = left ? 'vela-widget-action-left' : iconOnly ? 'vela-widget-tool' : 'vela-widget-action';
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            if (iconOnly) {
                // The label still speaks — as the accessible name and the hover tooltip.
                b.setAttribute('aria-label', action.label);
                this.actionTooltips.push(new Tooltip(b, { content: action.label, triggerId: `vela-action-${action.id}`, host: this.host }));
            } else {
                b.appendChild(doc.createTextNode(action.label));
            }
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            (pin ? pin.host : left ? this.leftActionsHost : this.actionsHost).appendChild(b);
        }
        this.leftActionsSep.hidden = this.leftActionsHost.childElementCount === 0;
        this.onHairlineSync(); // the visible hairline set may have changed
    }

    setIndicatorCount(_n: number): void {
        // Count badge intentionally hidden — kept as a no-op so hosts can keep calling it.
    }

    /** Enable/disable the undo and redo tools from the host's unified history. */
    setHistoryState(canUndo: boolean, canRedo: boolean): void {
        this.undoBtn.disabled = !canUndo;
        this.redoBtn.disabled = !canRedo;
    }

    /** Light the replay slot while a session runs (and drop it back when it ends). */
    setReplayActive(active: boolean): void {
        if (!this.replayBtn) return;
        if (active) this.replayBtn.dataset.active = '1';
        else delete this.replayBtn.dataset.active;
    }

    setAlertCount(n: number): void {
        this.alertsBadge.textContent = n > 9 ? '9+' : String(n);
        this.alertsBadge.style.display = n > 0 ? '' : 'none';
    }

    /**
     * Replace the side-panel toggle group — one icon button per docked panel, in the dock's own
     * order. The dock calls this whenever its panel set changes (built-ins at construction,
     * contributed panels on every `refreshActions()`), then pushes each pressed state.
     */
    setPanelButtons(buttons: readonly SidePanelButton[], onClick: (id: string) => void): void {
        for (const t of this.panelTooltips) t.destroy();
        this.panelTooltips = [];
        this.panelBtns.clear();
        this.panelsHost.replaceChildren();
        for (const b of buttons) {
            const el = this.toolButton(`vela-widget-panel-${b.id}`, b.icon, b.title, () => onClick(b.id), this.panelTooltips);
            this.panelBtns.set(b.id, el);
            this.panelsHost.appendChild(el);
        }
    }

    /** Reflect a docked side panel's open state on its button — the panels toggle each other,
     *  so the dock pushes the state rather than the button assuming it. */
    setPanelActive(id: string, open: boolean): void {
        const btn = this.panelBtns.get(id);
        if (btn) btn.dataset.active = open ? '1' : '';
    }

    destroy(): void {
        this.hairlineRo?.disconnect();
        const win = this.el.ownerDocument.defaultView;
        win?.removeEventListener('resize', this.onHairlineSync);
        if (this.hairlineRaf) win?.cancelAnimationFrame(this.hairlineRaf);
        this.tfMenu.destroy();
        this.styleMenu.destroy();
        this.layoutPicker?.destroy();
        this.layoutMenu?.destroy();
        this.templatesMenu?.destroy();
        for (const t of [...this.tooltips, ...this.panelTooltips, ...this.actionTooltips]) t.destroy();
        this.el.remove();
    }

    /** One icon-only tool button with its kit tooltip, parked in `sink` for disposal. */
    private toolButton(cls: string, icon: string, tip: string, onClick: (() => void) | undefined, sink: Tooltip[]): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.className = `vela-widget-tool ${cls}`;
        b.appendChild(iconEl(icon, doc));
        b.setAttribute('aria-label', tip);
        // Kit tooltip only — a native `title` on top of it double-tooltips. Explicit host: at
        // construction the topbar is NOT in the DOM yet, so the closest('.vela-ui') fallback
        // would portal to <body> — outside the theme vars.
        sink.push(new Tooltip(b, { content: tip, triggerId: `vela-tool-${cls}`, host: this.host }));
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    /** Paint each `.vela-sep` as exactly one device pixel, snapped to the pixel grid. */
    private syncHairlines(): void {
        const win = this.el.ownerDocument.defaultView;
        if (!win) return;
        const dpr = win.devicePixelRatio || 1;
        for (const el of this.el.querySelectorAll<HTMLElement>('.vela-sep')) {
            el.style.width = `${1 / dpr}px`;
            el.style.transform = '';
            const left = el.getBoundingClientRect().left;
            const dx = Math.round(left * dpr) / dpr - left;
            if (dx) el.style.transform = `translateX(${dx}px)`;
        }
    }

    private tfItems(): MenuItemDescriptor[] {
        // Stars only when the host handles the toggle — a starless dropdown otherwise.
        const stars = this.opts.onTimeframeFavorite !== undefined;
        return this.opts.timeframes.map((tf) => ({
            id: tf,
            label: timeframeLabel(tf),
            checked: tf === this.timeframe,
            ...(stars ? { favorite: this.tfFavs.includes(tf) } : {}),
        }));
    }

    /** Reflect the starred chart types (the sheet wrote them, or a document restore did). */
    setStyleFavorites(ids: readonly string[]): void {
        this.styleFavs = [...ids];
        this.styleMenu?.setItems(this.styleItems());
    }

    private styleItems(): MenuItemDescriptor[] {
        // Live list: built-ins ∪ plugin-registered chart types (a registered type shows
        // up here automatically — the SDK's style-picker contribution). Registered types
        // sit BELOW a separator: the built-in price styles and the plugin chart types
        // read as two distinct families.
        //
        // STARRED types are also repeated in a pinned block at the very top — the phone
        // sheet's "Favourites" section, on the desktop menu. The pinned rows carry a
        // prefixed id so the menu's row map stays unique; selection strips the prefix.
        const starred = this.opts.onStyleFavorite !== undefined;
        const row = (id: string, separatorBefore: boolean): MenuItemDescriptor => ({
            id,
            label: priceStyleLabel(id),
            icon: priceStyleIcon(id),
            checked: id === this.priceStyle,
            separatorBefore,
            ...(starred ? { favorite: this.styleFavs.includes(id) } : {}),
        });
        const ids = priceStyleIds();
        const pinned = ids.filter((id) => this.styleFavs.includes(id));
        const out: MenuItemDescriptor[] = pinned.map((id) => ({ ...row(id, false), id: `${STYLE_PIN_PREFIX}${id}` }));
        // The pinned block is a separate family — one divider, then the full list.
        ids.forEach((id, i) => {
            const item = row(id, pinned.length > 0 ? i === 0 : i === BUILTIN_PRICE_STYLES.length);
            out.push(item);
        });
        return out;
    }
}
