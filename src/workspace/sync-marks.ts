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
// 43000629992) but not the list itself, so the size here is ours. The list is SIXTEEN —
// one per chart of the biggest layout we support — and what a surface OFFERS is a slice
// of it ({@link groupsForCount}): a 1×1 layout offers one mark, a 2×2 offers four, a 4×4
// offers sixteen. Past ten the marks stop being only colours (a square, a diamond, a
// triangle, a star, a flower), because colour alone is one channel and WCAG 1.4.1 asks
// for a second one.
//
// Users can repaint a group ({@link setMarkOverrides}): the override map is keyed by the
// STABLE id and is per-document state, so a custom glyph survives a reload, a layout
// change and an import, and it never changes what propagation compares.
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
    // From here on the marks are SHAPES first and colours second (square, flower, star,
    // diamond, triangle, gem) so sixteen groups are still sixteen distinguishable things
    // in monochrome, on a tiny chip, and for a user who cannot separate the reds.
    { id: 'cyan', mark: '🟦', color: 'hsl(190 82% 48%)', name: 'Cyan' },
    { id: 'pink', mark: '🌸', color: 'hsl(330 76% 66%)', name: 'Pink' },
    { id: 'star', mark: '⭐', color: 'hsl(45 96% 58%)', name: 'Star' },
    { id: 'diamond', mark: '🔷', color: 'hsl(205 82% 54%)', name: 'Diamond' },
    { id: 'triangle', mark: '🔺', color: 'hsl(6 76% 58%)', name: 'Triangle' },
    { id: 'gem', mark: '💠', color: 'hsl(178 68% 48%)', name: 'Gem' },
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
 * Per-document repaints, keyed by the stable id (`{ red: '🦊' }`). A module-level map
 * because the mark is read from a dozen places (chip, matrix cell, legend, status badge)
 * and threading a resolver through all of them would leak one widget's state into every
 * constructor in between. One workspace per document is the supported shape; a host that
 * mounts two must set this again before painting the second.
 */
let MARK_OVERRIDES: Readonly<Record<string, string>> = {};

/** Replace the custom glyphs. Pass `null` to fall back to the palette. */
export function setMarkOverrides(next: Readonly<Record<string, string>> | null): void {
    MARK_OVERRIDES = next ? { ...next } : {};
}

/** The current custom glyphs (a copy — callers may iterate safely). */
export function markOverrides(): Record<string, string> {
    return { ...MARK_OVERRIDES };
}

/** The user's glyph for a stable id, if one was set. */
export function markOverrideOf(id: string | undefined | null): string | undefined {
    return id ? MARK_OVERRIDES[id] : undefined;
}

/**
 * How many marks a surface with `count` charts offers: one per chart, capped by the
 * palette. Groups already in use beyond that slice are appended, so shrinking a 4×4 to a
 * 2×2 never hides an assignment the user still has to be able to edit or undo.
 */
export function groupsForCount(count: number, inUse: Iterable<string> = []): SyncGroupDef[] {
    const want = Math.max(1, Math.min(SYNC_GROUPS.length, Math.floor(count) || 1));
    const out: SyncGroupDef[] = SYNC_GROUPS.slice(0, want);
    const seen = new Set(out.map((g) => g.id));
    for (const raw of inUse) {
        const def = groupDef(raw);
        if (def && !seen.has(def.id)) {
            out.push(def);
            seen.add(def.id);
        }
    }
    return out;
}

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

/** The display MARK for any stored value — a custom glyph wins, then the palette, then
 *  the value itself (a host's own group key renders as itself). */
export function groupMarkOf(value: string | undefined | null): string | undefined {
    if (value == null || value === '') return undefined;
    const id = groupIdOf(value);
    return (id ? MARK_OVERRIDES[id] : undefined) ?? groupDef(value)?.mark ?? id ?? value;
}

/** A human name for the legend — `'Red'`, or the custom key itself. */
export function groupNameOf(value: string | undefined | null): string | undefined {
    if (value == null || value === '') return undefined;
    // The all-cells form stores 'A' (its id); "A" is a poor name in a legend two rows
    // under a column headed "ALL", so it reads by what it does.
    if (value === 'A') return 'All charts';
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
