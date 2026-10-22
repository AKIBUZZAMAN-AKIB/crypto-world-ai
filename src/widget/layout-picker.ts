// Layout picker — the topbar's LAYOUT dropdown. A bounded 4×4 grid canvas: hover
// previews the full rows×cols rectangle from the top-left (the table-insert idiom);
// a click applies it immediately. Registered layouts that are NOT expressible on the
// canvas (bespoke plugin presets) list as labeled rows under it, and the workspace
// SYNC switches sit beside the grid.
//
// The panel is a lightweight anchored popover (outside-pointerdown + Escape dismiss)
// rather than a kit Menu: it mixes a canvas and switch rows, which is beyond the menu
// machine's item model. The host element provides the theme tokens (the panel portals
// inside it, same as the menu positioner).
import { injectStyles } from '../ui/styles';
import { SyncMatrix } from './sync-matrix';
import { Tooltip } from '../ui/components/tooltip';
import { announceSurface } from '../ui/surface-events';
import { holdForExit, type SurfaceExit } from '../ui/surface-exit';
import { IMPLICIT_GROUP } from '../state/document';
import { groupMarkColor } from '../workspace/sync-marks';
import { iconEl } from '../ui/icons';
import { downloadText } from '../ui/download';

/** "just now" / "3h ago" / "2d ago" — a saved row's second line. */
function relativeTime(ms: number): string {
    const diff = Date.now() - ms;
    if (!Number.isFinite(diff) || diff < 0) return '';
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
}

const STYLE_ID = 'vela-widget-layout-picker-v15';
// One monochrome selection language across the panel: lit cells and sync ON
// switches both speak --vela-selected-*.
const CSS = `
.vela-lp-layer { position: absolute; z-index: var(--vela-z-menu); }
.vela-lp {
    /* Responsive by construction: the popover never grows past the window. It is a COLUMN
       because it owns the only scrollbar — the table used to scroll inside a scrolling
       panel, which meant two bars for one gesture and a bar even when everything fit. */
    display: flex;
    flex-direction: column;
    max-width: min(900px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: auto;
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    padding: 10px 12px 10px;
    font-size: 13px;
    user-select: none;
    transform-origin: top;
    animation: vela-lp-in var(--vela-dur-fast) var(--vela-ease);
}
@keyframes vela-lp-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-lp-cols { display: flex; align-items: stretch; gap: 14px; flex-wrap: wrap; flex: 0 1 auto; }
.vela-lp-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
    margin-bottom: 10px;
}
/* "?" help badge: hover it for the canvas explainer. */
.vela-lp-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg-muted);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0;
    cursor: default;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-badge:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-lp-tip { display: flex; flex-direction: column; gap: 4px; max-width: 230px; white-space: normal; }
.vela-lp-vsep { width: 1px; flex: none; align-self: stretch; background: var(--vela-border-faint); }
.vela-lp-layout { width: 132px; display: flex; flex-direction: column; align-items: center; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 4px; }
.vela-lp-sq {
    all: unset;
    box-sizing: border-box;
    border-radius: 4px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-sq:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
/* Selected/previewed squares — the shared monochrome selection chip. */
.vela-lp-sq[data-on='1'] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
}
.vela-lp-presets { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.vela-lp-preset { all: unset; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--vela-fg-muted); font-size: 12px; white-space: nowrap; transition: transform 120ms var(--vela-ease); }
.vela-lp-preset:hover { background: var(--vela-hover); }
.vela-lp-preset:active { transform: scale(0.98); }
.vela-lp-preset[data-checked='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-sync { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* The switch column takes the slack when the table has wrapped under it. */
/* The switch column sizes to its LABELS: stretching it to 260px put 100px of dead
   space between "Crosshair" and its switch, and stole that width from the table. */
.vela-lp-synccol { flex: 0 1 190px; min-width: 150px; max-width: 210px; display: flex; flex-direction: column; }
/* The link x chart table: a fixed side pane with its OWN vertical scroll, so the
   popover keeps its shape as charts are added and the footer stays put. The table
   scrolls sideways inside itself; the fade marks the rest of the columns. */
/* Separator + table are ONE flex item, so a narrow window wraps them together instead
   of leaving a stray divider at the end of the first line. */
.vela-lp-chartspane {
    display: flex;
    gap: 14px;
    flex: 1 1 300px;
    min-width: 0;
}
.vela-lp-chartspane[hidden] { display: none !important; }
.vela-lp-charts {
    width: clamp(240px, 302px, 34vw);
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.vela-lp-charts[hidden], .vela-lp-vsep[hidden] { display: none !important; }
.vela-lp-charthint { margin: -4px 0 6px; font-size: 10.5px; line-height: 1.35; color: var(--vela-fg-muted); }
.vela-lp-chartscroll {
    /* No cap and no bar of its own: a table is at most one row per LINK (≤ 9), so it is
       short by construction. The panel scrolls when — and only when — the whole card is
       taller than the window. */
    overflow: visible;
}
.vela-lp-charts .vela-md-matrix-label,
.vela-lp-charts .vela-md-matrix-corner { background: var(--vela-surface); }
/* Full-width row (narrow window): the table keeps a readable width instead of stretching
   four columns across the whole popover. */
.vela-lp-charts .vela-md-matrixwrap { max-width: 430px; }
/* Narrow window: the table used to WRAP under the switches at its 430px cap and leave a
   hundred-odd pixels of empty panel beside it. Two columns instead — the layout grid on
   the left, switches over table on the right — so the table fills the width it has and
   the card gets shorter, not just narrower. */
@media (max-width: 900px) {
    /* A grid needs a width to divide: without this the card shrinks to its content and the
       "1fr" table column is whatever the table happens to be. */
    .vela-lp { width: min(880px, calc(100vw - 24px)); }
    .vela-lp-cols {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        column-gap: 14px;
        row-gap: 10px;
    }
    .vela-lp-layout { grid-column: 1; grid-row: 1 / span 2; }
    .vela-lp-cols > .vela-lp-vsep { display: none; }
    .vela-lp-synccol { grid-column: 2; grid-row: 1; max-width: 380px; justify-self: start; width: 100%; }
    .vela-lp-chartspane { grid-column: 2; grid-row: 2; min-width: 0; }
    .vela-lp-chartspane > .vela-lp-vsep { display: none; }
    .vela-lp-charts { width: auto; flex: 1 1 auto; }
    .vela-lp-charts .vela-md-matrixwrap { max-width: none; }
}
/* Preset glyphs: a compact 4-up grid of icon buttons (the canvas cannot draw them). */
.vela-lp-presets[data-icons='1'] { display: block; max-height: 232px; overflow-y: auto; overflow-x: hidden; margin-right: -4px; padding-right: 4px; }
.vela-lp-presetcount { margin: 6px 0 2px; font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase; color: var(--vela-fg-muted); opacity: 0.8; }
.vela-lp-presetrow { display: grid; grid-template-columns: repeat(4, 24px); gap: 4px; }
.vela-lp-preset[data-icon='1'] { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; color: var(--vela-fg-muted); background: var(--vela-hover); border: 1px solid var(--vela-border-faint); }
.vela-lp-preset[data-icon='1'] svg { width: 16px; height: 16px; }
.vela-lp-preset[data-icon='1']:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }




.vela-lp-scope[data-global='1'] { color: var(--vela-fg-bright); border-color: var(--vela-selected-bg); }
/* Footer: saved layouts + tab link. */
.vela-lp-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--vela-border-faint); display: flex; flex-direction: column; gap: 6px; }
.vela-lp-save { display: flex; gap: 6px; }
.vela-lp-save input {
    flex: 1 1 auto;
    min-width: 0;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    border-radius: 4px;
    color: var(--vela-fg);
    font: inherit;
    font-size: 12px;
    padding: 4px 6px;
}
.vela-lp-save button, .vela-lp-saved button {
    all: unset;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--vela-fg-muted);
    background: var(--vela-hover);
}
.vela-lp-save button:hover, .vela-lp-saved button:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-saved { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.vela-lp-saved .vela-lp-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: var(--vela-fg-muted); }
.vela-lp-saved .vela-lp-name:hover { color: var(--vela-fg-bright); }
.vela-lp-saved .vela-lp-name[data-active='1'] { color: var(--vela-fg-bright); font-weight: 500; }
.vela-lp-saved .vela-lp-saved-act {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--vela-fg-faint);
    background: transparent;
}
.vela-lp-saved .vela-lp-saved-act:hover { color: var(--vela-fg-bright); background: var(--vela-hover-strong); }
.vela-lp-saved .vela-lp-saved-act .vela-icon { font-size: 13px; width: 13px; height: 13px; }
/* A saved layout's preview: a 44×28 JPEG of the grid, or the empty slot of the same
   size so the names stay aligned while a save has no picture yet. */
.vela-lp-thumb {
    flex: none;
    width: 44px;
    height: 28px;
    border-radius: 3px;
    object-fit: cover;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
}
.vela-lp-saved .vela-lp-when { flex: none; font-size: 10px; color: var(--vela-fg-faint); }
/* Template rows: the indicator count is the useful second line, so the name column is
   a two-line stack rather than one ellipsized string. */
.vela-lp-tpl { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.vela-lp-tpl .vela-lp-tplname { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.vela-lp-tpl .vela-lp-tplname b { font-weight: 500; color: var(--vela-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lp-tpl .vela-lp-tplname span { font-size: 10px; color: var(--vela-fg-faint); }
.vela-lp-tpl .vela-lp-saved-act { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--vela-fg-faint); cursor: pointer; }
.vela-lp-tpl .vela-lp-saved-act:hover { color: var(--vela-fg-bright); background: var(--vela-hover-strong); }
.vela-lp-tpl .vela-lp-saved-act .vela-icon { font-size: 13px; width: 13px; height: 13px; }
.vela-lp-grouphead { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vela-fg-faint); margin-top: 2px; }
/* The legend under the table: the same marks the cells wear, with the name the user
   gave them. BOTH halves are editable in place — the glyph (what the chart wears) and
   the name (what the group is for) — and both are keyboard-reachable buttons, not
   spans with a click handler. */
.vela-lp-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 2px 2px 4px; }
.vela-lp-leg { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vela-fg-muted); max-width: 100%; }
.vela-lp-leg .vela-lp-legmark {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    min-height: 16px;
    padding: 0 1px;
    border-radius: 3px;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-leg .vela-lp-legmark:hover { background: var(--vela-hover-strong); }
.vela-lp-leg .vela-lp-legmark:focus-visible { outline: 1px solid var(--vela-selected-bg); outline-offset: 1px; }
.vela-lp-leg .vela-lp-legmark:disabled { cursor: default; }
.vela-lp-leg input { width: 84px; background: var(--vela-hover); border: 1px solid var(--vela-selected-bg); border-radius: 3px; color: var(--vela-fg-bright); font: inherit; font-size: 11px; padding: 1px 4px; }
.vela-lp-leg input.vela-lp-legmarkinput { width: 30px; text-align: center; }

.vela-lp-rename {
    flex: 1 1 auto;
    min-width: 0;
    background: var(--vela-hover);
    border: 1px solid var(--vela-selected-bg);
    border-radius: 4px;
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 12px;
    padding: 3px 6px;
}
.vela-lp-rename[data-refused] { border-color: var(--vela-danger); }
/* Import = one action in the row it belongs to (not a dashed bar with its own line). */
.vela-lp-importbtn {
    all: unset;
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    align-self: center;
    border-radius: 5px;
    border: 1px solid var(--vela-border-soft);
    color: var(--vela-fg-muted);
    cursor: pointer;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease),
        background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-importbtn svg { width: 13px; height: 13px; }
.vela-lp-importbtn:hover { color: var(--vela-fg-bright); border-color: var(--vela-selected-bg); background: var(--vela-hover); }
.vela-lp-importbtn:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
.vela-lp-links { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vela-fg-faint); }
.vela-lp-linkdot {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease),
        background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-linkdot:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); background: var(--vela-hover); }
.vela-lp-linkdot[data-tag='none'] { color: var(--vela-fg-faint); }
.vela-lp-pool {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 6px 8px;
    text-align: left;
    font: inherit;
    font-size: 11px;
    color: var(--vela-fg-muted);
    background: none;
    border: 1px solid var(--vela-border);
    border-radius: 4px;
    cursor: pointer;
}
.vela-lp-pool:hover { color: var(--vela-fg-bright); border-color: var(--vela-selected-bg); }
.vela-lp-pool[data-armed='1'] { color: var(--vela-danger); border-color: var(--vela-danger); }
.vela-lp-undo { color: var(--vela-fg-muted); }
.vela-lp-linkdot[data-on='1'] { color: var(--vela-fg-bright); border-color: var(--vela-accent); background: var(--vela-focus-soft); }
.vela-lp-linkdot:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: 1px; }
.vela-lp-sync-row { all: unset; display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.vela-lp-sync-row:hover { background: var(--vela-hover); }
.vela-lp-sync-row .vela-lp-label { flex: 1 1 auto; }
/* Toggle pill — same control language as the menu's switch rows, monochrome ON state. */
.vela-lp-switch {
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lp-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-lp-switch.on { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }
.vela-lp-switch.on::after { transform: translateX(16px); background: var(--vela-selected-fg); }
`;

/** The picker canvas is a fixed 4×4 — 16 cells, the workspace pool capacity. */
const GRID = 4;

/** The current layout's footprint on the canvas (mirrors the workspace's LayoutShape). */
export type LayoutPickerShape = { rows: number; cols: number };

/** Build the bare 4×4 canvas (16 squares, row-major). Interaction wiring stays with the
 *  caller — the desktop popover adds hover previews, the mobile drawer taps to apply. */
export function layoutGridCanvas(doc: Document): { el: HTMLElement; squares: HTMLButtonElement[] } {
    injectStyles(STYLE_ID, CSS, doc);
    const el = doc.createElement('div');
    el.className = 'vela-lp-grid';
    const squares: HTMLButtonElement[] = [];
    for (let r = 0; r < GRID; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
            const sq = doc.createElement('button');
            sq.className = 'vela-lp-sq';
            sq.dataset.r = String(r);
            sq.dataset.c = String(c);
            sq.setAttribute('aria-label', `${c + 1} × ${r + 1}`);
            squares.push(sq);
            el.appendChild(sq);
        }
    }
    return { el, squares };
}

/** Light the `shape` rectangle from the top-left (null = nothing lit). */
export function paintLayoutGrid(squares: readonly HTMLButtonElement[], shape: LayoutPickerShape | null): void {
    for (const sq of squares) {
        const on = shape !== null && Number(sq.dataset.r) < shape.rows && Number(sq.dataset.c) < shape.cols;
        if (on) sq.dataset.on = '1';
        else delete sq.dataset.on;
    }
}

export interface LayoutPickerOptions {
    /** Topbar button that toggles the panel. */
    trigger: HTMLElement;
    /** Positioning/theming host (the widget root — the panel portals inside it). */
    host: HTMLElement;
    /** Current layout's canvas shape (null = a preset the canvas cannot express). */
    shape: () => LayoutPickerShape | null;
    /** Registered layouts NOT expressible on the canvas — rendered as a glyph grid when
     *  they carry an `icon` (SVG markup), labeled rows otherwise. `cells` groups them by
     *  chart count (the family is 40+ ids now). */
    presets: () => Array<{ id: string; label: string; checked: boolean; icon?: string; cells?: number }>;
    onSelectGrid: (rows: number, cols: number) => void;
    onSelectPreset: (id: string) => void;
    /** SYNC switch rows (re-read on every open and after every toggle). `group` is the
     *  ACTIVE cell's group for that link; `marks` is the same reading for EVERY chart —
     *  what the "Marking" strip needs to paint the selected chart's chip. */
    syncs: () => Array<{ id: string; label: string; checked: boolean; group?: string; marks?: Record<string, string> }>;
    onToggleSync: (id: string) => void;
    /** Cycle the ACTIVE cell through the link's groups (none → A → B → C → none). */
    onCycleGroup?: (id: string) => void;
    /** The charts the "Marking" strip lists, in slot order (the phone's sheet has the
     *  same list). Without it the picker can only mark the active cell. */
    charts?: () => Array<{ id: string; label: string; symbol?: string; active: boolean }>;
    /** Make a chart active from the table's column header. */
    onSelectChart?: (cellId: string) => void;
    /** Pick one group outright (the cell's palette). `null` leaves the group. */
    onSetCellGroup?: (kind: string, cellId: string, mark: string | null) => void;
    /** Cycle ANY chart through a link's groups — the desktop twin of the phone's chart
     *  row, so a chart does not have to be made active to be marked. */
    onCycleCellGroup?: (kind: string, cellId: string) => void;
    /** Put EVERY chart in one group for a link (the phone's "All charts, one group"). */
    onAllInOneGroup?: (kind: string) => void;
    /** The drawing scope the workspace holds (the chip on the Drawings row). */
    drawingsScope?: () => 'layout' | 'global';
    onToggleDrawingsScope?: () => void;
    /** Named snapshots: open / delete (rows), save (the input). */
    savedLayouts?: () => Array<{ name: string; active: boolean; thumb?: string | null; savedAt?: number | null }>;
    onSaveLayout?: (name: string) => void;
    onOpenLayout?: (name: string) => void;
    onDeleteLayout?: (name: string) => void;
    /** Rename in place. Returns false when the name is blank/taken (row keeps its name). */
    onRenameLayout?: (from: string, to: string) => boolean;
    /** The snapshot as portable JSON — the picker turns it into a download. */
    onExportLayout?: (name: string) => string | null;
    /** Restore a snapshot from a picked file; returns the name it landed under. */
    onImportLayout?: (json: string) => string | null;
    /** Save WITH a preview image (the row then shows the grid it restores). */
    onSaveLayoutWithThumb?: (name: string) => boolean;
    /** Saved chart templates — indicator sets (drawings never travel). */
    templates?: () => Array<{ name: string; count: number; symbol?: string; timeframe?: string }>;
    onSaveTemplate?: (name: string, includeMarket: boolean) => boolean;
    onApplyTemplate?: (name: string, target: 'active' | 'all') => number;
    onDeleteTemplate?: (name: string) => void;
    onExportTemplate?: (name: string) => string | null;
    onImportTemplate?: (json: string) => string | null;
    /** The groups in use, with the user's names — the legend under the table. */
    legend?: () => Array<{ id: string; mark: string; color?: string; name: string; count: number }>;
    /** Repaint one group's glyph (`null` = back to the palette's mark). Optional: without
     *  it the legend still names groups, it just cannot change their mark. */
    onSetGroupMark?: (id: string, glyph: string | null) => void;
    /** The user's name for a group id — the matrix palette shows it beside the mark. */
    groupName?: (id: string) => string | undefined;
    onRenameGroup?: (id: string, name: string | null) => void;
    /** Dormant (pooled) charts — the smaller layouts the workspace has visited. Their
     *  state is kept so the slot restores; the row below offers to drop them. */
    hiddenCharts?: () => number;
    onClearPooled?: () => void;
    /** How many dormant charts the last clear dropped — 0 hides the Undo row. */
    clearedCharts?: () => number;
    onRestorePooled?: () => void;
    /** Tab-link tag (TradingView Desktop's colored tab link): null = unlinked. */
    linkGroup?: () => string | null;
    onLinkGroup?: (tag: string | null) => void;
    onOpenChange?: (open: boolean) => void;
}

export class LayoutPicker {
    private readonly opts: LayoutPickerOptions;
    private readonly doc: Document;
    private readonly layer: HTMLElement;
    /** The picker card inside the layer — the element open/close are announced on. */
    private readonly panel: HTMLElement;
    private readonly squares: HTMLButtonElement[] = []; // row-major, 16 entries
    private readonly infoTip: Tooltip;
    private readonly presetsEl: HTMLElement;
    private readonly syncEl: HTMLElement;
    private readonly footEl: HTMLElement;

    private isOpen = false;
    /** First click arms the "remove hidden charts" row; the second one commits. */
    private poolArmed = false;
    /** The card's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    /** Hover preview (1-based rows/cols), null = show current shape. */
    private hover: { rows: number; cols: number } | null = null;
    /** Which chart the group chips mark: a cell id, or 'all' for "every chart at once". */
    private matrix: SyncMatrix | null = null;
    private matrixSec: HTMLElement | null = null;
    private vsep2: HTMLElement | null = null;
    private chartsPane: HTMLElement | null = null;

    private readonly onDocPointerDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (t && (this.layer.contains(t) || this.opts.trigger.contains(t))) return;
        this.close();
    };
    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') this.close();
    };

    constructor(opts: LayoutPickerOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
        const doc = this.doc;

        this.layer = doc.createElement('div');
        this.layer.className = 'vela-ui-layer vela-lp-layer';
        this.layer.style.display = 'none';
        const panel = doc.createElement('div');
        panel.className = 'vela-lp';
        this.layer.appendChild(panel);
        this.panel = panel;

        const cols = doc.createElement('div');
        cols.className = 'vela-lp-cols';
        panel.appendChild(cols);

        // ── left column: the LAYOUT canvas ──
        const layoutCol = doc.createElement('div');
        layoutCol.className = 'vela-lp-layout';
        const layoutHeading = doc.createElement('div');
        layoutHeading.className = 'vela-lp-heading';
        const headingText = doc.createElement('span');
        headingText.textContent = 'Layout';
        const badge = doc.createElement('span');
        badge.className = 'vela-lp-badge';
        badge.textContent = '?';
        layoutHeading.append(headingText, badge);
        layoutCol.appendChild(layoutHeading);
        this.infoTip = new Tooltip(badge, {
            host: opts.host,
            placement: 'bottom',
            content: () => this.tipNode(),
        });

        const { el: grid, squares } = layoutGridCanvas(doc);
        this.squares.push(...squares);
        layoutCol.appendChild(grid);

        this.presetsEl = doc.createElement('div');
        this.presetsEl.className = 'vela-lp-presets';
        layoutCol.appendChild(this.presetsEl);
        cols.appendChild(layoutCol);

        const vsep = doc.createElement('div');
        vsep.className = 'vela-lp-vsep';
        cols.appendChild(vsep);

        // ── right column: the SYNC switches ──
        const syncCol = doc.createElement('div');
        syncCol.className = 'vela-lp-synccol';
        const syncHeading = doc.createElement('div');
        syncHeading.className = 'vela-lp-heading';
        syncHeading.textContent = 'Sync';
        syncCol.appendChild(syncHeading);
        this.syncEl = doc.createElement('div');
        this.syncEl.className = 'vela-lp-sync';
        syncCol.appendChild(this.syncEl);
        cols.appendChild(syncCol);

        // ── the TABLE: its own column, beside the two, with its OWN scrollbars ───
        // Same component as the phone sheet (sync-matrix.ts) — but on desktop it must
        // not stretch the panel or push the footer off-screen: a fixed-width side pane
        // that scrolls vertically by itself, and sideways inside the table (the fade
        // says there is more). Charts are identified by SLOT NUMBER, never by ticker:
        // the chart you called BTC can be showing XRPUSDT a second later.
        const chartsPane = doc.createElement('div');
        chartsPane.className = 'vela-lp-chartspane';
        const vsep2 = doc.createElement('div');
        vsep2.className = 'vela-lp-vsep';
        chartsPane.appendChild(vsep2);
        this.vsep2 = vsep2;
        this.chartsPane = chartsPane;

        const chartsCol = doc.createElement('div');
        chartsCol.className = 'vela-lp-charts';
        chartsCol.hidden = true;
        const chartsHeading = doc.createElement('div');
        chartsHeading.className = 'vela-lp-heading';
        chartsHeading.textContent = 'Chart syncing';
        // The one line that matters: the numbers below are the numbers on the charts.
        const chartsHint = doc.createElement('div');
        chartsHint.className = 'vela-lp-charthint';
        chartsHint.textContent = 'Same mark, same group · numbers match the charts';
        const chartsScroll = doc.createElement('div');
        chartsScroll.className = 'vela-lp-chartscroll';
        this.matrix = new SyncMatrix({
            doc,
            host: opts.host,
            shell: 'desktop',
            ...(opts.onSelectChart ? { onSelectChart: (id: string) => opts.onSelectChart?.(id) } : {}),
            ...(opts.onCycleCellGroup ? { onCycleCellGroup: (kind: string, id: string) => opts.onCycleCellGroup?.(kind, id) } : {}),
            ...(opts.onSetCellGroup ? { onSetCellGroup: (kind: string, id: string, mark: string | null) => opts.onSetCellGroup?.(kind, id, mark) } : {}),
            ...(opts.onAllInOneGroup ? { onAllInOneGroup: (kind: string) => opts.onAllInOneGroup?.(kind) } : {}),
            ...(opts.groupName ? { groupName: (id: string) => opts.groupName?.(id) } : {}),
            onChange: () => this.renderSyncs(),
        });
        chartsScroll.append(this.matrix.el);
        chartsCol.append(chartsHeading, chartsHint, chartsScroll);
        chartsPane.appendChild(chartsCol);
        cols.appendChild(chartsPane);
        this.matrixSec = chartsCol;

        // ── footer: named layouts + the tab link (both shell-level, not per cell) ──
        this.footEl = doc.createElement('div');
        this.footEl.className = 'vela-lp-foot';
        panel.appendChild(this.footEl);

        // ── canvas interactions: hover previews the rectangle, click applies it ──
        grid.addEventListener('pointerdown', (e) => {
            const sq = this.squareAt(e);
            if (!sq) return;
            e.preventDefault();
            const { r, c } = this.squarePos(sq);
            this.close();
            this.opts.onSelectGrid(r + 1, c + 1);
        });
        grid.addEventListener('pointermove', (e) => {
            const sq = this.squareAt(e);
            if (!sq) return;
            const { r, c } = this.squarePos(sq);
            if (this.hover?.rows !== r + 1 || this.hover?.cols !== c + 1) {
                this.hover = { rows: r + 1, cols: c + 1 };
                this.render();
            }
        });
        grid.addEventListener('pointerleave', () => {
            if (this.hover) {
                this.hover = null;
                this.render();
            }
        });

        opts.trigger.addEventListener('click', () => this.toggle());
        opts.trigger.setAttribute('aria-haspopup', 'true');
        opts.trigger.setAttribute('aria-expanded', 'false');
        opts.host.appendChild(this.layer);
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    /** Open and bring one chart's column into view — the status-line badge's entry: the
     *  chart you tapped is already the one you mean. */
    openFor(cellId?: string): void {
        this.open();
        if (cellId) this.matrix?.focus(cellId);
    }

    open(): void {
        if (this.isOpen) return;
        this.isOpen = true;
        this.exit?.cancel();
        this.exit = null;
        this.hover = null;
        this.refresh();
        this.layer.style.display = '';
        this.position();
        this.opts.trigger.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.addEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(true);
        // After the host heard it — a listener that closes the picker again then reports last.
        if (this.isOpen) announceSurface(this.panel, true, 'popover', this.opts.trigger);
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.poolArmed = false; // an armed destructive row never survives a close
        // Still showing — the close bubbles before the layer hides.
        announceSurface(this.panel, false, 'popover', this.opts.trigger);
        this.exit = holdForExit(this.panel, () => {
            this.exit = null;
            if (!this.isOpen) this.layer.style.display = 'none';
        });
        this.opts.trigger.setAttribute('aria-expanded', 'false');
        this.doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(false);
    }

    /** Re-read shape/presets/syncs and re-render (no-op while closed — `open` re-reads). */
    refresh(): void {
        if (!this.isOpen) return;
        this.renderPresets();
        this.renderSyncs();
        this.renderFooter();
        this.render();
    }

    destroy(): void {
        this.close();
        this.exit?.finish();
        this.infoTip.destroy();
        this.layer.remove();
    }

    // ── internals ──
    private squareAt(e: PointerEvent): HTMLButtonElement | null {
        const sq = (e.target as Element | null)?.closest?.('.vela-lp-sq');
        return sq instanceof HTMLButtonElement ? sq : null;
    }

    private squarePos(sq: HTMLButtonElement): { r: number; c: number } {
        return { r: Number(sq.dataset.r), c: Number(sq.dataset.c) };
    }

    /** Help copy for the LAYOUT "?" badge. */
    private tipNode(): HTMLElement {
        const tip = this.doc.createElement('div');
        tip.className = 'vela-lp-tip';
        tip.textContent = 'Click a square to apply that columns × rows layout.';
        return tip;
    }

    /** Project the interaction state onto the DOM (the hover/current rectangle). */
    private render(): void {
        paintLayoutGrid(this.squares, this.hover ?? this.opts.shape());
    }

    private renderPresets(): void {
        const doc = this.doc;
        this.presetsEl.replaceChildren();
        const presets = this.opts.presets();
        this.presetsEl.style.display = presets.length > 0 ? '' : 'none';
        // The asymmetric presets ship a glyph: a 4-up icon grid keeps the card compact
        // where forty labeled rows would triple its height.
        const iconic = presets.length > 0 && presets.every((p) => p.icon);
        if (iconic) this.presetsEl.dataset.icons = '1';
        else delete this.presetsEl.dataset.icons;
        // Grouped by chart count — the id family is long enough that an ungrouped grid
        // reads as noise; a `2 charts` caption is what the eye sorts by.
        const counts = [...new Set(presets.map((p) => p.cells ?? 0))].sort((a, b) => a - b);
        const grouped = counts.length > 1 && presets.some((p) => p.cells !== undefined);
        for (const n of grouped ? counts : [null]) {
            if (n !== null) {
                const caption = doc.createElement('div');
                caption.className = 'vela-lp-presetcount';
                caption.textContent = `${n} chart${n === 1 ? '' : 's'}`;
                this.presetsEl.appendChild(caption);
            }
            const row = doc.createElement('div');
            row.className = 'vela-lp-presetrow';
            for (const p of presets) {
                if (n !== null && (p.cells ?? 0) !== n) continue;
                const b = doc.createElement('button');
                b.className = 'vela-lp-preset';
                if (p.icon) {
                    b.dataset.icon = '1';
                    b.innerHTML = p.icon;
                    b.setAttribute('aria-label', p.label);
                } else {
                    b.textContent = p.label;
                }
                b.title = p.label;
                if (p.checked) b.dataset.checked = '1';
                b.addEventListener('click', () => {
                    this.close();
                    this.opts.onSelectPreset(p.id);
                });
                row.appendChild(b);
            }
            this.presetsEl.appendChild(row);
        }
    }

    private renderSyncs(): void {
        const doc = this.doc;
        this.syncEl.replaceChildren();
        const scope = this.opts.drawingsScope?.();
        const charts = this.opts.charts?.() ?? [];
        const syncs = this.opts.syncs();
        // The TABLE does the marking now: one cell per (link, chart), the same component
        // the phone sheet mounts. Rows below are what FOLLOWS; the table is WHO follows
        // whom. One surface each, no duplicate.
        const table = charts.length > 1 && Boolean(this.opts.onCycleCellGroup || this.opts.onAllInOneGroup);
        if (this.matrixSec) this.matrixSec.hidden = !table;
        if (this.vsep2) this.vsep2.hidden = !table;
        // The pane is the flex item: hiding only its children would leave a gap behind.
        if (this.chartsPane) this.chartsPane.hidden = !table;
        if (table) this.matrix?.update(charts, syncs);
        for (const s of syncs) {
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'vela-lp-sync-row';
            const label = doc.createElement('span');
            label.className = 'vela-lp-label';
            label.textContent = s.label;
            row.setAttribute('role', 'switch');
            row.setAttribute('aria-checked', String(s.checked));
            // The drawing scope is a second axis on the Drawings row (layout <-> global):
            // TV's "sync drawings in layout / globally" pair.
            if (s.id === 'drawings' && this.opts.drawingsScope) {
                const chip = doc.createElement('span');
                chip.className = 'vela-lp-scope';
                chip.textContent = scope === 'global' ? 'global' : 'layout';
                if (scope === 'global') chip.dataset.global = '1';
                chip.setAttribute('role', 'button');
                chip.setAttribute('aria-label', `Drawing scope: ${scope ?? 'layout'} — click to switch`);
                chip.addEventListener('click', (e) => {
                    e.stopPropagation(); // never flips the link switch
                    this.opts.onToggleDrawingsScope?.();
                    this.renderSyncs();
                });
                row.append(label, chip);
            } else {
                row.append(label);
            }
            const pill = doc.createElement('span');
            pill.className = 'vela-lp-switch' + (s.checked ? ' on' : '');
            pill.setAttribute('aria-hidden', 'true');
            row.appendChild(pill);
            row.addEventListener('click', () => {
                this.opts.onToggleSync(s.id);
                this.renderSyncs(); // switches stay open — flip, see, flip again
            });
            this.syncEl.appendChild(row);
        }
        // The legend only. The plain-language line lives ONCE, in the table column beside
        // this one — two sentences starting "Same mark, same group" a row apart is noise.
        if (table) this.renderLegend(doc);
    }

    /** The row of a named snapshot (`data-layout`), for focus/scroll after an import. */
    private savedRow(name: string): HTMLElement | null {
        for (const row of this.footEl.querySelectorAll<HTMLElement>('.vela-lp-saved')) {
            if (row.dataset.layout === name) return row;
        }
        return null;
    }

    /** One 24×24-ish action button in a saved-layout row (icon carries the label). */
    private savedAction(icon: string, label: string, run: () => void): HTMLButtonElement {
        const b = this.doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-lp-saved-act';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.appendChild(iconEl(icon, this.doc));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            run();
        });
        return b;
    }

    /**
     * Turn the row's label into an input, in place. Enter commits, Escape cancels, blur
     * commits — the same contract as the Save field, and the row keeps its position so
     * the eye does not have to re-find it.
     */
    private beginRename(row: HTMLElement, label: HTMLElement, from: string): void {
        const doc = this.doc;
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'vela-lp-rename';
        input.value = from;
        input.setAttribute('aria-label', `Rename ${from}`);
        let done = false;
        // Enter may RETRY a refused name in place; focus loss (blur) only leaves the row
        // alone — a refused blur must never trap the pointer inside the field.
        const finish = (allowRetry: boolean): void => {
            if (done) return;
            const to = input.value.trim();
            if (!to || to === from) {
                done = true;
                this.renderFooter();
                return;
            }
            const ok = this.opts.onRenameLayout?.(from, to) ?? false;
            if (ok || !allowRetry) {
                done = true;
                this.renderFooter();
                return;
            }
            input.dataset.refused = to;
            input.title = `“${to}” is already used — pick another name`;
            input.focus();
            input.select();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // the panel's Escape must not close the picker mid-edit
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                done = true;
                this.renderFooter();
            }
        });
        input.addEventListener('blur', () => finish(false));
        label.replaceWith(input);
        input.focus();
        input.select();
        row.dataset.editing = '1';
    }

    /** Open the OS file picker for an imported snapshot (no drag-drop needed). */
    private pickImportFile(): void {
        const input = this.doc.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json,.vela';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
                const name = this.opts.onImportLayout?.(text) ?? null;
                if (name) {
                    this.renderFooter();
                    this.savedRow(name)?.scrollIntoView({ block: 'nearest' });
                }
            });
            input.remove();
        });
        this.doc.body.appendChild(input);
        input.click();
    }

    /**
     * The legend under the table — "🔴 = scalping, 🟡 = macro". The table says WHICH
     * chart is in a group; only the user knows WHAT the group is for, so the name is
     * editable in place (click the name, type, Enter). Names are stored by the stable
     * group id, never by the emoji.
     */
    private renderLegend(doc: Document): void {
        const legend = this.opts.legend?.();
        if (!legend || legend.length === 0 || (!this.opts.onRenameGroup && !this.opts.onSetGroupMark)) return;
        const wrap = doc.createElement('div');
        wrap.className = 'vela-lp-legend';
        wrap.setAttribute('aria-label', 'Sync groups');
        for (const item of legend) {
            const chip = doc.createElement('span');
            chip.className = 'vela-lp-leg';
            chip.dataset.group = item.id;
            const mark = doc.createElement('button');
            mark.type = 'button';
            mark.className = 'vela-lp-legmark';
            mark.textContent = item.mark;
            if (item.color) mark.style.color = item.color;
            // The mark is the OTHER editable half of a legend row: names say what a group
            // is for, the glyph is what the chart wears. Two graphemes max (a chip is
            // 14px), Enter commits, Escape/blur leaves it alone.
            if (this.opts.onSetGroupMark) {
                mark.title = `Click to change the mark for ${item.name}`;
                mark.setAttribute('aria-label', `Mark for group ${item.name} is ${item.mark}. Change mark`);
                mark.addEventListener('click', () => {
                    const input = doc.createElement('input');
                    input.type = 'text';
                    input.value = item.mark;
                    input.maxLength = 4;
                    input.className = 'vela-lp-legmarkinput';
                    input.setAttribute('aria-label', `New mark for group ${item.name}`);
                    input.addEventListener('keydown', (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            this.opts.onSetGroupMark?.(item.id, input.value.trim() || null);
                            this.renderSyncs();
                        } else if (e.key === 'Escape') {
                            this.renderSyncs();
                        }
                    });
                    input.addEventListener('blur', () => {
                        if (input.isConnected) this.renderSyncs();
                    });
                    mark.replaceWith(input);
                    input.focus();
                    input.select();
                });
            } else {
                mark.disabled = true;
                mark.style.cursor = 'default';
            }
            const label = doc.createElement('button');
            label.type = 'button';
            label.className = 'vela-lp-legname';
            label.textContent = item.name;
            label.title = `${item.count} chart${item.count === 1 ? '' : 's'} · click to name this group`;
            label.setAttribute('aria-label', `Group ${item.mark} — ${item.name}. Rename`);
            label.style.cssText =
                'all:unset;cursor:text;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            label.addEventListener('click', () => {
                const input = doc.createElement('input');
                input.type = 'text';
                input.value = item.name;
                input.maxLength = 24;
                input.setAttribute('aria-label', `Name for group ${item.mark}`);
                input.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        this.opts.onRenameGroup?.(item.id, input.value.trim() || null);
                        this.renderSyncs();
                    } else if (e.key === 'Escape') {
                        this.renderSyncs();
                    }
                });
                input.addEventListener('blur', () => {
                    if (input.isConnected) this.renderSyncs();
                });
                label.replaceWith(input);
                input.focus();
                input.select();
            });
            chip.append(mark, label);
            wrap.appendChild(chip);
        }
        this.syncEl.appendChild(wrap);
    }

    /**
     * Chart templates — the indicator set, not the grid. Vela's contract: applying one
     * REPLACES the chart's indicators; drawings never travel; the market is opt-in (the
     * "with market" box is unchecked, exactly like the symbol/timeframe chips in the
     * docs). In a multi-chart layout the apply button asks where: this chart, or all.
     */
    private renderTemplates(doc: Document): void {
        const list = this.opts.templates;
        const save = this.opts.onSaveTemplate;
        if (!list || !save) return;
        const head = doc.createElement('div');
        head.className = 'vela-lp-grouphead';
        head.textContent = 'Chart templates';
        this.footEl.appendChild(head);

        const form = doc.createElement('div');
        form.className = 'vela-lp-save';
        const input = doc.createElement('input');
        input.type = 'text';
        input.placeholder = 'Save indicators as…';
        input.setAttribute('aria-label', 'Save chart template as');
        const withMarket = doc.createElement('label');
        withMarket.className = 'vela-lp-tplmarket';
        withMarket.title = 'Also store the symbol and timeframe (off by default: a template works on any market)';
        const box = doc.createElement('input');
        box.type = 'checkbox';
        const boxText = doc.createElement('span');
        boxText.textContent = 'market';
        withMarket.append(box, boxText);
        const commit = (): void => {
            const name = input.value.trim();
            if (!name) return;
            if (save(name, box.checked)) {
                input.value = '';
                this.renderFooter();
            }
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
        });
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Save';
        btn.addEventListener('click', commit);
        form.append(input, withMarket, btn);
        if (this.opts.onImportTemplate) {
            form.appendChild(this.importButton('Import template file…', 'Import a chart template from a .json file', () => this.pickTemplateFile()));
        }
        this.footEl.appendChild(form);

        for (const t of list()) {
            const row = doc.createElement('div');
            row.className = 'vela-lp-tpl';
            row.dataset.template = t.name;
            const nameCol = doc.createElement('span');
            nameCol.className = 'vela-lp-tplname';
            const bold = doc.createElement('b');
            bold.textContent = t.name;
            bold.title = t.name;
            const meta = doc.createElement('span');
            meta.textContent = `${t.count} indicator${t.count === 1 ? '' : 's'}${t.symbol ? ` · ${t.symbol}` : ''}`;
            nameCol.append(bold, meta);
            row.appendChild(nameCol);
            // Apply here, then apply everywhere — the two answers the docs describe.
            row.appendChild(this.savedAction('check', `Apply “${t.name}” to the active chart`, () => this.opts.onApplyTemplate?.(t.name, 'active')));
            row.appendChild(this.savedAction('group', `Apply “${t.name}” to every chart`, () => this.opts.onApplyTemplate?.(t.name, 'all')));
            if (this.opts.onExportTemplate) {
                row.appendChild(this.savedAction('download', `Export “${t.name}”`, () => {
                    const json = this.opts.onExportTemplate?.(t.name);
                    if (json) downloadText(this.doc, `${t.name}.vela-template.json`, json);
                }));
            }
            row.appendChild(this.savedAction('trash', `Delete “${t.name}”`, () => {
                this.opts.onDeleteTemplate?.(t.name);
                this.renderFooter();
            }));
            this.footEl.appendChild(row);
        }
    }

    /** A file-import action: one icon in the row that owns it (label in title + aria). */
    private importButton(label: string, title: string, run: () => void): HTMLButtonElement {
        const b = this.doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-lp-importbtn';
        b.title = title;
        b.setAttribute('aria-label', label);
        b.appendChild(iconEl('upload', this.doc));
        b.addEventListener('click', run);
        return b;
    }

    /** The template file picker — same contract as the layout importer. */
    private pickTemplateFile(): void {
        const doc = this.doc;
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
                this.opts.onImportTemplate?.(text);
                this.renderFooter();
            });
            input.remove();
        });
        doc.body.appendChild(input);
        input.click();
    }

    /** Saved layouts + the tab link — the card's footer. */
    private renderFooter(): void {
        const doc = this.doc;
        this.footEl.replaceChildren();
        const saved = this.opts.savedLayouts;
        if (saved) {
            const form = doc.createElement('div');
            form.className = 'vela-lp-save';
            const input = doc.createElement('input');
            input.type = 'text';
            input.placeholder = 'Save layout as…';
            input.setAttribute('aria-label', 'Save layout as');
            const save = doc.createElement('button');
            save.type = 'button';
            save.textContent = 'Save';
            const commit = (): void => {
                const name = input.value.trim();
                if (!name) return;
                // With a preview engine available the row is worth a picture: the trader
                // recognises the grid long before they remember the name they typed.
                if (this.opts.onSaveLayoutWithThumb) this.opts.onSaveLayoutWithThumb(name);
                else this.opts.onSaveLayout?.(name);
                input.value = '';
                this.renderFooter();
            };
            save.addEventListener('click', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') commit();
                e.stopPropagation(); // the panel's Escape/typing must not reach the shell
            });
            form.append(input, save);
            // Import sits HERE, as a trailing action of the same row, instead of a
            // full-width dashed row of its own: restoring a snapshot and saving one are
            // the same gesture from the user's side, and the panel gains 70px of height
            // it was spending on two empty bars.
            if (this.opts.onImportLayout) {
                const imp = this.importButton('Import layout file…', 'Restore a layout snapshot from a .json file', () => this.pickImportFile());
                form.appendChild(imp);
            }
            this.footEl.appendChild(form);
            for (const l of saved()) {
                const row = doc.createElement('div');
                row.className = 'vela-lp-saved';
                row.dataset.layout = l.name;
                // The preview. A saved layout without a picture keeps an empty box of the
                // same size so the column of names stays aligned.
                if (typeof l.thumb === 'string' && l.thumb.startsWith('data:image/')) {
                    const img = doc.createElement('img');
                    img.className = 'vela-lp-thumb';
                    img.src = l.thumb;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.draggable = false;
                    row.appendChild(img);
                } else {
                    const blank = doc.createElement('span');
                    blank.className = 'vela-lp-thumb';
                    blank.setAttribute('aria-hidden', 'true');
                    row.appendChild(blank);
                }
                const name = doc.createElement('span');
                name.className = 'vela-lp-name';
                name.textContent = l.name;
                name.title = `Open “${l.name}”`;
                if (l.active) name.dataset.active = '1';
                name.addEventListener('click', () => this.opts.onOpenLayout?.(l.name));
                row.append(name);
                if (typeof l.savedAt === 'number' && l.savedAt > 0) {
                    const when = doc.createElement('span');
                    when.className = 'vela-lp-when';
                    when.textContent = relativeTime(l.savedAt);
                    when.title = new Date(l.savedAt).toLocaleString();
                    row.appendChild(when);
                }
                if (this.opts.onRenameLayout) row.appendChild(this.savedAction('pen', `Rename ${l.name}`, () => {
                    this.beginRename(row, name, l.name);
                }));
                if (this.opts.onExportLayout) row.appendChild(this.savedAction('download', `Export ${l.name} as JSON`, () => {
                    const json = this.opts.onExportLayout?.(l.name);
                    if (json) downloadText(this.doc, `${l.name}.vela-layout.json`, json);
                }));
                const del = this.savedAction('trash', `Delete ${l.name}`, () => {
                    this.opts.onDeleteLayout?.(l.name);
                    this.renderFooter();
                });
                row.appendChild(del);
                this.footEl.appendChild(row);
            }
        }
        this.renderTemplates(doc);
        if (this.opts.hiddenCharts && this.opts.onClearPooled) {
            const hidden = this.opts.hiddenCharts();
            if (hidden === 0) this.poolArmed = false;
            if (hidden > 0) {
                const noun = `hidden chart${hidden === 1 ? '' : 's'}`;
                const row = doc.createElement('button');
                row.type = 'button';
                row.className = 'vela-lp-pool';
                // Two-step: this throws away state the trader cannot see, so one stray
                // click must not be enough. Armed ⇒ same row, danger tint, commit.
                row.textContent = this.poolArmed ? `Remove ${hidden} ${noun} — click to confirm` : `Remove ${hidden} ${noun}`;
                row.title = this.poolArmed ? 'This forgets their symbols, drawings and indicators' : 'Free the charts the smaller layouts left dormant';
                if (this.poolArmed) row.dataset.armed = '1';
                row.setAttribute('aria-label', row.title);
                row.addEventListener('click', () => {
                    if (!this.poolArmed) {
                        this.poolArmed = true;
                        this.renderFooter();
                        return;
                    }
                    this.poolArmed = false;
                    this.opts.onClearPooled?.();
                    this.renderFooter();
                });
                this.footEl.appendChild(row);
            }
        }
        if (this.opts.onRestorePooled && (this.opts.clearedCharts?.() ?? 0) > 0) {
            const count = this.opts.clearedCharts?.() ?? 0;
            const undo = doc.createElement('button');
            undo.type = 'button';
            undo.className = 'vela-lp-pool vela-lp-undo';
            undo.textContent = `Undo — bring back ${count} hidden chart${count === 1 ? '' : 's'}`;
            undo.setAttribute('aria-label', undo.textContent);
            undo.addEventListener('click', () => {
                this.opts.onRestorePooled?.();
                this.renderFooter();
            });
            this.footEl.appendChild(undo);
        }
        if (this.opts.onLinkGroup) {
            const links = doc.createElement('div');
            links.className = 'vela-lp-links';
            const caption = doc.createElement('span');
            caption.textContent = 'Link tabs';
            links.appendChild(caption);
            const current = this.opts.linkGroup?.() ?? null;
            // NEUTRAL by design: four identity-coloured dots competed with the sync marks
            // two rows above them and meant nothing to anyone who had not read the TV
            // desktop docs. The tag is a NUMBER now, colour is reserved for groups, and
            // the selected set is an outline — information no longer depends on hue.
            for (const [i, tag] of ([null, 'red', 'green', 'blue', 'amber'] as const).entries()) {
                const dot = doc.createElement('button');
                dot.type = 'button';
                dot.className = 'vela-lp-linkdot';
                dot.dataset.tag = tag ?? 'none';
                if ((current ?? null) === tag) dot.dataset.on = '1';
                dot.textContent = tag ? String(i) : '—';
                dot.title = tag ? `Link to other tabs in set ${i}` : 'Unlink tabs';
                dot.setAttribute('aria-label', dot.title);
                dot.addEventListener('click', () => {
                    this.opts.onLinkGroup?.(tag);
                    this.renderFooter();
                });
                links.appendChild(dot);
            }
            this.footEl.appendChild(links);
        }
        this.footEl.style.display = this.footEl.childElementCount > 0 ? '' : 'none';
    }

    /** Anchor under the trigger, clamped to the host's right edge. */
    private position(): void {
        const hostRect = this.opts.host.getBoundingClientRect();
        const trigRect = this.opts.trigger.getBoundingClientRect();
        let left = trigRect.left - hostRect.left;
        // The kit menus' positioning gutter, so every topbar dropdown clears the bar alike.
        const top = trigRect.bottom - hostRect.top + 8;
        const width = this.layer.offsetWidth;
        if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - 8 - width);
        // Same clamp vertically: a panel with the table in it can be taller than the
        // room under the button, and a popover half outside the window is a bug.
        const height = this.layer.offsetHeight;
        const topFit = hostRect.height - 8 - height;
        const placed = top + height > hostRect.height - 8 ? Math.max(8, topFit) : top;
        this.layer.style.left = `${left}px`;
        this.layer.style.top = `${placed}px`;
    }
}
