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
import type { VelaTheme, NativeBackend, VelaOptions } from '../core/options';
import type { VelaShellOptions } from '../widget/shell-options';
import { resolveTheme } from '../core/theme';
import { TypedEventBus } from '../core/events/EventBus';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import { sharedBarStore } from '../data/BarStore';
import { ensureUIHost, injectStyles, registerIcon, svg16 } from '../ui';
import { installSmoothScrolling } from '../ui/scrolling';
import { isEditableTarget, KeymapManager } from '../ui/keymap';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Popover } from '../ui/components/popover';
import { DatePicker, isoDate } from '../ui/components/date-picker';
import { ReplayToolbar, REPLAY_CALENDAR_CLASS, REPLAY_DEFAULT_SPEED } from '../widget/replay-toolbar';
import type { Vela } from '../Vela';
import { joinWorkspaceLink } from './link';
import { Topbar, priceStyleLabel, priceStyleIcon, priceStyleMarkup } from '../widget/topbar';
import { Bottombar, RANGE_PRESETS } from '../widget/bottombar';
import { SecondClock } from '../core/util/wall-clock';
import { ObjectTree } from '../widget/object-tree';
import { DataWindow } from '../widget/data-window';
import type { ScriptRun } from '../core/script-run';
import { PanelDock } from '../widget/panel-dock';
import { SymbolPicker } from '../widget/symbol-picker';
import { IndicatorPicker, indicatorKey } from '../widget/indicator-picker';
import { TimeframeQuick } from '../widget/timeframe-quick';
import { ShortcutsHelp } from '../widget/shortcuts-help';
import { AlertList } from '../widget/alert-list';
import { Tip } from '../widget/tip';
import { REDUCED_MOTION_CSS } from '../ui/motion';
import { CommandPalette, type PaletteCommand } from '../widget/command-palette';
import { Toast } from '../widget/toast';
import { recordRecent, recentOf } from '../widget/favorites';
import { Glider, ZOOM_IN, ZOOM_OUT, PAN_FAST } from '../widget/glide';
import { toolShortcutHints } from '../widget/tool-shortcuts';
import { legendActionsProviderFor, legendCalloutsProviderFor, mobilePlacement, statePersistenceHandlers, topbarActionOverride, widgetActions, widgetAttachments, type WidgetActionDescriptor } from '../widget/contributions';
import { resolveTopbarComposition, topbarHas, TOPBAR_BUILTIN_IDS, type ResolvedTopbarComposition } from '../widget/topbar-composition';
import { LayoutModeController, type LayoutMode } from '../widget/layout-mode';
import { MobileBar } from '../widget/mobile-bar';
import { TimeframeDrawer } from '../widget/timeframe-drawer';
import { DrawingsDrawer } from '../widget/drawings-drawer';
import { MoreDrawer } from '../widget/more-drawer';
import { TimezoneDrawer } from '../widget/timezone-drawer';
import { PriceScaleDrawer } from '../widget/price-scale-drawer';
import { DrawingPill } from '../widget/drawing-pill';
import { priceStyleIds } from '../renderers/native/core/chartConfig';
import { resolveIndicators, type IndicatorManifest, type ResolvedIndicator } from '../widget/indicators';
import { DrawingToolbar } from '../renderers/native/drawings/DrawingToolbar';
import { applyAttributionMarkTheme, createAttributionMark, createCustomMark } from '../renderers/native/chrome/AttributionMark';
import { rendererDefaults } from '../core/renderer-defaults';
import { buildToolbar, getDrawingType, templateColor, type DrawingTypeKey, type SerializedDrawing, type SnapMode, type ToolbarDefinition } from '../core/drawings';
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
import { ChartCell, seedDefaults, cellChartDefaults, type CellSeed, type CellBoot, type PooledCellState } from './ChartCell';
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
}
.vela-ws-skip:focus { top: 10px; outline: 2px solid var(--vela-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { .vela-ws-skip { transition: top 120ms cubic-bezier(.2,.7,.3,1); } }
.vela-ws-main:focus { outline: none; }
.vela-ws-main:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-ws-main { position: relative; display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; }
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

export class VelaWorkspace {
    readonly root: HTMLElement;
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
    /** The side-panel column, shared by the whole grid. */
    private readonly dock: PanelDock;
    private readonly symbolPicker: SymbolPicker;
    /** Null when the host disabled it (`indicatorPicker: false`). */
    private readonly indicatorPicker: IndicatorPicker | null;
    private readonly tfQuick: TimeframeQuick;
    private shortcutsHelp: ShortcutsHelp | null = null;
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
    /** Live subscription to the ACTIVE cell's unified history (rebound on every projection). */
    private historyUnsub: (() => void) | null = null;
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
    private groupTip: Tip | null = null;
    private groupTipTimer: ReturnType<typeof setTimeout> | null = null;
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
    /** Autosave + the house template for new charts (see `WorkspaceState.layoutPrefs`). */
    private layoutPrefs: { autosave: boolean; defaultTemplate: string | null } = { autosave: false, defaultTemplate: null };
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
    private alertsMenu: Menu | null = null;
    /** The grouped alert list (the bell's real surface: per chart, per alert). */
    private alertList: AlertList | null = null;
    /** ⌘K palette — built lazily on first open. */
    private palette: CommandPalette | null = null;
    /** Recently run palette commands, newest first (persisted with the document). */
    private recentCommands: string[] = [];
    // ── mobile chrome (same components as the widget shell; CSS keys off data-layout
    // on the root, the drawers build lazily on first open and act on the ACTIVE cell) ──
    /** Writes `data-layout` on the root and pushes mode flips into every cell's renderer. */
    private layoutCtl!: LayoutModeController;
    private readonly mobileBar: MobileBar | null;
    /** Replay scope the entry menu holds ("Replay all charts"). */
    private replayScope: 'all' | 'cell' = 'all';
    private readonly drawingPill: DrawingPill | null;
    private tfDrawer: TimeframeDrawer | null = null;
    private drawingsDrawer: DrawingsDrawer | null = null;
    private moreDrawer: MoreDrawer | null = null;
    private timezoneDrawer: TimezoneDrawer | null = null;
    private priceScaleDrawer: PriceScaleDrawer | null = null;
    /** Plot-local y of the last price-axis long-press (targets the pane under the finger). */
    private priceScalePressY = 0;
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
                    if (decoded.state) this.applyState(decoded.state);
                    else this.rescueUnreadable(r, decoded.reason);
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
        if (boot?.charts) for (const { id, ...cs } of boot.charts) this.pool.set(id, cs);
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
        // One global rule for the CSS half of `prefers-reduced-motion` (the canvas half
        // lives in NativeRenderer). Scoped to the library's roots, injected once.
        injectStyles('vela-reduced-motion', REDUCED_MOTION_CSS, doc);
        installSmoothScrolling(doc);
        this.root = doc.createElement('div');
        this.root.className = 'vela-workspace';
        // First child on purpose: it must be the FIRST stop in the document.
        this.mainId = `vela-ws-main-${(workspaceSeq += 1)}`;
        const skip = doc.createElement('a');
        skip.className = 'vela-ws-skip';
        skip.href = `#${this.mainId}`;
        skip.textContent = 'Skip to charts';
        this.root.appendChild(skip);
        ensureUIHost(this.root, resolveTheme(opts.theme));

        // ONE shared feed: providers registered once; every cell's `chart.data` operates
        // on the same registry, symbol index, and closed-bar cache.
        for (const [name, make] of Object.entries(opts.providers ?? {})) void this.feed.registerProvider(name, make());
        void this.feed.ready().then(() => {
            if (!this.destroyed) this.refreshRetention(); // re-key on canonical tickers once indexes settle
        });

        // ── shared dialogs/pickers (they act on the ACTIVE cell at call time) ──
        this.symbolPicker = new SymbolPicker({
            host: this.root,
            // Row icons come from each descriptor's OWNING provider (resolveSymbolIcon).
            iconFor: (d) => this.feed.symbolIconOf(d),
            onSelect: (ticker) => this.active.setSymbol(ticker),
            // The watchlist: the trader's shortlist at the top of the picker, a star on
            // every row, and (multi-chart) one tap to put a symbol on EVERY chart.
            watchlist: () => this.watchlist,
            onToggleWatch: (symbol, on) => {
                if (on) this.addToWatchlist(symbol);
                else this.removeFromWatchlist(symbol);
            },
            ...(this.def.cells.length > 1 ? { onApplyAll: (symbol: string) => this.setSymbolForAll(symbol) } : {}),
            onOpenChange: (open) => {
                // In-chart dialogs (indicator inputs, chart settings) live inside a cell's
                // chart container, so opening the search from the topbar never hits their
                // outside-dismiss — close them on every cell explicitly.
                if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                this.trackDialog(open);
                this.mobileBar?.setExpanded('symbol', open);
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
                      library: () => this.active.libraryRows(),
                      onChart: () => this.active.onChartRows(),
                      onAdd: (i) => {
                          this.active.addFromLibrary(i);
                          // The clock tab's feed — the habit, not the promise (a star).
                          const row = this.active.libraryRows()[i];
                          if (row) recordRecent('indicators', indicatorKey(row));
                      },
                      onRemove: (i) => this.active.removeFromChart(i),
                      onSettings: (i) => this.active.openChartRowSettings(i),
                      favorites: () => this.indFavs,
                      onFavorite: (key, on) => this.setIndicatorFavorite(key, on),
                      recent: () => recentOf('indicators'),
                      onOpenChange: (open) => {
                          // Same rule as the symbol search: the renderer's in-chart dialogs never see
                          // an outside-dismiss from a topbar dialog — close them on every cell.
                          if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                          this.trackDialog(open);
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

        // ── topbar (shared) — reflects the active cell; the layout dropdown reads the registry live ──
        this.topbar = new Topbar(this.root, {
            symbol: '',
            // RAW option, not the resolved lists — the bar distinguishes a host-declared
            // side (list is law) from a default one (an override's `order` may flow).
            composition: opts.topbar,
            onSymbolClick: () => this.symbolPicker.open(),
            ...(picker ? { onIndicatorsClick: () => picker.open() } : {}),
            onUndoClick: () => this.active.history.undo(),
            onRedoClick: () => this.active.history.redo(),
            onScreenshotClick: () => this.downloadScreenshot(),
            onAlertsClick: (anchor) => this.openAlertsMenu(anchor),
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
                templates: () => this.templateList(),
                onSaveTemplate: (name, includeMarket) => this.saveTemplate(name, { includeMarket }),
                onApplyTemplate: (name, target) => this.applyTemplate(name, target),
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
            getContext: () => this.context(),
        });

        // ── main row: the shared drawing toolbar + the grid + the docked side panels ──
        const main = doc.createElement('div');
        main.className = 'vela-ws-main';
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
        }
        this.gridEl = doc.createElement('div');
        this.gridEl.className = 'vela-ws-grid';
        main.appendChild(this.gridEl);
        // One dock for the WHOLE grid (the panels follow the active cell), owning the built-ins,
        // the contributed panels, the single-open rule and the topbar's toggle group.
        this.dock = new PanelDock(main, {
            chrome: this.topbar,
            context: () => this.context(),
            changed: () => this.markStateDirty(),
        });
        this.objectTree = new ObjectTree(main, (sym) => this.feed.symbolIcon(sym));
        this.dataWindow = new DataWindow(main);
        this.dock.addBuiltIn({ id: 'dataWindow', title: 'Data window', icon: 'datawindow', order: 10, panel: this.dataWindow, onChart: (c) => this.dataWindow.onChart(c) });
        this.dock.addBuiltIn({ id: 'objects', title: 'Object tree', icon: 'objects', order: 20, panel: this.objectTree, onChart: (c) => this.objectTree.onChart(c) });
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
        this.mountReplayBar();

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

        // The mobile bar is the bottom bar of the mobile size class — the same chrome
        // toggle governs both; CSS (data-layout) decides which one is visible. Every
        // route acts on the ACTIVE cell, exactly like the topbar it replaces.
        this.mobileBar =
            opts.bottombar !== false
                ? new MobileBar(this.root, {
                      symbol: '',
                      timeframe: '60',
                      onSymbolClick: () => this.symbolPicker.open(),
                      onTimeframeClick: () => this.openTimeframeDrawer(),
                      // Same visibility truth as the desktop bar: composition-hidden
                      // indicators lose their mobile stop too; an override takes it over.
                      ...(topbarHas(this.topbarComp, 'indicators') && (picker || this.indicatorsOverride)
                          ? { onIndicatorsClick: this.indicatorsOverride ? () => this.runOverride(this.indicatorsOverride!) : () => picker!.open() }
                          : {}),
                      getContext: () => this.context(),
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
                                onLayoutClick: () => this.openMoreDrawer('layout'),
                            }),
                      onMoreClick: () => this.openMoreDrawer(),
                      onSettingsClick: () => this.active.chart.renderer.openSettings(),
                  })
                : null;
        // One strip for the whole grid — rebound to the active cell on every projection.
        // It docks in the flow ABOVE the bottom bar (never over the plot: the old floating
        // pill covered the last row's time axis). Without a bottom bar it falls back to the
        // grid, where CSS pins it to the bottom edge.
        const drawHost =
            this.mobileBar && this.mobileBar.el.parentElement === this.root
                ? this.root.insertBefore(doc.createElement('div'), this.mobileBar.el)
                : this.gridEl;
        drawHost.className = this.mobileBar ? 'vela-ws-drawdock' : drawHost.className;
        this.drawingPill = this.drawingsEnabled ? new DrawingPill(drawHost) : null;

        hostEl.appendChild(this.root);

        // Measured AFTER the root is in the DOM so the first evaluation sees a real width.
        this.layoutCtl = new LayoutModeController(this.root, opts.layoutMode ?? 'auto');
        this.layoutCtl.onChange((mode) => this.onLayoutModeChange(mode));

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
        this.syncCellPresentation();
        this.setActiveCell(bootActive != null && this.cellsById.has(bootActive) ? bootActive : (this.order[0] ?? null));
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
            openSymbolSearch: (query) => this.symbolPicker.open(query ?? ''),
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
        for (const [id, cell] of this.cellsById) byId.set(id, cell.dehydrate()); // live slots win
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
        const state: WorkspaceState = { version: 1, layout: this.def.id, timezone: this.timezone, sync: { ...this.syncOpts }, charts };
        if (this.cursorStyle !== 'cross') state.cursor = this.cursorStyle;
        if (this.activeId) state.activeCellId = this.activeId;
        if (this.favs.length > 0) state.favorites = [...this.favs];
        if (this.tfFavs.length > 0) state.timeframeFavorites = [...this.tfFavs];
        if (this.styleFavs.length > 0) state.chartTypeFavorites = [...this.styleFavs];
        if (this.indFavs.length > 0) state.indicatorFavorites = [...this.indFavs];
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
        if (this.layoutPrefs.autosave || this.layoutPrefs.defaultTemplate) {
            state.layoutPrefs = {
                ...(this.layoutPrefs.autosave ? { autosave: true } : {}),
                ...(this.layoutPrefs.defaultTemplate ? { defaultTemplate: this.layoutPrefs.defaultTemplate } : {}),
            };
        }
        if (this.templates.size > 0) {
            state.templates = Object.fromEntries(
                [...this.templates].map(([k, v]) => [k, { ...v, indicators: [...v.indicators] }]),
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
        if (st.layoutPrefs) {
            this.layoutPrefs.autosave = st.layoutPrefs.autosave === true;
            this.layoutPrefs.defaultTemplate = st.layoutPrefs.defaultTemplate ?? null;
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

    applyState(state: unknown): void {
        if (this.destroyed) return;
        const st = sanitizeState(state);
        if (!st) return;
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
        this.syncCellPresentation();
        this.topbar.setLayout(this.def.id);
        const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : (this.order[0] ?? null);
        if (nextActive === this.activeId) this.projectActiveCell();
        else this.setActiveCell(nextActive);
        this.refreshRetention();
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
        this.drawToolbar?.setTheme(t);
        if (this.attributionMark) applyAttributionMarkTheme(this.attributionMark, t.background);
        // Each cell's own `setTheme` no-ops once the theme already matches, so the
        // per-cell `theme:changed` echoes (see wireCell) terminate immediately.
        for (const cell of this.cellsById.values()) cell.chart.setTheme(t);
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
        for (const [id, cell] of [...this.cellsById]) {
            if (!keep.has(id) || rebuildAll) {
                this.poolSet(id, cell.dehydrate());
                cell.destroy();
                this.cellsById.delete(id);
                this.events.emit('cell:destroyed', { id });
            }
        }
        this.def = next;
        this.cellBackend = nextBackend;
        this.applyGrid();
        this.buildCells();
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
     * The next chart in slot order, wrapping at the end — `Tab`'s reducer. Skips nothing:
     * a maximized grid still cycles (maximize follows the active cell on the next
     * `maximizeCell`, so Tab while maximized simply selects).
     */
    private cycleActiveCell(): void {
        const ids = this.order.slice(0, this.def.cells.length);
        if (ids.length < 2) return;
        const at = this.activeId ? ids.indexOf(this.activeId) : -1;
        this.setActiveCell(ids[(at + 1) % ids.length] ?? ids[0]!);
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
        this.dismissGroupTip(false);
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
        this.moreDrawer?.destroy();
        this.timezoneDrawer?.destroy();
        this.priceScaleDrawer?.destroy();
        this.layoutCtl.destroy();
        this.dock.destroy(); // contributed panels; the two built-ins are ours to drop
        this.objectTree.destroy();
        this.dataWindow.destroy();
        this.symbolPicker.destroy();
        this.indicatorPicker?.destroy();
        this.tfQuick.destroy();
        this.shortcutsHelp?.destroy();
        this.toastHost.destroy();
        this.alertsMenu?.destroy();
        this.disarmReplay();
        this.replayDatePop?.destroy();
        this.replayMenu?.destroy();
        this.replayBar?.destroy();
        this.glider.stop();
        sharedBarStore.retain(new Set(), this); // release OUR declaration only — other shells on the page keep theirs
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
        this.syncMobileMaximize(); // the new active cell may hold a maximized pane
        this.mobileBar?.onChart(cell.chart); // its drawings stop mirrors the ACTIVE cell's tool
        this.drawingPill?.onChart(cell.chart); // the pill mirrors the ACTIVE cell's tool state
        const pushHistory = (): void => this.topbar.setHistoryState(cell.history.canUndo, cell.history.canRedo);
        this.historyUnsub?.();
        this.historyUnsub = cell.history.onChange(pushHistory);
        pushHistory();
        this.objectTree.setSymbol(cell.symbol);
        this.dock.onChart(cell.chart); // every docked panel follows the active cell
        this.bottombar?.setActiveRange(cell.activeRangeId);
        this.bottombar?.setSession({ session: cell.session, enabled: cell.sessionAvailable });
        this.projectTimezone(); // under the exchange rule the bar's zone is the active cell's
        this.indicatorPicker?.sync(); // the dialog may be open while the active cell changes
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
        this.docRevision += 1;
        this.scheduleAutosave();
        if (this.stateTimer != null) clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => {
            this.stateTimer = null;
            this.events.emit('state:changed', undefined);
            this.persistNow();
        }, 500);
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
            const pooled = this.pool.get(id);
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
                ...(this.def.cells.length > 1 ? { applySettingsToAll: (cellId: string) => this.applySettingsToAll(cellId) } : {}),
                ...(this.def.cells.length > 1 && !this.monoLayout ? { openSyncGesture: (cellId: string) => this.openSyncSurface(cellId) } : {}),
            });
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
            cell.setControlsSuspended(this.layoutCtl.current === 'mobile');
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
            // Third-party state last — the cell is wired and its core state is in
            // place, so a handler's restore (e.g. re-adding external indicators) lands
            // on a cell the workspace fully knows. Runs muted (no undo entries).
            cell.restorePersistedExt();
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

    /** The sync surfaces (phone sheet, desktop popover) number the charts while they are
     *  up — a number with nothing to match it against is just noise. */
    private setSyncSurfaceOpen(open: boolean): void {
        this.syncSurfaceOpen = open;
        if (open) this.root.setAttribute('data-sync-open', '1');
        else this.root.removeAttribute('data-sync-open');
        // The layout sheet COVERS the badge a coach mark points at: retire it on the way
        // in (the open itself is the journey the mark was advertising).
        if (open && this.groupTip) this.dismissGroupTip(true);
    }

    /** Per-cell chart subscriptions (trigger ② — the chart instance is stable for the
     *  cell's whole life, so these live and die with the cell). */
    private wireCell(cell: ChartCell): void {
        const chart = cell.chart;
        chart.on('indicator:error', ({ error }) => this.toastHost.show(`[${cell.id}] ${error.message}`, 'error', 5000));
        // Script runs relay up with the cell they came from, so ONE subscription on the
        // workspace covers a grid whose cells come and go. Each cell runs its own engine
        // session, so the `cell` field is what tells two identical scripts apart.
        chart.on('script:run', (run) => this.events.emit('script:run', { ...run, cell: cell.id }));
        chart.on('priceStyle:change', ({ from, to }) => this.events.emit('cell:priceStyle', { id: cell.id, from, to }));
        chart.on('alert', (alert) => {
            // Provenance the way a user reads it — symbol, timeframe, and the indicator
            // that fired — captured at fire time (the cell may switch markets later).
            const source = [parseSymbol(cell.symbol).ticker || cell.symbol, timeframeLabel(cell.timeframe), alert.indicator]
                .filter(Boolean)
                .join(' ');
            this.alerts.unshift({ cellId: cell.id, source, title: alert.title ?? 'Alert', message: alert.message, time: alert.time });
            this.alertList?.refresh();
            if (this.alerts.length > this.alertCap) this.alerts.pop();
            this.toastHost.show(`${source} — ${alert.title ? alert.title + ' — ' : ''}${alert.message}`, 'info', 4000);
            this.topbar.setAlertCount(this.alerts.length);
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
            this.propagateDrawingEdit(cell.id, id);
            this.markStateDirty();
        });
        chart.on('drawing:removed', ({ id }) => {
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
        chart.renderer.onConfigChanged(() => this.propagateStylePrefs(cell.id));
        // A theme picked in ONE cell (its settings dialog's Canvas → Theme) re-skins the
        // WHOLE workspace — shared chrome plus every other cell.
        chart.on('theme:changed', (t) => this.setTheme(t));
        // Pane collapse/maximize in the ACTIVE cell (double-tap on mobile, API) —
        // keep the mobile bar's maximize stop truthful.
        chart.on('pane:changed', () => {
            if (cell.id === this.activeId) this.syncMobileMaximize();
        });
        // Mobile: long-press an axis strip → timezone / price-scale sheet (desktop keeps
        // the right-click menu). The press's own pointerdown already activated the cell.
        chart.renderer.onAxisLongPress((e) => {
            if (this.layoutCtl.current !== 'mobile') return;
            if (e.axis === 'time') this.openTimezoneDrawer();
            else this.openPriceScaleDrawer(e.y);
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
                cell.setSyncedCrosshair(null);
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
                const copy = handle.source !== undefined
                    ? cell.chart.addIndicator(handle.source, { inputs, props })
                    : handle.nativeType
                      ? cell.chart.addNativeIndicator(handle.nativeType, { inputs })
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
                const copy = h.source !== undefined
                    ? target.chart.addIndicator(h.source, { inputs, props })
                    : h.nativeType
                      ? target.chart.addNativeIndicator(h.nativeType, { inputs })
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

    /** Open the layout sheet at its sync block for ONE chart (the status line's marks are
     *  the tap target — you mark the chart you are looking at, not the "active" one). */
    openSyncDrawer(cellId?: string): void {
        if (cellId && this.cellsById.has(cellId) && cellId !== this.activeId) this.setActiveCell(cellId);
        this.openMoreDrawer('layout', 'sync', cellId);
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
        // The ring's job is done the moment any chart joins a group (the user has found
        // the mechanism), or when the grid is no longer linkable at all.
        if (this.groupTip && (!linkable || [...marks.values()].some((m) => m.length > 0))) {
            this.dismissGroupTip(true);
        } else if (!this.groupTip && linkable) {
            this.maybeShowGroupTip();
        }
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
            manifest: [],
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
            count: t.indicators.length,
            ...(t.symbol ? { symbol: t.symbol } : {}),
            ...(t.timeframe ? { timeframe: t.timeframe } : {}),
        }));
    }

    /**
     * Capture the ACTIVE chart's indicator set as `name` (replacing a same-named
     * template — TradingView asks "replace?", the caller owns that prompt).
     * `includeMarket` also stores the symbol/timeframe, so applying the template
     * switches the chart's market; leave it off for a market-agnostic setup.
     */
    /** Every saved drawing template as a flat list (tool key + label, name, swatch color). */
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

    saveTemplate(name: string, opts: { includeMarket?: boolean } = {}): boolean {
        const key = name.trim().slice(0, 40);
        if (!key || !this.activeId) return false;
        const cell = this.cellsById.get(this.activeId);
        if (!cell) return false;
        const ledger = cell.indicatorLedger();
        const template: ChartTemplate = {
            version: 1,
            indicators: ledger.natives.map((e) => (typeof e === 'string' ? e : { ...e })),
        };
        if (opts.includeMarket) {
            template.symbol = cell.symbol;
            template.timeframe = cell.timeframe;
        }
        this.templates.set(key, template);
        this.markStateDirty();
        this.toast(`Template “${key}” saved (${template.indicators.length} indicator${template.indicators.length === 1 ? '' : 's'})`, 'success');
        return true;
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
        for (const id of ids) {
            const cell = this.cellsById.get(id);
            if (!cell) continue;
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
        return name;
    }

    // ── watchlist + batch symbols ────────────────────────────────────────────────────
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

    // ── one-time tips ───────────────────────────────────────────────────────────────
    /**
     * The ◌ coach mark. On a grid an unmarked chart shows a hollow ring on its status
     * line — truthful, but a ring explains nothing. Once per workspace (a `seenTips`
     * record, so it survives reloads and never nags), the first time such a chart is on
     * screen, a small card points at the ring and says what pressing it does.
     *
     * Deliberately NOT a modal, NOT focus-stealing, and NOT tied to an event the user
     * did not ask for: it appears a beat after the layout settles, and any of the three
     * obvious answers (the ×, Escape, the badge itself) retires it for good.
     */
    private maybeShowGroupTip(): void {
        if (this.destroyed || this.monoLayout || this.cellsById.size < 2) return;
        // Never while a popover, dialog or the layout sheet is open: the card points at a
        // badge INSIDE the grid, and a coach mark floating over the sheet points at
        // nothing. Closing the last one re-arms it (see `trackDialog`).
        if (this.openDialogs > 0 || this.syncSurfaceOpen) return;
        if (this.groupTip || this.groupTipTimer != null || this.hasSeenTip('group-badge')) return;
        const first = this.cellsById.get(this.order[0] ?? '') ?? this.cellsById.values().next().value;
        const anchor = first?.groupBadgeAnchor();
        // Only the "nothing yet" state: a chart already in a group does not need the ring
        // explained, and a hidden badge (single chart) has nothing to point at.
        if (!anchor || anchor.hidden || !anchor.hasAttribute('data-empty')) return;
        const win = this.root.ownerDocument.defaultView;
        if (!win) return;
        this.groupTipTimer = win.setTimeout(() => {
            this.groupTipTimer = null;
            if (this.destroyed || this.hasSeenTip('group-badge')) return;
            if (this.openDialogs > 0 || this.syncSurfaceOpen) return; // a sheet opened while we waited
            // The badge may have gained a group during the beat — re-check, do not guess.
            if (anchor.hidden || !anchor.hasAttribute('data-empty') || !anchor.isConnected) return;
            this.groupTip = new Tip({
                anchor,
                content:
                    '◌ means this chart is in no sync group. Press it to pick one — charts wearing the same group follow each other.',
                onDismiss: () => {
                    this.groupTip = null;
                    this.markTipSeen('group-badge');
                },
            });
        }, 900);
    }

    /** Retire the coach mark (optionally recording it as seen). */
    private dismissGroupTip(remember: boolean): void {
        const win = this.root.ownerDocument.defaultView;
        if (this.groupTipTimer != null) {
            win?.clearTimeout(this.groupTipTimer);
            this.groupTipTimer = null;
        }
        const tip = this.groupTip;
        this.groupTip = null;
        if (remember) this.markTipSeen('group-badge');
        tip?.dismiss();
    }

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
     * Forget every dormant (pooled) chart — the "remove hidden charts" housekeeping.
     * It REPLACES the previous batch's undo snapshot, so Undo always brings back the
     * batch that was just dropped (one level, the same contract as a toast's Undo).
     */
    clearPooled(): number {
        const n = this.pool.size;
        if (n === 0) return 0;
        this.pooledCleared = new Map(this.pool);
        this.pool.clear();
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
            // leader's instant (TV's rule — crosshair sync lights every chart's values).
            follower.setSyncedCrosshair(time == null ? null : follower.barAt(time));
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

    /** Trigger ② — a cell's indicator ledger changed: count + picker only if active. */
    private onCellIndicatorsChanged(id: string): void {
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.indicatorPicker?.sync();
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
    private onLayoutModeChange(mode: LayoutMode): void {
        this.symbolPicker.close();
        this.indicatorPicker?.close();
        this.tfDrawer?.close();
        this.drawingsDrawer?.close();
        this.moreDrawer?.close();
        this.timezoneDrawer?.close();
        this.priceScaleDrawer?.close();
        this.alertsMenu?.destroy();
        this.alertsMenu = null;
        this.alertList?.destroy();
        this.alertList = null;
        this.palette?.destroy();
        this.palette = null;
        for (const cell of this.cellsById.values()) {
            cell.chart.renderer.closeDialogs();
            cell.chart.renderer.setLayoutMode(mode);
            cell.setControlsSuspended(mode === 'mobile'); // the mobile bar's maximize stop replaces the cluster
        }
        this.syncCellPresentation(); // the legend's overview override is mode-scoped
    }

    /** Push the layout-shape-dependent chrome onto every cell: multi-cell grids keep
     *  the status line on one row (segments that don't fit hide), and on MOBILE their
     *  legends' fold chip routes to the object tree instead of unfolding in place —
     *  per-indicator controls live there (the legend rows have no room in a grid cell). */
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

    /**
     * One door for every "mark this chart" affordance — the status-line badge and the
     * series context menu both land here. A phone gets the sheet (a popover would fight
     * the touch layout); a desktop gets the layout popover, opened on THAT chart's
     * column, so the tap lands on the right cell instead of on a panel to hunt through.
     */
    private openSyncSurface(cellId?: string): void {
        if (this.monoLayout || this.cellsById.size < 2) return;
        if (this.layoutCtl.current === 'mobile') this.openSyncDrawer(cellId);
        else this.topbar?.openLayoutPicker(cellId);
    }

    private openMoreDrawer(view: 'main' | 'layout' = 'main', focus?: 'sync', cellId?: string): void {
        // The drawer is the mobile counterpart of the topbar's tools — composition-
        // hidden entries lose their drawer rows too (handlers omitted ⇒ rows omitted).
        const has = (id: string): boolean => topbarHas(this.topbarComp, id);
        this.moreDrawer ??= new MoreDrawer({
            host: this.root,
            ...(has('undo-redo') ? { onUndo: () => this.active.history.undo(), onRedo: () => this.active.history.redo() } : {}),
            ...(has('screenshot')
                ? { onScreenshot: this.screenshotOverride ? () => this.runOverride(this.screenshotOverride!) : () => this.downloadScreenshot() }
                : {}),
            canUndo: () => this.active.history.canUndo,
            canRedo: () => this.active.history.canRedo,
            priceStyles: () => priceStyleIds().map((id) => ({ id, label: priceStyleLabel(id), icon: priceStyleIcon(id) })),
            priceStyle: () => this.active.priceStyle,
            onPriceStyle: (id) => this.active.setPriceStyle(id),
            // One chart picker on the phone: the drawer's row raises the same sheet the
            // bar's chart-type stop does (a shell without the mobile bar keeps the list).
            ...(this.mobileBar ? { onChartType: () => this.mobileBar!.openSheet() } : {}),
            panels: () => (has('panels') ? [...this.dock.list()] : []),
            onTogglePanel: (id) => this.dock.toggle(id),
            ...(has('alerts') ? { alerts: () => this.alerts.map((a) => ({ title: `${a.source} · ${a.title}`, message: a.message, time: a.time })) } : {}),
            // The chart-body menu's "Reset chart view" row, reachable on a phone through the
            // drawer (its only other door is a right-click, which touch does not have).
            onResetView: () => this.active.resetView(),
            // …and the rest of that menu as one sheet ("Chart actions…"), so the phone gets
            // the bulk clears too — the one pair of verbs it had no door to at all.
            onChartMenu: () => this.active.openChartMenu(),
            // Display time zone: the sheet a hold on the time axis opens, now also a row a
            // user can find without knowing the gesture.
            timezone: () => this.timezone,
            onTimeZone: () => this.openTimezoneDrawer(),
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
            onOpenChange: (open) => {
                this.trackDialog(open);
                this.mobileBar?.setExpanded('more', open);
                // While the sheet is up its table numbers the charts, so "column 3" and
                // the chart wearing "3" are visibly the same thing.
                this.setSyncSurfaceOpen(open);
                const anchor = this.pendingReplayAnchor;
                if (!open && anchor) {
                    this.pendingReplayAnchor = null;
                    this.openReplayMenu(anchor);
                }
            },
        });
        this.moreDrawer.open(view, { ...(focus ? { focus } : {}), ...(cellId ? { cell: cellId } : {}) });
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

    private openTimezoneDrawer(): void {
        this.timezoneDrawer ??= new TimezoneDrawer({
            host: this.root,
            timezone: () => this.timezone,
            onTimezone: (zone) => this.setTimezone(zone),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.timezoneDrawer.open();
    }

    private openPriceScaleDrawer(y: number): void {
        this.priceScalePressY = y;
        this.priceScaleDrawer ??= new PriceScaleDrawer({
            host: this.root,
            chart: () => (this.activeId ? (this.cellsById.get(this.activeId)?.chart ?? null) : null),
            pressY: () => this.priceScalePressY,
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.priceScaleDrawer.open();
    }

    /** The aggregated alerts bell — entries carry their cell; selecting one activates it. */
    // ── bar replay chrome ──
    //
    // The PUBLIC surface stays `ws.replay`: this chrome starts, paces and ends sessions
    // through it and follows its `replay:*` events, so a replay started from code, a
    // contribution or a shortcut wears the same bar. Nothing here keeps replay state of
    // its own except the pace to resume on and whether "select bar" is armed.

    /** Mount the floating transport bar and follow the session on it. */
    private mountReplayBar(): void {
        if (this.opts.replay === false) return;
        this.replayBar = new ReplayToolbar({
            host: this.gridEl,
            onPlayPause: () => this.toggleReplay(),
            onStep: () => this.stepReplay(),
            onSpeed: (ms) => this.setReplaySpeed(ms),
            onJumpToRealtime: () => this.jumpToRealtime(),
            onExit: () => this.replay.stop(),
            onCancelArm: () => this.disarmReplay(),
        });
        for (const ev of ['replay:start', 'replay:step', 'replay:tick', 'replay:play', 'replay:pause', 'replay:end'] as const) {
            this.replay.on(ev, () => this.syncReplayUi());
        }
        // `state` reads the ACTIVE cell's chart — a new active cell means a new cursor.
        this.on('cell:active', () => this.syncReplayUi());
        this.syncReplayUi();
    }

    /** Paint the session onto the chrome (bar + topbar slot). Idempotent. */
    private syncReplayUi(): void {
        if (this.destroyed) return;
        const s = this.replay.state;
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

    /**
     * The bell opens the grouped alert list. The old flat menu answered "what happened?"
     * but not "on WHICH chart?" — in a 4- or 16-chart grid that is the only question
     * worth asking. `anchor` is kept in the signature because the topbar slot hands it
     * over; the dialog is centred rather than anchored (a 16-chart list under a bell
     * button would hang off the screen).
     */
    private openAlertsMenu(_anchor: HTMLElement): void {
        this.alertsMenu?.destroy();
        this.alertsMenu = null;
        this.alertList?.destroy();
        this.alertList = null;
        this.palette?.destroy();
        this.palette = null;
        this.alertList ??= new AlertList({
            doc: this.root.ownerDocument,
            host: this.root,
            getAlerts: () => this.alerts,
            getCharts: () => this.syncCharts(),
            onGo: (cellId) => {
                if (this.cellsById.has(cellId)) this.setActiveCell(cellId);
            },
            onClearChart: (cellId) => {
                this.alerts = this.alerts.filter((a) => a.cellId !== cellId);
                this.topbar.setAlertCount(this.alerts.length);
                this.markStateDirty();
            },
            onClearAll: () => {
                this.alerts = [];
                this.topbar.setAlertCount(0);
                this.markStateDirty();
            },
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.alertList.open();
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
        if (this.replayBar) {
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
            when: () => this.def.cells.length > 1 && this.tabBelongsToChart(),
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
        this.keymap.register({ id: 'history.undo', keys: ['mod+z'], label: 'Undo (active chart)', category: 'Edit', run: () => this.active.history.undo() });
        this.keymap.register({ id: 'history.redo', keys: ['mod+y', 'mod+shift+z'], label: 'Redo (active chart)', category: 'Edit', run: () => this.active.history.redo() });
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
        out.push(
            {
                id: 'view:alerts',
                label: 'Alerts — every chart, grouped',
                category: 'View',
                keywords: 'bell notifications list',
                run: () => this.openAlertsMenu(this.topbar.el),
            },
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

    /** Bare-typing router: letters and `0` → symbol search (seeded), digits 1–9 → timeframe entry. */
    private routeTyping(ev: KeyboardEvent): void {
        if (this.destroyed) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isEditableTarget(ev)) return; // never hijack a keystroke someone is TYPING
        const hit = resolveTyping(ev.key, { dialogs: this.openDialogs, symbolSearch: this.symbolPicker.isOpen, timeframeEntry: this.tfQuick.isOpen });
        if (!hit) return;
        ev.preventDefault();
        if (hit.target === 'symbol') this.symbolPicker.type(hit.text);
        else this.tfQuick.type(hit.text);
    }

    private trackDialog(open: boolean): void {
        this.openDialogs = Math.max(0, this.openDialogs + (open ? 1 : -1));
        // D4: a modal sheet already traps focus, but the chart behind it stayed in the
        // accessibility tree and reachable by keyboard. `inert` on every shell child except
        // the sheet (and its own backdrop, which must keep taking the dismiss tap) makes the
        // word "modal" true for a screen reader too.
        this.applyModalInert(this.openDialogs > 0);
        if (open) {
            this.keymap.pushScope('dialog');
            // A coach mark must never float on top of a sheet: it points at a badge that
            // the sheet is covering. Opening the sheet IS the journey it was pointing to,
            // so this counts as answered.
            if (this.groupTip) this.dismissGroupTip(true);
        }
        else {
            this.keymap.popScope('dialog');
            // A coach mark that was suppressed while the sheet was open gets its turn now.
            if (this.openDialogs === 0) this.root.ownerDocument.defaultView?.setTimeout(() => this.maybeShowGroupTip(), 320);
        }
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
            if (oldest != null) this.pool.delete(oldest);
            this.notePoolDrop();
        }
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
