// VelaWorkspace — the multi-chart shell: a CSS-Grid of ChartCells behind ONE shared
// data feed, wrapped in ONE shared chrome (topbar + layout dropdown, pickers, object
// tree, bottombar, keymap, alerts) that PROJECTS the ACTIVE cell and acts on it.
//
// The projection rule has exactly two triggers, and the chrome holds no state of its
// own: ① on `cell:active` the chrome rebinds wholesale (`projectActiveCell`); ② a
// cell's own events re-project only while that cell IS the active one (alerts are the
// exception — always aggregated, tagged by cell). Statusline/watermark/context-menu/
// undo-history are per-cell; everything else is shared.
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import { indicatorReference, indicatorReferenceKey, resolveIndicatorReference } from '../core/indicator-reference';
import type { VelaTheme, NativeBackend, VelaOptions } from '../core/options';
import type { VelaShellOptions } from '../widget/shell-options';
import { resolveTheme } from '../core/theme';
import { TypedEventBus } from '../core/events/EventBus';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import { sharedBarStore } from '../data/BarStore';
import { ensureUIHost, injectStyles, registerIcon, svg16 } from '../ui';
import { installPremiumStyles } from '../ui/premium';
import { installSmoothScrolling } from '../ui/scrolling';
import { isEditableTarget, KeymapManager } from '../ui/keymap';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Popover } from '../ui/components/popover';
import { DatePicker, isoDate } from '../ui/components/date-picker';
import { Dialog } from '../ui/components/dialog';
import { enableButtonTooltips } from '../ui/components/tooltip';
import { ReplayToolbar, REPLAY_CALENDAR_CLASS, REPLAY_DEFAULT_SPEED } from '../widget/replay-toolbar';
import type { Vela } from '../Vela';
import { joinWorkspaceLink } from './link';
import { IndicatorLiveSync, type IndicatorLinkMode } from './indicator-live-sync';
import { Topbar, priceStyleLabel, priceStyleIcon, priceStyleMarkup } from '../widget/topbar';
import { Bottombar, RANGE_PRESETS } from '../widget/bottombar';
import { SecondClock } from '../core/util/wall-clock';
import { ObjectTree } from '../widget/object-tree';
import { LayoutManagerPanel } from '../widget/layout-manager-panel';
import { LayoutSetupPanel } from '../widget/layout-setup-panel';
import { withFavorite } from '../widget/indicator-templates';
import { canonicalTicker } from '../widget/symbol-quick-switch';
import { DataWindow } from '../widget/data-window';
import { StrategyTester } from '../widget/strategy-tester';
import { PineEditor } from '../widget/pine-editor';
import type { ScriptRun } from '../core/script-run';
import { PanelDock } from '../widget/panel-dock';
import { WorkspaceToolPanel } from '../widget/workspace-tool-panel';
import { SymbolPicker } from '../widget/symbol-picker';
import { IndicatorPicker, indicatorKey } from '../widget/indicator-picker';
import { TimeframeQuick } from '../widget/timeframe-quick';
import { ShortcutsHelp } from '../widget/shortcuts-help';
import { AlertPanel, type AlertEditDraft } from '../widget/alert-panel';
import type { ArmedAlertRow } from '../widget/alert-list';
import type { AlertRequest, AlertTarget } from '../widget/alert-create';
import { CompareSheet } from '../widget/compare-sheet';
import type { CompareDisplay } from '../core/native-indicators/compare';
import type { DrawingSetTemplate, DrawingSetTemplateDrawing, DrawingSyncEntry, DrawingSyncMode, IndicatorDefault, SavedPriceAlert } from '../state/document';
import { sanitizeDrawingSetTemplates } from '../state/document';
import { BUILTIN_TEMPLATES, builtinTemplate } from '../state/builtin-templates';
import type { InputValue } from '../core/model/inputs';
import { advanceAlert, alertRowLabel, alertWatchesSymbol, CONDITION_LABELS, describeAlert, isMoveCondition, movingFires, type AlertCondition, type AlertFrequency, type PriceAlert } from './price-alerts';
import { REDUCED_MOTION_CSS } from '../ui/motion';
import { CommandPalette, type PaletteCommand } from '../widget/command-palette';
import { Toast } from '../widget/toast';
import { recordRecent, recentOf } from '../widget/favorites';
import { Glider, ZOOM_IN, ZOOM_OUT, PAN_FAST } from '../widget/glide';
import { toolShortcutHints } from '../widget/tool-shortcuts';
import {
    legendActionsProviderFor,
    legendCalloutsProviderFor,
    mobilePlacement,
    registerLegendAction,
    resolveEngines,
    statePersistenceHandlers,
    topbarActionOverride,
    widgetActions,
    widgetAttachments,
    type WidgetActionDescriptor,
} from '../widget/contributions';
import { resolveTopbarComposition, topbarHas, TOPBAR_BUILTIN_IDS, type ResolvedTopbarComposition } from '../widget/topbar-composition';
import { LayoutModeController, type LayoutMode } from '../widget/layout-mode';
import { MobileBar } from '../widget/mobile-bar';
import { TimeframeDrawer } from '../widget/timeframe-drawer';
import { DrawingsDrawer } from '../widget/drawings-drawer';
import { MoreDrawer } from '../widget/more-drawer';
import { TimezoneDrawer } from '../widget/timezone-drawer';
import { DrawingPill } from '../widget/drawing-pill';
import { priceStyleIds } from '../renderers/native/core/chartConfig';
import { resolveIndicators, type IndicatorManifest, type ResolvedIndicator } from '../widget/indicators';
import { DrawingToolbar } from '../renderers/native/drawings/DrawingToolbar';
import { applyAttributionMarkTheme, createAttributionMark, createCustomMark } from '../renderers/native/chrome/AttributionMark';
import { rendererDefaults } from '../core/renderer-defaults';
import { buildToolbar, drawingLevelAt, getDrawingType, templateColor, type DrawingTypeKey, type SerializedDrawing, type SnapMode, type ToolbarDefinition } from '../core/drawings';
import { timeframeToMs } from '../data/timeframe';
import { timeframeLabel } from '../widget/timeframe';
import { registerBuiltinChartTypes } from '../chart-types/builtins';
import { parseSymbol } from '../data/ProviderRegistry';
import { groupsForCount, groupMarkOf, setMarkOverrides } from './sync-marks';
import {
    alignedRangeAround,
    groupDef,
    groupIdOf,
    groupNameOf,
    groupOf,
    groupSetting,
    IMPLICIT_GROUP,
    markOf,
    rangesWithin,
    nextGroupMark,
    styleConfigPatch,
    syncEnabled,
    syncGroups,
    syncTargets,
    SYNC_KINDS,
    type SyncKind,
    type SyncOptions,
    type SyncSetting,
} from './sync';
import { normalizeCursorStyle, type CursorStyle } from '../core/cursor';
import { encodeState, decodeState, decodeStateDetailed, sanitizeState, type CellState, type ChartTemplate, type DrawingToolsState, type SavedLayoutMeta, type WorkspaceState, type WorkspaceStorage } from './persist';
import { encodeShareUrl, decodeShareHash } from '../state/share';
import { decodeLayoutShareHash, isLayoutShareHash, layoutShareUrl } from './share-link';
import { localStorageAdapter, type StorageFailure } from '../widget/persist';

/** The links in TradingView's reading order — the picker's rows and the badge's order. */
const SYNC_ROW_ORDER: ReadonlyArray<readonly [SyncKind, string]> = [
    ['viewport', 'Date range'],
    ['time', 'Time'],
    ['symbol', 'Symbol'],
    ['timeframe', 'Interval'],
    ['crosshair', 'Crosshair'],
    ['drawings', 'Drawings'],
    ['style', 'Style'],
];
/** The same labels as a lookup, for the status-line badge's tooltip. */
const KIND_LABEL = Object.fromEntries(SYNC_ROW_ORDER) as Record<SyncKind, string>;
import { ChartCell, seedDefaults, cellChartDefaults, type CellSeed, type CellBoot, type PooledCellState, type SettingsTemplatesService, type IndicatorDefaultsService } from './ChartCell';
import { WidgetHistory } from '../widget/history';
import { buildContext, type WorkspaceWidgetContext } from './context';
import { WorkspaceReplay, lastOpenClosedBy } from './WorkspaceReplay';
import {
    registerBuiltinLayouts,
    layouts,
    layoutDefinition,
    gridStyles,
    activeAfterLayout,
    orderAfterLayout,
    ensureLayout,
    layoutForGrid,
    layoutShape,
    layoutGlyph,
    occupancyGrid,
    type LayoutDefinition,
    type TrackSizes,
} from './layouts';
import { SplitterLayer, evenTracks } from './splitters';
import { buildChartCsv, type CsvScope, type CsvTimeFormat } from './csv';
import { downloadText } from '../ui/download';
import { compositeLayoutScreenshot, tilesFromCellRects, triggerPngDownload, type LayoutShotTile } from './screenshot';

/**
 * The workspace options: the widget's chart vocabulary + the shared shell surface + the
 * grid's own options. Every chart option given TOP-LEVEL (symbol, timeframe, priceStyle,
 * upColor, glow, defaultLanguage, …) is the DEFAULT of each cell — `cells` overrides it
 * per cell with the same words. `height` is the one chart option a grid cannot honor
 * (the layout sizes cells), so it is omitted from the type.
 */
export interface VelaWorkspaceOptions extends Omit<VelaOptions, 'height'>, VelaShellOptions {
    /** Initial layout — a registered id (`'1'`, `'2h'`, `'2v'`, `'4'`, `'8'`, or a
     *  plugin-registered one) or an inline definition. Default `'4'`.
     *
     *  `false` = SINGLE-CHART mode: the grid is pinned to the one-cell layout, the
     *  layout picker disappears from the topbar and the mobile drawer (the sync
     *  switches with it — meaningless with one cell), `setLayout` becomes a no-op,
     *  and a restored document keeps only its first chart live (the rest stays
     *  dormant in the pool). No `cells` entry is needed — the top-level chart
     *  options seed the single chart. */
    layout?: string | LayoutDefinition | false;
    /** Per-cell overrides of the top-level chart defaults, keyed by a FREE-FORM cell
     *  name — the name is the cell's durable IDENTITY (persistence, `sync` groups,
     *  `ws.cell(name)`), never its position: DECLARATION ORDER fills the layout's
     *  slots (first declared → first slot). Fewer entries than slots ⇒ the remaining
     *  slots boot on the defaults (auto identity); more ⇒ the extras wait in the pool
     *  and appear when a larger layout reveals them. Purely-numeric names are rejected
     *  (JS object keys would reorder them). Same vocabulary as the widget, reduced to
     *  the per-cell seeds ({@link CellSeed}). */
    cells?: Record<string, CellSeed>;
    /** The ONE shared drawing toolbar, docked left of the grid and acting on the active
     *  cell (per-cell in-chart bars stay hidden either way; a `drawings` object still
     *  configures tools/persistence per cell). Default true. */
    drawingToolbar?: boolean;
    /** Sync links between cells: per kind, `true` = all cells, or a `{cellId: group}`
     *  record (only same-group cells follow each other). `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also toggleable from the
     *  layout dropdown); `style` mirrors Canvas, Scales-and-lines, and Status line
     *  settings (same dropdown); `drawings` copies each newly created drawing onto
     *  the followers and keeps the set linked — edits and removals follow (also
     *  toggleable from the shared drawing toolbar). Default: everything off.
     *  Change at runtime via `ws.sync.set(kind, setting)`. */
    sync?: SyncOptions;
    /** Above this many cells, EVERY cell uses the canvas2d backend (uniform look inside
     *  the browser's WebGL-context budget; glow is unavailable there). Default 8; an
     *  explicit `nativeBackend` other than `'auto'` wins over this policy. */
    maxWebglCells?: number;
    /** How many alerts the topbar bell keeps (the oldest drop beyond it). Default 50. */
    alertCap?: number;
    /** New charts inherit the FIRST chart's live indicator set (TradingView's rule) —
     *  add a chart to a grid whose leader carries SMA + RSI and it arrives with both.
     *  Chart settings stay per cell. Default true; a pooled cell always keeps its own. */
    inheritIndicators?: boolean;
    /**
     * What a drawing belongs to. `'layout'` (default) keeps today's model: the cell owns
     * its drawings and the `drawings` link mirrors them onto same-group cells. `'global'`
     * makes them belong to the SYMBOL (TradingView's global scope): switching a chart's
     * symbol parks the drawings under the old symbol and restores the new one's, and the
     * store survives layout switches and reloads.
     */
    drawingsScope?: 'layout' | 'global';
    /** The `drawings` link follows only charts on the SAME symbol — TradingView's rule
     *  (a BTC trend line has no meaning on an ETH chart). Default true. */
    drawingsSameSymbol?: boolean;
    /** The bar-replay CHROME: the topbar's `'replay'` slot, the floating transport bar
     *  (play/pause, step, speed, jump-to-real-time, exit), the entry menu (select bar /
     *  select date / random bar) and the `Shift+↓` / `Shift+→` chords. Default true.
     *  `false` removes only the chrome — `ws.replay` and `ctx.replay` stay whole, so a
     *  host that drives replay from its own controls loses nothing. */
    replay?: boolean;
}

/** A cell's {@link ScriptRun}, tagged with the cell it ran in. */
export type WorkspaceScriptRun = ScriptRun & { cell: string };

export interface WorkspaceEventMap extends Record<string, unknown> {
    /** The active cell changed (click/focus in a cell, or `setActiveCell`). */
    'cell:active': { id: string; prev: string | null };
    /**
     * A script computed in ANY cell — the per-chart `script:run` relayed up with its cell
     * identity, so one subscription covers the whole grid, cells added by a later layout
     * change included.
     */
    'script:run': WorkspaceScriptRun;
    /**
     * One cell's price style is switching `from` → `to` — the per-chart
     * `priceStyle:change` relayed up with the cell's identity, so one subscription
     * covers the whole grid, cells added by a later layout change included. Only the
     * cell whose style changes emits. Same timing as the chart event: synchronous,
     * before that cell repaints, so `ws.cell(id).priceStyle` and the cell's canvas
     * still show `from` while the listener runs.
     */
    'cell:priceStyle': { id: string; from: string; to: string };
    /** The grid switched layouts (cells created/destroyed/restored around it). */
    'layout:changed': { layout: string };
    /** A cell was maximized over the whole grid, or the grid restored (`id: null`). */
    'cell:maximized': { id: string | null };
    'cell:created': { id: string };
    'cell:destroyed': { id: string };
    /** The persistable state changed (debounced ~500ms) — re-pull `getState()` if you
     *  consume it. The signal custom persistence flows build on. */
    'state:changed': undefined;
    /** Another tab wrote the persisted document (this tab did NOT adopt it). */
    'state:external': { key: string; raw: string };
    /** A storage write failed and the shell could not work around it. */
    'persist:failed': { kind: 'quota' | 'blocked' | 'unknown' };
}

const DEFAULT_TIMEFRAMES = ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'];
const GAP_PX = 2; // grid gap — the visible seam between cells (splitter strips center on it)
const POOL_CAP = 16; // dormant slot states kept across layout shrinks
const TIME_AXIS_H = 22; // px the renderer reserves for a time axis (mirrors NativeRenderer's)
const ALERT_CAP = 50;
/** Closes kept per chart for the Moving alerts' lookback window (the reference caps at 500). */
const PRICE_HISTORY = 512;
/** Fraction of the visible width "jump to real time" pans — many screens wide, so the
 *  renderer's own pan limit (the bounded whitespace past the newest bar) lands it. */
const REPLAY_JUMP_PANS = 8;

const STYLE_ID = 'vela-workspace';
/** Distinct ids for the main landmark when several workspaces share a document. */
let workspaceSeq = 0;
const CSS = `
.vela-workspace { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--vela-bg); }
/* Two landmarks and a way past the chrome. The shell is one big div tree: without a
   main region a screen reader announces no structure at all, and without the skip link
   every keyboard user walks the whole topbar (about ten stops) before the first chart.
   The link is out of flow until it takes focus, so it costs no pixels. */
.vela-ws-skip {
    position: absolute; z-index: 2147483000; left: 10px; top: -60px;
    padding: 8px 12px; border-radius: 8px; border: 1px solid var(--vela-border);
    background: var(--vela-surface-elev); color: var(--vela-fg);
    font: 600 12px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; text-decoration: none;
    /* A skip link is used with a keyboard or a thumb — both want a 44px box. */
    min-height: 44px; display: inline-flex; align-items: center;
}
.vela-ws-skip:focus { top: 10px; outline: 2px solid var(--vela-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { .vela-ws-skip { transition: top 120ms cubic-bezier(.2,.7,.3,1); } }
.vela-ws-main:focus { outline: none; }
.vela-ws-main:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-ws-main { position: relative; display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; }
/* Contain the layout contribution of off-screen desktop panels, without clipping their
   visible overflow or changing the scroll behaviour of the surrounding host page. */
[data-layout='desktop'] .vela-ws-main { contain: layout; }
.vela-ws-toolbar { position: relative; flex: none; }
.vela-ws-strips { position: relative; flex: none; display: flex; flex-direction: column; min-width: 0; }
.vela-ws-strips:empty { display: none; }
.vela-ws-grid { position: relative; flex: 1 1 auto; min-width: 0; display: grid; gap: ${GAP_PX}px; background: var(--vela-border-soft); }
.vela-cell { background: var(--vela-bg); position: relative; }
/* Active-cell highlight: an overlay ring ABOVE the chart's own canvas stack (a plain
   outline on the cell is painted under them) — inert to the pointer. Scoped to
   multi-cell grids ([data-multi]): a single-cell layout always has an active cell,
   and ringing the only chart would just be noise. */
.vela-ws-grid[data-multi='1'] .vela-cell[data-active='1']::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--vela-fg-bright);
    pointer-events: none;
    z-index: 10;
}
/* Splitter hover mirrors the in-chart pane separator hover (CrosshairRenderer):
   a soft band over the whole grab target + a solid 2px line on the seam center. */
.vela-ws-splitter:hover { background: var(--vela-separator-hover-band); }
.vela-ws-splitter:hover::after { content: ''; position: absolute; background: var(--vela-separator-hover-line); }
.vela-ws-splitter[data-axis='cols']:hover::after { left: calc(50% - 1px); top: 0; width: 2px; height: 100%; }
.vela-ws-splitter[data-axis='rows']:hover::after { top: calc(50% - 1px); left: 0; height: 2px; width: 100%; }
/* Mobile: the docked drawing-toolbar column would eat a phone-width grid — the shell's
   drawings drawer + on-chart pill replace it (same policy as the widget's in-chart bar). */
[data-layout='mobile'] .vela-ws-toolbar { display: none; }
[data-layout='mobile'] .vela-ws-drawdock { flex: none; min-height: 0; }
/* No bottom bar: the strip still has to sit on the grid's bottom edge, so it goes back
   to being an overlay (nothing else can overlap it — there is no bar below). */
[data-layout='mobile'] .vela-ws-grid > .vela-drawdock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 31;
}
/* A maximized cell owns the whole grid: the splitter strips have no seams to grab and
   the active ring would just outline the only visible chart — both are noise here. */
.vela-ws-grid[data-maximized='1'] .vela-ws-splitter { display: none; }
.vela-ws-grid[data-maximized='1'] .vela-cell[data-active='1']::after { display: none; }
/* Drop-target preview while a cell's drag handle is held: a dashed ring + the same
   soft wash the splitter hover uses, over the chart, inert to the pointer. */
.vela-cell[data-drop-target='1']::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px dashed var(--vela-fg-bright);
    background: var(--vela-separator-hover-band);
    pointer-events: none;
    z-index: 11;
}
`;

/** Grid glyph for the topbar layout dropdown (stroke follows the button color). */
registerIcon('layout', svg16('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><path d="M8 1.5v13M1.5 8h13"/>'));

/**
 * The cell identities the `cells` option declares, in DECLARATION order — a cell's
 * NAME never encodes its position: the first declared entry fills the first layout
 * slot, and so on. Purely-numeric names are rejected with a warning (JS object
 * enumeration reorders integer-like keys ahead of everything, silently breaking the
 * declared order).
 */
/**
 * The document's identity for the layout manager: everything a save stores, minus the
 * bookkeeping that says nothing about the CHART —
 *   • `savedLayouts` / `layoutPrefs` — the manager's own state (it never nests),
 *   • `layoutMeta` — the preview/timestamp side-cars (they change on every save),
 *   • `seenTips` — one-time UI acknowledgements. Opening a surface can burn a coach
 *     mark; that is not an edit, and treating it as one lit the dot on a layout
 *     nobody had touched (measured: the picker itself flipped the flag).
 * Key order is fixed by the serializers, so two equal documents hash equal.
 */
export function layoutFingerprint(state: WorkspaceState | Record<string, unknown>): string {
    const { savedLayouts: _a, layoutPrefs: _b, layoutMeta: _c, seenTips: _d, ...rest } = state as Record<string, unknown>;
    return JSON.stringify(rest);
}

export function declaredOrder(cells: Record<string, unknown> | undefined): string[] {
    const names = Object.keys(cells ?? {});
    for (const n of names) {
        if (/^\d+$/.test(n)) {
            console.warn(`[vela] workspace cell "${n}" ignored — a purely-numeric name cannot keep its declaration order (JS object key semantics); use e.g. "cell${n}"`);
        }
    }
    return names.filter((n) => !/^\d+$/.test(n));
}

/** The first `c<N>` name not already taken — identities for slots beyond the declared list. */
export function nextAutoCellId(taken: ReadonlySet<string>): string {
    for (let i = 1; ; i += 1) {
        if (!taken.has(`c${i}`)) return `c${i}`;
    }
}

/** Which dialogs are up when a bare keystroke reaches the workspace root. */
export interface TypingState {
    dialogs: number;
    symbolSearch: boolean;
    timeframeEntry: boolean;
}

/**
 * What a bare keystroke on the workspace root does. Nothing open: a letter or `0` seeds
 * symbol search (no timeframe starts with 0), a digit 1–9 the timeframe entry. An ENTRY
 * dialog open: its field takes focus a tick after the dialog reports open, so the next
 * key of a fast typist (`NQ`, `15`) still lands on the root — it is handed to that
 * dialog as more typed text instead of dropped. Any other open dialog swallows bare
 * typing. Pure — unit-tested.
 */
export function resolveTyping(key: string, open: TypingState): { target: 'symbol' | 'timeframe'; text: string } | null {
    if (open.dialogs > 0) {
        if (key.length !== 1) return null; // a printable character, not a control key
        if (open.symbolSearch) return { target: 'symbol', text: key.toUpperCase() };
        if (open.timeframeEntry) return { target: 'timeframe', text: key.toUpperCase() };
        return null;
    }
    if (/^[a-zA-Z0]$/.test(key)) return { target: 'symbol', text: key.toUpperCase() };
    if (/^[1-9]$/.test(key)) return { target: 'timeframe', text: key };
    return null;
}

/** A value bag reduced to what the document sanitizer keeps (primitives only), or null. */
function primitiveBag(bag: Record<string, InputValue>): Record<string, number | string | boolean> | null {
    const out: Record<string, number | string | boolean> = {};
    for (const [key, value] of Object.entries(bag)) {
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
        else if (typeof value === 'string') out[key] = value;
        else if (typeof value === 'boolean') out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
}

export class VelaWorkspace {
    readonly root: HTMLElement;
    private readonly disableButtonTooltips: () => void;
    /** The shortcut system — one manager for the whole workspace, routed to the active cell. */
    readonly keymap: KeymapManager;
    /** Bar replay across every cell on one clock (see {@link WorkspaceReplay}). */
    readonly replay: WorkspaceReplay;
    /** The floating replay transport bar (`null` when `replay: false`). */
    private replayBar: ReplayToolbar | null = null;
    /** The pace a PAUSED session resumes on — the core keeps `intervalMs` only on a live
     *  session, and picking a speed while paused must not start playback. */
    private replaySpeed = REPLAY_DEFAULT_SPEED;
    /** "Select bar" is armed: the next click on any plot starts the session there. */
    private replayArmed = false;
    /** Teardown for the armed state's listeners (cell clicks, crosshair previews, Esc). */
    private replayArmOffs: Array<() => void> = [];
    private replayMenu: Menu | null = null;
    private replayDatePop: Popover | null = null;
    /** A drawer Replay tap waiting for the sheet to finish closing (see the opener). */
    private pendingReplayAnchor: HTMLElement | null = null;

    private readonly gridEl: HTMLElement;
    /** Id of the main landmark — the skip link's target. */
    private readonly mainId: string;
    private readonly stripsEl: HTMLElement;
    private readonly events = new TypedEventBus<WorkspaceEventMap>();
    private readonly feed = new MultiProviderFeed();
    private readonly cellsById = new Map<string, ChartCell>();
    /** The one second pulse behind every time display: the bottom-bar clock and each
     *  cell's countdown chip subscribe to it, so they can never read different seconds. */
    private readonly clock = new SecondClock();
    private readonly pool = new Map<string, PooledCellState>();
    /** The batch the last `clearPooled` dropped — the housekeeping row's one-level Undo. */
    private pooledCleared: Map<string, PooledCellState> | null = null;
    private readonly trackSizes = new Map<string, TrackSizes>(); // per layout id (splitter drags)
    private readonly splitters: SplitterLayer;
    private readonly resizeObserver: ResizeObserver | null = null;
    private readonly opts: VelaWorkspaceOptions;
    private def: LayoutDefinition;
    /** Cell identities by SLOT POSITION — `order[i]` lives in the layout's i-th slot.
     *  Names come from the `cells` declaration order (then the persisted document);
     *  slots beyond the list get auto identities. Grows, never reorders. */
    private order: string[] = [];
    private activeId: string | null = null;
    /** The cell maximized over the whole grid (null = normal grid). TRANSIENT view
     *  state — never persisted; any structural change (layout, applyState) restores. */
    private maximizedId: string | null = null;
    private cellBackend: NativeBackend = 'auto';
    /** `layout: false` — the grid is pinned to the one-cell layout, the layout picker
     *  and sync switches never render, and `setLayout` no-ops. */
    private readonly monoLayout: boolean;
    /** `drawings: false` — the whole user-drawings surface is gone: no shared bar, no
     *  mobile drawings stop, no pill (the headless `chart.drawings` API stays). */
    private readonly drawingsEnabled: boolean;
    /** The shared bar's content — `drawings: { tools | groups }` picks it. */
    private readonly toolbarDef: ToolbarDefinition;
    private destroyed = false;

    // ── shared chrome ──
    private readonly topbar: Topbar;
    private readonly bottombar: Bottombar | null;
    private readonly objectTree: ObjectTree;
    private readonly dataWindow: DataWindow;
    /** Shared Layout / Chart syncing pane; a single-chart workspace has no grid setup. */
    private layoutSetup: LayoutSetupPanel | null = null;
    /** The backtest report of the strategy running on the active cell — empty until one does. */
    private readonly strategyTester: StrategyTester;
    /** One shared two-tab Alerts pane, reached by the bell and drawing actions. */
    private readonly alertPanel: AlertPanel;
    /** The tester opened itself once already — after that it is the user's column to open. */
    private testerAnnounced = false;
    /** The script editor's panel — null when the host has no engine (nothing to run). */
    private readonly pineEditor: PineEditor | null;
    /** Unregisters the editor's "Source code" legend action. */
    private readonly editorLegendOff: (() => void) | null;
    /** The side-panel column, shared by the whole grid. */
    private readonly dock: PanelDock;
    private readonly symbolPicker: SymbolPicker;
    /** Null when the host disabled it (`indicatorPicker: false`). */
    private readonly indicatorPicker: IndicatorPicker | null;
    private readonly tfQuick: TimeframeQuick;
    private shortcutsHelp: ShortcutsHelp | null = null;
    /** The Alt+G dialog, kept so a second press replaces it instead of stacking. */
    private goToDateDialog: Dialog | null = null;
    private readonly toastHost: Toast;
    private readonly glider = new Glider(() => (this.activeId ? (this.cellsById.get(this.activeId)?.chart ?? null) : null));
    private readonly drawToolbar: DrawingToolbar | null;
    /** The GLOBAL armed tool/magnet/stay (workspace policy) — re-applied to whichever cell
     *  takes the focus; only the ACTIVE cell ever holds a non-null tool. Measure/eraser
     *  stay transient and per-cell: they exit when the focus leaves. */
    private globalTool: DrawingTypeKey | null = null;
    private globalSnap: SnapMode = 'off';
    /** Sticky drawing (TradingView's stay-in-drawing-mode) is the DEFAULT. */
    private globalStay = true;
    /** Starred chart types — a shared preference, persisted with the document (the same
     *  channel as drawing-tool and timeframe favourites). */
    private styleFavs: string[] = [];
    /** Starred indicator keys (see `IndicatorPicker`): document-backed, like the two above. */
    private indFavs: string[] = [];
    /** Favorite indicator templates — `template:<name>` / `builtin:<id>` keys. */
    private templateFavs: string[] = [];
    /** Live subscription to the ACTIVE cell's unified history (rebound on every projection). */
    private historyUnsub: (() => void) | null = null;
    /** Global snapshot timeline for chart edits with no per-object inverse (settings,
     *  panes, visual order, templates, layout management, …). Composite undo/redo picks
     *  the newest entry from this stack and the active cell's fine-grained stack. */
    private readonly workspaceHistory = new WidgetHistory(undefined, 80);
    private readonly workspaceHistoryUnsub = this.workspaceHistory.onChange(() => this.syncHistoryButtons());
    private historyBaseline: string | null = null;
    private historyBaselineClock = 0;
    private historyTimer: ReturnType<typeof setTimeout> | null = null;
    private historyRestoreDepth = 0;
    private historySuppressUntil = 0;
    /** Favorite drawing tools — a WORKSPACE preference (one star set, every cell). */
    private favs: string[] = [];
    /** Every drawing tool's remembered settings — a SHARED pref, mirrored onto every cell. */
    private toolDefs: Record<string, unknown> = {};
    /** Every drawing tool's saved looks — a SHARED pref like the remembered settings. */
    private toolTemplates: Record<string, unknown> = {};
    /** Re-entrancy guard while one cell's remembered settings fan out to the others. */
    private toolDefsBusy = false;
    /** Favorite timeframes — the shared topbar's quick-switch chips, one set for the grid. */
    private tfFavs: string[] = [];
    /** Live sync configuration (mutable copy of the option). */
    private readonly syncOpts: SyncOptions = {};
    /** New-cell indicator inheritance (see {@link VelaWorkspaceOptions.inheritIndicators}). */
    private readonly inheritIndicators: boolean;
    /** Drawings belong to the symbol (see {@link VelaWorkspaceOptions.drawingsScope}). */
    private drawingsScope: 'layout' | 'global';
    /** The drawings link never crosses symbols (see {@link VelaWorkspaceOptions.drawingsSameSymbol}). */
    private readonly drawingsSameSymbol: boolean;
    /** The symbol-keyed drawing store the `'global'` scope maintains. */
    private drawingsBySymbol: Record<string, unknown> = {};
    /** Named workspace snapshots ("Save layout as…"), by name. */
    private readonly savedLayouts = new Map<string, WorkspaceState>();
    /** Side-car data for the snapshots (preview JPEG + save time), by name. */
    private readonly layoutMeta = new Map<string, SavedLayoutMeta>();
    /** Saved chart TEMPLATES — indicator sets, no drawings (see `ChartTemplate`). */
    private readonly templates = new Map<string, ChartTemplate>();
    /** Saved DRAWING SETS — whole bundles of drawings with relative geometry. */
    private readonly drawingSets = new Map<string, DrawingSetTemplate>();
    /** Per-object drawing sync scope; grouped with the state, not with a chart's local history. */
    private readonly drawingSyncModes = new Map<string, DrawingSyncEntry>();
    /** Source drawing → target cell → generated clone id (`insertDocuments` mints fresh ids). */
    private readonly drawingSyncClones = new Map<string, Map<string, string>>();
    /** Newborns waiting for their inherited manifest; donor identity prevents accidental
     * reuse of an unrelated same-type instance while layout links reconcile. */
    private readonly indicatorSyncInheritedFrom = new Map<string, string>();
    /** Runtime-only provenance: inherited instances can be linked without duplicating or
     * accidentally adopting unrelated, same-type studies on established charts. */
    private readonly indicatorOrigins = new Map<string, Map<string, number>>();
    private nextIndicatorOrigin = 0;
    /** Script instances that were in the donor's ledger but await the shared manifest. */
    private readonly deferredInheritedIndicators = new Map<string, Set<number>>();
    /** Linked indicator INSTANCES, not a one-time copy or a per-type global setting. */
    private readonly indicatorLiveSync = new IndicatorLiveSync(
        () => [...this.cellsById.values()].map((cell) => ({
            id: cell.id,
            handles: () => cell.chart.indicators(),
            copy: (source) => {
                const inherited = this.inheritedIndicator(cell.id, source);
                if (inherited) return inherited;
                if (source.nativeType) return cell.chart.addNativeIndicator(source.nativeType, { inputs: source.inputValues() });
                if (!source.source || !cell.chart.hasEngine(source.language) || this.indicatorCopyDeferred(cell.id, source)) return null;
                return cell.addManifestInstance({ name: source.title, script: source.source, enabled: true, ...(source.language ? { language: source.language } : {}) }, {
                    standalone: true, record: false, inputs: source.inputValues(), props: source.propValues(), hidden: !source.visible,
                });
            },
            deferred: (source) => !!source.source && cell.chart.hasEngine(source.language) && this.indicatorCopyDeferred(cell.id, source),
        })),
        () => this.markStateDirty(),
    );
    /** Scope assigned to new objects from the object tree's Manage objects button. */
    private drawingSyncDefault: DrawingSyncMode = 'none';
    /** The shell watchlist — symbols in display order. */
    private watchlist: string[] = [];
    /** Names the USER gave to sync groups, keyed by the stable group id. */
    private groupNames: Record<string, string> = {};
    /** Custom GLYPHS for sync groups, keyed by the stable group id. Mirrored into the
     *  palette registry (`setMarkOverrides`) on every change, because the chip, the
     *  matrix and the legend all read the mark from there. */
    private groupMarks: Record<string, string> = {};
    /** One-time tips already shown (the ◌ affordance, the palette chord). */
    private readonly seenTips = new Set<string>();
    /** The live coach mark, if any (one at a time — two pointing fingers is noise). */
    /** Tab-link tag (TradingView Desktop's colored tab link); null = unlinked. */
    private linkGroup: string | null = null;
    /** The tab-link transport (same page synchronously, other tabs via BroadcastChannel). */
    private readonly link = joinWorkspaceLink((m) => this.applyLinked(m));
    /** Inside a peer's linked write: our own market echo must not broadcast again. */
    private linkApplying = false;
    /**
     * The market a peer just handed us. `market:changed` and `viewport:changed` land
     * ASYNCHRONOUSLY (after the new bars paint), long after {@link linkApplying} has
     * dropped — so the echo is matched on its CONTENT here and never travels back. Without
     * this, two linked tabs trade the same envelope forever (each side's stale echo
     * overwriting the other's newest market).
     */
    private linkInbox: { symbol?: string; timeframe?: string; range?: { from: number; to: number } } | null = null;
    /** The saved snapshot opened (or written) last — the picker's active row. */
    private activeSavedLayout: string | null = null;
    /** Autosave + the house templates for new charts (see `WorkspaceState.layoutPrefs`). */
    private layoutPrefs: { autosave: boolean; defaultTemplate: string | null; defaultAppearance: string | null; sharing: boolean } = {
        autosave: false,
        defaultTemplate: null,
        defaultAppearance: null,
        sharing: false,
    };
    /** CHART-SETTINGS templates: the chart's appearance under a name (TV's Settings →
     *  Templates). The market and the indicators are not part of one. */
    private readonly appearanceTemplates = new Map<string, Record<string, unknown>>();
    /** One service object for every cell (the verbs take the cell id). */
    private readonly settingsTemplatesService: SettingsTemplatesService = {
        list: (cellId) => this.appearanceTemplateList(cellId),
        activeName: (cellId) => this.appearanceTemplateName(cellId),
        defaultName: () => this.layoutPrefs.defaultAppearance,
        setDefault: (name) => this.setDefaultAppearanceTemplate(name),
        apply: (name, target) => {
            this.applyAppearanceTemplate(name, target);
        },
        save: (name, cellId) => this.saveAppearanceTemplate(name, cellId),
        remove: (name) => this.deleteAppearanceTemplate(name),
        applyToAll: (cellId) => this.applySettingsToAll(cellId),
        chartCount: () => this.cellsById.size,
    };
    /** INDICATOR defaults, by indicator type id (TradingView: indicator settings →
     *  Defaults → "Save as default"). Full value bags, so loading one is exact. */
    private readonly indicatorDefaults = new Map<string, IndicatorDefault>();
    private readonly indicatorDefaultsService: IndicatorDefaultsService = {
        has: (type) => this.indicatorDefaults.has(type),
        get: (type) => {
            const entry = this.indicatorDefaults.get(type);
            return entry ? { inputs: { ...(entry.inputs ?? {}) }, props: { ...(entry.props ?? {}) } } : null;
        },
        save: (type, inputs, props) => this.saveIndicatorDefault(type, inputs, props),
        clear: (type) => this.clearIndicatorDefault(type),
        applyToAll: (type, inputs, props) => this.applyIndicatorSettingsToAll(type, inputs, props),
        chartCount: () => this.cellsById.size,
    };
    /**
     * Document revision, bumped by every {@link markStateDirty}. Saving a layout records
     * the revision it captured; the picker's "unsaved changes" dot is the difference.
     * A counter, not a deep compare: the doc carries clocks and viewports that change
     * without the user touching anything, and a false "unsaved" is worse than none.
     */
    private docRevision = 0;
    /** {@link docRevision} as of the last save of {@link activeSavedLayout}. */
    private savedRevision = 0;
    /** The document's content hash at save time — what the dirty dot actually compares. */
    private readonly savedFingerprints = new Map<string, string>();
    /** Pending autosave (debounced; a burst of edits writes once). */
    private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
    /** Last layout-chip signature pushed to the top bar (name|dirty|autosave|count). */
    private layoutChipSig = '';
    /** Trailing repaint of that chip after a burst of document changes. */
    private layoutChipTimer: ReturnType<typeof setTimeout> | null = null;
    /** Inside a click-driven time alignment: viewport echoes are the controller's own. */
    private timeBusy = false;
    // ── persistence (state surface + adapter plumbing) ──
    private readonly persistKey: string | null;
    /** Storage refused a write for lack of space; writes now leave the previews out. */
    private slimOnQuota = false;
    /** Throttle for the two storage notices (a failing adapter retries every 500 ms). */
    private lastStorageNotice = 0;
    /** One-shot: the chart pool is full and a dormant chart had to be dropped. */
    private poolDropNoticed = false;
    /** Throttle for the "another tab wrote this" notice. */
    private lastExternalNotice = 0;
    private readonly storage: WorkspaceStorage;
    private stateTimer: ReturnType<typeof setTimeout> | null = null;
    /** Re-entrance guard for {@link flushPendingState}: a `state:changed` subscriber that
     *  calls back into the workspace (`destroy()` on save is the obvious one) must not
     *  re-enter the flush and recurse. */
    private emitting = false;
    /** False until the constructor finishes. Boot is not an edit: seeding the sync
     *  settings marks state dirty, so without this a workspace mounted and torn down
     *  inside the debounce window would flush and tell the host the user had changed
     *  something — a save of the default document over whatever was stored. */
    private booted = false;
    /** A page unload gets the same flush as a teardown — the pending edit reaches the
     *  host, the timer is cleared, and a `destroy()` that follows adds no second write. */
    private readonly onUnload = (): void => {
        this.flushPendingState();
        this.persistNow();
    };
    /** Restore saved alerts, including those whose chart is pooled or currently absent. */
    private restorePriceAlerts(rows: readonly SavedPriceAlert[] | undefined, restoredDrawings: ReadonlySet<string> = new Set()): void {
        // Runtime IDs and drawings will be replaced; an editor must not save over a new row.
        this.alertPanel?.cancelEdit();
        // A document with no alerts CLEARS the arm list. Never delete a drawing that the
        // incoming document just restored, or one still referenced by another alert:
        // drawing-backed alerts can legitimately point at a price alert's dotted line.
        for (const alert of this.priceAlerts) {
            if (!alert.lineId || !alert.lineOwned || restoredDrawings.has(alert.cellId)) continue;
            const retained = rows?.some((row) => row.cellId === alert.cellId && (row.source?.drawingId === alert.lineId
                || (!row.source && !isMoveCondition(row.condition as AlertCondition) && row.value === alert.value)));
            if (retained) continue;
            try {
                const cell = this.cellsById.get(alert.cellId);
                const drawing = cell?.chart.drawings.all().find((item) => item.id === alert.lineId);
                if (drawing?.type === 'hline' && drawing.style?.lineStyle === 'dotted' && drawing.anchors?.[0]?.price === alert.value)
                    cell?.chart.drawings.remove(alert.lineId);
            } catch {
                /* the cell may be gone */
            }
        }
        this.priceAlerts = [];
        if (!rows || rows.length === 0) {
            this.alertPanel?.refresh();
            this.moreDrawer?.refreshAlerts();
            return;
        }
        for (const row of rows) {
            // A pooled (or temporarily absent) chart is not evaluating, but its alert
            // still belongs to the document and must not disappear on restore.
            const alert: PriceAlert = {
                id: `a${++this.alertIdSerial}`,
                cellId: row.cellId,
                symbol: row.symbol,
                condition: row.condition as AlertCondition,
                value: row.value,
                frequency: row.frequency,
                state: row.state,
                createdAt: row.createdAt,
                anchorPrice: null,
                bars: row.bars,
                firedAt: 0,
                fires: row.fires,
                lineId: row.source ? '' : (row.lineId ?? ''),
                lineOwned: !row.source && row.lineOwned === true,
                source: row.source,
            };
            const cell = this.cellsById.get(row.cellId);
            alert.anchorPrice = this.alertAnchorPrice(alert, cell);
            // Old documents had no owned-line ID. Recover their matching dotted line
            // conservatively as unowned; never delete a possibly user-created drawing.
            if (!alert.source) alert.lineId = cell
                ? (this.drawAlertLevel(cell, alert, !row.lineId) ?? '')
                : (this.pooledAlertLine(alert, !row.lineId) ?? row.lineId ?? '');
            this.priceAlerts.push(alert);
        }
        for (const cell of this.cellsById.values()) this.syncAlertLines(cell);
        this.alertPanel?.refresh();
        this.moreDrawer?.refreshAlerts();
    }

    /** Re-entrance guard around one propagation tick: followers' synchronous echoes
     *  (their setVisibleRange re-emits viewport:changed) must not re-propagate. */
    private syncBusy = false;
    /** Same guard for the drawings link: the propagated mutations' own `drawing:*`
     *  events fire synchronously inside the propagation loop and must not fan out again. */
    private drawingSyncBusy = false;
    /** Same guard for the style link: a follower's `applyConfig` re-fires its
     *  `onConfigChanged` in the same tick, and a state restore applies per-cell
     *  configs that legitimately differ — neither must propagate. */
    private styleSyncBusy = false;
    /** The last ON form of every link — what the switches restore when a link is
     *  flicked off and back on (a grouped grid keeps its chips). */
    private readonly lastSyncOn: Partial<Record<SyncKind, SyncSetting>> = {};
    /** LINKED drawings (the drawings sync): one map per synced set (cellId → that
     *  cell's drawing id), reachable from every member under its `cellId\0drawingId`
     *  key — any member finds its peers to push edits/removals onto. Survives a
     *  toggle-off (propagation freezes while the setting is off; re-enabling resumes
     *  edit/delete for these pairs). Cleared on reload / `applyState`. */
    private readonly drawingLinks = new Map<string, Map<string, string>>();
    private manifest: ResolvedIndicator[] = [];
    /** The shared manifest can no longer change instance sets — resolved, or no
     *  `indicators` option so nothing ever will. Gates the cells' ledger fallback. */
    private manifestSettled = false;
    private timezone: string;
    /** The pointer every chart shows (Cross / Dot / Arrow / Demonstration / Magic / Eraser /
     *  None) — a view preference that travels with the document, like the timezone. */
    private cursorStyle: CursorStyle = 'cross';
    private openDialogs = 0;
    /** The layout sheet is open (it is a popover, not a dialog, so it does not count in
     *  `openDialogs` — but it covers the grid a coach mark points at). */
    private syncSurfaceOpen = false;
    private alerts: Array<{ cellId: string; source: string; title: string; message: string; time: number }> = [];
    /** Bell retention — `alertCap` option, default {@link ALERT_CAP}. */
    private readonly alertCap: number;
    /** Price alerts still watching a level, oldest first (the sheet/manager read this). */
    private priceAlerts: PriceAlert[] = [];
    /** Never reuse a runtime row id: a stale edit/delete cannot target a replacement. */
    private alertIdSerial = 0;
    /** The last price each cell printed, keyed by cell id — the level prefill + the tick feed. */
    private readonly lastPrice = new Map<string, number>();
    /** The last {@link PRICE_HISTORY} closes per cell — the window a Moving alert looks back
     *  over. Close-based, matching the reference's "within N bars" rule. */
    private readonly closeHistory = new Map<string, number[]>();
    /** The bar time of each entry in {@link closeHistory} (same length, same order). */
    private readonly closeTimes = new Map<string, number[]>();
    private readonly lastBarTime = new Map<string, number>();
    /** A search pick can re-point the active chart's single Compare study. */
    private comparePending = false;
    private returnToCompareAfterSearch = false;
    private compareSearchEpoch = 0;
    /** Per cell+handle fallback mirrors; live indicator inputs are authoritative. */
    private readonly compareSymbols = new Map<string, string>();
    private readonly compareDisplays = new Map<string, CompareDisplay>();
    /** Suppress duplicate placement for this shell's own synchronous input writes. */
    private readonly compareWrites = new Set<string>();
    /** Cells whose price axis THIS shell switched to percent for a Same-% compare. */
    private readonly compareAxisSwitched = new Set<string>();
    private compareSheet: CompareSheet | null = null;
    private symbolPanel!: WorkspaceToolPanel;
    private indicatorPanel: WorkspaceToolPanel | null = null;
    private templatesPanel!: WorkspaceToolPanel;
    private comparePanel!: WorkspaceToolPanel;
    private morePanel!: WorkspaceToolPanel;
    /** ⌘K palette — built lazily on first open. */
    private palette: CommandPalette | null = null;
    /** Recently run palette commands, newest first (persisted with the document). */
    private recentCommands: string[] = [];
    // ── mobile chrome (same components as the widget shell; CSS keys off data-layout
    // on the root, the drawers build lazily on first open and act on the ACTIVE cell) ──
    /** Writes `data-layout` on the root and pushes mode flips into every cell's renderer. */
    private layoutCtl!: LayoutModeController;
    private mobileBar: MobileBar | null = null;
    /** Replay scope the entry menu holds ("Replay all charts"). */
    private replayScope: 'all' | 'cell' = 'all';
    private drawingPill: DrawingPill | null = null;
    /** Desktop-only chrome — the top bar, the shared drawing rail and the bottom bar —
     *  parked as an anchor + element pair. A mobile shell keeps all three OUT of the
     *  document (their nodes are the bulk of what a phone would never show) and puts them
     *  back exactly where they were when the layout returns to desktop. */
    private readonly desktopChrome: Array<{ el: HTMLElement; anchor: Comment }> = [];
    private tfDrawer: TimeframeDrawer | null = null;
    private drawingsDrawer: DrawingsDrawer | null = null;
    private moreDrawer: MoreDrawer | null = null;
    /** Anchored, non-modal management menu: save/copy/rename/share — never the chart grid. */
    private layoutManager: LayoutManagerPanel | null = null;
    private timezoneDrawer: TimezoneDrawer | null = null;
    /** Plot-local y of the last price-axis long-press (targets the pane under the finger). */
    private readonly attachmentDisposers = new Map<string, () => void>();
    /** The resolved topbar composition — one visibility truth for topbar, mobile, keys. */
    private topbarComp!: ResolvedTopbarComposition;
    /** Built-in slots taken over by a contributed action (resolved at construction —
     *  the register-at-import-time contribution rule). The override owns the slot's
     *  WHOLE surface: desktop button, mobile counterpart, keyboard chord. */
    private indicatorsOverride?: WidgetActionDescriptor;
    private screenshotOverride?: WidgetActionDescriptor;
    /** The document-level third-party state bag (`state.ext`) — seeded from the restored
     *  document, refreshed by global-scope handler `serialize` calls at snapshot time.
     *  Entries with no registered handler this session ride along verbatim. */
    private extState: Record<string, unknown> = {};
    /** The single grid-wide attribution mark — re-inked on a live theme swap. */
    private attributionMark: HTMLElement | null = null;
    private readonly onRootKeydown = (ev: KeyboardEvent): void => this.routeTyping(ev);

    constructor(container: HTMLElement | string, opts: VelaWorkspaceOptions = {}) {
        registerBuiltinLayouts(); // idempotent — pickers and `layout` ids resolve from the registry
        registerBuiltinChartTypes(); // ditto — the topbar style menu resolves before the first cell builds
        const hostEl = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
        if (!hostEl) throw new Error(`VelaWorkspace: container not found: ${String(container)}`);
        this.opts = opts;
        this.inheritIndicators = opts.inheritIndicators !== false;
        this.drawingsScope = opts.drawingsScope ?? 'layout';
        this.drawingsSameSymbol = opts.drawingsSameSymbol !== false;
        // Before any cell exists: the replay watches every cell from its creation on.
        this.replay = new WorkspaceReplay({
            cells: () => this.cells(),
            activeId: () => this.activeId,
            onCells: (handler) => {
                const offs = [
                    this.events.on('cell:created', ({ id }) => handler({ kind: 'created', id })),
                    this.events.on('cell:destroyed', ({ id }) => handler({ kind: 'destroyed', id })),
                    this.events.on('cell:active', ({ id }) => handler({ kind: 'active', id })),
                ];
                return () => {
                    for (const off of offs) off();
                };
            },
        });
        // ── persistence boot: a SYNC storage restores before the first build (no flash
        // of defaults); an async adapter resolves later and late-applies via applyState.
        this.persistKey = opts.persist === undefined || opts.persist === false ? null : opts.persist === true ? 'vela-workspace' : opts.persist;
        this.storage = opts.storage ?? localStorageAdapter({ onError: (f) => this.handleStorageFailure(f) });
        let boot: WorkspaceState | null = null;
        if (this.persistKey !== null) {
            const raw = this.storage.get(this.persistKey);
            if (typeof raw === 'string') {
                const decoded = decodeStateDetailed(raw);
                boot = decoded.state;
                // A payload this build cannot read is NOT deleted: it is copied aside, so
                // an upgrade (or a human with the console) can still recover the trader's
                // work instead of it being overwritten by the next default save.
                if (!boot && raw.length > 0 && decoded.reason !== 'empty') this.rescueUnreadable(raw, decoded.reason);
            } else if (raw != null && typeof raw === 'object') {
                void raw.then((r) => {
                    if (this.destroyed || !r) return;
                    const decoded = decodeStateDetailed(r);
                    if (decoded.state) {
                        // Async-storage boot is a programmatic restore, not a user edit.
                        this.withHistoryRestore(() => this.applyState(decoded.state));
                    } else this.rescueUnreadable(r, decoded.reason);
                });
            }
            if (typeof window !== 'undefined') {
                window.addEventListener('beforeunload', this.onUnload);
                // Another TAB writing this key is the one conflict localStorage can tell
                // us about (the event never fires in the document that wrote). We do not
                // adopt the other document — that would silently discard what this tab
                // has in hand — we say so and let the host decide.
                window.addEventListener('storage', this.onForeignWrite);
            }
        }
        this.timezone = boot?.timezone ?? opts.timezone ?? 'Etc/UTC';
        this.cursorStyle = normalizeCursorStyle(boot?.cursor ?? opts.cursor);
        if (boot?.favorites) this.favs = [...boot.favorites];
        if (boot?.timeframeFavorites) this.tfFavs = [...boot.timeframeFavorites];
        if (boot?.chartTypeFavorites) this.styleFavs = [...boot.chartTypeFavorites];
        if (boot?.indicatorFavorites) this.indFavs = [...boot.indicatorFavorites];
        if (boot?.drawingTools) this.adoptDrawingTools(boot.drawingTools);
        const sync = boot?.sync ?? opts.sync;
        for (const kind of SYNC_KINDS) this.applySyncSetting(kind, sync?.[kind]);
        // Single-chart mode pins the grid to '1' — a persisted document's layout is
        // presentation the mode overrides, while its charts still restore (first one
        // live, the rest dormant in the pool).
        this.monoLayout = opts.layout === false;
        const optLayout = opts.layout === false || opts.layout === undefined ? '4' : opts.layout;
        this.def = this.resolveLayout(this.monoLayout ? '1' : (boot?.layout && ensureLayout(boot.layout) ? boot.layout : optLayout));
        this.alertCap = Math.max(1, opts.alertCap ?? ALERT_CAP);
        // The topbar composition also gates the matching MOBILE entries (bar stop,
        // drawer rows) and keyboard chords below — one visibility truth for an entry.
        this.topbarComp = resolveTopbarComposition(opts.topbar);
        this.indicatorsOverride = topbarActionOverride('indicators');
        this.screenshotOverride = topbarActionOverride('screenshot');
        if (boot?.trackSizes) for (const [id, ts] of Object.entries(boot.trackSizes)) this.trackSizes.set(id, ts);
        if (boot?.ext) this.extState = { ...boot.ext }; // global handlers restore at the end of construction
        if (boot?.charts) for (const { id, ...cs } of boot.charts) {
            this.pool.set(id, cs);
            if (cs.compareAutoPercent) this.compareAxisSwitched.add(id);
        }
        // Identity ↔ slot mapping: the persisted document's chart order wins (it IS the
        // saved arrangement); a fresh boot takes the `cells` declaration order.
        this.order = boot?.charts ? boot.charts.map((c) => c.id) : declaredOrder(opts.cells);
        const bootActive = boot?.activeCellId ?? null;
        // ── side-cars: everything in the document that is NOT the grid ──────────────
        // The boot path used to restore the layout, the cells and the links only. Saved
        // layouts, templates, the watchlist, group names/marks, seen tips, recents and
        // the tab-link tag were read from disk and then DROPPED — and the first debounced
        // save wrote the empty maps straight back over them. Restoring them here (before
        // any cell is built) is what makes a reload a reload.
        if (boot) {
            this.hydrateSideCars(boot);
            if (this.linkGroup) this.link.setTag(this.linkGroup);
        }

        const doc = hostEl.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        // R87 premium surfaces: one shared design language for every floating panel.
        // It is injected after the workspace sheet and wins by the `html.vela-premium`
        // scope (specificity), not by source order — panel sheets inject later still lose.
        installPremiumStyles(doc);
        // One global rule for the CSS half of `prefers-reduced-motion` (the canvas half
        // lives in NativeRenderer). Scoped to the library's roots, injected once.
        injectStyles('vela-reduced-motion', REDUCED_MOTION_CSS, doc);
        installSmoothScrolling(doc);
        this.root = doc.createElement('div');
        this.root.className = 'vela-workspace';
        this.disableButtonTooltips = enableButtonTooltips(this.root);
        // First child on purpose: it must be the FIRST stop in the document.
        this.mainId = `vela-ws-main-${(workspaceSeq += 1)}`;
        const skip = doc.createElement('a');
        skip.className = 'vela-ws-skip';
        skip.href = `#${this.mainId}`;
        skip.textContent = 'Skip to charts';
        this.root.appendChild(skip);
        ensureUIHost(this.root, resolveTheme(opts.theme));
        this.publishPageBackground(resolveTheme(opts.theme));

        // ONE shared feed: providers registered once; every cell's `chart.data` operates
        // on the same registry, symbol index, and closed-bar cache.
        for (const [name, make] of Object.entries(opts.providers ?? {})) void this.feed.registerProvider(name, make());
        void this.feed.ready().then(() => {
            if (!this.destroyed) {
                this.refreshRetention(); // re-key on canonical tickers once indexes settle
                this.symbolPicker?.sync();
            }
        });

        // ── shared dialogs/pickers (they act on the ACTIVE cell at call time) ──
        this.symbolPicker = new SymbolPicker({
            host: this.root,
            // Row icons come from each descriptor's OWNING provider (resolveSymbolIcon).
            iconFor: (d) => this.feed.symbolIconOf(d),
            // The Compare sheet reuses this picker: a pending compare routes the pick to the
            // second series instead of swapping the chart's own market.
            onSelect: (ticker) => {
                if (this.comparePending) {
                    this.comparePending = false;
                    this.setCompareSymbol(ticker);
                    return;
                }
                this.active.setSymbol(ticker);
            },
            // Phone: the picker opens as a bottom sheet over the chart instead of taking the
            // whole screen — changing the pair is a scroll and a tap, not a panel visit.
            sheet: () => this.layoutCtl?.current === 'mobile',
            // The watchlist: the trader's shortlist at the top of the picker, a star on
            // every row, and (multi-chart) one tap to put a symbol on EVERY chart.
            watchlist: () => this.watchlist,
            onToggleWatch: (symbol, on) => {
                if (on) this.addToWatchlist(symbol);
                else this.removeFromWatchlist(symbol);
            },
            onApplyAll: (symbol: string) => this.setSymbolForAll(symbol),
            // Compare chooses a second series, never a bulk replacement of primary markets.
            canApplyAll: () => !this.comparePending && this.cells().length > 1,
            onOpenChange: (open) => {
                // In-chart dialogs (indicator inputs, chart settings) live inside a cell's
                // chart container, so opening the search from the topbar never hits their
                // outside-dismiss — close them on every cell explicitly.
                if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                this.mobileBar?.setExpanded('symbol', open);
                if (!open && this.returnToCompareAfterSearch) {
                    this.returnToCompareAfterSearch = false;
                    const epoch = this.compareSearchEpoch;
                    // Selection calls close first, then onSelect synchronously. Defer cancellation
                    // and the return until the selected symbol has reached the active chart.
                    queueMicrotask(() => {
                        if (epoch !== this.compareSearchEpoch) return;
                        this.comparePending = false;
                        if (this.destroyed || this.symbolPicker.isOpen) return;
                        const occupied = this.layoutCtl?.current === 'mobile' ? this.dock.openId : this.dock.dockedId;
                        if (!occupied || occupied === 'compare') this.compareSheet?.open();
                    });
                }
            },
        });
        this.symbolPicker.setSource(() => this.feed.symbols());
        // The picker exists only while it has an entry point left: the deprecated
        // `indicatorPicker: false`, a composition without 'indicators', or an OVERRIDE
        // of the slot all remove every one of them (topbar button, mobile-bar item,
        // `/`), so the dialog is not built. The shared manifest still resolves and
        // auto-adds either way.
        this.indicatorPicker =
            opts.indicatorPicker !== false && !this.indicatorsOverride && topbarHas(this.topbarComp, 'indicators')
                ? new IndicatorPicker({
                      host: this.root,
                      library: () => this.activeCell()?.libraryRows() ?? [],
                      onChart: () => this.activeCell()?.onChartRows() ?? [],
                      onAdd: (i) => {
                          this.active.addFromLibrary(i);
                          // The clock tab's feed — the habit, not the promise (a star).
                          const row = this.active.libraryRows()[i];
                          if (row) recordRecent('indicators', indicatorKey(row));
                      },
                      onRemove: (i) => this.active.removeFromChart(i),
                      onSettings: (i) => this.active.openChartRowSettings(i),
                      // The catalog row's `{ }`: a built-in opens READ-ONLY (TradingView's
                      // rule), a library script opens editable.
                      onSource: (row) => {
                          if (row.source !== undefined) this.openEditor(row.source, row.name, { readOnly: row.native === true });
                      },
                      favorites: () => this.indFavs,
                      onFavorite: (key, on) => this.setIndicatorFavorite(key, on),
                      recent: () => recentOf('indicators'),
                      // The Templates tab — the same store, verbs and built-ins the desktop
                      // dropdown drives, so a phone (whose topbar is hidden) reaches the whole
                      // template vocabulary from inside the indicator sheet.
                      templates: {
                          rows: () => this.templateList(),
                          onApply: (name, target) => this.applyTemplate(name, target),
                          onSave: (name, includeMarket) => this.saveTemplate(name, { includeMarket }),
                          onRename: (from, to) => this.renameTemplate(from, to),
                          onDelete: (name) => this.deleteTemplate(name),
                          onExport: (name) => this.exportTemplate(name),
                          onImport: (json) => this.importTemplate(json),
                          defaultName: () => this.defaultTemplate(),
                          onSetDefault: (name) => this.setDefaultTemplate(name),
                          chartCount: () => this.cellsById.size,
                          builtins: () => this.builtinTemplates(),
                          onApplyBuiltin: (id) => { this.applyBuiltinTemplate(id); },
                      },
                      onOpenChange: (open) => {
                          // Same rule as the symbol search: the renderer's in-chart dialogs never see
                          // an outside-dismiss from a topbar dialog — close them on every cell.
                          if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                          this.mobileBar?.setExpanded('indicators', open);
                      },
                  })
                : null;
        const picker = this.indicatorPicker;
        this.tfQuick = new TimeframeQuick({
            host: this.root,
            onApply: (tf) => this.setActiveTimeframe(tf),
            onOpenChange: (open) => this.trackDialog(open),
        });

        // Chart templates: the dropdown beside Indicators. Its own group, so a
        // single-chart shell (no `layout` block) still carries it.
        // ── topbar (shared) — reflects the active cell; the layout dropdown reads the registry live ──
        this.topbar = new Topbar(this.root, {
            symbol: '',
            // RAW option, not the resolved lists — the bar distinguishes a host-declared
            // side (list is law) from a default one (an override's `order` may flow).
            composition: opts.topbar,
            onSymbolClick: () => this.openSymbolSearch(),
            onSymbolStep: (delta) => this.stepQuickSymbol(delta),
            onOpenLayoutManager: (anchor) => this.openLayoutManager(anchor),
            onOpenLayoutSetup: (keyboard) => this.openLayoutSetup('layout', undefined, true, keyboard),
            ...(picker ? { onIndicatorsClick: () => picker.open() } : {}),
            onUndoClick: () => this.undoHistory(),
            onRedoClick: () => this.redoHistory(),
            onScreenshotClick: () => this.downloadScreenshot(),
            onAlertsClick: () => this.dock.toggle('alerts'),
            prioritizeAlerts: true,
            // TradingView's "Compare" tool, in the top toolbar: a second series on the
            // active chart. The button is a STATE — it lights up and names the symbol
            // while a comparison is on screen.
            compare: { symbol: () => this.compareLabel(), onClick: () => this.openCompare() },
            // The replay slot exists only when the chrome does — a shell with
            // `replay: false` never renders a dead button.
            ...(opts.replay === false ? {} : { onReplayClick: (anchor: HTMLElement) => this.openReplayMenu(anchor) }),
            timeframe: '60',
            timeframes: opts.timeframes ?? DEFAULT_TIMEFRAMES,
            timeframeFavorites: this.tfFavs,
            priceStyle: 'candles',
            onTimeframe: (tf) => this.setActiveTimeframe(tf),
            onTimeframeFavorite: (tf, on) => this.setTimeframeFavorite(tf, on),
            onPriceStyle: (style) => this.active.setPriceStyle(style),
            onStyleFavorite: (id, on) => this.setStyleFavorite(id, on),
            // Single-chart mode: no layout block at all — the topbar renders no layout
            // button and no sync switches (see TopbarOptions.layout).
            layout: this.monoLayout ? undefined : {
                current: this.def.id,
                layoutGridSetupOnly: true,
                // The picker composes dynamic layouts on its grid canvas; registered
                // presets the canvas cannot express (bespoke plugin areas) list as rows.
                shape: () => layoutShape(this.def),
                presets: () => this.presetRows(),
                onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
                onSelectPreset: (id) => this.setLayout(id),
                // One row list for BOTH shells (see syncRows): every link the model
                // carries is exposed, and a group record reads as ON — the old list
                // showed four switches and lied about grouped links.
                syncs: () => this.syncRows(),
                onToggleSync: (id) => this.toggleSync(id as SyncKind),
                onCycleGroup: (id) => this.cycleGroup(id as SyncKind),
                charts: () => this.syncCharts(),
                onCycleCellGroup: (kind, cellId) => this.cycleGroupFor(kind as SyncKind, cellId),
                onSetCellGroup: (kind, cellId, mark) => this.setGroupFor(kind as SyncKind, cellId, mark),
                onSelectChart: (cellId) => { if (this.cellsById.has(cellId)) this.setActiveCell(cellId); },
                onAllInOneGroup: (kind) => this.syncAllInOneGroup(kind as SyncKind),
                drawingsScope: () => this.drawingsScope,
                onToggleDrawingsScope: () => this.setDrawingsScope(this.drawingsScope === 'global' ? 'layout' : 'global'),
                hiddenCharts: () => this.hiddenChartCount,
                onClearPooled: () => this.clearPooled(),
                clearedCharts: () => this.clearedChartCount,
                onRestorePooled: () => this.restorePooled(),
                savedLayouts: () =>
                    this.savedLayoutList().map((l) => ({
                        ...l,
                        thumb: this.layoutThumb(l.name),
                        savedAt: this.layoutSavedAt(l.name),
                    })),
                onSaveLayout: (name) => this.saveLayout(name),
                onSaveLayoutWithThumb: (name) => this.saveLayoutWithThumbnail(name),
                // The manager's verbs: what the open layout is, whether it drifted, and
                // the two TradingView settings this build was missing (autosave, copy).
                activeLayout: () => this.activeSavedLayout,
                onSaveChanges: () => this.saveActiveLayout(),
                autosave: () => this.autosaveEnabled(),
                onToggleAutosave: (on) => this.setAutosave(on),
                onDuplicateLayout: (name) => this.duplicateLayout(name),
                legend: () => this.groupLegend(),
                onRenameGroup: (id, name) => this.setGroupName(id, name),
                groupName: (id) => this.groupNames[id],
                onSetGroupMark: (id, glyph) => this.setGroupMark(id, glyph),
                onOpenLayout: (name) => this.openLayout(name),
                onDeleteLayout: (name) => this.deleteLayout(name),
                onRenameLayout: (from, to) => this.renameLayout(from, to),
                onExportLayout: (name) => this.exportLayout(name),
                onImportLayout: (json) => this.importLayout(json),
                onShareLayout: (name) => this.copyLayoutLink(name),
                onExportData: (scope, timeFormat) => this.exportChartCsv(scope, timeFormat),
                // A share link is the only way to hand a layout to someone else without an
                // account: the whole document, compressed, in the URL fragment.
                onCopyLink: () => this.copyShareLink(),
                linkGroup: () => this.linkGroup,
                onLinkGroup: (tag) => this.setLinkGroup(tag),
                glyph: () => layoutGlyph(this.def),
                onOpenChange: (open) => this.setSyncSurfaceOpen(open),
            },
            // The templates dropdown beside Indicators. Outside the layout block on
            // purpose: a single-chart shell has no layout manager, but it still saves and
            // applies indicator templates.
            templates: {
                templates: () => this.templateList(),
                onApplyTemplate: (name, target) => this.applyTemplate(name, target),
                builtins: () => this.builtinTemplates(),
                onApplyBuiltin: (id) => {
                    this.applyBuiltinTemplate(id);
                },
                onSaveTemplate: (name, includeMarket) => this.saveTemplate(name, { includeMarket }),
                onDeleteTemplate: (name) => this.deleteTemplate(name),
                onRenameTemplate: (from, to) => this.renameTemplate(from, to),
                onExportTemplate: (name) => this.exportTemplate(name),
                onImportTemplate: (json) => this.importTemplate(json),
                defaultTemplate: () => this.defaultTemplate(),
                onSetDefaultTemplate: (name) => this.setDefaultTemplate(name),
                chartCount: () => this.cellsById.size,
                favoriteTemplates: () => this.templateFavoriteList(),
                onToggleTemplateFavorite: (key, on) => this.toggleTemplateFavorite(key, on),
            },
            getContext: () => this.context(),
        });
        this.anchorChrome(this.topbar.el);

        // ── main row: the shared drawing toolbar + the grid + the docked side panels ──
        const main = doc.createElement('div');
        main.className = 'vela-ws-main';
        main.dataset.velaPaneHost = '';
        main.id = this.mainId;
        main.setAttribute('role', 'main');
        main.setAttribute('aria-label', 'Chart workspace');
        // Focusable as a TARGET only (the skip link lands here); never rebuilt, so the id
        // stays valid for the life of the workspace.
        main.tabIndex = -1;
        // The `drawings` option drives the SHARED drawing surface the way it drives a
        // lone chart's own bar: `false` removes the whole feature (the headless
        // `chart.drawings` API stays), `{ toolbar: false }` hides the bar,
        // `{ tools | groups }` picks its content. `drawingToolbar: false` stays the
        // workspace-level bar opt-out.
        const toolbar = buildToolbar(opts.drawings);
        this.drawingsEnabled = opts.drawings !== false;
        this.toolbarDef = toolbar.definition;
        let toolbarHost: HTMLElement | null = null;
        if (this.drawingsEnabled && toolbar.visible && opts.drawingToolbar !== false) {
            toolbarHost = doc.createElement('div');
            toolbarHost.className = 'vela-ws-toolbar';
            main.appendChild(toolbarHost);
            this.anchorChrome(toolbarHost);
        }
        this.gridEl = doc.createElement('div');
        this.gridEl.className = 'vela-ws-grid';
        main.appendChild(this.gridEl);
        // One dock for the WHOLE grid (the panels follow the active cell), owning the built-ins,
        // contributions, one side column, desktop cards and the topbar's toggle group.
        this.dock = new PanelDock(main, {
            chrome: {
                setPanelButtons: (buttons, click) => this.topbar.setPanelButtons(buttons, click),
                setPanelActive: (id, open) => {
                    this.topbar.setPanelActive(id, open);
                    if (id === 'layoutSetup') {
                        this.topbar.setLayoutSetupOpen(open, this.layoutSetup?.el.id);
                        this.setSyncSurfaceOpen(open);
                    }
                    if (id === 'alerts') {
                        this.topbar.setAlertsActive(open);
                        this.mobileBar?.setAlertsActive(open);
                    }
                    if (id === 'symbolSearch') this.topbar.setToolPanelOpen('symbol', open, this.symbolPanel?.el.id);
                    if (id === 'indicators') this.topbar.setToolPanelOpen('indicators', open, this.indicatorPanel?.el.id);
                    if (id === 'indicatorTemplates') {
                        this.topbar.setToolPanelOpen('templates', open, this.templatesPanel?.el.id);
                        this.indicatorPicker?.setTemplatesPanelOpen(open);
                    }
                    if (id === 'compare') this.topbar.setToolPanelOpen('compare', open, this.comparePanel?.el.id);
                    if (id === 'more') {
                        this.mobileBar?.setExpanded('more', open);
                        // A restored More pane can open before its lazy content is built.
                        // Wait until construction/active-chart setup has finished.
                        if (open && !this.moreDrawer) queueMicrotask(() => {
                            if (this.root.isConnected && this.morePanel.open && !this.moreDrawer) this.ensureMoreDrawer();
                        });
                    }
                },
            },
            context: () => this.context(),
            changed: () => this.markStateDirty(),
        });
        // One panel instance per tool, shared by its existing desktop and phone doors.
        // These are non-modal: the chart and other floating panels remain interactive.
        this.symbolPanel = new WorkspaceToolPanel(main, 'Symbol Search', 'vela-symbol-panel', 380);
        this.symbolPicker.attachPanel(this.symbolPanel);
        this.indicatorPanel = picker ? new WorkspaceToolPanel(main, 'Indicators', 'vela-indicator-panel', 360) : null;
        if (this.indicatorPanel) picker?.attachPanel(this.indicatorPanel);
        this.templatesPanel = new WorkspaceToolPanel(main, 'Indicator templates', 'vela-templates-panel', 360);
        this.topbar.attachTemplatesPanel(this.templatesPanel);
        picker?.useSeparateTemplates(this.templatesPanel);
        this.comparePanel = new WorkspaceToolPanel(main, 'Compare', 'vela-compare-panel', 360);
        this.morePanel = new WorkspaceToolPanel(main, 'More', 'vela-more-panel', 360);
        this.compareSheet = new CompareSheet({
            host: this.root,
            getSymbol: () => this.compareSymbolOf(this.activeCell()),
            getDisplay: () => this.compareDisplayOf(this.activeCell()),
            onPickSymbol: () => this.beginCompareSearch(),
            onDisplay: (mode) => this.setCompareDisplay(mode),
            onRemove: () => this.removeCompare(),
        });
        this.compareSheet.attachPanel(this.comparePanel);
        this.topbar.setToolPanelOpen('symbol', false, this.symbolPanel.el.id);
        if (this.indicatorPanel) this.topbar.setToolPanelOpen('indicators', false, this.indicatorPanel.el.id);
        this.topbar.setToolPanelOpen('templates', false, this.templatesPanel.el.id);
        this.topbar.setToolPanelOpen('compare', false, this.comparePanel.el.id);

        this.objectTree = new ObjectTree(main, (sym) => this.feed.symbolIcon(sym), {
            // The tree's "Source code" entry — the legend chip's twin, and on a phone the
            // route to a study's code (a built-in opens read-only, a script editable).
            onSource: (source, title, readOnly) => this.openEditor(source, title, { readOnly }),
            drawingSets: {
                list: () => this.drawingSetTemplateList(),
                save: (name, ids) => this.saveDrawingSetTemplate(name, ids),
                insert: (name) => this.insertDrawingSetTemplate(name),
                remove: (name) => { this.deleteDrawingSetTemplate(name); },
            },
            indicatorTemplates: {
                list: () => this.templateList(),
                save: (name, ids, append) => this.saveSelectedIndicatorTemplate(name, ids, append),
            },
            indicatorSync: {
                charts: () => this.cells().map((cell, index) => ({
                    id: cell.id, label: `Chart ${index + 1} · ${cell.symbol}`, symbol: cell.symbol, active: cell.id === this.activeId,
                })),
                status: (id) => this.indicatorSyncStatus(id),
                set: (ids, mode, charts) => this.setIndicatorLiveSync(ids, mode, charts),
            },
            drawingSync: {
                rows: () => this.drawingSyncRows(),
                charts: () => this.drawingSyncCharts(),
                mode: (id) => this.drawingSyncMode(id),
                setMode: (ids, mode, charts) => this.setDrawingSyncMode(ids, mode, charts),
                defaultMode: () => this.drawingSyncDefault,
                setDefaultMode: (mode) => this.setDrawingSyncDefault(mode),
                apply: (ids) => this.applyDrawingSync(ids),
            },
            // Candle / indicator z keys live in the renderer's config. `renderer.set()`
            // doesn't fire a chart event, so the tree explicitly dirties the document
            // after every visual-order edit (menu or drag) to make autosave pick it up.
            onStackChanged: () => this.markStateDirty(),
            onGroupsChanged: () => this.markStateDirty(),
            historyTransaction: (mutate) => {
                const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
                if (cell) cell.history.silently(mutate);
                else mutate();
            },
        });
        this.dataWindow = new DataWindow(main);
        this.layoutSetup = this.monoLayout ? null : new LayoutSetupPanel(main, {
            shape: () => layoutShape(this.def),
            presets: () => this.presetRows(),
            glyph: () => layoutGlyph(this.def),
            onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
            onSelectPreset: (id) => this.setLayout(id),
            syncs: () => this.syncRows(),
            onToggleSync: (id) => this.toggleSync(id as SyncKind),
            charts: () => this.syncCharts(),
            onSelectChart: (id) => { if (this.cellsById.has(id)) this.setActiveCell(id); },
            onCycleCellGroup: (kind, id) => this.cycleGroupFor(kind as SyncKind, id),
            onSetCellGroup: (kind, id, mark) => this.setGroupFor(kind as SyncKind, id, mark),
            onAllInOneGroup: (kind) => this.syncAllInOneGroup(kind as SyncKind),
            legend: () => this.groupLegend(),
            groupName: (id) => this.groupNames[id],
            onRenameGroup: (id, name) => this.setGroupName(id, name),
            onSetGroupMark: (id, mark) => this.setGroupMark(id, mark),
            drawingsScope: () => this.drawingsScope,
            onToggleDrawingsScope: () => this.setDrawingsScope(this.drawingsScope === 'global' ? 'layout' : 'global'),
            onApplySettingsToAll: () => this.applySettingsToAll(),
            onApplyIndicatorsToAll: () => this.applyIndicatorsToAll(),
            hiddenCharts: () => this.hiddenChartCount,
            onClearPooled: () => { this.clearPooled(); },
            clearedCharts: () => this.clearedChartCount,
            onRestorePooled: () => { this.restorePooled(); },
            linkGroup: () => this.linkGroup,
            onLinkGroup: (tag) => this.setLinkGroup(tag),
            onOpenManager: (anchor) => this.openLayoutManager(anchor),
            onShareLink: () => this.copyShareLink(),
        });
        this.strategyTester = new StrategyTester(main);
        this.alertPanel = new AlertPanel(main, {
            target: () => this.alertTarget(),
            drawingLevel: (target, id) => {
                const cell = this.cellsById.get(target.cellId);
                return cell ? this.levelOfDrawing(cell, id, this.alertBarTime(cell)) : null;
            },
            onCreate: (request, target) => this.createAlertForTarget(request, target),
            getAlerts: () => this.alerts,
            getCharts: () => this.syncCharts(),
            getArmed: () => this.armedAlertRows(),
            onBeginEdit: (id) => this.beginPriceAlertEdit(id),
            onSaveEdit: (id, request, target) => this.savePriceAlertEdit(id, request, target),
            onToggleAlert: (id) => this.togglePriceAlert(id),
            onGo: (id) => { if (this.cellsById.has(id)) this.setActiveCell(id); },
            onClearChart: (id) => {
                this.alerts = this.alerts.filter((entry) => entry.cellId !== id);
                this.syncAlertCount();
            },
            onClearAll: () => { this.alerts = []; this.syncAlertCount(); },
        });
        this.dock.addBuiltIn({ id: 'symbolSearch', title: 'Symbol Search', icon: 'search', order: 1, panel: this.symbolPanel, showInChrome: false });
        if (this.indicatorPanel) this.dock.addBuiltIn({ id: 'indicators', title: 'Indicators', icon: 'indicators', order: 2, panel: this.indicatorPanel, showInChrome: false });
        this.dock.addBuiltIn({ id: 'indicatorTemplates', title: 'Indicator templates', icon: 'templates', order: 3, panel: this.templatesPanel, showInChrome: false });
        this.dock.addBuiltIn({ id: 'compare', title: 'Compare', icon: 'bands', order: 4, panel: this.comparePanel, showInChrome: false });
        this.dock.addBuiltIn({ id: 'more', title: 'More', icon: 'more', order: 5, panel: this.morePanel, showInChrome: false });
        if (this.layoutSetup) this.dock.addBuiltIn({ id: 'layoutSetup', title: 'Layout setup', icon: 'layout', order: 8, panel: this.layoutSetup, showInChrome: false });
        this.dock.addBuiltIn({ id: 'dataWindow', title: 'Data window', icon: 'datawindow', order: 10, panel: this.dataWindow, onChart: (c) => this.dataWindow.onChart(c) });
        this.dock.addBuiltIn({ id: 'objects', title: 'Object tree', icon: 'objects', order: 20, panel: this.objectTree, onChart: (c) => this.objectTree.onChart(c) });
        this.dock.addBuiltIn({ id: 'strategyTester', title: 'Strategy tester', icon: 'tester', order: 30, panel: this.strategyTester, onChart: (c) => this.strategyTester.onChart(c) });
        // The dedicated bell is already the pane's button: do not publish a duplicate
        // under the separate 'panels' composition slot or the phone's More panel list.
        this.dock.addBuiltIn({ id: 'alerts', title: 'Alerts', icon: 'bell', order: 40, panel: this.alertPanel, showInChrome: false });
        // The script editor, in the SIDE PANEL rather than on its own page — the shape
        // TradingView settled on. Offered only when a scripting engine is configured:
        // an editor with nothing to run is a dead end, and the shell stays engine-free.
        const hasEngine = Object.keys(resolveEngines(this.opts.engines)).length > 0;
        this.pineEditor = this.opts.editor === false || !hasEngine ? null : new PineEditor(main);
        if (this.pineEditor) {
            this.dock.addBuiltIn({
                id: 'pineEditor',
                title: 'Pine editor',
                icon: 'code',
                order: 5, // first in the group: it is the working surface, not a report
                panel: this.pineEditor,
                onChart: (c) => this.pineEditor?.onChart(c),
            });
            // Multi-chart only: the editor's "Apply to entire layout" (TV's own row). The
            // replication helper already carries a script's inputs and props across.
            if (this.def.cells.length > 1) {
                this.pineEditor.onApplyToLayout = () => {
                    const id = this.pineEditor?.liveHandleId;
                    const from = this.activeId;
                    if (!id || !from) return 0;
                    const others = [...this.cellsById.keys()].filter((cellId) => cellId !== from);
                    return this.replicateIndicator(from, id, others);
                };
            }
            // A row that HAS source (a script indicator) gets a "Source code" chip; a
            // native indicator has no text to show, so the action never appears there.
            this.editorLegendOff = registerLegendAction({
                id: 'pine.source',
                icon: 'braces',
                tooltip: 'Source code',
                order: -10,
                when: (ind) => ind.source !== undefined,
                // A NATIVE study's source is the built-in's own script: TradingView opens it
                // read-only and offers a working copy. A script indicator opens editable.
                run: (_ctx, ind) => this.openEditor(ind.source, ind.title, { readOnly: ind.nativeType !== undefined }),
            });
        } else {
            this.editorLegendOff = null;
        }
        this.dock.refresh();
        // The dock's own slice of the boot document (open panel, dragged widths, pinned
        // placements) — the sync-storage twin of what `applyState` does for a late document.
        // Panels that are not registered yet keep their entry until they dock.
        if (boot?.panels) this.dock.applyState(boot.panels);
        this.root.appendChild(main);
        // Docked strips (`ctx.dockStrip`) — before the bottom bar, which appends itself next.
        this.stripsEl = doc.createElement('div');
        this.stripsEl.className = 'vela-ws-strips';
        this.root.appendChild(this.stripsEl);
        this.toastHost = new Toast(this.gridEl);
        // The bar itself is mounted by a session (see syncReplayUi), but the FOLLOWING has
        // to be live from the start — the first `replay:start` is what mounts the bar.
        this.watchReplay();

        // ONE attribution mark for the whole grid (bottom-left, floating above the
        // bottom-left cell's time axis) — the cells disable their per-chart marks, and
        // this single mark is the NOTICE-required equivalent visible attribution. It
        // follows the app-wide default a plugin may have set for the attribution corner
        // (`registerRendererDefaults({ attribution })`): the cells read it through their
        // renderer, and the grid reads it here, so one setting covers every surface
        // instead of leaving this mark behind as the one a host cannot reach. It LIVES
        // inside the bottom-left cell (mountAttributionMark): the offsets ride that
        // cell's renderer-published gutters, so the mark climbs above collapsed pane
        // strips exactly like a lone chart's own mark instead of sitting on a strip's
        // legend row.
        const attribution = rendererDefaults().attribution;
        if (attribution !== false) {
            const background = resolveTheme(opts.theme).background;
            const mark =
                typeof attribution === 'string' && attribution.trim()
                    ? createCustomMark(doc, attribution, background)
                    : createAttributionMark(doc, background);
            Object.assign(mark.style, {
                left: 'calc(var(--vela-toolbar-gutter, 0px) + 12px)',
                bottom: `calc(var(--vela-bottom-gutter, ${TIME_AXIS_H}px) + 10px)`,
                zIndex: '11',
            });
            mark.dataset.velaScreenshot = '1';
            this.gridEl.appendChild(mark); // pre-cells fallback host; re-parented by mountAttributionMark
            this.attributionMark = mark; // kept so a live theme swap re-inks it
        }

        // ONE drawing toolbar for the whole grid: commands go to the ACTIVE cell's
        // `chart.drawings` facade; the cell's own in-chart bar stays hidden (the cells
        // are built with `drawings: { toolbar: false }`). Focus returns to the active
        // chart after every press so drawing/chart shortcuts keep working.
        this.drawToolbar = toolbarHost
            ? new DrawingToolbar(
                  toolbarHost,
                  resolveTheme(opts.theme),
                  (type) => {
                      this.active.chart.drawings.setTool(type);
                      this.refocusActive();
                  },
                  (mode) => {
                      this.active.chart.drawings.setSnapMode(mode);
                      this.refocusActive();
                  },
                  () => {
                      const d = this.active.chart.drawings;
                      d.setMode(d.getMode() === 'measure' ? null : 'measure');
                      this.refocusActive();
                  },
                  () => {
                      const d = this.active.chart.drawings;
                      d.setMode(d.getMode() === 'eraser' ? null : 'eraser');
                      this.refocusActive();
                  },
                  // No refocus on a star: the flyout stays open for more browsing.
                  (type, on) => this.active.chart.drawings.setFavorite(type, on),
                  (on) => {
                      this.active.chart.drawings.setStayMode(on);
                      this.refocusActive();
                  },
                  {
                      dock: 'static',
                      // Drawings sync is a WORKSPACE link (same model as the layout
                      // dropdown's switches) — the bar only hosts its toggle.
                      onDrawingsSync: (on) => {
                          this.sync.set('drawings', on);
                          this.refocusActive();
                      },
                      // The pointer stop: the bar's cursor cell grows a chevron and the
                      // seven-row menu, and its icon wears the chosen style.
                      cursorStyle: () => this.cursorStyle,
                      onCursorStyle: (style) => {
                          this.setCursorStyle(style);
                          this.refocusActive();
                      },
                      // Lock / Hide / Remove (the reference's chart-management trio). The
                      // state is read from the ACTIVE cell, the same way every other
                      // drawing command on this bar is routed.
                      onZoom: () => {
                          const d = this.active.chart.drawings;
                          d.setMode(d.getMode() === 'zoom' ? null : 'zoom');
                          this.refocusActive();
                      },
                      // The magnet's second axis lives on the ACTIVE cell, like every
                      // other command on this bar.
                      snapToIndicators: () => this.active.chart.drawings.getSnapToIndicators(),
                      onSnapToIndicators: (on) => {
                          this.active.chart.drawings.setSnapToIndicators(on);
                          this.refocusActive();
                      },
                      drawingsState: () => this.drawingToolbarState(),
                      onLockAll: (lock) => {
                          const d = this.active.chart.drawings;
                          const docs = d.all();
                          if (docs.length === 0) return;
                          d.updateMany(docs.map((doc) => ({ id: doc.id, patch: { locked: lock } })));
                          this.drawToolbar?.refreshChartTools();
                          this.markStateDirty();
                          this.refocusActive();
                      },
                      onHideAll: (hidden) => {
                          this.active.chart.drawings.setHiddenAll(hidden);
                          this.drawToolbar?.refreshChartTools();
                          this.refocusActive();
                      },
                      onRemoveAll: () => {
                          const d = this.active.chart.drawings;
                          const ids = d.all().map((doc) => doc.id);
                          if (ids.length === 0) return;
                          d.removeMany(ids);
                          this.drawToolbar?.refreshChartTools();
                          this.markStateDirty();
                          this.refocusActive();
                      },
                  },
              )
            : null;
        this.drawToolbar?.setDefinition(this.toolbarDef);
        this.drawToolbar?.setVisible(true);
        // Sync settings applied before the bar existed (boot/persisted) — reflect now.
        this.drawToolbar?.setDrawingsSyncMode(!!this.syncOpts.drawings);

        this.bottombar =
            opts.bottombar !== false
                ? new Bottombar(this.root, {
                      timezone: this.timezone,
                      clock: this.clock,
                      onRange: (preset) => {
                          this.active.applyRange(preset);
                          this.bottombar?.setActiveRange(preset.id);
                      },
                      onTimezone: (zone) => this.setTimezone(zone),
                      // RTH/ETH acts on the ACTIVE cell (like the range chips): sessions
                      // are a per-chart market dimension, not a shell preference.
                      onSession: (session) => this.active.setSession(session),
                      onSettingsClick: () => this.active.chart.renderer.openSettings(),
                  })
                : null;
        if (this.bottombar) this.anchorChrome(this.bottombar.el);

        this.mobileBar = null;


        hostEl.appendChild(this.root);

        // Measured AFTER the root is in the DOM so the first evaluation sees a real width.
        this.layoutCtl = new LayoutModeController(this.root, opts.layoutMode ?? 'auto');
        // The phone's own chrome (its bottom bar + the drawing dock that sits above it) is
        // built when the layout is actually mobile — a desktop workspace used to carry 86
        // hidden nodes for a bar it can never show. A flip to mobile builds it then.
        const buildMobileChrome = (): void => {
            if (this.mobileBar) return;
            // The mobile bar is the bottom bar of the mobile size class — the same chrome
            // toggle governs both; CSS (data-layout) decides which one is visible. Every
            // route acts on the ACTIVE cell, exactly like the topbar it replaces.
            if (opts.bottombar === false) return;
            this.mobileBar = new MobileBar(this.root, {
                          symbol: '',
                          timeframe: '60',
                          onSymbolClick: () => this.openSymbolSearch(),
                          onSymbolStep: (delta) => this.stepQuickSymbol(delta),
                          onTimeframeClick: () => this.openTimeframeDrawer(),
                          ...(topbarHas(this.topbarComp, 'alerts') ? { onAlertsClick: () => this.dock.toggle('alerts') } : {}),
                          // Same visibility truth as the desktop bar: composition-hidden
                          // indicators lose their mobile stop too; an override takes it over.
                          ...(topbarHas(this.topbarComp, 'indicators') && (picker || this.indicatorsOverride)
                              ? { onIndicatorsClick: this.indicatorsOverride ? () => this.runOverride(this.indicatorsOverride!) : () => picker!.open() }
                              : {}),
                          getContext: () => this.context(),
                          // The editor's phone door — the same panel, dragged up from the
                          // bottom as a sheet (see the panel's mobile rules).
                          ...(this.pineEditor ? { onEditorClick: () => this.openEditor() } : {}),
                          ...(this.drawingsEnabled ? { onDrawingsClick: () => this.openDrawingsDrawer() } : {}),
                          // Multi-chart only: the stop that isolates the ACTIVE chart (the
                          // per-cell hover cluster has no cursor to reveal it on mobile).
                          ...(this.monoLayout ? {} : { onMaximizeClick: () => this.toggleMobileMaximize() }),
                          // The CHART-TYPE stop: glyph = the active cell's price style, tap =
                          // the style sheet. It took the slot the layout count used to hold
                          // (a number you read once vs. a shape you read constantly); layout
                          // moved into the sheet's one quiet row, still one tap away.
                          styleOptions: () => priceStyleIds().map((id) => ({ id, label: priceStyleLabel(id), icon: priceStyleMarkup(id) })),
                          // EAGER: the bar reads this in its constructor, before the first
                          // `setActiveCell` has run — resolve through the map, never `active`.
                          currentStyle: () => this.cellsById.get(this.activeId ?? '')?.priceStyle ?? 'candles',
                          onStyleSelect: (id) => this.active.setPriceStyle(id),
                          // One star set for every surface: the bar's sheet, More, the topbar menu.
                          styleFavorites: () => this.styleFavs,
                          onStyleFavorite: (id, on) => this.setStyleFavorite(id, on),
                          ...(this.monoLayout
                              ? {}
                              : {
                                    layoutLabel: () => `${this.def.cols.length}×${this.def.rows.length}`,
                                    layoutGlyph: () => layoutGlyph(this.def),
                                    onLayoutClick: () => this.openLayoutSetup(),
                                }),
                          // Undo / redo on the phone's own bar, right before More —
                          // the workspace's unified history of the ACTIVE chart (the
                          // same two verbs the desktop topbar carries).
                          onUndoClick: () => this.undoHistory(),
                          onRedoClick: () => this.redoHistory(),
                          onMoreClick: () => this.openMoreDrawer(),
                          onSettingsClick: () => this.active.chart.renderer.openSettings(),
                      });
            this.mobileBar.setAlertsActive(this.dock.openId === 'alerts');
            this.mobileBar.setAlertCount(this.alerts.length);
            // One strip for the whole grid — rebound to the active cell on every projection.
            // It docks in the flow ABOVE the bottom bar (never over the plot: the old floating
            // pill covered the last row's time axis). Without a bottom bar it falls back to the
            // grid, where CSS pins it to the bottom edge.
            const drawHost =
                this.mobileBar && this.mobileBar.el.parentElement === this.root
                    ? this.root.insertBefore(doc.createElement('div'), this.mobileBar.el)
                    : this.gridEl;
            drawHost.className = this.mobileBar ? 'vela-ws-drawdock' : drawHost.className;
            this.mobileBar?.setPaneControl('symbol', this.symbolPanel.el.id, this.symbolPanel.open);
            this.mobileBar?.setPaneControl('more', this.morePanel.el.id, this.morePanel.open);
            if (this.indicatorPanel) this.mobileBar?.setPaneControl('indicators', this.indicatorPanel.el.id, this.indicatorPanel.open);
            this.drawingPill = this.drawingsEnabled ? new DrawingPill(drawHost) : null;
        };

        this.layoutCtl.onChange((mode) => {
            this.onLayoutModeChange(mode);
            if (mode === 'mobile') {
                buildMobileChrome();
                this.projectActiveCell(); // the bar it just built reads the ACTIVE cell
            }
        });
        // The dock was constructed before `main` had a layout ancestor. Reconcile its
        // initial mode now as well as on later changes, including synchronous restores.
        this.dock.setLayout(this.layoutCtl.current);
        if (this.layoutCtl.current === 'mobile') buildMobileChrome();
        // Desktop-only chrome lives outside the document on a mobile shell.
        this.applyChromeForLayout(this.layoutCtl.current);

        this.splitters = new SplitterLayer(this.gridEl, {
            tracks: () => this.currentTracks(),
            grid: () => occupancyGrid(this.def),
            apply: (axis, weights) => this.applyTracks(axis, weights),
            reset: (axis) => this.applyTracks(axis, evenTracks(this.currentTracks()[axis].length)),
            gapPx: () => GAP_PX,
        });
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.splitters.layout());
            this.resizeObserver.observe(this.gridEl);
        }

        // ── one keymap at the workspace root, every binding routed to the ACTIVE cell ──
        this.keymap = new KeymapManager();
        this.keymap.attach(this.root);
        this.registerDefaultKeys();
        // Shortcut hints beside the bound tools in the shared toolbar's flyouts.
        this.drawToolbar?.setShortcuts(toolShortcutHints(this.keymap));
        this.root.addEventListener('keydown', this.onRootKeydown);
        this.root.tabIndex = -1; // focusable host so bare keystrokes land here

        this.cellBackend = this.backendFor(this.def);
        this.applyGrid();
        this.buildCells();
        if (boot?.charts) this.restoreObjectTreeGroups(boot.charts);
        this.indicatorLiveSync.restore(boot?.indicatorSyncLinks);
        this.syncCellPresentation();
        this.setActiveCell(bootActive != null && this.cellsById.has(bootActive) ? bootActive : (this.order[0] ?? null));
        // Armed levels come back with the document — after the cells exist (their ids are
        // what the rows name) and after the active cell, so the bell count is right away.
        this.restorePriceAlerts(boot?.priceAlerts);
        // Shortcuts only fire while focus is INSIDE the workspace (the keymap listens
        // on the root) — autofocus makes them work before the first click.
        if (opts.autofocus) this.refocusActive();

        // The shared manifest resolves once; every FRESH cell seeds its enabled entries.
        if (opts.indicators !== undefined) {
            void resolveIndicators(opts.indicators).then((list) => {
                if (this.destroyed) return;
                this.manifest = list;
                this.manifestSettled = true; // from here each cell's live instance set is the truth, empty included
                for (const cell of this.cellsById.values()) cell.setManifest(list, true);
                this.captureInheritedIndicators(true);
                this.indicatorLiveSync.reconcileLayout(this.indicatorSyncInheritedFrom);
                this.indicatorSyncInheritedFrom.clear();
                this.deferredInheritedIndicators.clear();
                this.projectActiveCell();
            });
        } else {
            this.manifestSettled = true; // nothing will ever resolve — settled empty from the start
        }
        this.mountAttachments();
        // A sync-storage boot restores third-party document-level state here — the shell
        // is fully built (cells live, attachments mounted). The async-adapter boot and
        // host `applyState` calls reach the same handlers through applyState.
        this.restoreGlobalExt();
        // Built. From here a dirty mark means the USER changed something, and a teardown
        // is allowed to flush it; everything above was setup (see {@link booted}).
        this.booted = true;
        this.resetHistoryBaseline(); // the first capture is the FIRST user edit, not boot
        this.historySuppressUntil = Date.now() + 100; // async manifest/indicator settle
    }

    // ── access ──────────────────────────────────────────────────
    /** The cell with identity `id` (its declared name, or `c<N>` when undeclared), or
     *  undefined when no live cell holds it. */
    cell(id: string): ChartCell | undefined {
        return this.cellsById.get(id);
    }

    /** Every live cell, in slot order. Enumerated over `order` — the IDENTITY space —
     *  never the layout's positional slot ids, which only coincide with it for a
     *  workspace whose cells are undeclared. Identities past the current layout size are
     *  pooled, not live, so they drop out here. */
    cells(): ChartCell[] {
        return this.order.map((id) => this.cellsById.get(id)).filter((c): c is ChartCell => c != null);
    }

    /** The ACTIVE cell — the one the shared chrome reflects and acts on. */
    get active(): ChartCell {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) throw new Error('VelaWorkspace has no active cell (destroyed?)');
        return cell;
    }

    /** Shortcut for `active.chart` — the same habit as `widget.chart`. LIVE: read it at
     *  the point of use; the durable identity to hold is the cell (or its id). */
    get chart(): Vela {
        return this.active.chart;
    }

    /**
     * PNG data URL of the visible layout: every live cell in its grid slot, or the
     * maximized cell alone. Same pixels the screenshot button downloads. A single
     * visible cell returns that cell's own chart export (the one-chart case).
     */
    screenshot(): string | null {
        const cells = this.shotCells();
        if (cells.length === 0) return null;
        if (cells.length === 1) return cells[0]!.chart.renderer.screenshot();
        return this.compositeLayoutShot(cells);
    }

    /** Download {@link screenshot} as a PNG. A multi-cell layout is named
     *  `vela-layout.png`; one visible cell keeps `${symbol}-${timeframe}.png`. */
    downloadScreenshot(): void {
        const cells = this.shotCells();
        if (cells.length <= 1) {
            (cells[0] ?? this.active).downloadScreenshot();
            return;
        }
        const url = this.compositeLayoutShot(cells);
        if (!url) return;
        triggerPngDownload(this.root.ownerDocument, url, 'vela-layout.png');
    }

    /** Live cells the screenshot should include — maximized siblings are `hidden`. */
    private shotCells(): ChartCell[] {
        return this.cells().filter((c) => c.host.style.visibility !== 'hidden');
    }

    /** Place every cell's raster onto one canvas the size of the grid. */
    private compositeLayoutShot(cells: ChartCell[]): string | null {
        const gridEl = this.gridEl;
        const grid = gridEl.getBoundingClientRect();
        const win = gridEl.ownerDocument.defaultView;
        const dpr = win?.devicePixelRatio ?? 1;
        const gapColor = win ? win.getComputedStyle(gridEl).backgroundColor : '';
        const tiles: LayoutShotTile[] = [];
        for (const cell of cells) {
            const source = cell.screenshotCanvas();
            if (!source) continue;
            const r = cell.host.getBoundingClientRect();
            const place = tilesFromCellRects(grid, [{ left: r.left, top: r.top, width: r.width, height: r.height }])[0];
            if (!place) continue;
            tiles.push({ source, ...place });
        }
        return compositeLayoutScreenshot(gridEl.ownerDocument, {
            width: grid.width,
            height: grid.height,
            dpr,
            gapColor: gapColor || '#000000',
        }, tiles);
    }

    setActiveCell(id: string | null): void {
        if (id === this.activeId || this.destroyed) return;
        const prev = this.activeId;
        if (prev) {
            const el = this.cellsById.get(prev)?.host;
            if (el) delete el.dataset.active;
        }
        this.activeId = id; // switch FIRST — the departing cell's drawing:* events must not re-enter the mirrors
        const prevCell = prev ? this.cellsById.get(prev) : undefined;
        if (prevCell) {
            // A resting touch must not keep broadcasting stale values when another
            // chart becomes active, particularly across linked crosshair groups.
            prevCell.chart.renderer.endTouchTracking();
            // Only the ACTIVE cell ever holds an armed tool or a transient mode: the
            // global tool re-arms on the next activation; measure/eraser don't follow.
            prevCell.chart.drawings.setTool(null);
            prevCell.chart.drawings.setMode(null);
        }
        if (id) {
            const el = this.cellsById.get(id)?.host;
            if (el) el.dataset.active = '1';
        }
        if (id) {
            this.projectActiveCell(); // trigger ① — the chrome rebinds to the new active cell
            this.events.emit('cell:active', { id, prev });
            this.broadcastLink(); // linked tabs follow the ACTIVE chart's market
            this.markStateDirty();
        }
    }

    on<K extends keyof WorkspaceEventMap>(event: K, handler: (payload: WorkspaceEventMap[K]) => void): () => void {
        return this.events.on(event, handler);
    }

    /** The context handed to contributed actions/attachments (rebuilt per invocation). */
    context(): WorkspaceWidgetContext {
        return buildContext({
            // Null during early construction (the topbar projects actions before cells exist).
            active: () => (this.activeId ? (this.cellsById.get(this.activeId) ?? null) : null),
            cells: () => this.cells(),
            setActiveCell: (id) => this.setActiveCell(id),
            openSymbolSearch: (query) => this.openSymbolSearch(query ?? ''),
            togglePanel: (id, open) => this.dock.toggle(id, open),
            dockStrip: (el) => {
                this.stripsEl.appendChild(el);
                return () => {
                    if (el.parentElement === this.stripsEl) el.remove();
                };
            },
            root: this.root,
            toast: (message, kind) => this.toastHost.show(message, kind),
            stateDirty: () => this.markStateDirty(),
            replay: this.replay,
        });
    }

    /**
     * Open the script editor. With a `source`, that script is loaded into the editor (the
     * legend's "Source code" action, or a host deep-linking a script); without one it opens
     * on whatever the trader last had. Resolves false when the shell has no editor — no
     * scripting engine was configured, so there is nothing to run.
     */
    openEditor(source?: string, title?: string, opts: { readOnly?: boolean } = {}): boolean {
        if (!this.pineEditor) return false;
        if (source !== undefined) this.pineEditor.openSource(source, title, opts);
        this.dock.toggle('pineEditor', true);
        return true;
    }

    /** Whether this shell has the script editor (i.e. an engine was configured). */
    get hasEditor(): boolean {
        return this.pineEditor !== null;
    }

    /** Re-project contributed topbar actions + side panels, and mount late-registered attachments. */
    refreshActions(): void {
        this.mountAttachments();
        this.topbar.renderActions();
        this.mobileBar?.renderActions();
        this.dock.refresh(); // rebuilt panels bind to the active cell's chart on their own
        // Re-project every cell's legend rows so a late registerLegendAction /
        // registerLegendCallout (or a callout's own state change) appears there too.
        for (const cell of this.cells()) {
            cell.chart.renderer.setLegendActions((id) => [
                ...legendActionsProviderFor(cell.chart, () => this.context())(id),
                ...this.layoutLegendActions(id, cell.id),
            ]);
            cell.chart.renderer.setLegendCallouts(legendCalloutsProviderFor(cell.chart, () => this.context()));
        }
    }

    /** The sync-link control surface: `set(kind, true | {cellId: group} | false)`,
     *  `get(kind)`, `state()`. Enabling a market/viewport link aligns the followers to
     *  the ACTIVE cell once, so the grid starts coherent; `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also a toggle in the layout
     *  dropdown). */
    readonly sync = {
        /**
         * `align` (default `true`) also snaps the group to the ACTIVE cell once — the
         * host-facing "the grid starts coherent" behaviour, and what a programmatic
         * enable generally wants. The layout dropdown's switches pass `false`: flipping
         * a link ON there must decide what the cells FOLLOW from the next edit, never
         * silently rewrite the market every other cell shows right now (a user turning
         * on the Symbol switch keeps four different pairs until they change one).
         * Disabling never aligns — there is nothing to align to.
         */
        set: (kind: SyncKind, setting: SyncSetting | false | undefined, align = true): void =>
            this.applySyncSetting(kind, setting === false ? undefined : setting, align),
        get: (kind: SyncKind): SyncSetting | undefined => this.syncOpts[kind],
        state: (): SyncOptions => ({ ...this.syncOpts }),
        /**
         * Put one cell in a named group for one link (or take it out with `null`) — the
         * programmatic half of TradingView's per-chart "Chart Syncing" chips. A `true`
         * (all-cells) setting seeds every cell into group `A` first, so an upgrade never
         * silently unlinks the grid.
         */
        setGroup: (kind: SyncKind, cellId: string, group: string | null): void => {
            if (!this.cellsById.has(cellId)) return;
            this.applySyncSetting(kind, groupSetting(this.syncOpts[kind], cellId, group, [...this.cellsById.keys()]), false);
        },
        /** The distinct group names a link currently uses (empty for off / all-cells). */
        groups: (kind: SyncKind): string[] => syncGroups(this.syncOpts[kind]),
        /** The group one cell belongs to (undefined = unlinked / all-cells form). */
        groupOf: (kind: SyncKind, cellId: string): string | undefined => groupOf(this.syncOpts[kind], cellId),
    };

    // ── state surface (the SDK's read/restore of the whole grid's config + content) ──
    /**
     * Snapshot the COMPLETE workspace state as a versioned, serializable document:
     * layout + splitter sizes, active cell, sync links, timezone, and — per slot, live
     * AND dormant — the market, the renderer's cosmetic config, the user-drawings
     * document, and the indicator ledger. This is what `persist` writes; hosts build
     * custom flows on it (server snapshots, share links, templates).
     */
    getState(): WorkspaceState {
        const byId = new Map<string, PooledCellState>();
        for (const [id, cs] of this.pool) byId.set(id, cs); // dormant slots
        for (const [id, cell] of this.cellsById) {
            const cs = cell.dehydrate();
            // Object Tree folders live in the panel (keyed by chart instance), but they
            // are chart content: history and persistence must round-trip them.
            cs.objectTreeGroups = this.objectTree?.groupsFor(cell.chart) ?? [];
            byId.set(id, cs); // live slots win
        }
        // The charts array is ORDERED — position i of the document is slot i on restore.
        const charts: WorkspaceState['charts'] = [];
        for (const id of this.order) {
            const cs = byId.get(id);
            if (cs) {
                charts.push({ id, ...cs });
                byId.delete(id);
            }
        }
        for (const [id, cs] of byId) charts.push({ id, ...cs }); // pooled strays keep restoring
        // This shell-owned bit accompanies live AND pooled cells. Do not retain an old
        // pooled bit after a compare is removed or its display leaves percent mode.
        for (const chart of charts) {
            if (this.compareAxisSwitched.has(chart.id)) chart.compareAutoPercent = true;
            else delete chart.compareAutoPercent;
        }
        const state: WorkspaceState = { version: 1, layout: this.def.id, timezone: this.timezone, sync: { ...this.syncOpts }, charts };
        if (this.cursorStyle !== 'cross') state.cursor = this.cursorStyle;
        if (this.activeId) state.activeCellId = this.activeId;
        if (this.priceAlerts.length > 0) {
            state.priceAlerts = this.priceAlerts.map((a) => ({
                cellId: a.cellId,
                symbol: a.symbol,
                condition: a.condition,
                value: a.value,
                frequency: a.frequency,
                bars: a.bars,
                state: a.state,
                createdAt: a.createdAt,
                fires: a.fires,
                ...(a.lineId && !a.source ? { lineId: a.lineId, lineOwned: a.lineOwned === true } : {}),
                source: a.source ? { ...a.source } : undefined,
            }));
        }
        if (this.favs.length > 0) state.favorites = [...this.favs];
        if (this.tfFavs.length > 0) state.timeframeFavorites = [...this.tfFavs];
        if (this.styleFavs.length > 0) state.chartTypeFavorites = [...this.styleFavs];
        if (this.indFavs.length > 0) state.indicatorFavorites = [...this.indFavs];
        if (this.templateFavs.length > 0) state.templateFavorites = [...this.templateFavs];
        const tools = this.drawingToolsState();
        if (tools) state.drawingTools = tools;
        if (this.trackSizes.size > 0) state.trackSizes = Object.fromEntries([...this.trackSizes].map(([k, v]) => [k, { ...v }]));
        const panels = this.dock.getState();
        if (panels) state.panels = panels;
        // Document-level third-party state: fresh global-handler snapshots merged OVER
        // the preserved entries (a key with no handler this session rides along; a
        // handler returning `undefined` withdraws its entry). Per-cell `ext` was
        // assembled by each cell's dehydrate above.
        const ext = { ...this.extState };
        for (const h of statePersistenceHandlers('global')) {
            try {
                const value = h.serialize(this.context());
                if (value === undefined) delete ext[h.key];
                else ext[h.key] = value;
            } catch (err) {
                console.warn(`[vela] state persistence "${h.key}" serialize failed:`, err);
            }
        }
        this.extState = ext;
        if (Object.keys(ext).length > 0) state.ext = ext;
        // Symbol-keyed drawings (the global scope) and the named snapshots ride the same
        // document, so a reload / share link brings them back.
        if (Object.keys(this.drawingsBySymbol).length > 0) state.drawingsBySymbol = { ...this.drawingsBySymbol };
        if (this.drawingsScope !== 'layout') state.drawingsScope = this.drawingsScope;
        if (this.savedLayouts.size > 0) state.savedLayouts = Object.fromEntries([...this.savedLayouts].map(([k, v]) => [k, v as unknown]));
        if (this.layoutMeta.size > 0) state.layoutMeta = Object.fromEntries([...this.layoutMeta].map(([k, v]) => [k, { ...v }]));
        if (this.layoutPrefs.autosave || this.layoutPrefs.defaultTemplate || this.layoutPrefs.defaultAppearance || this.layoutPrefs.sharing) {
            state.layoutPrefs = {
                ...(this.layoutPrefs.autosave ? { autosave: true } : {}),
                ...(this.layoutPrefs.defaultTemplate ? { defaultTemplate: this.layoutPrefs.defaultTemplate } : {}),
                ...(this.layoutPrefs.defaultAppearance ? { defaultAppearance: this.layoutPrefs.defaultAppearance } : {}),
                ...(this.layoutPrefs.sharing ? { sharing: true } : {}),
            };
        }
        if (this.appearanceTemplates.size > 0) {
            state.appearanceTemplates = Object.fromEntries(
                [...this.appearanceTemplates].map(([name, config]) => [name, { version: 1 as const, config }]),
            );
        }
        if (this.indicatorDefaults.size > 0) {
            state.indicatorDefaults = Object.fromEntries([...this.indicatorDefaults].map(([type, entry]) => [type, { ...entry }]));
        }
        if (this.templates.size > 0) {
            state.templates = Object.fromEntries(
                [...this.templates].map(([k, v]) => [k, { ...v, indicators: [...v.indicators] }]),
            );
        }
        if (this.drawingSets.size > 0) {
            state.drawingSetTemplates = Object.fromEntries(
                [...this.drawingSets].map(([k, v]) => [k, { ...v, drawings: v.drawings.map((d) => ({ ...d, anchors: d.anchors.map((a) => ({ ...a })) })) }]),
            );
        }
        if (this.drawingSyncModes.size > 0) {
            state.drawingSync = Object.fromEntries(
                [...this.drawingSyncModes].map(([k, v]) => [k, { mode: v.mode, ...(v.charts && v.charts.length > 0 ? { charts: [...v.charts] } : {}) }]),
            );
        }
        const indicatorLinks = this.indicatorLiveSync.snapshot();
        if (indicatorLinks.length > 0) state.indicatorSyncLinks = indicatorLinks;
        if (this.drawingSyncDefault !== 'none') state.drawingSyncDefault = this.drawingSyncDefault;
        if (this.drawingSyncClones.size > 0) {
            state.drawingSyncClones = Object.fromEntries(
                [...this.drawingSyncClones].map(([source, targets]) => [source, Object.fromEntries(targets)]),
            );
        }
        if (this.watchlist.length > 0) state.watchlist = [...this.watchlist];
        if (Object.keys(this.groupNames).length > 0) state.groupNames = { ...this.groupNames };
        if (Object.keys(this.groupMarks).length > 0) state.groupMarks = { ...this.groupMarks };
        if (this.seenTips.size > 0) state.seenTips = [...this.seenTips];
        if (this.recentCommands.length > 0) state.recentCommands = [...this.recentCommands];
        if (this.linkGroup) state.linkedGroup = this.linkGroup;
        return state;
    }

    /**
     * Restore a state document produced by {@link getState} (untrusted-safe: malformed
     * fields are dropped). When the document matches the live grid one-to-one — same
     * layout, same ordered slot identities — it is applied IN PLACE: every chart
     * instance survives (markets switch via `setMarket`), so chart references,
     * indicator handles, and event subscriptions stay valid. Any structural difference
     * (layout, slot count, renamed ids) falls back to the full rebuild: prefs, sync
     * links, layout, and every slot are replaced, current cells rebuilt from the
     * document. A layout id that is not registered keeps the current grid (register
     * custom layouts first).
     */
    /**
     * Copy the document's SIDE-CARS onto the live workspace: the maps and lists that live
     * beside the grid — snapshots, templates, watchlist, group names and glyphs, tips
     * already shown, recent commands, the tab-link tag, the drawings scope and the
     * per-symbol drawing store.
     *
     * ONE function, because it has two callers with the same contract: `applyState`
     * (a document arriving after construction) and the constructor's boot path (a
     * document read from storage before the first cell exists). Before this existed, the
     * boot path silently restored only the grid — and the next save wrote the empty
     * side-cars over the stored ones.
     */
    private hydrateSideCars(st: WorkspaceState): void {
        if (st.savedLayouts) {
            for (const [name, doc] of Object.entries(st.savedLayouts)) {
                const parsed = sanitizeState(doc);
                if (parsed) this.savedLayouts.set(name, parsed);
            }
        }
        if (st.layoutMeta) {
            for (const [name, meta] of Object.entries(st.layoutMeta)) this.layoutMeta.set(name, { ...meta });
        }
        if (st.templates) {
            for (const [name, template] of Object.entries(st.templates)) this.templates.set(name, template);
        }
        if (st.drawingSetTemplates) {
            for (const [name, set] of Object.entries(st.drawingSetTemplates)) this.drawingSets.set(name, set);
        }
        if (st.drawingSync) {
            this.drawingSyncModes.clear();
            for (const [id, entry] of Object.entries(st.drawingSync)) this.drawingSyncModes.set(id, { ...entry, charts: entry.charts ? [...entry.charts] : undefined });
        }
        if (st.drawingSyncDefault) this.drawingSyncDefault = st.drawingSyncDefault;
        if (st.drawingSyncClones) {
            this.drawingSyncClones.clear();
            for (const [source, targets] of Object.entries(st.drawingSyncClones)) this.drawingSyncClones.set(source, new Map(Object.entries(targets)));
        }
        if (st.indicatorDefaults) {
            this.indicatorDefaults.clear();
            for (const [type, entry] of Object.entries(st.indicatorDefaults)) this.indicatorDefaults.set(type, { ...entry });
        }
        if (st.templateFavorites) this.templateFavs = [...new Set(st.templateFavorites)];
        if (st.appearanceTemplates) {
            this.appearanceTemplates.clear();
            for (const [name, tpl] of Object.entries(st.appearanceTemplates)) this.appearanceTemplates.set(name, tpl.config);
        }
        if (st.layoutPrefs) {
            this.layoutPrefs.autosave = st.layoutPrefs.autosave === true;
            this.layoutPrefs.defaultTemplate = st.layoutPrefs.defaultTemplate ?? null;
            this.layoutPrefs.defaultAppearance = st.layoutPrefs.defaultAppearance ?? null;
            this.layoutPrefs.sharing = st.layoutPrefs.sharing === true;
        }
        if (st.watchlist) this.watchlist = [...st.watchlist];
        if (st.groupNames) this.groupNames = { ...st.groupNames };
        if (st.groupMarks) {
            this.groupMarks = { ...st.groupMarks };
            // The palette registry is module-level; every reader (chip, matrix, legend)
            // pulls the display glyph from it, so it is mirrored on the way in.
            setMarkOverrides(this.groupMarks);
        }
        if (st.seenTips) for (const tip of st.seenTips) this.seenTips.add(tip);
        if (st.recentCommands) this.recentCommands = [...st.recentCommands];
        // The scope must round-trip: restored without it, `drawingsBySymbol` would be a
        // dead store (nothing consults it in layout scope).
        if (st.drawingsScope) this.drawingsScope = st.drawingsScope;
        if (st.drawingsBySymbol) this.drawingsBySymbol = { ...st.drawingsBySymbol };
        if (typeof st.linkedGroup === 'string' && st.linkedGroup) this.linkGroup = st.linkedGroup;
        // A document can arrive from an older build, a hand-edited file or a share link:
        // keep only the side-cars that still name a real snapshot.
        for (const name of [...this.layoutMeta.keys()]) {
            if (!this.savedLayouts.has(name)) this.layoutMeta.delete(name);
        }
    }

    /**
     * This workspace as a URL. The whole document rides in the fragment (gzip + base64url,
     * ~1.3 KB for a 4-chart layout), so a link restores the exact layout, markets, group
     * names/marks, saved layouts and templates — no server, no account.
     */
    async shareLink(base?: string): Promise<string> {
        return encodeShareUrl(this.getState(), base);
    }

    /** Copy the share link. Returns the URL either way; null means the clipboard refused
     *  (insecure context / permission) and the caller should show it instead. */
    async copyShareLink(base?: string): Promise<string | null> {
        const url = await this.shareLink(base);
        try {
            await navigator.clipboard.writeText(url);
            return url;
        } catch {
            return null;
        }
    }

    /**
     * Copy a link that carries ONE saved layout (`#l1=…`). Same document, same codec as
     * the workspace permalink — only the prefix differs, so the recipient's import path is
     * the one already trusted. Returns the URL, or null when the clipboard refused (the
     * picker says so on the button rather than pretending it copied).
     */
    async copyLayoutLink(name: string, base?: string): Promise<string | null> {
        const state = this.savedLayouts.get(name);
        if (!state) return null;
        const url = await layoutShareUrl(state, base);
        try {
            await navigator.clipboard.writeText(url);
            return url;
        } catch {
            return null;
        }
    }

    /**
     * Adopt a shared document from a URL fragment (`#s1=…` / `#s0=…`). A hash that is not
     * a share link, or that this build cannot read, returns false and leaves the session
     * exactly as it was — a broken link never blanks the screen.
     */
    async applyShareLink(href?: string): Promise<boolean> {
        const view = this.root.ownerDocument.defaultView;
        const base = view?.location.href ?? 'https://vela.local/';
        const target = new URL(href ?? base, base);
        // A LAYOUT link (`#l1=…`) is the same document under another prefix: it lands in
        // the saved-layouts list and then opens, so the recipient keeps it as a layout
        // instead of silently replacing the workspace they were in.
        if (isLayoutShareHash(target.hash)) {
            const layout = await decodeLayoutShareHash(target.hash);
            if (!layout || this.destroyed) return false;
            return this.adoptSharedLayout(layout);
        }
        const state = await decodeShareHash(target.hash);
        if (!state || this.destroyed) return false;
        this.applyState(state);
        return true;
    }

    /** Inbox a shared LAYOUT under a free name, then open it (a link never overwrites). */
    private adoptSharedLayout(state: WorkspaceState): boolean {
        const def = layoutDefinition(this.def.id);
        const base = def?.label ? `${def.label} (shared)` : 'Shared layout';
        let name = base;
        for (let n = 2; this.savedLayouts.has(name); n += 1) name = `${base} (${n})`;
        this.savedLayouts.set(name, state);
        this.markStateDirty();
        this.toast(`Layout “${name}” added from a link`, 'success');
        this.openLayout(name);
        return true;
    }

    /** Push each chart's Object Tree folders back into the panel after a state restore. */
    private restoreObjectTreeGroups(charts: WorkspaceState['charts']): void {
        for (const { id, objectTreeGroups } of charts) {
            const cell = this.cellsById.get(id);
            if (cell) this.objectTree?.setGroupsFor(cell.chart, objectTreeGroups ?? []);
        }
        this.objectTree?.refresh();
    }

    applyState(state: unknown): void {
        if (this.destroyed) return;
        const st = sanitizeState(state);
        if (!st) return;
        // Old links/provenance must not act on unrelated rehydrated instances.
        this.indicatorLiveSync.clear();
        this.indicatorOrigins.clear();
        this.indicatorSyncInheritedFrom.clear();
        this.deferredInheritedIndicators.clear();
        this.compareSymbols.clear();
        this.compareDisplays.clear();
        this.compareAxisSwitched.clear();
        for (const chart of st.charts) if (chart.compareAutoPercent) this.compareAxisSwitched.add(chart.id);
        this.hydrateSideCars(st);
        if (typeof st.linkedGroup === 'string') this.link.setTag(this.linkGroup);
        if (st.favorites) this.favs = [...st.favorites]; // newborn cells inherit below (buildCells)
        if (st.drawingTools) this.adoptDrawingTools(st.drawingTools); // ditto; the active cell takes the magnet/stay mirrors
        if (st.timeframeFavorites) {
            this.tfFavs = [...st.timeframeFavorites];
            this.topbar.setTimeframeFavorites(this.tfFavs);
            this.tfDrawer?.refreshFavorites();
        }
        if (st.chartTypeFavorites) {
            this.styleFavs = [...st.chartTypeFavorites];
            this.mobileBar?.setStyleFavorites(this.styleFavs);
            this.topbar.setStyleFavorites(this.styleFavs);
        }
        if (st.indicatorFavorites) {
            this.indFavs = [...st.indicatorFavorites];
            this.indicatorPicker?.sync();
        }
        if (st.templateFavorites) this.templateFavs = [...new Set(st.templateFavorites)];
        // Absent in documents written before the dock existed — those leave the column closed.
        this.dock.applyState(st.panels);
        for (const kind of SYNC_KINDS) this.applySyncSetting(kind, st.sync?.[kind]);
        this.trackSizes.clear();
        if (st.trackSizes) for (const [id, ts] of Object.entries(st.trackSizes)) this.trackSizes.set(id, ts);

        // ── IN PLACE: same layout, and the document's leading charts map one-to-one
        // onto the live slots. Live cells rehydrate (chart survives); the document's
        // extra charts refresh the dormant pool. No cell:* / layout:changed events —
        // structurally, nothing happened.
        const targetDef = this.monoLayout ? this.def : (ensureLayout(st.layout) ?? this.def);
        const liveCount = this.def.cells.length;
        const inPlace =
            targetDef.id === this.def.id
            && st.charts.length >= liveCount
            && this.order.length >= liveCount
            && this.def.cells.every((_, i) => st.charts[i]!.id === this.order[i] && this.cellsById.has(this.order[i]!));
        if (inPlace) {
            if (st.favorites) {
                for (const cell of this.cellsById.values()) cell.chart.drawings.setFavorites(this.favs as never[]);
            }
            if (st.drawingTools) this.pushToolDefaults(null);
            this.drawingLinks.clear(); // restored drawings carry new ids — old links are stale
            // Restored slots differ legitimately — with the style link on, an unguarded
            // rehydrate would smear each cell's restored config over its peers.
            this.styleSyncBusy = true;
            try {
                for (const [i] of this.def.cells.entries()) {
                    const { id, ...cs } = st.charts[i]!;
                    this.cellsById.get(id)?.rehydrate(cs);
                }
            } finally {
                this.styleSyncBusy = false;
            }
            // The native study may mount after pane-state restoration; make its stored
            // display land on the renderer instead of merely painting the right button.
            for (const cell of this.cellsById.values()) this.restoreComparePlacement(cell);
            this.restoreObjectTreeGroups(st.charts);
            this.indicatorLiveSync.restore(st.indicatorSyncLinks);
            // AFTER the cells: each restored rendererConfig carries its own zone and the
            // cell mirror adopts it — the document's shell-level field must have the
            // last word when the two disagree (a host editing just `timezone`).
            if (st.timezone) this.setTimezone(st.timezone);
            if (st.cursor) this.setCursorStyle(st.cursor);
            this.pool.clear();
            for (const { id, ...cs } of st.charts.slice(liveCount)) this.pool.set(id, cs);
            this.order = st.charts.map((c) => c.id);
            this.clearMaximized(); // documents describe the full grid — restore before re-applying
            this.applyGrid(); // re-assert the restored track sizes on the unchanged grid
            this.refreshCellControls();
            const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : (this.order[0] ?? null);
            if (nextActive === this.activeId) this.projectActiveCell();
            else this.setActiveCell(nextActive);
            this.refreshRetention();
            this.restorePriceAlerts(st.priceAlerts, new Set(st.charts.filter((chart) => chart.drawings != null).map((chart) => chart.id))); // cells rehydrated in place
            // Document-level third-party state converges to the document (absent = none);
            // per-cell `ext` was handled by each cell's rehydrate above.
            this.extState = { ...(st.ext ?? {}) };
            this.restoreGlobalExt();
            this.markStateDirty();
            return;
        }

        if (st.timezone) {
            this.timezone = st.timezone;
            this.bottombar?.setTimezone(st.timezone);
        }
        if (st.cursor) this.cursorStyle = normalizeCursorStyle(st.cursor);
        // Full rebuild from the document — every current slot is replaced by the restored one.
        for (const [id, cell] of [...this.cellsById]) {
            cell.destroy();
            this.cellsById.delete(id);
            this.events.emit('cell:destroyed', { id });
        }
        this.pool.clear();
        this.drawingLinks.clear(); // restored drawings carry new ids — old links are stale
        for (const { id, ...cs } of st.charts) this.pool.set(id, cs);
        this.order = st.charts.map((c) => c.id); // the document's arrangement IS the order
        const def = this.monoLayout ? null : ensureLayout(st.layout); // mono: grid stays pinned to '1'
        if (def) this.def = def;
        this.cellBackend = this.backendFor(this.def);
        this.clearMaximized(); // ditto — the rebuilt grid starts unmaximized
        this.applyGrid();
        this.buildCells();
        this.restoreObjectTreeGroups(st.charts);
        this.indicatorLiveSync.restore(st.indicatorSyncLinks);
        this.syncCellPresentation();
        this.topbar.setLayout(this.def.id);
        const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : (this.order[0] ?? null);
        if (nextActive === this.activeId) this.projectActiveCell();
        else this.setActiveCell(nextActive);
        this.refreshRetention();
        this.restorePriceAlerts(st.priceAlerts, new Set(st.charts.map((chart) => chart.id))); // rebuilt charts have no old drawings
        this.events.emit('layout:changed', { layout: this.def.id });
        // Same convergence as the in-place branch; the rebuilt cells already ran their
        // own cell-scope restores (buildCells → restorePersistedExt).
        this.extState = { ...(st.ext ?? {}) };
        this.restoreGlobalExt();
        this.markStateDirty();
    }

    /** Run the registered global-scope `restore` handlers against the document-level
     *  `ext` bag — keys present in the document only; a failing handler is contained.
     *  Handlers whose restore touches chart content should be `scope: 'cell'` instead
     *  (those run inside the cell's history-mute). */
    private restoreGlobalExt(): void {
        for (const h of statePersistenceHandlers('global')) {
            if (!(h.key in this.extState)) continue;
            try {
                h.restore(this.extState[h.key], this.context());
            } catch (err) {
                console.warn(`[vela] state persistence "${h.key}" restore failed:`, err);
            }
        }
    }

    /**
     * Set the workspace-global display timezone — applied to EVERY cell. An IANA zone,
     * or `'exchange'` (the exchange rule): each cell then renders in its OWN market's
     * zone (Chicago for a CME future, New York for a US equity, UTC for crypto), and the
     * bottom bar follows the active cell's.
     */
    setTimezone(zone: string): void {
        this.timezone = zone;
        this.moreDrawer?.refreshMainValues();
        this.projectTimezone();
        for (const cell of this.cellsById.values()) cell.applyTimezone();
        this.markStateDirty();
    }

    /** The pointer style every chart shows (the More sheet's Cursors stop). */
    getCursorStyle(): CursorStyle {
        return this.cursorStyle;
    }

    /**
     * Set the pointer on EVERY chart and remember it in the document. The cursor is a
     * view preference — it never enters `getConfig()`, so a saved layout or an exported
     * template carries the chart, not the pointer that was over it.
     */
    setCursorStyle(style: CursorStyle): void {
        const next = normalizeCursorStyle(style);
        if (next === this.cursorStyle) return;
        const wasErasing = this.cursorStyle === 'eraser';
        this.cursorStyle = next;
        this.moreDrawer?.refreshMainValues();
        this.drawToolbar?.setCursorStyle(next);
        for (const cell of this.cellsById.values()) cell.chart.setCursorStyle(next);
        // The eraser cursor IS the eraser: picking it arms the delete mode on the active
        // chart, and leaving it disarms — one choice, not two that can disagree.
        const active = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (next === 'eraser') active?.chart.drawings.setMode('eraser');
        else if (wasErasing) active?.chart.drawings.setMode(null);
        this.markStateDirty();
    }

    /** Bottom bar ⇐ the stored choice + the ACTIVE cell's market zone (labels the exchange row). */
    private projectTimezone(): void {
        const active = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        // Per-chart zones: the bar labels what the ACTIVE chart actually renders in, and
        // offers that chart's rule as the "exchange" reading.
        this.bottombar?.setTimezone(active?.displayTimezone ?? this.timezone, active?.exchangeTimezone);
    }

    /**
     * Swap the workspace theme at runtime — `'dark'`, `'light'`, or a full custom theme,
     * applied to the shared chrome (topbar, panels, drawing toolbar) and EVERY cell.
     * Also reached from any cell's chart settings → Canvas → Theme. The choice sticks:
     * cells rebuilt by later layout switches reconstruct with it.
     */
    setTheme(theme: NonNullable<VelaWorkspaceOptions['theme']>): void {
        if (this.destroyed) return;
        const t = resolveTheme(theme);
        this.opts.theme = theme;
        ensureUIHost(this.root, t); // token re-write re-skins all token-driven chrome in place
        this.publishPageBackground(t);
        this.drawToolbar?.setTheme(t);
        if (this.attributionMark) applyAttributionMarkTheme(this.attributionMark, t.background);
        // Each cell's own `setTheme` no-ops once the theme already matches, so the
        // per-cell `theme:changed` echoes (see wireCell) terminate immediately.
        for (const cell of this.cellsById.values()) cell.chart.setTheme(t);
    }

    /**
     * Publish the app background as `--vela-page-bg` on the document root. The workspace
     * paints its own rectangle, but the PAGE behind it (overscroll rubber-banding on
     * macOS/iOS, the margin around a contained chart, a short page) still showed the
     * host's colour — a dark strip under a white light-theme chart.
     */
    private publishPageBackground(t: VelaTheme): void {
        const doc = this.root.ownerDocument;
        const body = doc.body;
        if (!body || !body.contains(this.root)) return;
        // Only a VARIABLE is published — never a background of our own — so a host page
        // opts in with `background: var(--vela-page-bg, <its own>)` and an embedded chart
        // changes nothing that the page didn't ask to change.
        doc.documentElement.style.setProperty('--vela-page-bg', t.background);
    }

    // ── layout ──────────────────────────────────────────────────
    get layout(): LayoutDefinition {
        return this.def;
    }

    /**
     * Switch the grid. Cells are diffed BY IDENTITY (`order` head of the next size):
     * surviving cells keep their live charts untouched; cells past the new size
     * dehydrate into the pool; (re)appearing positions hydrate their identity from
     * the pool (or its seed). Crossing the WebGL budget rebuilds every cell through
     * the pool so the backend stays uniform.
     */
    setLayout(layout: string | LayoutDefinition): void {
        if (this.destroyed) return;
        if (this.monoLayout) return; // single-chart mode — the grid is pinned to '1'
        this.clearMaximized(); // a maximized cell is presentation — a layout switch restores first
        const next = this.resolveLayout(layout);
        const nextBackend = this.backendFor(next);
        const rebuildAll = nextBackend !== this.cellBackend;
        // The ACTIVE chart always survives a shrink — it moves into the last kept
        // slot instead of pooling, so changing the grid never hides the chart the
        // user is working in.
        this.order = orderAfterLayout(this.order, next.cells.length, this.activeId);
        const keep = new Set(this.order.slice(0, next.cells.length));
        // Identities live BEFORE the switch — cells that survive or round-trip through
        // the pool carry their own (already converged) state; only genuinely NEW slots
        // need the style and drawings alignment below.
        const preexisting = new Set(this.cellsById.keys());
        const knownCells = new Set([...this.cellsById.keys(), ...this.pool.keys()]);
        const indicatorLinks = this.indicatorLiveSync.snapshot();
        this.indicatorLiveSync.clear();
        for (const [id, cell] of [...this.cellsById]) {
            if (!keep.has(id) || rebuildAll) {
                const state = cell.dehydrate();
                state.objectTreeGroups = this.objectTree.groupsFor(cell.chart);
                this.poolSet(id, state);
                cell.destroy();
                this.cellsById.delete(id);
                this.indicatorOrigins.delete(id);
                this.indicatorSyncInheritedFrom.delete(id);
                this.deferredInheritedIndicators.delete(id);
                this.events.emit('cell:destroyed', { id });
            }
        }
        this.def = next;
        this.cellBackend = nextBackend;
        this.applyGrid();
        this.buildCells();
        this.indicatorLiveSync.restore(indicatorLinks);
        const donor = this.activeId && this.cellsById.has(this.activeId) ? this.activeId : [...preexisting].find((id) => this.cellsById.has(id));
        if (donor && this.inheritIndicators && !this.defaultTemplateSeed()) {
            for (const id of this.cellsById.keys()) if (!knownCells.has(id) && id !== donor) this.indicatorSyncInheritedFrom.set(id, donor);
        }
        this.captureInheritedIndicators();
        this.indicatorLiveSync.reconcileLayout(this.indicatorSyncInheritedFrom);
        if (this.manifestSettled) this.indicatorSyncInheritedFrom.clear();
        this.alignNewCellMarket(preexisting);
        this.alignNewCellStyles(preexisting);
        this.alignNewCellDrawings(preexisting);
        this.syncCellPresentation();
        this.refreshCellControls(); // the maximize gate follows the cell count
        this.topbar.setLayout(next.id);
        const nextActive = activeAfterLayout(this.activeId, this.order.slice(0, next.cells.length));
        if (nextActive === this.activeId) this.projectActiveCell(); // same slot, maybe a rebuilt cell
        else this.setActiveCell(nextActive);
        this.refreshRetention();
        this.events.emit('layout:changed', { layout: next.id });
        this.markStateDirty();
    }

    /**
     * Is the keystroke Tab *from the chart*? True only when focus sits on a plot canvas,
     * a cell box or the grid container — never on a button, an input, a link or anything
     * inside a UI layer (popover, dialog, menu). That is the difference between "Tab
     * cycles my charts" and "Tab is dead everywhere".
     */
    private tabBelongsToChart(): boolean {
        const a = this.root.ownerDocument.activeElement as HTMLElement | null;
        if (!a) return false;
        if (a.closest('.vela-ui-layer, [role="dialog"], [role="menu"], [role="listbox"]')) return false;
        if (a.matches('input, textarea, select, button, a[href], [contenteditable="true"]')) return false;
        return a.tagName === 'CANVAS' || a === this.gridEl || !!a.closest('.vela-cell');
    }

    /**
     * The next chart in slot order — `Tab`'s reducer. Skips nothing: a maximized grid
     * still cycles (maximize follows the active cell on the next `maximizeCell`, so Tab
     * while maximized simply selects).
     *
     * Focus FOLLOWS the chart. Selection alone is not a tab stop: with focus left behind
     * on the canvas whose turn has passed, the browser's own Tab target and the active
     * cell disagree, and the keystroke stays inside the same element forever.
     */
    private cycleActiveCell(): void {
        const ids = this.order.slice(0, this.def.cells.length);
        if (ids.length < 2) return;
        const at = this.activeId ? ids.indexOf(this.activeId) : -1;
        this.setActiveCell(ids[(at + 1) % ids.length] ?? ids[0]!);
        this.refocusActive();
    }

    /** The LAST chart of the grid in slot order — where Tab stops cycling and lets go. */
    private get lastSlotId(): string | null {
        const ids = this.order.slice(0, this.def.cells.length);
        return ids[ids.length - 1] ?? null;
    }

    /** The identity of the cell maximized over the whole grid, or null. */
    get maximizedCell(): string | null {
        return this.maximizedId;
    }

    /**
     * Maximize one cell over the whole grid, or restore the layout with `null`. Pure
     * presentation: the other cells stay alive underneath — charts, subscriptions and
     * state untouched — so restoring is instant. The maximized cell becomes the active
     * one. Transient view state (also reachable from each cell's bottom-center view
     * cluster): switching layouts or applying a state document restores the grid.
     */
    maximizeCell(id: string | null): void {
        if (this.destroyed) return;
        if (id != null && (!this.cellsById.has(id) || this.def.cells.length <= 1)) return;
        if (id === this.maximizedId) return;
        this.maximizedId = id;
        if (id) this.setActiveCell(id);
        this.applyGrid(); // re-derives the slot geometry, then overlays the maximize presentation
        this.refreshCellControls();
        this.syncMobileMaximize();
        this.events.emit('cell:maximized', { id });
    }

    /** The mobile bar's maximize stop: one press isolates the ACTIVE chart over the
     *  grid; while something is already isolated — the chart, or a pane inside it
     *  (mobile's double-tap) — the press restores that instead. Every branch re-syncs
     *  the stop on its own (`maximizeCell` directly, `panes.maximize` via its
     *  synchronous `pane:changed`). */
    private toggleMobileMaximize(): void {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) return;
        if (this.maximizedId) this.maximizeCell(null);
        else if (cell.chart.panes.list().some((p) => p.maximized)) cell.chart.panes.maximize(null);
        else this.maximizeCell(cell.id);
    }

    /** Keep the mobile bar's maximize stop truthful: lit (inverse chip, restore
     *  glyph) while the active chart covers the grid OR one of its panes is
     *  maximized — the state a double-tap toggles is otherwise invisible on mobile. */
    private syncMobileMaximize(): void {
        if (!this.mobileBar) return;
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        const paneMax = cell ? cell.chart.panes.list().some((p) => p.maximized) : false;
        this.mobileBar.setMaximizeActive(this.maximizedId != null || paneMax);
        // Same gate as the per-cell controls: a one-chart layout has nothing to isolate.
        this.mobileBar.setMaximizeVisible(this.def.cells.length > 1);
    }

    /**
     * Trade the SLOTS of two live cells — the grid arrangement changes, the cells
     * themselves (charts, indicators, drawings, the active flag) stay untouched.
     * What each cell's drag handle commits; also callable directly by hosts.
     */
    swapCells(a: string, b: string): void {
        if (this.destroyed || a === b) return;
        const i = this.order.indexOf(a);
        const j = this.order.indexOf(b);
        if (i < 0 || j < 0 || !this.cellsById.has(a) || !this.cellsById.has(b)) return;
        [this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!];
        // Auto-flow layouts place row-major by CHILD order — re-append the hosts in
        // the new slot order (area layouts re-key their gridArea in applyGrid).
        for (const [k] of this.def.cells.entries()) {
            const host = this.cellsById.get(this.order[k] ?? '')?.host;
            if (host) this.gridEl.appendChild(host);
        }
        this.applyGrid();
        this.paintChartNumbers();
        this.alertPanel.refresh(); // chart labels and Go actions follow the new slot order
        this.markStateDirty();
    }

    resize(): void {
        this.splitters.layout(); // each cell's renderer follows its own ResizeObserver
    }

    /** Show a toast over the grid — the same surface the shell's own notices use
     *  (alerts, script errors) and the one contributions reach via `ctx.toast`. */
    toast(message: string, kind: 'info' | 'success' | 'error' = 'info', durationMs = 3000): void {
        if (this.destroyed) return;
        this.toastHost.show(message, kind, durationMs);
    }

    destroy(): void {
        if (this.destroyed) return;
        if (this.historyTimer != null) clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.workspaceHistoryUnsub();
        this.flushPendingState(); // the user's last edit, before anything is torn down
        this.destroyed = true;
        this.replay.destroy();
        this.link.destroy();
        if (this.persistKey !== null && typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', this.onUnload);
            window.removeEventListener('storage', this.onForeignWrite);
        }
        this.resizeObserver?.disconnect();
        this.splitters.destroy();
        for (const [id, cell] of [...this.cellsById]) {
            // Dehydrate into the pool before tearing the cell down, exactly as a layout
            // rebuild does. Without it `getState()` after `destroy()` rebuilds `charts`
            // from the pool alone and reports the last APPLIED document rather than what
            // was on screen — so a host reading state during its own teardown gets a
            // stale document back and cannot tell that anything changed.
            //
            // Guarded like the attachment disposers below: `dehydrate()` reaches renderer
            // and drawing state, and a snapshot for the host's benefit must never be able
            // to abandon the teardown midway, leaking the remaining cells and their
            // listeners. A cell that cannot be snapshotted keeps whatever the pool holds.
            try {
                this.poolSet(id, cell.dehydrate());
            } catch (err) {
                console.warn(`[vela] could not snapshot cell "${id}" while destroying:`, err);
            }
            cell.destroy();
            this.cellsById.delete(id);
        }
        for (const dispose of this.attachmentDisposers.values()) {
            try {
                dispose();
            } catch {
                /* attachment cleanup must never block destroy */
            }
        }
        this.attachmentDisposers.clear();
        this.root.removeEventListener('keydown', this.onRootKeydown);
        this.keymap.destroy();
        this.drawToolbar?.destroy();
        this.topbar.destroy();
        this.bottombar?.destroy();
        this.mobileBar?.destroy();
        this.drawingPill?.destroy();
        this.tfDrawer?.destroy();
        this.drawingsDrawer?.destroy();
        this.layoutManager?.destroy();
        this.moreDrawer?.destroy();
        this.compareSheet?.destroy();
        this.timezoneDrawer?.destroy();
        this.layoutCtl.destroy();
        this.editorLegendOff?.();
        this.pineEditor?.destroy();
        this.dock.destroy(); // contributed panels; the built-ins are ours to drop
        this.morePanel.destroy();
        this.objectTree.destroy();
        this.dataWindow.destroy();
        this.layoutSetup?.destroy();
        this.strategyTester.destroy();
        this.alertPanel.destroy();
        this.symbolPicker.destroy();
        this.indicatorPicker?.destroy();
        this.tfQuick.destroy();
        this.shortcutsHelp?.destroy();
        this.toastHost.destroy();
        this.disarmReplay();
        this.replayDatePop?.destroy();
        this.replayMenu?.destroy();
        this.replayBar?.destroy();
        this.glider.stop();
        sharedBarStore.retain(new Set(), this); // release OUR declaration only — other shells on the page keep theirs
        this.disableButtonTooltips();
        this.root.remove();
        this.events.clear();
    }

    // ── the projection rule (trigger ① — full rebind on activation) ──
    /** Re-project the shared chrome from the ACTIVE cell. The chrome holds no state of
     *  its own — this is a pure read of the cell, safe to call redundantly. */
    private projectActiveCell(): void {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) return;
        this.topbar.setSymbol(cell.symbol);
        this.topbar.setTimeframe(cell.timeframe);
        this.topbar.setPriceStyle(cell.priceStyle);
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.topbar.renderActions(); // contributed `when()` gates may depend on the active cell
        this.mobileBar?.renderActions();
        this.mobileBar?.setSymbol(cell.symbol);
        this.mobileBar?.setTimeframe(cell.timeframe);
        this.mobileBar?.setPriceStyle(cell.priceStyle);
        this.mobileBar?.setLayoutLabel(`${this.def.cols.length}×${this.def.rows.length}`);
        this.syncMobileHidden(); // the More stop's badge follows the pool
        this.syncMobileMaximize(); // the new active cell may hold a maximized pane
        this.mobileBar?.onChart(cell.chart); // its drawings stop mirrors the ACTIVE cell's tool
        this.drawingPill?.onChart(cell.chart); // the pill mirrors the ACTIVE cell's tool state
        const pushHistory = (): void => this.syncHistoryButtons();
        this.historyUnsub?.();
        this.historyUnsub = cell.history.onChange(pushHistory);
        this.syncHistoryButtons();
        this.objectTree.setSymbol(cell.symbol);
        this.topbar.setCompareSymbol(this.compareLabel());
        this.compareSheet?.refresh();
        this.dock.onChart(cell.chart); // every docked panel follows the active cell
        this.layoutSetup?.refresh();
        this.alertPanel.refresh();
        this.bottombar?.setActiveRange(cell.activeRangeId);
        this.bottombar?.setSession({ session: cell.session, enabled: cell.sessionAvailable });
        this.projectTimezone(); // under the exchange rule the bar's zone is the active cell's
        this.indicatorPicker?.sync(); // the pane may be open while the active cell changes
        this.symbolPicker.sync(); // refresh chart-count-dependent watchlist actions
        this.glider.stop(); // a mid-glide switch must not steer the next cell's viewport
        // Shared drawing toolbar ⇄ the active cell: re-apply the GLOBAL tool + magnet + stay
        // to the cell taking focus, and reflect its (fresh) state on the bar.
        const d = cell.chart.drawings;
        if (d.getTool() !== this.globalTool) d.setTool(this.globalTool);
        if (d.getSnapMode() !== this.globalSnap) d.setSnapMode(this.globalSnap);
        if (d.getStayMode() !== this.globalStay) d.setStayMode(this.globalStay);
        if (this.drawToolbar) {
            this.drawToolbar.setActiveTool(this.globalTool);
            this.drawToolbar.setMagnetMode(this.globalSnap);
            this.drawToolbar.setStayMode(this.globalStay);
            const mode = d.getMode();
            this.drawToolbar.setMeasureActive(mode === 'measure');
            this.drawToolbar.setEraserActive(mode === 'eraser');
            this.drawToolbar.setZoomActive(mode === 'zoom');
            this.drawToolbar.setFavorites(d.favorites());
            this.drawToolbar.refreshChartTools();
        }
    }

    /** The drawing counts the shared bar's Lock / Hide / Remove row paints from. */
    private drawingToolbarState(): { total: number; locked: number; hidden: boolean } {
        // Read the ACTIVE CELL through its id, never `this.active`: the toolbar paints
        // while it is being built (before the first cell takes focus) and `active` throws then.
        const d = (this.activeId ? this.cellsById.get(this.activeId) : undefined)?.chart.drawings;
        if (!d) return { total: 0, locked: 0, hidden: false };
        const docs = d.all();
        return { total: docs.length, locked: docs.filter((doc) => doc.locked).length, hidden: d.isHiddenAll() };
    }

    /** Put keyboard focus back on the active cell's chart surface (after a toolbar press
     *  stole it) so chart/drawing shortcuts keep working. */
    private refocusActive(): void {
        if (this.activeId) this.cellsById.get(this.activeId)?.chart.renderer.focus();
    }

    /** Take a document's drawing-tool prefs as the shared mirrors (cells pick them up as they
     *  are built, or from {@link pushToolDefaults} / the active-cell projection). */
    private adoptDrawingTools(tools: DrawingToolsState): void {
        if (tools.defaults) this.toolDefs = { ...tools.defaults };
        if (tools.templates) this.toolTemplates = { ...tools.templates };
        if (tools.magnet) this.globalSnap = tools.magnet;
        if (tools.stay !== undefined) this.globalStay = tools.stay;
    }

    /** Mirror the shared remembered settings onto every cell but `from` (the cell they came from).
     *  Receiving them is not an edit: the cells' `drawing:defaults` echoes are ignored. */
    private pushToolDefaults(from: ChartCell | null, cells: Iterable<ChartCell> = this.cellsById.values()): void {
        this.toolDefsBusy = true;
        try {
            for (const other of cells) {
                if (other === from) continue;
                other.chart.drawings.setToolDefaults(this.toolDefs);
                other.chart.drawings.setToolTemplates(this.toolTemplates);
            }
        } finally {
            this.toolDefsBusy = false;
        }
    }

    /** The drawing-tool prefs worth saving; null when every one is at its default. */
    private drawingToolsState(): DrawingToolsState | null {
        const out: DrawingToolsState = {};
        if (Object.keys(this.toolDefs).length > 0) out.defaults = { ...this.toolDefs };
        if (Object.keys(this.toolTemplates).length > 0) out.templates = { ...this.toolTemplates } as Record<string, unknown[]>;
        if (this.globalSnap !== 'off') out.magnet = this.globalSnap;
        // Only a DEVIATION is written: sticky drawing is the default, so a document records
        // `stay: false` when its owner opted out.
        if (!this.globalStay) out.stay = false;
        return Object.keys(out).length > 0 ? out : null;
    }

    /** Debounced dirty mark: one `state:changed` (+ one storage write in persist mode)
     *  per burst of edits, flushed hard on unload/destroy. */
    private markStateDirty(): void {
        if (this.destroyed || !this.booted) return;
        if (this.historyRestoreDepth === 0) this.scheduleHistoryCapture();
        this.docRevision += 1;
        this.scheduleAutosave();
        this.scheduleLayoutChip();
        if (this.stateTimer != null) clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => {
            this.stateTimer = null;
            this.events.emit('state:changed', undefined);
            this.persistNow();
        }, 500);
    }

    // ── composite undo/redo ────────────────────────────────────────────────
    // Drawing and indicator CRUD already own precise inverse actions. Everything else
    // (settings, panes, visual order, folders, sync scopes, templates, layout management)
    // is captured as one coalesced workspace snapshot per user action. `markStateDirty`
    // is the common signal for all of them; a short debounce collapses event bursts.

    /** Strip fields that change as a side effect of saving/using the UI, not of an edit. */
    private historySnapshot(): string {
        const state = this.getState();
        delete state.recentCommands;
        delete state.seenTips;
        delete state.layoutMeta; // autosave rewrites savedAt — never make that an undo step
        return JSON.stringify(state);
    }

    private resetHistoryBaseline(): void {
        if (this.destroyed || !this.booted) return;
        this.historyBaseline = this.historySnapshot();
        this.historyBaselineClock = WidgetHistory.clockNow();
    }

    private scheduleHistoryCapture(): void {
        if (this.historyTimer != null) clearTimeout(this.historyTimer);
        this.historyTimer = setTimeout(() => {
            this.historyTimer = null;
            this.captureHistoryStep();
        }, 80);
    }

    /** Flush a pending capture before the user can press undo immediately after an edit. */
    private flushHistoryCapture(): void {
        if (this.historyTimer == null) return;
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.captureHistoryStep();
    }

    private captureHistoryStep(): void {
        if (this.destroyed || !this.booted || this.historyRestoreDepth > 0) return;
        if (Date.now() < this.historySuppressUntil || this.historyBaseline === null) {
            this.resetHistoryBaseline();
            return;
        }
        // A fine-grained history entry landed in the same burst (drawing/indicator CRUD,
        // undo or redo). It already owns that change; don't record a duplicate snapshot.
        if (WidgetHistory.clockNow() !== this.historyBaselineClock) {
            this.resetHistoryBaseline();
            return;
        }
        const after = this.historySnapshot();
        const before = this.historyBaseline;
        if (before === after) return;
        this.workspaceHistory.push({
            undo: () => this.restoreHistorySnapshot(before),
            redo: () => this.restoreHistorySnapshot(after),
        });
        this.historyBaseline = after;
        this.historyBaselineClock = WidgetHistory.clockNow();
    }

    /** Wrap a programmatic restore so its own events never become new history entries. */
    private withHistoryRestore(fn: () => void): void {
        this.historyRestoreDepth += 1;
        try {
            fn();
        } finally {
            this.historyRestoreDepth -= 1;
            this.historySuppressUntil = Math.max(this.historySuppressUntil, Date.now() + 150);
            if (this.historyRestoreDepth === 0) this.resetHistoryBaseline();
        }
    }

    /** Side-cars are additive in `applyState`; a history restore must REPLACE them. */
    private clearHistorySideCars(): void {
        this.savedLayouts.clear();
        this.layoutMeta.clear();
        this.templates.clear();
        this.drawingSets.clear();
        this.drawingSyncModes.clear();
        this.drawingSyncClones.clear();
        this.appearanceTemplates.clear();
        this.indicatorDefaults.clear();
        this.watchlist = [];
        this.groupNames = {};
        this.groupMarks = {};
        this.seenTips.clear();
        this.recentCommands = [];
        this.drawingSyncDefault = 'none';
        this.drawingsScope = 'layout';
        this.drawingsBySymbol = {};
        this.activeSavedLayout = null;
        this.linkGroup = null;
        this.cursorStyle = 'cross';
        this.extState = {};
        this.favs = [];
        this.tfFavs = [];
        this.styleFavs = [];
        this.indFavs = [];
        this.templateFavs = [];
        this.toolDefs = {};
        this.toolTemplates = {};
        this.globalSnap = 'off';
        this.globalStay = true;
        this.layoutPrefs = { autosave: false, defaultTemplate: null, defaultAppearance: null, sharing: false };
        setMarkOverrides({});
    }

    private restoreHistorySnapshot(raw: string): void {
        if (this.destroyed) return;
        this.withHistoryRestore(() => {
            try {
                const snapshot = JSON.parse(raw) as WorkspaceState;
                this.clearHistorySideCars();
                // Public applyState preserves a pre-panel document's current dock. A
                // history snapshot is a complete replacement: no panels means all closed.
                if (!snapshot.panels) this.dock.applyState({});
                this.applyState(snapshot);
            } catch (err) {
                console.warn('[vela] could not restore a history snapshot:', err);
            }
        });
    }

    /** Public composite undo/redo — the same verbs the toolbar, phone bar and keymap use. */
    undo(): void {
        this.undoHistory();
    }

    redo(): void {
        this.redoHistory();
    }

    get canUndo(): boolean {
        return this.historyCanUndo();
    }

    get canRedo(): boolean {
        return this.historyCanRedo();
    }

    private syncHistoryButtons(): void {
        const cell = this.activeId ? this.cellsById.get(this.activeId)?.history : undefined;
        const canUndo = (cell?.canUndo ?? false) || this.workspaceHistory.canUndo;
        const canRedo = (cell?.canRedo ?? false) || this.workspaceHistory.canRedo;
        this.topbar?.setHistoryState(canUndo, canRedo);
        this.mobileBar?.setHistory(canUndo, canRedo);
    }

    private historyCanUndo(): boolean {
        this.flushHistoryCapture();
        return (this.activeId ? this.cellsById.get(this.activeId)?.history.canUndo ?? false : false) || this.workspaceHistory.canUndo;
    }

    private historyCanRedo(): boolean {
        this.flushHistoryCapture();
        return (this.activeId ? this.cellsById.get(this.activeId)?.history.canRedo ?? false : false) || this.workspaceHistory.canRedo;
    }

    private undoHistory(): void {
        this.flushHistoryCapture();
        const cell = this.activeId ? this.cellsById.get(this.activeId)?.history : undefined;
        const global = this.workspaceHistory;
        this.withHistoryRestore(() => {
            if (global.canUndo && (!cell?.canUndo || global.nextUndoSeq > cell.nextUndoSeq)) global.undo();
            else cell?.undo();
        });
        this.syncHistoryButtons();
    }

    private redoHistory(): void {
        this.flushHistoryCapture();
        const cell = this.activeId ? this.cellsById.get(this.activeId)?.history : undefined;
        const global = this.workspaceHistory;
        this.withHistoryRestore(() => {
            if (global.canRedo && (!cell?.canRedo || global.nextRedoSeq > cell.nextRedoSeq)) global.redo();
            else cell?.redo();
        });
        this.syncHistoryButtons();
    }

    /**
     * Keep the top bar's layout NAME honest: the saved name, the unsaved-changes dot, and
     * the autosave state. Cheap to call — the signature guard means the DOM is only
     * touched when one of those four things actually moved, so a rename repaints at once
     * while a drag that dirties the document costs one repaint after it settles.
     */
    private syncLayoutChip(): void {
        if (this.destroyed) return;
        const name = this.activeSavedLayout;
        const dirty = this.isActiveLayoutDirty();
        const sig = `${name ?? ''}|${dirty ? 1 : 0}|${this.autosaveEnabled() ? 1 : 0}|${this.savedLayouts.size}`;
        if (sig === this.layoutChipSig) return;
        this.layoutChipSig = sig;
        this.topbar?.setLayoutState();
    }

    /** A document change is a reason to LOOK at the dot — not to fingerprint every edit. */
    private scheduleLayoutChip(): void {
        if (this.destroyed || this.layoutChipTimer != null) return;
        this.layoutChipTimer = setTimeout(() => {
            this.layoutChipTimer = null;
            this.syncLayoutChip();
        }, 350);
    }

    /**
     * Push a pending debounced change out NOW, for a teardown or a page unload — the
     * two moments the 500ms timer would otherwise never reach.
     *
     * Dropping it was a silent data loss: the timer carries BOTH halves of the dirty
     * signal — the `state:changed` event and the storage write — so a host that saves
     * from that event (a server-backed host, where `persistNow` is a no-op for want of
     * a `persistKey`) simply never heard about the user's last edit.
     *
     * Idempotent and re-entrancy safe, which the ordering here buys:
     *  - a no-op unless a timer is actually pending, so a teardown with nothing
     *    outstanding stays silent and never invents an edit;
     *  - the timer is cleared FIRST, so nothing survives this call and a second call
     *    does nothing — `destroy()` after an unload flush adds no second write;
     *  - the state is snapshotted BEFORE the handlers run, and that snapshot is what
     *    gets persisted, so storage and the host are told the same thing even if a
     *    handler mutates state while it runs;
     *  - `emitting` is held across the emit, so a handler calling back in (a host that
     *    tears down on save is the obvious one) cannot re-enter this and recurse.
     */
    /**
     * The document as it should be WRITTEN. After a quota failure the previews are the
     * first thing to go: they are the only field that is large, redundant (a layout can
     * be re-captured) and useless without its layout.
     */
    private encodeForStorage(): string {
        const state = this.getState();
        if (this.slimOnQuota && state.layoutMeta) {
            for (const meta of Object.values(state.layoutMeta)) delete meta.thumb;
        }
        return encodeState(state);
    }

    /** Keep an unreadable / too-new payload aside, once per boot, and say so. */
    private rescueUnreadable(raw: string, reason?: string): void {
        if (this.persistKey === null) return;
        const backupKey = `${this.persistKey}:unreadable`;
        try {
            void this.storage.set(backupKey, raw);
        } catch {
            /* the rescue itself is best-effort */
        }
        const why = reason === 'future' ? 'was written by a NEWER version of this library' : 'could not be read';
        this.deferNotice(`Your saved layout ${why}. It was left untouched and copied to “${backupKey}”.`, 'error');
    }

    /**
     * A storage write failed. Quota is treated as a SIGNAL, not an error: drop the
     * cheapest-to-lose field (previews), retry, and only then tell the user that nothing
     * more can be saved. A blocked store (private mode) is said out loud immediately —
     * silently losing a session is the worst possible outcome.
     */
    private handleStorageFailure(failure: StorageFailure): void {
        if (failure.kind === 'quota' && !this.slimOnQuota) {
            this.slimOnQuota = true;
            this.deferNotice('Browser storage is full — layout previews were dropped so your layouts keep saving.', 'info');
            this.persistNow();
            return;
        }
        const message =
            failure.kind === 'quota'
                ? 'Browser storage is full — changes are kept in memory only. Export the layout you want to keep.'
                : 'This browser is not letting the workspace save (storage unavailable). Changes are kept in memory only.';
        this.deferNotice(message, 'error');
        this.events.emit('persist:failed', { kind: failure.kind });
    }

    /** Toast with a per-message throttle, deferred so a constructor-time failure lands. */
    private deferNotice(message: string, kind: 'info' | 'success' | 'error'): void {
        const now = Date.now();
        if (now - this.lastStorageNotice < 8000) return;
        this.lastStorageNotice = now;
        // A failure can be reported while the constructor is still running (the boot
        // decode rescues an unreadable payload), so `root` may not be assigned yet.
        const doc = (this.root as HTMLElement | undefined)?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
        const win = doc?.defaultView ?? null;
        if (!win) return;
        win.setTimeout(() => {
            if (!this.destroyed) this.toast(message, kind, 6000);
        }, 0);
    }

    /** Another document (another TAB, or the same app in an iframe) wrote our key. */
    private readonly onForeignWrite = (e: StorageEvent): void => {
        if (this.persistKey === null || e.key !== this.persistKey || e.newValue == null) return;
        this.events.emit('state:external', { key: this.persistKey, raw: e.newValue });
        const now = Date.now();
        if (now - this.lastExternalNotice < 8000) return;
        this.lastExternalNotice = now;
        this.toast('This layout was changed in another tab — reload to open that version.', 'info', 7000);
    };

    private flushPendingState(): void {
        if (this.stateTimer == null || this.emitting) return;
        clearTimeout(this.stateTimer);
        this.stateTimer = null;
        const snapshot = this.persistKey !== null ? this.encodeForStorage() : null;
        this.emitting = true;
        try {
            this.events.emit('state:changed', undefined);
        } finally {
            this.emitting = false;
        }
        if (snapshot !== null && this.persistKey !== null) {
            try {
                void this.storage.set(this.persistKey, snapshot);
            } catch {
                /* best-effort — a failing adapter must never break the workspace */
            }
        }
    }

    /** Write the current state through the storage adapter now (fire-and-forget). */
    private persistNow(): void {
        if (this.persistKey === null || this.destroyed) return;
        try {
            void this.storage.set(this.persistKey, this.encodeForStorage());
        } catch {
            /* best-effort — a failing adapter must never break the workspace */
        }
    }

    // ── internals ───────────────────────────────────────────────
    private resolveLayout(layout: string | LayoutDefinition): LayoutDefinition {
        if (typeof layout !== 'string') return layout;
        // Registered ids first, then the picker's self-describing dynamic ids
        // (`g3x2`) — those synthesize without touching the registry.
        const def = ensureLayout(layout);
        if (!def) throw new Error(`[vela] unknown workspace layout "${layout}" — register it with registerLayout().`);
        return def;
    }

    private backendFor(def: LayoutDefinition): NativeBackend {
        // An explicit backend is the host's word — the WebGL budget policy only decides 'auto'.
        const explicit = this.opts.nativeBackend;
        if (explicit && explicit !== 'auto') return explicit;
        return def.cells.length > (this.opts.maxWebglCells ?? 8) ? 'canvas2d' : 'auto';
    }

    private currentTracks(): { cols: number[]; rows: number[] } {
        const sizes = this.trackSizes.get(this.def.id);
        return {
            cols: sizes?.cols?.length === this.def.cols.length ? [...sizes.cols] : [...this.def.cols],
            rows: sizes?.rows?.length === this.def.rows.length ? [...sizes.rows] : [...this.def.rows],
        };
    }

    private applyTracks(axis: 'cols' | 'rows', weights: number[]): void {
        const sizes = this.trackSizes.get(this.def.id) ?? {};
        sizes[axis] = weights;
        this.trackSizes.set(this.def.id, sizes);
        this.applyGrid();
        this.markStateDirty();
    }

    /** Apply the grid template (+ per-cell areas) and reposition the splitter strips.
     *  Geometry is keyed by SLOT (`perCell[slot.id]`); the cell living there is
     *  `order[i]` — the identity/position decoupling in one line. */
    private applyGrid(): void {
        const { container, perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        // The active-cell ring only exists on multi-cell grids (see the stylesheet).
        if (this.def.cells.length > 1) this.gridEl.dataset.multi = '1';
        else delete this.gridEl.dataset.multi;
        this.gridEl.style.gridTemplateColumns = container.gridTemplateColumns ?? '';
        this.gridEl.style.gridTemplateRows = container.gridTemplateRows ?? '';
        this.gridEl.style.gridTemplateAreas = container.gridTemplateAreas ?? '';
        for (const [i, slot] of this.def.cells.entries()) {
            const host = this.cellsById.get(this.order[i] ?? '')?.host;
            if (host) host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
        }
        this.applyMaximizePresentation();
        this.mountAttributionMark(); // the bottom-left host may have changed (layout/maximize)
        this.splitters.layout();
    }

    /** Overlay the maximize presentation on the freshly applied grid: EVERY cell spans
     *  the full track grid — the maximized one on top, the siblings invisible beneath
     *  it (their charts stay alive — restoring is instant). The siblings must span too:
     *  left in their slots they would auto-flow into implicit zero-height rows, whose
     *  gaps steal height from the maximized cell and collapse their renderers to 0.
     *  The splitter strips and the active ring hide via the `data-maximized` rules. */
    private applyMaximizePresentation(): void {
        const maxId = this.maximizedId;
        if (maxId) this.gridEl.dataset.maximized = '1';
        else delete this.gridEl.dataset.maximized;
        for (const [id, cell] of this.cellsById) {
            const style = cell.host.style;
            // applyGrid just re-derived each slot's own gridArea — only override while maximized.
            if (maxId) style.gridArea = '1 / 1 / -1 / -1';
            style.zIndex = maxId && id === maxId ? '5' : '';
            style.visibility = maxId && id !== maxId ? 'hidden' : '';
        }
    }

    /** Rebuild every cell's view cluster (the maximize gate or state changed). */
    private refreshCellControls(): void {
        for (const cell of this.cellsById.values()) cell.refreshControls();
        // Cells come and go here, so the group badges are re-projected with the controls.
        this.projectGroupMarks();
    }

    /** Drop the transient maximize on a structural change (layout switch, state
     *  document) — WITH the event, so hosts tracking `cell:maximized` never drift
     *  from `maximizedCell`. The caller's own grid re-apply paints the restore. */
    private clearMaximized(): void {
        if (this.maximizedId == null) return;
        this.maximizedId = null;
        this.events.emit('cell:maximized', { id: null });
    }

    /** The live cell under a viewport point, excluding `excludeId` and any host a
     *  maximize has hidden — the drag handle's hit-test. */
    private cellAtPoint(x: number, y: number, excludeId: string): string | null {
        for (const [id, cell] of this.cellsById) {
            if (id === excludeId || cell.host.style.visibility === 'hidden') continue;
            const r = cell.host.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
        }
        return null;
    }

    /** Mark one cell as the live drop target of a grip drag (null clears all) —
     *  the `data-drop-target` stylesheet rule paints the dashed preview ring. */
    private setDropTarget(id: string | null): void {
        for (const [cid, cell] of this.cellsById) {
            if (cid === id) cell.host.dataset.dropTarget = '1';
            else delete cell.host.dataset.dropTarget;
        }
    }

    /** The cell whose bottom-left corner the grid's attribution mark floats in — the
     *  maximized cell while one covers the grid, else the bottom-left slot's cell. */
    private bottomLeftCell(): ChartCell | undefined {
        if (this.maximizedId) return this.cellsById.get(this.maximizedId);
        const grid = occupancyGrid(this.def);
        const slot = grid[grid.length - 1]?.[0];
        const idx = this.def.cells.findIndex((c) => (c.area ?? c.id) === slot);
        return this.cellsById.get(this.order[idx >= 0 ? idx : 0] ?? '');
    }

    /** Keep the shared attribution mark inside the BOTTOM-LEFT visible cell: its
     *  offsets ride that cell's renderer-published `--vela-bottom-gutter` /
     *  `--vela-toolbar-gutter`, so collapsed pane strips push the mark up without any
     *  bookkeeping here. Re-run after anything that changes which host that is
     *  (layout switch, maximize, cell rebuild); a destroyed host drops the mark from
     *  the DOM, and this re-mount brings it back. */
    private mountAttributionMark(): void {
        const mark = this.attributionMark;
        if (!mark) return;
        const host = this.bottomLeftCell()?.host ?? this.gridEl;
        if (mark.parentElement !== host) host.appendChild(mark);
    }

    /** Create the cells the current layout wants but don't exist yet (pool-first).
     *  A slot's CELL IDENTITY is `order[i]` (declaration order — never the slot's own
     *  positional id); slots past the declared list mint an auto identity once. */
    private buildCells(): void {
        const theme = resolveTheme(this.opts.theme);
        const { perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        for (const [i, slot] of this.def.cells.entries()) {
            let id = this.order[i];
            if (!id) {
                id = nextAutoCellId(new Set([...this.order, ...this.pool.keys(), ...this.cellsById.keys()]));
                this.order[i] = id;
            }
            if (this.cellsById.has(id)) continue;
            // Rebuilt cells can recycle native handle ids; old mirrors must not make an
            // unrelated new indicator look like the previous Compare study.
            this.forgetCompareMirrors(id);
            const pooled = this.pool.get(id);
            if (!pooled) this.compareAxisSwitched.delete(id); // a recycled id is a new chart
            // New charts inherit the FIRST chart's live indicator set (TV's rule). A pooled
            // cell keeps its own — it is not new, it is returning.
            const inherited = !pooled && this.inheritIndicators ? this.inheritLedger(id) : undefined;
            // The house template ("Set as default" in the picker): the indicator set a
            // NEW chart opens with, exactly as TradingView's default template. It OUTRANKS
            // inheritance when set — an explicit "every new chart starts like this" is a
            // stronger instruction than the implicit sibling-copy, and it is what the
            // setting promises. A pooled/hydrated cell is never touched: the template is
            // for newborns, not for charts coming back with their own state.
            const house = !pooled ? this.defaultTemplateSeed() : undefined;
            const seed: CellBoot = pooled ?? {
                ...seedDefaults(this.opts),
                ...(this.opts.cells?.[id] ?? {}),
                ...(house ? { indicators: house } : inherited ? { indicators: inherited } : {}),
            };
            this.pool.delete(id); // the slot is live again — its pooled state is consumed
            const cell = new ChartCell(id, this.gridEl, seed, {
                feed: this.feed,
                engines: this.opts.engines ?? {},
                chartDefaults: cellChartDefaults(this.opts),
                theme,
                live: this.opts.live ?? false,
                volume: this.opts.volume ?? true,
                statusline: this.opts.statusline !== false,
                watermark: this.opts.watermark !== false,
                nativeBackend: this.cellBackend,
                dialogHost: this.root,
                timezone: () => this.timezone,
                setTimezone: (zone) => this.setTimezone(zone),
                context: () => this.context(),
                activate: (id) => this.setActiveCell(id),
                multiCell: () => !this.monoLayout && this.def.cells.length > 1,
                isMaximized: (id) => this.maximizedId === id,
                toggleMaximize: (id) => this.maximizeCell(this.maximizedId === id ? null : id),
                cellDragTarget: (id, x, y) => this.cellAtPoint(x, y, id),
                previewDropTarget: (target) => this.setDropTarget(target),
                dropCell: (id, target) => this.swapCells(id, target),
                onMarketChanged: (id) => this.onCellMarketChanged(id),
                onPriceStyleChanged: (id) => this.onCellPriceStyleChanged(id),
                onIndicatorsChanged: (id) => this.onCellIndicatorsChanged(id),
                onStatusPrefsChanged: (id) => this.propagateStylePrefs(id),
                onStateDirty: () => this.markStateDirty(),
                manifestSettled: () => this.manifestSettled,
                toast: (message, kind, durationMs) => this.toastHost.show(message, kind, durationMs),
                layoutLegendActions: (indicatorId, cellId) => this.layoutLegendActions(indicatorId, cellId),
                // Chart settings → Templates (TV's own place). Always offered: a lone
                // chart can still save its look; only "Apply to all" needs siblings.
                settingsTemplates: this.settingsTemplatesService,
                indicatorDefaults: this.indicatorDefaultsService,
                ...(this.def.cells.length > 1 ? { applySettingsToAll: (cellId: string) => this.applySettingsToAll(cellId) } : {}),
                ...(this.def.cells.length > 1 && !this.monoLayout ? { openSyncGesture: (cellId: string) => this.openSyncSurface(cellId) } : {}),
            });
            // The house APPEARANCE (chart settings → Templates → "start new charts with")
            // lands before the cell's first paint. A pooled cell keeps its own look, and a
            // restored one is overwritten by `applyState` a moment later.
            const houseLook = !pooled ? this.houseAppearance() : undefined;
            if (houseLook) cell.chart.renderer.applyConfig(houseLook);
            cell.host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
            this.cellsById.set(id, cell);
            // A REBUILT active cell (backend flip, pool round-trip) gets a fresh host —
            // re-assert the highlight attribute setActiveCell put on the old one.
            if (id === this.activeId) cell.host.dataset.active = '1';
            this.wireCell(cell);
            // A fresh renderer starts desktop — push the live mode so touch gestures,
            // fullscreen dialogs and the scroll-button sizing apply from the first frame.
            cell.chart.renderer.setLayoutMode(this.layoutCtl.current);
            // The bottom-bar clock is authoritative: the cell's countdown chip ticks on the
            // same pulse, never on a renderer-private timer that could read another second.
            cell.chart.renderer.setWallClock(this.clock);
            cell.setControlsCompact(this.layoutCtl.current === 'mobile');
            // The status line's marks are the marking ENTRY POINT: tap the emoji on a
            // chart and the sync sheet opens with THAT chart active (a phone cannot
            // hover a chart to pick it, so the badge has to be the picker).
            // Only the phone HAS this sheet — on desktop the same links live in the
            // topbar's Layout dropdown, so the badge stays informational there.
            cell.setSyncMarksHandler(this.monoLayout ? null : () => this.openSyncSurface(cell.id));
            // The shared star set is a workspace pref — every newborn cell inherits it
            // silently (equal-set idempotence keeps the favorites event from echoing).
            if (this.cursorStyle !== 'cross') cell.chart.setCursorStyle(this.cursorStyle);
            if (this.favs.length > 0) cell.chart.drawings.setFavorites(this.favs as never[]);
            // Same for the tools' remembered settings: a new chart's first trend line looks
            // like the last one drawn anywhere in the workspace.
            if (Object.keys(this.toolDefs).length > 0 || Object.keys(this.toolTemplates).length > 0) this.pushToolDefaults(null, [cell]);
            // The indicator ledger: a restored cell re-adds ITS recorded set (held until
            // the manifest resolves); a fresh cell seeds the manifest's enabled entries.
            cell.setManifest(this.manifest, seed.indicators == null);
            if (seed.objectTreeGroups) this.objectTree.setGroupsFor(cell.chart, seed.objectTreeGroups);
            // Third-party state last — the cell is wired and its core state is in
            // place, so a handler's restore (e.g. re-adding external indicators) lands
            // on a cell the workspace fully knows. Runs muted (no undo entries).
            cell.restorePersistedExt();
            this.restoreComparePlacement(cell);
            this.events.emit('cell:created', { id });
        }
        // DOM order = slot order (auto-flow layouts place row-major by child order).
        for (const [i] of this.def.cells.entries()) {
            const host = this.cellsById.get(this.order[i] ?? '')?.host;
            if (host) this.gridEl.appendChild(host);
        }
        this.mountAttributionMark(); // fresh hosts exist now — (re)claim the bottom-left one
        this.paintChartNumbers();
        // Seed the group badges: on a grid an unmarked chart shows "◌" (the door into
        // marking), and that state exists before any link is ever toggled.
        this.projectGroupMarks();
    }

    /** Write each chart's SLOT NUMBER onto its status line. Hidden until a sync surface is
     *  open — then the table's column "3" and the chart wearing "3" are the same thing,
     *  which is the only honest way to identify a chart whose ticker can change. */
    private paintChartNumbers(): void {
        const ids = this.order.filter((id) => this.cellsById.has(id));
        for (const id of this.cellsById.keys()) if (!ids.includes(id)) ids.push(id);
        for (const [i, id] of ids.entries()) {
            const cell = this.cellsById.get(id);
            cell?.host.querySelector('.vela-sl-symbol')?.setAttribute('data-chart-no', String(i + 1));
        }
    }

    /** The shared setup pane numbers charts while it is open — a number with nothing
     *  to match it against is just noise. */
    private setSyncSurfaceOpen(open: boolean): void {
        this.syncSurfaceOpen = open;
        if (open) this.root.setAttribute('data-sync-open', '1');
        else this.root.removeAttribute('data-sync-open');
    }

    /**
     * Hand a strategy run to the tester panel and — the FIRST time any strategy reports —
     * open it, the way the reference platform surfaces a backtest. An open panel always
     * wins: the user's column is never replaced by an unsolicited one.
     */
    private announceStrategyRun(chart: Vela, run: ScriptRun): void {
        this.strategyTester.setRun(chart, run);
        if (this.testerAnnounced) return;
        this.testerAnnounced = true;
        if (!this.dock.openId) this.dock.toggle('strategyTester', true);
    }

    /** Per-cell chart subscriptions (trigger ② — the chart instance is stable for the
     *  cell's whole life, so these live and die with the cell). */
    private wireCell(cell: ChartCell): void {
        const chart = cell.chart;
        // A pooled/rebuilt chart is a NEW data stream. Old cached prices and anchors
        // belong to its previous lifetime, not the freshly loaded series.
        this.lastPrice.delete(cell.id);
        this.lastBarTime.delete(cell.id);
        this.closeHistory.delete(cell.id);
        this.closeTimes.delete(cell.id);
        for (let i = 0; i < this.priceAlerts.length; i += 1) {
            const alert = this.priceAlerts[i];
            if (!alert || alert.cellId !== cell.id) continue;
            const next = { ...alert, anchorPrice: null };
            if (!next.source && !isMoveCondition(next.condition)) next.lineId = this.drawAlertLevel(cell, next, !next.lineId) ?? '';
            this.priceAlerts[i] = next;
        }
        this.syncAlertLines(cell);
        chart.on('indicator:inputs', ({ id }) => {
            this.indicatorLiveSync.inputsChanged(cell.id, id);
            // The Compare study can also be edited from indicator settings or live sync.
            // Its inputs are authoritative and an external display edit must move the
            // series too, not just paint a different button.
            const handle = chart.indicators().find((h) => h.id === id && h.nativeType === 'compare');
            if (!handle) return;
            const key = `${cell.id}:${id}`;
            const symbol = this.compareSymbolOf(cell);
            const display = this.compareDisplayOf(cell);
            if (symbol) this.compareSymbols.set(key, symbol);
            else this.compareSymbols.delete(key);
            this.compareDisplays.set(key, display);
            if (symbol && !this.compareWrites.has(key)) this.applyCompareDisplay(cell, id, display);
            if (cell.id === this.activeId) {
                this.topbar.setCompareSymbol(this.compareLabel());
                this.compareSheet?.refresh();
            }
        });
        chart.on('indicator:removed', ({ id }) => {
            this.indicatorOrigins.get(cell.id)?.delete(id);
            this.indicatorLiveSync.removed(cell.id, id);
            const key = `${cell.id}:${id}`;
            const wasCompare = this.compareSymbols.has(key) || this.compareDisplays.has(key);
            this.compareSymbols.delete(key);
            this.compareDisplays.delete(key);
            // Legend, Object Tree and On chart can remove Compare too. Do not alter a
            // document's new renderer config while in-place rehydration is converging.
            if (wasCompare && !this.styleSyncBusy && !chart.indicators().some((h) => h.nativeType === 'compare')) {
                this.restoreCompareAxis(cell);
                if (cell.id === this.activeId) {
                    this.topbar.setCompareSymbol(this.compareLabel());
                    this.compareSheet?.refresh();
                }
            }
            // A report belongs to its actual strategy even when that cell is inactive.
            this.strategyTester.forgetRun(chart, id);
        });
        // Requests on background cells must invalidate their remembered report too; an
        // unchanged symbol can still receive an entirely new inline candle series.
        chart.on('market:requested', () => {
            this.strategyTester.invalidateMarket(chart);
            // A cell's prior price/history belongs to its old market. Never seed or
            // immediately evaluate a new-symbol alert from those stale candles.
            this.lastPrice.delete(cell.id);
            this.lastBarTime.delete(cell.id);
            this.closeHistory.delete(cell.id);
            this.closeTimes.delete(cell.id);
            this.alertPanel.refresh();
        });
        chart.on('indicator:added', ({ id }) => {
            this.indicatorLiveSync.resolvePending();
            this.indicatorLiveSync.ready(cell.id, id);
            const handle = chart.indicators().find((h) => h.id === id && h.nativeType === 'compare');
            if (handle) this.compareDisplays.set(`${cell.id}:${id}`, this.compareDisplayOf(cell));
        });
        chart.on('indicator:error', ({ error }) => this.toastHost.show(`[${cell.id}] ${error.message}`, 'error', 5000));
        // Script runs relay up with the cell they came from, so ONE subscription on the
        // workspace covers a grid whose cells come and go. Each cell runs its own engine
        // session, so the `cell` field is what tells two identical scripts apart.
        chart.on('script:run', (run) => {
            this.events.emit('script:run', { ...run, cell: cell.id });
            // A strategy's report belongs to the cell that ran it, so the tester hears every
            // cell — a run that lands while another cell is active is still waiting when the
            // user switches back. The first one opens the panel (never over another panel).
            if (run.kind === 'strategy') this.announceStrategyRun(chart, run);
        });
        chart.on('priceStyle:change', ({ from, to }) => this.events.emit('cell:priceStyle', { id: cell.id, from, to }));
        // Entering/seeking replay replaces the series without `bar` events; rebase
        // anchors and lookbacks to the revealed tape instead of retaining live/future data.
        chart.on('replay:start', () => this.rebaseAlertHistory(cell));
        chart.on('replay:end', ({ reason }) => { if (reason !== 'market') this.rebaseAlertHistory(cell); });
        // The committed market event follows ChartCell's projection; a directly requested
        // new symbol can still have shown the OLD label during the preceding load:end.
        chart.on('market:changed', () => this.rebaseAlertHistory(cell));
        // Price alerts are evaluated on the same print the chart draws — one tick per bar
        // update, so "crossed 143.50" fires on the bar where the line visibly crossed.
        chart.on('bar', (bar) => {
            // A synchronous feed tick can land after a request but before ChartCell
            // projects the new identity. Never judge it against the old symbol.
            if (chart.loading || !this.alertMarketMatches(cell)) return;
            this.lastPrice.set(cell.id, bar.close);
            this.lastBarTime.set(cell.id, bar.time);
            this.pushClose(cell.id, bar.close, bar.time);
            this.evaluatePriceAlerts(cell, bar.close, bar.time);
            if (cell.id === this.activeId) this.alertPanel.refreshTarget();
        });
        // A STATIC series (host `data`, a restored snapshot) never emits `bar`, so the
        // sheet would open with an empty level on a chart that is clearly showing a price.
        // Seed the last print off the renderer when a load settles (live ticks overwrite).
        chart.on('load:end', () => {
            if (!this.lastPrice.has(cell.id)) this.rebaseAlertHistory(cell);
            this.alertPanel.refresh();
        });
        chart.on('alert', (alert) => {
            // Provenance the way a user reads it — symbol, timeframe, and the indicator
            // that fired — captured at fire time (the cell may switch markets later).
            const source = [parseSymbol(cell.symbol).ticker || cell.symbol, timeframeLabel(cell.timeframe), alert.indicator]
                .filter(Boolean)
                .join(' ');
            this.alerts.unshift({ cellId: cell.id, source, title: alert.title ?? 'Alert', message: alert.message, time: alert.time });
            if (this.alerts.length > this.alertCap) this.alerts.pop();
            this.alertPanel.refresh();
            this.toastHost.show(`${source} — ${alert.title ? alert.title + ' — ' : ''}${alert.message}`, 'info', 4000);
            this.syncAlertCount();
        });
        // Favorites are a WORKSPACE preference: one shared toolbar, one star set — a star
        // toggled in any cell re-applies to every other cell (and the shared bar), and
        // the mirror is what `getState()` persists.
        chart.on('drawing:favorites', ({ favorites }) => {
            this.favs = favorites;
            for (const other of this.cellsById.values()) {
                if (other !== cell) other.chart.drawings.setFavorites(favorites as never[]);
            }
            this.drawToolbar?.setFavorites(favorites as never[]);
            this.markStateDirty();
        });
        // The tools' remembered settings are a WORKSPACE preference too: styling a drawing in
        // any cell becomes the default for that tool on every cell, and `getState()` keeps it.
        chart.on('drawing:defaults', () => {
            if (this.toolDefsBusy) return;
            this.toolDefs = chart.drawings.toolDefaults() as Record<string, unknown>;
            this.pushToolDefaults(cell);
            this.markStateDirty();
        });
        chart.on('drawing:templates', () => {
            if (this.toolDefsBusy) return;
            this.toolTemplates = chart.drawings.toolTemplates() as Record<string, unknown>;
            this.pushToolDefaults(cell);
            this.markStateDirty();
        });
        // Crosshair sync: mirror THIS cell's pointer time onto its same-group followers
        // as ghost markers. Leave already emits `time: null` — the clear rides along.
        // The horizontal level travels only when the cursor is on the PRICE pane — a
        // study pane's `price` is that pane's indicator value, not a chart price.
        chart.renderer.onCrosshairMove((e) => this.propagateCrosshair(cell.id, e.time, e.paneKind === 'price' ? e.price : null));
        // Click-to-align (the `time` link): a click brings the same instant into view on
        // the followers without touching their span.
        chart.renderer.onClick((e) => {
            // Alt+Click maximizes/restores THIS chart (TradingView's chord) — it wins over
            // the time link, which needs the pointer's instant, not a zoom reset.
            if (e.alt) {
                this.maximizeCell(this.maximizedId === cell.id ? null : cell.id);
                return;
            }
            this.propagateTime(cell.id, e.time);
        });
        // Global drawing scope: the drawings on screen are still the OLD symbol's at this
        // point (they are not market-bound), so this is where they get parked and the new
        // symbol's document loads.
        chart.on('market:changed', ({ prev }) => {
            this.onCellMarketSwitched(cell, prev.symbol);
            if (cell.id === this.activeId) this.broadcastLink();
            this.markStateDirty();
        });
        chart.on('viewport:changed', () => {
            if (cell.id === this.activeId) this.broadcastLink();
        });
        // Drawing edits are cell state (the per-slot drawings document) — persistable.
        // When the drawings link is on, a CREATED drawing copies onto the same-group
        // cells and the set stays LINKED: edits and removals of any member follow
        // (the guard stops the propagated mutations from fanning out again).
        chart.on('drawing:created', ({ id }) => {
            this.propagateDrawing(cell.id, id);
            this.syncDrawingStore(cell);
            this.markStateDirty();
        });
        // Placement progress mirrors LIVE as ghosts on the same-group cells; the end of
        // the placement carries `null`, which clears them (the created copy takes over).
        chart.on('drawing:draft', ({ doc }) => this.propagateDraft(cell.id, doc));
        chart.on('drawing:edited', ({ id }) => {
            this.alertPanel.refresh();
            this.propagateDrawingEdit(cell.id, id);
            this.markStateDirty();
        });
        chart.on('drawing:removed', ({ id }) => {
            // A source may later be restored by Undo. Do not carry a crossing side from
            // before the drawing disappeared across that unobservable interval.
            for (let i = 0; i < this.priceAlerts.length; i += 1) {
                const alert = this.priceAlerts[i];
                if (alert && alert.cellId === cell.id && alert.source?.drawingId === id && alert.anchorPrice != null)
                    this.priceAlerts[i] = { ...alert, anchorPrice: null };
            }
            this.alertPanel.refresh();
            this.propagateDrawingRemoval(cell.id, id);
            if (cell.id === this.activeId) this.drawToolbar?.refreshChartTools();
            this.markStateDirty();
        });
        chart.on('drawing:created', () => {
            if (cell.id === this.activeId) this.drawToolbar?.refreshChartTools();
        });
        chart.on('drawing:edited', () => {
            if (cell.id === this.activeId) this.drawToolbar?.refreshChartTools();
        });
        chart.on('drawing:hidden-all', () => {
            if (cell.id === this.activeId) this.drawToolbar?.refreshChartTools();
        });
        // The floating bar's clock: arm a price alert whose level IS this drawing's line.
        chart.on('drawing:alert-request', ({ id }) => this.openAlertForDrawing(cell, id));
        // Tool/magnet/mode reflection (trigger ②): the ACTIVE cell's drawing state drives
        // the shared bar and the global mirrors — whatever the source (bar press, keymap,
        // API, a one-shot tool disarming itself after placement).
        chart.on('drawing:tool', ({ type }) => {
            if (cell.id !== this.activeId) return;
            this.globalTool = type;
            this.drawToolbar?.setActiveTool(type);
            // ONE record point for the habit, whichever door armed the tool (docked
            // toolbar, sheet, keyboard shortcut, the pill's own menu).
            if (type) recordRecent('drawings', type);
        });
        chart.on('drawing:snap', ({ mode }) => {
            if (cell.id !== this.activeId) return;
            const changed = mode !== this.globalSnap;
            this.globalSnap = mode;
            this.drawToolbar?.setMagnetMode(mode);
            if (changed) this.markStateDirty();
        });
        chart.on('drawing:stay', ({ on }) => {
            if (cell.id !== this.activeId) return;
            const changed = on !== this.globalStay;
            this.globalStay = on;
            this.drawToolbar?.setStayMode(on);
            if (changed) this.markStateDirty();
        });
        chart.on('drawing:mode', ({ mode }) => {
            if (cell.id !== this.activeId) return;
            this.drawToolbar?.setMeasureActive(mode === 'measure');
            this.drawToolbar?.setEraserActive(mode === 'eraser');
            this.drawToolbar?.setZoomActive(mode === 'zoom');
        });
        // Viewport sync: every applied pan/zoom/fit propagates to the same-group cells.
        chart.on('viewport:changed', (range) => this.propagateViewport(cell.id, range));
        // Style sync: any committed config edit (settings dialog, applyConfig) mirrors
        // this cell's style-link slice onto its same-group followers.
        chart.renderer.onConfigChanged(() => {
            this.propagateStylePrefs(cell.id);
            // Chart settings / appearance templates / stacking all ride getConfig().
            // A committed config edit is a chart change, so it belongs in history too.
            this.markStateDirty();
        });
        // A theme picked in ONE cell (its settings dialog's Canvas → Theme) re-skins the
        // WHOLE workspace — shared chrome plus every other cell.
        chart.on('theme:changed', (t) => this.setTheme(t));
        chart.on('priceStyle:change', () => this.markStateDirty());
        chart.on('indicator:moved', () => this.markStateDirty());
        // Pane collapse/maximize/move/remove are chart changes, not merely view state.
        // Keep the mobile bar's maximize stop truthful and capture the pane snapshot.
        chart.on('pane:changed', () => {
            if (cell.id === this.activeId) this.syncMobileMaximize();
            this.markStateDirty();
        });
        chart.on('pane:moved', () => this.markStateDirty());
        // This event is touch-only: offer compact axis options even when a phone in landscape
        // uses desktop chrome. Mouse users still get the separate right-click menu.
        // The press's own pointerdown already activated the cell.
        chart.renderer.onAxisLongPress((e) => {
            if (e.axis === 'time') {
                const canvas = cell.host.querySelector<HTMLCanvasElement>('canvas');
                const rect = (canvas ?? cell.host).getBoundingClientRect();
                this.openTimezoneDrawerAt(rect.left + e.x, rect.top + e.y);
            } else cell.openPriceScaleMenu(e.x, e.y);
        });
    }

    // ── sync links ──────────────────────────────────────────────
    private applySyncSetting(kind: SyncKind, setting: SyncSetting | undefined, align = false): void {
        if (setting == null || setting === false) delete this.syncOpts[kind];
        else {
            // Normalize group values to STABLE ids at the single write gate. A host may
            // pass legacy marks (`'🔴'`) or its own keys; documents from here on only
            // carry ids, which is what makes the palette free to change.
            if (typeof setting === 'object') {
                const canon: Record<string, string> = {};
                for (const [id, g] of Object.entries(setting)) canon[id] = groupIdOf(g) ?? g;
                setting = canon;
            }
            this.syncOpts[kind] = setting;
            // Remember how the link was ON so the switch's off→on round-trip restores
            // the chart chips instead of collapsing a grouped grid into the all-cells
            // form (the dropdown's switches are meant to be flicked).
            this.lastSyncOn[kind] = setting;
        }
        if (kind === 'drawings') {
            // Placement ghosts are stale under the new setting. Link pairs stay —
            // turning off freezes propagation; turning on resumes edit/delete for
            // drawings paired earlier (never copies unpaired ones onto peers).
            for (const cell of this.cellsById.values()) cell.chart.drawings.setExternalGhost(null);
            // The toggle lives on the shared drawing toolbar; keep it truthful.
            this.drawToolbar?.setDrawingsSyncMode(!!setting);
            this.projectGroupMarks();
            this.markStateDirty();
            return;
        }
        if (kind === 'crosshair') {
            // Any setting change invalidates current ghosts — they rebuild on the next
            // pointer move under the NEW grouping (and vanish entirely when disabled).
            for (const cell of this.cellsById.values()) {
                cell.chart.renderer.setExternalCrosshair(null);
                cell.setSyncedCrosshairAt(null);
            }
            // A renderer without the seam silently never shows ghosts — warn only when
            // enabling while NO cell can display one (e.g. minimal custom renderers).
            if (setting && ![...this.cellsById.values()].some((c) => c.chart.renderer.supportsExternalCrosshair)) {
                console.warn('[vela] crosshair sync: no cell renderer supports an external crosshair — nothing will show.');
            }
            // Refresh the layout dropdown's switch state (absent during constructor boot).
            if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
            this.projectGroupMarks();
            this.markStateDirty();
            return; // no market/viewport alignment applies to a pointer link
        }
        if (kind === 'time') {
            // Click-to-align carries no state to reconcile: the link simply changes what
            // the NEXT click does. Keep the dropdown truthful and persist the choice.
            if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
            this.projectGroupMarks();
            this.markStateDirty();
            return;
        }
        // Symbol/interval switches live in the layout dropdown too — keep an open
        // panel truthful when the setting flips through the API.
        if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
        this.projectGroupMarks();
        this.markStateDirty();
        if (align && setting && this.activeId) {
            if (kind === 'viewport') {
                const range = this.cellsById.get(this.activeId)?.chart.getVisibleRange();
                if (range) this.propagateViewport(this.activeId, range);
            } else if (kind === 'style') {
                this.propagateStylePrefs(this.activeId);
            } else {
                this.propagateMarket(this.activeId);
            }
        }
    }


    // ── "apply this indicator to the whole layout" (TV's two menu entries) ──────────
    /**
     * The legend-row actions no single-chart host has: copy the row's indicator onto
     * every other chart (inputs and props included, hidden state too) and remove it from
     * every chart. One row, one chip — the same place TradingView puts
     * "Add this indicator to entire layout".
     */
    private layoutLegendActions(indicatorId: string, cellId: string): Array<{ id: string; icon: string; tooltip: string; run(): void }> {
        if (this.def.cells.length < 2) return [];
        const others = () => [...this.cellsById.keys()].filter((id) => id !== cellId);
        if (others().length === 0) return [];
        return [
            {
                id: 'layout.indicator-apply-all',
                icon: 'layout',
                tooltip: 'Add this indicator to every chart',
                run: () => {
                    const n = this.replicateIndicator(cellId, indicatorId, others());
                    if (n > 0) this.toast(`Indicator added to ${n} chart${n === 1 ? '' : 's'}`, 'success');
                },
            },
            {
                id: 'layout.indicator-remove-all',
                icon: 'eraser',
                tooltip: 'Remove this indicator from every chart',
                run: () => {
                    const key = this.indicatorKey(cellId, indicatorId);
                    let n = 0;
                    for (const id of [cellId, ...others()]) {
                        const cell = this.cellsById.get(id);
                        if (!cell) continue;
                        for (const h of cell.chart.indicators()) {
                            if (this.indicatorKey(id, h.id) !== key) continue;
                            h.remove();
                            n += 1;
                        }
                    }
                    if (n > 0) this.toast(`Indicator removed from ${n} chart${n === 1 ? '' : 's'}`, 'info');
                },
            },
        ];
    }

    /** Record actual new-cell inheritance while the donor and its seeded handles are
     * still known. Tokens are deliberately runtime-only; a restored unrelated study is
     * never assumed to be the same instance just because its type or title matches. */
    private captureInheritedIndicators(pendingOnly = false): void {
        for (const [targetId, donorId] of this.indicatorSyncInheritedFrom) {
            if (!pendingOnly && this.indicatorOrigins.has(targetId)) continue;
            const donor = this.cellsById.get(donorId), target = this.cellsById.get(targetId);
            if (!donor || !target) continue;
            let origins = this.indicatorOrigins.get(donorId);
            if (!origins) this.indicatorOrigins.set(donorId, (origins = new Map()));
            let targetOrigins = this.indicatorOrigins.get(targetId);
            if (!targetOrigins) this.indicatorOrigins.set(targetId, (targetOrigins = new Map()));
            const sourceHandles = donor.chart.indicators(), targetHandles = target.chart.indicators();
            for (const source of sourceHandles) {
                const ref = indicatorReference(sourceHandles, source.id);
                if (!ref) continue;
                let origin = origins.get(source.id);
                if (pendingOnly && (origin === undefined || !this.deferredInheritedIndicators.get(targetId)?.has(origin))) continue;
                if (origin === undefined) { origin = ++this.nextIndicatorOrigin; origins.set(source.id, origin); }
                const inherited = resolveIndicatorReference(targetHandles, ref);
                if (inherited) targetOrigins.set(inherited.id, origin);
                else if (!this.manifestSettled && !source.nativeType && source.source) {
                    let waiting = this.deferredInheritedIndicators.get(targetId);
                    if (!waiting) this.deferredInheritedIndicators.set(targetId, (waiting = new Set()));
                    waiting.add(origin);
                }
            }
        }
    }

    private indicatorOrigin(source: IndicatorHandle): number | undefined {
        for (const cell of this.cellsById.values()) {
            if (cell.chart.indicators().includes(source)) return this.indicatorOrigins.get(cell.id)?.get(source.id);
        }
        return undefined;
    }

    private inheritedIndicator(targetId: string, source: IndicatorHandle): IndicatorHandle | undefined {
        const origin = this.indicatorOrigin(source);
        const origins = this.indicatorOrigins.get(targetId);
        if (origin === undefined || !origins) return undefined;
        return this.cellsById.get(targetId)?.chart.indicators().find((handle) =>
            origins.get(handle.id) === origin && indicatorReferenceKey(handle) === indicatorReferenceKey(source));
    }

    private indicatorCopyDeferred(targetId: string, source: IndicatorHandle): boolean {
        const origin = this.indicatorOrigin(source);
        return !this.manifestSettled && origin !== undefined && !!this.deferredInheritedIndicators.get(targetId)?.has(origin);
    }

    /** Configure linked copies of specific indicator instances on the active chart. */
    setIndicatorLiveSync(ids: readonly string[], mode: IndicatorLinkMode, charts: readonly string[] = []): number {
        if (!this.activeId) return 0;
        let count = 0;
        for (const id of ids) count += this.indicatorLiveSync.set(this.activeId, id, mode, charts);
        if (mode !== 'none') {
            const wanted = mode === 'layout' ? [...this.cellsById.keys()].filter((id) => id !== this.activeId) : [...new Set(charts)].filter((id) => id !== this.activeId);
            if (wanted.some((target) => ids.some((id) => {
                const status = this.indicatorLiveSync.status(this.activeId!, id);
                return !status.charts.includes(target) && !status.pending.includes(target);
            }))) {
                this.toast('Some charts could not be linked. Check the indicator and scripting engine on those charts.', 'error');
            }
        }
        this.objectTree.refresh();
        return count;
    }

    indicatorSyncStatus(id: string): { mode: IndicatorLinkMode; charts: string[]; pending: string[] } {
        return this.activeId ? this.indicatorLiveSync.status(this.activeId, id) : { mode: 'none', charts: [], pending: [] };
    }

    /** A stable cross-chart identity for an indicator: its native type, else its title. */
    private indicatorKey(cellId: string, indicatorId: string): string {
        const handle = this.cellsById.get(cellId)?.chart.indicators().find((h) => h.id === indicatorId);
        return handle ? `n:${handle.nativeType ?? ''}|s:${handle.title}` : '';
    }

    /**
     * Copy one indicator onto `targets` — the source handle carries what is needed (the
     * script source, or the native type) plus its input/prop values and visibility, so
     * the copy lands looking identical. Returns how many charts accepted it.
     */
    private replicateIndicator(sourceCellId: string, indicatorId: string, targets: string[]): number {
        const source = this.cellsById.get(sourceCellId);
        const handle = source?.chart.indicators().find((h) => h.id === indicatorId);
        if (!source || !handle) return 0;
        const inputs = handle.inputValues();
        const props = handle.propValues();
        let applied = 0;
        for (const id of targets) {
            const cell = this.cellsById.get(id);
            if (!cell) continue;
            try {
                // A built-in now carries its readable Pine source AND its nativeType.
                // Native identity wins: copying it as a raw script would lose the study's
                // built-in ledger/legend/persistence and (for volume) its column layer.
                const copy = handle.nativeType
                    ? cell.chart.addNativeIndicator(handle.nativeType, { inputs })
                    : handle.source !== undefined
                      // Keep the source row's NAME on the copies: a grid of "Indicator"
                      // rows tells the trader nothing about which script it is.
                      ? cell.chart.addIndicator(handle.source, { inputs, props, title: handle.title })
                      : null;
                if (!copy) continue;
                if (!handle.visible) copy.setVisible(false);
                applied += 1;
            } catch (err) {
                console.warn(`[vela] could not copy indicator onto ${id}:`, err);
            }
        }
        return applied;
    }

    /** "Apply settings to all charts": one shot of the style slice, link or no link. */
    applySettingsToAll(cellId?: string): void {
        const from = cellId ?? this.activeId;
        if (!from) return;
        const origin = this.cellsById.get(from);
        if (!origin) return;
        const config = origin.chart.renderer.getConfig();
        const prefs = origin.statusPrefs();
        for (const [id, cell] of this.cellsById) {
            if (id === from) continue;
            const patch = styleConfigPatch(config, cell.chart.renderer.getConfig());
            if (patch) cell.chart.renderer.applyConfig(patch);
            cell.applyStatusPrefs(prefs);
        }
        this.markStateDirty();
        this.toast('Settings applied to every chart', 'success');
    }

    /** Apply this chart's whole indicator set to every other chart. */
    applyIndicatorsToAll(cellId?: string): void {
        const from = cellId ?? this.activeId;
        if (!from) return;
        let n = 0;
        for (const id of [...this.cellsById.keys()]) {
            if (id === from) continue;
            n += this.replicateIndicatorsFrom(from, id);
        }
        if (n > 0) this.toast(`Indicators applied to ${n} chart${n === 1 ? '' : 's'}`, 'success');
    }

    /** Replace a cell's indicator set with another cell's (native + manifest entries). */
    private replicateIndicatorsFrom(sourceCellId: string, targetId: string): number {
        const source = this.cellsById.get(sourceCellId);
        const target = this.cellsById.get(targetId);
        if (!source || !target) return 0;
        for (const h of target.chart.indicators()) h.remove();
        let n = 0;
        for (const h of source.chart.indicators()) {
            const inputs = h.inputValues();
            const props = h.propValues();
            try {
                const copy = h.nativeType
                    ? target.chart.addNativeIndicator(h.nativeType, { inputs })
                    : h.source !== undefined
                      ? target.chart.addIndicator(h.source, { inputs, props })
                      : null;
                if (copy) {
                    if (!h.visible) copy.setVisible(false);
                    n += 1;
                }
            } catch (err) {
                console.warn(`[vela] indicator copy onto ${targetId} failed:`, err);
            }
        }
        return n;
    }

    // ── the layout dropdown's sync surface (ONE list for both shells) ───────────────
    /**
     * Every link the model carries, in TradingView's reading order. `checked` is TRUE
     * for both forms of on — `true` and a non-empty group record — so a grouped grid no
     * longer renders every switch as off (`=== true` was the old bug), and `group` is
     * the ACTIVE cell's group for that link, which the row's chip cycles.
     */

    /** The picker presets, with shapes that are IDENTICAL to an earlier entry folded away
     *  (TradingView's `4s` and `4s-l` draw the same grid; listing both reads as a bug). */
    private presetRows(): Array<{ id: string; label: string; icon: string; checked: boolean; cells: number }> {
        const seen = new Set<string>();
        const rows: Array<{ id: string; label: string; icon: string; checked: boolean; cells: number }> = [];
        for (const l of layouts()) {
            if (layoutShape(l) !== null) continue; // expressible on the canvas — no tile needed
            // Ratios count: 2-2 and 2-2-l share tiles but not proportions, and their
            // glyphs differ. Only a TRUE duplicate (4s / 4s-l) folds away.
            const signature = `${l.cols.join(',')}|${l.rows.join(',')}|${occupancyGrid(l).map((row) => row.join('')).join('/')}`;
            if (seen.has(signature)) continue;
            seen.add(signature);
            rows.push({ id: l.id, label: l.label, icon: layoutGlyph(l), checked: l.id === this.def.id, cells: l.cells.length });
        }
        return rows;
    }

    private syncRows(): Array<{ id: SyncKind; label: string; checked: boolean; group?: string; marks: Record<string, string> }> {
        return SYNC_ROW_ORDER.map(([id, label]) => {
            const setting = this.syncOpts[id];
            // `group` is the ACTIVE cell's mark — the chip on the desktop row — and
            // `marks` is the same reading for EVERY chart, which is what the phone's
            // marking matrix draws. Both are the DISPLAY truth (`markOf`): the all-cells
            // form is the implicit group 'A' (drawn dashed), not "no group", because a
            // chart that follows a link has to wear something.
            const group = this.activeId ? markOf(setting, this.activeId) : undefined;
            const marks: Record<string, string> = {};
            for (const cellId of this.cellsById.keys()) {
                const mark = markOf(setting, cellId);
                if (mark) marks[cellId] = mark;
            }
            return { id, label, checked: syncEnabled(setting), ...(group ? { group } : {}), marks };
        });
    }

    /** The charts the sync matrix lists, in slot order, with the active one flagged. */
    /** The charts the sync table lists, in LAYOUT order — identified by SLOT, not by
     *  symbol. A cell's id ('btc') and its ticker are both moving targets: the chart
     *  named 'btc' can be showing XRPUSDT a second later, and a host may name its cells
     *  anything. The number is the slot the user sees (1 = top-left, row-major), and the
     *  live ticker rides along for the tooltip only. */
    private syncCharts(): Array<{ id: string; label: string; symbol: string; active: boolean }> {
        const ids = this.order.filter((id) => this.cellsById.has(id));
        for (const id of this.cellsById.keys()) if (!ids.includes(id)) ids.push(id);
        return ids.map((id, i) => ({
            id,
            label: String(i + 1),
            symbol: this.cellsById.get(id)?.symbol ?? '',
            active: id === this.activeId,
        }));
    }

    /** Flip one link: on ⇒ off, off ⇒ on. `align = false` — the switch decides what the
     *  NEXT edit follows; it never rewrites the markets already on screen. Turning a
     *  link back ON restores the grouping it was switched off with (TradingView keeps
     *  the chart chips) — falling back to the all-cells form for a link never grouped. */
    private toggleSync(kind: SyncKind): void {
        if (syncEnabled(this.syncOpts[kind])) {
            // `applySyncSetting` parks the setting in `lastSyncOn` on its way out.
            this.sync.set(kind, false, false);
        } else {
            this.sync.set(kind, this.lastSyncOn[kind] ?? true, false);
        }
    }

    /** Put the ACTIVE cell through the link's groups: none → 🔴 → 🟢 → 🔵 → 🟡 → none. */
    private cycleGroup(kind: SyncKind): void {
        if (this.activeId) this.cycleGroupFor(kind, this.activeId);
    }

    /** The same cycle for ANY cell — the mobile matrix marks a chart without first
     *  making it active (the chip IS the target). */
    cycleGroupFor(kind: SyncKind, cellId: string): void {
        if (!this.cellsById.has(cellId)) return;
        // A chip tap on an OFF link means "link this chart": the link comes on in its
        // all-cells form first, then this chart steps out into 🔴 — so the tap never
        // leaves a half-link behind (one chart in a group, nothing else following).
        if (!syncEnabled(this.syncOpts[kind])) this.sync.set(kind, true, false);
        const setting = this.syncOpts[kind];
        // The CYCLE walks the stable group ids; `markOf` is only what the chip paints,
        // so it is deliberately not the input here (a legacy document storing emoji is
        // normalized by `nextGroupMark` anyway).
        const current = groupOf(setting, cellId);
        // An all-cells link reports the implicit group; `nextGroupMark` treats a real id
        // as a position in the palette and anything else as "unlinked" — so the first tap
        // on an all-cells chart hands it red while the rest keep 'A'.
        const inUse = syncGroups(setting);
        // The palette the chip cycles is the SAME slice every other surface offers: one
        // mark per chart in this layout (2 charts → 2, 4 → 4, 16 → 16), plus any group
        // already in use so a shrink never strands an assignment off the end of the list.
        const palette = groupsForCount(this.cellsById.size, inUse);
        const next = nextGroupMark(current === IMPLICIT_GROUP ? undefined : current, inUse, palette.map((g) => g.id));
        this.sync.setGroup(kind, cellId, next);
        this.projectGroupMarks();
    }

    /** Put ONE chart in ONE group, outright — the table's palette. `null` unlinks the
     *  chart from that link (TV's "uncheck the emoji"). The link comes on first so the
     *  pick never leaves a half-link behind. */
    setGroupFor(kind: SyncKind, cellId: string, mark: string | null): void {
        if (!this.cellsById.has(cellId)) return;
        if (mark && !syncEnabled(this.syncOpts[kind])) this.sync.set(kind, true, false);
        this.sync.setGroup(kind, cellId, mark);
        this.projectGroupMarks();
        this.markStateDirty();
    }

    /** Drop a link back into the all-cells form — every chart in one group (the matrix's
     *  ALL chip). `align` stays false: nothing on screen is rewritten, only what follows. */
    syncAllInOneGroup(kind: SyncKind): void {
        this.sync.set(kind, true, false);
        this.projectGroupMarks();
    }

    /** Open the shared setup pane on the chart-syncing tab for one chart. */
    openSyncDrawer(cellId?: string): void {
        // The historic phone/public door selects its chart first; the desktop badge
        // opens on a chart's column without silently changing the active chart.
        if (cellId && this.cellsById.has(cellId) && cellId !== this.activeId) this.setActiveCell(cellId);
        this.openLayoutSetup('sync', cellId);
    }

    private openLayoutSetup(tab: 'layout' | 'sync' = 'layout', cellId?: string, toggle = false, keyboard = false): void {
        const pane = this.layoutSetup;
        if (!pane) return;
        if (toggle && pane.open) { this.dock.toggle('layoutSetup', false); return; }
        pane.rememberFocus(this.root.ownerDocument.activeElement);
        pane.selectTab(tab);
        this.dock.toggle('layoutSetup', true);
        pane.refresh();
        if (cellId && tab === 'sync') pane.focusChart(cellId);
        if (keyboard) pane.focusSelectedTab();
    }

    /** Re-draw every cell's emoji badge from the live links (cheap; runs on a link edit). */
    private projectGroupMarks(): void {
        const marks = new Map<string, Array<{ kind: string; mark: string }>>();
        for (const cell of this.cellsById.values()) marks.set(cell.id, []);
        for (const kind of SYNC_KINDS) {
            const setting = this.syncOpts[kind];
            if (!syncEnabled(setting)) continue;
            // `markOf`, not `groupOf`: an all-cells link IS a group (every chart in the
            // implicit 'A'), and a chart that follows a link must WEAR a mark — the badge
            // used to stay empty for every switch a user could actually reach, which read
            // as "the marking does nothing".
            for (const cellId of this.cellsById.keys()) {
                const mark = markOf(setting, cellId);
                if (!mark) continue;
                marks.get(cellId)?.push({ kind: KIND_LABEL[kind], mark });
            }
        }
        // On a multi-chart grid the badge is ALSO the door into marking, so an unmarked
        // chart shows it (as "◌") instead of hiding the affordance entirely.
        const linkable = !this.monoLayout && this.cellsById.size > 1;
        for (const [id, cellMarks] of marks) this.cellsById.get(id)?.setSyncMarks(cellMarks, linkable);
        this.layoutSetup?.refresh();
    }

    // ── drawing scope: the cell's document, or the SYMBOL's ─────────────────────────
    /**
     * Switch what drawings belong to. `'layout'` is the historical model (the cell owns
     * them). `'global'` is TradingView's global scope: the workspace keeps a store per
     * SYMBOL, a chart switching symbol parks its drawings under the old symbol and the
     * new symbol's come back — so the same pair shows the same lines in every layout.
     */
    setDrawingsScope(scope: 'layout' | 'global'): void {
        if (scope === this.drawingsScope) return;
        this.drawingsScope = scope;
        if (scope === 'global') {
            for (const cell of this.cellsById.values()) this.syncDrawingStore(cell);
            this.toast('Drawings now follow the symbol', 'info');
        }
        this.markStateDirty();
        this.topbar.setLayout(this.def.id);
        this.layoutSetup?.refresh();
    }

    /** Park one cell's drawings under its CURRENT symbol (global scope only). */
    private syncDrawingStore(cell: ChartCell): void {
        if (this.drawingsScope !== 'global' || !cell.symbol) return;
        this.drawingsBySymbol[cell.symbol] = cell.chart.drawings.toJSON();
    }

    /**
     * A cell switched markets under the global drawing scope: the drawings on screen are
     * still the PREVIOUS symbol's (the store is market-independent), so they are parked
     * under `prevSymbol` and the new symbol's document is loaded in their place.
     */
    private onCellMarketSwitched(cell: ChartCell, prevSymbol: string): void {
        if (this.drawingsScope !== 'global') return;
        if (prevSymbol && prevSymbol !== cell.symbol) this.drawingsBySymbol[prevSymbol] = cell.chart.drawings.toJSON();
        cell.chart.drawings.fromJSON(this.drawingsBySymbol[cell.symbol] ?? null);
        this.markStateDirty();
    }

    // ── named layouts ("Save layout as…", "Open layout") ───────────────────────────
    /**
     * The saved snapshots, by name, with the one opened/saved last flagged. Each row also
     * carries what a trader uses to tell two layouts apart at a glance — how many charts
     * and indicators it holds — and whether the ACTIVE one has drifted from its snapshot
     * (TradingView's unsaved-changes dot).
     */
    savedLayoutList(): Array<{ name: string; active: boolean; charts: number; indicators: number; dirty: boolean }> {
        return [...this.savedLayouts.keys()].map((name) => {
            const doc = this.savedLayouts.get(name);
            const cells = doc?.charts ?? [];
            const indicators = cells.reduce((n, c) => n + (c.indicators?.natives?.length ?? 0), 0);
            return {
                name,
                active: name === this.activeSavedLayout,
                charts: cells.length,
                indicators,
                dirty: name === this.activeSavedLayout && this.isActiveLayoutDirty(),
            };
        });
    }

    /**
     * True when the open layout has changed since it was written (nothing to compare
     * before the first save ⇒ false).
     *
     * The revision counter is only a FAST PATH: the workspace marks itself dirty for its
     * own housekeeping too (a market reload after an open, a preference write), and a
     * counter that counts those turns the dot on for changes the user never made.
     * Measured: right after opening a layout the document is byte-identical to its
     * snapshot while the counter has moved twice — so a moved counter is a reason to
     * LOOK, and the document is what answers.
     */
    isActiveLayoutDirty(): boolean {
        const name = this.activeSavedLayout;
        if (name === null) return false;
        if (this.docRevision === this.savedRevision) return false;
        const snapshot = this.savedLayouts.get(name);
        if (!snapshot) return false;
        const now = layoutFingerprint(this.getState());
        const then = this.savedFingerprints.get(name) ?? layoutFingerprint(snapshot);
        this.savedFingerprints.set(name, then);
        if (now === then) {
            // Nothing actually differs — re-sync the fast path so the next read is free.
            this.savedRevision = this.docRevision;
            return false;
        }
        return true;
    }

    /** Whether the open layout is saved as the chart changes (TradingView's Autosave). */
    /** The open saved layout's name — the compact manager's status line. */
    activeLayoutName(): string | null {
        return this.activeSavedLayout;
    }

    /** Sharing is a separate layout preference, not a grid/layout-setup toggle. */
    layoutSharingEnabled(): boolean {
        return this.layoutPrefs.sharing;
    }

    setLayoutSharing(on: boolean): void {
        if (this.layoutPrefs.sharing === on) return;
        this.layoutPrefs.sharing = on;
        this.markStateDirty();
        this.events.emit('layout:prefs', undefined);
        this.syncLayoutChip();
    }

    /** Make a copy of the OPEN layout and open the copy; with none open, name the current
     *  chart as a fresh layout first. TradingView's "Make a copy" never overwrites. */
    makeLayoutCopy(): string | null {
        const current = this.activeSavedLayout;
        if (current) {
            const copy = this.duplicateLayout(current);
            if (copy) this.openLayout(copy);
            return copy;
        }
        let name = 'Layout copy';
        for (let n = 2; this.savedLayouts.has(name); n += 1) name = `Layout copy ${n}`;
        this.saveLayout(name);
        return name;
    }

    /** Rename the OPEN layout, or save an unnamed chart under the typed name. */
    renameActiveLayout(to: string): boolean {
        const name = to.trim();
        if (!name) return false;
        if (!this.activeSavedLayout) {
            if (this.savedLayouts.has(name)) return false;
            this.saveLayout(name);
            return true;
        }
        return this.renameLayout(this.activeSavedLayout, name);
    }

    /** The current workspace URL — exposed to the compact manager only while sharing is on. */
    async currentShareLink(): Promise<string> {
        return this.shareLink();
    }

    async copyCurrentShareLink(): Promise<string | null> {
        if (!this.layoutPrefs.sharing) return null;
        return this.copyShareLink();
    }

    async openWorkspaceLink(url: string): Promise<boolean> {
        if (!url.trim()) return false;
        return this.applyShareLink(url.trim());
    }

    /** Open the compact, anchored Manage layouts menu. */
    openLayoutManager(anchor?: HTMLElement | null): void {
        this.layoutManager ??= new LayoutManagerPanel({
            host: this.root,
            activeName: () => this.activeLayoutName(),
            autosave: () => this.autosaveEnabled(),
            onToggleAutosave: (on) => this.setAutosave(on),
            onMakeCopy: () => this.makeLayoutCopy(),
            onRename: (name) => this.renameActiveLayout(name),
            sharing: () => this.layoutSharingEnabled(),
            onToggleSharing: (on) => this.setLayoutSharing(on),
            shareUrl: () => this.currentShareLink(),
            onCopyLink: () => this.copyCurrentShareLink(),
            onOpenLink: (url) => this.openWorkspaceLink(url),
            savedLayouts: () => this.savedLayoutList(),
            onSaveChanges: () => this.saveActiveLayout(),
            onSaveAs: (name) => { this.saveLayoutWithThumbnail(name); return this.activeLayoutName() === name; },
            onOpenSaved: (name) => this.openLayout(name),
            onRenameSaved: (from, to) => this.renameLayout(from, to),
            onDuplicateSaved: (name) => this.duplicateLayout(name),
            onShareSaved: (name) => this.copyLayoutLink(name),
            onExportSaved: (name) => this.exportLayout(name),
            onDeleteSaved: (name) => this.deleteLayout(name),
            onExportData: () => this.exportChartCsv('all', 'iso'),
            onImportLayout: (json) => this.importLayout(json),
            onOpenDrawingTemplates: () => this.openMoreDrawer('drawings'),
        });
        const fallback = this.layoutCtl.current === 'mobile'
            ? this.root.querySelector<HTMLElement>('.vela-mb-more')
            : this.root.querySelector<HTMLElement>('.vela-widget-layoutname, .vela-widget-layout');
        this.layoutManager.open(anchor ?? fallback ?? this.root);
    }

    /** The separate Indicator templates pane, reached from the topbar or phone More. */
    openIndicatorTemplates(): void {
        if (this.layoutCtl.current === 'mobile') this.topbar.openTemplatesDialog(this.root);
        else this.topbar.openTemplatesMenu();
    }

    autosaveEnabled(): boolean {
        return this.layoutPrefs.autosave;
    }

    /**
     * Turn autosave on/off. Turning it ON writes immediately when a layout is open — the
     * trader flipping the switch is asking for exactly that — and turning it OFF leaves
     * the last write in place (nothing is discarded, it simply stops following).
     */
    setAutosave(on: boolean): void {
        if (this.layoutPrefs.autosave === on) return;
        this.layoutPrefs.autosave = on;
        this.clearAutosave();
        this.markStateDirty();
        if (on && this.activeSavedLayout) this.saveLayout(this.activeSavedLayout, { silent: true });
        this.events.emit('layout:prefs', undefined);
        this.syncLayoutChip();
        this.toast(on ? 'Autosave on — the open layout follows every change' : 'Autosave off — save when you are ready', 'info');
    }

    /** Debounced autosave: a burst of edits (dragging an indicator, resizing panes)
     *  writes ONE snapshot, after the user has settled. */
    private scheduleAutosave(): void {
        if (!this.layoutPrefs.autosave || !this.activeSavedLayout) return;
        // A mark that is not a chart change (a preference write, this save's own bump)
        // must not schedule a write — otherwise autosave chases its own tail.
        if (!this.isActiveLayoutDirty()) return;
        this.clearAutosave();
        this.autosaveTimer = setTimeout(() => {
            this.autosaveTimer = null;
            if (this.destroyed || !this.layoutPrefs.autosave || !this.activeSavedLayout) return;
            this.saveLayout(this.activeSavedLayout, { silent: true });
        }, 1200);
    }

    private clearAutosave(): void {
        if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
    }

    /**
     * Copy a snapshot under "Name copy" (then "Name copy 2"…) — TradingView's "Make a
     * copy". The copy carries the side-car preview too, so the new row is recognisable
     * straight away, and it is NOT opened: a duplicate is an archive action, and yanking
     * the workspace into a copy the trader did not ask to see is a surprise.
     */
    duplicateLayout(name: string): string | null {
        const doc = this.savedLayouts.get(name);
        if (!doc) return null;
        const base = `${name} copy`;
        let copy = base;
        for (let n = 2; this.savedLayouts.has(copy); n += 1) copy = `${base} ${n}`;
        // A snapshot inside a snapshot would double every future save's size.
        const clone = { ...doc } as WorkspaceState;
        delete clone.savedLayouts;
        delete clone.layoutPrefs;
        this.savedLayouts.set(copy, clone);
        // The copy's content is the original's — including its hash (a deep copy would
        // be needed for a shared reference to matter; the arrays are freshly serialized
        // by every getState call, so the clone's own content is what is stored).
        const print = this.savedFingerprints.get(name);
        if (print) this.savedFingerprints.set(copy, print);
        const meta = this.layoutMeta.get(name);
        if (meta) this.layoutMeta.set(copy, { ...meta });
        this.markStateDirty();
        this.syncLayoutChip();
        this.toast(`Layout “${copy}” created`, 'success');
        return copy;
    }

    /** The template new charts start from, by name (null = none). */
    defaultTemplate(): string | null {
        return this.layoutPrefs.defaultTemplate;
    }

    /**
     * The ledger a NEW chart gets from the default template, or undefined when none is
     * set (or it names a template that is gone — the picker's delete already clears a
     * dangling pointer, this is the belt for a state file written by an older build).
     * Shape matches `CellState.indicators`, so it rides the same seed path inheritance
     * uses: the chart resolves it once its manifest is ready.
     */
    private defaultTemplateSeed(): NonNullable<CellState['indicators']> | undefined {
        const name = this.layoutPrefs.defaultTemplate;
        if (!name) return undefined;
        const template = this.templates.get(name);
        if (!template) return undefined;
        return {
            manifest: (template.scripts ?? []).map((s) => ({ ...s })),
            natives: template.indicators.map((e) =>
                (typeof e === 'string' ? { type: e, inputs: {} } : { ...e, inputs: { ...(e.inputs ?? {}) } }) as never,
            ),
        };
    }

    /** Point new charts at a template, or null to stop. */
    setDefaultTemplate(name: string | null): void {
        const next = name && this.templates.has(name) ? name : null;
        if (this.layoutPrefs.defaultTemplate === next) return;
        this.layoutPrefs.defaultTemplate = next;
        this.markStateDirty();
        this.events.emit('layout:prefs', undefined);
        this.toast(next ? `New charts will start with “${next}”` : 'New charts start with no template', 'info');
        this.indicatorPicker?.sync();
    }

    /**
     * Snapshot the WHOLE workspace under `name` (replacing a same-named save).
     * `silent` is autosave: no toast per write, no notification storm while the trader
     * drags a pane divider — the picker's own state is the feedback.
     */
    saveLayout(name: string, opts: { silent?: boolean } = {}): void {
        const trimmed = name.trim();
        if (!trimmed) return;
        // Capture the document BEFORE the bookkeeping below (which bumps the revision).
        const doc = this.getState();
        delete doc.savedLayouts; // a snapshot never embeds the snapshots (no recursion)
        delete doc.layoutPrefs; // …nor the manager's own preferences
        this.savedLayouts.set(trimmed, doc);
        this.savedFingerprints.set(trimmed, layoutFingerprint(doc));
        this.activeSavedLayout = trimmed;
        if (!opts.silent) this.toast(`Layout “${trimmed}” saved`, 'success');
        this.events.emit('layout:saved', { name: trimmed, silent: opts.silent === true });
        // The document itself changed (one more saved snapshot), so this is a real dirty
        // mark — but the OPEN layout now matches the chart, which is what savedRevision
        // measures. Order matters: sync it AFTER the bump or every save leaves the dot on
        // (and autosave would re-save itself forever).
        this.markStateDirty();
        this.savedRevision = this.docRevision;
        // That mark scheduled a write (the revision moved before it was re-synced). The
        // write just happened — drop the timer, or autosave re-saves itself forever.
        this.clearAutosave();
        // Every save stamps its time — including autosave, so the row can say how fresh
        // the snapshot is. A thumbnail, when one was captured, is preserved.
        const prev = this.layoutMeta.get(trimmed) ?? {};
        this.layoutMeta.set(trimmed, { ...prev, savedAt: Date.now() });
        // The chip must lose its dot the instant the write lands, not 350ms later.
        this.syncLayoutChip();
    }

    /**
     * Write the OPEN layout in place — Ctrl/⌘+S's action, and the "Save changes" button
     * beside the unsaved dot. With nothing open there is nothing to overwrite, so it says
     * so instead of silently naming a snapshot after the trader.
     */
    saveActiveLayout(): void {
        if (!this.activeSavedLayout) {
            this.toast('No layout open — use Save as… to name one', 'info');
            return;
        }
        // An open-but-untitled document still has to land somewhere: the picker shows the
        // active name, so this is only reachable for a snapshot that was opened or saved.
        this.saveLayout(this.activeSavedLayout, { silent: false });
    }

    /** Restore a saved snapshot (layout, cells, links, drawings, sizing). */
    openLayout(name: string): void {
        const doc = this.savedLayouts.get(name);
        if (!doc) return;
        this.applyState(doc);
        this.activeSavedLayout = name;
        // applyState reports its own changes; from here the doc matches the snapshot.
        this.savedRevision = this.docRevision;
        this.syncLayoutChip();
        this.toast(`Layout “${name}” opened`, 'info');
    }

    deleteLayout(name: string): void {
        if (!this.savedLayouts.delete(name)) return;
        if (this.activeSavedLayout === name) this.clearAutosave();
        // The side-car goes with the snapshot: a thumbnail or timestamp whose layout is
        // gone is an orphan that would re-appear under a NEW layout saved with the same
        // name — a preview of somebody else's chart.
        this.layoutMeta.delete(name);
        this.savedFingerprints.delete(name);
        if (this.activeSavedLayout === name) this.activeSavedLayout = null;
        this.markStateDirty();
        this.syncLayoutChip();
    }

    /**
     * Rename a snapshot IN PLACE (Map order drives the picker's row order, so the row
     * does not jump). A blank name, the same name, or a name another snapshot already
     * owns is REFUSED — silently overwriting the other one is how a saved layout dies.
     */
    renameLayout(from: string, to: string): boolean {
        const name = to.trim();
        if (!name || name === from) return false;
        const doc = this.savedLayouts.get(from);
        if (!doc || this.savedLayouts.has(name)) return false;
        const rebuilt = new Map<string, WorkspaceState>();
        for (const [key, value] of this.savedLayouts) rebuilt.set(key === from ? name : key, value);
        this.savedLayouts.clear();
        for (const [key, value] of rebuilt) this.savedLayouts.set(key, value);
        if (this.activeSavedLayout === from) this.activeSavedLayout = name;
        // Move the side-car in the same breath. `renameLayout` rebuilds the Map to keep
        // the picker's row order, so metadata keyed by the old name has to follow it —
        // otherwise the renamed row loses its preview and the old name keeps it.
        const meta = this.layoutMeta.get(from);
        if (meta) {
            this.layoutMeta.delete(from);
            this.layoutMeta.set(name, meta);
        }
        const print = this.savedFingerprints.get(from);
        if (print) {
            this.savedFingerprints.delete(from);
            this.savedFingerprints.set(name, print);
        }
        this.markStateDirty();
        this.syncLayoutChip();
        this.toast(`Layout “${from}” renamed to “${name}”`, 'success');
        return true;
    }

    /**
     * Write the ACTIVE cell's bars as CSV and hand the file to the browser. `visible`
     * narrows to the window on screen (the bars the trader is reasoning about); `all`
     * writes everything loaded. Symbols/timeframes come from the cell, not the file, so
     * a 1h BTC export reads `BTCUSD_60_all_bars.csv` and cannot be mistaken for another.
     *
     * Returns the same receipt the sheet shows — rows written and the filename — or null
     * when the cell has no bars yet (an empty export is worse than a refused one).
     */
    exportChartCsv(scope: CsvScope = 'all', timeFormat: CsvTimeFormat = 'iso'): { rows: number; filename: string } | null {
        let cell: ChartCell;
        try {
            cell = this.active;
        } catch {
            return null;
        }
        const chart = cell.chart.renderer;
        const bars = chart.getBars();
        if (!bars || bars.length === 0) return null;
        let visible: { from: number; to: number } | undefined;
        if (scope === 'visible') {
            const vr = chart.getVisibleRange();
            if (!vr) return null;
            // `getVisibleRange` hands back TIMES (data-bounded, so both are real bars). Map
            // them to indices once: the array is ascending by construction.
            const from = bars.findIndex((b) => b.time >= vr.from);
            let to = from;
            for (let i = bars.length - 1; i >= 0; i--) {
                const bar = bars[i];
                if (bar && bar.time <= vr.to) {
                    to = i;
                    break;
                }
            }
            if (from < 0) return null;
            visible = { from, to };
        }
        const file = buildChartCsv({
            bars,
            scope,
            ...(visible ? { visible } : {}),
            symbol: cell.symbol,
            timeframe: cell.timeframe,
            timeFormat,
        });
        if (file.rows === 0) return null;
        downloadText(this.root.ownerDocument, file.filename, file.text, 'text/csv;charset=utf-8');
        this.toast(`${file.rows} bars exported as CSV`, 'success', 2600);
        return { rows: file.rows, filename: file.filename };
    }

    /**
     * One snapshot as portable, versioned JSON — the file a trader keeps beside their
     * notes. `applyState` already treats snapshots as untrusted, so an imported file
     * from another build passes the same sanitizer as a share link.
     */
    exportLayout(name: string): string | null {
        const doc = this.savedLayouts.get(name);
        if (!doc) return null;
        return JSON.stringify({ app: 'vela', kind: 'layout', version: 1, name, state: doc }, null, 2);
    }

    /**
     * Restore a snapshot from {@link exportLayout}'s JSON. Returns the name it landed
     * under (the file's name, or `name (2)`… when that name is taken) or null when the
     * text is not a layout snapshot. It does NOT open the layout — importing is an
     * inbox action; the row appears and the trader clicks it, so a bad file cannot
     * yank the workspace out from under them.
     */
    importLayout(json: string): string | null {
        let raw: unknown;
        try {
            raw = JSON.parse(json);
        } catch {
            return null;
        }
        if (!raw || typeof raw !== 'object') return null;
        const env = raw as { app?: unknown; kind?: unknown; name?: unknown; state?: unknown };
        // Accept a bare state document too (an older hand-rolled file has no envelope) —
        // but never the picker's own `savedLayouts` recursion.
        const state = sanitizeState(env.kind === 'layout' || env.app === 'vela' ? env.state : raw);
        if (!state) return null;
        delete state.savedLayouts;
        const base = (typeof env.name === 'string' && env.name.trim()) || 'Imported layout';
        let name = base;
        for (let n = 2; this.savedLayouts.has(name); n += 1) name = `${base} (${n})`;
        this.savedLayouts.set(name, state);
        this.markStateDirty();
        this.toast(`Layout “${name}” imported`, 'success');
        return name;
    }

    // ── chart templates ("save this indicator set, apply it anywhere") ──────────────
    //
    // Vela's documented template contract (docs.luxalgo.com → Charts → Indicators →
    // Templates): a template is a snapshot of the chart's INDICATORS with their exact
    // settings. Drawings are NOT part of it; drawing objects are removed from indicator
    // panes when a template is applied, which is why the docs tell you to undo quickly.
    // The market is OPT-IN (the symbol/timeframe chips are off by default), and in a
    // multi-chart layout the trader is asked where to apply it: the selected chart, or
    // every chart. That is exactly the surface below — `includeMarket` is the chips, and
    // `target` is the destination question.

    /** The saved templates, in insertion order, with their indicator count. */
    templateList(): Array<{ name: string; count: number; symbol?: string; timeframe?: string }> {
        return [...this.templates].map(([name, t]) => ({
            name,
            count: t.indicators.length + (t.scripts?.length ?? 0),
            ...(t.symbol ? { symbol: t.symbol } : {}),
            ...(t.timeframe ? { timeframe: t.timeframe } : {}),
        }));
    }

    /** Favorite keys for the separate Indicator templates panel's Favorites tab. */
    templateFavoriteList(): string[] {
        return [...this.templateFavs];
    }

    /** Pin/unpin a saved template (`template:<name>`) or built-in (`builtin:<id>`). */
    toggleTemplateFavorite(key: string, on?: boolean): boolean {
        const clean = key.trim();
        if (!clean) return false;
        const next = withFavorite(this.templateFavs, clean, on ?? !this.templateFavs.includes(clean));
        if (next.join('\u0000') === this.templateFavs.join('\u0000')) return false;
        this.templateFavs = next;
        this.markStateDirty();
        this.topbar.refreshTemplatesMenu();
        return true;
    }

    /**
     * Capture the ACTIVE chart's indicator set as `name` (replacing a same-named
     * template — TradingView asks "replace?", the caller owns that prompt).
     * `includeMarket` also stores the symbol/timeframe, so applying the template
     * switches the chart's market; leave it off for a market-agnostic setup.
     */
    /** Every saved drawing template as a flat list (tool key + label, name, swatch color). */
    // ── DRAWING SET templates ───────────────────────────────────────────────────
    /**
     * A real template is a BUNDLE of drawings, not just a tool's saved look. Saving a
     * selection (a group, or a multi-pick) captures every drawing's geometry relative to
     * the set's own left edge and base price, so inserting it on another symbol keeps the
     * shape instead of carrying BTC's absolute prices onto a stock chart.
     */
    drawingSetTemplateList(): Array<{ name: string; count: number; createdAt: number }> {
        return [...this.drawingSets].map(([name, t]) => ({ name, count: t.drawings.length, createdAt: t.createdAt }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    saveDrawingSetTemplate(name: string, ids: readonly string[]): boolean {
        const key = name.trim().slice(0, 40);
        const chart = this.active?.chart;
        if (!key || !chart || ids.length === 0) return false;
        const picked = new Set(ids);
        const docs = chart.drawings.all().filter((d) => picked.has(d.id) && d.anchors.length > 0 && getDrawingType(d.type));
        if (docs.length === 0) return false;
        const times = docs.flatMap((d) => d.anchors.map((a) => a.time));
        const origin = Math.min(...times);
        const end = Math.max(...times);
        const first = docs[0]!.anchors[0]!;
        const basePrice = Number.isFinite(first.price) && first.price !== 0 ? first.price : 1;
        const zs = docs.map((d) => d.zIndex);
        const baseZ = Math.min(...zs);
        const drawings: DrawingSetTemplateDrawing[] = docs.map((d) => ({
            type: d.type,
            paneId: d.paneId,
            anchors: d.anchors.map((a) => ({ dt: a.time - origin, ratio: a.price / basePrice })),
            z: d.zIndex - baseZ,
            visible: d.visible,
            locked: d.locked,
            style: { ...d.style },
            ...(d.text ? { text: { ...d.text } } : {}),
            ...(d.props ? { props: { ...d.props } } : {}),
            ...(d.showOn ? { showOn: [...d.showOn] } : {}),
        }));
        this.drawingSets.set(key, { version: 1, drawings, basePrice, spanMs: Math.max(0, end - origin), createdAt: Date.now() });
        this.markStateDirty();
        this.toast(`Drawing template “${key}” saved (${drawings.length} drawing${drawings.length === 1 ? '' : 's'})`, 'success');
        this.moreDrawer?.refreshLibrary();
        return true;
    }

    /** Insert a saved set at the latest bar, as ONE undo step, then group + select it. */
    insertDrawingSetTemplate(name: string): number {
        const chart = this.active?.chart;
        const tpl = this.drawingSets.get(name);
        if (!chart || !tpl) return 0;
        const last = chart.lastBar;
        const left = (last?.time ?? Date.now()) - tpl.spanMs;
        const price = last?.close ?? tpl.basePrice;
        const paneIds = new Set(chart.panes.list().map((p) => p.id));
        const live = chart.drawings.all();
        const topZ = live.reduce((max, d) => Math.max(max, d.zIndex), 0) + 1;
        const now = Date.now();
        const docs = tpl.drawings.map((d, i) => ({
            id: `tpl-${name}-${i}`,
            type: d.type as SerializedDrawing['type'],
            paneId: paneIds.has(d.paneId) ? d.paneId : 'price',
            anchors: d.anchors.map((a) => ({ time: left + a.dt, price: price * a.ratio })),
            style: { ...d.style } as unknown as SerializedDrawing['style'],
            ...(d.text ? { text: { ...d.text } as unknown as SerializedDrawing['text'] } : {}),
            ...(d.props ? { props: { ...d.props } } : {}),
            ...(d.showOn ? { showOn: [...d.showOn] } : {}),
            visible: d.visible,
            locked: d.locked,
            zIndex: topZ + d.z,
            createdAt: now,
        }));
        const ids = chart.drawings.insertDocuments(docs);
        if (ids.length > 0) {
            this.objectTree.groupInsertedDrawings(name, ids);
            this.markStateDirty();
            this.toast(`“${name}” inserted — ${ids.length} drawing${ids.length === 1 ? '' : 's'}`, 'success');
            this.moreDrawer?.refreshLibrary();
        }
        return ids.length;
    }

    // ── Drawing objects: groups, sync modes, and on-demand layout sync ───────────

    private syncCloneId(cellId: string, sourceId: string): string {
        return `sync-${cellId}-${sourceId}`;
    }

    /** Rows for the object tree's Manage objects dialog. Clones are hidden. */
    drawingSyncRows(): Array<{ id: string; label: string; mode: DrawingSyncMode; charts: string[] }> {
        const chart = this.active?.chart;
        if (!chart) return [];
        return chart.drawings.all()
            .filter((d) => !d.id.startsWith('sync-'))
            .map((d) => {
                const type = getDrawingType(d.type as DrawingTypeKey);
                const entry = this.drawingSyncModes.get(d.id) ?? { mode: this.drawingSyncDefault };
                return {
                    id: d.id,
                    label: type?.label ?? String(d.type),
                    mode: entry.mode,
                    charts: entry.charts ? [...entry.charts] : [],
                };
            });
    }

    /** Every cell that can be a specific sync target. */
    drawingSyncCharts(): Array<{ id: string; label: string; symbol: string; active: boolean }> {
        return this.cells().map((cell) => ({
            id: cell.id,
            label: `${cell.symbol}${cell.id === this.activeId ? ' — active' : ''}`,
            symbol: cell.symbol,
            active: cell.id === this.activeId,
        }));
    }

    drawingSyncMode(id: string): DrawingSyncMode {
        return this.drawingSyncModes.get(id)?.mode ?? this.drawingSyncDefault;
    }

    setDrawingSyncDefault(mode: DrawingSyncMode): void {
        if (mode === 'charts') return;
        this.drawingSyncDefault = mode;
        this.markStateDirty();
        this.objectTree.refresh();
    }

    /** Set the scope for one object, a whole group, or a bulk pick; applying it also
     *  refreshes clones on demand (Task 6). */
    setDrawingSyncMode(ids: readonly string[], mode: DrawingSyncMode, charts?: readonly string[]): void {
        if (mode === 'charts' && (!charts || charts.length === 0)) mode = 'none';
        for (const id of ids) {
            this.drawingSyncModes.set(id, { mode, ...(mode === 'charts' ? { charts: [...(charts ?? [])] } : {}) });
        }
        if (ids.length > 0) {
            this.applyDrawingSync(ids);
            this.markStateDirty();
            this.objectTree.refresh();
        }
    }

    private drawingSyncTargets(entry: DrawingSyncEntry, activeId: string, activeSymbol: string): ChartCell[] {
        const cells = this.cells().filter((cell) => cell.id !== activeId);
        if (entry.mode === 'charts') {
            const ids = new Set(entry.charts ?? []);
            return cells.filter((cell) => ids.has(cell.id));
        }
        // Layout/global sync is meaningful only for the same symbol — TradingView's rule.
        return cells.filter((cell) => cell.symbol === activeSymbol);
    }

    private removeSyncClones(sourceId: string, keep: ReadonlySet<string>): void {
        const clones = this.drawingSyncClones.get(sourceId) ?? new Map<string, string>();
        for (const cell of this.cells()) {
            if (keep.has(cell.id)) continue;
            const cloneId = clones.get(cell.id);
            if (cloneId && cell.chart.drawings.all().some((d) => d.id === cloneId)) {
                // A sync clone is a mirror, not a user edit on the target chart.
                cell.history.silently(() => cell.chart.drawings.removeMany([cloneId]));
            }
            clones.delete(cell.id);
        }
        if (clones.size === 0) this.drawingSyncClones.delete(sourceId);
        else this.drawingSyncClones.set(sourceId, clones);
    }

    /** Push the current source drawings to their targets. Call on demand, not on every edit. */
    applyDrawingSync(ids?: readonly string[]): number {
        const active = this.active;
        if (!active) return 0;
        const sources = new Map(active.chart.drawings.all().map((d) => [d.id, d]));
        const sourceIds = ids && ids.length > 0
            ? [...ids].filter((id) => sources.has(id) && !id.startsWith('sync-'))
            : [...this.drawingSyncModes.keys()].filter((id) => sources.has(id) && !id.startsWith('sync-'));
        let updated = 0;
        for (const sourceId of sourceIds) {
            const source = sources.get(sourceId);
            if (!source) continue;
            const entry = this.drawingSyncModes.get(sourceId) ?? { mode: this.drawingSyncDefault };
            if (entry.mode === 'none') {
                this.removeSyncClones(sourceId, new Set());
                continue;
            }
            const targets = this.drawingSyncTargets(entry, active.id, active.symbol);
            const keep = new Set(targets.map((cell) => cell.id));
            this.removeSyncClones(sourceId, keep);
            const doc = source;
            const clones = this.drawingSyncClones.get(sourceId) ?? new Map<string, string>();
            for (const cell of targets) {
                const oldId = clones.get(cell.id);
                if (oldId && cell.chart.drawings.all().some((d) => d.id === oldId)) {
                    cell.history.silently(() => cell.chart.drawings.removeMany([oldId]));
                }
                // The source owns the history entry; target cells only receive a mirror.
                cell.history.silently(() => {
                    const inserted = cell.chart.drawings.insertDocuments([{
                    ...doc,
                    anchors: doc.anchors.map((a) => ({ ...a })),
                    style: { ...doc.style },
                    id: this.syncCloneId(cell.id, sourceId),
                    paneId: 'price',
                    createdAt: Date.now(),
                }]);
                if (inserted[0]) clones.set(cell.id, inserted[0]);
                else clones.delete(cell.id);
                updated += 1;
                });
            }
            if (clones.size > 0) this.drawingSyncClones.set(sourceId, clones);
            else this.drawingSyncClones.delete(sourceId);
        }
        if (updated > 0) {
            this.markStateDirty();
            this.objectTree.refresh();
        }
        return updated;
    }

    deleteDrawingSetTemplate(name: string): boolean {
        const ok = this.drawingSets.delete(name);
        if (ok) {
            this.markStateDirty();
            this.moreDrawer?.refreshLibrary();
        }
        return ok;
    }

    renameDrawingSetTemplate(from: string, to: string): boolean {
        const key = to.trim().slice(0, 40);
        const tpl = this.drawingSets.get(from);
        if (!key || !tpl || (key !== from && this.drawingSets.has(key))) return false;
        this.drawingSets.delete(from);
        this.drawingSets.set(key, tpl);
        this.markStateDirty();
        this.moreDrawer?.refreshLibrary();
        return true;
    }

    exportDrawingSetTemplate(name: string): string | null {
        const tpl = this.drawingSets.get(name);
        if (!tpl) return null;
        return JSON.stringify({ app: 'vela', kind: 'drawing-set-template', version: 1, name, template: tpl }, null, 2);
    }

    importDrawingSetTemplate(json: string): string | null {
        try {
            const raw = JSON.parse(json) as unknown;
            if (raw == null || typeof raw !== 'object') return null;
            const doc = raw as Record<string, unknown>;
            if (doc.app !== 'vela' || doc.kind !== 'drawing-set-template' || typeof doc.name !== 'string') return null;
            const clean = sanitizeDrawingSetTemplates({ [doc.name]: doc.template });
            const entry = clean ? Object.entries(clean)[0] : null;
            if (!entry) return null;
            const [name, tpl] = entry;
            let key = name.slice(0, 40);
            for (let n = 2; this.drawingSets.has(key); n += 1) key = `${name.slice(0, 36)} ${n}`;
            this.drawingSets.set(key, tpl);
            this.markStateDirty();
            this.moreDrawer?.refreshLibrary();
            return key;
        } catch {
            return null;
        }
    }

    drawingTemplateList(): Array<{ tool: string; toolLabel: string; name: string; color?: string; settings: unknown }> {
        const out: Array<{ tool: string; toolLabel: string; name: string; color?: string; settings: unknown }> = [];
        const map = this.active?.chart.drawings.toolTemplates() ?? {};
        for (const [tool, list] of Object.entries(map)) {
            const label = getDrawingType(tool)?.label ?? tool;
            for (const t of list ?? []) {
                const color = templateColor(t.settings);
                out.push({ tool, toolLabel: label, name: t.name, ...(color ? { color } : {}), settings: t.settings });
            }
        }
        return out.sort((a, b) => a.toolLabel.localeCompare(b.toolLabel) || a.name.localeCompare(b.name));
    }

    /**
     * Use a saved drawing template: it lands on every SELECTED drawing of that tool when
     * there is one (the reference's rule — pick an object, pick a template, it wears it),
     * and otherwise becomes the look the next drawing of the tool starts from.
     */
    useDrawingTemplate(tool: string, name: string): void {
        const chart = this.active?.chart;
        if (!chart) return;
        const d = chart.drawings;
        const list = d.toolTemplates()[tool as keyof ReturnType<typeof d.toolTemplates>] as Array<{ name: string; settings: unknown }> | undefined;
        const tpl = list?.find((t) => t.name === name);
        if (!tpl) return;
        const settings = tpl.settings as { style?: Record<string, unknown>; text?: Record<string, unknown>; props?: Record<string, unknown> };
        const selected = d.selection()
            .map((id) => d.all().find((doc) => doc.id === id))
            .filter((doc): doc is NonNullable<typeof doc> => !!doc && doc.type === tool);
        if (selected.length > 0) {
            // Styles MERGE (update() replaces a style wholesale), so a template that names
            // only a line colour keeps the drawing's width and dash instead of resetting them.
            d.updateMany(
                selected.map((doc) => ({
                    id: doc.id,
                    patch: {
                        ...(settings.style ? { style: { ...doc.style, ...settings.style } } : {}),
                        ...(settings.text ? { text: { ...(doc.text ?? {}), ...settings.text } } : {}),
                        ...(settings.props ? { props: { ...doc.props, ...settings.props } } : {}),
                    } as Partial<SerializedDrawing>,
                })),
            );
            return;
        }
        const next = { ...d.toolDefaults(), [tool]: settings };
        d.setToolDefaults(next as Record<string, unknown>);
        this.toolDefs = { ...d.toolDefaults() };
        this.pushToolDefaults(this.active ?? null); // the shared map other cells inherit from
        this.markStateDirty();
    }

    /** Delete one saved drawing template (per tool, by name). */
    deleteDrawingTemplate(tool: string, name: string): void {
        const chart = this.active?.chart;
        if (!chart) return;
        const map = { ...chart.drawings.toolTemplates() } as Record<string, Array<{ name: string }>>;
        map[tool] = (map[tool] ?? []).filter((t) => t.name !== name);
        if (map[tool]!.length === 0) delete map[tool];
        chart.drawings.setToolTemplates(map);
        this.toolTemplates = { ...chart.drawings.toolTemplates() };
        this.pushToolDefaults(this.active ?? null);
        this.markStateDirty();
    }

    /** One drawing template as pretty JSON (null when it no longer exists). */
    exportDrawingTemplate(tool: string, name: string): string | null {
        const found = this.drawingTemplateList().find((t) => t.tool === tool && t.name === name);
        if (!found) return null;
        return JSON.stringify({ app: 'vela', kind: 'drawing-template', version: 1, tool, name, settings: found.settings }, null, 2);
    }

    /** TradingView's six BUILT-IN templates, read-only and always available. */
    builtinTemplates(): Array<{ id: string; name: string; description: string; count: number; category: 'Technical' | 'Financial' }> {
        return BUILTIN_TEMPLATES.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            count: t.indicators.length,
            category: /volume|flow/i.test(`${t.id} ${t.name}`) ? 'Financial' : 'Technical',
        }));
    }

    /** Apply one built-in — the same REPLACE contract a saved template has. */
    applyBuiltinTemplate(id: string, target: 'active' | 'all' = 'active'): number {
        const builtin = builtinTemplate(id);
        if (!builtin) return 0;
        const ids = target === 'all' ? [...this.cellsById.keys()] : this.activeId ? [this.activeId] : [];
        let changed = 0;
        let orphanedDrawings = false;
        for (const cellId of ids) {
            const cell = this.cellsById.get(cellId);
            if (!cell) continue;
            if (this.templateWouldOrphanDrawings(cell, { version: 1, indicators: builtin.indicators })) {
                orphanedDrawings = true;
                continue;
            }
            cell.applyIndicatorTemplate({ indicators: builtin.indicators });
            changed += 1;
        }
        if (changed > 0) {
            this.markStateDirty();
            this.toast(`“${builtin.name}” applied to ${changed} chart${changed === 1 ? '' : 's'}`, 'success');
        }
        if (orphanedDrawings) this.toast('Template not applied to some charts: move drawings out of indicator panes first.', 'error');
        return changed;
    }

    /** Capture the selected instances, not every instance of the same indicator type. */
    private captureIndicatorTemplate(ids: readonly string[]): ChartTemplate | null {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) return null;
        const byId = new Map(cell.chart.indicators().map((h) => [h.id, h]));
        const indicators: ChartTemplate['indicators'] = [];
        const scripts: NonNullable<ChartTemplate['scripts']> = [];
        for (const id of ids) {
            const h = byId.get(id);
            if (!h) return null;
            const inputs = h.inputValues();
            if (h.nativeType) indicators.push({ type: h.nativeType, inputs, props: h.propValues(), ...(!h.visible ? { hidden: true } : {}) });
            else if (h.source) scripts.push({ name: h.title, source: h.source, inputs, props: h.propValues(), ...(h.language ? { language: h.language } : {}), ...(!h.visible ? { hidden: true } : {}) });
            else return null; // Do not pretend a source-less plugin can be restored.
        }
        if (ids.length === 0) return null;
        return { version: 1, indicators, ...(scripts.length > 0 ? { scripts } : {}) };
    }

    /** Create a template from selected Object Tree rows, or append them to an existing one. */
    saveSelectedIndicatorTemplate(name: string, ids: readonly string[], append = false): boolean {
        const key = name.trim().slice(0, 40);
        const captured = this.captureIndicatorTemplate(ids);
        const old = this.templates.get(key);
        if (!key || !captured || (append ? !old : !!old)) return false;
        const next: ChartTemplate = append && old ? {
            ...old,
            indicators: [...old.indicators, ...captured.indicators],
            ...((old.scripts?.length ?? 0) + (captured.scripts?.length ?? 0) > 0 ? { scripts: [...(old.scripts ?? []), ...(captured.scripts ?? [])] } : {}),
        } : captured;
        this.templates.set(key, next);
        this.markStateDirty();
        this.indicatorPicker?.sync();
        this.toast(`Indicator template “${key}” ${append ? 'updated' : 'saved'}`, 'success');
        return true;
    }

    saveTemplate(name: string, opts: { includeMarket?: boolean } = {}): boolean {
        const key = name.trim().slice(0, 40);
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!key || !cell) return false;
        const ids = cell.chart.indicators().map((h) => h.id);
        const template = this.captureIndicatorTemplate(ids) ?? (ids.length === 0 ? { version: 1 as const, indicators: [] } : null);
        if (!template) return false;
        if (opts.includeMarket) { template.symbol = cell.symbol; template.timeframe = cell.timeframe; }
        this.templates.set(key, template);
        this.markStateDirty();
        this.toast(`Template “${key}” saved (${ids.length} indicator${ids.length === 1 ? '' : 's'})`, 'success');
        this.indicatorPicker?.sync();
        return true;
    }

    /** The template ledger retains matching native handles, but removes other studies.
     * Do not silently orphan a drawing in a pane whose last indicator would disappear. */
    private templateWouldOrphanDrawings(cell: ChartCell, template: ChartTemplate): boolean {
        const wanted = new Map<string, number>();
        for (const entry of template.indicators) {
            const type = typeof entry === 'string' ? entry : entry.type;
            wanted.set(type, (wanted.get(type) ?? 0) + 1);
        }
        const kept = new Set<string>();
        for (const handle of cell.chart.indicators()) {
            const type = handle.nativeType;
            const count = type ? wanted.get(type) ?? 0 : 0;
            if (type && count > 0) { kept.add(handle.id); wanted.set(type, count - 1); }
        }
        const drawingPanes = new Set(cell.chart.drawings.all().map((drawing) => drawing.paneId ?? 'price'));
        return cell.chart.panes.list().some((pane) => pane.id !== 'price' && drawingPanes.has(pane.id)
            && pane.indicators.length > 0 && pane.indicators.every((indicator) => !kept.has(indicator.id)));
    }

    /**
     * Apply a template. `'active'` (default) replaces the active chart's indicators,
     * `'all'` replaces every chart's, and a cell id targets that one slot. Returns the
     * number of charts changed. Applying REPLACES — it never stacks (the documented
     * behaviour), and drawings are untouched by design.
     */
    applyTemplate(name: string, target: 'active' | 'all' | string = 'active'): number {
        const template = this.templates.get(name);
        if (!template) return 0;
        const ids = target === 'all' ? [...this.cellsById.keys()] : target === 'active' ? (this.activeId ? [this.activeId] : []) : [target];
        let changed = 0;
        let missingEngine = false;
        let orphanedDrawings = false;
        for (const id of ids) {
            const cell = this.cellsById.get(id);
            if (!cell) continue;
            // Never remove the chart's current studies only to discover afterwards that
            // a source-backed template cannot run on this chart.
            if ((template.scripts ?? []).some((s) => !cell.chart.hasEngine(s.language))) {
                missingEngine = true;
                continue;
            }
            if (this.templateWouldOrphanDrawings(cell, template)) {
                orphanedDrawings = true;
                continue;
            }
            cell.applyIndicatorTemplate(template);
            // The optional market chips: only when the template carries them, so a
            // market-agnostic template never moves a chart.
            if (template.symbol) cell.setSymbol(template.symbol);
            if (template.timeframe) cell.setTimeframe(template.timeframe);
            changed += 1;
        }
        if (changed > 0) {
            this.markStateDirty();
            this.toast(`Template “${name}” applied to ${changed} chart${changed === 1 ? '' : 's'}`, 'success');
        }
        if (missingEngine) this.toast('Template not applied to some charts: the required scripting engine is unavailable.', 'error');
        if (orphanedDrawings) this.toast('Template not applied to some charts: move drawings out of indicator panes first.', 'error');
        return changed;
    }

    deleteTemplate(name: string): boolean {
        if (!this.templates.delete(name)) return false;
        // A default pointing at a template that no longer exists would apply nothing
        // forever and quietly lie in the picker.
        if (this.layoutPrefs.defaultTemplate === name) {
            this.layoutPrefs.defaultTemplate = null;
            this.events.emit('layout:prefs', undefined);
        }
        this.markStateDirty();
        this.indicatorPicker?.sync();
        return true;
    }

    renameTemplate(from: string, to: string): boolean {
        const name = to.trim().slice(0, 40);
        const template = this.templates.get(from);
        if (!template || !name || name === from || this.templates.has(name)) return false;
        const rebuilt = new Map<string, ChartTemplate>();
        for (const [key, value] of this.templates) rebuilt.set(key === from ? name : key, value);
        this.templates.clear();
        for (const [key, value] of rebuilt) this.templates.set(key, value);
        // The house pointer follows its template — a rename must not silently unset it.
        if (this.layoutPrefs.defaultTemplate === from) {
            this.layoutPrefs.defaultTemplate = name;
            this.events.emit('layout:prefs', undefined);
        }
        this.markStateDirty();
        this.indicatorPicker?.sync();
        return true;
    }

    /** One template as a portable file — the same envelope shape as a layout export. */
    exportTemplate(name: string): string | null {
        const template = this.templates.get(name);
        if (!template) return null;
        return JSON.stringify({ app: 'vela', kind: 'template', version: 1, name, template }, null, 2);
    }

    /** Import a template file. Returns the name it landed under (never overwrites). */
    importTemplate(json: string): string | null {
        let raw: unknown;
        try {
            raw = JSON.parse(json);
        } catch {
            return null;
        }
        if (!raw || typeof raw !== 'object') return null;
        const env = raw as { app?: unknown; kind?: unknown; name?: unknown; template?: unknown };
        const body = env.kind === 'template' ? env.template : raw;
        const probe = sanitizeState({ version: 1, layout: '1', charts: [], templates: { probe: body } });
        const template = probe?.templates?.probe;
        if (!template) return null;
        const base = (typeof env.name === 'string' && env.name.trim()) || 'Imported template';
        let name = base;
        for (let n = 2; this.templates.has(name); n += 1) name = `${base} (${n})`;
        this.templates.set(name, template);
        this.markStateDirty();
        this.toast(`Template “${name}” imported`, 'success');
        this.indicatorPicker?.sync();
        return name;
    }


    //
    // "Save as default" stores one indicator TYPE's settings in the document, so every
    // NEW instance of that type — on any chart, in any layout — opens with them. That is
    // the scope TV uses (a per-chart default would be a different, smaller promise).

    /** Every type that has saved defaults, for host chrome/tests. */
    indicatorDefaultTypes(): string[] {
        return [...this.indicatorDefaults.keys()];
    }

    /** One type's saved defaults (full value bags), or null. */
    indicatorDefault(type: string): { inputs: Record<string, number | string | boolean>; props: Record<string, number | string | boolean> } | null {
        return this.indicatorDefaultsService.get(type);
    }

    /** Save the CURRENT settings of one indicator type as its default. */
    saveIndicatorDefault(type: string, inputs: Record<string, InputValue>, props: Record<string, InputValue> = {}): void {
        const key = type.trim().slice(0, 60);
        if (!key) return;
        const entry: IndicatorDefault = {};
        const inputsBag = primitiveBag(inputs);
        const propsBag = primitiveBag(props);
        if (inputsBag) entry.inputs = inputsBag;
        if (propsBag) entry.props = propsBag;
        if (!entry.inputs && !entry.props) return;
        this.indicatorDefaults.set(key, entry);
        this.markStateDirty();
        this.toast(`Saved as the default for ${key}`, 'success');
    }

    /** Forget one type's saved defaults (new instances fall back to the declaration). */
    clearIndicatorDefault(type: string): boolean {
        if (!this.indicatorDefaults.delete(type)) return false;
        this.markStateDirty();
        return true;
    }

    /** Copy one type's settings onto every instance across every chart. Returns the count
     *  of instances touched — the menu's confirmation reads it back. */
    applyIndicatorSettingsToAll(type: string, inputs: Record<string, InputValue>, props: Record<string, InputValue> = {}): number {
        let touched = 0;
        for (const cell of this.cellsById.values()) touched += cell.applyIndicatorSettingsToType(type, inputs, props);
        if (touched > 0) this.markStateDirty();
        return touched;
    }

    // ── chart-settings templates (TradingView's Settings → Templates) ───────────────
    //
    // What TV's chart settings store is the APPEARANCE: candle and background colours,
    // grid, scales, status line. The market and the indicators belong to a layout (or to
    // a chart/indicator template), so a settings template deliberately carries neither —
    // applying one restyles whatever market the chart is on.
    //
    // The control lives in the chart-settings dialog's footer, where TV puts it; the
    // dialog owns no templates, it asks the shell through `SettingsTemplatesService`.

    /** The saved appearance templates, with `active` true for the one `cellId` wears. */
    appearanceTemplateList(cellId?: string): Array<{ name: string; active: boolean }> {
        const base = this.cellConfig(cellId ?? this.activeId ?? '');
        const baseJson = base ? JSON.stringify(base) : null;
        return [...this.appearanceTemplates].map(([name, config]) => ({
            name,
            active: baseJson !== null && JSON.stringify(config) === baseJson,
        }));
    }

    /** The appearance template `cellId` currently matches, if any (the control's label). */
    appearanceTemplateName(cellId?: string): string | null {
        return this.appearanceTemplateList(cellId).find((row) => row.active)?.name ?? null;
    }

    /** Capture a cell's appearance under `name` (an existing name is replaced). */
    saveAppearanceTemplate(name: string, cellId?: string): boolean {
        const key = name.trim().slice(0, 40);
        const config = this.cellConfig(cellId ?? this.activeId ?? '');
        if (!key || !config) return false;
        this.appearanceTemplates.set(key, config);
        this.markStateDirty();
        this.toast(`Template “${key}” saved`, 'success');
        return true;
    }

    /** Apply an appearance template to one cell (`'all'` restyles every chart). */
    applyAppearanceTemplate(name: string, target: 'all' | string = 'active'): number {
        const config = this.appearanceTemplates.get(name);
        if (!config) return 0;
        const ids = target === 'all' ? [...this.cellsById.keys()] : [target === 'active' ? (this.activeId ?? '') : target];
        let changed = 0;
        for (const id of ids) {
            const cell = this.cellsById.get(id);
            if (!cell) continue;
            cell.chart.renderer.applyConfig(config);
            changed += 1;
        }
        if (changed > 0) {
            this.markStateDirty();
            this.toast(`Template “${name}” applied to ${changed} chart${changed === 1 ? '' : 's'}`, 'success');
        }
        return changed;
    }

    deleteAppearanceTemplate(name: string): boolean {
        if (!this.appearanceTemplates.delete(name)) return false;
        // A house pointer at a template that no longer exists would promise a look that
        // can never arrive.
        if (this.layoutPrefs.defaultAppearance === name) {
            this.layoutPrefs.defaultAppearance = null;
            this.events.emit('layout:prefs', undefined);
        }
        this.markStateDirty();
        return true;
    }

    /** The appearance template NEW charts open with (null = the factory look). */
    defaultAppearanceTemplate(): string | null {
        return this.layoutPrefs.defaultAppearance;
    }

    setDefaultAppearanceTemplate(name: string | null): void {
        const next = name && this.appearanceTemplates.has(name) ? name : null;
        if (this.layoutPrefs.defaultAppearance === next) return;
        this.layoutPrefs.defaultAppearance = next;
        this.events.emit('layout:prefs', undefined);
        this.markStateDirty();
    }

    /** A cell's live appearance document (null when the renderer has no rich config). */
    private cellConfig(cellId: string): Record<string, unknown> | null {
        const cell = this.cellsById.get(cellId);
        if (!cell) return null;
        const config = cell.chart.renderer.getConfig() as unknown;
        return config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : null;
    }

    /** The house appearance's config, for a chart that is about to be born. */
    private houseAppearance(): Record<string, unknown> | undefined {
        const name = this.layoutPrefs.defaultAppearance;
        return name ? this.appearanceTemplates.get(name) : undefined;
    }

    // ── watchlist + batch symbols ────────────────────────────────────────────────────
    /** Symbols the quick wheel walks: the saved watchlist, or the provider's first symbols
     *  when no watchlist exists. Always contains the ACTIVE symbol, so a scan can start
     *  from the chart the user is already on. */
    quickSymbolList(): string[] {
        const out: string[] = [];
        const push = (symbol: string) => {
            const s = String(symbol || '').trim();
            if (!s) return;
            const key = canonicalTicker(s);
            if (key && !out.some((x) => canonicalTicker(x) === key)) out.push(s);
        };
        for (const symbol of this.watchlist) push(symbol);
        if (out.length < 2) {
            for (const d of this.feed.symbols().slice(0, 32)) {
                // A GROUP row is not a loadable chart; its default member is.
                if (d.group && !d.default) continue;
                const venue = d.prefix ?? d.provider;
                push(venue ? `${venue}:${d.ticker}` : d.ticker);
            }
        }
        const current = this.active?.symbol;
        if (current) {
            const i = out.findIndex((s) => canonicalTicker(s) === canonicalTicker(current));
            if (i < 0) out.unshift(current);
        }
        return out;
    }

    /** Watchlist-style next/previous symbol WITHOUT opening the picker. */
    stepQuickSymbol(delta: number): string | null {
        const chart = this.active;
        if (!chart || !Number.isFinite(delta) || delta === 0) return null;
        const list = this.quickSymbolList();
        if (list.length < 2) return null;
        const current = canonicalTicker(chart.symbol);
        let index = list.findIndex((s) => canonicalTicker(s) === current);
        if (index < 0) index = 0;
        const step = Math.sign(delta);
        const next = list[(index + step + list.length) % list.length]!;
        chart.setSymbol(next);
        return next;
    }

    /** The watchlist, in display order. */
    watchlistSymbols(): string[] {
        return [...this.watchlist];
    }

    /** Add a symbol (canonical or bare) to the watchlist. False when it is already on it. */
    addToWatchlist(symbol: string): boolean {
        const s = symbol.trim();
        if (!s || this.watchlist.includes(s)) return false;
        this.watchlist.push(s);
        this.markStateDirty();
        return true;
    }

    removeFromWatchlist(symbol: string): boolean {
        const i = this.watchlist.indexOf(symbol);
        if (i < 0) return false;
        this.watchlist.splice(i, 1);
        this.markStateDirty();
        return true;
    }

    /**
     * Put ONE symbol on EVERY chart — the multi-chart answer to "I want all four on
     * BTC". Returns how many charts took it. With the Symbol link ON the group would
     * have copied the next edit anyway; this is the explicit, one-step version, and it
     * works when the link is off.
     */
    setSymbolForAll(symbol: string): number {
        const s = symbol.trim();
        if (!s) return 0;
        let changed = 0;
        for (const cell of this.cellsById.values()) {
            if (cell.symbol === s) continue;
            cell.setSymbol(s);
            changed += 1;
        }
        if (changed > 0) {
            this.markStateDirty();
            this.toast(`${s} on ${changed} chart${changed === 1 ? '' : 's'}`, 'info');
        }
        if (!this.watchlist.includes(s)) this.addToWatchlist(s);
        return changed;
    }

    // ── group names + legend ────────────────────────────────────────────────────────
    /** The user's name for a group (undefined = unnamed). */
    groupName(id: string): string | undefined {
        return this.groupNames[id];
    }

    /** Name a group, or clear the name with `null`. Keyed by the STABLE id, so the
     *  name survives a palette change; the emoji is only what the legend paints. */
    setGroupName(id: string, name: string | null): void {
        const trimmed = name?.trim().slice(0, 24) ?? '';
        if (trimmed) this.groupNames[id] = trimmed;
        else delete this.groupNames[id];
        this.markStateDirty();
        this.projectGroupMarks();
    }

    /** The glyph a group currently paints (the user's override, else the palette's). */
    groupMark(id: string): string | undefined {
        return groupMarkOf(id);
    }

    /**
     * Repaint a group's glyph. `null` restores the palette mark. Bounded to two graphemes
     * — a chip is 14px wide and a legend row is one word — and stored by STABLE id, so it
     * survives reloads, imports and layout changes without touching propagation.
     */
    setGroupMark(id: string, glyph: string | null): void {
        const key = groupIdOf(id) ?? id;
        const clean = glyph ? [...glyph.trim()].slice(0, 2).join('') : '';
        if (clean && clean !== groupDef(key)?.mark) this.groupMarks[key] = clean;
        else delete this.groupMarks[key];
        setMarkOverrides(this.groupMarks);
        this.projectGroupMarks();
        this.markStateDirty();
    }

    /**
     * The groups actually in use, one entry per group, with the user's name and how many
     * charts wear it. This is what the legend beside the matrix renders — the table says
     * WHICH chart, the legend says WHAT the group is for.
     */
    groupLegend(): Array<{ id: string; mark: string; color?: string; name: string; count: number }> {
        const seen = new Map<string, number>();
        for (const kind of SYNC_KINDS) {
            const setting = this.syncOpts[kind];
            if (setting == null || setting === false) continue;
            for (const cellId of this.cellsById.keys()) {
                const id = groupOf(setting, cellId);
                if (!id) continue;
                seen.set(id, (seen.get(id) ?? 0) + 1);
            }
        }
        return [...seen].map(([id, count]) => {
            const def = groupDef(id);
            return {
                id,
                // The USER's glyph wins over the palette one; both the chip and the legend
                // read it through the same registry, so a repaint happens in one place.
                mark: groupMarkOf(id) ?? id,
                ...(def ? { color: def.color } : {}),
                name: this.groupNames[id] ?? groupNameOf(id) ?? def?.name ?? id,
                count,
            };
        });
    }

    // Retain the persisted seen-tip API for older saved workspaces. The automatic
    // coach mark was removed so it cannot cover the chart uninvited.
    hasSeenTip(id: string): boolean {
        return this.seenTips.has(id);
    }

    markTipSeen(id: string): void {
        if (this.seenTips.has(id)) return;
        this.seenTips.add(id);
        this.markStateDirty();
    }

    // ── snapshot previews ───────────────────────────────────────────────────────────
    /**
     * A small JPEG of the CURRENT grid, for a saved-layout row. Built by blitting each
     * cell's own raster onto one small canvas — no async image decode, so it also works
     * the instant a cell has painted. Null when nothing has painted yet (the row then
     * simply shows no preview rather than an empty box).
     */
    captureThumbnail(maxWidth = 260): string | null {
        if (this.destroyed) return null;
        const cells = this.shotCells();
        if (cells.length === 0) return null;
        const gridRect = this.gridEl.getBoundingClientRect();
        if (!(gridRect.width > 0 && gridRect.height > 0)) return null;
        const doc = this.root.ownerDocument;
        const scale = Math.min(1, maxWidth / gridRect.width);
        const out = doc.createElement('canvas');
        out.width = Math.max(1, Math.round(gridRect.width * scale));
        out.height = Math.max(1, Math.round(gridRect.height * scale));
        const ctx = out.getContext?.('2d');
        if (!ctx) return null;
        const win = doc.defaultView;
        ctx.fillStyle = (win ? win.getComputedStyle(this.gridEl).backgroundColor : '') || '#000000';
        ctx.fillRect(0, 0, out.width, out.height);
        let painted = 0;
        for (const cell of cells) {
            const source = cell.screenshotCanvas();
            if (!source) continue;
            const r = cell.host.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) continue;
            ctx.drawImage(source as CanvasImageSource, (r.left - gridRect.left) * scale, (r.top - gridRect.top) * scale, r.width * scale, r.height * scale);
            painted += 1;
        }
        if (painted === 0) return null;
        try {
            return out.toDataURL('image/jpeg', 0.6);
        } catch {
            return null; // tainted canvas / no encoder — a preview is never worth a throw
        }
    }

    /**
     * Save a snapshot WITH its preview. The thumbnail is best-effort: a save never fails
     * because a chart has not painted yet. Previews are capped (the OLDEST drop first)
     * so twelve layouts cannot eat the storage budget with pictures.
     */
    saveLayoutWithThumbnail(name: string, maxWidth = 260): boolean {
        // Trim FIRST: a blank name must not leave a side-car behind for a snapshot the
        // save itself refuses (`saveLayout` returns silently on '').
        const key = name.trim();
        if (!key) return false;
        const thumb = this.captureThumbnail(maxWidth);
        this.saveLayout(key);
        const prev = this.layoutMeta.get(key) ?? {};
        this.layoutMeta.set(key, { ...prev, savedAt: Date.now(), ...(thumb ? { thumb } : {}) });
        this.pruneThumbs();
        this.markStateDirty();
        return Boolean(thumb);
    }

    /** The preview JPEG of a saved layout, when one exists. */
    layoutThumb(name: string): string | null {
        return this.layoutMeta.get(name)?.thumb ?? null;
    }

    /** When a snapshot was written (ms), for the row's "saved 2h ago" line. */
    layoutSavedAt(name: string): number | null {
        return this.layoutMeta.get(name)?.savedAt ?? null;
    }

    private pruneThumbs(): void {
        const withThumb = [...this.layoutMeta].filter(([, m]) => m.thumb);
        if (withThumb.length <= 12) return;
        withThumb.sort((a, b) => (a[1].savedAt ?? 0) - (b[1].savedAt ?? 0));
        for (const [name] of withThumb.slice(0, withThumb.length - 12)) {
            const meta = this.layoutMeta.get(name);
            if (!meta) continue;
            const { thumb: _drop, ...rest } = meta;
            this.layoutMeta.set(name, rest);
        }
    }

    // ── tab linking (TradingView Desktop's colored tab link) ───────────────────────
    /** Join / leave a link tag; linked workspaces mirror their ACTIVE cell's market. */
    setLinkGroup(tag: string | null): void {
        this.linkGroup = tag || null;
        this.link.setTag(this.linkGroup);
        if (this.linkGroup) this.broadcastLink(); // seed the peers with our current market
        this.markStateDirty();
        this.layoutSetup?.refresh();
    }

    /** Broadcast this workspace's active market + range to peers on the same tag. */
    private broadcastLink(): void {
        if (!this.linkGroup || !this.activeId) return;
        const cell = this.cellsById.get(this.activeId);
        if (!cell) return;
        // An echo of what a peer just applied: swallow it (the peers already have it) —
        // see `linkInbox` for why content, not a flag, is the guard.
        const inbox = this.linkInbox;
        if (inbox && (!inbox.symbol || inbox.symbol === cell.symbol) && (!inbox.timeframe || inbox.timeframe === cell.timeframe)) {
            this.linkInbox = null;
            return;
        }
        const range = cell.chart.getVisibleRange();
        this.link.send({ symbol: cell.symbol, timeframe: cell.timeframe, ...(range ? { range } : {}) });
    }

    /** Apply a peer's linked change to THIS workspace's active cell. */
    private applyLinked(market: { symbol?: string; timeframe?: string; range?: { from: number; to: number } }): void {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell || this.linkApplying) return;
        this.linkApplying = true;
        try {
            this.linkInbox = { ...(market.symbol ? { symbol: market.symbol } : {}), ...(market.timeframe ? { timeframe: market.timeframe } : {}) };
            if (market.symbol && market.symbol !== cell.symbol) cell.setSymbol(market.symbol);
            if (market.timeframe && market.timeframe !== cell.timeframe) cell.setTimeframe(market.timeframe);
            if (market.range) cell.chart.setVisibleRange(market.range);
        } finally {
            this.linkApplying = false;
        }
    }

    // ── click-to-align (the `time` link) ───────────────────────────────────────────
    /**
     * Bring the clicked instant into view on the origin's same-group followers WITHOUT
     * touching their span — TradingView's "Time" sync, the light sibling of the range
     * link: every chart keeps its own zoom and simply re-centers on the same moment.
     */
    /** Public form of the click-to-align move (the same path the renderer's click takes)
     *  — hosts driving a keyboard/menu "go to this time" use it too. */
    alignTimeAt(originId: string, timeMs: number | null): void {
        if (!this.cellsById.has(originId)) return;
        this.propagateTime(originId, timeMs);
    }

    private propagateTime(originId: string, timeMs: number | null): void {
        if (this.destroyed || this.timeBusy || timeMs == null) return;
        const targets = syncTargets(originId, this.syncOpts.time, [...this.cellsById.keys()]);
        if (targets.length === 0) return;
        this.timeBusy = true;
        this.syncBusy = true; // the followers' viewport echoes are this call's own doing
        try {
            for (const id of targets) {
                const cell = this.cellsById.get(id);
                const range = cell?.chart.getVisibleRange();
                const next = range ? alignedRangeAround(range, timeMs) : null;
                if (cell && next) cell.chart.setVisibleRange(next);
            }
        } finally {
            this.syncBusy = false;
            this.timeBusy = false;
        }
    }

    // ── per-chart timezone ─────────────────────────────────────────────────────────
    /** Set (or clear) ONE chart's timezone. The workspace default stays as it was. */
    setCellTimezone(cellId: string, zone: string | null): void {
        const cell = this.cellsById.get(cellId);
        if (!cell) return;
        cell.setTimezone(zone);
        this.projectTimezone();
        this.markStateDirty();
    }

    /** How many dormant (pooled) charts the smaller layouts left behind. */
    get hiddenChartCount(): number {
        return this.pool.size;
    }

    /**
     * The hidden charts by NAME — the list behind More → *Hidden charts*. A count tells a
     * trader that something is waiting; a ticker tells them WHICH market is waiting, and
     * that is the difference between a number and a door.
     */
    hiddenChartList(): Array<{ id: string; symbol: string; timeframe: string; indicators: number }> {
        const label = (raw: string): string => (raw ? (this.feed.resolveSymbol(raw)?.ticker ?? raw.split(':').pop() ?? raw) : '');
        return [...this.pool.entries()].map(([id, cs]) => ({
            id,
            symbol: label(cs.symbol ?? ''),
            timeframe: timeframeLabel(cs.timeframe ?? ''),
            indicators: (cs.indicators?.manifest?.length ?? 0) + (cs.indicators?.natives?.length ?? 0),
        }));
    }

    /**
     * Bring a HIDDEN chart back onto the grid: it takes the ACTIVE pane, and the chart
     * that was there goes into the pool in its place — the same trade `setLayout` makes
     * when it shrinks, done one chart at a time. The chart returns as itself (its own
     * market, interval, indicators, drawings and alerts survive, because a pooled chart
     * is a document, not a stub).
     */
    showHiddenChart(id: string): boolean {
        if (this.destroyed) return false;
        if (this.cellsById.has(id)) {
            this.setActiveCell(id);
            return true;
        }
        const state = this.pool.get(id);
        if (!state) return false;
        const outgoing = this.activeId;
        const slot = outgoing ? this.order.indexOf(outgoing) : -1;
        if (!outgoing || slot < 0) return false;
        // Everything alive before the swap: the returning chart is not a newborn, so the
        // newborn-alignment passes below must leave its market/style/drawings alone.
        const preexisting = new Set([...this.cellsById.keys(), ...this.pool.keys()]);
        const indicatorLinks = this.indicatorLiveSync.snapshot();
        this.indicatorLiveSync.clear();
        const leaving = this.cellsById.get(outgoing);
        // Take the returning chart's state OUT while the outgoing one is parked: `poolSet`
        // trims the pool at the ceiling by eviction order, and the chart the user just
        // asked for must not be the one evicted. It goes back in (newest) before the build
        // reads it — `buildCells` hydrates a slot from the pool, so an absent entry would
        // quietly mint a NEW chart with the boot defaults instead (the worst kind of bug:
        // the right tab, the wrong market).
        this.pool.delete(id);
        if (leaving) {
            this.cellsById.delete(outgoing);
            this.events.emit('cell:destroyed', { id: outgoing });
            const pooled = leaving.dehydrate();
            pooled.objectTreeGroups = this.objectTree.groupsFor(leaving.chart);
            this.pool.set(outgoing, pooled);
            leaving.destroy();
        }
        this.pool.set(id, state); // newest, about to be consumed by the slot
        // The two identities trade PLACES in the order, so neither loses its position and
        // the grid keeps its shape (no layout change, exactly like a tab switch).
        const home = this.order.indexOf(id);
        if (home >= 0 && home !== slot) this.order[home] = outgoing;
        else if (home < 0) this.order.push(outgoing);
        this.order[slot] = id;
        this.buildCells(); // hydrates `id` from the pool it just left
        this.indicatorLiveSync.restore(indicatorLinks);
        this.indicatorLiveSync.reconcileLayout();
        this.alignNewCellMarket(preexisting);
        this.alignNewCellStyles(preexisting);
        this.alignNewCellDrawings(preexisting);
        this.syncCellPresentation();
        this.refreshCellControls();
        this.setActiveCell(id);
        this.refreshRetention();
        this.syncMobileHidden();
        this.markStateDirty();
        return true;
    }

    /** Re-project the phone bar's hidden-chart badge (More → Hidden charts). */
    private syncMobileHidden(): void {
        this.mobileBar?.setHiddenCount(this.hiddenChartCount);
        this.layoutSetup?.refresh();
    }

    /**
     * Forget every dormant (pooled) chart — the "remove hidden charts" housekeeping.
     * It REPLACES the previous batch's undo snapshot, so Undo always brings back the
     * batch that was just dropped (one level, the same contract as a toast's Undo).
     */
    clearPooled(): number {
        const n = this.pool.size;
        if (n === 0) return 0;
        this.pooledCleared = new Map(this.pool);
        this.pool.clear();
        this.syncMobileHidden();
        this.refreshRetention();
        this.markStateDirty();
        this.toast(`Removed ${n} hidden chart${n === 1 ? '' : 's'} — Undo in the layout menu`, 'info');
        return n;
    }

    /** How many dormant charts the last {@link clearPooled} dropped (0 = nothing to undo). */
    get clearedChartCount(): number {
        return this.pooledCleared?.size ?? 0;
    }

    /** Put the last cleared batch back into the pool (the housekeeping row's Undo). */
    restorePooled(): number {
        const saved = this.pooledCleared;
        if (!saved) return 0;
        this.pooledCleared = null;
        for (const [id, state] of saved) this.pool.set(id, state);
        // Respect the cap without evicting a just-restored slot first-in-last-out.
        while (this.pool.size > POOL_CAP) {
            const oldest = this.pool.keys().next().value;
            if (oldest == null) break;
            this.pool.delete(oldest);
            this.notePoolDrop();
        }
        this.syncMobileHidden();
        this.refreshRetention();
        this.markStateDirty();
        this.toast(`Restored ${saved.size} hidden chart${saved.size === 1 ? '' : 's'}`, 'success');
        return saved.size;
    }

    /**
     * The indicator ledger a NEW chart inherits from the existing grid: the ACTIVE cell's
     * when it survives the switch, else the first live cell's. Undefined on the initial
     * build (nothing to inherit) and whenever `inheritIndicators` is off.
     */
    private inheritLedger(newId: string): NonNullable<CellState['indicators']> | undefined {
        const candidates = [...this.cellsById.values()].filter((c) => c.id !== newId);
        if (candidates.length === 0) return undefined;
        const source = candidates.find((c) => c.id === this.activeId) ?? candidates[0];
        return source?.indicatorLedger();
    }

    /**
     * Bring cells minted by a layout change into their MARKET group: with the symbol or
     * interval link on in its all-cells form (`true` — the shape the dropdown switches
     * set), a NEW cell (fresh slot, or one returning from the pool that missed edits
     * while dormant) adopts a pre-existing group peer's market instead of booting on
     * the workspace defaults beside a linked grid — the market twin of
     * {@link alignNewCellStyles}. Propagation runs FROM the peer, so a newborn's
     * defaults never overwrite the group, and the setters' equality short-circuits
     * keep a converged grid untouched.
     *
     * Group RECORDS (`{cellId: group}`) are left alone: a newborn has no entry in the
     * record, so there is no group for it to join — a host that wants a newborn inside
     * a group assigns it (the dropdown switches cannot express groups anyway).
     */
    private alignNewCellMarket(preexisting: ReadonlySet<string>): void {
        if (this.syncOpts.symbol !== true && this.syncOpts.timeframe !== true) return;
        const elders = [...this.cellsById.keys()].filter((id) => preexisting.has(id));
        if (elders.length === 0) return; // an all-new grid has no source to inherit from
        const sourceId = this.activeId && elders.includes(this.activeId) ? this.activeId : elders[0]!;
        this.propagateMarket(sourceId);
    }

    /**
     * Align cells minted by a layout change to their style group: with the link on, a
     * NEW cell (fresh slot or one returning from the pool, which missed edits while
     * dormant) inherits the presentation of a pre-existing group peer — the active
     * cell when it is one — instead of sitting on its own state beside a styled
     * group. Propagation runs FROM the peer, so a newborn's defaults never overwrite
     * the group, and the equality short-circuits keep converged peers untouched.
     */
    private alignNewCellStyles(preexisting: ReadonlySet<string>): void {
        const setting = this.syncOpts.style;
        if (!setting) return;
        const ids = [...this.cellsById.keys()];
        const propagated = new Set<string>();
        for (const id of ids) {
            if (preexisting.has(id)) continue;
            const peers = syncTargets(id, setting, ids).filter((p) => preexisting.has(p));
            if (peers.length === 0) continue; // an unlinked or all-new group has no source to inherit
            const source = this.activeId && peers.includes(this.activeId) ? this.activeId : peers[0]!;
            if (propagated.has(source)) continue; // one propagation already covered this group
            propagated.add(source);
            this.propagateStylePrefs(source);
        }
    }

    /**
     * Bring cells minted by a layout change into their drawings group: with the link
     * on, a NEW cell (fresh slot, or one returning from the pool that missed edits
     * while dormant) receives the drawings of a pre-existing group peer — the active
     * cell when it is one. A drawing the arriving cell already holds a linked copy of
     * is refreshed in place; any other is copied and linked like a freshly synced
     * drawing, so later edits and removals follow both ways. The arrival is the cell's
     * starting state, not an edit: it stays out of the cell's undo timeline, and the
     * busy guard keeps the copies' own events from fanning back out.
     */
    private alignNewCellDrawings(preexisting: ReadonlySet<string>): void {
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        const ids = [...this.cellsById.keys()];
        for (const id of ids) {
            if (preexisting.has(id)) continue;
            const cell = this.cellsById.get(id);
            if (!cell?.chart.drawings.supported) continue;
            const peers = syncTargets(id, setting, ids).filter((p) => preexisting.has(p));
            if (peers.length === 0) continue; // an unlinked or all-new group has no source to inherit
            const sourceId = this.activeId && peers.includes(this.activeId) ? this.activeId : peers[0]!;
            const source = this.cellsById.get(sourceId);
            if (!source) continue;
            const drawings = cell.chart.drawings;
            this.drawingSyncBusy = true;
            try {
                cell.history.silently(() => {
                    const held = new Set(drawings.all().map((d) => d.id));
                    for (const doc of source.chart.drawings.all()) {
                        const group = this.drawingLinks.get(`${sourceId}\u0000${doc.id}`) ?? new Map([[sourceId, doc.id]]);
                        const peerId = group.get(id);
                        if (peerId != null && held.has(peerId)) {
                            drawings.update(peerId, { anchors: doc.anchors, style: doc.style, text: doc.text, props: doc.props });
                            continue;
                        }
                        const copy = drawings.add(doc.type, {
                            paneId: doc.paneId,
                            anchors: doc.anchors,
                            style: doc.style,
                            text: doc.text,
                            props: doc.props,
                            zIndex: doc.zIndex,
                        });
                        if (!copy) continue;
                        if (peerId != null) this.drawingLinks.delete(`${id}\u0000${peerId}`);
                        group.set(id, copy.id);
                        for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\u0000${dId}`, group);
                    }
                });
            } finally {
                this.drawingSyncBusy = false;
            }
        }
    }

    /**
     * Mirror an origin cell's presentation — the style-link slice of its renderer
     * config ({@link styleConfigPatch}) plus its Status line and watermark prefs —
     * onto its same-group followers (the style link). Loop-safe two ways: the busy
     * guard eats the followers' SYNCHRONOUS echoes (their `applyConfig` re-fires
     * `onConfigChanged` in the same tick), and the equality short-circuits leave
     * already-converged followers untouched, so nothing re-emits once the group agrees.
     */
    private propagateStylePrefs(originId: string): void {
        if (this.styleSyncBusy || this.destroyed) return;
        const targets = syncTargets(originId, this.syncOpts.style, [...this.cellsById.keys()]);
        if (targets.length === 0) return;
        const origin = this.cellsById.get(originId);
        if (!origin) return;
        // A renderer without the config port yields no patch — the cell prefs still mirror.
        const config = origin.chart.renderer.getConfig();
        const prefs = origin.statusPrefs();
        this.styleSyncBusy = true;
        try {
            for (const id of targets) {
                const cell = this.cellsById.get(id);
                if (!cell) continue;
                const patch = styleConfigPatch(config, cell.chart.renderer.getConfig());
                if (patch) cell.chart.renderer.applyConfig(patch);
                cell.applyStatusPrefs(prefs);
            }
        } finally {
            this.styleSyncBusy = false;
        }
    }

    /**
     * Mirror an origin cell's pointer time onto its same-group followers as GHOST
     * crosshairs (`renderer.setExternalCrosshair`). The horizontal price level rides
     * along ONLY to followers showing the same ticker — price scales are comparable
     * there, while an origin's price painted on another market's pane would be noise.
     * Leaving the origin propagates `null` (the event already carries it) and clears
     * every ghost. No busy guard needed: an external crosshair never re-emits
     * `onCrosshairMove` — the flow is one-way by port contract, so no echo loop can
     * exist.
     */
    private propagateCrosshair(originId: string, time: number | null, price: number | null = null): void {
        if (this.destroyed) return;
        const setting = this.syncOpts.crosshair;
        if (!setting) return;
        const originTicker = parseSymbol(this.cellsById.get(originId)?.symbol ?? '').ticker;
        for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
            const follower = this.cellsById.get(id);
            if (!follower) continue;
            const comparable = originTicker !== '' && parseSymbol(follower.symbol).ticker === originTicker;
            follower.chart.renderer.setExternalCrosshair(time, comparable ? price : null);
            // The readout half: the follower's status line shows ITS values at the
            // leader's instant, including when its own feed later loads or updates.
            follower.setSyncedCrosshairAt(time);
        }
    }

    /**
     * Push an origin cell's visible range onto its same-group followers. Loop-safe two
     * ways: the busy guard eats the followers' SYNCHRONOUS echoes (their setVisibleRange
     * re-emits `viewport:changed` in the same tick), and the half-bar epsilon
     * short-circuits any async residue — a follower already within half of ITS OWN bar
     * interval is left alone, so cross-timeframe groups settle instead of oscillating.
     */
    private propagateViewport(originId: string, range: { from: number; to: number }): void {
        if (this.syncBusy || this.destroyed) return;
        const targets = syncTargets(originId, this.syncOpts.viewport, [...this.cellsById.keys()]);
        if (targets.length === 0) return;
        this.syncBusy = true;
        try {
            for (const id of targets) {
                const cell = this.cellsById.get(id);
                if (!cell) continue;
                const current = cell.chart.getVisibleRange();
                const tfMs = timeframeToMs(cell.timeframe);
                const eps = Number.isFinite(tfMs) ? tfMs / 2 : 0;
                if (current && rangesWithin(current, range, eps)) continue;
                cell.chart.setVisibleRange(range);
            }
        } finally {
            this.syncBusy = false;
        }
    }

    /**
     * Copy a freshly created drawing onto the origin's same-group followers (fresh ids
     * through `drawings.add` — anchors are time+price, so the copy lands at the same
     * spot whatever the follower shows) and register the whole set as LINKED: edits
     * and removals of any member follow while the link is on ({@link drawingLinks}).
     * The busy guard stops the copies' own `drawing:created` events from fanning out.
     */
    private propagateDrawing(originId: string, drawingId: string): void {
        if (this.drawingSyncBusy || this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
        if (!doc) return;
        this.drawingSyncBusy = true;
        try {
            const group = new Map([[originId, drawingId]]);
            for (const id of this.drawingTargets(originId, setting)) {
                const copy = this.cellsById.get(id)?.chart.drawings.add(doc.type, {
                    paneId: doc.paneId,
                    anchors: doc.anchors,
                    style: doc.style,
                    text: doc.text,
                    props: doc.props,
                });
                if (copy) group.set(id, copy.id);
            }
            if (group.size > 1) {
                for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\u0000${dId}`, group);
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /**
     * The cells a drawing follows: the link's group, minus — unless the host widened it —
     * every chart on a DIFFERENT symbol. TradingView's rule: a BTC trend line means
     * nothing on an ETH chart, so the default never paints one there.
     */
    private drawingTargets(originId: string, setting: SyncSetting): string[] {
        const targets = syncTargets(originId, setting, [...this.cellsById.keys()]);
        if (!this.drawingsSameSymbol) return targets;
        const origin = parseSymbol(this.cellsById.get(originId)?.symbol ?? '').ticker;
        // An empty ticker means "no market yet" (boot, offline host) — nothing to compare,
        // so those cells keep following rather than silently dropping out of the link.
        if (origin === '') return targets;
        return targets.filter((id) => {
            const ticker = parseSymbol(this.cellsById.get(id)?.symbol ?? '').ticker;
            return ticker === '' || ticker === origin;
        });
    }

    /** Mirror an in-progress placement (its current ghost, `null` = placement ended)
     *  onto the origin's same-group followers — the live half of the drawings link;
     *  the created copy replaces the ghosts when the placement completes. One-way by
     *  contract (an external ghost never re-emits drafts), so no busy guard needed. */
    private propagateDraft(originId: string, doc: SerializedDrawing | null): void {
        if (this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        for (const id of this.drawingTargets(originId, setting)) {
            this.cellsById.get(id)?.chart.drawings.setExternalGhost(doc);
        }
    }

    /** Push a linked drawing's edited CONTENT (anchors, style, text, per-type props)
     *  onto its same-group peers — any member propagates, not just the original. */
    private propagateDrawingEdit(originId: string, drawingId: string): void {
        if (this.drawingSyncBusy || this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        const group = this.drawingLinks.get(`${originId}\u0000${drawingId}`);
        if (!group) return;
        const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
        if (!doc) return;
        this.drawingSyncBusy = true;
        try {
            for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
                const peerId = group.get(id);
                if (peerId == null) continue;
                this.cellsById.get(id)?.chart.drawings.update(peerId, {
                    anchors: doc.anchors,
                    style: doc.style,
                    text: doc.text,
                    props: doc.props,
                });
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /** Remove a linked drawing's peers with it. The removed member always leaves its
     *  link group (whatever the setting); peers are only deleted while the link is on.
     *  A propagated peer removal re-enters here under the busy guard and just cleans
     *  its own link key. */
    private propagateDrawingRemoval(originId: string, drawingId: string): void {
        if (this.destroyed) return;
        const key = `${originId}\u0000${drawingId}`;
        const group = this.drawingLinks.get(key);
        if (!group) return;
        this.drawingLinks.delete(key);
        group.delete(originId);
        if (this.drawingSyncBusy) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        this.drawingSyncBusy = true;
        try {
            for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
                const peerId = group.get(id);
                if (peerId != null) this.cellsById.get(id)?.chart.drawings.remove(peerId);
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /**
     * Push an origin cell's symbol/timeframe onto its same-group followers (fired from
     * `market:changed`). Convergence comes from IDEMPOTENCE, not the guard: a follower's
     * own (async) `market:changed` propagates back, but every peer already carries the
     * value, so the cell setters no-op and the wave dies.
     */
    private propagateMarket(originId: string): void {
        if (this.syncBusy || this.destroyed) return;
        const origin = this.cellsById.get(originId);
        if (!origin) return;
        const ids = [...this.cellsById.keys()];
        this.syncBusy = true;
        try {
            if (origin.symbol) {
                for (const id of syncTargets(originId, this.syncOpts.symbol, ids)) this.cellsById.get(id)?.setSymbol(origin.symbol);
            }
            for (const id of syncTargets(originId, this.syncOpts.timeframe, ids)) this.cellsById.get(id)?.setTimeframe(origin.timeframe);
        } finally {
            this.syncBusy = false;
        }
    }

    /** Trigger ② — a cell's market changed: retention + sync always; chrome only if active. */
    private onCellMarketChanged(id: string): void {
        this.refreshRetention();
        this.propagateMarket(id);
        // A level line belongs to the symbol it was drawn for: hide it while this cell
        // shows another market (otherwise "alert at 50,000" floats over a $150 chart),
        // and bring it back the moment the symbol returns.
        this.syncAlertLines(this.cellsById.get(id));
        this.alertPanel.refresh();
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setSymbol(cell.symbol);
        this.topbar.setTimeframe(cell.timeframe);
        this.mobileBar?.setSymbol(cell.symbol);
        this.mobileBar?.setTimeframe(cell.timeframe);
        this.mobileBar?.setLayoutLabel(`${this.def.cols.length}×${this.def.rows.length}`);
        this.objectTree.setSymbol(cell.symbol);
        this.alertPanel.refresh();
        this.bottombar?.setSession({ session: cell.session, enabled: cell.sessionAvailable });
        this.projectTimezone(); // the new symbol's market zone, once its metadata lands
        // The chip highlight must track the cell through EVERY market path: a timeframe
        // change (cell API, contribution context, sync link) leaves range mode and a
        // direct `applyRange` enters it — the bar follows the cell's own record.
        this.bottombar?.setActiveRange(cell.activeRangeId);
    }

    /** Trigger ② — a cell's price style changed: the topbar button/menu only if active.
     *  Reads the cell back (not the requested style) so the button reflects what the
     *  renderer actually applied. */
    private onCellPriceStyleChanged(id: string): void {
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setPriceStyle(cell.priceStyle);
        this.mobileBar?.setPriceStyle(cell.priceStyle);
    }

    /** Trigger ② — an active cell's indicator ledger changed: refresh its shared chrome. */
    private onCellIndicatorsChanged(id: string): void {
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.indicatorPicker?.sync();
        this.topbar.setCompareSymbol(this.compareLabel());
        this.compareSheet?.refresh();
    }

    /** Timeframe changes routed from the topbar menu / quick entry (chip state follows). */
    private setActiveTimeframe(tf: string): void {
        this.bottombar?.setActiveRange(null);
        this.active.setTimeframe(tf);
    }

    /** Star/unstar a timeframe — a WORKSPACE preference (one chip row, whatever the
     *  active cell); the topbar follows and the set persists with the document. */
    private setTimeframeFavorite(tf: string, on: boolean): void {
        if (on === this.tfFavs.includes(tf)) return;
        this.tfFavs = on ? [tf, ...this.tfFavs] : this.tfFavs.filter((f) => f !== tf);
        this.topbar.setTimeframeFavorites(this.tfFavs);
        this.tfDrawer?.refreshFavorites();
        this.markStateDirty();
    }

    /** Star/unstar an INDICATOR — a workspace preference like the other stars: the picker
     *  reads this one set, and the document carries it to a saved layout / share link. */
    private setIndicatorFavorite(key: string, on: boolean): void {
        if (on === this.indFavs.includes(key)) return;
        this.indFavs = on ? [key, ...this.indFavs] : this.indFavs.filter((k) => k !== key);
        this.indicatorPicker?.sync();
        this.markStateDirty();
    }

    /** Star/unstar a chart type — a WORKSPACE preference like the timeframe stars: the
     *  chart-type sheet, the More drawer and the desktop style menu all read this one set,
     *  and the document carries it. */
    private setStyleFavorite(id: string, on: boolean): void {
        if (on === this.styleFavs.includes(id)) return;
        this.styleFavs = on ? [id, ...this.styleFavs] : this.styleFavs.filter((f) => f !== id);
        this.mobileBar?.setStyleFavorites(this.styleFavs);
        this.topbar.setStyleFavorites(this.styleFavs);
        this.markStateDirty();
    }

    /** The mode flipped (container resized across the breakpoint, or a coarse-pointer
     *  change). Close the open surfaces — a desktop card must not linger over the
     *  mobile chrome (and vice versa) — and re-present every cell's own chrome. */
    /** Remember where a piece of desktop chrome sits, so it can go back there. */
    private anchorChrome(el: HTMLElement): void {
        const doc = this.root.ownerDocument;
        const anchor = doc.createComment('vela-chrome');
        el.parentElement?.insertBefore(anchor, el.nextSibling);
        this.desktopChrome.push({ el, anchor });
    }

    /**
     * Attach or detach the desktop-only chrome for the layout in force. Detaching keeps the
     * widgets alive — every reference, listener and piece of state survives — so a flip back
     * is a re-attach plus a re-measure, not a rebuild.
     */
    private applyChromeForLayout(mode: LayoutMode): void {
        const desktop = mode === 'desktop';
        for (const { el, anchor } of this.desktopChrome) {
            if (desktop) {
                if (!el.isConnected && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
            } else if (el.isConnected) {
                el.remove();
            }
        }
        if (desktop) {
            // The bar measured nothing while it was out of the document: re-read it, and
            // repaint the rail's selected tool before the first frame it is back in.
            this.topbar.syncChrome();
            this.drawToolbar?.refreshChartTools();
        }
    }

    private onLayoutModeChange(mode: LayoutMode): void {
        this.dock.setLayout(mode);
        this.applyChromeForLayout(mode);
        this.tfDrawer?.close();
        this.drawingsDrawer?.close();
        // More is a standard pane now: keep it open through rotation like its peers.
        this.timezoneDrawer?.close();
        this.palette?.destroy();
        this.palette = null;
        for (const cell of this.cellsById.values()) {
            // Indicator dialogs close on a size-class transition; chart settings adapts
            // between its desktop card and phone pane without discarding the user's place.
            cell.chart.renderer.closeDialogs({ preserveSettings: true });
            cell.chart.renderer.setLayoutMode(mode);
            cell.setControlsCompact(mode === 'mobile'); // the cluster keeps its reset chip, drops the cursor-only verbs
        }
        this.syncCellPresentation(); // the legend's overview override is mode-scoped
    }

    /** Push the layout-shape-dependent chrome onto every cell: multi-cell grids keep
     *  the status line on one row (segments that don't fit hide), and on MOBILE a legend
     *  that has genuinely run out of room routes its count chip to the object tree —
     *  where per-indicator controls also live — instead of unfolding into nothing. A
     *  cell with room keeps its rows: the fold is measured, never assumed (R59). */
    private syncCellPresentation(): void {
        const multi = this.def.cells.length > 1;
        const overview = multi && this.layoutCtl.current === 'mobile' ? (): void => this.dock.toggle('objects', true) : null;
        // The marks chip is the marking door on BOTH shells: the phone's sheet, or the
        // desktop popover opened on that chart's column (see openSyncSurface).
        const markable = multi && !this.monoLayout;
        for (const cell of this.cellsById.values()) {
            cell.setStatuslineFit(multi);
            cell.setSyncMarksHandler(markable ? () => this.openSyncSurface(cell.id) : null);
            cell.chart.renderer.setLegendOverviewAction(overview);
        }
    }

    // ── mobile drawers (built on first open; every read is live and hits the ACTIVE cell) ──

    private openTimeframeDrawer(): void {
        this.tfDrawer ??= new TimeframeDrawer({
            host: this.root,
            timeframes: this.opts.timeframes ?? DEFAULT_TIMEFRAMES,
            ranges: RANGE_PRESETS,
            currentTimeframe: () => this.active.timeframe,
            activeRange: () => this.active.activeRangeId,
            onTimeframe: (tf) => this.setActiveTimeframe(tf),
            onRange: (preset) => {
                this.active.applyRange(preset);
                this.bottombar?.setActiveRange(preset.id); // the desktop bar stays truthful across a mode flip
            },
            // The timeframe stars are ONE set (topbar chips + this sheet): starring here
            // lights the desktop dropdown's star too, and the layout carries both.
            favorites: () => this.tfFavs,
            onFavorite: (tf, on) => this.setTimeframeFavorite(tf, on),
            onOpenChange: (open) => {
                this.trackDialog(open);
                this.mobileBar?.setExpanded('timeframe', open);
            },
        });
        this.tfDrawer.open();
    }

    private openDrawingsDrawer(): void {
        this.drawingsDrawer ??= new DrawingsDrawer({
            host: this.root,
            toolbar: () => this.toolbarDef, // the shared static toolbar's definition (see constructor)
            currentTool: () => this.active.chart.drawings.getTool(),
            isFavorite: (type) => this.active.chart.drawings.isFavorite(type),
            onFavorite: (type, on) => this.active.chart.drawings.setFavorite(type, on),
            onSelect: (type) => this.active.chart.drawings.setTool(type),
            recent: () => recentOf('drawings'),
            onOpenChange: (open) => {
                this.trackDialog(open);
                this.mobileBar?.setExpanded('drawings', open);
            },
        });
        this.drawingsDrawer.open();
    }

    /** Both chart-specific doors open the same pane at that chart's column. */
    private openSyncSurface(cellId?: string): void {
        if (this.monoLayout || this.cellsById.size < 2) return;
        if (this.layoutCtl.current === 'mobile') this.openSyncDrawer(cellId);
        else this.openLayoutSetup('sync', cellId);
    }

    private openMoreDrawer(view: 'main' | 'layout' | 'manage' | 'drawings' = 'main', focus?: 'manage' | 'sync', cellId?: string): void {
        if (view === 'layout' && focus !== 'manage') {
            this.openLayoutSetup(focus === 'sync' ? 'sync' : 'layout', cellId);
            return;
        }
        if (view === 'main' && this.morePanel.open) {
            this.morePanel.toggle(false);
            return;
        }
        this.ensureMoreDrawer().open(view, { ...(focus ? { focus } : {}), ...(cellId ? { cell: cellId } : {}) });
    }

    private ensureMoreDrawer(): MoreDrawer {
        // The drawer is the mobile counterpart of the topbar's tools — composition-
        // hidden entries lose their drawer rows too (handlers omitted ⇒ rows omitted).
        const has = (id: string): boolean => topbarHas(this.topbarComp, id);
        this.moreDrawer ??= new MoreDrawer({
            host: this.root,
            panel: this.morePanel,
            onOpenLayoutManager: (anchor) => this.openLayoutManager(anchor),
            ...(this.layoutSetup ? { onOpenLayoutSetup: () => this.openLayoutSetup() } : {}),
            onOpenIndicatorTemplates: () => this.openIndicatorTemplates(),
            indicatorTemplateCount: () => this.templateList().length,
            ...(has('undo-redo') ? { onUndo: () => this.undoHistory(), onRedo: () => this.redoHistory() } : {}),
            ...(has('screenshot')
                ? { onScreenshot: this.screenshotOverride ? () => this.runOverride(this.screenshotOverride!) : () => this.downloadScreenshot() }
                : {}),
            canUndo: () => this.historyCanUndo(),
            canRedo: () => this.historyCanRedo(),
            priceStyles: () => priceStyleIds().map((id) => ({ id, label: priceStyleLabel(id), icon: priceStyleIcon(id) })),
            priceStyle: () => this.active.priceStyle,
            onPriceStyle: (id) => this.active.setPriceStyle(id),
            // One chart picker on the phone: the drawer's row raises the same sheet the
            // bar's chart-type stop does (a shell without the mobile bar keeps the list).
            ...(this.mobileBar ? { onChartType: () => this.mobileBar!.openSheet(), canOpenChartType: () => this.layoutCtl.current === 'mobile' } : {}),
            // The editor has its own row below ("Pine Editor — Open"), which opens it rather
            // than merely toggling a panel — so it is not listed twice.
            panels: () => (has('panels') ? [...this.dock.list()].filter((p) => p.id !== 'pineEditor') : []),
            // The editor's own door on a phone: the More sheet opens it straight away
            // (TradingView keeps the Pine Editor one tap from the mobile menu).
            ...(this.pineEditor ? { onEditor: () => this.openEditor() } : {}),
            ...(this.drawingsEnabled ? { onDrawings: () => this.openDrawingsDrawer() } : {}),
            onTogglePanel: (id) => this.dock.toggle(id),
            ...(has('alerts')
                ? {
                      alerts: () => this.alerts.map((a) => ({ title: `${a.source} · ${a.title}`, message: a.message, time: a.time })),
                      onAlerts: () => this.dock.toggle('alerts', true),
                  }
                : {}),
            // The chart-body menu's "Reset chart view" row, reachable on a phone through the
            // drawer (its only other door is a right-click, which touch does not have).
            onResetView: () => this.active.resetView(),
            // D1: the second series — same door on for the phone and the desktop sheet.
            onCompare: () => this.openCompare(),
            // …and the rest as a small menu anchored to More ("Chart actions…"), so the
            // phone gets the bulk clears and the same contributed actions as right-click.
            onChartMenu: (anchor) => this.active.openChartMenu(anchor),
            // Display time zone: the menu a hold on the time axis opens, now also a row a
            // user can find without knowing the gesture.
            timezone: () => this.timezone,
            onTimeZone: (anchor) => this.openTimezoneDrawer(anchor),
            // The drawing toolbar's Cursors stop, on the phone: seven pointers, one row
            // each. TV keeps this on the left toolbar, which the phone hides.
            // The pointer is a CHART capability, not a topbar button: gating it on the
            // `drawings` topbar id hid it on phones, where that button lives in the
            // drawings pill instead. `drawingsEnabled` is the real switch.
            ...(this.drawingsEnabled ? { cursorStyle: () => this.cursorStyle, onCursorStyle: (style: CursorStyle) => this.setCursorStyle(style) } : {}),
            // The replay slot's mobile counterpart (the desktop topbar is hidden here).
            ...(has('replay') && this.replayBar ? { onReplay: () => this.requestReplayMenuFromDrawer() } : {}),
            // Actions placed on the bottom bar (left-aligned by default) have their stop
            // there — only the menu-placed ones land in the drawer, or they would appear
            // twice: left (primary) ones with the primary rows, right ones at the end.
            // Built-in-id actions are slot OVERRIDES: they reach the drawer through the
            // slot's own routed button (screenshot) or stop (indicators), never as a row.
            primaryActions: () => this.drawerActions('left'),
            actions: () => this.drawerActions('right'),
            // The desktop layout dropdown's whole surface — the grid canvas, the
            // non-canvas presets and the sync switches — relocated into the kebab
            // drawer (the topbar is hidden on mobile). Same reads as the topbar block;
            // single-chart mode and a composition without 'layout' omit it here too.
            layout: this.monoLayout || !has('layout') ? undefined : {
                shape: () => layoutShape(this.def),
                presets: () => this.presetRows(),
                onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
                onSelectPreset: (id) => this.setLayout(id),
                syncs: () => this.syncRows(),
                onToggleSync: (id) => this.toggleSync(id as SyncKind),
                onCycleGroup: (id) => this.cycleGroup(id as SyncKind),
                charts: () => this.syncCharts(),
                onCycleCellGroup: (kind, cellId) => this.cycleGroupFor(kind as SyncKind, cellId),
                onSetCellGroup: (kind, cellId, mark) => this.setGroupFor(kind as SyncKind, cellId, mark),
                onSelectChart: (cellId) => { if (this.cellsById.has(cellId)) this.setActiveCell(cellId); },
                onAllInOneGroup: (kind) => this.syncAllInOneGroup(kind as SyncKind),
                onApplySettingsToAll: () => this.applySettingsToAll(),
                onApplyIndicatorsToAll: () => this.applyIndicatorsToAll(),
                drawingsScope: () => this.drawingsScope,
                onToggleDrawingsScope: () => this.setDrawingsScope(this.drawingsScope === 'global' ? 'layout' : 'global'),
                hiddenCharts: () => this.hiddenChartCount,
                // The phone's More → *Hidden charts*: the parked charts by NAME, and a tap
                // that trades one back onto the active pane.
                hiddenList: () => this.hiddenChartList(),
                onPickHidden: (id: string) => {
                    this.showHiddenChart(id);
                },
                onClearPooled: () => this.clearPooled(),
                clearedCharts: () => this.clearedChartCount,
                onRestorePooled: () => this.restorePooled(),
                savedLayouts: () =>
                    this.savedLayoutList().map((l) => ({
                        ...l,
                        thumb: this.layoutThumb(l.name),
                        savedAt: this.layoutSavedAt(l.name),
                    })),
                onSaveLayout: (name) => this.saveLayout(name),
                onSaveLayoutWithThumb: (name) => this.saveLayoutWithThumbnail(name),
                // The manager's verbs: what the open layout is, whether it drifted, and
                // the two TradingView settings this build was missing (autosave, copy).
                activeLayout: () => this.activeSavedLayout,
                onSaveChanges: () => this.saveActiveLayout(),
                autosave: () => this.autosaveEnabled(),
                onToggleAutosave: (on) => this.setAutosave(on),
                onDuplicateLayout: (name) => this.duplicateLayout(name),
                templates: () => this.templateList(),
                onSaveTemplate: (name, includeMarket) => this.saveTemplate(name, { includeMarket }),
                onApplyTemplate: (name, target) => this.applyTemplate(name, target),
                builtins: () => this.builtinTemplates(),
                onApplyBuiltin: (id) => {
                    this.applyBuiltinTemplate(id);
                },
                onDeleteTemplate: (name) => this.deleteTemplate(name),
                onRenameTemplate: (from, to) => this.renameTemplate(from, to),
                defaultTemplate: () => this.defaultTemplate(),
                onSetDefaultTemplate: (name) => this.setDefaultTemplate(name),
                onExportTemplate: (name) => this.exportTemplate(name),
                onImportTemplate: (json) => this.importTemplate(json),
                legend: () => this.groupLegend(),
                onRenameGroup: (id, name) => this.setGroupName(id, name),
                groupName: (id) => this.groupNames[id],
                onSetGroupMark: (id, glyph) => this.setGroupMark(id, glyph),
                onOpenLayout: (name) => this.openLayout(name),
                onDeleteLayout: (name) => this.deleteLayout(name),
                onRenameLayout: (from, to) => this.renameLayout(from, to),
                onExportLayout: (name) => this.exportLayout(name),
                onImportLayout: (json) => this.importLayout(json),
                onExportData: (scope, timeFormat) => this.exportChartCsv(scope, timeFormat),
                linkGroup: () => this.linkGroup,
                onLinkGroup: (tag) => this.setLinkGroup(tag),
                glyph: () => layoutGlyph(this.def),
                // The phone's door to the same link the desktop card copies.
                onShareLink: () => this.copyShareLink(),
            },
            // Drawing templates — the third stop of the library. Saved looks live per tool
            // in the drawings store; the sheet just reads them and hands one back as that
            // tool's defaults (so the NEXT drawing starts from it, TradingView's rule).
            drawingTemplates: () => this.drawingTemplateList(),
            onApplyDrawingTemplate: (tool, name) => this.useDrawingTemplate(tool, name),
            onDeleteDrawingTemplate: (tool, name) => this.deleteDrawingTemplate(tool, name),
            onExportDrawingTemplate: (tool, name) => this.exportDrawingTemplate(tool, name),
            // Real drawing SETS: whole bundles saved from the object tree, with relative
            // geometry. The library inserts/export/import/deletes them beside the saved
            // per-tool looks — both kinds of "drawing template" stay available.
            drawingSetTemplates: () => this.drawingSetTemplateList(),
            onInsertDrawingSetTemplate: (name) => this.insertDrawingSetTemplate(name),
            onDeleteDrawingSetTemplate: (name) => { this.deleteDrawingSetTemplate(name); },
            onExportDrawingSetTemplate: (name) => this.exportDrawingSetTemplate(name),
            onImportDrawingSetTemplate: (json) => this.importDrawingSetTemplate(json),
            onOpenChange: (open) => {
                // More is a non-modal workspace pane; it must not increment the modal
                // dialog count or block the chart's normal keyboard shortcuts.
                this.mobileBar?.setExpanded('more', open);
                const anchor = this.pendingReplayAnchor;
                if (!open && anchor) {
                    this.pendingReplayAnchor = null;
                    this.openReplayMenu(anchor);
                }
            },
        });
        return this.moreDrawer;
    }

    /** The contributed topbar actions the mobile menu lists, from one cluster. */
    private drawerActions(cluster: 'left' | 'right'): Array<{ label: string; icon?: string; run: () => void }> {
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        const out = widgetActions('topbar', this.context())
            .filter((a) => mobilePlacement(a) === 'menu' && (a.align === 'left') === (cluster === 'left') && !builtin.has(a.id))
            .map((a) => ({ label: a.label, icon: a.icon, run: () => a.run(this.context()) }));
        // The maximize toggle lives on the bar — except on the narrowest phones, where
        // the bar's stops must stay 44px and this one is the least-used. It stays
        // reachable here, so nothing is lost when the media query hides it.
        if (cluster === 'left' && !this.monoLayout) {
            out.unshift({
                label: this.maximizedId ? 'Restore the grid' : 'Maximize the active chart',
                icon: this.maximizedId ? 'restore' : 'maximize',
                run: () => this.toggleMobileMaximize(),
            });
        }
        return out;
    }

    private timezoneMenu(): TimezoneDrawer {
        return this.timezoneDrawer ??= new TimezoneDrawer({
            host: this.root,
            timezone: () => this.timezone,
            onTimezone: (zone) => this.setTimezone(zone),
        });
    }

    private openTimezoneDrawer(anchor?: HTMLElement): void { this.timezoneMenu().open(anchor); }
    private openTimezoneDrawerAt(clientX: number, clientY: number): void { this.timezoneMenu().openAt(clientX, clientY); }

    /** The aggregated alerts bell — entries carry their cell; selecting one activates it. */
    // ── bar replay chrome ──
    //
    // The PUBLIC surface stays `ws.replay`: this chrome starts, paces and ends sessions
    // through it and follows its `replay:*` events, so a replay started from code, a
    // contribution or a shortcut wears the same bar. Nothing here keeps replay state of
    // its own except the pace to resume on and whether "select bar" is armed.

    /** Mount the floating transport bar and follow the session on it. Idempotent, and
     *  called when a session actually starts: a workspace that never replays carries none
     *  of the bar's nodes (it used to hold 36 hidden ones from the first frame). */
    private mountReplayBar(): void {
        if (this.opts.replay === false || this.replayBar) return;
        this.replayBar = new ReplayToolbar({
            host: this.gridEl,
            onPlayPause: () => this.toggleReplay(),
            onStep: () => this.stepReplay(),
            onSpeed: (ms) => this.setReplaySpeed(ms),
            onJumpToRealtime: () => this.jumpToRealtime(),
            onExit: () => this.replay.stop(),
            onCancelArm: () => this.disarmReplay(),
        });
        this.syncReplayUi();
    }

    /** Follow replay sessions on the shell's chrome, whether or not a bar exists yet. */
    private watchReplay(): void {
        for (const ev of ['replay:start', 'replay:step', 'replay:tick', 'replay:play', 'replay:pause', 'replay:end'] as const) {
            this.replay.on(ev, () => this.syncReplayUi());
        }
        // `state` reads the ACTIVE cell's chart — a new active cell means a new cursor.
        this.on('cell:active', () => this.syncReplayUi());
    }

    /** Paint the session onto the chrome (bar + topbar slot). Idempotent. */
    private syncReplayUi(): void {
        if (this.destroyed) return;
        const s = this.replay.state;
        if (s.active) this.mountReplayBar();
        this.topbar.setReplayActive(s.active);
        this.replayBar?.setState({
            active: s.active,
            playing: s.playing,
            cursorTime: s.cursorTime,
            remaining: s.remaining,
            // A live session's own pace is the truth (it may have been started with one);
            // while paused the bar shows the pace the next play will use.
            speedMs: s.playing ? s.intervalMs : this.replaySpeed,
        });
    }

    /** Play/pause the session (the `Shift+↓` chord and the transport's centre button). */
    private toggleReplay(): void {
        const s = this.replay.state;
        if (!s.active) return;
        if (s.playing) this.replay.pause();
        else this.replay.play(this.replaySpeed);
        this.syncReplayUi();
        this.refocusActive();
    }

    /** Reveal one update (`Shift+→` and the step button). A running session pauses first:
     *  stepping is a deliberate read, not a race with the clock. */
    private stepReplay(): void {
        if (!this.replay.state.active) return;
        if (this.replay.state.playing) this.replay.pause();
        this.replay.step();
        this.syncReplayUi();
        this.refocusActive();
    }

    /** Adopt a pace. While playing it takes effect now; while paused it is what the next
     *  play uses (picking a speed is never an implicit "play"). */
    private setReplaySpeed(ms: number): void {
        this.replaySpeed = ms;
        if (this.replay.state.playing) this.replay.play(ms);
        this.syncReplayUi();
    }

    /** Leave the replay and land on the newest bars. `panBy` clamps at the pan limit past
     *  the last bar, so one long nudge reaches the right edge from any distance. */
    private jumpToRealtime(): void {
        if (this.replay.state.active) this.replay.stop();
        this.disarmReplay();
        this.active.chart.panBy(REPLAY_JUMP_PANS);
        this.syncReplayUi();
        this.refocusActive();
    }

    /** The replay entry's menu — the three ways in, plus the way out — anchored on the
     *  button that opened it (the topbar slot on desktop, the mobile bar's kebab on a
     *  phone; the date picker reuses the same anchor). */
    private openReplayMenu(anchor: HTMLElement): void {
        this.replayMenu?.destroy();
        const active = this.replay.state.active;
        this.replayMenu = new Menu({
            host: this.root,
            items: [
                { id: 'select-bar', label: 'Select bar', icon: 'cursor' },
                { id: 'select-date', label: 'Select date', icon: 'clock' },
                { id: 'random-bar', label: 'Random bar', icon: 'replay' },
                // TradingView's replay scope switch: the whole layout, or just this chart.
                ...(this.def.cells.length > 1
                    ? [{ id: 'scope-all', label: 'Replay all charts', checked: this.replayScope === 'all', separatorBefore: true } as MenuItemDescriptor]
                    : []),
                { id: 'jump-realtime', label: 'Jump to real time', icon: 'jump-realtime', separatorBefore: true, disabled: !active },
            ],
            onSelect: (id) => {
                if (id === 'select-bar') this.armReplaySelect();
                else if (id === 'select-date') this.openReplayDatePicker(anchor);
                else if (id === 'random-bar') this.startReplayAtRandomBar();
                else if (id === 'scope-all') this.setReplayScope(this.replayScope === 'all' ? 'cell' : 'all');
                else if (id === 'jump-realtime') this.jumpToRealtime();
            },
        });
        const r = anchor.getBoundingClientRect();
        this.replayMenu.openAt(r.left, r.bottom + 4);
    }

    /** Replay scope: every chart (default) or the one the session starts on. */
    setReplayScope(scope: 'all' | 'cell'): void {
        this.replayScope = scope;
        this.toast(scope === 'all' ? 'Replay applies to all charts' : 'Replay applies to this chart only', 'info');
    }

    /**
     * The mobile route: the drawer's Replay action closes its sheet first, and the entry
     * menu opens when the sheet reports closed (opening it under a closing modal would
     * race the drawer's own dismiss chain). The anchor is the kebab that opened the
     * drawer — it stays in the DOM, so the menu and the date picker both place on it.
     */
    private requestReplayMenuFromDrawer(): void {
        this.pendingReplayAnchor = this.mobileBar?.el.querySelector<HTMLElement>('.vela-mb-more') ?? null;
    }

    /**
     * Arm "select bar": the next click on ANY cell's plot starts the session there. The
     * crosshair previews the cut on every other chart meanwhile (each one's last bar that
     * closed by the hovered time), so the clipped edge is visible before committing.
     */
    private armReplaySelect(): void {
        if (this.replayArmed || this.destroyed) return;
        this.replayArmed = true;
        this.gridEl.dataset.replayArm = '1';
        this.mountReplayBar();
        this.replayBar?.setArmed(true);
        for (const cell of this.cells()) {
            const renderer = cell.chart.renderer;
            this.replayArmOffs.push(renderer.onClick((e) => {
                if (e.time != null) void this.startReplayAt(cell.id, e.time);
            }));
            if (renderer.supportsExternalCrosshair) {
                this.replayArmOffs.push(renderer.onCrosshairMove((e) => this.previewReplayCut(cell.id, e.time ?? null)));
            }
        }
        const doc = this.root.ownerDocument;
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            this.disarmReplay();
        };
        // Capture: Esc cancels the pending pick instead of closing whatever sits under it.
        doc.addEventListener('keydown', onKey, true);
        this.replayArmOffs.push(() => doc.removeEventListener('keydown', onKey, true));
        this.syncReplayUi();
    }

    /** Drop the armed state and every listener/preview it added (idempotent). */
    private disarmReplay(): void {
        if (!this.replayArmed) return;
        this.replayArmed = false;
        delete this.gridEl.dataset.replayArm;
        const offs = this.replayArmOffs;
        this.replayArmOffs = [];
        for (const off of offs) off();
        for (const cell of this.cells()) {
            if (cell.chart.renderer.supportsExternalCrosshair) cell.chart.renderer.setExternalCrosshair(null);
        }
        this.replayBar?.setArmed(false);
        this.syncReplayUi();
    }

    /** Ghost the cut position on the OTHER charts while a bar is being picked. */
    private previewReplayCut(originId: string, time: number | null): void {
        for (const cell of this.cells()) {
            if (cell.id === originId) continue;
            const renderer = cell.chart.renderer;
            if (!renderer.supportsExternalCrosshair) continue;
            renderer.setExternalCrosshair(time == null ? null : lastOpenClosedBy(time, cell.chart.market.timeframe));
        }
    }

    /** Start the session with `from` read on `cellId` (the shared clock lands on the close
     *  of that chart's last kept bar; every other chart keeps what closed by then). */
    private async startReplayAt(cellId: string, from: number): Promise<void> {
        this.disarmReplay();
        if (!Number.isFinite(from) || from <= 0) return;
        await this.replay.start({ from, cell: cellId, scope: this.replayScope });
        this.syncReplayUi();
        this.refocusActive();
    }

    /** A random moment inside the active cell's replayable history — TradingView's
     *  "Random bar": you get a session without hunting for a spot. */
    private startReplayAtRandomBar(): void {
        const cellId = this.activeId ?? this.cells()[0]?.id;
        const bounds = this.replay.bounds;
        if (!cellId || !bounds || bounds.last <= bounds.first) return;
        const from = bounds.first + Math.random() * (bounds.last - bounds.first);
        void this.startReplayAt(cellId, from);
    }

    /** Calendar entry ("Select date"): the session starts at that day's first bar. */
    private openReplayDatePicker(anchor: HTMLElement): void {
        this.replayDatePop?.destroy();
        const seed = this.replay.state.cursorTime ?? this.replay.bounds?.last ?? Date.now();
        this.replayDatePop = new Popover({
            trigger: anchor,
            host: this.root,
            align: 'start',
            boundary: this.root,
            className: REPLAY_CALENDAR_CLASS,
            gap: 4,
            onClose: () => {
                this.replayDatePop = null;
            },
            content: (el) => {
                const picker = new DatePicker({
                    value: isoDate(new Date(seed)),
                    onPick: (iso) => {
                        this.replayDatePop?.hide();
                        const cellId = this.activeId ?? this.cells()[0]?.id;
                        // UTC midnight: the picker names a DAY, and the chart's own zone is
                        // the axis it will be read against.
                        const from = Date.parse(`${iso}T00:00:00Z`);
                        if (cellId) void this.startReplayAt(cellId, from);
                    },
                });
                el.append(picker.el);
            },
        });
        this.replayDatePop.show();
    }

    /** Keep desktop and portrait-phone badges in step with the bounded session log. */
    private syncAlertCount(): void {
        this.topbar.setAlertCount(this.alerts.length);
        this.mobileBar?.setAlertCount(this.alerts.length);
    }

    /** Alert rows recorded for one chart (the per-cell badge reads this). */
    alertCountFor(cellId: string): number {
        let n = 0;
        for (const a of this.alerts) if (a.cellId === cellId) n += 1;
        return n;
    }

    /** Every alert, newest first (the list's data source, exposed for hosts/tests). */
    alertEntries(): ReadonlyArray<{ cellId: string; source: string; title: string; message: string; time: number }> {
        return this.alerts;
    }

    /** An ordinary symbol door always exits compare-search mode. */
    private openSymbolSearch(query = ''): void {
        this.compareSearchEpoch++;
        this.comparePending = false;
        this.returnToCompareAfterSearch = false;
        this.symbolPicker.open(query);
    }

    /** Open the Compare pane — symbol, the three displays, and removal. */
    openCompare(): void {
        this.compareSheet?.open();
    }

    private beginCompareSearch(): void {
        this.compareSearchEpoch++;
        this.comparePending = true;
        this.returnToCompareAfterSearch = true;
        this.symbolPicker.open('', 'Compare with');
    }

    /** Open the symbol search in compare mode (the pane's own symbol row). */
    openComparePicker(): void {
        this.openCompare();
        this.beginCompareSearch();
    }

    /** The active cell, or null before the first one is built / after teardown. */
    private activeCell(): ChartCell | null {
        return this.activeId ? (this.cellsById.get(this.activeId) ?? null) : null;
    }

    /** The compare study's symbol on a cell (null = nothing compared there). */
    private compareSymbolOf(cell: ChartCell | null): string | null {
        const handle = cell?.chart.indicators().find((h) => h.nativeType === 'compare');
        if (!handle || !cell) return null;
        const symbol = handle.inputValues().symbol;
        // Unlike the old shell-only mirror, indicator inputs survive reload, undo and
        // templates. A deliberately cleared string must not revive an old mirror value.
        if (typeof symbol === 'string') return symbol || null;
        return this.compareSymbols.get(`${cell.id}:${handle.id}`) ?? null;
    }

    /** The ticker the ACTIVE chart compares with (null = nothing compared) — the toolbar
     *  chip's text, and what its tooltip names. */
    private compareLabel(): string | null {
        const raw = this.compareSymbolOf(this.activeCell());
        if (!raw) return null;
        return this.feed.resolveSymbol(raw)?.ticker ?? raw.split(':').pop() ?? raw;
    }

    /** The compare study's display mode on a cell (the reference default: Same % scale). */
    private compareDisplayOf(cell: ChartCell | null): CompareDisplay {
        const handle = cell?.chart.indicators().find((h) => h.nativeType === 'compare');
        if (!handle || !cell) return 'same-percent';
        const display = handle.inputValues().display;
        if (display === 'same-percent' || display === 'own-scale' || display === 'new-pane') return display;
        return this.compareDisplays.get(`${cell.id}:${handle.id}`) ?? 'same-percent';
    }

    /**
     * Point the active chart's Compare study at `symbol` (add it once, then re-target) and
     * keep the current display. When search closes, return to the painted Compare pane.
     */
    setCompareSymbol(symbol: string): void {
        this.comparePending = false;
        const cell = this.activeCell();
        const chart = cell?.chart;
        if (!symbol || !cell || !chart) return;
        const existing = chart.indicators().find((h) => h.nativeType === 'compare');
        const display = this.compareDisplayOf(cell);
        if (existing) {
            this.writeCompareInputs(cell, existing, { symbol, display });
            this.compareSymbols.set(`${cell.id}:${existing.id}`, symbol);
            this.applyCompareDisplay(cell, existing.id, display);
        } else {
            const handle = chart.addNativeIndicator('compare', { inputs: { symbol, display } });
            this.compareSymbols.set(`${cell.id}:${handle.id}`, symbol);
            // The model is mounted a beat later; place it once it exists (and once more if
            // the host asked for a non-default mode).
            this.applyCompareDisplay(cell, handle.id, display);
        }
        this.topbar.setCompareSymbol(this.compareLabel());
        this.toast(`Comparing with ${parseSymbol(symbol).ticker || symbol}`, 'info', 2200);
        this.compareSheet?.refresh();
        this.markStateDirty();
    }

    /** Switch the active chart's compare between the reference's three displays. */
    setCompareDisplay(mode: CompareDisplay): void {
        const cell = this.activeCell();
        const chart = cell?.chart;
        if (!cell || !chart) return;
        const handle = chart.indicators().find((h) => h.nativeType === 'compare');
        if (!handle) return;
        this.compareDisplays.set(`${cell.id}:${handle.id}`, mode);
        this.writeCompareInputs(cell, handle, { display: mode });
        this.applyCompareDisplay(cell, handle.id, mode);
        this.compareSheet?.refresh();
        this.markStateDirty();
    }

    /** Take the compare off the active chart (and put the price axis back). */
    removeCompare(): void {
        const cell = this.activeCell();
        const chart = cell?.chart;
        if (!cell || !chart) return;
        const handle = chart.indicators().find((h) => h.nativeType === 'compare');
        if (!handle) return;
        const key = `${cell.id}:${handle.id}`;
        handle.remove();
        this.compareSymbols.delete(key);
        this.compareDisplays.delete(key);
        this.restoreCompareAxis(cell);
        this.compareSheet?.refresh();
        this.topbar.setCompareSymbol(this.compareLabel());
        this.markStateDirty();
    }

    /** Discard only the mirrors for a cell whose old renderer is being replaced. */
    private forgetCompareMirrors(cellId: string): void {
        const prefix = `${cellId}:`;
        for (const key of this.compareSymbols.keys()) if (key.startsWith(prefix)) this.compareSymbols.delete(key);
        for (const key of this.compareDisplays.keys()) if (key.startsWith(prefix)) this.compareDisplays.delete(key);
    }

    /** Guard our synchronous input event; callers place the study once after writing. */
    private writeCompareInputs(cell: ChartCell, handle: IndicatorHandle, values: Record<string, InputValue>): void {
        const key = `${cell.id}:${handle.id}`;
        this.compareWrites.add(key);
        try { handle.setInputs(values); } finally { this.compareWrites.delete(key); }
    }

    /** Re-apply a restored or inherited Compare study's live placement once mounted. */
    private restoreComparePlacement(cell: ChartCell): void {
        const handle = cell.chart.indicators().find((h) => h.nativeType === 'compare');
        const symbol = this.compareSymbolOf(cell);
        if (!handle || !symbol) return;
        const key = `${cell.id}:${handle.id}`;
        const display = this.compareDisplayOf(cell);
        this.compareSymbols.set(key, symbol);
        this.compareDisplays.set(key, display);
        this.applyCompareDisplay(cell, handle.id, display);
    }

    /**
     * Apply a display to a mounted compare study: the pane/scale placement and, for the
     * Same-% mode, the price axis itself. Retried briefly because a freshly added native
     * has no render handle for the first tick — a silent no-op would leave the line in a
     * pane of its own while the sheet claims "Same % scale".
     */
    private applyCompareDisplay(cell: ChartCell, id: string, mode: CompareDisplay, attempt = 0): void {
        // A retry from an earlier choice must not move a freshly restored/rebuilt chart
        // or override a more recent display choice while the renderer is still mounting.
        if (this.cellsById.get(cell.id) !== cell || this.compareDisplayOf(cell) !== mode) return;
        const chart = cell.chart;
        const handle = chart.indicators().find((h) => h.id === id);
        if (!handle) return;
        // The compare line reads ON TOP of the candles (the reference paints a compared
        // symbol over the price) — a native indicator otherwise mounts BEHIND them, which
        // hides the line wherever it tracks the chart's own price.
        try {
            chart.renderer.set('seriesOrder', { id, to: 'front' });
        } catch {
            /* a renderer without series ordering still draws the study */
        }
        const panes = chart.panes;
        const placed = (() => {
            if (!panes.supported) return true;
            try {
                const matches = (): boolean => {
                    const info = panes.list().find((p) => p.indicators.some((i) => i.id === id));
                    if (!info) return false;
                    if (mode === 'new-pane') return info.id !== 'price';
                    return info.id === 'price' && info.indicators.find((i) => i.id === id)?.ownScale === (mode === 'own-scale');
                };
                // Avoid creating a fresh pane every time an already-correct New pane is
                // re-applied (including a restored pane that also holds other studies).
                if (matches()) return true;
                if (mode === 'new-pane') panes.moveIndicator(id, { newPane: true });
                else panes.moveIndicator(id, { pane: 'price', ownScale: mode === 'own-scale' });
                return matches();
            } catch {
                return false;
            }
        })();
        if (!placed && attempt < 12) {
            const timer = setTimeout(() => this.applyCompareDisplay(cell, id, mode, attempt + 1), 120);
            if (typeof timer === 'object' && 'unref' in timer) (timer as { unref?: () => void }).unref?.();
        }
        if (mode === 'same-percent') {
            // The reference switches the axis itself: both series are shown in percent from
            // the first visible bar. Remember that WE made the switch so leaving Compare can
            // put back whatever the user had.
            if (chart.renderer.get('scaleMode') !== 'percent') {
                chart.renderer.set('scaleMode', 'percent');
                this.compareAxisSwitched.add(cell.id);
            }
        } else {
            this.restoreCompareAxis(cell);
        }
    }

    /** Undo the percent axis this shell switched to for a Same-% compare. */
    private restoreCompareAxis(cell: ChartCell): void {
        if (!this.compareAxisSwitched.delete(cell.id)) return;
        try {
            if (cell.chart.renderer.get('scaleMode') === 'percent') cell.chart.renderer.set('scaleMode', 'price');
        } catch {
            /* the cell is on its way out */
        }
    }

    /** The last price the ACTIVE chart printed (the alert sheet's default level), or null
     *  before the first bar — an empty cell would otherwise create an alert at NaN. */
    private activePrice(): number | null {
        const id = this.activeId;
        if (!id) return null;
        const cell = this.cellsById.get(id);
        if (cell?.chart.replay.state.active) {
            const bars = cell.chart.renderer.getBars?.() ?? [];
            const shown = (bars[bars.length - 1] ?? cell.chart.lastBar)?.close;
            return shown != null && Number.isFinite(shown) ? shown : null;
        }
        const price = this.lastPrice.get(id);
        return price != null && Number.isFinite(price) ? price : null;
    }

    /** Open the Create tab with a fresh draft on the active chart. */
    openAlertCreate(prefill?: { value: number; label: string; drawingId: string }): void {
        if (!this.activeId) return;
        this.alertPanel.createOnActive(prefill);
        this.dock.toggle('alerts', true);
    }

    private alertTarget(): AlertTarget | null {
        const id = this.activeId;
        const cell = id ? this.cellsById.get(id) : undefined;
        if (!id || !cell) return null;
        const number = this.syncCharts().find((chart) => chart.id === id)?.label ?? id;
        // `chart.setMarket()` can request a new identity before ChartCell's committed
        // projection catches up (or vice versa). Both must agree before arming.
        const pending = cell.chart.loading || !this.alertMarketMatches(cell);
        return {
            cellId: id, symbol: String(cell.symbol ?? ''), timeframe: cell.timeframe, session: cell.session,
            chartLabel: `Chart ${number}`, price: pending ? null : this.activePrice(), loading: pending,
        };
    }

    /** Requested engine identity and projected cell identity must describe one market. */
    private alertMarketMatches(cell: ChartCell): boolean {
        const market = cell.chart.market;
        return (market.symbol == null || market.symbol === cell.symbol)
            && (market.timeframe == null || market.timeframe === cell.timeframe)
            && (market.session ?? 'regular') === cell.session;
    }

    /** Last-line identity/drawing guard in addition to the form's visible review state. */
    private createAlertForTarget(request: AlertRequest, target: AlertTarget): boolean {
        const current = this.alertTarget();
        if (!current || current.loading || current.cellId !== target.cellId || current.symbol !== target.symbol || current.timeframe !== target.timeframe || current.session !== target.session) return false;
        if (request.source) {
            const cell = this.cellsById.get(target.cellId);
            const level = cell ? this.levelOfDrawing(cell, request.source.drawingId, this.alertBarTime(cell)) : null;
            if (level == null || isMoveCondition(request.condition)) return false;
            request = { ...request, value: level };
        }
        return this.createPriceAlert(request);
    }

    /** A current price is usable only on this alert's settled, original market. */
    private alertAnchorPrice(alert: PriceAlert, cell: ChartCell | undefined): number | null {
        if (!cell || cell.chart.loading || !this.alertMarketMatches(cell) || !alertWatchesSymbol(alert, String(cell.symbol ?? ''))) return null;
        if (alert.source && this.levelOfDrawing(cell, alert.source.drawingId, this.alertBarTime(cell)) == null) return null;
        if (cell.chart.replay.state.active) {
            const bars = cell.chart.renderer.getBars();
            const price = (bars[bars.length - 1] ?? cell.chart.lastBar)?.close;
            return price != null && Number.isFinite(price) ? price : null;
        }
        const price = this.lastPrice.get(cell.id);
        return price != null && Number.isFinite(price) ? price : null;
    }

    /** Open an independent editor on the owning chart, never silently retarget an alert. */
    private beginPriceAlertEdit(id: string): AlertEditDraft | null {
        const alert = this.priceAlerts.find((item) => item.id === id);
        const cell = alert ? this.cellsById.get(alert.cellId) : undefined;
        if (!alert || !cell || cell.chart.loading || !this.alertMarketMatches(cell) || this.alertIsOffChart(alert)) return null;
        const level = alert.source ? this.levelOfDrawing(cell, alert.source.drawingId, this.alertBarTime(cell)) : alert.value;
        if (level == null) return null;
        if (cell.id !== this.activeId) this.setActiveCell(cell.id);
        const target = this.alertTarget();
        if (!target || target.loading || target.cellId !== alert.cellId || target.symbol !== alert.symbol) return null;
        const drawing = alert.source ? cell.chart.drawings.all().find((item) => item.id === alert.source!.drawingId) : undefined;
        return {
            target,
            request: { condition: alert.condition, value: level, frequency: alert.frequency, bars: alert.bars,
                ...(alert.source ? { source: { ...alert.source } } : {}) },
            sourceLabel: drawing ? getDrawingType(drawing.type)?.label ?? 'Drawing' : undefined,
        };
    }

    /** Save only onto the same live chart/market/source the editor originally captured. */
    private savePriceAlertEdit(id: string, request: AlertRequest, target: AlertTarget): boolean {
        const index = this.priceAlerts.findIndex((item) => item.id === id);
        const original = this.priceAlerts[index];
        const current = this.alertTarget();
        const cell = original ? this.cellsById.get(original.cellId) : undefined;
        if (!original || !cell || !current || current.loading || current.cellId !== target.cellId || current.symbol !== target.symbol
            || current.timeframe !== target.timeframe || current.session !== target.session || original.cellId !== target.cellId
            || original.symbol !== target.symbol || !this.alertMarketMatches(cell)) return false;
        if (!Object.prototype.hasOwnProperty.call(CONDITION_LABELS, request.condition) || !Number.isFinite(request.value)
            || (request.frequency !== 'once' && request.frequency !== 'each') || !Number.isInteger(request.bars)
            || request.bars < 1 || request.bars > 500 || (isMoveCondition(request.condition) && request.value <= 0)
            || original.source?.drawingId !== request.source?.drawingId) return false;
        let value = request.value;
        if (original.source) {
            const level = this.levelOfDrawing(cell, original.source.drawingId, this.alertBarTime(cell));
            if (level == null || isMoveCondition(request.condition)) return false;
            value = level;
        }
        const lineChanged = !original.source && (isMoveCondition(original.condition) !== isMoveCondition(request.condition)
            || (!isMoveCondition(request.condition) && value !== original.value));
        const updated: PriceAlert = { ...original, condition: request.condition, value, frequency: request.frequency, bars: request.bars,
            anchorPrice: this.alertAnchorPrice(original, cell), lineId: lineChanged ? '' : original.lineId };
        // Publish the new row before removing the old line, so shared references are counted.
        // Another alert or a drawing-backed alert may still depend on the old exact line.
        this.priceAlerts[index] = updated;
        if (lineChanged) {
            this.removeUnsharedAlertLine(original);
            updated.lineId = this.drawAlertLevel(cell, updated) ?? '';
        }
        this.markStateDirty();
        this.moreDrawer?.refreshAlerts?.();
        this.alertPanel.refresh();
        return true;
    }

    /** Pause or explicitly re-arm; no historical crossing is replayed on resume. */
    private togglePriceAlert(id: string): boolean {
        const index = this.priceAlerts.findIndex((item) => item.id === id);
        const alert = this.priceAlerts[index];
        if (!alert) return false;
        const state = alert.state === 'active' ? 'paused' : 'active';
        this.priceAlerts[index] = { ...alert, state, anchorPrice: state === 'active' ? this.alertAnchorPrice(alert, this.cellsById.get(alert.cellId)) : null };
        this.markStateDirty();
        this.moreDrawer?.refreshAlerts?.();
        this.alertPanel.refresh();
        return true;
    }

    /**
     * The clock button on a drawing: open the alert sheet bound to that line. The level shown
     * is the line's price at the newest bar, and from then on the alert re-reads the line each
     * bar — so a sloped trend line alerts where it actually is, not where it started.
     */
    private openAlertForDrawing(cell: ChartCell, drawingId: string): void {
        const doc = cell.chart.drawings.all().find((d) => d.id === drawingId);
        if (!doc) return;
        const time = this.alertBarTime(cell);
        const level = drawingLevelAt(doc, time);
        if (level == null) return; // the line has no price here (a vertical tool)
        if (cell.id !== this.activeId) this.setActiveCell(cell.id);
        this.openAlertCreate({ value: level, label: getDrawingType(doc.type)?.label ?? 'Drawing', drawingId });
    }

    /** Arm one price alert on the active chart, draw its level line, and tell the user. */
    private createPriceAlert(req: {
        condition: AlertCondition;
        value: number;
        frequency: AlertFrequency;
        bars: number;
        source?: { drawingId: string };
    }): boolean {
        const id = this.activeId;
        if (!id) return false;
        const cell = this.cellsById.get(id);
        if (!cell) return false;
        const symbol = String(cell.symbol ?? '');
        const alert: PriceAlert = {
            id: `a${++this.alertIdSerial}`,
            cellId: id,
            symbol,
            condition: req.condition,
            value: req.value,
            frequency: req.frequency,
            state: 'active',
            createdAt: Date.now(),
            anchorPrice: this.activePrice(),
            bars: req.bars,
            firedAt: 0,
            fires: 0,
            lineId: '',
            source: req.source,
        };
        // A level the price ALREADY crossed would fire on the next tick for a condition the
        // user set on purpose — evaluate once against the current print so the state is
        // honest from the first frame (a `gt` above the market arms, a `gt` below fires).
        const price = this.activePrice();
        let firedImmediately = false;
        if (price != null) {
            // `prev: null` = "no side yet": a crossing cannot have happened at birth, but a
            // Greater/Less-than level the market is already past is true immediately.
            const folded = advanceAlert(alert, { prev: null, now: price, time: Date.now() });
            firedImmediately = folded.fired;
            alert.state = folded.alert.state;
            alert.fires = folded.alert.fires;
            alert.firedAt = folded.fired ? Date.now() : folded.alert.firedAt;
        }
        // A drawing-backed alert needs no level line: the drawing IS the line.
        alert.lineId = alert.source ? '' : (this.drawAlertLevel(cell, alert) ?? '');
        this.priceAlerts.push(alert);
        this.toast(`${alertRowLabel(alert)} — alert created`, 'success', 2600);
        if (firedImmediately) this.recordPriceAlert(alert);
        this.markStateDirty();
        this.moreDrawer?.refreshAlerts?.();
        this.alertPanel.refresh();
        return true;
    }

    /** Draw or reconnect a price alert's own dotted level without taking a user drawing. */
    private drawAlertLevel(cell: ChartCell, alert: PriceAlert, recoverLegacy = false): string | null {
        // A Moving alert's value is a DISTANCE, not a price — there is no level to draw.
        if (isMoveCondition(alert.condition)) { alert.lineOwned = false; return null; }
        try {
            // An explicit durable drawing ID always wins on restoration. Unlike a price
            // match it distinguishes an alert-owned line from the user's own dotted line.
            if (alert.lineId && this.alertLineAt(cell, alert.value, alert.lineId)) return alert.lineId;
            const shared = this.priceAlerts.find((other) => other.id !== alert.id && other.cellId === alert.cellId
                && other.symbol === alert.symbol && !other.source && other.lineOwned && other.value === alert.value
                && other.lineId && this.alertLineAt(cell, alert.value, other.lineId));
            if (shared) { alert.lineOwned = true; return shared.lineId; }
            if (recoverLegacy) {
                // Old documents stored no ID/ownership. Reconnect their matching level,
                // but never delete it: it might have been a manually drawn dotted line.
                const legacy = this.alertLineAt(cell, alert.value);
                if (legacy) { alert.lineOwned = false; return legacy; }
            }
            const time = this.alertBarTime(cell);
            const drawing = cell.chart.drawings.add('hline', {
                anchors: [{ time, price: alert.value }],
                style: { lineStyle: 'dotted', lineWidth: 1 },
            } as never);
            alert.lineOwned = !!drawing;
            return drawing ? String(drawing.id) : null;
        } catch {
            // A renderer without user drawings (the LW path) still gets the alert — the
            // line is a convenience, never a precondition.
            alert.lineOwned = false;
            return null;
        }
    }

    /** A dotted price level, optionally restricted to one exact durable drawing ID. */
    private alertLineAt(cell: ChartCell, price: number, id?: string): string | null {
        try {
            const hit = cell.chart.drawings
                .all()
                .find((d) => (!id || d.id === id) && d.type === 'hline' && d.style?.lineStyle === 'dotted' && d.anchors?.[0]?.price === price);
            return hit ? String(hit.id) : null;
        } catch {
            return null;
        }
    }

    /** Find an exact owned/unowned line in a pooled chart's serialized drawings. */
    private pooledAlertLine(alert: PriceAlert, recoverLegacy = false): string | null {
        type StoredLine = { id?: unknown; type?: unknown; style?: { lineStyle?: unknown }; anchors?: Array<{ price?: unknown }> };
        const raw = this.pool.get(alert.cellId)?.drawings as { drawings?: unknown[] } | undefined;
        if (!raw || !Array.isArray(raw.drawings)) return null;
        const drawings = raw.drawings.filter((drawing): drawing is StoredLine => drawing != null && typeof drawing === 'object');
        const matches = (drawing: StoredLine): boolean => drawing.type === 'hline' && drawing.style?.lineStyle === 'dotted' && drawing.anchors?.[0]?.price === alert.value;
        const existing = alert.lineId && drawings.find((drawing) => drawing.id === alert.lineId && matches(drawing));
        if (existing) return alert.lineId;
        if (!recoverLegacy) return null;
        const hit = drawings.find(matches);
        if (typeof hit?.id !== 'string') return null;
        alert.lineOwned = false;
        return hit.id;
    }

    /** Delete an armed alert (and the drawing it owns). */
    removePriceAlert(alertId: string): void {
        const idx = this.priceAlerts.findIndex((a) => a.id === alertId);
        if (idx < 0) return;
        const alert = this.priceAlerts.splice(idx, 1)[0];
        if (!alert) return;
        this.removeUnsharedAlertLine(alert);
        this.markStateDirty();
        this.moreDrawer?.refreshAlerts?.();
        this.alertPanel?.refresh();
    }

    /** Remove an owned line only when no surviving alert/source still references it. */
    private removeUnsharedAlertLine(alert: PriceAlert): void {
        if (!alert.lineOwned) return; // a legacy-matched/manual line is not ours to remove
        const cell = this.cellsById.get(alert.cellId);
        const lineId = cell ? alert.lineId : (!alert.source && !isMoveCondition(alert.condition) ? this.pooledAlertLine(alert) : null);
        const shared = !!lineId && this.priceAlerts.some((other) => other.cellId === alert.cellId && (other.lineId === lineId || other.source?.drawingId === lineId
            || (!other.lineId && !other.source && !isMoveCondition(other.condition) && other.value === alert.value)));
        if (lineId && !shared) {
            try {
                if (cell) cell.chart.drawings.remove(lineId);
                else {
                    // A hidden chart has no controller; remove only the owned line from
                    // its pooled drawing document so it cannot reappear after deletion.
                    const pooled = this.pool.get(alert.cellId);
                    const doc = pooled?.drawings as { drawings?: unknown[] } | undefined;
                    if (pooled && doc && Array.isArray(doc.drawings)) pooled.drawings = { ...doc, drawings: doc.drawings.filter((drawing) => !drawing || typeof drawing !== 'object' || (drawing as { id?: unknown }).id !== lineId) };
                }
            } catch {
                /* the chart or its drawing may already be gone */
            }
        }
    }

    /** The Alert Manager's rows (one per armed level), newest first. */
    private armedAlertRows(): ArmedAlertRow[] {
        return [...this.priceAlerts].reverse().map((a) => {
            const offChart = this.alertIsOffChart(a) ? a.symbol : null;
            const cell = this.cellsById.get(a.cellId);
            const waitingMarket = !!cell && (cell.chart.loading || !this.alertMarketMatches(cell));
            const drawingLevel = a.source && !offChart && cell && !waitingMarket
                ? this.levelOfDrawing(cell, a.source.drawingId, this.alertBarTime(cell)) : null;
            const waitingDrawing = !!a.source && !!cell && !offChart && !waitingMarket && drawingLevel == null;
            const editUnavailable = !cell ? 'Restore this chart to edit the alert.'
                : waitingMarket ? 'Wait for this chart to finish loading.'
                    : offChart ? `Return this chart to ${offChart} to edit the alert.`
                        : waitingDrawing ? 'Restore the source drawing to edit the alert.'
                            : !a.symbol ? 'The alert has no original symbol to edit safely.' : undefined;
            return {
                id: a.id,
                cellId: a.cellId,
                // Status is shown separately, so the label stays stable across Pause/Resume.
                label: alertRowLabel({ ...a, state: 'active', value: drawingLevel ?? a.value }),
                state: a.state,
                fires: a.fires,
                offChart,
                waitingChart: !cell,
                waitingMarket,
                waitingDrawing,
                frequency: a.frequency,
                drawingSource: !!a.source,
                editUnavailable,
                onDelete: () => this.removePriceAlert(a.id),
            };
        });
    }

    /** Show/hide each armed level line so it only ever appears on its own symbol's chart. */
    private syncAlertLines(cell: ChartCell | undefined): void {
        if (!cell) return;
        const shown = String(cell.symbol ?? '');
        for (const alert of this.priceAlerts) {
            if (alert.cellId !== cell.id || !alert.lineId || !alert.lineOwned) continue;
            const mine = !!alert.symbol && !!shown && alert.symbol === shown;
            try {
                const line = cell.chart.drawings.all().find((drawing) => drawing.id === alert.lineId);
                if (line && line.visible !== mine) cell.chart.drawings.update?.(alert.lineId, { visible: mine });
            } catch {
                /* the line may be gone with the drawing it shared — nothing to sync */
            }
        }
    }

    /** True when the alert's own symbol is NOT what its cell currently shows — the list
     *  says so out loud instead of letting a stale row look armed. */
    alertIsOffChart(alert: PriceAlert): boolean {
        const cell = this.cellsById.get(alert.cellId);
        if (!cell || !alert.symbol) return false;
        return String(cell.symbol ?? '') !== alert.symbol;
    }

    /** Append a close to the cell's rolling window (one entry per BAR — a live tick that
     *  updates the same bar REPLACES its entry, so "within 5 bars" counts bars, not ticks). */
    private pushClose(cellId: string, close: number, time: number): void {
        let hist = this.closeHistory.get(cellId);
        if (!hist) {
            hist = [];
            this.closeHistory.set(cellId, hist);
        }
        let times = this.closeTimes.get(cellId);
        if (!times) {
            times = [];
            this.closeTimes.set(cellId, times);
        }
        const lastTime = times[times.length - 1];
        if (lastTime === time && hist.length > 0) hist[hist.length - 1] = close;
        else {
            hist.push(close);
            times.push(time);
            if (hist.length > PRICE_HISTORY) {
                hist.shift();
                times.shift();
            }
        }
    }

    /** Rebuild moving lookbacks and crossing anchors when the chart replaces its series. */
    private rebaseAlertHistory(cell: ChartCell): void {
        const rendered = cell.chart.renderer.getBars();
        const last = cell.chart.lastBar;
        const bars = rendered.length ? rendered.slice(-PRICE_HISTORY) : last ? [last] : [];
        this.lastPrice.delete(cell.id);
        this.lastBarTime.delete(cell.id);
        this.closeHistory.delete(cell.id);
        this.closeTimes.delete(cell.id);
        for (const bar of bars) {
            if (Number.isFinite(bar.close) && Number.isFinite(bar.time)) this.pushClose(cell.id, bar.close, bar.time);
        }
        const history = this.closeHistory.get(cell.id);
        const times = this.closeTimes.get(cell.id);
        const price = history?.[history.length - 1];
        const time = times?.[times.length - 1];
        if (price != null && time != null) {
            this.lastPrice.set(cell.id, price);
            this.lastBarTime.set(cell.id, time);
            if (this.alertMarketMatches(cell)) for (let i = 0; i < this.priceAlerts.length; i += 1) {
                const alert = this.priceAlerts[i];
                if (alert && alert.cellId === cell.id && alert.state === 'active' && alertWatchesSymbol(alert, String(cell.symbol ?? ''))) {
                    const hasSource = !alert.source || this.levelOfDrawing(cell, alert.source.drawingId, this.alertBarTime(cell)) != null;
                    this.priceAlerts[i] = { ...alert, anchorPrice: hasSource ? price : null };
                }
            }
        }
        if (cell.id === this.activeId) this.alertPanel?.refreshReplay();
        else this.alertPanel?.refresh();
    }

    /** Current chart time for a drawing's level; replay must not use a future live bar. */
    private alertBarTime(cell: ChartCell): number {
        if (cell.chart.replay.state.active) {
            const bars = cell.chart.renderer.getBars();
            const shown = (bars[bars.length - 1] ?? cell.chart.lastBar)?.time;
            if (shown != null && Number.isFinite(shown)) return shown;
        }
        return this.lastBarTime.get(cell.id) ?? Date.now();
    }

    /** The price a drawing sits at, at `time` — the level a drawing-backed alert watches. */
    private levelOfDrawing(cell: ChartCell, drawingId: string, time: number): number | null {
        const doc = cell.chart.drawings.all().find((d) => d.id === drawingId);
        return doc ? drawingLevelAt(doc, time) : null;
    }

    /** Evaluate every armed alert that belongs to this cell against one printed price. */
    private evaluatePriceAlerts(cell: ChartCell, price: number, time: number): void {
        if (this.priceAlerts.length === 0) return;
        let changed = false;
        const shown = String(cell.symbol ?? '');
        for (let i = 0; i < this.priceAlerts.length; i += 1) {
            const current = this.priceAlerts[i];
            if (!current || current.cellId !== cell.id) continue;
            // An alert watches the SYMBOL it was armed on (the cell is one surface that can
            // show any market): a BTC level must never be judged against SOL's tape. The
            // alert simply waits — still armed — until that symbol is back on the cell.
            if (!alertWatchesSymbol(current, shown)) continue;
            if (isMoveCondition(current.condition)) {
                // A Moving alert asks a WINDOW question, not a level one.
                if (current.state !== 'active') continue;
                if (!movingFires(current, this.closeHistory.get(cell.id) ?? [])) continue;
                const next: PriceAlert = {
                    ...current,
                    state: current.frequency === 'once' ? 'fired' : 'active',
                    firedAt: time,
                    fires: current.fires + 1,
                };
                this.priceAlerts[i] = next;
                changed = true;
                this.recordPriceAlert(next);
                continue;
            }
            // A drawing-backed alert watches a MOVING level: re-read the line at this bar.
            // No level here (a horizontal ray before its anchor, a deleted drawing) means the
            // alert simply waits instead of judging against a stale number.
            let watched = current;
            if (current.source) {
                const level = this.levelOfDrawing(cell, current.source.drawingId, time);
                if (level == null) {
                    // For a ray before its anchor, or a temporarily absent source, no
                    // crossing side exists. Re-seed on return instead of replaying a
                    // crossing from the period when the source could not be watched.
                    if (current.anchorPrice != null) { this.priceAlerts[i] = { ...current, anchorPrice: null }; changed = true; }
                    continue;
                }
                watched = current.value === level ? current : { ...current, value: level };
            }
            const prev = watched.anchorPrice;
            const { alert, fired } = advanceAlert(watched, { prev, now: price, time });
            const next = fired ? { ...alert, firedAt: time } : alert;
            if (next !== current) {
                this.priceAlerts[i] = next;
                changed = true;
            }
            if (fired) this.recordPriceAlert(next);
        }
        if (changed) {
            this.markStateDirty();
            this.alertPanel?.refresh();
            this.moreDrawer?.refreshAlerts?.();
        }
    }

    /** Push a fired price alert into the bell's log (the same rows script alerts use). */
    private recordPriceAlert(alert: PriceAlert): void {
        const ticker = String(parseSymbol(alert.symbol).ticker || alert.symbol);
        const condition = describeAlert(alert);
        const label = `${ticker} · ${condition}`;
        this.alerts.unshift({
            cellId: alert.cellId,
            // The row reads "Price alert: Greater than 143.50 — triggered · AAA 1h".
            source: `${ticker} ${timeframeLabel(this.cellsById.get(alert.cellId)?.timeframe ?? '1h')}`.trim(),
            title: 'Price alert',
            message: `${condition} — triggered`,
            time: alert.firedAt || Date.now(),
        });
        if (this.alerts.length > this.alertCap) this.alerts.pop();
        this.syncAlertCount();
        this.alertPanel.refresh();
        this.toastHost.show(`${label} — triggered`, 'success', 5000);
    }

    /** Mount registered attachments not yet mounted on this workspace (idempotent per id). */
    private mountAttachments(): void {
        for (const att of widgetAttachments()) {
            if (this.attachmentDisposers.has(att.id)) continue;
            try {
                this.attachmentDisposers.set(att.id, att.mount(this.context()));
            } catch (err) {
                console.warn(`[vela] workspace attachment "${att.id}" failed to mount:`, err);
            }
        }
    }

    /** Invoke a slot override the way its button would: fresh context, `when` respected. */
    private runOverride(action: WidgetActionDescriptor): void {
        const ctx = this.context();
        if (!action.when || action.when(ctx)) action.run(ctx);
    }

    /** Digits map to the interval ladder a trader expects, not to "the nth item". */
    private static readonly DIGIT_TFS: Record<string, string> = {
        '1': '1',
        '2': '3',
        '3': '5',
        '4': '15',
        '5': '30',
        '6': '60',
        '7': '240',
        '8': 'D',
        '9': 'W',
    };

    /** Point the ACTIVE chart at an interval (the same path the topbar chip takes). */
    private applyTimeframeToActive(timeframe: string): void {
        const cell = this.activeCell();
        if (!cell || cell.timeframe === timeframe) return;
        cell.setTimeframe(timeframe);
        this.topbar.setTimeframe(timeframe);
        this.mobileBar?.setTimeframe(timeframe);
        // No refocus here on purpose: the topbar's interval field would take focus and the
        // NEXT digit would be typed into it (the keymap ignores editable targets), so
        // `7` `8` would set 4h and then do nothing.
    }

    /** Is the active chart's price axis inverted right now? */
    private activeScaleInverted(): boolean {
        return Boolean(this.active.chart.renderer.get('invertScale'));
    }

    /** Alt+G — frame a day on the active chart, keeping the zoom span the user had. The
     *  reference does the same: the window keeps its width and slides to the date. */
    private openGoToDate(): void {
        const doc = this.root.ownerDocument;
        const range = this.active.chart.getVisibleRange();
        const span = range ? Math.max(60_000, range.to - range.from) : 0;
        const seek = (iso: string): void => {
            const at = Date.parse(`${iso}T12:00:00Z`);
            if (!Number.isFinite(at)) return;
            const half = span / 2;
            this.active.chart.setVisibleRange({ from: at - half, to: at + half });
            this.refocusActive();
        };
        this.goToDateDialog?.hide();
        const dlg = new Dialog({
            title: 'Go to date',
            host: this.root,
            align: 'center',
            className: 'vela-gtd',
            onOpenChange: (open) => {
                this.trackDialog(open);
                if (!open) {
                    this.goToDateDialog?.destroy();
                    this.goToDateDialog = null;
                }
            },
        });
        const hint = doc.createElement('div');
        hint.className = 'vela-gtd-hint';
        hint.textContent = 'Jump the chart to a day, keeping the current zoom.';
        hint.style.color = 'var(--vela-fg-muted)';
        hint.style.fontSize = 'var(--vela-font-size-sm)';
        hint.style.paddingBottom = 'var(--vela-space-2)';
        const picker = new DatePicker({
            value: isoDate(new Date(range?.to ?? Date.now())),
            onPick: (iso) => {
                seek(iso);
                dlg.hide();
            },
        });
        dlg.body.append(hint, picker.el);
        this.goToDateDialog = dlg;
        dlg.show();
    }

    /** The default shortcut set — every binding acts on the ACTIVE cell. */
    private registerDefaultKeys(): void {
        // The screenshot chord belongs to the screenshot SLOT — a composition that
        // removes the slot removes its shortcut too, and an OVERRIDE of the slot takes
        // the chord over (a host replacing the surface must not keep the old behavior
        // reachable). Ctrl+Z/Y below are editing primitives and stay regardless of the
        // 'undo-redo' buttons.
        if (topbarHas(this.topbarComp, 'screenshot')) {
            const ov = this.screenshotOverride;
            this.keymap.register({
                id: 'chart.screenshot',
                keys: 'mod+alt+s',
                label: ov ? ov.label : 'Download a screenshot of the layout',
                category: 'Chart',
                run: ov ? () => this.runOverride(ov) : () => this.downloadScreenshot(),
            });
        }
        // Bar replay — the two chords TradingView's replay puts on the keyboard. Both are
        // no-ops outside a session (arming one is the topbar menu's job, not a shortcut's).
        // Registered whether or not the bar exists yet — it is mounted by the first session,
        // and these two chords are what start one from the keyboard.
        if (this.opts.replay !== false) {
            this.keymap.register({ id: 'replay.play-pause', keys: 'shift+arrowdown', label: 'Play / pause the bar replay', category: 'Replay', run: () => this.toggleReplay() });
            this.keymap.register({ id: 'replay.step', keys: 'shift+arrowright', label: 'Step the bar replay forward', category: 'Replay', run: () => this.stepReplay() });
        }
        // Grid chords — TradingView's two: Tab walks the ACTIVE chart, Alt+Enter
        // maximizes it (its Alt+Click sibling lives on the cell's renderer click).
        this.keymap.register({
            id: 'layout.cycle-active',
            keys: 'tab',
            label: 'Switch to the next chart (while the chart itself has focus)',
            category: 'Layout',
            // Tab is the ONLY way to move focus with a keyboard, so it may not be
            // globally rebound: doing that made every control in the shell unreachable
            // (measured: with the layout sheet open, Tab was dead and focus could not
            // leave the first control; WCAG 2.1.1). The chart-cycle stays, but only
            // where the chart itself owns the keystroke — everywhere else Tab moves
            // focus the way the platform says it should.
            // …and it STOPS at the end of the grid. Wrapping forever is a keyboard trap
            // (WCAG 2.1.2): a chart that owns Tab for every press keeps the one control
            // that moves focus, so everything after the grid — the bottom bar, the time
            // zone chip, the footer — is unreachable going forward. Tab walks the charts
            // once and then hands the keystroke back, exactly like leaving any widget.
            when: () => this.def.cells.length > 1 && this.tabBelongsToChart() && this.activeId !== this.lastSlotId,
            run: () => this.cycleActiveCell(),
        });
        this.keymap.register({
            id: 'layout.maximize',
            keys: 'alt+enter',
            label: 'Maximize / restore the active chart',
            category: 'Layout',
            when: () => this.def.cells.length > 1,
            run: () => this.maximizeCell(this.maximizedId ? null : this.activeId),
        });
        // Ctrl/⌘+S — TradingView's "Save changes": write the OPEN layout in place. It is
        // registered even with nothing open so the browser's own Save-page dialog never
        // appears over the chart; with no layout open it explains itself instead.
        this.keymap.register({
            id: 'layout.save',
            keys: 'mod+s',
            label: 'Save changes to the open layout',
            category: 'Layout',
            scope: 'global',
            preventDefault: true,
            run: () => this.saveActiveLayout(),
        });
        this.keymap.register({ id: 'chart.reset-view', keys: 'alt+r', label: 'Reset view (all history)', category: 'Chart', run: () => this.active.chart.setVisibleRangePreset('ALL') });
        this.keymap.register({ id: 'chart.go-to-date', keys: 'alt+g', label: 'Go to a date on the chart', category: 'Chart', run: () => this.openGoToDate() });
        this.keymap.register({ id: 'app.watchlist', keys: 'alt+w', label: 'Open the watchlist & symbol search', category: 'Chart', run: () => this.openSymbolSearch() });
        this.keymap.register({ id: 'chart.toggle-log', keys: 'alt+l', label: 'Toggle logarithmic scale', category: 'Chart', run: () => this.active.chart.renderer.set('logScale', !this.active.chart.renderer.get('logScale')) });
        this.keymap.register({
            id: 'chart.toggle-percent',
            keys: 'alt+p',
            label: 'Toggle percent scale',
            category: 'Chart',
            run: () => {
                const mode = this.active.chart.renderer.get('scaleMode');
                this.active.chart.renderer.set('scaleMode', mode === 'percent' ? 'price' : 'percent');
            },
        });
        this.keymap.register({ id: 'drawings.trendline', keys: 'alt+t', label: 'Arm the trend line tool', category: 'Drawings', run: () => this.active.chart.drawings.setTool('trendline') });
        this.keymap.register({
            id: 'drawings.hline-cursor',
            keys: 'alt+h',
            label: 'Horizontal line at the cursor price',
            category: 'Drawings',
            run: () => {
                const c = this.active;
                if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add('hline', { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
            },
        });
        this.keymap.register({
            id: 'drawings.vline-cursor',
            keys: 'alt+v',
            label: 'Vertical line at the cursor time',
            category: 'Drawings',
            run: () => {
                const c = this.active;
                if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add('vline', { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
            },
        });
        // The rest of the reference's drawing chords: fib (Alt+F), cross (Alt+C) and box
        // (Alt+Shift+R) — arming, not placing, exactly like Alt+T above.
        this.keymap.register({ id: 'drawings.fib', keys: 'alt+f', label: 'Arm the Fib retracement tool', category: 'Drawings', run: () => this.active.chart.drawings.setTool('fibretracement') });
        this.keymap.register({ id: 'drawings.cross', keys: 'alt+c', label: 'Arm the cross line tool', category: 'Drawings', run: () => this.active.chart.drawings.setTool('crossline') });
        this.keymap.register({ id: 'drawings.box', keys: ['alt+shift+r'], label: 'Arm the rectangle (box) tool', category: 'Drawings', run: () => this.active.chart.drawings.setTool('box') });
        // ── The reference's other muscle-memory chords ────────────────────────────────
        // Chosen to match TradingView's defaults so a user arriving from there keeps their
        // hands: alert, invert, hide-all, copy/paste an object, go to date, layouts, and
        // bare digits for the interval.
        if (topbarHas(this.topbarComp, 'alerts')) this.keymap.register({
            id: 'alerts.create',
            keys: 'alt+a',
            label: 'Create an alert on this chart',
            category: 'Alerts',
            run: () => this.openAlertCreate(),
        });
        this.keymap.register({
            id: 'view.invert-scale',
            keys: 'alt+i',
            label: 'Invert the price scale (high at the bottom)',
            category: 'Chart',
            run: () => {
                const chart = this.active.chart;
                chart.renderer.set('invertScale', !this.activeScaleInverted());
            },
        });
        this.keymap.register({
            id: 'drawings.hide-all',
            keys: ['mod+alt+h', 'alt+shift+h'],
            label: 'Hide / show every drawing',
            category: 'Drawings',
            run: () => {
                const d = this.active.chart.drawings;
                // The flag is a VIEW setting: every doc keeps `visible: true` while hidden,
                // so toggling must read the flag itself or the second press is a no-op.
                d.setHiddenAll(!d.hiddenAll);
                this.drawToolbar?.refreshChartTools();
                this.refocusActive();
            },
        });
        this.keymap.register({
            id: 'layout.open',
            keys: '.',
            label: 'Open the layouts & templates panel',
            category: 'Layout',
            run: () => this.openMoreDrawer('layout'),
        });
        // Interval entry: `,` opens the typed interval field (the reference's own entry
        // dialog). A BARE DIGIT is handled in `routeTyping` — one owner for the digits,
        // so pressing `8` cannot both switch to 1D and seed a text field.
        this.keymap.register({
            id: 'chart.timeframe-entry',
            keys: ',',
            label: 'Type an interval (e.g. 15, 4h, 30S)',
            category: 'Chart',
            run: () => this.tfQuick.open(),
        });
        this.keymap.register({ id: 'history.undo', keys: ['mod+z'], label: 'Undo (active chart)', category: 'Edit', run: () => this.undoHistory() });
        this.keymap.register({ id: 'history.redo', keys: ['mod+y', 'mod+shift+z'], label: 'Redo (active chart)', category: 'Edit', run: () => this.redoHistory() });
        this.keymap.register({ id: 'view.zoom-in', keys: 'mod+arrowup', label: 'Zoom in', category: 'Chart', run: () => this.glider.zoom(ZOOM_IN) });
        this.keymap.register({ id: 'view.zoom-out', keys: 'mod+arrowdown', label: 'Zoom out', category: 'Chart', run: () => this.glider.zoom(ZOOM_OUT) });
        // Pan keys mirror a drag exactly (same clamp, same easing) — see Vela.panBy.
        this.keymap.register({ id: 'view.pan-left', keys: 'mod+arrowleft', label: 'Pan toward history', category: 'Chart', run: () => this.active.chart.panBy(-PAN_FAST) });
        this.keymap.register({ id: 'view.pan-right', keys: 'mod+arrowright', label: 'Pan toward now', category: 'Chart', run: () => this.active.chart.panBy(PAN_FAST) });
        // `/` belongs to the indicators SLOT: it opens the built-in picker, or routes
        // to the slot's override — a replaced Indicators surface keeps its shortcut.
        const indOv = this.indicatorsOverride;
        if (indOv && topbarHas(this.topbarComp, 'indicators')) {
            this.keymap.register({ id: 'indicators.open', keys: '/', label: indOv.label, category: 'Indicators', run: () => this.runOverride(indOv) });
        } else if (this.indicatorPicker) {
            this.keymap.register({ id: 'indicators.open', keys: '/', label: 'Open the indicator picker', category: 'Indicators', run: () => this.indicatorPicker?.open() });
        }
        // ⌘K / Ctrl+K — and ⇧⌘P, VS Code's second door. `allowInInput` matters: the
        // palette's own field holds focus while it is open, and a binding muted by
        // typing would be dead exactly when the user reaches for it again.
        this.keymap.register({
            id: 'app.command-palette',
            keys: ['mod+k', 'mod+shift+p'],
            label: 'Open the command palette',
            category: 'Help',
            scope: 'global',
            allowInInput: true,
            run: () => this.openPalette(),
        });
        this.keymap.register({
            id: 'help.shortcuts',
            keys: '?',
            label: 'Show this shortcuts panel',
            category: 'Help',
            run: () => {
                this.shortcutsHelp ??= new ShortcutsHelp(this.keymap, this.root, (open) => this.trackDialog(open));
                this.shortcutsHelp.open();
            },
        });
    }

    // ── command palette ─────────────────────────────────────────────────────────────
    /** Open ⌘K. Public so a host can put a button on it. */
    openPalette(): void {
        this.palette ??= new CommandPalette({
            doc: this.root.ownerDocument,
            host: this.root,
            commands: () => this.paletteCommands(),
            recents: () => this.recentCommands,
            onRun: (id) => this.rememberCommand(id),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.palette.open();
    }

    private rememberCommand(id: string): void {
        this.recentCommands = [id, ...this.recentCommands.filter((x) => x !== id)].slice(0, 8);
        this.markStateDirty();
    }

    /**
     * Everything the palette can run. Shortcuts come straight from the keymap (so a
     * plugin's binding appears with its own label and chord); the rest are the
     * workspace verbs that have no chord — layouts, snapshots, templates, symbols.
     * Ids are stable, because recents are remembered by id across renames.
     */
    private paletteCommands(): PaletteCommand[] {
        const out: PaletteCommand[] = [];
        for (const b of this.keymap.bindings()) {
            if (b.id === 'app.command-palette') continue; // the palette inside the palette
            out.push({
                id: `key:${b.id}`,
                label: b.label,
                category: b.category || 'Shortcuts',
                keys: b.display,
                keywords: b.id.replace(/[.:-]/g, ' '),
                run: () => this.keymap.invoke(b.id),
            });
        }
        // Layouts — by name (registered presets) and by shape (the picker's squares).
        for (const p of this.presetRows()) {
            out.push({
                id: `layout:${p.id}`,
                label: `Layout — ${p.label}`,
                category: 'Layout',
                keywords: 'layout grid charts',
                ...(p.cells ? { hint: `${p.cells} chart${p.cells === 1 ? '' : 's'}` } : {}),
                run: () => this.setLayout(p.id),
            });
        }
        for (const [rows, cols] of [[1, 2], [2, 1], [2, 2], [2, 3], [3, 2], [3, 3], [4, 4]] as const) {
            const id = layoutForGrid(rows, cols).id;
            if (this.presetRows().some((p) => p.id === id)) continue;
            out.push({
                id: `layout:${id}`,
                label: `Layout — ${cols} × ${rows} grid`,
                category: 'Layout',
                keywords: 'layout grid charts',
                hint: `${rows * cols} charts`,
                run: () => this.setLayout(id),
            });
        }
        // Saved snapshots.
        for (const l of this.savedLayoutList()) {
            out.push({
                id: `saved:${l.name}`,
                label: `Open saved layout “${l.name}”`,
                category: 'Saved layouts',
                keywords: 'snapshot restore',
                run: () => this.openLayout(l.name),
            });
        }
        // Templates — the two documented destinations.
        for (const t of this.templateList()) {
            out.push({
                id: `tpl-active:${t.name}`,
                label: `Template “${t.name}” → this chart`,
                category: 'Templates',
                keywords: 'indicator template apply',
                hint: `${t.count} ind.`,
                run: () => this.applyTemplate(t.name, 'active'),
            });
            if (this.cellsById.size > 1) {
                out.push({
                    id: `tpl-all:${t.name}`,
                    label: `Template “${t.name}” → every chart`,
                    category: 'Templates',
                    keywords: 'indicator template apply all',
                    hint: `${t.count} ind.`,
                    run: () => this.applyTemplate(t.name, 'all'),
                });
            }
        }
        // Watchlist — one command per symbol puts it on EVERY chart.
        for (const symbol of this.watchlist) {
            out.push({
                id: `symbol-all:${symbol}`,
                label: `Symbol ${symbol} → every chart`,
                category: 'Symbols',
                keywords: 'watchlist all charts batch',
                run: () => this.setSymbolForAll(symbol),
            });
        }
        const activeSymbol = this.active?.symbol;
        if (activeSymbol) {
            out.push({
                id: `watch-add:${activeSymbol}`,
                label: `Add ${activeSymbol} to the watchlist`,
                category: 'Symbols',
                keywords: 'watchlist star add',
                run: () => this.addToWatchlist(activeSymbol),
            });
        }
        if (topbarHas(this.topbarComp, 'alerts')) out.push({
            id: 'view:alerts',
            label: 'Alerts — every chart, grouped',
            category: 'View',
            keywords: 'bell notifications list',
            run: () => this.dock.toggle('alerts', true),
        });
        out.push(
            {
                id: 'view:shortcuts',
                label: 'Keyboard shortcuts',
                category: 'Help',
                keywords: 'keys help',
                run: () => {
                    this.shortcutsHelp ??= new ShortcutsHelp(this.keymap, this.root, (open) => this.trackDialog(open));
                    this.shortcutsHelp.open();
                },
            },
            {
                id: 'view:screenshot',
                label: 'Download a screenshot of the layout',
                category: 'View',
                keywords: 'png image capture',
                run: () => this.downloadScreenshot(),
            },
        );
        return out;
    }

    /** Bare-typing router: letters and `0` → symbol search (seeded), digits 1–9 → the
     *  instant interval ladder, digits typed inside the open entry → that entry. */
    private routeTyping(ev: KeyboardEvent): void {
        if (this.destroyed) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isEditableTarget(ev)) return; // never hijack a keystroke someone is TYPING
        const target = ev.target as Element | null;
        if (typeof target?.closest === 'function' && target.closest('.vela-panel')) return;
        const hit = resolveTyping(ev.key, { dialogs: this.openDialogs, symbolSearch: this.symbolPicker.isOpen, timeframeEntry: this.tfQuick.isOpen });
        if (!hit) return;
        ev.preventDefault();
        if (hit.target === 'symbol') {
            this.symbolPicker.type(hit.text);
            return;
        }
        // A bare digit from the idle workspace is the reference's instant interval chord
        // (`8` → 1D). Only a digit typed INTO the open entry extends the entry, so the
        // two never fight over the same keystroke.
        if (this.openDialogs === 0) {
            const tf = VelaWorkspace.DIGIT_TFS[ev.key];
            if (tf) this.applyTimeframeToActive(tf);
            return;
        }
        this.tfQuick.type(hit.text);
    }

    private trackDialog(open: boolean): void {
        this.openDialogs = Math.max(0, this.openDialogs + (open ? 1 : -1));
        // D4: a modal sheet already traps focus, but the chart behind it stayed in the
        // accessibility tree and reachable by keyboard. `inert` on every shell child except
        // the sheet (and its own backdrop, which must keep taking the dismiss tap) makes the
        // word "modal" true for a screen reader too.
        this.applyModalInert(this.openDialogs > 0);
        if (open) this.keymap.pushScope('dialog');
        else this.keymap.popScope('dialog');
    }

    /** Inert the chrome behind an open sheet (see `trackDialog`). The sheet and its own
     *  backdrop are skipped; everything else in the shell goes quiet until it closes. */
    private applyModalInert(open: boolean): void {
        for (const el of [...this.root.children] as HTMLElement[]) {
            if (el.classList.contains('vela-drawer-backdrop') || el.classList.contains('vela-dialog-backdrop')) continue;
            const hostsSheet = el.matches('.vela-drawer-positioner, .vela-dialog-positioner') && el.querySelector('[role="dialog"]') !== null;
            if (hostsSheet) continue;
            if (open) {
                el.setAttribute('inert', '');
                el.dataset.velaInert = '1';
            } else if (el.dataset.velaInert) {
                el.removeAttribute('inert');
                delete el.dataset.velaInert;
            }
        }
    }

    /** Pool a dehydrated slot state (bounded — oldest entries drop past the cap). */
    private poolSet(id: string, state: PooledCellState): void {
        this.pool.delete(id);
        this.pool.set(id, state);
        if (this.pool.size > POOL_CAP) {
            const oldest = this.pool.keys().next().value;
            if (oldest != null) {
                this.pool.delete(oldest);
                this.compareAxisSwitched.delete(oldest);
                this.forgetCompareMirrors(oldest);
            }
            this.notePoolDrop();
        }
        this.syncMobileHidden();
    }

    /**
     * The pool holds at most {@link POOL_CAP} dormant charts. Past that the OLDEST is
     * dropped — right, but it used to happen in silence: the trader shrinks a 16-chart
     * grid to 4 and later finds half their setups gone with no explanation. One notice
     * per session, naming the ceiling, turns a mystery into a rule they can work with.
     */
    private notePoolDrop(): void {
        if (this.poolDropNoticed) return;
        this.poolDropNoticed = true;
        this.toast(
            `Only ${POOL_CAP} hidden charts are kept — the oldest one was dropped. Reopening that slot starts it fresh.`,
            'info',
            6500,
        );
    }

    /** The dormant-chart ceiling and what is currently in the pool. */
    poolCapacity(): number {
        return POOL_CAP;
    }

    pooledCount(): number {
        return this.pool.size;
    }

    /**
     * Declare every live cell's symbol to the shared bar cache so one cell's load never
     * evicts the others' history (multi-symbol retention). Keys are CANONICAL tickers —
     * resolved through the registry when its indexes are ready, raw until then (refreshed
     * again on `feed.ready()`).
     */
    private refreshRetention(): void {
        const symbols = new Set<string>();
        for (const cell of this.cellsById.values()) {
            const raw = cell.symbol;
            if (!raw) continue;
            symbols.add(this.feed.resolveSymbol(raw)?.ticker ?? raw);
        }
        sharedBarStore.retain(symbols, this);
    }
}
