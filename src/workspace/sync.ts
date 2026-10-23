// The workspace SYNC model — pure data + pure functions (DOM-free, unit-testable).
//
// Links between cells are GROUP-based from day one: `true` is sugar for "every cell in
// one implicit group", and a record maps cell ids to named groups (the colored-group UI
// later is pure presentation over this same model). Propagation itself lives in the
// workspace (it owns the cells); this module answers the one pure question — "which
// cells follow this origin?" — plus the epsilon test that keeps viewport loops quiet.

// The link TYPES live in the shared state document (`src/state/document.ts`) — sync
// settings are part of the persisted format. Re-exported here unchanged.
import type { SyncKind, SyncOptions, SyncSetting } from '../state/document';
import { CANDLE_OVERRIDE_KEYS } from '../renderers/native/core/chartConfig';
import { SYNC_KINDS } from '../state/document';

import { IMPLICIT_GROUP } from '../state/document';

export type { SyncKind, SyncSetting, SyncOptions } from '../state/document';
export { IMPLICIT_GROUP, SYNC_KINDS } from '../state/document';

import { SYNC_GROUP_IDS, groupIdOf, groupMarkOf } from './sync-marks';
export {
    SYNC_GROUP_IDS,
    SYNC_GROUP_MARKS,
    SYNC_GROUPS,
    groupDef,
    groupIdOf,
    groupMarkColor,
    groupMarkOf,
    groupNameOf,
} from './sync-marks';

/** The update rule behind the picker's group chip: unlinked ⇒ the first FREE group (or
 *  the first one), a group ⇒ the next one, the last ⇒ unlinked. PURE.
 *
 *  It walks the STABLE IDS (`'red'`, `'orange'` …) — the mark is only what gets painted.
 *  `current` and `inUse` are normalized first, so a legacy document that still stores
 *  emoji cycles exactly as it always did. */
export function nextGroupMark(current: string | undefined, inUse: readonly string[], groups: readonly string[] = SYNC_GROUP_IDS): string | null {
    const used = inUse.map((g) => groupIdOf(g) ?? g);
    if (current == null) {
        const free = groups.find((g) => !used.includes(g));
        return free ?? groups[0] ?? null;
    }
    const id = groupIdOf(current) ?? current;
    const i = groups.indexOf(id);
    return i >= 0 && i + 1 < groups.length ? groups[i + 1]! : null;
}

/** Every link's mark for one cell ("this chart is 🔴 for symbol, 🟢 for crosshair") —
 *  PURE, in {@link SYNC_KINDS} order, so the badge reads the same everywhere. */
export function cellGroupMarks(cellId: string, settings: SyncOptions): Array<{ kind: SyncKind; mark: string }> {
    const out: Array<{ kind: SyncKind; mark: string }> = [];
    for (const kind of SYNC_KINDS) {
        const mark = markOf(settings[kind], cellId);
        if (mark) out.push({ kind, mark });
    }
    return out;
}

/** The cells that follow `originId` under `setting` — PURE (never includes the origin). */
export function syncTargets(originId: string, setting: SyncSetting | undefined, cellIds: readonly string[]): string[] {
    if (setting == null || setting === false) return [];
    if (setting === true) return cellIds.filter((id) => id !== originId);
    // Compare CANONICAL ids, so a document written before the ids existed (emoji values)
    // and one written after it (slugs) still see the same group.
    const group = groupIdOf(setting[originId]);
    if (group == null) return []; // the origin is unlinked — nothing follows it
    return cellIds.filter((id) => id !== originId && groupIdOf(setting[id]) === group);
}

/** Whether two visible ranges agree within `epsMs` on both edges — the short-circuit
 *  that stops viewport echo (a followers' re-emission never re-propagates). */
export function rangesWithin(a: { from: number; to: number }, b: { from: number; to: number }, epsMs: number): boolean {
    return Math.abs(a.from - b.from) <= epsMs && Math.abs(a.to - b.to) <= epsMs;
}

/** The renderer-config blocks the STYLE link mirrors whole — every look the settings
 *  dialog edits: the Symbol tab's per-style cosmetics (`candles` … `baseline`) and
 *  animation switches, the Canvas tab (`layout` = background/text, `panes` =
 *  separators, `grid`, `margins`), the Scales-and-lines tab (`priceScale`,
 *  `crosshair`), and the session shading colors. Two blocks travel in part (see
 *  {@link styleConfigPatch}); the rest stays per cell: the draw-order keys name each
 *  cell's own indicators, timeline marks and trade markers are what the host feeds
 *  that cell's market, and `timeScale` is already workspace-global. */
export const STYLE_SYNC_CONFIG_KEYS = [
    'layout',
    'panes',
    'grid',
    'margins',
    'priceScale',
    'crosshair',
    'animations',
    'candles',
    'bars',
    'line',
    'area',
    'baseline',
    'variants',
    'sessions',
] as const;

/**
 * The patch that brings `follower` to `origin`'s style-link slice — PURE (null when
 * the two already agree, or when either document is shapeless). Whole blocks travel
 * as the origin resolved them. `series` contributes only its bar spacing: the chart
 * type stays per cell (a candles cell and a line cell keep their own type) and the
 * baseline price belongs to the cell's market. A plugin chart type contributes only
 * the candle cosmetics it stores in its bag — its own settings mix looks with
 * market-bound computation (sessions, row size) — and a candle key the origin
 * inherits travels as `null`, so the follower inherits it too.
 */
export function styleConfigPatch(origin: unknown, follower: unknown): Record<string, unknown> | null {
    const from = asRecord(origin);
    const to = asRecord(follower);
    if (!from || !to) return null;
    const patch: Record<string, unknown> = {};
    for (const key of STYLE_SYNC_CONFIG_KEYS) {
        const block = asRecord(from[key]);
        if (block && JSON.stringify(block) !== JSON.stringify(to[key])) patch[key] = block;
    }
    const spacing = asRecord(from.series)?.spacing;
    if (typeof spacing === 'number' && spacing !== asRecord(to.series)?.spacing) patch.series = { spacing };
    const fromTypes = asRecord(from.chartTypes) ?? {};
    const toTypes = asRecord(to.chartTypes) ?? {};
    const types: Record<string, Record<string, unknown>> = {};
    for (const typeId of new Set([...Object.keys(fromTypes), ...Object.keys(toTypes)])) {
        const src = asRecord(fromTypes[typeId]) ?? {};
        const dst = asRecord(toTypes[typeId]) ?? {};
        for (const key of CANDLE_OVERRIDE_KEYS) {
            const value = src[key] ?? null;
            if (value !== (dst[key] ?? null)) (types[typeId] ??= {})[key] = value;
        }
    }
    if (Object.keys(types).length > 0) patch.chartTypes = types;
    return Object.keys(patch).length > 0 ? patch : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

// ── Switch state (what the layout dropdown shows) ──────────────────────────────────
//
// The picker's switches are pure presentation over {@link SyncSetting}: `true` and a
// non-empty group record are BOTH "on" — a record is just the grouped form of on. The
// old picker compared with `=== true`, so a host-set group record rendered every switch
// as OFF and the first click silently deleted the groups. These helpers are the one
// truth both shells read.

/** Is the link on — in either form (all-cells, or a group record with members)? */
export function syncEnabled(setting: SyncSetting | undefined): boolean {
    if (setting == null || setting === false) return false;
    if (setting === true) return true;
    return Object.keys(setting).length > 0;
}

/** The distinct group names in a record, in first-seen order (empty for `true`/off). */
export function syncGroups(setting: SyncSetting | undefined): string[] {
    if (setting == null || setting === false || setting === true) return [];
    const seen: string[] = [];
    for (const g of Object.values(setting)) {
        const id = groupIdOf(g) ?? g;
        if (!seen.includes(id)) seen.push(id);
    }
    return seen;
}

/** The group a cell belongs to (undefined when unlinked or in the all-cells form). */
export function groupOf(setting: SyncSetting | undefined, cellId: string): string | undefined {
    if (setting == null || setting === false || setting === true) return undefined;
    return groupIdOf(setting[cellId]);
}


/**
 * The mark a cell carries for one link — the DISPLAY twin of {@link groupOf}. Unlike
 * `groupOf` (which drives propagation and must stay `undefined` for the all-cells form),
 * this answers "what should the chip say": the explicit group, or {@link IMPLICIT_GROUP}
 * when every cell is linked. `undefined` = this chart does not follow the link.
 */
export function markOf(setting: SyncSetting | undefined, cellId: string): string | undefined {
    if (setting === true) return IMPLICIT_GROUP;
    const id = groupOf(setting, cellId);
    return id == null ? undefined : (groupMarkOf(id) ?? id);
}

/**
 * The setting after putting `cellId` in `group` (or taking it out with `null`) — PURE.
 * `base` seeds the record: an existing record is edited, `true` seeds every listed cell
 * into the FIRST group so a host's all-cells link upgrades rather than collapsing.
 * Returns `undefined` when the last member leaves (the link is then simply off).
 */
export function groupSetting(
    base: SyncSetting | undefined,
    cellId: string,
    group: string | null,
    cellIds: readonly string[] = [],
): SyncSetting | undefined {
    const next: Record<string, string> = {};
    if (base != null && base !== true) {
        // Normalize on the way through: the moment a document is edited it is upgraded
        // from legacy emoji values to stable ids.
        for (const [id, g] of Object.entries(base)) next[id] = groupIdOf(g) ?? g;
    } else if (base === true) {
        for (const id of cellIds) next[id] = 'A';
    }
    if (group == null) delete next[cellId];
    else next[cellId] = groupIdOf(group) ?? group;
    return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The follower's range after aligning a clicked instant: same span, re-centered on
 * `timeMs`. Null when the range is degenerate (nothing to preserve). The result is not
 * clamped to history — the chart's own setters clamp, and a partially-visible target
 * instant is still the right answer.
 */
export function alignedRangeAround(range: { from: number; to: number }, timeMs: number): { from: number; to: number } | null {
    const span = range.to - range.from;
    if (!(span > 0) || !Number.isFinite(timeMs)) return null;
    const from = timeMs - span / 2;
    return { from, to: from + span };
}
