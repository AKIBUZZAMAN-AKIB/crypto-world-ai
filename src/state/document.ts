// The ONE serializable shell-state document, shared by BOTH shells: `vela/workspace`
// persists a multi-cell document; `vela/widget` persists the SAME document with a
// single `c1` cell (`layout: '1'`). One format means one mental model, one codec, and
// state that moves freely between shells (a saved widget chart drops into a workspace
// slot as-is). This module is NEUTRAL — it imports from neither shell; both re-export
// it (`vela/widget` and `vela/workspace` expose the same names).
//
// Design intent: the state SURFACE is the product (`getState()` / `applyState()` /
// the `state:changed` notification); persistence is just an adapter driven through
// the storage seam. Nothing here touches the URL — hosts wanting shareable links
// compose them from `getState()` themselves.

import type { CursorStyle } from '../core/cursor';
import { CURSOR_STYLES } from '../core/cursor';

/**
 * The linkable dimensions. `time` aligns a clicked point in time across same-group
 * cells without touching their span (TradingView's "Time" sync): the follower keeps
 * its own zoom and is re-centered on the clicked instant. `viewport` is the heavier
 * sibling that copies the whole from–to range. `crosshair` mirrors the pointer time onto same-group
 *  cells as GHOST crosshairs (renderers without the optional `setExternalCrosshair`
 *  seam simply never display one). `drawings` copies each NEWLY CREATED drawing onto
 *  same-group cells and keeps the set linked: edits and removals of any member
 *  follow. Link membership is session-scoped and survives a toggle-off (re-enabling
 *  resumes edit/delete for drawings paired earlier; drawings created while off stay
 *  independent). After a reload, every drawing is unpaired again. `style` mirrors
 *  the chart's presentation settings — the Canvas and Scales-and-lines slice of the
 *  renderer config plus the status-line display prefs — onto same-group cells. */
export type SyncKind = 'viewport' | 'time' | 'symbol' | 'timeframe' | 'crosshair' | 'drawings' | 'style';

/** Every linkable dimension — the one list the codec and both shells iterate. */
export const SYNC_KINDS = ['viewport', 'time', 'symbol', 'timeframe', 'crosshair', 'drawings', 'style'] as const;

/**
 * One link's configuration: `false`/absent = off; `true` = ALL cells linked (one
 * implicit group); a record maps cell id → group name, and only cells sharing a group
 * follow each other (a cell absent from the record is unlinked).
 */
export type SyncSetting = boolean | Readonly<Record<string, string>>;

/**
 * The name of that IMPLICIT group. `true` means "every cell follows every other", which
 * is the same thing as every cell sitting in one unnamed group — so the chips name it
 * instead of reporting "no group" for the form every switch produces. The workspace
 * seeds a real record with this name the moment one chart is pulled out of the pack, so
 * the two forms read identically on screen (see `markOf` in `workspace/sync`).
 */
export const IMPLICIT_GROUP = 'A';

export interface SyncOptions {
    viewport?: SyncSetting;
    /** Click-to-align a point in time (see {@link SyncKind}). */
    time?: SyncSetting;
    symbol?: SyncSetting;
    timeframe?: SyncSetting;
    crosshair?: SyncSetting;
    drawings?: SyncSetting;
    style?: SyncSetting;
}

/** Splitter track weights along each grid axis. */
export interface TrackSizes {
    cols?: number[];
    rows?: number[];
}

/**
 * The docked side panels — a SHELL-level pref (one dock serves every cell of a workspace).
 * `open` is the side column (or a floating fallback for older readers); `floatingOpen` lists
 * concurrently open desktop cards. `widths` holds only user-resized panels, and `pinned`
 * retains the legacy anchored-overlay pin choice. Absent in documents predating the dock.
 */
export interface FloatingPanelPosition {
    /** Top-left as fractions of the desktop dock host, clamped on presentation. */
    x: number;
    y: number;
}

export interface PanelsState {
    open?: string;
    widths?: Record<string, number>;
    pinned?: string[];
    /** Panels whose desktop mode is a freely movable card, including closed panels. */
    floating?: string[];
    /** Open floating panels; `open` continues to identify the side dock (or one fallback). */
    floatingOpen?: string[];
    /** Last user-set floating positions, independent of phone geometry. */
    floatPositions?: Record<string, FloatingPanelPosition>;
    /** Legacy mobile top offsets; phone presentation now derives the top from height. */
    tops?: Record<string, number>;
    /** Mobile pane heights as fractions of the host height. */
    heights?: Record<string, number>;
    /** Independent desktop side-panel heights, also as host fractions. */
    desktopHeights?: Record<string, number>;
}

/**
 * The drawing tools' shared preferences — one set per shell, like the favorite stars:
 * each tool's remembered settings (what its next drawing starts from), the magnet, and
 * stay-in-drawing-mode. `defaults` maps a tool type to its settings and passes through
 * opaquely; `drawings.setToolDefaults` validates each entry at restore time.
 */
export interface DrawingToolsState {
    defaults?: Record<string, unknown>;
    /** Each tool's saved looks — a list of `{ name, settings }`, by tool type. */
    templates?: Record<string, unknown[]>;
    magnet?: 'off' | 'weak' | 'strong';
    stay?: boolean;
}

/** Per-chart (per-cell) state: the market, the display prefs, the content documents,
 *  and the indicator ledger. The widget's whole chart state is ONE of these. */
/** Runtime flags that the chart treats as user edits but keeps out of cosmetic config. */
export interface CellRuntimeState {
    candleVisible?: boolean;
    autoScale?: boolean;
}

/** One Object Tree folder. `parent` nests a group inside another group. */
export interface ObjectGroupState {
    id: string;
    name: string;
    ids: string[];
    indicators?: string[];
    indicatorRefs?: Array<{ id: string; key: string; ordinal: number }>;
    parent?: string;
}

/** One pane's durable layout — enough to restore order, visibility and scale columns. */
export interface PaneState {
    id: string;
    kind: 'price' | 'study';
    order: number;
    collapsed: boolean;
    maximized: boolean;
    indicators: Array<{ id: string; ownScale: boolean }>;
}

export interface CellState {
    symbol?: string;
    /**
     * This chart's own display timezone (IANA name, or `'exchange'` for the symbol's
     * session rule). Absent ⇒ the workspace default applies. TradingView keeps the zone
     * per chart; a layout with a US equity beside a crypto pair needs exactly that.
     */
    timezone?: string;
    /** The symbol's venue. Mirrors the symbol's own `EXCHANGE:` prefix on new saves;
     *  pre-prefix documents stored it beside a BARE symbol — {@link prefixedSymbol}
     *  welds the two back into the one canonical form at restore time. */
    provider?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
    /** Trading session shown (`'extended'` persisted; absent = regular, the default). */
    session?: string;
    /** Symbol watermark visibility — a per-chart display pref. */
    watermark?: boolean;
    /** The "Replay" line under the watermark while replaying — a per-chart display pref. */
    replayWatermark?: boolean;
    /** Indicator titles (the in-chart legend rows) visibility — a per-chart display pref. */
    indicatorTitles?: boolean;
    /** Plot values beside the legend titles visibility — a per-chart display pref. */
    indicatorValues?: boolean;
    /** The renderer's cosmetic config document (`renderer.getConfig()`). Includes the
     *  shared candle/indicator visual-order keys. */
    rendererConfig?: unknown;
    /** Runtime view flags that do not ride `getConfig()` but ARE chart edits. */
    runtime?: CellRuntimeState;
    /** The shell switched this chart to percent for Compare; restore price on removal. */
    compareAutoPercent?: boolean;
    /** The pane stack: order, collapse/maximize and each indicator's pane/scale. */
    panes?: PaneState[];
    /** Object Tree groups/folders, including nesting, for this chart. */
    objectTreeGroups?: ObjectGroupState[];
    /** The user-drawings document (`drawings.toJSON()`). */
    drawings?: unknown;
    /** The indicator ledger: manifest entries + native entries. Either side persists
     *  the bare NAME/TYPE when every value sits on its declaration default and the
     *  indicator is visible, else the name/type plus the input(/prop) DELTAS and a
     *  `hidden` flag (defaults are never frozen into documents). */
    indicators?: { manifest: PersistedManifestEntry[]; natives: PersistedNativeEntry[] };
    /** Third-party per-chart state, by namespaced key (`'vendor.feature'`) — written and
     *  read by registered state-persistence handlers (`registerStatePersistence`, scope
     *  `'cell'`). Values are OPAQUE here: the codec preserves entries verbatim — a key
     *  whose handler is absent this session still round-trips — and each handler
     *  validates its own payload at restore. JSON-serializable values only. */
    ext?: Record<string, unknown>;
}

/** One persisted manifest-instance entry (see `CellState.indicators`). */
export type PersistedManifestEntry = string | { name: string; inputs?: Record<string, unknown>; props?: Record<string, unknown>; hidden?: boolean; source?: string; language?: string };

/** One persisted native-indicator entry (see `CellState.indicators`). The bare TYPE is
 *  the historical shape and still the common case; the object form carries the input
 *  DELTAS and/or the hidden flag so native settings and visibility survive a reload. */
export type PersistedNativeEntry = string | { type: string; inputs?: Record<string, unknown>; props?: Record<string, unknown>; hidden?: boolean };

/** One entry of the document's `charts` array: a chart's state plus its cell IDENTITY. */
export interface ChartState extends CellState {
    /** The cell's durable identity — its declared name (`btc`), or `c<N>` for a slot no
     *  entry declared. Unique within the document; array position restores slot order. */
    id: string;
}

/** The versioned shell-state document — everything `applyState` restores. */
/** Side-car data for a named snapshot. */
export interface SavedLayoutMeta {
    /** A small JPEG (`data:image/jpeg`) preview of the grid at save time. */
    thumb?: string;
    /** When the snapshot was written (ms since epoch). */
    savedAt?: number;
}

/** A saved indicator TEMPLATE ("chart template"). */
export interface ChartTemplate {
    /** Template body version — 1 today. Unknown bodies are ignored, never guessed at. */
    version: 1;
    /** The indicator ledger: type id + inputs (+ hidden flag), exactly what a cell
     *  persists, so an apply is a restore of the same shape. */
    indicators: PersistedNativeEntry[];
    /** Source-backed studies alongside native studies. Drawings are never included. */
    scripts?: Array<{ name: string; source: string; inputs?: Record<string, unknown>; props?: Record<string, unknown>; hidden?: boolean; language?: string }>;
    /** Optional link to the market it was captured on (`includeMarket` when saving). */
    symbol?: string;
    timeframe?: string;
}

/** One armed price alert, as the document stores it (no alert IDs from a live session). */
export interface SavedPriceAlert {
    cellId: string;
    symbol: string;
    condition: string;
    value: number;
    frequency: 'once' | 'each';
    bars: number;
    state: 'active' | 'fired' | 'paused';
    createdAt: number;
    fires: number;
    /** Persisted drawing ID and ownership of a price-level line (not the runtime alert ID). */
    lineId?: string;
    lineOwned?: boolean;
    /** The drawing the alert follows, when it was armed from a drawing's clock button. */
    source?: { drawingId: string };
}

/** One indicator TYPE's saved defaults — TradingView's indicator settings → Defaults →
 *  "Save as default": the inputs (and declaration props) every NEW instance of that type
 *  mounts with. Keyed by the indicator's type id, so it travels across symbols, charts
 *  and layouts with the document instead of dying with one chart. */
export interface IndicatorDefault {
    /** Input overrides only — absent keys keep the indicator's declared `defval`. */
    inputs?: Record<string, number | string | boolean>;
    /** Declaration-prop overrides (`precision`, a strategy's capital, …). */
    props?: Record<string, number | string | boolean>;
}

/** One saved APPEARANCE template — the chart-settings document TradingView's Templates
 *  dropdown stores: colors, grid, scales, status line. The market and the indicators are
 *  NOT part of it (those belong to a layout, or to a chart/indicator template). */
export interface AppearanceTemplate {
    version: 1;
    /** The renderer's config document, applied through `applyConfig` (tolerant of fields
     *  a newer build does not know). */
    config: Record<string, unknown>;
}

/**
 * A DRAWING SET template — a real, reusable bundle of drawings, not a tool's saved look.
 * Geometry is stored RELATIVE: `dt` is milliseconds from the set's left edge, `ratio` is
 * the price divided by the set's base price. Inserting on another symbol or timeframe
 * therefore keeps the shape (a breakout pattern, a fib + trendline + note) instead of
 * pasting the original absolute prices and times.
 */
export interface DrawingSetTemplateAnchor {
    dt: number;
    ratio: number;
}
export interface DrawingSetTemplateDrawing {
    type: string;
    paneId: string;
    anchors: DrawingSetTemplateAnchor[];
    /** Relative draw-order inside the set; insertion re-bases it above the live stack. */
    z: number;
    visible: boolean;
    locked: boolean;
    style: Record<string, unknown>;
    text?: Record<string, unknown>;
    props?: Record<string, unknown>;
    showOn?: string[];
}
export interface DrawingSetTemplate {
    version: 1;
    drawings: DrawingSetTemplateDrawing[];
    /** The base price the ratios were computed against — kept for export/inspection. */
    basePrice: number;
    /** The set's time span in ms; insertion anchors its left edge at `lastBar - spanMs`. */
    spanMs: number;
    createdAt: number;
}

/** Drawing synchronization scope — TradingView's three modes plus an explicit
 *  per-chart target list for Vela's on-demand layout sync. */
export type DrawingSyncMode = 'none' | 'layout' | 'global' | 'charts';
export interface DrawingSyncEntry {
    mode: DrawingSyncMode;
    /** Cell ids for `mode: 'charts'`; ignored otherwise. */
    charts?: string[];
}

export interface WorkspaceState {
    version: 1;
    /** The layout id — always `'1'` for a widget. Restoring an id that is not
     *  registered keeps the current layout — register custom layouts
     *  (`registerLayout`) before applying a saved state. */
    layout: string;
    /** Splitter track weights, per layout id (workspace only). */
    trackSizes?: Record<string, TrackSizes>;
    activeCellId?: string;
    /** Sync links (workspace only). */
    sync?: SyncOptions;
    /** The workspace DEFAULT display timezone (cells without their own follow it). */
    timezone?: string;
    /** The pointer style shown on every chart (the drawing toolbar's Cursors stop). A view
     *  preference like the timezone — it rides the document so a reload keeps it. */
    cursor?: CursorStyle;
    /**
     * Drawings remembered per SYMBOL — the "global" drawing scope: a chart switching to
     * a symbol whose drawings are stored here gets them back, and the drawings it leaves
     * behind are kept under its old symbol. Only maintained while the workspace drawing
     * scope is `'global'`; the in-layout link (`sync.drawings`) is a separate axis.
     */
    drawingsBySymbol?: Record<string, unknown>;
    /** Which scope the workspace was in: `'layout'` (a cell owns its drawings) or
     *  `'global'` (the symbol does — {@link drawingsBySymbol} is live). Absent = layout. */
    drawingsScope?: 'layout' | 'global';
    /** Named workspace snapshots ("Save layout as…") — opaque state documents by name. */
    savedLayouts?: Record<string, unknown>;
    /** Side-car data for those snapshots (a small JPEG preview, when it was captured).
     *  Kept BESIDE `savedLayouts` rather than inside it so an old document — and an old
     *  consumer — round-trips unchanged. */
    layoutMeta?: Record<string, SavedLayoutMeta>;
    /**
     * Preferences for the two manager lists below, kept in the SAME document so they ride
     * a share link and a reload: autosave (keep the open layout in step with the chart)
     * and the template every new chart starts from.
     */
    layoutPrefs?: {
        /** Save the open layout automatically after every change (TradingView's toggle). */
        autosave?: boolean;
        /** Template applied to charts that are NEW (not restored): a house style. */
        defaultTemplate?: string;
        /** APPEARANCE template charts that are NEW open with (chart settings → Templates). */
        defaultAppearance?: string;
        /** Whether the compact Manage layouts menu currently exposes a sharing link. */
        sharing?: boolean;
    };
    /**
     * Saved chart TEMPLATES — indicator sets with their settings, no drawings (Vela's
     * documented template contract: applying one REPLACES the chart's indicators; a
     * template never carries drawings). Keyed by name; the market may be carried
     * optionally (the symbol/timeframe chips are off by default, as in TradingView).
     */
    templates?: Record<string, ChartTemplate>;
    /** Saved DRAWING SETS — whole bundles of drawings, with relative geometry. */
    drawingSetTemplates?: Record<string, DrawingSetTemplate>;
    /** Per-object drawing sync scope, keyed by the source drawing's id. */
    drawingSync?: Record<string, DrawingSyncEntry>;
    /** Default scope for NEW drawings (the object tree's Manage objects button). */
    drawingSyncDefault?: DrawingSyncMode;
    /** Source drawing → target cell → the clone's generated id (ids are regenerated on insert). */
    drawingSyncClones?: Record<string, Record<string, string>>;
    /** Independent, bidirectional indicator-settings links within this layout. */
    indicatorSyncLinks?: Array<{
        mode: 'layout' | 'charts';
        members: Array<{ cellId: string; key: string; ordinal: number }>;
        /** Latest edit, including while all other linked charts are pooled. */
        values?: { inputs: Record<string, number | string | boolean>; props: Record<string, number | string | boolean> };
    }>;
    /**
     * INDICATOR defaults, by indicator type id — what "Save as default" in the indicator
     * settings dialog writes and every new instance of that type opens with.
     */
    indicatorDefaults?: Record<string, IndicatorDefault>;
    /**
     * CHART-SETTINGS templates — the chart's appearance (colors, grid, scales, status
     * line) saved under a name; the market and the indicators are not part of one.
     * Keyed by name.
     */
    appearanceTemplates?: Record<string, AppearanceTemplate>;
    /**
     * PRICE ALERTS — the level/watch rows the user armed, per chart. Persisted because an
     * alert is a decision the trader made about a market, not a session artifact: a reload
     * that silently dropped them would leave someone believing they were still covered.
     * (A script/indicator alert's LOG is session-only — it is a record of what the chart did.)
     */
    priceAlerts?: SavedPriceAlert[];
    /** The shell's watchlist — symbols in display order, newest appended. */
    watchlist?: string[];
    /** User-given names for sync groups, keyed by the STABLE group id (`'red'`), not by
     *  the emoji — so a palette change can never rename a group. */
    groupNames?: Record<string, string>;
    /** Custom glyphs for sync groups, keyed by the STABLE group id — the display twin of
     *  `groupNames`. Anything the palette cannot express (a fox, initials, a flag) goes
     *  here; propagation still compares ids, so a repaint never merges two groups. */
    groupMarks?: Record<string, string>;
    /** One-time tips already seen (`'group-badge'`, `'palette'`). */
    seenTips?: string[];
    /** Commands run from the palette most recently (ids, newest first, ≤ 8). */
    recentCommands?: string[];
    /**
     * Tab-linking tag: workspaces whose documents share a tag mirror their ACTIVE cell's
     * market (symbol/timeframe) — TradingView Desktop's colored tab link. Absent = unlinked.
     */
    linkedGroup?: string;
    /** Favorite drawing-tool types — a SHARED preference (one star set per shell). */
    favorites?: string[];
    /** Favorite timeframes (the topbar's quick-switch chips) — a SHARED preference. */
    timeframeFavorites?: string[];
    /** Favorite CHART TYPES (the bar's chart-type sheet, the desktop style menu) — the
     *  same shared-preferences channel as the two above, so a star survives a saved
     *  layout, an export and a share link instead of living in one browser's storage. */
    chartTypeFavorites?: string[];
    /** Starred INDICATORS (picker rows: a native type id, else the script's name) — the
     *  same shared-preferences channel: a starred study survives a saved layout, an
     *  export and a share link instead of living in one browser's storage. */
    indicatorFavorites?: string[];
    /** Favorite INDICATOR TEMPLATES — `template:<name>` or `builtin:<id>` keys. */
    templateFavorites?: string[];
    /** The drawing tools' remembered settings, magnet and stay mode — a SHARED preference. */
    drawingTools?: DrawingToolsState;
    /** The docked side panels: which one is open, and the widths the user dragged. */
    panels?: PanelsState;
    /** Per-chart state, one entry per SLOT (a single `c1` entry for the widget).
     *  Ids are unique — the codec drops id-less entries and keeps the LAST duplicate. */
    charts: ChartState[];
    /** Third-party document-level state, by namespaced key (`'vendor.feature'`) — the
     *  `scope: 'global'` counterpart of {@link CellState.ext}, same opacity contract. */
    ext?: Record<string, unknown>;
}

/** Serialize a state document (the inverse of {@link decodeState}). */
/** A cell's symbol in the canonical PREFIXED form: pre-prefix documents stored the
 *  venue in `provider` beside a BARE symbol — weld the two back together on restore.
 *  A symbol that already carries a prefix wins (new saves mirror it into `provider`). */
export function prefixedSymbol(cell: Pick<CellState, 'symbol' | 'provider'> | null | undefined): string | undefined {
    if (!cell?.symbol) return undefined;
    if (cell.symbol.includes(':') || !cell.provider) return cell.symbol;
    return `${cell.provider}:${cell.symbol}`;
}

export function encodeState(state: WorkspaceState): string {
    return JSON.stringify(state);
}

/** The document format this build writes and understands. */
export const STATE_VERSION = 1;

export type DecodeFailure = 'empty' | 'not-json' | 'invalid' | 'future';

export interface DecodeResult {
    state: WorkspaceState | null;
    /** Why it failed — `'future'` is not corruption: another build wrote it. */
    reason?: DecodeFailure;
    /** The version the payload CLAIMED, when it was a number. */
    version?: number;
}

/**
 * Parse + sanitize a persisted payload, WITHOUT throwing away the reason. The shell
 * needs the distinction: a corrupt payload and a document written by a newer build both
 * fail to load, but only the second must be preserved untouched (overwriting it would
 * destroy the user's work in a build that cannot read it).
 */
export function decodeStateDetailed(raw: string | null | undefined): DecodeResult {
    if (raw == null || raw === '') return { state: null, reason: 'empty' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { state: null, reason: 'not-json' };
    }
    const version =
        parsed != null && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'number'
            ? ((parsed as { version: number }).version)
            : undefined;
    if (version !== undefined && version > STATE_VERSION) return { state: null, reason: 'future', version };
    const state = sanitizeState(parsed);
    return state ? { state } : { state: null, reason: 'invalid', ...(version !== undefined ? { version } : {}) };
}

/** Parse + sanitize a persisted payload. Null on anything unusable (wrong version,
 *  not JSON, not an object) — malformed FIELDS are dropped, never thrown on. */
export function decodeState(raw: string): WorkspaceState | null {
    return decodeStateDetailed(raw).state;
}

/**
 * Validate an untrusted state document field by field (the `applyState` gate). Unknown
 * or malformed fields are dropped; nested renderer-config / drawings documents pass
 * through OPAQUELY — their own consumers (`applyConfig`, `fromJSON`) validate them.
 */
export function sanitizeState(doc: unknown): WorkspaceState | null {
    if (doc == null || typeof doc !== 'object') return null;
    const d = doc as Record<string, unknown>;
    // Version tolerance, deliberately asymmetric: a MISSING version is treated as 1 (the
    // first release shipped documents that predate the field in hand-written fixtures),
    // and a FUTURE version is refused by `decodeStateDetailed` before we get here rather
    // than being half-imported into an older schema.
    const version = typeof d.version === 'number' ? d.version : 1;
    if (!Number.isFinite(version) || version > STATE_VERSION || typeof d.layout !== 'string') return null;
    const out: WorkspaceState = { version: STATE_VERSION, layout: d.layout, charts: [] };

    if (Array.isArray(d.charts)) {
        // Unique by id, LAST duplicate wins (a Map keeps the first-seen position).
        const byId = new Map<string, ChartState>();
        for (const raw of d.charts as unknown[]) {
            const id = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined;
            if (typeof id !== 'string' || id.length === 0) continue;
            const cell = sanitizeCell(raw);
            if (cell) byId.set(id, { id, ...cell });
        }
        out.charts = [...byId.values()];
    }
    if (Array.isArray(d.priceAlerts)) {
        const rows: SavedPriceAlert[] = [];
        for (const raw of d.priceAlerts as unknown[]) {
            if (raw == null || typeof raw !== 'object') continue;
            const a = raw as Record<string, unknown>;
            // A row without a cell id or a numeric level cannot be re-armed — drop it rather
            // than restoring an alert that can never fire.
            if (typeof a.cellId !== 'string' || typeof a.symbol !== 'string') continue;
            if (typeof a.value !== 'number' || !Number.isFinite(a.value)) continue;
            if (typeof a.condition !== 'string') continue;
            rows.push({
                cellId: a.cellId,
                symbol: a.symbol,
                condition: a.condition,
                value: a.value,
                frequency: a.frequency === 'each' ? 'each' : 'once',
                bars: typeof a.bars === 'number' && a.bars > 0 ? Math.floor(a.bars) : 5,
                state: a.state === 'fired' || a.state === 'paused' ? a.state : 'active',
                createdAt: typeof a.createdAt === 'number' ? a.createdAt : 0,
                fires: typeof a.fires === 'number' && a.fires >= 0 ? Math.floor(a.fires) : 0,
                ...(typeof a.lineId === 'string' && a.lineId.length > 0 ? { lineId: a.lineId, lineOwned: a.lineOwned === true } : {}),
                // A drawing-backed alert keeps its binding only when the id survived the
                // round-trip; an unknown shape simply restores as a plain level alert.
                source:
                    a.source != null && typeof a.source === 'object' && typeof (a.source as { drawingId?: unknown }).drawingId === 'string'
                        ? { drawingId: (a.source as { drawingId: string }).drawingId }
                        : undefined,
            });
        }
        if (rows.length > 0) out.priceAlerts = rows;
    }
    if (typeof d.activeCellId === 'string') out.activeCellId = d.activeCellId;
    if (typeof d.timezone === 'string' && d.timezone) out.timezone = d.timezone;
    // Only a KNOWN cursor id is stored; anything else leaves the field absent (the
    // renderer then shows its own default rather than a value it cannot paint).
    if (typeof d.cursor === 'string' && (CURSOR_STYLES as readonly string[]).includes(d.cursor)) out.cursor = d.cursor as CursorStyle;
    if (Array.isArray(d.favorites)) {
        const favs = d.favorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.favorites = favs;
    }
    if (Array.isArray(d.chartTypeFavorites)) {
        const favs = d.chartTypeFavorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.chartTypeFavorites = favs;
    }
    if (Array.isArray(d.indicatorFavorites)) {
        const favs = d.indicatorFavorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.indicatorFavorites = favs;
    }
    if (Array.isArray(d.templateFavorites)) {
        const favs = d.templateFavorites.filter((f): f is string => typeof f === 'string' && f.length > 0);
        if (favs.length > 0) out.templateFavorites = [...new Set(favs)];
    }
    if (Array.isArray(d.timeframeFavorites)) {
        const favs = d.timeframeFavorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.timeframeFavorites = favs;
    }
    const tools = sanitizeDrawingTools(d.drawingTools);
    if (tools) out.drawingTools = tools;
    const sync = sanitizeSync(d.sync);
    if (sync) out.sync = sync;
    const bySymbol = sanitizeRecordMap(d.drawingsBySymbol);
    if (bySymbol) out.drawingsBySymbol = bySymbol;
    if (d.drawingsScope === 'global' || d.drawingsScope === 'layout') out.drawingsScope = d.drawingsScope;
    const saved = sanitizeRecordMap(d.savedLayouts);
    if (saved) out.savedLayouts = saved;
    const layoutMeta = sanitizeLayoutMeta(d.layoutMeta);
    if (layoutMeta) out.layoutMeta = layoutMeta;
    const templates = sanitizeTemplates(d.templates);
    if (templates) out.templates = templates;
    const sets = sanitizeDrawingSetTemplates(d.drawingSetTemplates);
    if (sets) out.drawingSetTemplates = sets;
    const drawingSync = sanitizeDrawingSync(d.drawingSync);
    if (drawingSync) out.drawingSync = drawingSync;
    if (d.drawingSyncDefault === 'none' || d.drawingSyncDefault === 'layout' || d.drawingSyncDefault === 'global') out.drawingSyncDefault = d.drawingSyncDefault;
    const clones = sanitizeDrawingSyncClones(d.drawingSyncClones);
    if (clones) out.drawingSyncClones = clones;
    if (Array.isArray(d.indicatorSyncLinks)) {
        const links: NonNullable<WorkspaceState['indicatorSyncLinks']> = [];
        for (const raw of d.indicatorSyncLinks) {
            if (!raw || typeof raw !== 'object') continue;
            const link = raw as Record<string, unknown>;
            if ((link.mode !== 'layout' && link.mode !== 'charts') || !Array.isArray(link.members)) continue;
            const members = link.members.flatMap((v): Array<{ cellId: string; key: string; ordinal: number }> => {
                if (!v || typeof v !== 'object') return [];
                const m = v as Record<string, unknown>;
                return typeof m.cellId === 'string' && typeof m.key === 'string' && typeof m.ordinal === 'number' && Number.isInteger(m.ordinal) && m.ordinal >= 0 ? [{ cellId: m.cellId, key: m.key, ordinal: m.ordinal }] : [];
            });
            const primitiveBag = (v: unknown): Record<string, number | string | boolean> => {
                if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
                return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, value]) =>
                    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)),
                )) as Record<string, number | string | boolean>;
            };
            const rawValues = link.values && typeof link.values === 'object' && !Array.isArray(link.values) ? link.values as Record<string, unknown> : undefined;
            const values = rawValues ? { inputs: primitiveBag(rawValues.inputs), props: primitiveBag(rawValues.props) } : undefined;
            if (members.length > 0) links.push({ mode: link.mode, members, ...(values ? { values } : {}) });
        }
        if (links.length > 0) out.indicatorSyncLinks = links;
    }
    const appearance = sanitizeAppearanceTemplates(d.appearanceTemplates);
    if (appearance) out.appearanceTemplates = appearance;
    const indicatorDefaults = sanitizeIndicatorDefaults(d.indicatorDefaults);
    if (indicatorDefaults) out.indicatorDefaults = indicatorDefaults;
    const prefs = sanitizeLayoutPrefs(d.layoutPrefs);
    if (prefs) out.layoutPrefs = prefs;
    if (Array.isArray(d.watchlist)) {
        const list: string[] = [];
        for (const raw of d.watchlist as unknown[]) {
            if (typeof raw !== 'string') continue;
            const symbol = raw.trim();
            if (symbol && !list.includes(symbol)) list.push(symbol);
        }
        if (list.length > 0) out.watchlist = list;
    }
    if (d.groupNames != null && typeof d.groupNames === 'object' && !Array.isArray(d.groupNames)) {
        const names: Record<string, string> = {};
        for (const [key, value] of Object.entries(d.groupNames as Record<string, unknown>)) {
            if (typeof value !== 'string') continue;
            const name = value.trim().slice(0, 24);
            if (key && name) names[key] = name;
        }
        if (Object.keys(names).length > 0) out.groupNames = names;
    }
    if (d.groupMarks != null && typeof d.groupMarks === 'object' && !Array.isArray(d.groupMarks)) {
        const marks: Record<string, string> = {};
        // Bounded twice: eight code units per glyph (an emoji + a keycap modifier is
        // already six), and 32 entries — the palette is 16 and a document that carries
        // more is a document doing something it was not written to do.
        for (const [key, value] of Object.entries(d.groupMarks as Record<string, unknown>).slice(0, 32)) {
            if (typeof value !== 'string' || !key) continue;
            const glyph = [...value.trim()].slice(0, 2).join('');
            if (glyph) marks[key] = glyph;
        }
        if (Object.keys(marks).length > 0) out.groupMarks = marks;
    }
    if (Array.isArray(d.seenTips)) {
        const tips = d.seenTips.filter((t): t is string => typeof t === 'string' && t.length > 0);
        if (tips.length > 0) out.seenTips = [...new Set(tips)];
    }
    if (Array.isArray(d.recentCommands)) {
        const recent = d.recentCommands.filter((c): c is string => typeof c === 'string' && c.length > 0).slice(0, 8);
        if (recent.length > 0) out.recentCommands = [...new Set(recent)];
    }
    if (typeof d.linkedGroup === 'string' && d.linkedGroup) out.linkedGroup = d.linkedGroup;
    const tracks = sanitizeTrackSizes(d.trackSizes);
    if (tracks) out.trackSizes = tracks;
    const panels = sanitizePanels(d.panels);
    if (panels) out.panels = panels;
    const ext = sanitizeExt(d.ext);
    if (ext) out.ext = ext;
    return out;
}

/**
 * Snapshot previews. A thumb must be a small `data:image/jpeg;base64,…` string — never a
 * remote URL (a stored `http://…` would beacon the user's view to a third party on every
 * picker open) and never unbounded (a 4 MB data URL would eat the whole storage budget).
 */
/**
 * Appearance templates: a name plus a config OBJECT. The config is deliberately not
 * validated field by field — `applyConfig` ignores what it does not know, so a template
 * written by an older or newer build still lands instead of being dropped here.
 */
function sanitizeAppearanceTemplates(raw: unknown): Record<string, AppearanceTemplate> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, AppearanceTemplate> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const name = key.trim().slice(0, 40);
        if (!name || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const cfg = (value as { config?: unknown }).config;
        if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
        out[name] = { version: 1, config: cfg as Record<string, unknown> };
        kept += 1;
        if (kept >= 40) break;
    }
    return kept > 0 ? out : null;
}

/**
 * Indicator defaults: a type id plus a bag of PRIMITIVES. Anything else (a nested object, an
 * array, a function that survived a JSON round-trip as something odd) is dropped rather than
 * handed to `setInputs`, which would take it straight into a running study.
 */
function sanitizeIndicatorDefaults(raw: unknown): Record<string, IndicatorDefault> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const bag = (value: unknown): Record<string, number | string | boolean> | null => {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
        const out: Record<string, number | string | boolean> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            const name = key.trim();
            if (!name || name.length > 60) continue;
            if (typeof v === 'number' && Number.isFinite(v)) out[name] = v;
            else if (typeof v === 'string') out[name] = v.slice(0, 200);
            else if (typeof v === 'boolean') out[name] = v;
        }
        return Object.keys(out).length > 0 ? out : null;
    };
    const out: Record<string, IndicatorDefault> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const type = key.trim().slice(0, 60);
        if (!type || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const entry: IndicatorDefault = {};
        const inputs = bag((value as { inputs?: unknown }).inputs);
        const props = bag((value as { props?: unknown }).props);
        if (inputs) entry.inputs = inputs;
        if (props) entry.props = props;
        if (!entry.inputs && !entry.props) continue;
        out[type] = entry;
        kept += 1;
        if (kept >= 200) break;
    }
    return kept > 0 ? out : null;
}

function sanitizeLayoutPrefs(raw: unknown): WorkspaceState['layoutPrefs'] | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    const out: NonNullable<WorkspaceState['layoutPrefs']> = {};
    if (typeof p.autosave === 'boolean') out.autosave = p.autosave;
    if (typeof p.defaultTemplate === 'string' && p.defaultTemplate.trim()) out.defaultTemplate = p.defaultTemplate.trim().slice(0, 40);
    if (typeof p.defaultAppearance === 'string' && p.defaultAppearance.trim()) out.defaultAppearance = p.defaultAppearance.trim().slice(0, 40);
    if (typeof p.sharing === 'boolean') out.sharing = p.sharing;
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizeLayoutMeta(raw: unknown): Record<string, SavedLayoutMeta> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, SavedLayoutMeta> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!name || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const m = value as Record<string, unknown>;
        const entry: SavedLayoutMeta = {};
        if (typeof m.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.thumb) && m.thumb.length <= 90_000) {
            entry.thumb = m.thumb;
        }
        if (typeof m.savedAt === 'number' && Number.isFinite(m.savedAt) && m.savedAt > 0) entry.savedAt = m.savedAt;
        if (entry.thumb || entry.savedAt) out[name] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** Templates: a known body version, an indicator array of the shape a cell persists, and
 *  an optional market. Anything else is dropped (never coerced into a half-template). */
function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Drawing-set templates are untrusted JSON: bound the sets, the drawings, and every
 *  numeric field before any of it reaches the drawing store. */
function sanitizeDrawingSync(raw: unknown): Record<string, DrawingSyncEntry> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, DrawingSyncEntry> = {};
    let kept = 0;
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!id || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const v = value as Record<string, unknown>;
        const mode = v.mode;
        if (mode !== 'none' && mode !== 'layout' && mode !== 'global' && mode !== 'charts') continue;
        const charts = Array.isArray(v.charts) ? (v.charts as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 32) : [];
        out[id.slice(0, 64)] = { mode, ...(mode === 'charts' && charts.length > 0 ? { charts } : {}) };
        kept += 1;
        if (kept >= 500) break;
    }
    return kept > 0 ? out : null;
}

function sanitizeDrawingSyncClones(raw: unknown): Record<string, Record<string, string>> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, Record<string, string>> = {};
    let kept = 0;
    for (const [source, targets] of Object.entries(raw as Record<string, unknown>)) {
        if (!source || targets == null || typeof targets !== 'object' || Array.isArray(targets)) continue;
        const clean: Record<string, string> = {};
        let n = 0;
        for (const [cell, clone] of Object.entries(targets as Record<string, unknown>)) {
            if (!cell || typeof clone !== 'string' || !clone || clone.length > 96) continue;
            clean[cell.slice(0, 48)] = clone.slice(0, 96);
            n += 1;
            if (n >= 64) break;
        }
        if (n === 0) continue;
        out[source.slice(0, 96)] = clean;
        kept += 1;
        if (kept >= 500) break;
    }
    return kept > 0 ? out : null;
}

export function sanitizeDrawingSetTemplates(raw: unknown): Record<string, DrawingSetTemplate> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, DrawingSetTemplate> = {};
    let kept = 0;
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        const key = name.trim().slice(0, 40);
        if (!key || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const t = value as Record<string, unknown>;
        if (t.version !== 1 || !Array.isArray(t.drawings)) continue;
        const drawings: DrawingSetTemplateDrawing[] = [];
        for (const entry of (t.drawings as unknown[]).slice(0, 80)) {
            if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const d = entry as Record<string, unknown>;
            if (typeof d.type !== 'string' || !d.type || typeof d.paneId !== 'string' || !Array.isArray(d.anchors)) continue;
            const anchors: DrawingSetTemplateAnchor[] = [];
            for (const a of (d.anchors as unknown[]).slice(0, 24)) {
                if (a == null || typeof a !== 'object' || Array.isArray(a)) continue;
                const p = a as Record<string, unknown>;
                anchors.push({ dt: finite(p.dt, 0), ratio: finite(p.ratio, 1) });
            }
            if (anchors.length === 0) continue;
            const style = d.style != null && typeof d.style === 'object' && !Array.isArray(d.style) ? (d.style as Record<string, unknown>) : {};
            const text = d.text != null && typeof d.text === 'object' && !Array.isArray(d.text) ? (d.text as Record<string, unknown>) : undefined;
            const props = d.props != null && typeof d.props === 'object' && !Array.isArray(d.props) ? (d.props as Record<string, unknown>) : undefined;
            const showOn = Array.isArray(d.showOn) ? (d.showOn as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 16) : undefined;
            drawings.push({
                type: d.type.slice(0, 48),
                paneId: d.paneId.slice(0, 48),
                anchors,
                z: finite(d.z, 0),
                visible: d.visible !== false,
                locked: d.locked === true,
                style,
                ...(text ? { text } : {}),
                ...(props ? { props } : {}),
                ...(showOn && showOn.length > 0 ? { showOn } : {}),
            });
        }
        if (drawings.length === 0) continue;
        out[key] = {
            version: 1,
            drawings,
            basePrice: finite(t.basePrice, 1),
            spanMs: Math.max(0, finite(t.spanMs, 0)),
            createdAt: finite(t.createdAt, 0),
        };
        kept += 1;
        if (kept >= 40) break;
    }
    return kept > 0 ? out : null;
}

function sanitizeTemplates(raw: unknown): Record<string, ChartTemplate> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, ChartTemplate> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!name || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const t = value as Record<string, unknown>;
        const key = name.trim().slice(0, 40);
        if (!key || t.version !== 1 || !Array.isArray(t.indicators)) continue;
        const indicators: PersistedNativeEntry[] = [];
        for (const raw of t.indicators as unknown[]) {
            if (typeof raw === 'string' && raw) indicators.push(raw);
            else if (raw != null && typeof raw === 'object' && typeof (raw as Record<string, unknown>).type === 'string') {
                indicators.push(raw as PersistedNativeEntry);
            }
        }
        const template: ChartTemplate = { version: 1, indicators };
        if (Array.isArray(t.scripts)) {
            const scripts = t.scripts.flatMap((v): NonNullable<ChartTemplate['scripts']> => {
                if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
                const e = v as Record<string, unknown>;
                if (typeof e.name !== 'string' || typeof e.source !== 'string' || !e.source) return [];
                const inputs = e.inputs && typeof e.inputs === 'object' && !Array.isArray(e.inputs) ? e.inputs as Record<string, unknown> : undefined;
                const props = e.props && typeof e.props === 'object' && !Array.isArray(e.props) ? e.props as Record<string, unknown> : undefined;
                return [{ name: e.name, source: e.source, ...(inputs ? { inputs } : {}), ...(props ? { props } : {}), ...(e.hidden === true ? { hidden: true } : {}), ...(typeof e.language === 'string' ? { language: e.language } : {}) }];
            });
            if (scripts.length > 0) template.scripts = scripts;
        }
        if (typeof t.symbol === 'string' && t.symbol) template.symbol = t.symbol;
        if (typeof t.timeframe === 'string' && t.timeframe) template.timeframe = t.timeframe;
        out[key] = template;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** The `ext` bag passes through OPAQUELY (the rendererConfig/drawings precedent): only
 *  object-ness and key shape are checked here — each entry's payload is validated by the
 *  handler that owns the key, at restore time. Entries whose handler is not registered
 *  this session survive verbatim, so a document never loses a plugin's state just
 *  because the plugin wasn't loaded when the document passed through. */
function sanitizeExt(raw: unknown): Record<string, unknown> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (key.length > 0 && value !== undefined) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** Shapes only: each remembered-settings entry must be an object (its contents are the
 *  restoring chart's to validate); the magnet must be a known mode. */
function sanitizeDrawingTools(raw: unknown): DrawingToolsState | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const out: DrawingToolsState = {};
    if (r.defaults != null && typeof r.defaults === 'object' && !Array.isArray(r.defaults)) {
        const defaults: Record<string, unknown> = {};
        for (const [type, value] of Object.entries(r.defaults as Record<string, unknown>)) {
            if (type.length > 0 && value != null && typeof value === 'object' && !Array.isArray(value)) defaults[type] = value;
        }
        if (Object.keys(defaults).length > 0) out.defaults = defaults;
    }
    if (r.templates != null && typeof r.templates === 'object' && !Array.isArray(r.templates)) {
        const templates: Record<string, unknown[]> = {};
        for (const [type, list] of Object.entries(r.templates as Record<string, unknown>)) {
            if (type.length > 0 && Array.isArray(list) && list.length > 0) templates[type] = list;
        }
        if (Object.keys(templates).length > 0) out.templates = templates;
    }
    if (r.magnet === 'off' || r.magnet === 'weak' || r.magnet === 'strong') out.magnet = r.magnet;
    if (typeof r.stay === 'boolean') out.stay = r.stay;
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizeCell(raw: unknown): CellState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const out: CellState = {};
    if (typeof c.symbol === 'string') out.symbol = c.symbol;
    if (typeof c.provider === 'string') out.provider = c.provider;
    if (typeof c.timeframe === 'string') out.timeframe = c.timeframe;
    if (typeof c.timezone === 'string' && c.timezone) out.timezone = c.timezone;
    if (typeof c.priceStyle === 'string') out.priceStyle = c.priceStyle;
    if (typeof c.bars === 'number' && Number.isFinite(c.bars) && c.bars > 0) out.bars = c.bars;
    if (c.session === 'regular' || c.session === 'extended') out.session = c.session;
    if (typeof c.watermark === 'boolean') out.watermark = c.watermark;
    if (typeof c.replayWatermark === 'boolean') out.replayWatermark = c.replayWatermark;
    if (typeof c.indicatorTitles === 'boolean') out.indicatorTitles = c.indicatorTitles;
    if (typeof c.indicatorValues === 'boolean') out.indicatorValues = c.indicatorValues;
    if (c.compareAutoPercent === true) out.compareAutoPercent = true;
    if (c.rendererConfig != null && typeof c.rendererConfig === 'object') out.rendererConfig = c.rendererConfig;
    if (c.drawings != null && typeof c.drawings === 'object') out.drawings = c.drawings;
    if (c.runtime != null && typeof c.runtime === 'object' && !Array.isArray(c.runtime)) {
        const r = c.runtime as Record<string, unknown>;
        const runtime: CellRuntimeState = {};
        if (typeof r.candleVisible === 'boolean') runtime.candleVisible = r.candleVisible;
        if (typeof r.autoScale === 'boolean') runtime.autoScale = r.autoScale;
        if (Object.keys(runtime).length > 0) out.runtime = runtime;
    }
    if (Array.isArray(c.panes)) {
        const panes: PaneState[] = [];
        for (const raw of c.panes as unknown[]) {
            if (raw == null || typeof raw !== 'object') continue;
            const p = raw as Record<string, unknown>;
            if (typeof p.id !== 'string' || p.id.length === 0) continue;
            if (p.kind !== 'price' && p.kind !== 'study') continue;
            const indicators: PaneState['indicators'] = [];
            if (Array.isArray(p.indicators)) {
                for (const rawInd of p.indicators as unknown[]) {
                    if (rawInd == null || typeof rawInd !== 'object') continue;
                    const i = rawInd as Record<string, unknown>;
                    if (typeof i.id === 'string' && i.id.length > 0) indicators.push({ id: i.id, ownScale: i.ownScale === true });
                }
            }
            panes.push({
                id: p.id,
                kind: p.kind,
                order: typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : panes.length,
                collapsed: p.collapsed === true,
                maximized: p.maximized === true,
                indicators,
            });
        }
        if (panes.length > 0) out.panes = panes;
    }
    if (Array.isArray(c.objectTreeGroups)) {
        const groups: ObjectGroupState[] = [];
        for (const raw of c.objectTreeGroups as unknown[]) {
            if (raw == null || typeof raw !== 'object') continue;
            const g = raw as Record<string, unknown>;
            if (typeof g.id !== 'string' || typeof g.name !== 'string' || !Array.isArray(g.ids)) continue;
            const ids = (g.ids as unknown[]).filter((x): x is string => typeof x === 'string');
            const indicators = Array.isArray(g.indicators) ? g.indicators.filter((x): x is string => typeof x === 'string') : [];
            const indicatorRefs = Array.isArray(g.indicatorRefs) ? g.indicatorRefs.flatMap((v): Array<{ id: string; key: string; ordinal: number }> => {
                if (!v || typeof v !== 'object') return [];
                const r = v as Record<string, unknown>;
                return typeof r.id === 'string' && typeof r.key === 'string' && typeof r.ordinal === 'number' && Number.isInteger(r.ordinal) && r.ordinal >= 0 ? [{ id: r.id, key: r.key, ordinal: r.ordinal }] : [];
            }) : [];
            groups.push({ id: g.id, name: g.name, ids, ...(indicators.length > 0 ? { indicators } : {}), ...(indicatorRefs.length > 0 ? { indicatorRefs } : {}), ...(typeof g.parent === 'string' ? { parent: g.parent } : {}) });
        }
        out.objectTreeGroups = groups;
    }
    const ind = c.indicators as Record<string, unknown> | undefined;
    if (ind != null && typeof ind === 'object') {
        // Bare names pass as-is; object entries keep only a string name and plain-object
        // value bags (the add path validates individual values against the schema).
        const bag = (v: unknown): Record<string, unknown> | undefined => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
        const manifest: PersistedManifestEntry[] = Array.isArray(ind.manifest)
            ? ind.manifest.flatMap((n): PersistedManifestEntry[] => {
                  if (typeof n === 'string') return [n];
                  if (n != null && typeof n === 'object' && typeof (n as { name?: unknown }).name === 'string') {
                      const e = n as { name: string; inputs?: unknown; props?: unknown; hidden?: unknown; source?: unknown; language?: unknown };
                      const inputs = bag(e.inputs);
                      const props = bag(e.props);
                      const hidden = e.hidden === true;
                      const source = typeof e.source === 'string' && e.source ? e.source : undefined;
                      const language = typeof e.language === 'string' ? e.language : undefined;
                      return [inputs || props || hidden || source ? { name: e.name, ...(inputs ? { inputs } : {}), ...(props ? { props } : {}), ...(hidden ? { hidden } : {}), ...(source ? { source } : {}), ...(language ? { language } : {}) } : e.name];
                  }
                  return [];
              })
            : [];
        // Native entries mirror the manifest shape: bare types pass as-is; object entries
        // keep only a string type, a plain-object input bag, and a true hidden flag.
        const natives: PersistedNativeEntry[] = Array.isArray(ind.natives)
            ? ind.natives.flatMap((n): PersistedNativeEntry[] => {
                  if (typeof n === 'string') return [n];
                  if (n != null && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string') {
                      const e = n as { type: string; inputs?: unknown; props?: unknown; hidden?: unknown };
                      const inputs = bag(e.inputs);
                      const props = bag(e.props);
                      const hidden = e.hidden === true;
                      return [inputs || props || hidden ? { type: e.type, ...(inputs ? { inputs } : {}), ...(props ? { props } : {}), ...(hidden ? { hidden } : {}) } : e.type];
                  }
                  return [];
              })
            : [];
        out.indicators = { manifest, natives };
    }
    const ext = sanitizeExt(c.ext);
    if (ext) out.ext = ext;
    return out;
}

/** A plain string-keyed map of opaque JSON values (drawings-by-symbol, saved layouts).
 *  Entries with a null/undefined or non-object payload are dropped — every consumer
 *  validates its own document anyway. */
function sanitizeRecordMap(raw: unknown): Record<string, unknown> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (k.length === 0 || v == null || typeof v !== 'object') continue;
        out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizeSync(raw: unknown): SyncOptions | null {
    if (raw == null || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const out: SyncOptions = {};
    for (const kind of SYNC_KINDS) {
        const v = s[kind];
        if (v === true) out[kind] = true;
        else if (v != null && typeof v === 'object') {
            const groups: Record<string, string> = {};
            for (const [id, g] of Object.entries(v as Record<string, unknown>)) if (typeof g === 'string') groups[id] = g;
            if (Object.keys(groups).length > 0) out[kind] = groups as SyncSetting;
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizePanels(raw: unknown): PanelsState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    const out: PanelsState = {};
    if (typeof p.open === 'string' && p.open) out.open = p.open;
    if (p.widths != null && typeof p.widths === 'object') {
        const widths: Record<string, number> = {};
        // Widths are clamped again by the panel that receives them; here we only reject values
        // that are not a usable number at all.
        for (const [id, px] of Object.entries(p.widths as Record<string, unknown>)) {
            if (typeof px === 'number' && Number.isFinite(px) && px > 0) widths[id] = px;
        }
        if (Object.keys(widths).length > 0) out.widths = widths;
    }
    if (Array.isArray(p.pinned)) {
        const pinned = p.pinned.filter((id): id is string => typeof id === 'string' && id !== '');
        if (pinned.length > 0) out.pinned = [...new Set(pinned)];
    }
    for (const key of ['floating', 'floatingOpen'] as const) {
        if (!Array.isArray(p[key])) continue;
        const ids = (p[key] as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '');
        if (ids.length) out[key] = [...new Set(ids)];
    }
    if (p.floatPositions != null && typeof p.floatPositions === 'object' && !Array.isArray(p.floatPositions)) {
        const positions: Record<string, FloatingPanelPosition> = {};
        for (const [id, value] of Object.entries(p.floatPositions as Record<string, unknown>)) {
            if (!id || id === '__proto__' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
            const { x, y } = value as Record<string, unknown>;
            if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1
                && typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= 1) positions[id] = { x, y };
        }
        if (Object.keys(positions).length) out.floatPositions = positions;
    }
    if (p.tops != null && typeof p.tops === 'object') {
        const tops: Record<string, number> = {};
        for (const [id, value] of Object.entries(p.tops as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) tops[id] = value;
        }
        if (Object.keys(tops).length > 0) out.tops = tops;
    }
    for (const key of ['heights', 'desktopHeights'] as const) {
        const rawHeights = p[key];
        if (rawHeights == null || typeof rawHeights !== 'object' || Array.isArray(rawHeights)) continue;
        const heights: Record<string, number> = {};
        for (const [id, value] of Object.entries(rawHeights as Record<string, unknown>)) {
            if (id && typeof value === 'number' && Number.isFinite(value) && value >= 0.05 && value <= 1) heights[id] = value;
        }
        if (Object.keys(heights).length > 0) out[key] = heights;
    }
    return out.open || out.widths || out.pinned || out.floating || out.floatingOpen || out.floatPositions
        || out.tops || out.heights || out.desktopHeights ? out : null;
}

function sanitizeTrackSizes(raw: unknown): Record<string, TrackSizes> | null {
    if (raw == null || typeof raw !== 'object') return null;
    const out: Record<string, TrackSizes> = {};
    for (const [layoutId, ts] of Object.entries(raw as Record<string, unknown>)) {
        if (ts == null || typeof ts !== 'object') continue;
        const t = ts as Record<string, unknown>;
        const entry: TrackSizes = {};
        for (const axis of ['cols', 'rows'] as const) {
            const arr = t[axis];
            if (Array.isArray(arr) && arr.length > 0 && arr.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)) {
                entry[axis] = arr as number[];
            }
        }
        if (entry.cols || entry.rows) out[layoutId] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
}
