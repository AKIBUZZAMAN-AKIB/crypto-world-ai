// Object tree — a docked side panel listing everything on the chart, grouped by pane. Each
// pane block names itself and carries its ops (move, collapse, maximize); inside it sits the
// pane's whole stack — its drawings, its indicators and, in the main pane, the candles — as
// ONE column ordered front-first, so the list reads top-to-bottom as "what draws in front of
// what". On a renderer whose drawings share the series' draw-order space, a drawing takes a
// slot anywhere in that column: over everything, under the candles, between two indicators.
// Rows carry eye / lock / remove actions.
//
// The layout itself lives in `object-tree-model.ts` — this file pulls a snapshot off the
// chart, hands it over, and paints the result. Kept in sync via the chart's event bus, and
// rebound to each new chart instance after a widget rebuild.
import type { Vela } from '../Vela';
import type { DataWindowRow } from '../core/ports/IChartRenderer';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import type { SerializedDrawing } from '../core/drawings/Drawing';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Dialog } from '../ui/components/dialog';
import { tickerIconEl } from './symbol-icon';
import { parseSymbol } from '../data/ProviderRegistry';
import {
    assignToGroup,
    buildTree,
    canGroup,
    groupById,
    groupDrawingIds,
    groupWithin,
    liftGroup,
    setGroupParent,
    drawingLabel,
    drawingMeta,
    groupOf,
    groupState,
    groupTokenIndex,
    nextGroupName,
    paneRows,
    paneTokens,
    placeTokens,
    pruneGroups,
    removeFromGroups,
    reorderTokens,
    stackWrites,
    tokenIndexOfSlot,
    tokensEqual,
    treeIsEmpty,
    PRICE_PANE_ID,
    type DrawGroup,
    type DrawUnit,
    type IndicatorRow,
    type StackToken,
    type TreePane,
    type TreeRow,
    type TreeSnapshot,
    type VisualOrderMove,
} from './object-tree-model';
import { SidePanel } from './side-panel';

const STYLE_ID = 'vela-widget-objtree';
const CSS = `
/* One pane's block. The transparent border reserves the drop-target outline. */
.vela-ot-pane {
    border: 1px solid transparent;
    border-radius: 6px;
    margin: 2px 0;
}
.vela-ot-panehead { display: flex; align-items: center; gap: 2px; padding: 5px 6px; }
.vela-ot-panename {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.vela-ot-panesep { height: 1px; background: var(--vela-border); margin: 6px 8px; }

.vela-ot-row {
    display: flex;
    align-items: center;
    gap: 9px;
    /* 24px targets + 4px breathing = the same 32px row desktop always had. */
    padding: 4px 6px;
    min-height: 32px;
    border-radius: 6px;
    cursor: default;
}
.vela-ot-row:hover { background: var(--vela-hover); }
.vela-ot-row > .vela-icon { color: var(--vela-fg-muted); width: 14px; height: 14px; font-size: 14px; justify-content: center; flex: none; }
/* Drawing glyphs come from the type registry at toolbar scale — bring them down to row size. */
.vela-ot-row > .vela-icon svg { width: 14px; height: 14px; }
.vela-ot-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ot-row[data-hidden] .vela-ot-name,
.vela-ot-row[data-hidden] > .vela-icon { opacity: 0.45; }
/* Two different states, and both can be true at once: "picked" is what the panel has selected
   (the group/duplicate candidates), "selected" mirrors what the CHART has selected. */
.vela-ot-row[data-picked] {
    background: var(--vela-active);
    /* A picked row wears the accent as an inset edge, so a multi-pick reads at a glance
       even where the active background is nearly the panel's own colour. */
    box-shadow: inset 2px 0 0 var(--vela-accent);
}
.vela-ot-row[data-picked] .vela-ot-name { color: var(--vela-fg-bright); }
.vela-ot-row[data-selected] { box-shadow: inset 2px 0 0 var(--vela-accent); }
.vela-ot-avatar {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: 10px;
    font-weight: 700;
}
/* "scale": this indicator draws against its own price scale, not the pane's. */
.vela-ot-tag {
    flex: none;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vela-fg-muted);
    background: var(--vela-hover);
    border-radius: 3px;
    padding: 1px 4px;
}
/* One row's actions, kept in a tight cluster: they read as one control group, and the row's
   own wider gap stays between the label and them. */
.vela-ot-acts { display: flex; align-items: center; gap: 0; flex: none; }
.vela-ot-btn {
    all: unset;
    cursor: pointer;
    flex: none;
    /* 24px is the WCAG 2.5.8 floor. The glyph stays 12px, so the box grows under the pointer
       without the row reading any heavier; the 2px gap keeps neighbouring targets apart. */
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 12px;
    visibility: hidden;
}
.vela-ot-row:hover .vela-ot-btn,
.vela-ot-panehead:hover .vela-ot-btn { visibility: visible; }
/* An engaged action stays out: hidden and locked are states, and a state the user can only
   see by hovering is a state they will not find. */
.vela-ot-row .vela-ot-btn[data-engaged] { visibility: visible; color: var(--vela-fg); }
.vela-ot-btn:hover:not(:disabled) { background: var(--vela-active); color: var(--vela-fg-bright); }
/* The last plot value of an indicator row — the legend's readout, which a phone never sees
   (the grid folds every legend row away). Tabular figures so the column does not jitter. */
.vela-ot-fold {
    all: unset;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-right: -2px;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-ot-fold:hover { color: var(--vela-fg); background: var(--vela-hover); }
.vela-ot-fold[data-open='1'] { color: var(--vela-fg); }
/* The opened values block: the data window's rows, under the study that produced them. */
.vela-ot-values {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 8px 6px 34px;
}
.vela-ot-vrow {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    margin: 0 -4px;
    padding: 0 4px;
    font-size: 11.5px;
    line-height: 1.5;
    border-radius: 4px;
}
/* Desktop affordance only: a line lights up under the pointer. Never on touch, where a
   hover state sticks to the last-tapped line. */
@media (hover: hover) {
    .vela-ot-vrow:hover { background: var(--vela-hover); }
}
.vela-ot-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--vela-fg-muted); }
.vela-ot-vlabel {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-muted);
}
.vela-ot-vrow .vela-ot-val { max-width: none; color: var(--vela-fg); }
.vela-ot-val {
    flex: none;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--vela-fg-muted);
    text-align: right;
}
/* Touch: a hover-revealed button does not exist. Every row action stays visible, and the row
   grows to a 44px target (WCAG 2.5.5) instead of the 32px pointer row. This is the surface a
   phone uses INSTEAD of the legend, so it has to carry the legend's verbs. */
@media (pointer: coarse) {
    .vela-ot .vela-panel-body { padding: 10px 8px calc(10px + env(safe-area-inset-bottom, 0px)); }
    .vela-ot-row { min-height: 44px; gap: 10px; padding: 0 8px; }
    .vela-ot-row .vela-ot-btn { visibility: visible; width: 32px; height: 32px; border-radius: 8px; font-size: 15px; }
    .vela-ot-row .vela-ot-btn[data-icon='more'] { color: var(--vela-fg); }
    .vela-ot-btn + .vela-ot-btn { margin-left: 2px; }
    .vela-ot-val { max-width: 118px; font-size: 12.5px; }
    .vela-ot-panehead { min-height: 34px; }
    .vela-ot-panehead .vela-ot-btn { visibility: visible; width: 32px; height: 32px; }
}

.vela-ot-btn:disabled { opacity: 0.35; cursor: default; }
.vela-ot-empty { padding: 20px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; }

/* ── drawing groups ── */
/* One top-level entry in a pane's drawing list: a lone drawing, or a whole group block. No
   border of its own — units stack flush, so consecutive highlighted rows read as one block; the
   drop-into-group outline is drawn inside the box instead (see the drag-and-drop rules). */
.vela-ot-unit { border-radius: 6px; }
/* Adjacent picked rows merge into one contiguous highlight: the shared edge loses its rounding. */
.vela-ot-unit:has(> .vela-ot-row[data-picked]) + .vela-ot-unit > .vela-ot-row[data-picked] { border-top-left-radius: 0; border-top-right-radius: 0; }
.vela-ot-unit:has(+ .vela-ot-unit > .vela-ot-row[data-picked]) > .vela-ot-row[data-picked] { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.vela-ot-row[data-row-kind='group'] > .vela-icon { width: 12px; font-size: 11px; }
/* A member sits indented under its group's header. Nested groups indent one more step per
   level (capped, so a deep tree still keeps its labels readable on a phone). */
.vela-ot-subrow { padding-left: 26px; }
/* A nested GROUP header indents exactly like the members it sits among. */
.vela-ot-row[data-depth='1'] { padding-left: 26px; }
.vela-ot-row[data-depth='2'] { padding-left: 40px; }
.vela-ot-row[data-depth='3'] { padding-left: 54px; }
.vela-ot-row[data-depth='4'], .vela-ot-row[data-depth='5'], .vela-ot-row[data-depth='6'] { padding-left: 62px; }
/* The touch drag handle: only where there is no pointer to drag with. */
.vela-ot-grip { display: none; }
@media (pointer: coarse) {
    .vela-ot-grip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 18px;
        height: 32px;
        margin: 0 2px 0 -4px;
        color: var(--vela-fg-muted);
        touch-action: none;
        cursor: grab;
    }
    .vela-ot-grip .vela-icon { font-size: 13px; }
    /* A nested row keeps its indent with the grip in place. */
    .vela-ot-row[data-depth='1'] { padding-left: 22px; }
    .vela-ot-row[data-depth='2'] { padding-left: 34px; }
    .vela-ot-row[data-depth='3'] { padding-left: 46px; }
}
.vela-ot-rename {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--vela-accent);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    color: var(--vela-fg-bright);
    font: inherit;
}
/* The selection bar. Always there — the actions it holds are the panel's, not a row's, so they
   stay in place and simply go dim until a drawing is selected. It stays put at the top of the
   list while the list scrolls under it, so they never scroll out of reach. */
.vela-ot-selbar {
    position: sticky;
    bottom: -8px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 6px -8px -8px;
    padding: 6px 8px;
    border-top: 1px solid var(--vela-border);
    background: var(--vela-bg);
}
.vela-ot-selbar[hidden] { display: none; }
.vela-ot-selcount { flex: 1; min-width: 0; color: var(--vela-fg-muted); font-size: 11px; }
.vela-ot-selbar {
    box-shadow: 0 -10px 18px -14px #000;
}
.vela-ot-selbar .vela-ot-btn { visibility: visible; width: 26px; height: 26px; color: var(--vela-fg); }
.vela-ot-selbar .vela-ot-btn .vela-icon { font-size: 14px; }
.vela-ot-selbar .vela-ot-btn:hover:not(:disabled) { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-ot-selbar .vela-ot-btn[data-icon='close'] { color: var(--vela-fg-muted); }
.vela-ot-selbar .vela-ot-btn[data-icon='group'] .vela-icon { width: 16px; height: 16px; font-size: 16px; }

/* The header door to the layout-wide drawing manager. */
.vela-ot-headerbtn {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-ot-headerbtn:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-ot-headerbtn .vela-icon { font-size: 14px; }
@media (pointer: coarse) { .vela-ot-headerbtn { width: 34px; height: 34px; } }

/* Manage layout drawings: chart sections, one row per drawing. */
.vela-ot-lg { display: flex; flex-direction: column; gap: 2px; min-width: min(420px, 82vw); }
.vela-ot-lg-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 10px 0 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vela-border);
}
.vela-ot-lg-head:first-child { margin-top: 0; }
.vela-ot-lg-name { flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vela-fg-muted); }
.vela-ot-lg-count { font-size: 11px; color: var(--vela-fg-muted); }
.vela-ot-lg-row { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 2px; border-radius: 6px; }
.vela-ot-lg-row:hover { background: var(--vela-hover); }
.vela-ot-lg-row > .vela-icon { width: 14px; height: 14px; font-size: 14px; color: var(--vela-fg-muted); justify-content: center; flex: none; }
.vela-ot-lg-row > .vela-icon svg { width: 14px; height: 14px; }
.vela-ot-lg-row[data-hidden] .vela-ot-lg-label { opacity: 0.5; }
.vela-ot-lg-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.vela-ot-lg-btn { visibility: visible; }
.vela-ot-lg-empty, .vela-ot-lg-none { padding: 6px 2px 10px; color: var(--vela-fg-muted); font-size: 12px; }
.vela-ot-lg-none { padding: 18px 2px; text-align: center; }
/* Manage objects: default scope, per-object scope, specific chart targets. */
.vela-ot-mo { display: flex; flex-direction: column; gap: 8px; min-width: min(460px, 86vw); max-height: min(66vh, 560px); overflow: auto; }
.vela-ot-mo-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vela-fg-muted); margin-top: 4px; }
.vela-ot-mo-segment { display: flex; flex-wrap: wrap; gap: 6px; }
.vela-ot-mo-segment button { all: unset; box-sizing: border-box; min-height: 30px; padding: 0 10px; border: 1px solid var(--vela-border); border-radius: 999px; color: var(--vela-fg); font: inherit; font-size: 12px; cursor: pointer; }
.vela-ot-mo-segment button[data-on='1'] { border-color: var(--vela-accent); color: var(--vela-accent); background: color-mix(in srgb, var(--vela-accent) 10%, transparent); }
.vela-ot-mo-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(118px, max-content); align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px solid var(--vela-border); }
.vela-ot-mo-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.vela-ot-mo-row select { width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--vela-border-strong); border-radius: var(--vela-radius-sm); background: var(--vela-surface); color: var(--vela-fg-bright); font: inherit; font-size: 12px; }
.vela-ot-mo-targets { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 4px 0 2px 2px; }
.vela-ot-mo-targets label { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--vela-fg-muted); }
.vela-ot-mo-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; position: sticky; bottom: -8px; background: var(--vela-surface-overlay); }
.vela-ot-mo-actions button { all: unset; box-sizing: border-box; min-height: 34px; padding: 0 14px; border: 1px solid var(--vela-border); border-radius: 999px; color: var(--vela-fg); font: inherit; font-weight: 600; cursor: pointer; }
.vela-ot-mo-actions button[data-primary='1'] { border-color: var(--vela-accent); color: var(--vela-accent); }
.vela-ot-mo-empty { padding: 18px 2px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; }
.vela-ot-headerbtn:disabled { opacity: 0.38; cursor: default; }

/* Drawing-set template name dialog */
.vela-ot-setform { display: flex; flex-direction: column; gap: 12px; min-width: 260px; }
.vela-ot-setform label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--vela-fg-muted); }
.vela-ot-setform input { height: 36px; padding: 0 10px; border: 1px solid var(--vela-border-strong); border-radius: var(--vela-radius-sm); background: var(--vela-surface); color: var(--vela-fg-bright); font: inherit; }
.vela-ot-setrow { display: flex; justify-content: flex-end; gap: 8px; }
.vela-ot-setrow button { all: unset; box-sizing: border-box; min-height: 36px; padding: 0 14px; border: 1px solid var(--vela-border); border-radius: 999px; color: var(--vela-fg); font: inherit; font-weight: 600; cursor: pointer; }
.vela-ot-setrow button[data-primary='1'] { border-color: var(--vela-accent); color: var(--vela-accent); }

/* ── drag-and-drop ── */
.vela-ot-row[data-drag] { cursor: grab; }
.vela-ot .vela-panel-body[data-dragging] .vela-ot-row[data-drag] { cursor: grabbing; }
/* The row in flight fades: the ghost under the pointer is the thing being moved. */
.vela-ot-row[data-source] { opacity: 0.4; }
/* Buttons would only invite a click that a drag is about to swallow. */
.vela-ot .vela-panel-body[data-dragging] .vela-ot-btn { visibility: hidden; }

/* The band between two pane blocks: a hairline at rest, a bright bar when dropping there
   would open a new pane. Doubles as the plain separator when dragging isn't available. */
.vela-ot-gap { position: relative; height: 11px; border-radius: 3px; margin: 0 8px; }
.vela-ot-gap::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--vela-border);
    transform: translateY(-50%);
}
.vela-ot-gap[data-drop] { height: 4px; background: var(--vela-fg-bright); }
.vela-ot-gap[data-drop]::before { display: none; }
/* A whole container accepts the drop: merging into a pane, or a pane with no drawings yet.
   The pane block's transparent border reserves the room for this outline; a group unit has no
   border to color, so it draws the same line as an inset outline (no layout footprint). */
.vela-ot [data-drop='target'] { border-color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-ot-unit[data-drop='target'] { outline: 1px solid var(--vela-fg-bright); outline-offset: -1px; }
/* Nesting: a group dropped on another group's header joins it as a child. */
.vela-ot [data-drop='nest'] { outline: 2px solid var(--vela-accent); outline-offset: -2px; background: var(--vela-hover); }
/* Where a reorder would insert. */
.vela-ot [data-drop='before'] { box-shadow: inset 0 2px 0 var(--vela-fg-bright); }
.vela-ot [data-drop='after'] { box-shadow: inset 0 -2px 0 var(--vela-fg-bright); }

.vela-ot-ghost {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    max-width: 220px;
    padding: 3px 10px;
    border: 1px solid var(--vela-fg-bright);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-overlay);
    color: var(--vela-fg);
    box-shadow: var(--vela-shadow);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;

const REFRESH_EVENTS = [
    'indicator:added',
    'indicator:removed',
    'indicator:moved',
    'indicator:visibility',
    'pane:changed',
    'drawing:created',
    'drawing:edited',
    'drawing:removed',
    // A pair switch swaps the whole drawing/indicator set (global drawings scope,
    // a restored layout, or a fresh load). Without these two the tree kept the
    // OLD symbol's rows until the user clicked something — the measured bug.
    'market:changed',
    'load:end',
    'drawing:hidden-all',
] as const;

/** How far a press has to travel before it counts as a drag rather than a click. */
const DRAG_SLOP = 4;

/** What is being dragged. Mirrors a row's `data-row-kind`. */
type DragKind = 'price' | 'indicator' | 'drawing' | 'group';

/** What dropping at the current pointer would do, resolved from the rendered geometry. */
type Drop =
    /** Open a fresh pane in the band between two blocks. */
    | { kind: 'newPane'; before: string | undefined; after: string | undefined; el: HTMLElement }
    /** Join an existing pane, leaving its internal order alone. */
    | { kind: 'merge'; paneId: string; el: HTMLElement }
    /** Take a slot in a pane's stack — the ONE front-first column of drawings, indicators and
     *  (on the main pane) the candles. For a drawing, a different pane also re-panes it. */
    | { kind: 'slot'; paneId: string; slot: number; els: HTMLElement[]; el: HTMLElement }
    /** Join a group, at a position among its members. `at` is a TOKEN index in the pane's
     *  stack, measured from the rendered rows, so it stays correct with nested groups. */
    | { kind: 'intoGroup'; paneId: string; groupId: string; at: number; y: number; rows: HTMLElement[]; el: HTMLElement }
    /** Drop a whole group ON another group's header: nest it inside (TradingView's gesture). */
    | { kind: 'nest'; paneId: string; groupId: string; el: HTMLElement };

/** A press on a draggable row, live until the pointer is released. */
interface DragSession {
    kind: DragKind;
    /** The dragged object's id — null for the candles, which have none. */
    id: string | null;
    fromPane: string;
    label: string;
    startX: number;
    startY: number;
    /** False until the pointer clears `DRAG_SLOP`; a press that never does stays a click. */
    active: boolean;
    /** Touch only: a finger may not drag until the hold arms it (or it starts on a grip), so a
     *  swipe still scrolls the list. A mouse drags straight away. */
    armed: boolean;
    pointerId: number;
    ghost: HTMLElement | null;
    drop: Drop | null;
    onMove: (e: PointerEvent) => void;
    onUp: () => void;
    /** The pointer was taken away from us (a touch turning into a gesture, a lost capture) —
     *  there is no drop position to trust, so the session is abandoned. */
    onCancel: () => void;
}

/** Insertion index in a vertical stack: the first element whose midpoint is below `y`. */
function insertionSlot(els: readonly HTMLElement[], y: number): number {
    for (let i = 0; i < els.length; i += 1) {
        const r = els[i]!.getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
    }
    return els.length;
}

/** One action button on a row or pane head. */
interface RowAction {
    icon: string;
    title: string;
    /** The state this action would undo is currently on — the row is hidden, or locked. Actions
     *  otherwise appear on hover, which would leave that state invisible at rest, so an engaged
     *  one stays out and reads as a badge. */
    engaged?: boolean;
    /** Offered but not available — shown dimmed, with `title` explaining why. */
    disabled?: boolean;
    run: () => void;
}

/** What a single render pass needs: the chart plus the lookups it would otherwise redo per row. */
interface Pass {
    chart: Vela;
    handle: (id: string) => IndicatorHandle | undefined;
    /** Whether the main pane's stacking can be reordered on this renderer. */
    stackable: boolean;
    /** Whether indicators can move between panes on this renderer. */
    repanable: boolean;
    /** Whether drawings share the series' draw-order space — a drawing can then take any slot
     *  in its pane's stack, under the candles or between two indicators. */
    interleave: boolean;
    panes: TreePane[];
}

/**
 * Assembles menu descriptors together with the callbacks their ids fire. The kit menu reports
 * a selected id and the tree's entries are per-object, so the mapping is built fresh on each
 * right-click. Ids are unique across nesting levels, since a submenu leaf reports to the root.
 */
class MenuBuilder {
    readonly actions = new Map<string, () => void>();
    private seq = 0;

    entry(label: string, icon: string | undefined, run: () => void, separatorBefore = false): MenuItemDescriptor {
        const id = this.next();
        this.actions.set(id, run);
        return { id, label, icon, separatorBefore };
    }

    submenu(label: string, icon: string | undefined, submenu: readonly MenuItemDescriptor[], separatorBefore = false): MenuItemDescriptor {
        return { id: this.next(), label, icon, submenu, separatorBefore };
    }

    private next(): string {
        this.seq += 1;
        return `ot${this.seq}`;
    }
}

export class ObjectTree extends SidePanel {
    private chart: Vela | null = null;
    /** What the CHART has selected — every member of a multi-selection, mirrored as rows. */
    private selectedDrawings = new Set<string>();
    private symbolName = '';
    /** The raw (possibly venue-prefixed) symbol — what icon resolution routes on. */
    private symbolRaw = '';
    /** Drawing bundles — a view-side grouping, held for the panel's lifetime and never persisted.
     *  Kept per chart because a workspace points this one panel at whichever chart is active, and
     *  each chart's bundles have to survive the switch. */
    private readonly groupsPerChart = new WeakMap<Vela, DrawGroup[]>();
    /** Group ids currently folded shut. Ids are never reused, so entries left behind by a group
     *  that is gone are inert and can outlive it. */
    private collapsed = new Set<string>();
    /** Drawings picked IN THE PANEL — what the selection bar and "group selection" act on. */
    private picked = new Set<string>();
    /** The INDICATOR half of the pick. `picked` holds drawings (it is what the chart
     *  mirrors); the two together are what the bulk bar acts on — TradingView's object
     *  tree selects studies and drawings alike. */
    private selInd = new Set<string>();
    /** True while the pick is a MULTI-pick (modifier, Shift range, Ctrl+A, long-press):
     *  that is when the floating action bar appears. A plain click just picks one row. */
    private bulk = false;
    /** Where a Shift-click range starts — the last row picked without a modifier. */
    private selAnchor: string | null = null;
    /** Every selectable row in paint order; ranges and "select all" resolve against it. */
    private rowOrder: Array<{ id: string; kind: string }> = [];
    /** A pointer that hovers (a mouse) picks on a plain click; a finger long-presses. */
    private hoverCapable = true;
    /** Long-press: a finger held still on a row starts a multi-pick, like a phone list. */
    private pressTimer: number | null = null;
    /** The document-level Delete/Esc listener (see the constructor). */
    private onDocKey: ((e: KeyboardEvent) => void) | null = null;
    /** A long-press is followed by a synthesised click; that one must not undo the pick. */
    private suppressClickUntil = 0;
    /** A finger double-tap must NOT read as a desktop double-click (which opens settings):
     *  on a phone the second tap is usually just the end of a long-press or a mis-tap. */
    private lastPointerWasTouch = false;
    /** The group showing its rename field, if any. */
    private renaming: string | null = null;
    /** Set while the panel pushes its pick to the chart, so the `drawing:selected` that comes
     *  back is recognised as our own echo instead of a fresh chart-side selection. */
    private syncingSelection = false;
    /** Suppress event-driven repaints while a multi-write restack is in flight: every
     *  `drawing:edited` would otherwise rebuild the tree against a half-written stack. */
    private restacking = false;
    private groupSeq = 0;
    private unsubs: Array<() => void> = [];

    private get groups(): DrawGroup[] {
        return (this.chart === null ? undefined : this.groupsPerChart.get(this.chart)) ?? [];
    }

    private set groups(next: DrawGroup[]) {
        if (!this.chart) return;
        const before = this.groupsPerChart.get(this.chart) ?? [];
        this.groupsPerChart.set(this.chart, next);
        // Pruning runs on every render; only a REAL membership/name/parent edit is a
        // user change. JSON is fine here — groups are tiny plain records.
        if (JSON.stringify(before) !== JSON.stringify(next) && !this.restoringGroups) this.opts.onGroupsChanged?.();
    }

    /** State/history snapshot of one chart's folders, including nested groups. */
    groupsFor(chart: Vela): DrawGroup[] {
        return (this.groupsPerChart.get(chart) ?? []).map((g) => ({ ...g, ids: [...g.ids] }));
    }

    /** Restore a folder snapshot without treating it as a fresh user edit. */
    setGroupsFor(chart: Vela, groups: readonly DrawGroup[]): void {
        this.restoringGroups = true;
        try {
            this.groupsPerChart.set(
                chart,
                groups.map((g) => ({ ...g, ids: [...g.ids] })),
            );
            for (const g of groups) {
                const n = /^grp-(\d+)$/.exec(g.id);
                if (n) this.groupSeq = Math.max(this.groupSeq, Number(n[1]));
            }
            if (this.chart === chart) this.render();
        } finally {
            this.restoringGroups = false;
        }
    }

    /** Guards group hydration from emitting a state-changed notification. */
    private restoringGroups = false;
    /** The last render's model, kept so a right-click reads the same state the rows show. */
    private pass: Pass | null = null;
    /** Live value spans by indicator id, plus the frame that will refresh them. */
    private readonly valueSpans = new Map<string, HTMLElement>();
    /**
     * Indicator rows showing their WHOLE readout: the data window's rows for that study,
     * one line per plot. A phone never shows the legend, so this is where a trader reads
     * every value of a study without opening its settings.
     */
    private readonly openValues = new Set<string>();
    /** Value spans inside an opened row, in readout-row order. */
    private readonly blockSpans = new Map<string, HTMLElement[]>();
    private valueFrame = 0;
    private menu: Menu | null = null;
    private menuActions = new Map<string, () => void>();
    private drag: DragSession | null = null;
    /** Groups the user has picked (a long-press/Ctrl-click on a group header) — a pick of
     *  groups is how a nested group is made without typing. */
    private groupPicks = new Set<string>();
    /** The tail of the live touch gesture that keeps a held row draggable: while it is set,
     *  `touchmove` is prevented so the list cannot start scrolling under the finger. */
    private touchBlock: ((e: TouchEvent) => void) | null = null;
    /** The layout-wide drawing manager, built on first use. */
    private layoutDrawingsDialog: Dialog | null = null;
    /** The one-line "Save drawing template as…" dialog, and the pick it will save. */
    private setNameDialog: Dialog | null = null;
    private setNameInput: HTMLInputElement | null = null;
    private setNameIds: string[] = [];
    private readonly layoutButton: HTMLButtonElement | null = null;
    /** Header door to TradingView-like Manage objects (sync scopes + specific charts). */
    private readonly objectsButton: HTMLButtonElement | null = null;
    /** Header shortcut for TradingView's group system — visible even without a context menu. */
    private readonly groupButton: HTMLButtonElement | null = null;
    private manageObjectsDialog: Dialog | null = null;
    private manageObjectsBody: HTMLElement | null = null;
    /** Which rows the Manage objects dialog is currently editing; empty = all rows. */
    private manageObjectsIds: string[] = [];

    constructor(
        host: HTMLElement,
        /** The price row's avatar icon URL for a raw symbol — routed by the shell to the
         *  owning provider's `resolveSymbolIcon`. Absent ⇒ the initials badge. */
        private readonly iconFor?: (symbol: string) => string | undefined,
        /** Host seam for the row's "Source code" entry — the legend chip's twin, and on a
         *  phone the only way to a study's code from the tree. */
        private readonly opts: {
            onSource?: (source: string, title: string, readOnly: boolean) => void;
            /** Every chart in the LAYOUT, for "Manage layout drawings" — TradingView's dialog
             *  that lists drawings across a multi-chart layout rather than one chart's tree.
             *  Absent on a single-chart host: the button does not exist without it. */
            layout?: () => ReadonlyArray<{ label: string; chart: Vela }>;
            /** DRAWING SET templates: save a whole selection/group as one reusable bundle,
             *  and insert one from the tree. The workspace owns persistence + relative
             *  geometry; the tree owns the pick, the group and the name field. */
            drawingSets?: {
                list: () => ReadonlyArray<{ name: string; count: number }>;
                save: (name: string, ids: readonly string[]) => boolean;
                insert: (name: string) => number;
                remove?: (name: string) => void;
            };
            /** TradingView-like Manage objects: per-object/group sync scope, specific
             *  chart targets, and on-demand layout synchronization. */
            drawingSync?: {
                rows: () => ReadonlyArray<{ id: string; label: string; mode: 'none' | 'layout' | 'global' | 'charts'; charts: string[] }>;
                charts: () => ReadonlyArray<{ id: string; label: string; symbol: string; active: boolean }>;
                mode: (id: string) => 'none' | 'layout' | 'global' | 'charts';
                setMode: (ids: readonly string[], mode: 'none' | 'layout' | 'global' | 'charts', charts?: readonly string[]) => void;
                defaultMode: () => 'none' | 'layout' | 'global' | 'charts';
                setDefaultMode: (mode: 'none' | 'layout' | 'global' | 'charts') => void;
                apply: (ids: readonly string[]) => number;
            };
            /** Visual-order edits touch renderer stacking as well as drawing documents. The
             *  host uses this seam to persist immediately — `renderer.set('seriesOrder')`
             *  does not emit a chart event of its own. */
            onStackChanged?: () => void;
            /** Group/folder bookkeeping changed — persist + capture it in history. */
            onGroupsChanged?: () => void;
            /** Wrap a multi-write visual-order edit so fine-grained drawing history does
             *  not create one delegate step per drawing; the host's state history owns
             *  the whole transaction instead. */
            historyTransaction?: (mutate: () => void) => void;
        } = {},
    ) {
        super(host, 'Object tree', 'vela-ot', {
            resizable: true,
            width: 300,
            minWidth: 240,
            maxWidth: 560,
            maximizable: true,
        });
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        // Header door to the layout-wide drawing manager (multi-chart hosts only) — the tree
        // itself is per chart, and TradingView keeps the across-charts view in the header.
        if (this.opts.layout) {
            const doc = host.ownerDocument;
            const b = doc.createElement('button');
            b.className = 'vela-ot-headerbtn';
            b.title = 'Manage layout drawings';
            b.setAttribute('aria-label', 'Manage layout drawings');
            b.appendChild(iconEl('objects', doc));
            b.addEventListener('click', () => this.openLayoutDrawings());
            this.headerSlot.appendChild(b);
            this.layoutButton = b;
        }
        // Group system + Manage objects: both are header doors, so a phone never needs a
        // long-press or a right-click to reach them.
        if (this.opts.drawingSync) {
            const doc = host.ownerDocument;
            const g = doc.createElement('button');
            g.className = 'vela-ot-headerbtn';
            g.title = 'Group selection';
            g.setAttribute('aria-label', 'Group selection');
            g.appendChild(iconEl('group', doc));
            g.addEventListener('click', () => this.createGroupFromSelection());
            this.headerSlot.appendChild(g);
            this.groupButton = g;
            const b = doc.createElement('button');
            b.className = 'vela-ot-headerbtn';
            b.title = 'Manage objects';
            b.setAttribute('aria-label', 'Manage objects');
            b.appendChild(iconEl('link', doc));
            b.addEventListener('click', () => this.openManageObjects());
            this.headerSlot.appendChild(b);
            this.objectsButton = b;
        }

        this.body.addEventListener('contextmenu', (e) => this.onContextMenu(e));
        this.body.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        // Multi-select is keyboard-first on a desktop (Shift ranges, Ctrl+A, Delete), so the
        // list itself takes focus; a finger never needs it.
        this.body.tabIndex = -1;
        this.body.addEventListener('keydown', (e) => this.onKeyDown(e));
        const win = host.ownerDocument.defaultView;
        this.hoverCapable = typeof win?.matchMedia === 'function' ? win.matchMedia('(hover: hover)').matches : true;
        // Delete/Esc belong to the PICK, not to whatever happens to hold focus: a pick can be
        // started from the row (mouse), a long-press (finger) or the chart's own selection,
        // and in every one of those cases the user expects the keys to work. Capture so the
        // chart's own Delete handler never sees a key that the tree already answered.
        this.onDocKey = (e) => {
            if (!this.open || !this.bulk || this.selCount === 0) return;
            const t = e.target as HTMLElement | null;
            if (t?.closest('input, textarea, [contenteditable="true"]')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.clearSelection();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();
                this.applyBulk('remove');
            }
        };
        host.ownerDocument.addEventListener('keydown', this.onDocKey, true);
    }

    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (open) this.refresh();
    }

    setSymbol(symbol: string): void {
        // Bare ticker — the tree labels the price series, not its routing venue. The
        // RAW form is kept beside it: icon resolution routes through the venue.
        this.symbolRaw = symbol;
        this.symbolName = parseSymbol(symbol).ticker;
        // The label is part of the tree's model, not a decoration: repaint immediately
        // so a pair change is visible even when the chart emits its load events late.
        this.refresh();
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.detach();
        this.chart = chart;
        for (const ev of REFRESH_EVENTS) {
            this.unsubs.push(chart.on(ev, () => this.refresh()));
        }
        // The readout follows the live bar; only the value TEXT is rewritten (see
        // refreshValues) so the list is never rebuilt on a tick.
        this.unsubs.push(chart.on('bar', () => this.refreshValues()));
        // …and it follows the CROSSHAIR: scrubbing the chart reads every study's value at
        // that bar here, which is the phone's only readout (the legend is folded away).
        // Not every renderer speaks crosshair (test doubles, exotic backends) — the tree
        // must still mount there, it just won't follow a cursor it never sees.
        if (typeof chart.renderer.onCrosshairMove === 'function') {
            this.unsubs.push(chart.renderer.onCrosshairMove(() => this.refreshValues()));
        }
        // Selection both stores and repaints, in that order: a refresh triggered before the id
        // is recorded would paint the previous selection and never come back to fix it.
        this.unsubs.push(
            chart.on('drawing:selected', ({ ids }) => {
                this.selectedDrawings = new Set(ids);
                // A selection made on the chart takes over the panel's pick — all of it, so a
                // marquee or Ctrl-click selection on the chart lights up every row it covers. Our
                // own echo does not, or pushing a pick would just replace it with itself mid-render.
                if (!this.syncingSelection) this.picked = new Set(ids);
                this.refresh();
            }),
        );
        this.refresh();
    }

    override destroy(): void {
        if (this.onDocKey) this.el.ownerDocument.removeEventListener('keydown', this.onDocKey, true);
        this.onDocKey = null;
        this.detach();
        this.endDrag(false); // a drag in flight has nothing left to drop onto
        this.menu?.destroy();
        this.menu = null;
        this.setNameDialog?.destroy();
        this.setNameDialog = null;
        super.destroy();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.chart = null;
    }

    /** Read the chart into the layout's input. Every chart query happens here, once a pass. */
    private snapshot(chart: Vela, handle: (id: string) => IndicatorHandle | undefined): TreeSnapshot {
        const stackable = chart.renderer.supports('seriesOrder') && chart.renderer.supports('candleZOrder');
        return {
            panes: chart.panes.list(),
            indicatorVisible: (id) => handle(id)?.visible !== false,
            handleTitle: (id) => handle(id)?.title,
            stackable,
            interleave: stackable && chart.drawings.supported && chart.renderer.capabilities.drawingDepth === true,
            zOrder: stackable ? ((chart.renderer.get('seriesOrder') as Array<{ id: string; z: number }> | undefined) ?? []) : [],
            candleZ: stackable ? Number(chart.renderer.get('candleZOrder')) || 0 : 0,
            priceLabel: this.symbolName || 'Price',
            priceVisible: chart.renderer.get('candleVisible') !== false,
            drawings: chart.drawings.supported ? chart.drawings.all() : [],
            groups: this.groups,
        };
    }

    /**
     * Repaint because something changed — unless the panel is mid-interaction. A live drag
     * resolves drops against the rows as currently rendered, and a rename lives in an input
     * that a repaint would destroy mid-word. Both end by painting themselves.
     */
    /** Public so the workspace can repaint after a sync scope change. */
    refresh(): void {
        if (this.restacking || this.drag?.active === true || this.renaming !== null) return;
        this.render();
    }

    /** One indicator's newest plot value, pre-formatted by the renderer. Empty when the
     *  chart has no readout for it (a hidden or not-yet-run indicator). */
    private valueFor(id: string): string {
        return this.readoutRows(id)[0]?.value ?? '';
    }

    /**
     * One indicator's readout rows — every plot the data window shows, in its order.
     * Matched by ID first (two studies can share a title), then by title for a renderer
     * that predates `DataWindowGroup.id`.
     */
    private readoutRows(id: string): DataWindowRow[] {
        const chart = this.chart;
        if (!chart) return [];
        const readout = chart.renderer.dataWindowReadout?.();
        if (!readout) return [];
        const byId = readout.groups.find((g) => g.id === id);
        if (byId) return byId.rows;
        const title = chart.indicators().find((h) => h.id === id)?.title;
        if (title === undefined) return [];
        return readout.groups.find((g) => g.name === title)?.rows ?? [];
    }

    /** Rewrite the value spans in place — no re-render, so the list never jumps while a
     *  finger is on it. Coalesced to one pass per animation frame. */
    private refreshValues(): void {
        if (this.valueSpans.size === 0 || this.chart === null) return;
        const win = this.el.ownerDocument.defaultView;
        const raf = win?.requestAnimationFrame;
        if (!raf) {
            this.writeValues();
            return;
        }
        if (this.valueFrame !== 0) return;
        this.valueFrame = raf(() => {
            this.valueFrame = 0;
            this.writeValues();
        });
    }

    private writeValues(): void {
        for (const [id, span] of this.valueSpans) {
            const next = this.valueFor(id);
            if (span.isConnected && span.textContent !== next) span.textContent = next;
        }
        for (const [id, spans] of this.blockSpans) {
            const rows = this.readoutRows(id);
            spans.forEach((span, i) => {
                const next = rows[i]?.value ?? '';
                if (span.isConnected && span.textContent !== next) span.textContent = next;
            });
        }
    }

    private render(): void {
        this.valueSpans.clear();
        this.blockSpans.clear();
        if (this.el.hidden || !this.chart) return;
        const chart = this.chart;
        this.prune(chart);
        const byId = new Map(chart.indicators().map((h) => [h.id, h]));
        const snap = this.snapshot(chart, (id) => byId.get(id));
        const panes = buildTree(snap);
        const pass: Pass = { chart, handle: (id) => byId.get(id), stackable: snap.stackable, repanable: chart.panes.supported, interleave: snap.interleave, panes };
        this.pass = pass;
        this.body.replaceChildren();

        const doc = this.el.ownerDocument;
        panes.forEach((pane, i) => {
            // Never a band above the first block — the price pane stays pinned to the top.
            if (i > 0) this.body.appendChild(this.gapEl(pass, panes[i - 1]!.id, pane.id));
            this.body.appendChild(this.paneBlock(pass, pane));
        });
        // A band below the last block opens a pane at the bottom.
        const last = panes[panes.length - 1];
        if (last && pass.repanable) this.body.appendChild(this.gapEl(pass, last.id, undefined));

        if (treeIsEmpty(panes)) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ot-empty';
            empty.textContent = 'Add an indicator or a drawing to populate the tree';
            this.body.appendChild(empty);
        }
        // The selection bar comes LAST and sticks to the bottom: appearing must not push the
        // rows down — a long-press is still holding one of them when the bar shows up.
        this.body.appendChild(this.selectionBar(pass));
        // Paint order, for Shift ranges and Ctrl+A. Read from the DOM so it can never drift
        // from what is actually on screen (folded studies, collapsed groups and all).
        this.rowOrder = [...this.body.querySelectorAll<HTMLElement>('.vela-ot-row[data-id]')]
            .map((r) => ({ id: r.dataset.id ?? '', kind: r.dataset.rowKind ?? '' }))
            .filter((r) => r.id !== '');
        if (this.groupButton) {
            const count = this.pickedDrawings().length + this.groupPicks.size;
            this.groupButton.disabled = count < 2;
            this.groupButton.title = count < 2 ? 'Select two or more objects to group' : `Group selection (${count})`;
        }
    }

    /** The header group door: picks can contain drawings, nested groups, or both. */
    private createGroupFromSelection(): void {
        const ids = [...this.pickedDrawings()];
        const groups = [...this.groupPicks];
        if (ids.length + groups.length < 2) return;
        this.makeGroup(ids, groups);
    }

    /** TradingView's floating selection toolbar, docked to the top of the list: the eye, the
     *  bin and the gear act on the WHOLE pick — studies and drawings together — and the
     *  panel's own verbs (group, duplicate) appear when the pick is all drawings. It exists
     *  only while a multi-pick is live, so it never sits there as dead space. */
    private selectionBar(pass: Pass): HTMLElement {
        const doc = this.el.ownerDocument;
        const bar = doc.createElement('div');
        bar.className = 'vela-ot-selbar';
        const ids = [...this.picked];
        const inds = [...this.selInd];
        const groups = [...this.groupPicks];
        const total = ids.length + inds.length + groups.length;
        const pickedIds = this.pickedDrawings();
        if (!this.bulk || total === 0) {
            bar.hidden = true;
            return bar;
        }
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Selection actions');
        const { chart } = pass;
        const drawings = chart.drawings.supported ? chart.drawings.all() : [];
        const anyVisible =
            inds.some((id) => pass.handle(id)?.visible !== false) ||
            pickedIds.some((id) => drawings.find((d) => d.id === id)?.visible !== false);
        bar.appendChild(
            this.btn({
                icon: anyVisible ? 'eye-off' : 'eye',
                title: anyVisible ? `Hide ${total === 1 ? 'it' : `all ${total}`}` : `Show ${total === 1 ? 'it' : `all ${total}`}`,
                run: () => this.applyBulk(anyVisible ? 'hide' : 'show'),
            }),
        );
        bar.appendChild(
            this.btn({
                icon: 'trash',
                title: `Remove ${total === 1 ? 'it' : `all ${total}`}`,
                run: () => this.applyBulk('remove'),
            }),
        );
        // Settings are per-object in this renderer, so the gear is offered when the pick is
        // exactly one study — the same reach as double-clicking its row.
        if (inds.length === 1 && ids.length === 0 && chart.renderer.supportsIndicatorSettings) {
            bar.appendChild(
                this.btn({
                    icon: 'gear',
                    title: 'Indicator settings',
                    run: () => chart.renderer.openIndicatorSettings(inds[0]!),
                }),
            );
        }
        // Grouping and duplicating are the panel's own drawing verbs. A pick holding GROUP
        // headers groups them too — that is how one group is nested inside another.
        if (ids.length > 0 || groups.length > 0) {
            const groupable = canGroup(ids, this.groups);
            if (this.opts.drawingSync && pickedIds.length > 0) {
                bar.appendChild(
                    this.btn({
                        icon: 'link',
                        title: 'Manage objects',
                        run: () => this.openManageObjects(pickedIds),
                    }),
                );
            }
            bar.appendChild(
                this.btn({
                    icon: 'group',
                    title:
                        groups.length > 0
                            ? `Group these ${total} items`
                            : groupable
                              ? `Group ${ids.length === 1 ? 'this drawing' : 'these drawings'}`
                              : 'Already in a group',
                    disabled: !groupable,
                    run: () => this.makeGroup(ids, groups),
                }),
            );
            bar.appendChild(
                this.btn({
                    icon: 'clone',
                    title: 'Duplicate',
                    run: () => {
                        for (const id of pickedIds) this.cloneInto(pass, id);
                        this.render();
                    },
                }),
            );
        }
        const count = doc.createElement('span');
        count.className = 'vela-ot-selcount';
        count.textContent = `${total} selected`;
        bar.appendChild(count);
        bar.appendChild(
            this.btn({
                icon: 'close',
                title: 'Clear selection',
                run: () => this.clearSelection(),
            }),
        );
        return bar;
    }

    /** The band between two pane blocks. With re-paning available it is a drop zone that opens
     *  a fresh pane there; otherwise it is just the separator. `before`/`after` name the panes
     *  it sits between (either end is open at the edges of the list). */
    private gapEl(pass: Pass, after: string | undefined, before: string | undefined): HTMLElement {
        const el = this.el.ownerDocument.createElement('div');
        if (!pass.repanable) {
            el.className = 'vela-ot-panesep';
            return el;
        }
        el.className = 'vela-ot-gap';
        if (before !== undefined) el.dataset.before = before;
        if (after !== undefined) el.dataset.after = after;
        return el;
    }

    /**
     * A pane, read top to bottom as front to back: ONE column holding its drawings, its
     * indicators and (in the main pane) the candles, in draw order. Every child of the stack
     * element is one slot, so a drop position is read straight off the rendered geometry.
     */
    private paneBlock(pass: Pass, pane: TreePane): HTMLElement {
        const doc = this.el.ownerDocument;
        const block = doc.createElement('div');
        block.className = 'vela-ot-pane';
        block.dataset.pane = pane.id;
        block.dataset.kind = pane.kind;
        block.appendChild(this.paneHead(pass, pane));
        const stack = doc.createElement('div');
        stack.className = 'vela-ot-stack';
        for (const item of pane.items) {
            stack.appendChild(item.kind === 'row' ? this.rowEl(pass, pane, item.row) : this.unitEl(pass, pane, item.unit));
        }
        block.appendChild(stack);
        return block;
    }

    /** One top-level drawing entry: a lone drawing's row, or a group block — its header plus,
     *  unfolded, a member row for each drawing it holds. */
    private unitEl(pass: Pass, pane: TreePane, unit: DrawUnit, depth = 0): HTMLElement {
        const doc = this.el.ownerDocument;
        const wrap = doc.createElement('div');
        wrap.className = 'vela-ot-unit';
        if (depth > 0) wrap.dataset.depth = String(depth);
        if (unit.kind === 'draw') {
            wrap.appendChild(this.drawRow(pass, unit.drawing, depth > 0, depth));
        } else {
            wrap.dataset.group = unit.group.id;
            wrap.appendChild(this.groupRow(pass, pane, unit, depth));
            if (!this.collapsed.has(unit.group.id)) {
                for (const m of unit.members) wrap.appendChild(this.drawRow(pass, m, true, depth + 1));
                for (const child of unit.children) wrap.appendChild(this.unitEl(pass, pane, child, depth + 1));
            }
        }
        return wrap;
    }

    /** The pane's name plus its ops: a study pane can move in the stack and collapse; every
     *  pane can be maximized. */
    private paneHead(pass: Pass, pane: TreePane): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        const head = doc.createElement('div');
        head.className = 'vela-ot-panehead';
        const name = doc.createElement('span');
        name.className = 'vela-ot-panename';
        name.textContent = pane.label;
        name.title = pane.label;
        head.appendChild(name);
        if (!chart.panes.supported) return head;
        const acts = doc.createElement('span');
        acts.className = 'vela-ot-acts';
        head.appendChild(acts);
        const op = (icon: string, title: string, run: () => void): void => {
            acts.appendChild(this.btn({ icon, title, run }));
        };
        if (pane.kind !== 'price') {
            if (pane.order > 1) op('arrow-up', 'Move pane up', () => chart.panes.move(pane.id, 'up'));
            if (pane.order < pass.panes.length - 1) op('arrow-down', 'Move pane down', () => chart.panes.move(pane.id, 'down'));
            op(pane.collapsed ? 'expand' : 'collapse', pane.collapsed ? 'Expand pane' : 'Collapse pane', () => chart.panes.collapse(pane.id, !pane.collapsed));
        }
        op(pane.maximized ? 'restore' : 'maximize', pane.maximized ? 'Restore panes' : 'Maximize pane', () => chart.panes.maximize(pane.maximized ? null : pane.id));
        return head;
    }

    private rowEl(pass: Pass, pane: TreePane, row: TreeRow): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        if (row.kind === 'price') {
            const base = this.symbolName.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || this.symbolName;
            const icon = tickerIconEl(doc, base || 'P', this.symbolName || 'Price', 'vela-ot-avatar', this.symbolRaw ? this.iconFor?.(this.symbolRaw) : undefined);
            const el = this.row(icon, row.label, row.visible, [
                {
                    icon: row.visible ? 'eye' : 'eye-off',
                    title: row.visible ? 'Hide' : 'Show',
                    engaged: !row.visible,
                    run: () => {
                        chart.renderer.set('candleVisible', !row.visible);
                        this.refresh();
                    },
                },
            ]);
            el.dataset.rowKind = 'price';
            el.dataset.pane = pane.id;
            // The candles can only be restacked — they never leave the main pane.
            if (pass.stackable) {
                el.dataset.drag = '1';
                el.prepend(this.gripEl());
                el.title = 'Drag to change what draws in front';
            }
            return el;
        }
        const handle = pass.handle(row.id);
        const readoutRows = this.readoutRows(row.id);
        const canExpand = readoutRows.length > 1;
        const el = this.row(
            iconEl('indicators', doc),
            row.label,
            row.visible,
            [
                {
                    icon: row.visible ? 'eye' : 'eye-off',
                    title: row.visible ? 'Hide' : 'Show',
                    engaged: !row.visible,
                    run: () => {
                        handle?.setVisible(!row.visible);
                        this.refresh();
                    },
                },
                {
                    icon: 'trash',
                    title: 'Remove',
                    run: () => {
                        handle?.remove();
                        this.refresh();
                    },
                },
            ],
            row.ownScale ? 'scale' : undefined,
            canExpand
                ? {
                      value: this.valueFor(row.id),
                      more: true,
                      disclosure: {
                          open: this.openValues.has(row.id),
                          controls: `vela-ot-values-${row.id}`,
                          title: this.openValues.has(row.id) ? 'Hide all values' : `Show all ${readoutRows.length} values`,
                          run: () => {
                              if (this.openValues.has(row.id)) this.openValues.delete(row.id);
                              else this.openValues.add(row.id);
                              this.render();
                          },
                      },
                  }
                : { value: this.valueFor(row.id), more: true },
        );
        el.dataset.rowKind = 'indicator';
        el.dataset.id = row.id;
        if (this.selInd.has(row.id)) el.dataset.picked = '1';
        el.addEventListener('click', (e) => this.onRowClick(e, 'indicator', row.id));
        // TradingView opens a study's settings on a double-click; the row's ▾/right-click
        // keeps the same verb, this is just the shortcut.
        el.addEventListener('dblclick', (e) => {
            if (this.lastPointerWasTouch) return;
            if ((e.target as HTMLElement).closest('.vela-ot-btn, .vela-ot-fold')) return;
            const h = handle;
            if (h && pass.chart.renderer.supportsIndicatorSettings) pass.chart.renderer.openIndicatorSettings(h.id);
        });
        // Live readout: the span is painted once and only its TEXT is rewritten afterwards
        // (see refreshValues) — a re-render per tick would rebuild the list under a finger.
        const val = el.querySelector<HTMLElement>('.vela-ot-val');
        if (val) this.valueSpans.set(row.id, val);
        el.dataset.pane = pane.id;
        if (pass.repanable || pass.stackable) {
            el.dataset.drag = '1';
            el.prepend(this.gripEl());
            el.title = pass.repanable ? 'Drag to another pane, or between panes for a new one' : 'Drag to change what draws in front';
        }
        if (!this.openValues.has(row.id) || readoutRows.length === 0) return el;
        // The opened row becomes a WRAPPER: the row itself plus one line per plot, indented
        // under it — the data window's readout, read where the trader already is.
        const wrap = doc.createElement('div');
        wrap.className = 'vela-ot-rowgroup';
        wrap.dataset.forId = row.id;
        wrap.appendChild(el);
        const block = doc.createElement('div');
        block.className = 'vela-ot-values';
        block.dataset.pane = pane.id;
        // A named group, announced as one thing: "BB values, 3 items".
        block.id = `vela-ot-values-${row.id}`;
        block.setAttribute('role', 'group');
        block.setAttribute('aria-label', `${row.label} values`);
        const spans: HTMLElement[] = [];
        for (const readoutRow of readoutRows) {
            const line = doc.createElement('div');
            line.className = 'vela-ot-vrow';
            const dot = doc.createElement('span');
            dot.className = 'vela-ot-dot';
            dot.setAttribute('aria-hidden', 'true');
            if (readoutRow.color) dot.style.background = readoutRow.color;
            const label = doc.createElement('span');
            label.className = 'vela-ot-vlabel';
            label.textContent = readoutRow.label;
            label.title = readoutRow.label;
            const value = doc.createElement('span');
            value.className = 'vela-ot-val';
            value.textContent = readoutRow.value;
            line.append(dot, label, value);
            block.appendChild(line);
            spans.push(value);
        }
        this.blockSpans.set(row.id, spans);
        wrap.appendChild(block);
        return wrap;
    }

    /** A group's header: fold arrow, its name (or the rename field), then actions that apply to
     *  every member at once. Reports "all hidden"/"all locked" rather than a mixed state.
     *
     * The state comes from the whole bundle, not from the members listed under this pane: should
     * a member end up on another pane, the header still speaks for the group its actions affect.
     */
    private groupRow(pass: Pass, pane: TreePane, unit: Extract<DrawUnit, { kind: 'group' }>, depth = 0): HTMLElement {
        const doc = this.el.ownerDocument;
        const g = unit.group;
        const folded = this.collapsed.has(g.id);
        // Every drawing the branch owns, nested groups included — that is what its eye, its
        // padlock and its count report.
        const owned = new Set(groupDrawingIds(this.groups, g.id));
        const members = pass.chart.drawings.all().filter((d) => owned.has(d.id));
        const { allHidden, allLocked } = groupState(members);
        const ids = [...owned];
        // The chevron is its own control: folding a group must never be the only thing a tap
        // on its header can do (that is where picking, dragging and renaming start).
        const chev = doc.createElement('button');
        chev.className = 'vela-ot-fold vela-ot-gchev';
        chev.setAttribute('aria-expanded', String(!folded));
        chev.title = folded ? 'Expand' : 'Collapse';
        chev.appendChild(iconEl(folded ? 'chevron-right' : 'chevron-down', doc));
        chev.addEventListener('click', (e) => {
            e.stopPropagation();
            if (folded) this.collapsed.delete(g.id);
            else this.collapsed.add(g.id);
            this.render();
        });
        const el = this.row(chev, g.name, !allHidden, [
            {
                icon: allLocked ? 'lock' : 'unlock',
                title: allLocked ? 'Unlock all' : 'Lock all',
                engaged: allLocked,
                run: () => this.setMembers(pass, ids, { locked: !allLocked }),
            },
            {
                icon: allHidden ? 'eye-off' : 'eye',
                title: allHidden ? 'Show all' : 'Hide all',
                engaged: allHidden,
                run: () => this.setMembers(pass, ids, { visible: allHidden }),
            },
            { icon: 'trash', title: 'Remove all', run: () => this.removeGroup(pass, g.id, true) },
        ]);
        el.dataset.rowKind = 'group';
        el.dataset.id = g.id;
        el.dataset.pane = pane.id;
        if (depth > 0) el.dataset.depth = String(depth);
        const kids = unit.children.length;
        el.title = `${members.length} drawing${members.length === 1 ? '' : 's'}${kids > 0 ? ` in ${kids} nested group${kids === 1 ? '' : 's'}` : ''} — drag to move them together, or onto another group to nest`;
        if (this.renaming === g.id) {
            // A row being renamed is a text field, not a handle: dragging it would leave the
            // rename open with the tree frozen behind it.
            const name = el.querySelector('.vela-ot-name');
            const input = doc.createElement('input');
            input.className = 'vela-ot-rename';
            input.value = g.name;
            name?.replaceWith(input);
            // Focus after the row is in the document, or the caret has nothing to land in.
            queueMicrotask(() => {
                input.focus();
                input.select();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.commitRename(g.id, input.value);
                } else if (e.key === 'Escape') {
                    this.renaming = null;
                    this.render();
                } else if (e.key === ' ') e.stopPropagation(); // typing, not a shortcut
            });
            // Clicking away keeps what was typed, the way a rename in a file list does.
            input.addEventListener('blur', () => this.commitRename(g.id, input.value));
        } else {
            el.dataset.drag = '1';
            el.prepend(this.gripEl());
            if (this.groupPicks.has(g.id)) el.dataset.picked = '1';
            el.addEventListener('click', (e) => this.onRowClick(e, 'group', g.id));
            // Double-click names it, the way a row in a file list does.
            el.addEventListener('dblclick', (e) => {
                if ((e.target as HTMLElement).closest('.vela-ot-btn, .vela-ot-fold')) return;
                this.renaming = g.id;
                this.render();
            });
        }
        return el;
    }

    private drawRow(pass: Pass, d: SerializedDrawing, inGroup = false, depth = 0): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        const markup = drawingMeta(d.type).icon;
        let icon: HTMLElement;
        if (markup) {
            icon = doc.createElement('span');
            icon.className = 'vela-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = markup;
        } else {
            icon = iconEl('pen', doc);
        }
        const el = this.row(icon, drawingLabel(d), d.visible, [
            {
                icon: d.locked ? 'lock' : 'unlock',
                title: d.locked ? 'Unlock' : 'Lock',
                engaged: d.locked,
                run: () => {
                    chart.drawings.lock(d.id, !d.locked);
                    this.refresh();
                },
            },
            {
                icon: d.visible ? 'eye' : 'eye-off',
                title: d.visible ? 'Hide' : 'Show',
                engaged: !d.visible,
                run: () => {
                    chart.drawings.show(d.id, !d.visible);
                    this.refresh();
                },
            },
            {
                icon: 'trash',
                title: 'Remove',
                run: () => {
                    chart.drawings.remove(d.id);
                    this.refresh();
                },
            },
        ]);
        el.dataset.rowKind = 'drawing';
        el.dataset.id = d.id;
        el.dataset.pane = d.paneId;
        el.dataset.drag = '1';
        el.prepend(this.gripEl());
        el.title = 'Drag to restack, onto a group to join it, or onto another pane to move it there';
        if (inGroup) el.classList.add('vela-ot-subrow');
        if (depth > 0) el.dataset.depth = String(depth);
        if (this.selectedDrawings.has(d.id)) el.dataset.selected = '1';
        if (this.picked.has(d.id)) el.dataset.picked = '1';
        el.addEventListener('click', (e) => this.onRowClick(e, 'drawing', d.id));
        return el;
    }

    /** How many rows are picked, drawings and studies together. */
    private get selCount(): number {
        return this.picked.size + this.selInd.size + this.groupPicks.size;
    }

    /** Every drawing the pick covers, groups expanded — what hide/lock/remove act on. */
    private pickedDrawings(): string[] {
        const out = new Set(this.picked);
        for (const gid of this.groupPicks) for (const id of groupDrawingIds(this.groups, gid)) out.add(id);
        return [...out];
    }

    private setFor(kind: string): Set<string> {
        if (kind === 'drawing') return this.picked;
        if (kind === 'group') return this.groupPicks;
        return this.selInd;
    }

    /** Clicking a row picks it; Ctrl/Cmd extends the pick, Shift takes a range, and a plain
     *  click on the only picked row clears it. A long-press on a finger starts a pick, the
     *  way a phone list does — a plain tap there stays a tap. Drawings mirror onto the chart. */
    private onRowClick(e: MouseEvent, kind: string, id: string): void {
        if ((e.target as HTMLElement).closest('.vela-ot-btn, .vela-ot-fold, .vela-ot-rename')) return;
        if (Date.now() < this.suppressClickUntil) return; // the click a long-press synthesised
        if (e.shiftKey && this.selAnchor) {
            this.selectRange(id);
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            const set = this.setFor(kind);
            if (set.has(id)) set.delete(id);
            else set.add(id);
            this.selAnchor = id;
            this.bulk = this.selCount > 1;
            this.selectOnChart(this.pickedDrawings());
            this.render();
            return;
        }
        if (!this.hoverCapable && this.selCount === 0) return; // a finger's plain tap
        if (this.setFor(kind).has(id) && this.selCount === 1) {
            this.clearSelection();
            return;
        }
        this.picked.clear();
        this.selInd.clear();
        this.groupPicks.clear();
        this.setFor(kind).add(id);
        this.selAnchor = id;
        this.bulk = false;
        this.selectOnChart(this.pickedDrawings());
        this.render();
    }

    /** Shift-click: everything between the anchor and this row, in the order it is painted. */
    private selectRange(id: string): void {
        const order = this.rowOrder;
        const to = order.findIndex((r) => r.id === id);
        const from = order.findIndex((r) => r.id === this.selAnchor);
        if (to < 0 || from < 0) {
            this.selAnchor = id;
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        this.picked.clear();
        this.selInd.clear();
        this.groupPicks.clear();
        for (const row of order.slice(lo, hi + 1)) this.setFor(row.kind).add(row.id);
        this.bulk = true;
        this.selectOnChart(this.pickedDrawings());
        this.render();
    }

    /** Ctrl/Cmd+A — every row the panel is showing. */
    private selectAllRows(): void {
        if (this.rowOrder.length === 0) return;
        this.picked.clear();
        this.selInd.clear();
        this.groupPicks.clear();
        for (const row of this.rowOrder) this.setFor(row.kind).add(row.id);
        this.bulk = true;
        this.selAnchor = this.rowOrder[0]!.id;
        this.selectOnChart(this.pickedDrawings());
        this.render();
    }

    private clearSelection(quiet = false): void {
        if (this.selCount === 0 && !this.bulk) return;
        this.picked.clear();
        this.selInd.clear();
        this.groupPicks.clear();
        this.selAnchor = null;
        this.bulk = false;
        this.selectOnChart([]);
        if (!quiet) this.render();
    }

    /** The pick's eye / trash, over studies and drawings alike. */
    private applyBulk(what: 'hide' | 'show' | 'remove'): void {
        const chart = this.chart;
        if (!chart || this.selCount === 0) return;
        const handles = new Map(chart.indicators().map((h) => [h.id, h]));
        const drawings = this.pickedDrawings();
        if (what === 'remove') {
            for (const id of [...this.selInd]) handles.get(id)?.remove();
            for (const id of drawings) chart.drawings.remove(id);
            // Remove a picked GROUP's own bookkeeping too, or its name would linger with
            // nothing under it (prune would catch it a render later; do it now).
            if (this.groupPicks.size > 0) this.groups = this.groups.filter((g) => !this.groupPicks.has(g.id));
            this.picked.clear();
            this.selInd.clear();
            this.groupPicks.clear();
            this.bulk = false;
            this.selAnchor = null;
            this.selectOnChart([]);
        } else {
            const show = what === 'show';
            for (const id of this.selInd) handles.get(id)?.setVisible(show);
            for (const id of drawings) chart.drawings.show(id, show);
        }
        this.render();
    }

    /** Delete/Backspace removes the pick, Ctrl+A takes the lot, Esc lets go — the keys a
     *  TradingView object tree answers to. */
    private onKeyDown(e: KeyboardEvent): void {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        if (e.key === 'Escape') {
            // Swallow it: the panel's own Escape (close) must not fire while a pick is live —
            // the first Escape lets go of the pick, the next one closes the panel.
            if (this.selCount === 0 && !this.bulk) return;
            e.preventDefault();
            e.stopPropagation();
            this.clearSelection();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            this.selectAllRows();
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selCount > 0) {
            e.preventDefault();
            e.stopPropagation();
            this.applyBulk('remove');
        }
    }

    /** A finger held still on a row: start a pick there instead of dragging it. */
    private armLongPress(e: PointerEvent, kind: string, id: string): void {
        const win = this.el.ownerDocument.defaultView;
        if (!win || this.pressTimer !== null) return;
        // Lifting the finger (or the system cancelling the touch) disarms it; holding still
        // for the delay is what starts the pick.
        const off = (): void => {
            this.cancelLongPress();
            win.removeEventListener('pointerup', off);
            win.removeEventListener('pointercancel', off);
        };
        win.addEventListener('pointerup', off);
        win.addEventListener('pointercancel', off);
        this.pressTimer = win.setTimeout(() => {
            this.pressTimer = null;
            const drag = this.drag;
            this.picked.clear();
            this.selInd.clear();
            this.groupPicks.clear();
            this.setFor(kind).add(id);
            this.selAnchor = id;
            this.bulk = true;
            this.suppressClickUntil = Date.now() + 700;
            this.selectOnChart(this.pickedDrawings());
            this.render();
            // THE PHONE DRAG: holding a row picks it AND arms it. From here a move drags it
            // (a lift without moving leaves the pick). While the finger is down, touchmove is
            // swallowed so the list cannot take the gesture back by starting a scroll.
            if (drag && !drag.active) {
                drag.armed = true;
                this.armTouchDrag(drag);
            }
        }, 450);
        void e;
    }

    /**
     * Keep the next moves of a live touch in the tree's hands: a non-passive `touchmove` that
     * preventDefaults stops the scroller from claiming the gesture, so the pointer stream keeps
     * flowing and the row can be dragged. Registered only AFTER the hold fires, so a flick that
     * starts on a row still scrolls the list. Released on pointerup/pointercancel.
     */
    private armTouchDrag(drag: DragSession): void {
        const win = this.el.ownerDocument.defaultView;
        if (!win || this.touchBlock) return;
        const block = (ev: TouchEvent): void => {
            if (ev.cancelable) ev.preventDefault();
        };
        this.touchBlock = block;
        win.addEventListener('touchmove', block, { passive: false });
        const release = (): void => {
            win.removeEventListener('touchmove', block);
            win.removeEventListener('pointerup', release);
            win.removeEventListener('pointercancel', release);
            if (this.touchBlock === block) this.touchBlock = null;
            drag.armed = false;
        };
        win.addEventListener('pointerup', release);
        win.addEventListener('pointercancel', release);
    }

    /** Drop any live touch block — a teardown, or a session abandoned from code. */
    private releaseTouchDrag(): void {
        const win = this.el.ownerDocument.defaultView;
        if (this.touchBlock && win) win.removeEventListener('touchmove', this.touchBlock);
        this.touchBlock = null;
    }

    private cancelLongPress(): void {
        if (this.pressTimer === null) return;
        const win = this.el.ownerDocument.defaultView;
        win?.clearTimeout(this.pressTimer);
        this.pressTimer = null;
    }

    /** Push the panel's pick onto the chart, muting the `drawing:selected` echo it causes. */
    private selectOnChart(ids: readonly string[]): void {
        const chart = this.chart;
        if (!chart?.drawings.supported) return;
        this.syncingSelection = true;
        try {
            chart.drawings.select(ids);
        } finally {
            this.syncingSelection = false;
        }
    }

    /**
     * The shared row shell: icon, name, optional tag, the live value slot, then the action
     * buttons. `more` appends the row's own ▾ menu — the touch route to everything a narrow
     * row has no space for (settings, re-paning, reverse), and the pointer route to the same
     * items a right-click already offered.
     */
    /** The touch drag handle. A phone cannot tell a reorder drag from a list flick until the
     *  finger has already committed, so the row grows a grip whose own `touch-action: none`
     *  hands the gesture straight to the tree. Hidden where a pointer hovers (the whole row
     *  drags there). */
    private gripEl(): HTMLElement {
        const doc = this.el.ownerDocument;
        const grip = doc.createElement('span');
        grip.className = 'vela-ot-grip';
        grip.setAttribute('aria-hidden', 'true');
        grip.appendChild(iconEl('grip', doc));
        return grip;
    }

    private row(
        icon: HTMLElement,
        label: string,
        visible: boolean,
        actions: readonly RowAction[],
        tag?: string,
        extra: { value?: string; more?: boolean; disclosure?: { open: boolean; title: string; controls?: string; run: () => void } } = {},
    ): HTMLElement {
        const doc = this.el.ownerDocument;
        const el = doc.createElement('div');
        el.className = 'vela-ot-row';
        if (!visible) el.dataset.hidden = '1';
        if (extra.disclosure) {
            const fold = doc.createElement('button');
            fold.type = 'button';
            fold.className = 'vela-ot-fold';
            fold.dataset.open = extra.disclosure.open ? '1' : '';
            fold.title = extra.disclosure.title;
            fold.setAttribute('aria-label', extra.disclosure.title);
            fold.setAttribute('aria-expanded', extra.disclosure.open ? 'true' : 'false');
            if (extra.disclosure.controls) fold.setAttribute('aria-controls', extra.disclosure.controls);
            fold.appendChild(iconEl(extra.disclosure.open ? 'chevron-down' : 'chevron-right', el.ownerDocument));
            fold.addEventListener('click', (event) => {
                event.stopPropagation();
                extra.disclosure?.run();
            });
            el.dataset.hasFold = '1';
            el.append(fold);
        }
        const name = doc.createElement('span');
        name.className = 'vela-ot-name';
        name.textContent = label;
        name.title = label;
        el.append(icon, name);
        if (tag) {
            const t = doc.createElement('span');
            t.className = 'vela-ot-tag';
            t.textContent = tag;
            t.title = 'Draws against its own price scale';
            el.appendChild(t);
        }
        if (extra.value !== undefined) {
            const v = doc.createElement('span');
            v.className = 'vela-ot-val';
            v.textContent = extra.value;
            el.appendChild(v);
        }
        const acts = doc.createElement('span');
        acts.className = 'vela-ot-acts';
        for (const a of actions) acts.appendChild(this.btn(a));
        if (extra.more === true) {
            acts.appendChild(
                this.btn({
                    icon: 'more',
                    title: 'More actions',
                    run: () => this.openRowMenuAt(el),
                }),
            );
        }
        el.appendChild(acts);
        return el;
    }

    /** Open a row's action menu at the row (the right-click twin). Returns the menu so a
     *  caller can close it; `null` when the row has no actions. */
    private openRowMenuAt(el: HTMLElement): Menu | null {
        const pass = this.pass;
        if (!pass) return null;
        const b = new MenuBuilder();
        const items = this.itemsForRow(b, pass, el);
        if (items.length === 0) return null;
        this.menuActions = b.actions;
        const menu = this.ensureMenu();
        menu.setItems(items);
        const r = el.getBoundingClientRect();
        menu.openAt(r.left + 24, r.bottom - 6);
        return menu;
    }

    private btn(a: RowAction): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.className = 'vela-ot-btn';
        b.dataset.icon = a.icon;
        if (a.engaged) b.dataset.engaged = '1';
        if (a.disabled) b.disabled = true;
        b.title = a.title;
        b.appendChild(iconEl(a.icon, doc));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!a.disabled) a.run();
        });
        return b;
    }

    // ── groups ─────────────────────────────────────────────────────────────
    // A group is the panel's own idea, not the chart's: it bundles drawings so they hide, lock,
    // delete and move as one. It lives as long as the panel does.

    /** Bundle drawings (and whole groups, which become NESTED inside the new one) into a fresh
     *  group. The new group takes over the pick, so the next step can nest or name it. */
    private makeGroup(ids: readonly string[], groupIds: readonly string[] = [], parent?: string): void {
        if (!canGroup(ids, this.groups)) return;
        // A group cannot be nested inside itself or into its own subtree.
        const kids = groupIds.filter((gid) => parent === undefined || !groupWithin(this.groups, parent, gid));
        if (kids.length === 0 && ids.length === 0) return;
        if (groupIds.length > 0 && kids.length === 0) return;
        // TradingView's rule: a group has ONE sync mode, and every member adopts it. When
        // objects with different modes are bundled, the first member's mode wins.
        const sync = this.opts.drawingSync;
        if (sync) {
            const memberIds = [...new Set([...ids, ...groupIds.flatMap((gid) => groupDrawingIds(this.groups, gid))])];
            if (memberIds.length > 0) {
                const rows = sync.rows();
                const lead = rows.find((r) => r.id === memberIds[0]) ?? rows[0];
                if (lead) sync.setMode(memberIds, lead.mode, lead.mode === 'charts' ? lead.charts : undefined);
            }
        }
        this.groupSeq += 1;
        const id = `grp-${this.groupSeq}`;
        let next: DrawGroup[] = [
            ...this.groups,
            { id, name: nextGroupName(this.groups), ids: [...ids], ...(parent === undefined ? {} : { parent }) },
        ];
        // The picked drawings move out of whatever held them; the picked groups move inside.
        for (const gid of kids) next = setGroupParent(next, gid, id);
        this.groups = next;
        this.picked.clear();
        this.selInd.clear();
        this.groupPicks.clear();
        this.bulk = false;
        this.render();
    }

    private commitRename(id: string, value: string): void {
        // Both Enter and losing focus land here, and one rename can raise both.
        if (this.renaming !== id) return;
        const name = value.trim();
        this.groups = this.groups.map((g) => (g.id === id && name !== '' ? { ...g, name } : g));
        this.renaming = null;
        this.render();
    }

    /** Dissolve a group. `withMembers` also deletes every drawing under it, nested groups and
     *  all; otherwise the group alone goes, its drawings loose and its children one level up.
     *  Either way an emptied container disappears (prune keeps that rule). */
    private removeGroup(pass: Pass, id: string, withMembers: boolean): void {
        const g = groupById(this.groups, id);
        if (!g) return;
        const all = groupDrawingIds(this.groups, id);
        const subtree = this.groups.filter((x) => x.id === id || groupWithin(this.groups, x.id, id)).map((x) => x.id);
        this.groups = withMembers ? this.groups.filter((x) => !subtree.includes(x.id)) : liftGroup(this.groups, id);
        for (const gid of subtree) this.collapsed.delete(gid);
        if (withMembers) {
            for (const m of all) this.picked.delete(m);
            if (all.length > 0) pass.chart.drawings.removeMany(all);
        }
        this.render();
    }

    /** Deep-copy a group: every drawing under it (nested ones included) duplicated as one undo
     *  step, landing as a sibling group with the same shape and " copy" on the name. */
    private duplicateGroup(pass: Pass, g: DrawGroup): void {
        const { chart } = pass;
        if (!chart.drawings.supported) return;
        const ids = groupDrawingIds(this.groups, g.id);
        if (ids.length === 0) return;
        const before = new Set(chart.drawings.all().map((d) => d.id));
        chart.drawings.duplicate(ids);
        const fresh = chart.drawings.all().map((d) => d.id).filter((id) => !before.has(id));
        if (fresh.length === 0) return;
        // `duplicate` keeps the input order, so the clones line up with the originals.
        const map = new Map<string, string>();
        ids.forEach((id, i) => {
            const clone = fresh[i];
            if (clone !== undefined) map.set(id, clone);
        });
        const stamp = `grp-${(this.groupSeq += 1)}`;
        const copies: DrawGroup[] = [];
        // Rebuild the subtree bottom-up so every parent exists before a child names it.
        const cloneTree = (source: DrawGroup, parent: string | undefined): string => {
            const id = `${stamp}-${source.id}`;
            const own = source.ids.map((d) => map.get(d)).filter((d): d is string => d !== undefined);
            copies.push({ id, name: source.id === g.id ? `${g.name} copy` : source.name, ids: own, ...(parent === undefined ? {} : { parent }) });
            for (const child of this.groups.filter((x) => (x.parent ?? undefined) === source.id)) cloneTree(child, id);
            return id;
        };
        cloneTree(g, g.parent);
        this.groups = [...this.groups, ...copies];
        this.render();
    }

    /** Apply one patch to every member of a group as a single undo step. */
    private setMembers(pass: Pass, ids: readonly string[], patch: Partial<SerializedDrawing>): void {
        if (ids.length === 0) return;
        pass.chart.drawings.updateMany(ids.map((id) => ({ id, patch })));
        this.render();
    }

    /** Duplicate a drawing, keeping the copy in the same group as its original — the chart has
     *  no notion of our groups, so the new id has to be spotted and filed here. */
    private cloneInto(pass: Pass, id: string): void {
        const { chart } = pass;
        if (!chart.drawings.supported) return;
        const before = new Set(chart.drawings.all().map((d) => d.id));
        chart.drawings.clone(id);
        const clone = chart.drawings.all().find((d) => !before.has(d.id));
        const g = groupOf(this.groups, id);
        if (g && clone) this.groups = assignToGroup(this.groups, g.id, [clone.id]);
    }

    // ── drag-and-drop ──────────────────────────────────────────────────────
    // Indicator rows move between panes, into a fresh pane, or to a slot in the main pane's
    // stack. The candles restack in place. Drawing rows take a slot among their pane's
    // drawings, and land in another pane's list to move there.

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        this.lastPointerWasTouch = e.pointerType === 'touch';
        const control = target.closest('.vela-ot-btn, .vela-ot-fold, .vela-ot-rename');
        const anyRow = target.closest<HTMLElement>('.vela-ot-row[data-id]');
        // The list takes focus on a press, so Delete/Ctrl+A/Esc reach onKeyDown. Not on the
        // rename field — that click belongs to the text box.
        if (anyRow && !target.closest('.vela-ot-rename')) this.body.focus({ preventScroll: true });
        // A finger held still on a row starts a pick (a mouse has Ctrl/Shift instead).
        if (e.pointerType === 'touch' && anyRow && !control) {
            const kind = anyRow.dataset.rowKind ?? '';
            const id = anyRow.dataset.id ?? '';
            if (id !== '') this.armLongPress(e, kind, id);
        }
        if (this.drag) return;
        // Row and pane-head buttons are controls, not drag handles.
        if (target.closest('.vela-ot-btn')) return;
        const rowEl = target.closest<HTMLElement>('.vela-ot-row[data-drag]');
        if (!rowEl) return;
        // The rename field is a text field, not a drag handle.
        if (target.closest('.vela-ot-rename')) return;
        const kind = rowEl.dataset.rowKind;
        if (kind !== 'price' && kind !== 'indicator' && kind !== 'drawing' && kind !== 'group') return;
        const win = this.el.ownerDocument.defaultView;
        if (!win) return;
        // A finger may not drag straight off: a swipe on the list must still scroll it. Touch
        // drags start from the row's grip (which owns its own touch-action), or once the hold
        // has armed the session (see `armTouchDrag`), which is the phone equivalent of a
        // long-press-then-move in TradingView's desktop object tree.
        const grip = target.closest('.vela-ot-grip') !== null;
        const drag: DragSession = {
            kind,
            id: rowEl.dataset.id ?? null,
            fromPane: rowEl.dataset.pane ?? PRICE_PANE_ID,
            label: rowEl.querySelector('.vela-ot-name')?.textContent ?? 'object',
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            armed: e.pointerType !== 'touch' || grip,
            pointerId: e.pointerId,
            ghost: null,
            drop: null,
            onMove: (ev) => this.onDragMove(ev),
            onUp: () => this.endDrag(true),
            onCancel: () => this.endDrag(false),
        };
        this.drag = drag;
        win.addEventListener('pointermove', drag.onMove);
        win.addEventListener('pointerup', drag.onUp);
        win.addEventListener('pointercancel', drag.onCancel);
        e.preventDefault(); // no text selection while dragging a row
    }

    private onDragMove(e: PointerEvent): void {
        const drag = this.drag;
        if (!drag) return;
        if (!drag.active) {
            // Touch sessions wait for the hold (or a grip press) before they may take over.
            if (!drag.armed) return;
            if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
            this.cancelLongPress(); // it is a drag, not a long-press
            this.beginDrag(drag);
        }
        if (drag.ghost) {
            drag.ghost.style.left = `${e.clientX + 12}px`;
            drag.ghost.style.top = `${e.clientY + 8}px`;
        }
        drag.drop = this.resolveDrop(drag, e.clientX, e.clientY);
        this.paintDropHint(drag.drop);
    }

    private beginDrag(drag: DragSession): void {
        drag.active = true;
        this.body.dataset.dragging = '1';
        const src = this.sourceRow(drag);
        if (src) src.dataset.source = '1';
        const ghost = this.el.ownerDocument.createElement('div');
        ghost.className = 'vela-ot-ghost';
        ghost.textContent = drag.label;
        // Inside the theme host: a ghost parked on <body> resolves its tokens to nothing.
        this.uiHost().appendChild(ghost);
        drag.ghost = ghost;
    }

    /** The rendered row a session started from — scanned rather than selected, so an id
     *  carrying CSS-special characters needs no escaping. */
    private sourceRow(drag: DragSession): HTMLElement | null {
        for (const el of this.body.querySelectorAll<HTMLElement>('.vela-ot-row')) {
            if (el.dataset.rowKind !== drag.kind) continue;
            if (drag.id === null || el.dataset.id === drag.id) return el;
        }
        return null;
    }

    /** What a drop at this point would do. Measured off the live geometry, which is why a
     *  refresh is suspended for the duration of the drag. */
    private resolveDrop(drag: DragSession, x: number, y: number): Drop | null {
        const pass = this.pass;
        if (!pass) return null;
        // The new-pane bands win: they are deliberately thin and sit between the blocks, so
        // testing them first keeps them reachable.
        if (drag.kind === 'indicator') {
            for (const gap of this.body.querySelectorAll<HTMLElement>('.vela-ot-gap')) {
                const r = gap.getBoundingClientRect();
                if (y >= r.top - 4 && y <= r.bottom + 4 && x >= r.left && x <= r.right) {
                    return { kind: 'newPane', before: gap.dataset.before, after: gap.dataset.after, el: gap };
                }
            }
        }
        for (const block of this.body.querySelectorAll<HTMLElement>('.vela-ot-pane')) {
            const r = block.getBoundingClientRect();
            if (y < r.top || y > r.bottom) continue;
            const paneId = block.dataset.pane ?? PRICE_PANE_ID;
            // The candles never leave the main pane; an indicator on a renderer without editable
            // stacking can only join a pane whole.
            if (drag.kind === 'price' && block.dataset.kind !== 'price') return null;
            if (drag.kind === 'indicator' && !pass.stackable) {
                return paneId === drag.fromPane ? null : { kind: 'merge', paneId, el: block };
            }
            const els = [...(block.querySelector<HTMLElement>(':scope > .vela-ot-stack')?.children ?? [])] as HTMLElement[];
            // A lone drawing held over a group's block joins that group — anywhere else in the
            // column it stays (or becomes) loose. A whole group held over ANOTHER group's
            // header nests inside it; over the rest of the block it drops at the top level.
            if (drag.kind === 'drawing' || drag.kind === 'group') {
                for (const unit of els) {
                    const groupId = unit.dataset.group;
                    if (groupId === undefined) continue;
                    const ur = unit.getBoundingClientRect();
                    if (y < ur.top || y > ur.bottom) continue;
                    const header = unit.querySelector<HTMLElement>(':scope > .vela-ot-row[data-row-kind="group"]');
                    const onHeader = header !== null && y <= header.getBoundingClientRect().bottom;
                    if (drag.kind === 'group') {
                        // Never into itself or its own subtree — that would cut the branch loose.
                        if (onHeader && drag.id !== null && drag.id !== groupId && !groupWithin(this.groups, groupId, drag.id)) {
                            return { kind: 'nest', paneId, groupId, el: unit };
                        }
                        break;
                    }
                    const rows = [...unit.querySelectorAll<HTMLElement>('.vela-ot-row[data-id]')];
                    const at = this.groupDropIndex(pass, paneId, groupId, rows, y);
                    return { kind: 'intoGroup', paneId, groupId, at, y, rows, el: unit };
                }
            }
            let slot = insertionSlot(els, y);
            // Without a shared draw-order space every drawing paints over the series, so its
            // slots stop at the leading drawings — the column can't promise an interleave the
            // renderer won't honor.
            if ((drag.kind === 'drawing' || drag.kind === 'group') && !pass.interleave) {
                const pane = pass.panes.find((p) => p.id === paneId);
                const lead = pane ? pane.items.findIndex((it) => it.kind === 'row') : -1;
                if (lead >= 0) slot = Math.min(slot, lead);
            }
            return { kind: 'slot', paneId, slot, els, el: block };
        }
        return null;
    }

    /**
     * Where a drop INSIDE a group lands in the pane's token stack. The rendered rows are the
     * truth (they include nested group headers); each row maps back to the token index of the
     * drawing it stands for — a nested group maps to its own front-most drawing.
     */
    private groupDropIndex(pass: Pass, paneId: string, groupId: string, rows: readonly HTMLElement[], y: number): number {
        const pane = pass.panes.find((p) => p.id === paneId);
        if (!pane) return 0;
        const tokens = paneTokens(pane);
        const tokenIndexes = (ids: ReadonlySet<string>): number[] =>
            tokens.flatMap((t, i) => (t.kind === 'drawing' && ids.has(t.id) ? [i] : []));
        const mine = tokenIndexes(new Set(groupDrawingIds(this.groups, groupId)));
        const start = mine.length > 0 ? Math.min(...mine) : tokens.length;
        for (const row of rows) {
            const r = row.getBoundingClientRect();
            if (y >= r.top + r.height / 2) continue;
            const rowId = row.dataset.id ?? '';
            if (row.dataset.rowKind === 'drawing') {
                const at = tokens.findIndex((t) => t.kind === 'drawing' && t.id === rowId);
                return at >= 0 ? at : start;
            }
            if (row.dataset.rowKind === 'group') {
                const sub = tokenIndexes(new Set(groupDrawingIds(this.groups, rowId)));
                return sub.length > 0 ? Math.min(...sub) : start;
            }
        }
        return mine.length > 0 ? Math.max(...mine) + 1 : start;
    }

    private paintDropHint(drop: Drop | null): void {
        for (const el of this.body.querySelectorAll<HTMLElement>('[data-drop]')) delete el.dataset.drop;
        if (!drop) return;
        if (drop.kind === 'newPane') {
            drop.el.dataset.drop = 'gap';
            return;
        }
        if (drop.kind === 'merge') {
            drop.el.dataset.drop = 'target';
            return;
        }
        if (drop.kind === 'nest') {
            // Nesting reads differently from joining: the header itself lights up.
            drop.el.dataset.drop = 'nest';
            return;
        }
        if (drop.kind === 'intoGroup') {
            // The group outlines to say "this is what you are joining", and a line inside says
            // where among its members — nested group headers included.
            drop.el.dataset.drop = 'target';
            const at = drop.rows[insertionSlot(drop.rows, drop.y)];
            if (at) at.dataset.drop = 'before';
            else if (drop.rows.length > 0) drop.rows[drop.rows.length - 1]!.dataset.drop = 'after';
            return;
        }
        // A slot drop draws a line at the insertion point — or outlines the whole block when
        // there is nothing to draw a line against.
        const at = drop.els[drop.slot];
        if (drop.els.length === 0) drop.el.dataset.drop = 'target';
        else if (at) at.dataset.drop = 'before';
        else drop.els[drop.els.length - 1]!.dataset.drop = 'after';
    }

    /** Close the session out: `apply` false abandons the move (a cancelled pointer, a teardown). */
    private endDrag(apply: boolean): void {
        const drag = this.drag;
        this.drag = null;
        this.releaseTouchDrag();
        if (!drag) return;
        const win = this.el.ownerDocument.defaultView;
        win?.removeEventListener('pointermove', drag.onMove);
        win?.removeEventListener('pointerup', drag.onUp);
        win?.removeEventListener('pointercancel', drag.onCancel);
        // A press that never crossed the threshold is a plain click. Leave the DOM as it is so
        // the click that follows still lands on its row — re-rendering here would detach it and
        // silently swallow selecting a drawing.
        if (!drag.active) return;
        drag.ghost?.remove();
        delete this.body.dataset.dragging;
        const src = this.sourceRow(drag);
        if (src) delete src.dataset.source;
        this.paintDropHint(null);
        if (apply && drag.drop) this.applyDrop(drag, drag.drop);
        this.refresh();
    }

    private applyDrop(drag: DragSession, drop: Drop): void {
        const pass = this.pass;
        if (!pass) return;
        const { chart } = pass;
        switch (drop.kind) {
            case 'merge':
                if (drag.id !== null && drop.paneId !== drag.fromPane) {
                    chart.panes.moveIndicator(drag.id, drop.paneId === PRICE_PANE_ID ? 'price' : { pane: drop.paneId });
                }
                return;
            case 'newPane': {
                // An indicator alone in its own pane, dropped on a band touching that pane, has
                // nowhere new to go: the "new" pane would be the one it is already in, rebuilt.
                const from = pass.panes.find((p) => p.id === drag.fromPane);
                const alone = from !== undefined && from.kind !== 'price' && paneRows(from).length <= 1;
                if (alone && (drop.before === drag.fromPane || drop.after === drag.fromPane)) return;
                if (drag.id !== null) chart.panes.moveIndicator(drag.id, { newPane: { before: drop.before, after: drop.after } });
                return;
            }
            case 'nest':
                if (drag.id !== null && drag.id !== drop.groupId) {
                    this.groups = setGroupParent(this.groups, drag.id, drop.groupId);
                    this.refresh();
                }
                return;
            case 'slot':
            case 'intoGroup':
                this.applySlotDrop(pass, drag, drop);
                return;
        }
    }

    /**
     * Land a drop in a pane's stack: place the dragged tokens (the candles, an indicator, a
     * drawing, or a group's whole run of drawings) at the measured position, then renormalize
     * the pane's z keys in one sweep — `candleZOrder`/`seriesOrder` for the series, a single
     * `updateMany` (one undo step) for the drawings, re-paning the ones that crossed panes.
     */
    private applySlotDrop(pass: Pass, drag: DragSession, drop: Extract<Drop, { kind: 'slot' | 'intoGroup' }>): void {
        const { chart } = pass;
        const target = pass.panes.find((p) => p.id === drop.paneId);
        if (!target) return;
        const isDrawing = drag.kind === 'drawing' || drag.kind === 'group';
        if (isDrawing && !chart.drawings.supported) return;
        const dragged: StackToken[] =
            drag.kind === 'price'
                ? [{ kind: 'price' }]
                : drag.kind === 'indicator'
                  ? [{ kind: 'indicator', id: drag.id! }]
                  : this.draggedDrawings(pass, drag).map((id) => ({ kind: 'drawing' as const, id }));
        if (dragged.length === 0 || (drag.kind !== 'price' && drag.id === null)) return;
        // An indicator arriving from another pane moves there first; the restack below then
        // assigns its slot. (Drawings re-pane through their own patch instead.)
        if (drag.kind === 'indicator' && drag.fromPane !== drop.paneId) {
            chart.panes.moveIndicator(drag.id!, drop.paneId === PRICE_PANE_ID ? 'price' : { pane: drop.paneId });
        }
        const tokens = paneTokens(target);
        const at = drop.kind === 'intoGroup' ? drop.at : tokenIndexOfSlot(target, drop.slot);
        const placed = placeTokens(tokens, dragged, at);
        // Group bookkeeping for a lone drawing: dropped on a group it joins it; dropped at the
        // top level it leaves whatever group held it.
        if (drag.kind === 'drawing') {
            this.groups = drop.kind === 'intoGroup' ? assignToGroup(this.groups, drop.groupId, [drag.id!]) : removeFromGroups(this.groups, [drag.id!]);
        }
        const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
        const draggedIds = new Set(dragged.flatMap((t) => (t.kind === 'drawing' ? [t.id] : [])));
        const repaned = [...draggedIds].some((id) => live.get(id)?.paneId !== drop.paneId);
        // A drag that changes nothing should not cost an undo step — its only effect may have
        // been the group membership just recorded.
        if (tokensEqual(tokens, placed) && !repaned) return;
        this.writeStack(pass, drop.paneId, placed, draggedIds);
    }

    /** Renormalize one pane's z keys from a placed token stack: the series through the
     *  renderer's order settings, the drawings as ONE `updateMany` (a single undo step),
     *  re-paning the dragged ones that arrived from another pane. */
    private writeStack(pass: Pass, paneId: string, placed: readonly StackToken[], draggedIds: ReadonlySet<string>): void {
        const { chart } = pass;
        const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
        const writes = stackWrites(placed, pass.interleave);
        const wasRestacking = this.restacking;
        this.restacking = true;
        const mutate = (): void => {
            if (pass.stackable) {
                if (writes.candleZ !== null) chart.renderer.set('candleZOrder', writes.candleZ);
                for (const s of writes.series) chart.renderer.set('seriesOrder', { id: s.id, z: s.z });
            }
            if (writes.drawings.length > 0) {
                chart.drawings.updateMany(
                    writes.drawings.map(({ id, z }) => ({
                        id,
                        patch: { zIndex: z, ...(draggedIds.has(id) && live.get(id)?.paneId !== paneId ? { paneId } : {}) },
                    })),
                );
            }
        };
        try {
            // The host owns the single undo entry for the WHOLE stack (renderer z keys
            // plus every drawing); the core's drawing delegate must not add N more.
            if (this.opts.historyTransaction) this.opts.historyTransaction(mutate);
            else mutate();
        } finally {
            this.restacking = wasRestacking;
        }
        // `renderer.set` has no chart event: without this seam a candle/indicator order
        // change would neither dirty the layout nor survive an autosave/refresh.
        this.opts.onStackChanged?.();
    }

    /** One shared Visual Order path for candles, indicators, drawings, groups and bulk
     *  selections. The token list is front-first, matching the rows the user just saw. */
    private restackTokens(pass: Pass, paneId: string, dragged: readonly StackToken[], move: VisualOrderMove, notify = true): boolean {
        const target = pass.panes.find((p) => p.id === paneId) ?? pass.panes.find((p) => p.kind === 'price');
        if (!target) return false;
        const tokens = paneTokens(target);
        const placed = reorderTokens(tokens, dragged, move);
        if (tokensEqual(tokens, placed)) return false;
        const ids = new Set(dragged.flatMap((t) => (t.kind === 'drawing' ? [t.id] : [])));
        this.writeStack(pass, target.id, placed, ids);
        if (notify) this.refresh();
        return true;
    }

    /** The currently picked tokens, pane by pane, front-first. A group contributes every
     *  member as one contiguous run; indicators are included only when this renderer can
     *  actually restack them. */
    private selectedStackTokens(pass: Pass): Map<string, StackToken[]> {
        const drawingIds = new Set(this.picked);
        for (const id of this.groupPicks) for (const member of groupDrawingIds(this.groups, id)) drawingIds.add(member);
        const indicatorIds = new Set(this.selInd);
        const out = new Map<string, StackToken[]>();
        for (const pane of pass.panes) {
            const selected = paneTokens(pane).filter(
                (t) =>
                    (t.kind === 'drawing' && drawingIds.has(t.id)) ||
                    (t.kind === 'indicator' && pass.stackable && indicatorIds.has(t.id)),
            );
            if (selected.length > 0) out.set(pane.id, selected);
        }
        return out;
    }

    /** Move a multi-pick as one block in each pane it occupies. */
    private restackSelection(pass: Pass, move: VisualOrderMove): void {
        const byPane = this.selectedStackTokens(pass);
        if (byPane.size === 0) return;
        let changed = false;
        for (const [paneId, dragged] of byPane) changed = this.restackTokens(pass, paneId, dragged, move, false) || changed;
        if (changed) this.refresh();
    }

    /** Move a group's whole run — including nested members — as one contiguous z block. */
    private restackGroup(pass: Pass, g: DrawGroup, move: VisualOrderMove): void {
        const member = new Set(groupDrawingIds(this.groups, g.id));
        const mine = pass.chart.drawings.all().filter((d) => member.has(d.id));
        if (mine.length === 0) return;
        const paneId = mine[0]!.paneId ?? PRICE_PANE_ID;
        const dragged: StackToken[] = mine.map((d) => ({ kind: 'drawing' as const, id: d.id }));
        this.restackTokens(pass, paneId, dragged, move);
    }

    /** TradingView's four Visual Order verbs, shared by every kind of row. */
    private visualOrderItems(b: MenuBuilder, move: (m: VisualOrderMove) => void, all = false): MenuItemDescriptor[] {
        const q = all ? 'all ' : '';
        return [
            b.entry(`Bring ${q}to front`, 'arrow-up', () => move('front'), true),
            b.entry(`Bring ${q}forward`, 'chevron-up', () => move('forward')),
            b.entry(`Send ${q}backward`, 'chevron-down', () => move('backward')),
            b.entry(`Send ${q}to back`, 'arrow-down', () => move('back')),
        ];
    }

    /** The drawings a session moves: a group carries every member, front-most first, so the
     *  bundle keeps its own stacking wherever it lands. */
    private draggedDrawings(pass: Pass, drag: DragSession): string[] {
        if (drag.id === null) return [];
        if (drag.kind !== 'group') return [drag.id];
        const g = this.groups.find((x) => x.id === drag.id);
        if (!g) return [];
        const member = new Set(groupDrawingIds(this.groups, g.id));
        // `all()` reports paint order (back to front); everything here works front-first.
        return pass.chart.drawings
            .all()
            .filter((d) => member.has(d.id))
            .map((d) => d.id)
            .reverse();
    }

    // ── context menus ──────────────────────────────────────────────────────
    // Right-clicking a row opens the same actions its buttons expose, plus the ones with no
    // room on a row: re-paning an indicator, and reordering what draws in front.

    private onContextMenu(e: MouseEvent): void {
        const pass = this.pass;
        if (!pass) return;
        const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.vela-ot-row');
        if (!rowEl) return;
        e.preventDefault();
        const b = new MenuBuilder();
        const items = this.itemsForRow(b, pass, rowEl);
        if (items.length === 0) return;
        this.menuActions = b.actions;
        const menu = this.ensureMenu();
        menu.setItems(items);
        menu.openAt(e.clientX, e.clientY);
    }

    /** The multi-pick's verbs, wherever they are invoked from (bar, right-click). */
    private bulkMenu(b: MenuBuilder, pass: Pass): MenuItemDescriptor[] {
        const total = this.selCount;
        const { chart } = pass;
        const drawings = chart.drawings.supported ? chart.drawings.all() : [];
        const ids = [...this.picked];
        const inds = [...this.selInd];
        const anyVisible =
            inds.some((id) => pass.handle(id)?.visible !== false) ||
            ids.some((id) => drawings.find((d) => d.id === id)?.visible !== false);
        const items = [
            b.entry(anyVisible ? `Hide ${total}` : `Show ${total}`, anyVisible ? 'eye-off' : 'eye', () =>
                this.applyBulk(anyVisible ? 'hide' : 'show'),
            ),
        ];
        const pickedGroups = [...this.groupPicks];
        if ((ids.length > 0 || pickedGroups.length > 0) && canGroup(ids, this.groups)) {
            items.push(
                b.entry(
                    ids.length + pickedGroups.length === 1 ? 'Create a group' : `Group these ${ids.length + pickedGroups.length} items`,
                    'group',
                    () => this.makeGroup(ids, pickedGroups, undefined),
                ),
            );
        }
        // A multi-select has the SAME visual-order verbs as one row; the picked objects
        // travel as one block in each pane. TradingView's updated object tree does this
        // for several drawings at once.
        if ((ids.length > 0 || pickedGroups.length > 0 || inds.length > 0) && (pass.stackable || ids.length > 0 || pickedGroups.length > 0)) {
            items.push(...this.visualOrderItems(b, (move) => this.restackSelection(pass, move)));
        }
        items.push(b.entry('Clear selection', 'close', () => this.clearSelection(), true));
        const setMenu = this.drawingSetSubmenu(b, ids);
        if (setMenu) items.push(setMenu);
        items.push(b.entry(`Remove ${total}`, 'trash', () => this.applyBulk('remove')));
        return items;
    }

    private itemsForRow(b: MenuBuilder, pass: Pass, rowEl: HTMLElement): MenuItemDescriptor[] {
        const paneId = rowEl.dataset.pane ?? PRICE_PANE_ID;
        const id = rowEl.dataset.id;
        // Right-clicking inside a multi-pick acts on the PICK, not on the one row under the
        // pointer — "Remove 4" rather than a surprise single removal.
        const kind = rowEl.dataset.rowKind ?? '';
        if (this.bulk && id !== undefined && this.setFor(kind).has(id)) return this.bulkMenu(b, pass);
        switch (rowEl.dataset.rowKind) {
            case 'price':
                return this.priceMenu(b, pass);
            case 'indicator': {
                const row = id === undefined ? undefined : this.findIndicatorRow(pass, id);
                return row ? this.indicatorMenu(b, pass, row, paneId) : [];
            }
            case 'drawing': {
                const d = id === undefined ? undefined : pass.chart.drawings.all().find((x) => x.id === id);
                return d ? this.drawingMenu(b, pass, d) : [];
            }
            case 'group': {
                const g = id === undefined ? undefined : this.groups.find((x) => x.id === id);
                return g ? this.groupMenu(b, pass, g) : [];
            }
            default:
                return [];
        }
    }

    /** The nearest kit host, which is where anything floating has to mount: outside it the
     *  theme's custom properties don't resolve and the surface renders unstyled. */
    private uiHost(): HTMLElement {
        return (this.el.closest('.vela-ui') as HTMLElement | null) ?? this.el;
    }

    // ── manage layout drawings ─────────────────────────────────────────────
    // The tree speaks for ONE chart. A layout with several charts needs the other view
    // TradingView offers: every drawing on every chart, in one list, where a drawing can be
    // shown, hidden, locked or removed without first switching which chart is active.

    private layoutDrawingsBody: HTMLElement | null = null;

    /** Open the Manage objects dialog: default scope + one row per object/group member. */
    private openManageObjects(ids: readonly string[] = []): void {
        const sync = this.opts.drawingSync;
        if (!sync) return;
        this.manageObjectsIds = [...ids];
        const host = this.uiHost();
        if (this.manageObjectsDialog === null) {
            this.manageObjectsDialog = new Dialog({
                title: 'Manage objects',
                host,
                closeOnInteractOutside: true,
                content: (body) => {
                    body.classList.add('vela-ot-mo');
                    this.manageObjectsBody = body;
                },
            });
        }
        this.renderManageObjects();
        this.manageObjectsDialog.show();
    }

    private renderManageObjects(): void {
        const body = this.manageObjectsBody;
        const sync = this.opts.drawingSync;
        if (!body || !sync) return;
        const doc = body.ownerDocument;
        const charts = sync.charts();
        const targets = charts.filter((c) => !c.active);
        const rows = sync.rows().filter((r) => this.manageObjectsIds.length === 0 || this.manageObjectsIds.includes(r.id));
        body.replaceChildren();

        const title = doc.createElement('div');
        title.className = 'vela-ot-mo-title';
        title.textContent = 'New objects';
        body.appendChild(title);
        const segment = doc.createElement('div');
        segment.className = 'vela-ot-mo-segment';
        const defaults: Array<{ id: 'none' | 'layout' | 'global'; label: string }> = [
            { id: 'none', label: 'Not synced' },
            { id: 'layout', label: 'Synced in layout' },
            { id: 'global', label: 'Synced globally' },
        ];
        const activeDefault = sync.defaultMode();
        for (const item of defaults) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.textContent = item.label;
            if (activeDefault === item.id) btn.dataset.on = '1';
            btn.addEventListener('click', () => {
                sync.setDefaultMode(item.id);
                this.renderManageObjects();
            });
            segment.appendChild(btn);
        }
        body.appendChild(segment);

        const listTitle = doc.createElement('div');
        listTitle.className = 'vela-ot-mo-title';
        listTitle.textContent = this.manageObjectsIds.length > 0 ? `Selected objects (${rows.length})` : `Objects (${rows.length})`;
        body.appendChild(listTitle);
        if (rows.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ot-mo-empty';
            empty.textContent = 'No drawings to manage';
            body.appendChild(empty);
        }
        for (const row of rows) {
            const wrap = doc.createElement('div');
            wrap.className = 'vela-ot-mo-row';
            const label = doc.createElement('div');
            label.className = 'vela-ot-mo-label';
            label.textContent = row.label;
            const select = doc.createElement('select');
            select.setAttribute('aria-label', `Sync mode for ${row.label}`);
            const modes: Array<{ id: 'none' | 'layout' | 'global' | 'charts'; label: string }> = [
                { id: 'none', label: 'Not synced' },
                { id: 'layout', label: 'Synced in layout' },
                { id: 'global', label: 'Synced globally' },
                { id: 'charts', label: 'Sync to specific charts' },
            ];
            for (const mode of modes) {
                const option = doc.createElement('option');
                option.value = mode.id;
                option.textContent = mode.label;
                if (row.mode === mode.id) option.selected = true;
                select.appendChild(option);
            }
            select.addEventListener('change', () => {
                const mode = select.value as 'none' | 'layout' | 'global' | 'charts';
                if (mode === 'charts') {
                    const first = targets[0]?.id;
                    sync.setMode([row.id], 'charts', row.charts.length > 0 ? row.charts : first ? [first] : []);
                } else {
                    sync.setMode([row.id], mode);
                }
                this.renderManageObjects();
            });
            wrap.append(label, select);
            if (row.mode === 'charts') {
                const box = doc.createElement('div');
                box.className = 'vela-ot-mo-targets';
                for (const target of targets) {
                    const chip = doc.createElement('label');
                    const input = doc.createElement('input');
                    input.type = 'checkbox';
                    input.checked = row.charts.includes(target.id);
                    input.addEventListener('change', () => {
                        const chosen = [...box.querySelectorAll<HTMLInputElement>('input:checked')].map((el) => el.dataset.chartId ?? '').filter(Boolean);
                        sync.setMode([row.id], 'charts', chosen);
                        this.renderManageObjects();
                    });
                    input.dataset.chartId = target.id;
                    const text = doc.createElement('span');
                    text.textContent = target.label;
                    chip.append(input, text);
                    box.appendChild(chip);
                }
                wrap.appendChild(box);
            }
            body.appendChild(wrap);
        }

        const actions = doc.createElement('div');
        actions.className = 'vela-ot-mo-actions';
        const close = doc.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', () => this.manageObjectsDialog?.hide());
        const apply = doc.createElement('button');
        apply.type = 'button';
        apply.dataset.primary = '1';
        apply.textContent = 'Apply sync now';
        apply.addEventListener('click', () => {
            const changed = sync.apply(rows.map((r) => r.id));
            this.renderManageObjects();
            if (changed === 0) apply.textContent = 'Already up to date';
            else apply.textContent = `Synced ${changed} chart${changed === 1 ? '' : 's'}`;
        });
        actions.append(close, apply);
        body.appendChild(actions);
    }



    /** Open (building once) the layout-wide drawing manager. */
    private openLayoutDrawings(): void {
        const charts = this.opts.layout?.() ?? [];
        if (charts.length === 0) return;
        const host = this.uiHost();
        if (this.layoutDrawingsDialog === null) {
            this.layoutDrawingsDialog = new Dialog({
                title: 'Manage layout drawings',
                host,
                closeOnInteractOutside: true,
                content: (body) => {
                    body.classList.add('vela-ot-lg');
                    this.layoutDrawingsBody = body;
                },
            });
        }
        this.renderLayoutDrawings();
        this.layoutDrawingsDialog.show();
    }

    /** Paint the manager: one section per chart, one row per drawing. */
    private renderLayoutDrawings(): void {
        const body = this.layoutDrawingsBody;
        if (!body) return;
        const doc = body.ownerDocument;
        const charts = this.opts.layout?.() ?? [];
        body.replaceChildren();
        let total = 0;
        for (const { label, chart } of charts) {
            const drawings = chart?.drawings?.supported ? chart.drawings.all() : [];
            total += drawings.length;
            const head = doc.createElement('div');
            head.className = 'vela-ot-lg-head';
            const name = doc.createElement('span');
            name.className = 'vela-ot-lg-name';
            name.textContent = label;
            const count = doc.createElement('span');
            count.className = 'vela-ot-lg-count';
            count.textContent = `${drawings.length} drawing${drawings.length === 1 ? '' : 's'}`;
            head.append(name, count);
            body.appendChild(head);
            if (drawings.length === 0) {
                const empty = doc.createElement('div');
                empty.className = 'vela-ot-lg-empty';
                empty.textContent = 'No drawings';
                body.appendChild(empty);
                continue;
            }
            // Front-most first, the same reading order the tree uses.
            for (const d of drawings.slice().reverse()) {
                const row = doc.createElement('div');
                row.className = 'vela-ot-lg-row';
                if (d.visible === false) row.dataset.hidden = '1';
                const icon = doc.createElement('span');
                icon.className = 'vela-icon';
                const markup = drawingMeta(d.type).icon;
                if (markup) icon.innerHTML = markup;
                else icon.appendChild(iconEl('pen', doc));
                const text = doc.createElement('span');
                text.className = 'vela-ot-lg-label';
                text.textContent = drawingLabel(d);
                row.append(icon, text);
                const act = (iconName: string, title: string, run: () => void, engaged = false): void => {
                    const b = this.btn({ icon: iconName, title, run, engaged });
                    b.classList.add('vela-ot-lg-btn');
                    row.appendChild(b);
                };
                act(d.visible === false ? 'eye-off' : 'eye', d.visible === false ? 'Show' : 'Hide', () => {
                    chart.drawings.show(d.id, d.visible === false);
                    this.renderLayoutDrawings();
                    this.refresh();
                }, d.visible === false);
                act(d.locked ? 'lock' : 'unlock', d.locked ? 'Unlock' : 'Lock', () => {
                    chart.drawings.lock(d.id, !d.locked);
                    this.renderLayoutDrawings();
                }, d.locked === true);
                act('trash', 'Remove', () => {
                    chart.drawings.remove(d.id);
                    this.renderLayoutDrawings();
                    this.refresh();
                });
                body.appendChild(row);
            }
        }
        if (total === 0) {
            const none = doc.createElement('div');
            none.className = 'vela-ot-lg-none';
            none.textContent = 'No drawings anywhere in this layout';
            body.appendChild(none);
        }
    }

    /** The menu, built on first use — by then the panel is mounted, so the theme host resolves. */
    private ensureMenu(): Menu {
        if (!this.menu) {
            this.menu = new Menu({ host: this.uiHost(), items: [], onSelect: (id) => this.menuActions.get(id)?.() });
        }
        return this.menu;
    }

    private findIndicatorRow(pass: Pass, id: string): IndicatorRow | undefined {
        for (const pane of pass.panes) {
            for (const row of paneRows(pane)) if (row.kind === 'indicator' && row.id === id) return row;
        }
        return undefined;
    }

    private priceMenu(b: MenuBuilder, pass: Pass): MenuItemDescriptor[] {
        const { chart } = pass;
        const visible = chart.renderer.get('candleVisible') !== false;
        const items = [
            b.entry(visible ? 'Hide' : 'Show', visible ? 'eye-off' : 'eye', () => {
                chart.renderer.set('candleVisible', !visible);
                this.opts.onStackChanged?.(); // runtime view flag: persist + history
                this.refresh();
            }),
        ];
        if (pass.stackable) {
            items.push(...this.visualOrderItems(b, (move) => this.restackTokens(pass, PRICE_PANE_ID, [{ kind: 'price' }], move)));
        }
        // The price row is the ONLY row on a fresh chart — an inserted template must be
        // reachable before the user has drawn anything at all.
        const setMenu = this.drawingSetSubmenu(b, []);
        if (setMenu) items.push(setMenu);
        return items;
    }

    private indicatorMenu(b: MenuBuilder, pass: Pass, row: IndicatorRow, paneId: string): MenuItemDescriptor[] {
        const { chart } = pass;
        const handle = pass.handle(row.id);
        const items = [
            b.entry(row.visible ? 'Hide' : 'Show', row.visible ? 'eye-off' : 'eye', () => {
                handle?.setVisible(!row.visible);
                this.refresh();
            }),
        ];
        // The legend gear's twin — reachable here even where the legend is folded away
        // (mobile) or replaced by the overview chip (multi-chart grids).
        if (chart.renderer.supportsIndicatorSettings) {
            items.push(b.entry('Indicator settings', 'gear', () => chart.renderer.openIndicatorSettings(row.id)));
        }
        // The legend's `{ }` chip, reachable from the tree — on a phone the legend is folded
        // away entirely, and the tree is where a study is managed.
        const source = handle?.source;
        if (source !== undefined && this.opts.onSource) {
            const readOnly = handle?.nativeType !== undefined;
            items.push(
                b.entry(readOnly ? 'Source code (built-in)' : 'Source code', 'braces', () => {
                    this.opts.onSource?.(source, handle?.title ?? row.label, readOnly);
                }, true),
            );
        }
        if (chart.panes.supported) {
            const moves = this.moveItems(b, pass, row.id, paneId);
            if (moves.length > 0) items.push(b.submenu('Move to', 'move-vertical', moves));
        }
        if (pass.stackable) {
            items.push(...this.visualOrderItems(b, (move) => this.restackTokens(pass, paneId, [{ kind: 'indicator', id: row.id }], move)));
        }
        items.push(
            b.entry('Remove', 'trash', () => {
                handle?.remove();
                this.refresh();
            }, true),
        );
        return items;
    }

    /** "Move to …" entries for an indicator — only the moves that would change something. */
    private moveItems(b: MenuBuilder, pass: Pass, id: string, fromPane: string): MenuItemDescriptor[] {
        const { chart } = pass;
        const items: MenuItemDescriptor[] = [];
        for (const p of pass.panes) {
            if (p.id === fromPane) continue;
            items.push(b.entry(p.label, undefined, () => chart.panes.moveIndicator(id, p.kind === 'price' ? 'price' : { pane: p.id })));
        }
        // An indicator alone in its own study pane has nowhere new to go: a fresh pane would
        // just be the pane it already has.
        const current = pass.panes.find((p) => p.id === fromPane);
        const alone = current !== undefined && current.kind !== 'price' && paneRows(current).length <= 1;
        if (!alone) {
            if (fromPane !== PRICE_PANE_ID) items.push(b.entry('New pane above', undefined, () => chart.panes.moveIndicator(id, { newPane: { before: fromPane } })));
            items.push(b.entry('New pane below', undefined, () => chart.panes.moveIndicator(id, { newPane: { after: fromPane } })));
        }
        return items;
    }

    /** Group the drawings a template just inserted, so the bundle is ONE object in the
     *  tree (TradingView's group semantics) and stays selected for an immediate drag. */
    groupInsertedDrawings(name: string, ids: readonly string[]): void {
        if (!this.chart || ids.length === 0) return;
        this.groupSeq += 1;
        const id = `grp-${this.groupSeq}`;
        this.groups = [...this.groups, { id, name: `${name} set`, ids: [...ids] }];
        this.picked = new Set(ids);
        this.selInd.clear();
        this.groupPicks.clear();
        this.bulk = ids.length > 1;
        this.selectOnChart(ids);
        this.render();
    }

    /** The tree's drawing-template submenu — SAVE the pick, INSERT a saved set. */
    private drawingSetSubmenu(b: MenuBuilder, ids: readonly string[], suggested?: string): MenuItemDescriptor | null {
        const sets = this.opts.drawingSets;
        if (!sets) return null;
        const rows = sets.list();
        const inner: MenuItemDescriptor[] = [];
        if (ids.length > 0) {
            inner.push(b.entry(ids.length === 1 ? 'Save as template…' : `Save ${ids.length} drawings as template…`, 'plus', () => this.askSetName(ids, suggested)));
        }
        if (rows.length > 0) {
            inner.push(
                b.submenu(
                    'Insert template',
                    'folder-plus',
                    rows.map((r) => b.entry(`${r.name} · ${r.count} drawing${r.count === 1 ? '' : 's'}`, 'templates', () => {
                        sets.insert(r.name);
                        this.render();
                    })),
                    ids.length > 0,
                ),
            );
        }
        if (inner.length === 0) return null;
        return b.submenu('Drawing templates', 'templates', inner, true);
    }

    /** A one-field dialog — naming a set must not cost a whole settings page. */
    private askSetName(ids: readonly string[], suggested?: string): void {
        const sets = this.opts.drawingSets;
        if (!sets || ids.length === 0) return;
        this.setNameIds = [...ids];
        const doc = this.uiHost().ownerDocument;
        if (this.setNameDialog === null) {
            const form = doc.createElement('div');
            form.className = 'vela-ot-setform';
            const label = doc.createElement('label');
            label.textContent = 'Template name';
            const input = doc.createElement('input');
            input.type = 'text';
            input.maxLength = 40;
            input.placeholder = 'e.g. Breakout + Fib';
            input.setAttribute('aria-label', 'Drawing template name');
            const row = doc.createElement('div');
            row.className = 'vela-ot-setrow';
            const cancel = doc.createElement('button');
            cancel.type = 'button';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', () => this.setNameDialog?.hide());
            const save = doc.createElement('button');
            save.type = 'button';
            save.textContent = 'Save';
            save.dataset.primary = '1';
            const commit = (): void => {
                const name = input.value.trim();
                if (!name) { input.focus(); return; }
                if (sets.save(name, this.setNameIds)) this.setNameDialog?.hide();
            };
            save.addEventListener('click', commit);
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') this.setNameDialog?.hide();
            });
            row.append(cancel, save);
            label.append(input);
            form.append(label, row);
            this.setNameInput = input;
            this.setNameDialog = new Dialog({
                title: 'Save drawing template',
                host: this.uiHost(),
                closeOnInteractOutside: true,
                content: (body) => body.append(form),
            });
        }
        if (this.setNameInput) this.setNameInput.value = suggested || `Drawing set ${sets.list().length + 1}`;
        this.setNameDialog.show();
        queueMicrotask(() => { this.setNameInput?.focus(); this.setNameInput?.select(); });
    }

    private drawingMenu(b: MenuBuilder, pass: Pass, d: SerializedDrawing): MenuItemDescriptor[] {
        const { chart } = pass;
        const items = [
            b.entry(d.visible ? 'Hide' : 'Show', d.visible ? 'eye-off' : 'eye', () => {
                chart.drawings.show(d.id, !d.visible);
                this.refresh();
            }),
            b.entry(d.locked ? 'Unlock' : 'Lock', d.locked ? 'unlock' : 'lock', () => {
                chart.drawings.lock(d.id, !d.locked);
                this.refresh();
            }),
            b.entry('Duplicate', 'clone', () => {
                this.cloneInto(pass, d.id);
                this.render();
            }),
            // The unified stack writer clears the WHOLE stack on a shared-z renderer —
            // over/under candles and indicators — and refreshes the tree immediately.
            ...this.visualOrderItems(b, (move) => this.restackTokens(pass, d.paneId, [{ kind: 'drawing', id: d.id }], move)),
        ];
        items.push(...this.groupingItems(b, d.id));
        const pick = this.picked.has(d.id) && this.picked.size > 1 ? [...this.picked] : [d.id];
        const setMenu = this.drawingSetSubmenu(b, pick);
        if (setMenu) items.push(setMenu);
        items.push(...this.syncSubmenu(b, pick));
        items.push(b.entry('Remove', 'trash', () => chart.drawings.remove(d.id), true));
        return items;
    }

    /** TradingView's three sync scopes, plus per-chart targets, for ONE object or a group. */
    private syncSubmenu(b: MenuBuilder, ids: readonly string[]): MenuItemDescriptor[] {
        const sync = this.opts.drawingSync;
        if (!sync || ids.length === 0) return [];
        const charts = sync.charts().filter((c) => !c.active);
        const current = sync.mode(ids[0]!);
        const items: MenuItemDescriptor[] = [
            b.entry(current === 'none' ? '✓ Not synced' : 'Not synced', 'close', () => sync.setMode(ids, 'none')),
            b.entry(current === 'layout' ? '✓ Synced in layout' : 'Synced in layout', 'layout', () => sync.setMode(ids, 'layout')),
            b.entry(current === 'global' ? '✓ Synced globally' : 'Synced globally', 'link', () => sync.setMode(ids, 'global')),
        ];
        if (charts.length > 0) {
            items.push(b.submenu(
                current === 'charts' ? '✓ Sync to specific charts' : 'Sync to specific charts',
                'link',
                charts.map((c) => b.entry(c.label, undefined, () => sync.setMode(ids, 'charts', [c.id]))),
                true,
            ));
        }
        items.push(b.entry('Apply sync now', 'undo', () => sync.apply(ids), true));
        return [b.submenu('Sync objects', 'link', items, true)];
    }

    /** The grouping half of a drawing's menu: what it can do about the bundle it is (or isn't)
     *  part of. Only the moves that mean something for this row are offered. */
    private groupingItems(b: MenuBuilder, id: string): MenuItemDescriptor[] {
        const items: MenuItemDescriptor[] = [];
        const mine = groupOf(this.groups, id);
        // A right-click inside a multi-pick acts on the whole pick; on a row outside it, just
        // that row — same rule the platform's file managers use.
        const pick = this.picked.has(id) && this.picked.size > 1 ? [...this.picked] : null;
        if (pick && canGroup(pick, this.groups)) {
            items.push(b.entry(`Group selection (${pick.length})`, 'group', () => this.makeGroup(pick), true));
        } else if (!pick && mine === null) {
            items.push(b.entry('New group', 'group', () => this.makeGroup([id]), true));
        }
        const others = this.groups.filter((g) => g.id !== mine?.id);
        if (!pick && others.length > 0) {
            items.push(
                b.submenu(
                    mine === null ? 'Add to group' : 'Move to group',
                    'folder-plus',
                    others.map((g) =>
                        b.entry(g.name, undefined, () => {
                            this.groups = assignToGroup(this.groups, g.id, [id]);
                            this.render();
                        }),
                    ),
                    items.length === 0,
                ),
            );
        }
        if (mine !== null) {
            items.push(
                b.entry(`Remove from ${mine.name}`, 'folder-minus', () => {
                    this.groups = removeFromGroups(this.groups, [id]);
                    this.render();
                }, items.length === 0),
            );
        }
        return items;
    }

    private groupMenu(b: MenuBuilder, pass: Pass, g: DrawGroup): MenuItemDescriptor[] {
        // Everything the branch owns: the group's own drawings and every nested group's.
        const ids = groupDrawingIds(this.groups, g.id);
        const members = pass.chart.drawings.all().filter((d) => ids.includes(d.id));
        const { allHidden, allLocked } = groupState(members);
        const items = [
            b.entry('Rename…', 'pen', () => {
                this.renaming = g.id;
                this.render();
            }),
            b.entry(allHidden ? 'Show all' : 'Hide all', allHidden ? 'eye' : 'eye-off', () => this.setMembers(pass, ids, { visible: allHidden }), true),
            b.entry(allLocked ? 'Unlock all' : 'Lock all', allLocked ? 'unlock' : 'lock', () => this.setMembers(pass, ids, { locked: !allLocked })),
            b.entry('Select all', 'group', () => {
                this.picked = new Set(ids);
                this.selInd.clear();
                this.groupPicks.clear();
                this.bulk = ids.length > 0;
                this.selectOnChart(ids);
                this.render();
            }),
        ];
        // Copy the whole branch — drawings cloned as one undo step, the nesting rebuilt.
        if (ids.length > 0 && pass.chart.drawings.supported) {
            items.push(b.entry('Duplicate group', 'clone', () => this.duplicateGroup(pass, g), true));
        }
        items.push(...this.syncSubmenu(b, ids));
        // A picked group (or a picked drawing) can be filed UNDER this one — the menu route to
        // what a drag onto the header does.
        const pickedGroups = [...this.groupPicks].filter((id) => id !== g.id && !groupWithin(this.groups, g.id, id));
        if (this.picked.size > 0 || pickedGroups.length > 0) {
            items.push(
                b.entry(
                    `Group selection inside ${g.name}`,
                    'folder-plus',
                    () => {
                        if (pickedGroups.length > 0) this.makeGroup([...this.picked], pickedGroups, g.id);
                        else this.makeGroup([...this.picked], [], g.id);
                    },
                ),
            );
        }
        // The whole bundle moves through its pane's stack as one contiguous run, keeping its
        // internal order — TradingView gives a group's members sequential z-indexes.
        if (members.length > 0) {
            items.push(...this.visualOrderItems(b, (move) => this.restackGroup(pass, g, move), true));
        }
        // Ungrouping keeps the drawings; the group is only the panel's bookkeeping. Nested
        // groups survive it — they move up one level instead of dissolving with the parent.
        items.push(b.entry('Ungroup', 'ungroup', () => this.removeGroup(pass, g.id, false), true));
        const setMenu = this.drawingSetSubmenu(b, ids, g.name);
        if (setMenu) items.push(setMenu);
        items.push(b.entry('Remove all', 'trash', () => this.removeGroup(pass, g.id, true)));
        return items;
    }

    /** Forget everything that refers to a drawing or group the chart no longer has — otherwise a
     *  deleted drawing would keep a group alive, or stay counted in the selection bar. */
    private prune(chart: Vela): void {
        const live = new Set((chart.drawings.supported ? chart.drawings.all() : []).map((d) => d.id));
        for (const id of [...this.picked]) if (!live.has(id)) this.picked.delete(id);
        const liveGroups = new Set(this.groups.map((g) => g.id));
        for (const id of [...this.groupPicks]) if (!liveGroups.has(id)) this.groupPicks.delete(id);
        const liveInd = new Set(chart.indicators().map((h) => h.id));
        for (const id of [...this.selInd]) if (!liveInd.has(id)) this.selInd.delete(id);
        if (this.selCount === 0) this.bulk = false;
        if (this.groups.length === 0) {
            this.renaming = null;
            return;
        }
        this.groups = pruneGroups(this.groups, live);
        if (this.renaming !== null && !this.groups.some((g) => g.id === this.renaming)) this.renaming = null;
    }
}
