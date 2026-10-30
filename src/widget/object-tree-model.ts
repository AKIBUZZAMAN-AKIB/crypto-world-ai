// The object tree AS DATA. This half takes a snapshot of the chart — its panes, the
// indicators in them, the editable stacking order, the drawings — and lays it out as the
// blocks and rows the panel paints. No DOM and no chart calls, so the layout rules (what
// sits in front of what, which pane a drawing belongs to, how a group folds) are all
// unit-testable on plain objects.
import type { PaneInfo } from '../core/options';
import type { SerializedDrawing } from '../core/drawings/Drawing';
import { getDrawingType } from '../core/drawings/registry';

/** A user-made bundle of drawings that hide, lock, delete and move as one. Groups NEST:
 *  `parent` names the group this one sits inside (any depth, like TradingView's object tree),
 *  while `ids` holds only this group's own drawings — membership stays exclusive, so a drawing
 *  is never listed twice. A group with children and no drawings of its own is legal. */
export interface DrawGroup {
    id: string;
    name: string;
    ids: string[];
    /** Indicator instances held directly in this folder. Drawings remain in `ids` for
     * backward compatibility with saved workspaces. Membership is exclusive per kind. */
    indicators?: string[];
    /** Portable references let indicator membership survive regenerated runtime ids. */
    indicatorRefs?: Array<{ id: string; key: string; ordinal: number }>;
    parent?: string;
}

/** The candles. */
export interface PriceRow {
    kind: 'price';
    label: string;
    visible: boolean;
}

export interface IndicatorRow {
    kind: 'indicator';
    id: string;
    label: string;
    visible: boolean;
    /** Draws against its own price scale rather than the pane's — surfaced as a tag. */
    ownScale: boolean;
}

/** One series row in a pane's stack. Study panes hold indicator rows only; the price pane
 *  also holds the candles, stacked among them. */
export type TreeRow = PriceRow | IndicatorRow;

/** A pane's drawings as top-level units, front-most first: a lone drawing, or a group
 *  block surfacing at its front-most member's slot with the members nested inside. */
export type DrawUnit =
    | { kind: 'draw'; drawing: SerializedDrawing }
    | { kind: 'group'; group: DrawGroup; members: SerializedDrawing[]; children: DrawUnit[] };

/** One entry in a pane's rendered stack: a drawing unit, or a series row. */
export type TreeItem = { kind: 'unit'; unit: DrawUnit } | { kind: 'row'; row: TreeRow };

/** One pane's block: its stack read top to bottom as front to back. */
export interface TreePane {
    id: string;
    kind: 'price' | 'study';
    label: string;
    order: number;
    collapsed: boolean;
    maximized: boolean;
    /** The pane's stack, front-most first. With `interleave` the drawings and the series merge
     *  into ONE z-ordered column — a drawing can sit under the candles or between two
     *  indicators; otherwise the drawings lead (they always paint over) and the series follow. */
    items: TreeItem[];
}

/** Everything the layout needs, pulled from the chart by the panel before it renders. */
export interface TreeSnapshot {
    panes: readonly PaneInfo[];
    /** Live visibility per indicator id — the pane model doesn't carry it. */
    indicatorVisible: (id: string) => boolean;
    /** A handle's title, used only as a FALLBACK: the pane model carries the resolved display
     *  title, while a handle can still report the generic placeholder for a script that names
     *  itself late. */
    handleTitle: (id: string) => string | undefined;
    /** Whether the renderer exposes editable stacking (`seriesOrder` + `candleZOrder`). */
    stackable: boolean;
    /** Whether drawings share the series' draw-order space on this renderer (`drawingDepth`):
     *  a drawing then takes a slot anywhere in its pane's column. Without it the panel keeps
     *  every drawing in front of the series, matching how such a renderer paints. */
    interleave: boolean;
    /** `renderer.get('seriesOrder')` — ignored when `stackable` is false. */
    zOrder: ReadonlyArray<{ id: string; z: number }>;
    /** `renderer.get('candleZOrder')` — ignored when `stackable` is false. */
    candleZ: number;
    priceLabel: string;
    priceVisible: boolean;
    drawings: readonly SerializedDrawing[];
    groups: readonly DrawGroup[];
}

export const PRICE_PANE_ID = 'price';
export const PRICE_PANE_LABEL = 'Main chart';

/** A drawing type's display name and icon markup, from the type registry. Unregistered
 *  types fall back to a title-cased key so a plugin drawing still reads as a name. */
export function drawingMeta(type: string): { label: string; icon: string | null } {
    const meta = getDrawingType(type);
    if (meta) return { label: meta.label, icon: meta.icon };
    return { label: String(type || 'drawing').replace(/(^|\s)\S/g, (c) => c.toUpperCase()), icon: null };
}

/** A drawing's row label — its type's name, plus its own text when it carries any. */
export function drawingLabel(d: SerializedDrawing): string {
    const { label } = drawingMeta(d.type);
    const text = d.text?.value?.trim();
    return text ? `${label} — ${text}` : label;
}

/** A pane's display name: the price pane is the main chart, a study pane borrows the title
 *  of the indicator that owns its scale (falling back to its slot number). */
export function paneLabel(pane: PaneInfo, fallbackTitle: (id: string) => string | undefined): string {
    if (pane.kind === 'price') return PRICE_PANE_LABEL;
    const master = pane.indicators.find((i) => !i.ownScale) ?? pane.indicators[0];
    if (master) return indicatorLabel(master, fallbackTitle);
    return `Pane ${pane.order + 1}`;
}

/** An indicator's full display name. */
function indicatorLabel(i: PaneInfo['indicators'][number], fallbackTitle: (id: string) => string | undefined): string {
    return i.title || fallbackTitle(i.id) || i.id;
}

/** An indicator row's label: the compact name it declares — matching its legend chip — or
 *  else its full name. */
function indicatorRowLabel(i: PaneInfo['indicators'][number], fallbackTitle: (id: string) => string | undefined): string {
    return i.shorttitle || indicatorLabel(i, fallbackTitle);
}

/** The pane's series rows, extracted from its stack in rendered (front-first) order. */
export function paneRows(pane: TreePane): TreeRow[] {
    return pane.items.flatMap((it) => (it.kind === 'row' ? [it.row] : []));
}

// ── the stack as tokens ────────────────────────────────────────────────────
// A reorder works on the pane's stack FLATTENED to one token per z key: the candles, each
// indicator, each drawing (a group contributes one token per member, so the bundle stays
// contiguous). Front-most first, mirroring how the panel reads.

export type StackToken = { kind: 'price' } | { kind: 'indicator'; id: string } | { kind: 'drawing'; id: string };

export function sameToken(a: StackToken, b: StackToken): boolean {
    if (a.kind === 'price' || b.kind === 'price') return a.kind === b.kind;
    return a.kind === b.kind && a.id === b.id;
}

function unitTokens(u: DrawUnit): StackToken[] {
    if (u.kind === 'draw') return [{ kind: 'drawing', id: u.drawing.id }];
    const members = (unit: DrawUnit): SerializedDrawing[] => unit.kind === 'draw'
        ? [unit.drawing]
        : [...unit.members, ...unit.children.flatMap(members)];
    // Nested descendants are real stack tokens too; dropping them would otherwise
    // rewrite an incomplete z-stack on the next visual-order operation.
    return members(u).sort((a, b) => b.zIndex - a.zIndex).map((m) => ({ kind: 'drawing' as const, id: m.id }));
}

function itemTokens(item: TreeItem): StackToken[] {
    if (item.kind === 'unit') return unitTokens(item.unit);
    return [item.row.kind === 'price' ? { kind: 'price' } : { kind: 'indicator', id: item.row.id }];
}

/** The pane's whole stack as tokens, front-most first. */
export function paneTokens(pane: TreePane): StackToken[] {
    return pane.items.flatMap(itemTokens);
}

/** Where a slot between rendered items lands in the token list — a group is one item but
 *  as many tokens as it has members. */
export function tokenIndexOfSlot(pane: TreePane, slot: number): number {
    let at = 0;
    for (let i = 0; i < Math.min(slot, pane.items.length); i += 1) at += itemTokens(pane.items[i]!).length;
    return at;
}

/** Where a drop inside a group lands in the token list: at the member it points at, or —
 *  past the last member — right after the group's run. */
export function groupTokenIndex(pane: TreePane, groupId: string, memberSlot: number): number {
    let at = 0;
    for (const item of pane.items) {
        if (item.kind === 'unit' && item.unit.kind === 'group' && item.unit.group.id === groupId) {
            return at + Math.min(memberSlot, unitTokens(item.unit).length);
        }
        at += itemTokens(item).length;
    }
    return at;
}

/**
 * Place `dragged` (as one contiguous run) at token index `at`, measured against the stack AS
 * RENDERED — lifting the dragged tokens out first shifts everything below them up, so dropping
 * a row just beneath itself means "stay put", not "move down one". Tokens arriving from
 * another pane aren't in the list yet and are simply inserted.
 */
export function placeTokens(tokens: readonly StackToken[], dragged: readonly StackToken[], at: number): StackToken[] {
    const isDragged = (t: StackToken): boolean => dragged.some((d) => sameToken(d, t));
    let adjusted = at;
    tokens.forEach((t, i) => {
        if (i < at && isDragged(t)) adjusted -= 1;
    });
    const rest = tokens.filter((t) => !isDragged(t));
    rest.splice(Math.max(0, Math.min(adjusted, rest.length)), 0, ...dragged);
    return rest;
}

export function tokensEqual(a: readonly StackToken[], b: readonly StackToken[]): boolean {
    return a.length === b.length && a.every((t, i) => sameToken(t, b[i]!));
}

/** The four TradingView Visual Order commands. Front/back go to an edge; the other two move
 *  a selection one level through the front-first stack. */
export type VisualOrderMove = 'front' | 'back' | 'forward' | 'backward';

/**
 * Move one object, a group, or a multi-selection as ONE contiguous run. The returned stack
 * is front-first; a group keeps its own internal order and receives consecutive z keys when
 * it is written. This is the menu twin of dragging a row in the object tree.
 */
export function reorderTokens(tokens: readonly StackToken[], dragged: readonly StackToken[], move: VisualOrderMove): StackToken[] {
    // Derive the picked run from the pane itself: duplicate picks and ids from another pane
    // disappear, and the members keep the only order the renderer already paints.
    const picked = tokens.filter((t) => dragged.some((d) => sameToken(d, t)));
    if (picked.length === 0) return [...tokens];
    const indices = tokens.flatMap((t, i) => (picked.some((p) => sameToken(p, t)) ? [i] : []));
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    const at =
        move === 'front'
            ? 0
            : move === 'back'
              ? tokens.length
              : move === 'forward'
                ? first - 1
                : last + 2;
    return placeTokens(tokens, picked, Math.max(0, Math.min(at, tokens.length)));
}

/** The extremes of a pane's stacking — still useful to hosts that expose raw z keys. Zero is
 *  always in range so an empty stack has bounds. `extra` folds in drawing keys. */
export function zStackBounds(zOrder: ReadonlyArray<{ id: string; z: number }>, candleZ: number, extra: readonly number[] = []): { top: number; bottom: number } {
    const zs = [...zOrder.map((e) => e.z), ...extra];
    return { top: Math.max(candleZ, 0, ...zs), bottom: Math.min(candleZ, 0, ...zs) };
}

/**
 * z keys for a FRONT-FIRST token stack — the front-most token takes the highest key, so one
 * write renormalizes the whole pane into contiguous, tie-free values. `candleZ` is null when
 * the candles aren't in the stack (a study pane); `series` feeds `seriesOrder`, `drawings`
 * feeds `zIndex` patches.
 *
 * On a renderer without a shared drawing/series z space the two layers are numbered
 * independently: drawing order cannot accidentally rewrite the series' order, while each
 * layer still gets tie-free keys. Native renderers use `interleave = true` (one list).
 */
export function stackWrites(tokens: readonly StackToken[], interleave = true): {
    candleZ: number | null;
    series: Array<{ id: string; z: number }>;
    drawings: Array<{ id: string; z: number }>;
} {
    let candleZ: number | null = null;
    const series: Array<{ id: string; z: number }> = [];
    const drawings: Array<{ id: string; z: number }> = [];
    const write = (t: StackToken, z: number): void => {
        if (t.kind === 'price') candleZ = z;
        else if (t.kind === 'indicator') series.push({ id: t.id, z });
        else drawings.push({ id: t.id, z });
    };
    if (interleave) {
        const n = tokens.length;
        tokens.forEach((t, i) => write(t, n - i));
    } else {
        const seriesTokens = tokens.filter((t) => t.kind !== 'drawing');
        const drawingTokens = tokens.filter((t) => t.kind === 'drawing');
        seriesTokens.forEach((t, i) => write(t, seriesTokens.length - i));
        drawingTokens.forEach((t, i) => write(t, drawingTokens.length - i));
    }
    return { candleZ, series, drawings };
}

/**
 * A pane's drawings, FRONT-MOST FIRST. Orphans — drawings left behind by a pane that no
 * longer exists — fold into the price pane so they stay reachable rather than vanishing.
 */
export function paneDrawings(drawings: readonly SerializedDrawing[], paneId: string, paneIds: ReadonlySet<string>): SerializedDrawing[] {
    const mine = drawings.filter((d) => (paneId === PRICE_PANE_ID ? d.paneId === PRICE_PANE_ID || !paneIds.has(d.paneId) : d.paneId === paneId));
    return mine.slice().reverse(); // the store lists paint order (back→front); the tree leads with the front
}

/** The group a drawing belongs to, or null. */
export function groupOf(groups: readonly DrawGroup[], drawingId: string): DrawGroup | null {
    return groups.find((g) => g.ids.includes(drawingId)) ?? null;
}

/** An indicator can belong to one folder, independently of drawing ids. */
export function indicatorGroupOf(groups: readonly DrawGroup[], indicatorId: string): DrawGroup | null {
    return groups.find((g) => g.indicators?.includes(indicatorId)) ?? null;
}

/** Every indicator in a folder's nested branch. */
export function groupIndicatorIds(groups: readonly DrawGroup[], id: string): string[] {
    return subtreeGroupIds(groups, id).flatMap((gid) => groupById(groups, gid)?.indicators ?? []);
}

/** File indicator instances without moving their chart pane or changing their z-order. */
export function assignIndicatorsToGroup(groups: readonly DrawGroup[], groupId: string, ids: readonly string[]): DrawGroup[] {
    if (!groups.some((g) => g.id === groupId)) return [...groups];
    const moving = new Set(ids);
    const next = groups.map((g) => {
        const kept = (g.indicators ?? []).filter((id) => !moving.has(id));
        const indicators = g.id === groupId ? [...kept, ...ids.filter((id) => !kept.includes(id))] : kept;
        return { ...g, indicators };
    });
    return pruneGroups(next, new Set(next.flatMap((g) => g.ids)), new Set(next.flatMap((g) => g.indicators ?? [])));
}

export function removeIndicatorsFromGroups(groups: readonly DrawGroup[], ids: readonly string[]): DrawGroup[] {
    const drop = new Set(ids);
    const next = groups.map((g) => ({ ...g, indicators: (g.indicators ?? []).filter((id) => !drop.has(id)) }));
    return pruneGroups(next, new Set(next.flatMap((g) => g.ids)), new Set(next.flatMap((g) => g.indicators ?? [])));
}

/** A group by id, or null. */
export function groupById(groups: readonly DrawGroup[], id: string): DrawGroup | null {
    return groups.find((g) => g.id === id) ?? null;
}

/** The groups nested directly inside `parentId` (a missing parent reads as top level). */
export function childGroups(groups: readonly DrawGroup[], parentId: string | undefined): DrawGroup[] {
    return groups.filter((g) => (g.parent ?? undefined) === parentId);
}

/** A group plus every group nested under it, parents before their children. */
export function subtreeGroupIds(groups: readonly DrawGroup[], id: string): string[] {
    const out: string[] = [];
    const walk = (gid: string): void => {
        if (out.includes(gid)) return;
        out.push(gid);
        for (const c of childGroups(groups, gid)) walk(c.id);
    };
    walk(id);
    return out;
}

/** True when `id` is `maybeAncestor` or sits anywhere inside it — the guard that stops a drag
 *  from nesting a group inside itself (which would detach the whole branch from the tree). */
export function groupWithin(groups: readonly DrawGroup[], id: string, maybeAncestor: string): boolean {
    let at: DrawGroup | null = groupById(groups, id);
    for (let guard = 0; at !== null && guard <= groups.length; guard += 1) {
        if (at.id === maybeAncestor) return true;
        at = at.parent === undefined ? null : groupById(groups, at.parent);
    }
    return false;
}

/** Every drawing a group owns: its own, plus everything nested under it. */
export function groupDrawingIds(groups: readonly DrawGroup[], id: string): string[] {
    const out: string[] = [];
    for (const gid of subtreeGroupIds(groups, id)) {
        const g = groupById(groups, gid);
        if (g) for (const d of g.ids) if (!out.includes(d)) out.push(d);
    }
    return out;
}

/** How deep a group sits: 0 for a top-level group. */
export function groupDepth(groups: readonly DrawGroup[], id: string): number {
    let depth = 0;
    let at: DrawGroup | null = groupById(groups, id);
    while (at?.parent !== undefined && depth <= groups.length) {
        at = groupById(groups, at.parent);
        depth += 1;
    }
    return depth;
}

/** Move (or un-nest, with `null`) a group. Refuses a move into its own subtree. */
export function setGroupParent(groups: readonly DrawGroup[], id: string, parent: string | null): DrawGroup[] {
    if (parent !== null && groupWithin(groups, parent, id)) return [...groups];
    if (!groups.some((g) => g.id === id)) return [...groups];
    if (parent !== null && !groups.some((g) => g.id === parent)) return [...groups];
    return groups.map((g) => {
        if (g.id !== id) return g;
        const { parent: _drop, ...rest } = g;
        return parent === null ? rest : { ...rest, parent };
    });
}

/** Dissolve ONE group: its drawings become loose and its child groups move up a level. */
export function liftGroup(groups: readonly DrawGroup[], id: string): DrawGroup[] {
    const g = groupById(groups, id);
    if (!g) return [...groups];
    return groups
        .filter((x) => x.id !== id)
        .map((x) => {
            if ((x.parent ?? undefined) !== id) return x;
            const { parent: _drop, ...rest } = x;
            return g.parent === undefined ? rest : { ...rest, parent: g.parent };
        });
}

/**
 * A group's aggregate state, which is what its own eye and padlock report. Both read as "on"
 * only when EVERY member agrees: one hidden member must not make the whole bundle look hidden,
 * or the group's eye would offer to show what is already showing.
 */
export function groupState(members: readonly SerializedDrawing[]): { allHidden: boolean; allLocked: boolean } {
    return {
        allHidden: members.length > 0 && members.every((d) => d.visible === false),
        allLocked: members.length > 0 && members.every((d) => d.locked === true),
    };
}

/** Whether a selection can form a fresh group: something is selected, and none of it is
 *  already grouped — a drawing belongs to at most one group. */
export function canGroup(ids: readonly string[], groups: readonly DrawGroup[]): boolean {
    return ids.length > 0 && ids.every((id) => groupOf(groups, id) === null);
}

/** The next default group name: the lowest `Group N` no existing group has taken. */
export function nextGroupName(groups: readonly DrawGroup[]): string {
    const taken = new Set(groups.map((g) => g.name));
    // One of the first n+1 candidates is always free, since n groups can occupy at most n.
    for (let n = 1; n <= groups.length; n += 1) {
        const name = `Group ${n}`;
        if (!taken.has(name)) return name;
    }
    return `Group ${groups.length + 1}`;
}

/** Rebuild a group list with only the members that pass `keep`. A group left with nobody in
 *  it disappears rather than lingering as an empty row. */
function withMembers(groups: readonly DrawGroup[], keep: (id: string) => boolean): DrawGroup[] {
    const next = groups.map((g) => ({ ...g, ids: g.ids.filter(keep) }));
    return pruneGroups(next, new Set(next.flatMap((g) => g.ids)));
}

/** Drop members that no longer exist, then any group left with neither a drawing nor a nested
 *  group — an empty group is not a container you can find again, so it disappears (the rule
 *  TradingView's object tree follows), and a branch that lost its last leaf goes with it. */
export function pruneGroups(groups: readonly DrawGroup[], live: ReadonlySet<string>, liveIndicators?: ReadonlySet<string>): DrawGroup[] {
    // A drawing-only caller does not know which indicators exist; preserve them unless
    // it explicitly supplies the live set. An empty set means none are alive.
    const kept = groups.map((g) => ({
        ...g,
        ids: g.ids.filter((id) => live.has(id)),
        ...(g.indicators ? { indicators: liveIndicators ? g.indicators.filter((id) => liveIndicators.has(id)) : [...g.indicators] } : {}),
    }));
    // A parent that no longer exists reads as top level rather than orphaning the branch.
    const ids = new Set(kept.map((g) => g.id));
    const rooted: DrawGroup[] = kept.map((g) => (g.parent !== undefined && !ids.has(g.parent) ? (({ parent: _d, ...rest }) => rest)(g) : g));
    let current = rooted;
    for (let guard = 0; guard <= rooted.length; guard += 1) {
        const hasChild = new Set(current.map((g) => g.parent).filter((x): x is string => x !== undefined));
        const next = current.filter((g) => g.ids.length > 0 || (g.indicators?.length ?? 0) > 0 || hasChild.has(g.id));
        if (next.length === current.length) break;
        current = next;
    }
    return current;
}

/** Take drawings out of whatever group they were in. */
export function removeFromGroups(groups: readonly DrawGroup[], ids: readonly string[]): DrawGroup[] {
    const drop = new Set(ids);
    return withMembers(groups, (id) => !drop.has(id));
}

/** Put drawings into one group, taking them out of any other on the way — membership is
 *  exclusive, so a drawing can never show up under two groups at once. */
export function assignToGroup(groups: readonly DrawGroup[], groupId: string, ids: readonly string[]): DrawGroup[] {
    const moving = new Set(ids);
    const next = groups.map((g) => {
        const kept = g.ids.filter((id) => !moving.has(id));
        return { ...g, ids: g.id === groupId ? [...kept, ...ids] : kept };
    });
    return pruneGroups(next, new Set(next.flatMap((g) => g.ids)));
}

/**
 * Fold a pane's front-first drawings into top-level units. A grouped drawing surfaces as
 * part of its group's block at the front-most member's slot, so a group never scatters.
 */
export function drawingUnits(paneDraws: readonly SerializedDrawing[], groups: readonly DrawGroup[]): DrawUnit[] {
    const inPane = new Set(paneDraws.map((d) => d.id));
    // Only groups with a drawing on THIS pane take part, recursively: a group whose members
    // all live in another pane must not leave an empty block behind.
    const relevant = (g: DrawGroup): boolean =>
        g.ids.some((id) => inPane.has(id)) || childGroups(groups, g.id).some((c) => relevant(c));
    const build = (g: DrawGroup): DrawUnit => {
        const members = paneDraws.filter((x) => g.ids.includes(x.id));
        const children = childGroups(groups, g.id)
            .filter((c) => relevant(c))
            .map((c) => build(c))
            .sort((a, b) => unitSlot(a) - unitSlot(b));
        return { kind: 'group', group: g, members, children };
    };
    // Children read in paint order (front-most first) — measured by the front-most drawing each
    // subtree owns, so a nested group surfaces where its contents do.
    const unitSlot = (u: DrawUnit): number => {
        if (u.kind === 'draw') return paneDraws.findIndex((d) => d.id === u.drawing.id);
        const slots = [...u.members.map((m) => paneDraws.findIndex((d) => d.id === m.id)), ...u.children.map(unitSlot)];
        const live = slots.filter((n) => n >= 0);
        return live.length > 0 ? Math.min(...live) : Number.MAX_SAFE_INTEGER;
    };
    // A drawing's block surfaces at its OUTERMOST group, so a nested branch never scatters.
    const rootOf = (d: SerializedDrawing): DrawGroup | null => {
        let at = groupOf(groups, d.id);
        if (!at) return null;
        for (let guard = 0; at.parent !== undefined && guard <= groups.length; guard += 1) {
            const up = groupById(groups, at.parent);
            if (!up) break;
            at = up;
        }
        return at;
    };
    const units: DrawUnit[] = [];
    const seen = new Set<string>();
    for (const d of paneDraws) {
        if (seen.has(d.id)) continue;
        const root = rootOf(d);
        if (root && relevant(root)) {
            const unit = build(root);
            const ids = groupDrawingIds(groups, root.id);
            for (const id of ids) if (inPane.has(id)) seen.add(id);
            units.push(unit);
        } else {
            seen.add(d.id);
            units.push({ kind: 'draw', drawing: d });
        }
    }
    return units;
}

/** A unit's z key: its front-most member's. That is the slot a group surfaces at, so a
 *  bundle whose members straddle a series still reads as one block. */
function unitZ(u: DrawUnit): number {
    if (u.kind === 'draw') return u.drawing.zIndex;
    const zs = [...u.members.map((m) => m.zIndex), ...u.children.map(unitZ)];
    return zs.length > 0 ? Math.max(...zs) : 0;
}

/**
 * One pane's stack. With interleaving, drawings and series merge into a single column sorted
 * by z (a drawing tying a series paints under it, so the series row comes first); without it,
 * the drawings lead — they always paint over the series — and the series follow.
 */
function paneItems(snap: TreeSnapshot, pane: PaneInfo, units: DrawUnit[]): TreeItem[] {
    const priceRow = (): PriceRow => ({ kind: 'price', label: snap.priceLabel, visible: snap.priceVisible });
    const indicatorRow = (i: PaneInfo['indicators'][number]): IndicatorRow => ({
        kind: 'indicator',
        id: i.id,
        label: indicatorRowLabel(i, snap.handleTitle),
        visible: snap.indicatorVisible(i.id),
        ownScale: i.ownScale,
    });
    const unitItems: TreeItem[] = units.map((unit) => ({ kind: 'unit', unit }));
    if (!snap.stackable) {
        const rows: TreeItem[] = pane.indicators.map((i) => ({ kind: 'row', row: indicatorRow(i) }));
        if (pane.kind === 'price') rows.unshift({ kind: 'row', row: priceRow() });
        return [...unitItems, ...rows];
    }
    const zOf = new Map(snap.zOrder.map((e) => [e.id, e.z]));
    const rows: Array<{ item: TreeItem; z: number }> = pane.indicators.map((i) => ({ item: { kind: 'row', row: indicatorRow(i) }, z: zOf.get(i.id) ?? 0 }));
    if (pane.kind === 'price') rows.push({ item: { kind: 'row', row: priceRow() }, z: snap.candleZ });
    rows.sort((a, b) => b.z - a.z);
    if (!snap.interleave) return [...unitItems, ...rows.map((r) => r.item)];
    const entries = [...rows, ...units.map((unit) => ({ item: { kind: 'unit', unit } as TreeItem, z: unitZ(unit) }))];
    // Front-first; on a tie the series row leads — a drawing at a series' own z paints under it.
    entries.sort((a, b) => (a.z === b.z ? Number(a.item.kind === 'unit') - Number(b.item.kind === 'unit') : b.z - a.z));
    return entries.map((e) => e.item);
}

/** The whole tree, top pane first. */
export function buildTree(snap: TreeSnapshot): TreePane[] {
    const paneIds = new Set(snap.panes.map((p) => p.id));
    return snap.panes.map((pane) => ({
        id: pane.id,
        kind: pane.kind,
        label: paneLabel(pane, snap.handleTitle),
        order: pane.order,
        collapsed: pane.collapsed,
        maximized: pane.maximized,
        items: paneItems(snap, pane, drawingUnits(paneDrawings(snap.drawings, pane.id, paneIds), snap.groups)),
    }));
}

/** True when the tree has nothing to show — no indicators beyond the candles, no drawings. */
export function treeIsEmpty(panes: readonly TreePane[]): boolean {
    return panes.every((p) => p.items.every((it) => it.kind === 'row' && it.row.kind === 'price'));
}
