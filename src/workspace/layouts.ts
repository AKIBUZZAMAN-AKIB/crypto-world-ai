// The workspace LAYOUT engine — pure data + pure functions (DOM-free, unit-testable).
//
// A layout is a registered descriptor (the same idiom as the chart-type registry): a
// grid of weighted tracks plus the SLOTS it exposes. Slot ids are canonical (`c1`…`cN`)
// and shared by every layout, which is why two layouts need no id coordination — but a
// slot id is pure geometry, NOT a cell identity: which cell lives in slot i is the
// workspace's call (its `cells` declaration order), and a cell dropped by a smaller
// layout parks its state in the pool under its own identity. Asymmetric layouts map
// slots onto named grid areas; the slot ids stay `cN` regardless.
//
// `registerLayout` is the SDK seam: plugins/hosts add denser grids or bespoke
// arrangements, and every workspace layout picker reads the registry live.

/** One registered workspace layout. */
export interface LayoutDefinition {
    /** Stable id (`'4'`, `'2h'`, a plugin's `'6-tall'`, …) — re-registering replaces. */
    id: string;
    /** Human-readable label for layout pickers. */
    label: string;
    /** Column track weights (`fr` units), left to right. */
    cols: number[];
    /** Row track weights, top to bottom. */
    rows: number[];
    /**
     * Optional `grid-template-areas` rows for ASYMMETRIC layouts — one string per row,
     * one area name per column (e.g. `['main a', 'main b']` = a tall left cell besides
     * two stacked ones). Omitted ⇒ cells auto-flow row-major in `cells` order.
     */
    areas?: string[];
    /** The layout's SLOTS, in order — pure geometry: `id` keys the slot's grid styles
     *  and `area` binds it to a named area. A slot id is NOT a cell identity: the cell
     *  living in slot i is decided by the workspace (its `cells` declaration order),
     *  so two layouts sharing slot geometry need no id coordination. Built-ins use
     *  `c1`…`cN`. */
    cells: Array<{ id: string; area?: string }>;
}

/** Grid track sizes overriding a layout's declared weights (splitter drags). */
// TrackSizes is part of the shared state document (`src/state/document.ts`).
import type { TrackSizes } from '../state/document';
import { svg16 } from '../core/icons';

export type { TrackSizes } from '../state/document';

const registry = new Map<string, LayoutDefinition>();

/** Register (or replace) a workspace layout. Pickers read the registry live. */
export function registerLayout(def: LayoutDefinition): void {
    registry.set(def.id, def);
}

export function unregisterLayout(id: string): void {
    registry.delete(id);
}

/** The definition behind a layout id (undefined for unknown ids). */
export function layoutDefinition(id: string): LayoutDefinition | undefined {
    return registry.get(id);
}

/** Every registered layout (registration order) — drives layout pickers. */
export function layouts(): LayoutDefinition[] {
    return [...registry.values()];
}

/** Canonical slot ids `c1`…`cN`. */
function slots(n: number): Array<{ id: string }> {
    return Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}` }));
}

/** Slots bound to named grid areas (`c1`…`cN` in the order given). */
function areaSlots(areas: readonly string[]): Array<{ id: string; area: string }> {
    return areas.map((area, i) => ({ id: `c${i + 1}`, area }));
}

/** Register the built-in presets (idempotent — called by the workspace entry point).
 *
 *  The five uniform presets came first; the ASYMMETRIC ones below are the shapes a
 *  four-chart trader actually wants and the canvas cannot express (a canvas square is
 *  either lit or not — it has no notion of a tall main chart). They ride the same
 *  `areas` machinery plugin layouts use, so nothing downstream changed: the glyph,
 *  the splitters' seam segments and the maximize overlay all read `occupancyGrid`. */
export function registerBuiltinLayouts(): void {
    registerLayout({ id: '1', label: 'Single', cols: [1], rows: [1], cells: slots(1) });
    registerLayout({ id: '2h', label: '2 side by side', cols: [1, 1], rows: [1], cells: slots(2) });
    registerLayout({ id: '2v', label: '2 stacked', cols: [1], rows: [1, 1], cells: slots(2) });
    registerLayout({ id: '4', label: '4 grid', cols: [1, 1], rows: [1, 1], cells: slots(4) });
    registerLayout({ id: '8', label: '8 grid', cols: [1, 1, 1, 1], rows: [1, 1], cells: slots(8) });
    // The 16-chart family (TradingView's Ultimate tier calls it 16; its own help page
    // still documents 8, so treat this as the ceiling OUR pool can hold — POOL_CAP is 16).
    registerLayout({ id: '16', label: '16 grid', cols: [1, 1, 1, 1], rows: [1, 1, 1, 1], cells: slots(16) });

    // ── asymmetric presets (TradingView's 1-2 / 2-1 / 1-3 / 3-1 / 2-3 / 3-2 / 4s family) ──
    registerLayout({ id: '1-2', label: 'Main + 2 below', cols: [1, 1], rows: [1.4, 1], areas: ['a a', 'b c'], cells: areaSlots(['a', 'b', 'c']) });
    registerLayout({ id: '2-1', label: '2 above + main', cols: [1, 1], rows: [1, 1.4], areas: ['a b', 'c c'], cells: areaSlots(['a', 'b', 'c']) });
    registerLayout({ id: '1-3', label: 'Main + 3 below', cols: [1, 1, 1], rows: [1.4, 1], areas: ['a a a', 'b c d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '3-1', label: '3 above + main', cols: [1, 1, 1], rows: [1, 1.4], areas: ['a b c', 'd d d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '2-3', label: '2 above + 3 below', cols: [1, 1, 1, 1, 1, 1], rows: [1, 1.2], areas: ['a a a b b b', 'c c d d e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '3-2', label: '3 above + 2 below', cols: [1, 1, 1, 1, 1, 1], rows: [1.2, 1], areas: ['a a b b c c', 'd d d e e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '4s', label: 'Main left + 3', cols: [2, 1], rows: [1, 1, 1], areas: ['a b', 'a c', 'a d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '4s-r', label: 'Main right + 3', cols: [1, 2], rows: [1, 1, 1], areas: ['a b', 'c b', 'd b'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    // TradingView spells the main-on-the-left family `4s-l`; both ids stay registered so a
    // share link written against either name opens.
    registerLayout({ id: '4s-l', label: 'Main left + 3 (4s-l)', cols: [2, 1], rows: [1, 1, 1], areas: ['a b', 'a c', 'a d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    // 6-c: six charts around a big centre (TV's `6c`).
    registerLayout({
        id: '6c',
        label: '6 around a centre',
        cols: [1, 1, 1, 1],
        rows: [1, 1, 1],
        areas: ['b c c d', 'b a a d', 'e a a f'],
        cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']),
    });
    // 8-h: eight charts in one horizontal row (TV's `8h`; `8` is the 4×2 grid).
    registerLayout({ id: '8h', label: '8 across', cols: [1, 1, 1, 1, 1, 1, 1, 1], rows: [1], cells: slots(8) });

    // ── the rest of TradingView's layout vocabulary ──────────────────────────────
    // Ids match TradingView's `MultipleChartsLayoutType` names so a layout id copied
    // from their UI opens here. The SHAPES are Vela's reading of each name (their exact
    // proportions are not public); every one is a real grid, not an alias.
    //
    // 3 charts: rows, columns, and the two "main + 2" shapes.
    registerLayout({ id: '3h', label: '3 across', cols: [1, 1, 1], rows: [1], cells: slots(3) });
    registerLayout({ id: '3v', label: '3 stacked', cols: [1], rows: [1, 1, 1], cells: slots(3) });
    registerLayout({ id: '3s', label: 'Main left + 2', cols: [2, 1], rows: [1, 1], areas: ['a b', 'a c'], cells: areaSlots(['a', 'b', 'c']) });
    registerLayout({ id: '3r', label: 'Main right + 2', cols: [1, 2], rows: [1, 1], areas: ['a b', 'c b'], cells: areaSlots(['a', 'b', 'c']) });
    // 4 charts, unweighted rows/columns and the left/right-weighted 2+2 variants.
    registerLayout({ id: '4h', label: '4 across', cols: [1, 1, 1, 1], rows: [1], cells: slots(4) });
    registerLayout({ id: '4v', label: '4 stacked', cols: [1], rows: [1, 1, 1, 1], cells: slots(4) });
    registerLayout({ id: '2-2', label: '2 above + 2 below', cols: [1, 1], rows: [1, 1], areas: ['a b', 'c d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '2-2-l', label: '2 above + 2 below (left wide)', cols: [2, 1], rows: [1, 1], areas: ['a b', 'c d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '2-2-r', label: '2 above + 2 below (right wide)', cols: [1, 2], rows: [1, 1], areas: ['a b', 'c d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    // 5 charts: 1 above + 4 below, 4 above + 1 below, and the two "main + 4" shapes.
    registerLayout({ id: '1-4', label: 'Main above + 4', cols: [1, 1, 1, 1], rows: [1.4, 1], areas: ['a a a a', 'b c d e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '4-1', label: '4 above + main below', cols: [1, 1, 1, 1], rows: [1, 1.4], areas: ['a b c d', 'e e e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5h', label: '5 across', cols: [1, 1, 1, 1, 1], rows: [1], cells: slots(5) });
    registerLayout({ id: '5v', label: '5 stacked', cols: [1], rows: [1, 1, 1, 1, 1], cells: slots(5) });
    registerLayout({ id: '5s', label: 'Main above + 4 (wide)', cols: [1, 1, 1, 1], rows: [1.6, 1], areas: ['a a a a', 'b c d e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5s-l', label: 'Main left + 4', cols: [2, 1], rows: [1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    // 5 charts, 2+3 with the weights on each side.
    registerLayout({ id: '2-3-l', label: '2 above + 3 below (left wide)', cols: [1, 1, 1, 1, 1], rows: [1, 1.2], areas: ['a a a b b', 'c c d e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '2-3-r', label: '2 above + 3 below (right wide)', cols: [1, 1, 1, 1, 1], rows: [1, 1.2], areas: ['a a b b b', 'c c d e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    // 6 charts: 3×2, a row, a column, and the big-centre shape.
    registerLayout({ id: '6', label: '6 grid', cols: [1, 1, 1], rows: [1, 1], cells: slots(6) });
    registerLayout({ id: '6h', label: '6 across', cols: [1, 1, 1, 1, 1, 1], rows: [1], cells: slots(6) });
    registerLayout({ id: '6v', label: '6 stacked', cols: [1], rows: [1, 1, 1, 1, 1, 1], cells: slots(6) });
    // 7 charts: a row, and main + 6 in a column.
    registerLayout({ id: '7h', label: '7 across', cols: [1, 1, 1, 1, 1, 1, 1], rows: [1], cells: slots(7) });
    registerLayout({ id: '7s', label: 'Main left + 6', cols: [2, 1], rows: [1, 1, 1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e', 'a f', 'a g'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g']) });
    // 6/8-chart asymmetric splits.
    registerLayout({ id: '2-4', label: '2 above + 4 below', cols: [1, 1, 1, 1], rows: [1, 1.2], areas: ['a a b b', 'c d e f'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '4-2', label: '4 above + 2 below', cols: [1, 1, 1, 1], rows: [1.2, 1], areas: ['a b c d', 'e e f f'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '4-3', label: '4 above + 3 below', cols: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], rows: [1, 1], areas: ['a a a b b b c c c d d d', 'e e e e f f f f g g g g'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g']) });
    // 8 charts: a column, and the big-centre shape.
    registerLayout({ id: '8v', label: '8 stacked', cols: [1], rows: [1, 1, 1, 1, 1, 1, 1, 1], cells: slots(8) });
    registerLayout({ id: '8c', label: '8 around a centre', cols: [1, 1, 1, 1], rows: [1, 1, 1], areas: ['b c c d', 'e a a f', 'g a a h'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) });

    // ── the gallery's remaining shapes ───────────────────────────────────────────
    // Everything above is TradingView's named vocabulary. These are the OTHER shapes a
    // layout gallery shows — measured off a reference sheet of 44 glyphs, then deduped
    // against what was already here (16 were genuinely new). Proportions come from the
    // glyphs themselves, snapped to quarter-fr steps so the seams read evenly.
    //
    // The rule behind the ids: a shape whose partitions match an existing preset AT A
    // DIFFERENT proportion is its own preset (`4s` has a 2:1 main, `4s-eq` does not);
    // a shape already covered by the grid composer (uniform, ≤4×4) still registers —
    // ids are what share links and `setLayout` resolve against — but the picker keeps
    // it off the tile list, since the canvas draws it.

    // Four charts, four more readings of "one chart leads".
    registerLayout({ id: '4-2t2s', label: '2 tall + 2 stacked', cols: [1, 1, 1], rows: [1, 1], areas: ['a b c', 'a b d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '4-3w', label: '3 above + 1 wide below', cols: [1, 1, 1], rows: [1, 1], areas: ['a b c', 'd b c'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '4-1-2', label: 'Main above + 2 stacked', cols: [1, 1], rows: [2, 1, 1], areas: ['a b', 'c c', 'd d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '4s-eq', label: 'Main left + 3 (even)', cols: [1, 1], rows: [1, 1, 1], areas: ['a b', 'a c', 'a d'], cells: areaSlots(['a', 'b', 'c', 'd']) });
    registerLayout({ id: '4s-eq-r', label: 'Main right + 3 (even)', cols: [1, 1], rows: [1, 1, 1], areas: ['a b', 'c b', 'd b'], cells: areaSlots(['a', 'b', 'c', 'd']) });

    // Five charts: tall mains, centre-weighted bands, and the 5-column row.
    registerLayout({ id: '5-1-4', label: 'Main left + 4 stacked', cols: [1, 1.25, 1.75], rows: [1, 1, 1], areas: ['a b c', 'a b d', 'a b e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5-1-4-r', label: 'Main right + 4 stacked', cols: [1.75, 1.25, 1], rows: [1, 1, 1], areas: ['a b c', 'd b c', 'e b c'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5-2-3c', label: '2 above + 3 below (centre wide)', cols: [1.75, 1, 1, 2], rows: [1, 1], areas: ['a a b b', 'c d d e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5-3-2c', label: '3 above (centre wide) + 2 below', cols: [1.75, 1, 1, 2], rows: [1, 1], areas: ['a b b c', 'd d e e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5s-eq-r', label: 'Main right + 4 (even)', cols: [1, 1], rows: [1, 1, 1, 1], areas: ['a b', 'c b', 'd b', 'e b'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });
    registerLayout({ id: '5s-eq', label: 'Main left + 4 (even)', cols: [1, 1], rows: [1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e'], cells: areaSlots(['a', 'b', 'c', 'd', 'e']) });

    // Six and seven: the even 2×3 grid and the two mixed bands.
    registerLayout({ id: '6-2x3', label: '6 grid (2 across)', cols: [1, 1], rows: [1, 1, 1], cells: slots(6) });
    registerLayout({ id: '7-bands', label: '7 in two mixed bands', cols: [1.5, 1, 1.5, 1.5, 1, 2], rows: [1, 1], areas: ['a b b c c d', 'e e f f g g'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g']) });

    // Eight to twelve: the counts a wall display actually uses.
    registerLayout({ id: '8-2x4', label: '8 grid (2 across)', cols: [1, 1], rows: [1, 1, 1, 1], cells: slots(8) });
    registerLayout({ id: '9', label: '9 grid', cols: [1, 1, 1], rows: [1, 1, 1], cells: slots(9) });
    registerLayout({ id: '9-bands', label: '9 in two mixed bands', cols: [1.5, 1.75, 1, 1, 1.75, 1.5], rows: [1, 1], areas: ['a b c c d e', 'f g g h h i'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) });
    registerLayout({ id: '10', label: '10 grid', cols: [1, 1, 1, 1, 1], rows: [1, 1], cells: slots(10) });
    registerLayout({ id: '12', label: '12 grid', cols: [1, 1, 1, 1, 1, 1], rows: [1, 1], cells: slots(12) });
    registerLayout({ id: '12-3x4', label: '12 grid (3 across)', cols: [1, 1, 1], rows: [1, 1, 1, 1], cells: slots(12) });

    // ── round 23: the "one chart leads" family at EVERY size ─────────────────────
    // The gallery had 4s/5s/7s but no main-based shape for 2, 6, 8 or 9 charts, which is
    // exactly the range a working desk uses (one driver + a strip of context charts).
    // Every one of these carries explicit `areas` — that is not cosmetic: `layoutShape`
    // treats an area-free layout as canvas-expressible, and the picker would then hide
    // the tile and hand the user the UNWEIGHTED grid instead.
    registerLayout({ id: '2s', label: 'Main left + 1', cols: [2, 1], rows: [1], areas: ['a b'], cells: areaSlots(['a', 'b']) });
    registerLayout({ id: '2s-r', label: 'Main right + 1', cols: [1, 2], rows: [1], areas: ['a b'], cells: areaSlots(['a', 'b']) });
    registerLayout({ id: '3-c', label: '3 across (centre wide)', cols: [1, 1.6, 1], rows: [1], areas: ['a b c'], cells: areaSlots(['a', 'b', 'c']) });
    registerLayout({ id: '6-t2', label: 'Main above + 5', cols: [1, 1, 1, 1, 1], rows: [1.5, 1], areas: ['a a a a a', 'b c d e f'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '6-b2', label: '5 above + main below', cols: [1, 1, 1, 1, 1], rows: [1, 1.5], areas: ['a b c d e', 'f f f f f'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '6-l2', label: 'Main left + 5', cols: [2, 1], rows: [1, 1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e', 'a f'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '6-r2', label: 'Main right + 5', cols: [1, 2], rows: [1, 1, 1, 1, 1], areas: ['a b', 'c b', 'd b', 'e b', 'f b'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f']) });
    registerLayout({ id: '8-t2', label: 'Main above + 7', cols: [1, 1, 1, 1, 1, 1, 1], rows: [1.5, 1], areas: ['a a a a a a a', 'b c d e f g h'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) });
    registerLayout({ id: '8-main-l', label: 'Main left + 7', cols: [2, 1], rows: [1, 1, 1, 1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e', 'a f', 'a g', 'a h'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) });
    registerLayout({ id: '8-main-r', label: 'Main right + 7', cols: [1, 2], rows: [1, 1, 1, 1, 1, 1, 1], areas: ['a b', 'c b', 'd b', 'e b', 'f b', 'g b', 'h b'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) });
    registerLayout({ id: '9-main-l', label: 'Main left + 8', cols: [2, 1], rows: [1, 1, 1, 1, 1, 1, 1, 1], areas: ['a b', 'a c', 'a d', 'a e', 'a f', 'a g', 'a h', 'a i'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) });
    // Dense walls: portrait (2×6) and the 15-up. Both are past the 4×4 canvas, so they
    // need a tile; neither is an alias of an existing grid.
    registerLayout({ id: '12-2x6', label: '12 grid (2 across, tall)', cols: [1, 1], rows: [1, 1, 1, 1, 1, 1], cells: slots(12) });
    registerLayout({ id: '15', label: '15 grid', cols: [1, 1, 1, 1, 1], rows: [1, 1, 1], cells: slots(15) });
    // A two-band wall with the top band leading — the row-weighted counterpart of 8-2x4.
    registerLayout({ id: '8-2x4w', label: '8 grid (top band wide)', cols: [1, 1, 1, 1], rows: [1.5, 1], areas: ['a b c d', 'e f g h'], cells: areaSlots(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) });
}

// ── dynamic layouts (the topbar's grid picker) ──────────────────────────────
//
// The picker composes UNIFORM rows×cols grids on a bounded canvas instead of choosing
// from a fixed list. Dynamic definitions are NOT registered — their ids are
// self-describing (`g3x2`) and `ensureLayout` re-synthesizes them, so persisted picks
// restore across boots without polluting the plugin registry.

/** Picker canvas bound — dynamic layouts stay within a 4×4 grid (16 cells, the
 *  workspace's dormant-state pool capacity). */
export const GRID_PICKER_MAX = 4;

/** Classic preset ids by uniform geometry, so grid picks land on the builtins. */
const GRID_BUILTIN_IDS: Record<string, string> = {
    '1x1': '1',
    '1x2': '2h',
    '2x1': '2v',
    '2x2': '4',
    '2x4': '8',
    '4x4': '16', // the new ceiling: the canvas square and the preset row are one layout
};

const clampTrack = (n: number): number => Math.max(1, Math.min(GRID_PICKER_MAX, Math.round(n)));

/**
 * The layout for a UNIFORM rows×cols grid (Grid picker mode), clamped to the
 * picker canvas. Geometry matching a registered classic preset returns that preset
 * (id `'4'`, `'2h'`, …); anything else synthesizes a `g<rows>x<cols>` definition.
 */
export function layoutForGrid(rows: number, cols: number): LayoutDefinition {
    // The presets are registered by the workspace's constructor; a picker that resolves a
    // square before any workspace booted still has to land on the SAME id (otherwise the
    // canvas square and the preset row disagree about a 4×4). Idempotent — a Map.set.
    registerBuiltinLayouts();
    const r = clampTrack(rows);
    const c = clampTrack(cols);
    const builtin = GRID_BUILTIN_IDS[`${r}x${c}`];
    const registered = builtin ? registry.get(builtin) : undefined;
    if (registered) return registered;
    return {
        id: `g${r}x${c}`,
        // Width-first label — matches the picker's caption ("3 × 2" = 3 wide, 2 tall).
        label: `${c} × ${r} grid`,
        cols: Array.from({ length: c }, () => 1),
        rows: Array.from({ length: r }, () => 1),
        cells: slots(r * c),
    };
}

const GRID_ID_RE = /^g([1-4])x([1-4])$/;

/**
 * Resolve a layout id to its definition, synthesizing the picker's dynamic ids
 * (`g<rows>x<cols>`) when they are not registered — the boot path for persisted
 * picks. Unknown ids stay undefined.
 */
export function ensureLayout(id: string): LayoutDefinition | undefined {
    const registered = registry.get(id);
    if (registered) return registered;
    const g = GRID_ID_RE.exec(id);
    if (g) return layoutForGrid(Number(g[1]), Number(g[2]));
    return undefined;
}

/** A layout's shape on the picker canvas. */
export type LayoutShape = { rows: number; cols: number };

/**
 * The picker-canvas shape of a layout: `{rows, cols}` for uniform grids, `null`
 * when the layout is not expressible on the canvas (bespoke plugin presets) —
 * pickers list those as labeled rows instead.
 */
export function layoutShape(def: LayoutDefinition): LayoutShape | null {
    if (
        !def.areas &&
        def.rows.length <= GRID_PICKER_MAX &&
        def.cols.length <= GRID_PICKER_MAX &&
        def.cells.length === def.rows.length * def.cols.length
    ) {
        return { rows: def.rows.length, cols: def.cols.length };
    }
    return null;
}

/**
 * Which slot occupies each `[row][col]` track — PURE. Area layouts read their
 * `grid-template-areas` rows; auto-flow layouts place `cells` row-major. The grid is
 * what the splitter layer segments its strips against: a boundary is only a real seam
 * where the two neighboring tracks hold DIFFERENT slots.
 */
export function occupancyGrid(def: LayoutDefinition): string[][] {
    if (def.areas) return def.areas.map((row) => row.trim().split(/\s+/));
    const cols = def.cols.length;
    return def.rows.map((_, r) => def.cols.map((_, c) => def.cells[r * cols + c]?.id ?? `·${r}x${c}`));
}

/** The glyph's frame: a 13px square inset 1.5px in the 16px box. */
const GLYPH_MIN = 1.5;
const GLYPH_SPAN = 13;

/** Track boundaries on the glyph frame, proportional to the declared weights. */
function glyphStops(weights: readonly number[], n: number): number[] {
    const w = Array.from({ length: n }, (_, i) => {
        const v = weights[i];
        return v !== undefined && Number.isFinite(v) && v > 0 ? v : 1;
    });
    const total = w.reduce((a, b) => a + b, 0);
    const stops = [GLYPH_MIN];
    let acc = 0;
    for (const v of w) {
        acc += v;
        stops.push(Math.round((GLYPH_MIN + (GLYPH_SPAN * acc) / total) * 100) / 100);
    }
    return stops;
}

/**
 * A 16px line glyph of a layout's cell arrangement (`<svg>` markup) — PURE. The frame
 * is the whole grid; a seam is drawn only where two neighboring tracks hold DIFFERENT
 * slots (the {@link occupancyGrid} rule the splitters follow), so a cell spanning
 * several tracks reads as one. Seams sit at the declared track weights.
 */
export function layoutGlyph(def: LayoutDefinition): string {
    const grid = occupancyGrid(def);
    const rows = grid.length;
    const cols = grid.reduce((n, row) => Math.max(n, row.length), 0);
    const xs = glyphStops(def.cols, cols);
    const ys = glyphStops(def.rows, rows);
    const at = (r: number, c: number): string | undefined => grid[r]?.[c];
    const seams: string[] = [];
    for (let c = 1; c < cols; c += 1) {
        let start = -1;
        for (let r = 0; r <= rows; r += 1) {
            const split = r < rows && at(r, c - 1) !== at(r, c);
            if (split && start < 0) start = r;
            if (!split && start >= 0) {
                seams.push(`M${xs[c]} ${ys[start]}V${ys[r]}`);
                start = -1;
            }
        }
    }
    for (let r = 1; r < rows; r += 1) {
        let start = -1;
        for (let c = 0; c <= cols; c += 1) {
            const split = c < cols && at(r - 1, c) !== at(r, c);
            if (split && start < 0) start = c;
            if (!split && start >= 0) {
                seams.push(`M${xs[start]} ${ys[r]}H${xs[c]}`);
                start = -1;
            }
        }
    }
    // MINIMAL: the frame keeps the kit's icon language (16px box, 1.2 stroke, no fill)
    // but drops to 45% ink, so the SEAMS carry the weight — the glyph then reads as "this
    // is how the page is cut" rather than as a picture of a grid.
    const frame = `<rect x="${GLYPH_MIN}" y="${GLYPH_MIN}" width="${GLYPH_SPAN}" height="${GLYPH_SPAN}" rx="2" opacity="0.45"/>`;
    return svg16(seams.length > 0 ? `${frame}<path d="${seams.join('')}"/>` : frame);
}

/** Inline styles for the grid container + each cell — PURE (the workspace applies them). */
export function gridStyles(
    def: LayoutDefinition,
    trackSizes?: TrackSizes,
): { container: Record<string, string>; perCell: Record<string, Record<string, string>> } {
    const cols = trackSizes?.cols?.length === def.cols.length ? trackSizes.cols : def.cols;
    const rows = trackSizes?.rows?.length === def.rows.length ? trackSizes.rows : def.rows;
    const container: Record<string, string> = {
        display: 'grid',
        gridTemplateColumns: cols.map((w) => `${w}fr`).join(' '),
        gridTemplateRows: rows.map((w) => `${w}fr`).join(' '),
    };
    if (def.areas) container.gridTemplateAreas = def.areas.map((r) => `"${r}"`).join(' ');
    const perCell: Record<string, Record<string, string>> = {};
    for (const cell of def.cells) {
        perCell[cell.id] = cell.area ? { gridArea: cell.area } : {};
    }
    return { container, perCell };
}

/**
 * The active cell after a layout change: keep it when its slot survives, else fall
 * back to the first slot (the reducer behind `setLayout`; pure for tests).
 */
export function activeAfterLayout(current: string | null, cellIds: readonly string[]): string | null {
    if (current != null && cellIds.includes(current)) return current;
    return cellIds[0] ?? null;
}

/**
 * The identity order after a layout change: shrinking the grid must never pool the
 * ACTIVE chart, so an active identity that would fall past the new slot count moves
 * into the LAST surviving slot — every other identity keeps its relative order
 * (the order reducer behind `setLayout`; pure for tests).
 */
export function orderAfterLayout(order: readonly string[], slots: number, active: string | null): string[] {
    const next = [...order];
    if (active == null || slots <= 0) return next;
    const idx = next.indexOf(active);
    if (idx < 0 || idx < slots) return next;
    next.splice(idx, 1);
    next.splice(slots - 1, 0, active);
    return next;
}
