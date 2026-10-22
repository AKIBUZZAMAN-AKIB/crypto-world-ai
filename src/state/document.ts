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
 * `open` is the single panel showing (the dock is exclusive); `widths` holds only the columns
 * the user actually resized, by panel id, so a panel's declared width stays in charge until
 * then; `pinned` lists the floating (overlay) panels the user pinned as columns. Absent
 * altogether in documents written before the dock existed.
 */
export interface PanelsState {
    open?: string;
    widths?: Record<string, number>;
    pinned?: string[];
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
    /** The renderer's cosmetic config document (`renderer.getConfig()`). */
    rendererConfig?: unknown;
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
export type PersistedManifestEntry = string | { name: string; inputs?: Record<string, unknown>; props?: Record<string, unknown>; hidden?: boolean };

/** One persisted native-indicator entry (see `CellState.indicators`). The bare TYPE is
 *  the historical shape and still the common case; the object form carries the input
 *  DELTAS and/or the hidden flag so native settings and visibility survive a reload. */
export type PersistedNativeEntry = string | { type: string; inputs?: Record<string, unknown>; hidden?: boolean };

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
    /** Optional link to the market it was captured on (`includeMarket` when saving). */
    symbol?: string;
    timeframe?: string;
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
     * Saved chart TEMPLATES — indicator sets with their settings, no drawings (Vela's
     * documented template contract: applying one REPLACES the chart's indicators; a
     * template never carries drawings). Keyed by name; the market may be carried
     * optionally (the symbol/timeframe chips are off by default, as in TradingView).
     */
    templates?: Record<string, ChartTemplate>;
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
    if (typeof d.activeCellId === 'string') out.activeCellId = d.activeCellId;
    if (typeof d.timezone === 'string' && d.timezone) out.timezone = d.timezone;
    if (Array.isArray(d.favorites)) {
        const favs = d.favorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.favorites = favs;
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
    if (c.rendererConfig != null && typeof c.rendererConfig === 'object') out.rendererConfig = c.rendererConfig;
    if (c.drawings != null && typeof c.drawings === 'object') out.drawings = c.drawings;
    const ind = c.indicators as Record<string, unknown> | undefined;
    if (ind != null && typeof ind === 'object') {
        // Bare names pass as-is; object entries keep only a string name and plain-object
        // value bags (the add path validates individual values against the schema).
        const bag = (v: unknown): Record<string, unknown> | undefined => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
        const manifest: PersistedManifestEntry[] = Array.isArray(ind.manifest)
            ? ind.manifest.flatMap((n): PersistedManifestEntry[] => {
                  if (typeof n === 'string') return [n];
                  if (n != null && typeof n === 'object' && typeof (n as { name?: unknown }).name === 'string') {
                      const e = n as { name: string; inputs?: unknown; props?: unknown; hidden?: unknown };
                      const inputs = bag(e.inputs);
                      const props = bag(e.props);
                      const hidden = e.hidden === true;
                      return [inputs || props || hidden ? { name: e.name, ...(inputs ? { inputs } : {}), ...(props ? { props } : {}), ...(hidden ? { hidden } : {}) } : e.name];
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
                      const e = n as { type: string; inputs?: unknown; hidden?: unknown };
                      const inputs = bag(e.inputs);
                      const hidden = e.hidden === true;
                      return [inputs || hidden ? { type: e.type, ...(inputs ? { inputs } : {}), ...(hidden ? { hidden } : {}) } : e.type];
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
    return out.open || out.widths || out.pinned ? out : null;
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
