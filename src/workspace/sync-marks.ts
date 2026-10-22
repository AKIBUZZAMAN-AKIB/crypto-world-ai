// The chart-syncing PALETTE — the marks a chart can wear, the stable ID behind each one,
// and the color it paints with. Split from `sync.ts` (the propagation rules) so a widget
// can colour a chip without pulling the renderer-facing half of the sync model into its
// graph.
//
// TWO NAMES PER GROUP, on purpose:
//
//   • The ID (`'red'`, `'orange'`, …) is the IDENTITY. It is what a document stores and
//     what propagation compares, so a palette change (a different emoji font, a new mark
//     inserted at the front, a host shipping its own glyphs) can never silently move a
//     chart into another group.
//   • The MARK (`'🔴'`) is the DISPLAY. It is painted in the chip, the status badge and
//     the legend; it is never the key of anything.
//
// TradingView documents the MECHANISM ("pick one of the emojis in the list", support
// 43000629992) but not the list itself, so the size here is ours: TEN distinct groups,
// one per chart of the biggest layout we support (16, so ten is the palette while groups
// can repeat) plus headroom — four colors ran out at the fifth chart and two charts ended
// up in the same group by accident.
//
// Legacy documents (written before the ID existed) store the MARK as the group value.
// Every reader normalizes through {@link groupIdOf}, so old state keeps working and is
// upgraded the next time it is written.

export interface SyncGroupDef {
    /** Stable identity — what documents store and propagation compares. */
    id: string;
    /** The glyph the chip paints. */
    mark: string;
    /** The hue the mark paints with — the same hue as the emoji, so a matrix cell says
     *  "red group" before the emoji font has even loaded (and stays readable where a
     *  color emoji font is missing, which turns every glyph into the same tofu box). */
    color: string;
    /** A human name for the legend and the screen reader. */
    name: string;
}

export const SYNC_GROUPS: readonly SyncGroupDef[] = [
    { id: 'red', mark: '🔴', color: 'hsl(2 78% 58%)', name: 'Red' },
    { id: 'orange', mark: '🟠', color: 'hsl(28 90% 56%)', name: 'Orange' },
    { id: 'yellow', mark: '🟡', color: 'hsl(48 92% 52%)', name: 'Yellow' },
    { id: 'green', mark: '🟢', color: 'hsl(142 62% 46%)', name: 'Green' },
    { id: 'blue', mark: '🔵', color: 'hsl(210 85% 58%)', name: 'Blue' },
    { id: 'purple', mark: '🟣', color: 'hsl(280 68% 62%)', name: 'Purple' },
    { id: 'brown', mark: '🟤', color: 'hsl(26 45% 48%)', name: 'Brown' },
    { id: 'black', mark: '⚫', color: 'hsl(220 8% 30%)', name: 'Black' },
    { id: 'white', mark: '⚪', color: 'hsl(210 12% 86%)', name: 'White' },
    { id: 'amber', mark: '🔶', color: 'hsl(34 92% 56%)', name: 'Amber' },
];

/** The stable IDs, in palette order. */
export const SYNC_GROUP_IDS: readonly string[] = SYNC_GROUPS.map((g) => g.id);

/** The display MARKS, in the order the chip cycles them (kept for the public surface). */
export const SYNC_GROUP_MARKS: readonly string[] = SYNC_GROUPS.map((g) => g.mark);

const BY_ID = new Map(SYNC_GROUPS.map((g) => [g.id, g]));
const BY_MARK = new Map(SYNC_GROUPS.map((g) => [g.mark, g]));
/** Case-insensitive name lookup, so `'Red'` from a typed legend works. */
const BY_NAME = new Map(SYNC_GROUPS.map((g) => [g.name.toLowerCase(), g]));

/**
 * The canonical group ID for any stored value: a stable ID passes through, a legacy MARK
 * maps to its ID, and anything else (a host's own group string) is kept verbatim — the
 * model is open, custom keys keep working.
 */
export function groupIdOf(value: string | undefined | null): string | undefined {
    if (value == null || value === '') return undefined;
    return BY_ID.get(value)?.id ?? BY_MARK.get(value)?.id ?? value;
}

/** The definition behind any stored value (undefined for a host's custom key). */
export function groupDef(value: string | undefined | null): SyncGroupDef | undefined {
    if (value == null || value === '') return undefined;
    return BY_ID.get(value) ?? BY_MARK.get(value) ?? BY_NAME.get(value.toLowerCase());
}

/** The display MARK for any stored value — a custom key renders as itself. */
export function groupMarkOf(value: string | undefined | null): string | undefined {
    if (value == null || value === '') return undefined;
    return groupDef(value)?.mark ?? value;
}

/** A human name for the legend — `'Red'`, or the custom key itself. */
export function groupNameOf(value: string | undefined | null): string | undefined {
    if (value == null || value === '') return undefined;
    return groupDef(value)?.name ?? value;
}

/** The CSS color for a group ID or legacy mark (undefined = caller falls back to accent). */
export function groupMarkColor(value: string | undefined): string | undefined {
    return value ? groupDef(value)?.color : undefined;
}

/** Docs-compatible alias: the palette as `{ id, mark }` pairs. */
export function syncGroupPairs(): Array<{ id: string; mark: string }> {
    return SYNC_GROUPS.map((g) => ({ id: g.id, mark: g.mark }));
}
