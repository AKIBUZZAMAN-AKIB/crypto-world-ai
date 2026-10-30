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
import type { CsvTimeFormat } from '../workspace/csv';
import { SyncMatrix } from './sync-matrix';
import { Tooltip } from '../ui/components/tooltip';
import { announceSurface } from '../ui/surface-events';
import { holdForExit, type SurfaceExit } from '../ui/surface-exit';
import { makePanelDraggable, panelResizeGrip, type PanelDrag } from '../ui/panel-drag';
import { IMPLICIT_GROUP } from '../state/document';
import { groupMarkColor } from '../workspace/sync-marks';
import { iconEl } from '../ui/icons';
import { isRtl } from '../ui/gesture';
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

const STYLE_ID = 'vela-widget-layout-picker-v16';
// Lit cells and sync ON switches share the paired --vela-selected-* tokens.
const CSS = `
/* Bound the positioning layer itself, not just its scrolling child: otherwise a
   wide internal grid expands the absolute layer and widens the whole document. */
.vela-lp-layer { position: absolute; z-index: var(--vela-z-menu); width: min(536px, calc(100% - 16px)); max-width: calc(100% - 16px); }
.vela-lp-layer[data-panel-resized='1'] > .vela-lp { box-sizing: border-box; height: 100%; max-height: 100%; }
.vela-lp {
    /* Responsive by construction: the popover never grows past the window. It is a COLUMN
       because it owns the only scrollbar — the table used to scroll inside a scrolling
       panel, which meant two bars for one gesture and a bar even when everything fit.
       Measured on a 1440x900 desktop the old card was 685x825 (92% of the viewport's
       height): a settings sheet, not a popover. The card is now a compact 2-column
       block — canvas + presets on the left, links over the matrix on the right. */
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    max-height: calc(100vh - 16px);
    overflow: auto;
    /* The card sits on the WORKSPACE surface, not the elevated one: measured on the
       elevated grey, the muted label ink fell to 4.13:1 (below AA) while the same ink
       on this surface is 5.25:1. The lift is the border, the top hairline and the
       shadow — not a lighter fill. */
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 10px;
    /* The elevation is a hairline of light on the top edge plus one soft shadow: the
       card reads as a sheet of glass, not a text box with a border. */
    box-shadow: var(--vela-shadow), inset 0 1px 0 rgb(255 255 255 / 5%);
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.35;
    user-select: none;
    transform-origin: top;
    animation: vela-lp-in var(--vela-dur-fast) var(--vela-ease);
}
@keyframes vela-lp-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-lp-cols {
    /* Canvas column fixed, the rest stacked beside it: links over the matrix. This is
       the layout the narrow breakpoint already used; making it the default is what
       turns one 685x825 card into a 2-column 530x560 one. */
    display: grid;
    /* Do not squash controls when the viewport is narrower than the panel's natural
       content. The compact panel remains bounded; its content scrolls horizontally. */
    min-width: 430px;
    grid-template-columns: 132px minmax(286px, 1fr);
    align-items: start;
    column-gap: 12px;
    row-gap: 8px;
}
.vela-lp-cols > .vela-lp-vsep { display: none; }
/* R87 premium pane header for the setup-only desktop panel. */
.vela-lp-panehead {
    position: sticky;
    top: -8px;
    z-index: 3;
    flex: none;
    background: var(--vela-surface);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 10px;
    margin: -2px -2px 10px;
    border-bottom: 1px solid var(--vela-border);
    cursor: grab;
    touch-action: none;
}
.vela-lp-panemark {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vela-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--vela-accent) 45%, transparent);
    color: var(--vela-accent-ink, var(--vela-accent));
}
.vela-lp-panemark .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-lp-paneid { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-lp-panekicker { font-size: 9.5px; font-weight: 750; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vela-fg-muted); }
.vela-lp-panetitle { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; color: var(--vela-fg-bright); }
.vela-lp-panehint { font-size: 11px; color: var(--vela-fg-muted); }
.vela-lp-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    /* 35%-alpha ink measured 2.16:1 on the panel — a label nobody can read. The
       hierarchy survives in the size and the tracking, not in the invisibility. */
    color: var(--vela-fg-muted);
    margin-bottom: 6px;
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
.vela-lp-layout { grid-column: 1; grid-row: 1 / span 2; min-width: 0; display: flex; flex-direction: column; align-items: center; align-self: stretch; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 3px; }
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
/* The squares have no text; the theme-aware accent ink keeps them distinct
   from the unselected squares on both light and dark surfaces. */
.vela-lp-sq[data-on='1'] {
    background: var(--vela-accent-ink, var(--vela-accent));
    border-color: var(--vela-accent-ink, var(--vela-accent));
}
.vela-lp-presets { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.vela-lp-preset { all: unset; padding: 4px 7px; border-radius: 5px; cursor: pointer; /* 11.5px label: muted sits at 4.50 (the AA line exactly) — this ink lands at ~5.9 with the same quiet tone. */ color: color-mix(in srgb, var(--vela-fg) 78%, transparent); font-size: 11.5px; white-space: nowrap; transition: transform 120ms var(--vela-ease); }
.vela-lp-preset:hover { background: var(--vela-hover); }
.vela-lp-preset:active { transform: scale(0.98); }
.vela-lp-preset[data-checked='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-sync {
    /* Seven switches in one column cost 234px of height for seven 30px rows. Two
       columns halve that and read faster: the pairs are the axes a trader thinks in
       (range/time, symbol/crosshair, drawings/…). */
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 6px;
    min-width: 0;
}
/* The switch column takes the slack when the table has wrapped under it. */
/* The switch column sizes to its LABELS: stretching it to 260px put 100px of dead
   space between "Crosshair" and its switch, and stole that width from the table. */
.vela-lp-synccol { grid-column: 2; grid-row: 1; min-width: 0; display: flex; flex-direction: column; }
/* The link x chart table: a fixed side pane with its OWN vertical scroll, so the
   popover keeps its shape as charts are added and the footer stays put. The table
   scrolls sideways inside itself; the fade marks the rest of the columns. */
/* Separator + table are ONE flex item, so a narrow window wraps them together instead
   of leaving a stray divider at the end of the first line. */
.vela-lp-chartspane {
    display: flex;
    flex-direction: column;
    grid-column: 2;
    grid-row: 2;
    gap: 0;
    min-width: 0;
}
.vela-lp-chartspane[hidden] { display: none !important; }
.vela-lp-charts {
    width: auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.vela-lp-charts[hidden], .vela-lp-vsep[hidden] { display: none !important; }
.vela-lp-charthint { margin: -2px 0 5px; font-size: 10px; line-height: 1.3; color: var(--vela-fg-muted); }
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
.vela-lp-charts .vela-md-matrixwrap { max-width: none; }
/* Narrow window: the table used to WRAP under the switches at its 430px cap and leave a
   hundred-odd pixels of empty panel beside it. Two columns instead — the layout grid on
   the left, switches over table on the right — so the table fills the width it has and
   the card gets shorter, not just narrower. */
/* Preset glyphs: a compact 4-up grid of icon buttons (the canvas cannot draw them). */
/* The presets scroller TAKES the leftover height of the left column instead of leaving
   a hundred-pixel hole under it: the card's rows stay flush and there is no dead space
   at any viewport (the canvas + presets column is the shorter of the two). */
.vela-lp-presets[data-icons='1'] {
    display: block;
    flex: 1 1 0;
    height: 0;
    min-height: 60px;
    max-height: none;
    overflow-y: auto;
    overflow-x: hidden;
    margin-right: -4px;
    padding-right: 4px;
    scrollbar-width: thin;
    /* The list is longer than its column on purpose (32 presets): a 10px fade is the
       scroll hint, so no permanent scrollbar stands in the middle of the card. */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 10px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 10px), transparent);
}
.vela-lp-presetcount {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 4px 0 2px;
    font-size: 8.5px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
    opacity: 0.9;
}
.vela-lp-presetcount::after {
    content: '';
    flex: 1 1 auto;
    height: 1px;
    background: var(--vela-border-faint);
}
.vela-lp-presetrow { display: grid; grid-template-columns: repeat(5, 24px); gap: 2px; justify-content: start; }
.vela-lp-preset[data-icon='1'] {
    /* Minimal by construction: no pill, no border — the GLYPH is the button. The hover
       wash is the only chrome, and the selected layout keeps a single hairline ring so
       "which one am I in" survives the removal of the boxes. */
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    color: color-mix(in srgb, var(--vela-fg) 62%, transparent);
    background: transparent; border: 1px solid transparent;
    transition: color 120ms var(--vela-ease), background 120ms var(--vela-ease);
}
.vela-lp-preset[data-icon='1'][data-checked='1'] { border-color: var(--vela-border-strong); color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-lp-preset[data-icon='1'] svg { width: 14px; height: 14px; }
.vela-lp-preset[data-icon='1']:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); border-color: transparent; }




.vela-lp-scope[data-global='1'] { color: var(--vela-fg-bright); border-color: var(--vela-selected-bg); }
/* Footer: saved layouts + tab link. */
.vela-lp-foot { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--vela-border-faint); display: flex; flex-direction: column; gap: 3px; }
/* Setup-only desktop panel: ONE door to the separate Manage layouts popover. The
   save/autosave/export/import verbs never mix with grid and sync controls. */
.vela-lp-managerdoor {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--vela-fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
}
.vela-lp-managerdoor:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-lp-managerdoor:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-lp-managerdoor .vela-icon { font-size: 14px; color: var(--vela-fg-muted); }
.vela-lp-managerdoor small { margin-left: auto; color: var(--vela-fg-faint); font-size: 10px; }
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
.vela-lp-csv { display: flex; align-items: center; gap: 6px; }
.vela-lp-csv .vela-lp-csvcap {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--vela-fg-muted);
}
/* The receipt after a save: the count and the file name, in success ink — a one-shot
   confirmation that never grows the panel. */
.vela-lp-csv .vela-lp-csvcap[data-done='1'] { color: var(--vela-up); }
.vela-lp-csv .vela-lp-csvseg {
    all: unset;
    cursor: pointer;
    flex: none;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 16px;
    color: var(--vela-fg-muted);
    background: var(--vela-hover);
}
.vela-lp-csv .vela-lp-csvseg:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-csv .vela-lp-csvseg[data-on='1'] { color: var(--vela-fg-bright); background: var(--vela-hover-strong); }
.vela-lp-csv .vela-lp-csvseg:focus-visible { outline: 1px solid var(--vela-accent); outline-offset: 1px; }
.vela-lp-saved { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.vela-lp-saved .vela-lp-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: var(--vela-fg-muted); }
.vela-lp-saved .vela-lp-name:hover { color: var(--vela-fg-bright); }
.vela-lp-saved .vela-lp-name[data-active='1'] { color: var(--vela-fg-bright); font-weight: 500; }
.vela-lp-saved .vela-lp-saved-act {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    /* 2.16:1 in faint ink — an icon is a control, and a control owes 3:1. */
    color: var(--vela-fg-muted);
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
.vela-lp-saved .vela-lp-when { flex: none; font-size: 10px; color: var(--vela-fg-muted); }
/* Template rows: the indicator count is the useful second line, so the name column is
   a two-line stack rather than one ellipsized string. */
.vela-lp-tpl { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.vela-lp-tpl .vela-lp-tplname { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.vela-lp-tpl .vela-lp-tplname b { font-weight: 500; color: var(--vela-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lp-tpl .vela-lp-tplname span { font-size: 10px; color: var(--vela-fg-muted); }
.vela-lp-tpl .vela-lp-saved-act { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--vela-fg-muted); cursor: pointer; }
.vela-lp-tpl .vela-lp-saved-act:hover { color: var(--vela-fg-bright); background: var(--vela-hover-strong); }
.vela-lp-tpl .vela-lp-saved-act .vela-icon { font-size: 13px; width: 13px; height: 13px; }
.vela-lp-grouphead { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vela-fg-muted); margin-top: 2px; }
/* The manager's own header: the OPEN layout, whether it has drifted, and autosave.
   One line of state above the list — a trader should never have to guess which
   snapshot they are looking at, or whether their last edit is in it. */
.vela-lp-open { display: flex; align-items: center; gap: 6px; padding: 4px 2px 0; font-size: 11.5px; color: var(--vela-fg-muted); }
.vela-lp-open b { font-weight: 500; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lp-open .vela-lp-openname { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 5px; }
.vela-lp-open button { all: unset; cursor: pointer; padding: 3px 8px; min-height: 22px; box-sizing: border-box; display: inline-flex; align-items: center; border-radius: 4px; font-size: 11.5px; color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-lp-open button:hover { background: var(--vela-hover-strong); }
.vela-lp-open button:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
/* A small filled dot: the snapshot and the chart disagree. Paired with the words in
   the title/aria — colour alone never carries a state (WCAG 1.4.1). */
.vela-lp-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--vela-accent, var(--vela-fg-bright)); }
.vela-lp-auto { all: unset; display: flex; align-items: center; gap: 8px; padding: 2px; min-height: 26px; box-sizing: border-box; cursor: pointer; border-radius: 4px; }
.vela-lp-auto:hover { background: var(--vela-hover); }
.vela-lp-auto:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
.vela-lp-auto .vela-lp-switch { margin-left: auto; }
.vela-lp-auto .vela-lp-label { flex: 1 1 auto; font-size: 12px; color: var(--vela-fg); }
.vela-lp-auto-hint { font-size: 10px; color: var(--vela-fg-muted); }
/* A saved row's second column of facts (charts · indicators) — small, muted, and the
   first thing to give way when the name is long. */
.vela-lp-saved .vela-lp-rowmeta { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--vela-fg-muted); }
.vela-lp-saved[data-active='1'] { background: var(--vela-hover); border-radius: 4px; }
/* Rename-in-place: the row's own text field, never a modal for a one-word edit. */
.vela-lp-filter { width: 100%; box-sizing: border-box; margin: 2px 0 4px; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--vela-border); background: var(--vela-hover); color: var(--vela-fg-bright); font: inherit; font-size: 12px; }
.vela-lp-filter::placeholder { color: var(--vela-fg-faint); }
.vela-lp-filter:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
.vela-lp-saved[hidden] { display: none; }
.vela-lp-inline { flex: 1 1 auto; min-width: 0; background: var(--vela-hover); border: 1px solid var(--vela-border-strong); border-radius: 4px; color: var(--vela-fg-bright); font: inherit; font-size: 12px; padding: 2px 6px; }
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
/* Focus. Every control here starts with \`all: unset\`, which also unset the UA
   outline: measured on the built card, a focused preset reported
   \`outline: none 0px\` and a focused grid the near-invisible UA \`auto 1px\`. That is
   WCAG 2.4.7 (Focus Visible) failing on 32 presets, 7 switches and the footer —
   so the ring is drawn here ONCE, in the accent, and it keeps its offset away from
   the control's own border. */
.vela-lp :is(.vela-lp-preset, .vela-lp-sync-row, .vela-lp-name, .vela-lp-save button, .vela-lp-saved button, .vela-lp-scope):focus-visible {
    outline: 2px solid var(--vela-accent, var(--vela-fg-bright));
    outline-offset: 1px;
}
.vela-lp-grid:focus-visible {
    outline: 2px solid var(--vela-accent, var(--vela-fg-bright));
    outline-offset: 3px;
    border-radius: 6px;
}
/* The one native control in the card, drawn in the card's own language: an unstyled
   checkbox was a white square in a dark popover. */
.vela-lp-tplmarket {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}
.vela-lp-tplmarket input {
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 1px solid var(--vela-border-strong);
    border-radius: 4px;
    background: var(--vela-hover);
    cursor: pointer;
    display: inline-grid;
    place-content: center;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-tplmarket input::after {
    content: '';
    width: 7px;
    height: 4px;
    border-left: 1.5px solid var(--vela-selected-fg);
    border-bottom: 1.5px solid var(--vela-selected-fg);
    transform: rotate(-45deg) translateY(-1px);
    opacity: 0;
}
.vela-lp-tplmarket input:checked {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
}
.vela-lp-tplmarket input:checked::after { opacity: 1; }
.vela-lp-tplmarket input:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
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
.vela-lp-importbtn[data-copied='1'] { color: var(--vela-selected-fg); border-color: var(--vela-selected-bg); background: var(--vela-selected-bg); }
.vela-lp-importbtn:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-fg-bright)); outline-offset: 1px; }
.vela-lp-links { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vela-fg-muted); }
.vela-lp-linkdot {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    /* WCAG 2.2 SC 2.5.8 asks for 24×24 on any pointer; 22 was a rounding mistake. */
    min-width: 24px;
    height: 24px;
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
.vela-lp-linkdot[data-tag='none'] { color: var(--vela-fg-muted); }
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
.vela-lp-sync-row { all: unset; display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 5px; cursor: pointer; min-height: 24px; box-sizing: border-box; }
.vela-lp-sync-row .vela-lp-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lp-sync-row:hover { background: var(--vela-hover); }
.vela-lp-sync-row .vela-lp-label { flex: 1 1 auto; }
/* Toggle pill — same control language as the menu's switch rows, monochrome ON state. */
.vela-lp-switch {
    position: relative;
    flex: none;
    width: 30px;
    height: 16px;
    border-radius: 8px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lp-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-lp-switch.on { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }
.vela-lp-switch.on::after { transform: translateX(14px); background: var(--vela-selected-fg); }
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
    // ONE tab stop for the canvas: the grid is the control (arrows move the cursor,
    // Enter applies), so its sixteen squares stay out of the tab order entirely. A
    // browser that refuses to tab OUT of a focused square cannot trap a user who is
    // never on one.
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Layout size — arrow keys choose, Enter applies');
    const squares: HTMLButtonElement[] = [];
    for (let r = 0; r < GRID; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
            const sq = doc.createElement('button');
            sq.className = 'vela-lp-sq';
            sq.dataset.r = String(r);
            sq.dataset.c = String(c);
            sq.setAttribute('aria-label', `${c + 1} × ${r + 1}`);
            sq.tabIndex = -1; // the grid container is the tab stop (see above)
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
        sq.setAttribute('aria-pressed', String(on));
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
    savedLayouts?: () => Array<{
        name: string;
        active: boolean;
        thumb?: string | null;
        savedAt?: number | null;
        /** How big the snapshot is — what tells two layouts apart at a glance. */
        charts?: number;
        indicators?: number;
        /** The OPEN layout has changed since it was saved (TradingView's dot). */
        dirty?: boolean;
    }>;
    /** The open layout's name, when one is open — the "Save changes" line needs it. */
    activeLayout?: () => string | null;
    /** Write the open layout in place (Ctrl/Cmd+S's action, and "Save changes"). */
    onSaveChanges?: () => void;
    /** TradingView's Autosave: keep the open layout in step with the chart. */
    autosave?: () => boolean;
    onToggleAutosave?: (on: boolean) => void;
    /** "Make a copy" on a saved layout. */
    onDuplicateLayout?: (name: string) => void;
    /** The template NEW charts start from (null = none), and the setter behind the star. */
    defaultTemplate?: () => string | null;
    onSetDefaultTemplate?: (name: string | null) => void;
    onRenameTemplate?: (from: string, to: string) => boolean;
    onSaveLayout?: (name: string) => void;
    onOpenLayout?: (name: string) => void;
    onDeleteLayout?: (name: string) => void;
    /** Rename in place. Returns false when the name is blank/taken (row keeps its name). */
    onRenameLayout?: (from: string, to: string) => boolean;
    /** The snapshot as portable JSON — the picker turns it into a download. */
    onExportLayout?: (name: string) => string | null;
    /** Restore a snapshot from a picked file; returns the name it landed under. */
    onImportLayout?: (json: string) => string | null;
    /** Copy a link that carries THIS one saved layout (Tier-2 #8). Resolves the URL, or
     *  null when the clipboard refused / the layout is too big to travel in a fragment. */
    onShareLayout?: (name: string) => Promise<string | null>;
    /** Copy a permalink that restores this workspace (resolves the URL; null = the
     *  clipboard refused, and the button says so instead of lying). */
    onCopyLink?: () => Promise<string | null>;
    /** Save WITH a preview image (the row then shows the grid it restores). */
    onSaveLayoutWithThumb?: (name: string) => boolean;
    /** Saved chart templates — indicator sets (drawings never travel). */
    templates?: () => Array<{ name: string; count: number; symbol?: string; timeframe?: string }>;
    onSaveTemplate?: (name: string, includeMarket: boolean) => boolean;
    onApplyTemplate?: (name: string, target: 'active' | 'all') => number;
    onDeleteTemplate?: (name: string) => void;
    onExportTemplate?: (name: string) => string | null;
    /**
     * Write the chart's bars as CSV. Returns how many bars landed (for the receipt) or
     * null when there is nothing to export — an empty chart, or a host that cannot save
     * files. TradingView's "Export chart data…" is the same verb, and it lives here
     * because this sheet is the chart's file menu.
     */
    onExportData?: (scope: 'visible' | 'all', timeFormat: CsvTimeFormat) => { rows: number; filename: string } | null;
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
    /**
     * Desktop separation (R86 T9): when true this popover is LAYOUT SETUP ONLY. It keeps
     * the grid, presets, chart sync, hidden-chart and tab-link controls, but replaces the
     * old saved-layout/autosave/file/template footer with one door to Manage layouts.
     */
    setupOnly?: boolean;
    /** Open the separate layout-management panel, anchored to the door. */
    onOpenManager?: (trigger: HTMLElement) => void;
    onOpenChange?: (open: boolean) => void;
}

export class LayoutPicker {
    private readonly opts: LayoutPickerOptions;
    /** The open was requested from the keyboard (Enter/Space on the trigger). */
    private keyboardOpen = false;
    private readonly doc: Document;
    private readonly layer: HTMLElement;
    /** The picker card inside the layer — the element open/close are announced on. */
    private readonly panel: HTMLElement;
    private readonly drag: PanelDrag;
    private readonly squares: HTMLButtonElement[] = []; // row-major, 16 entries
    /** The canvas container — the single tab stop for all sixteen squares. */
    private gridEl: HTMLElement | null = null;
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
        if (e.key !== 'Escape') return;
        // Escape inside an inline editor belongs to THAT editor: it cancels the edit and
        // must not close the popover. Closing it would move focus to the trigger, the
        // field would blur, and blur COMMITS — so renaming to "Nope" and pressing Escape
        // applied "Nope" instead of discarding it (measured; the field's own handler
        // never got the key because this one is on the capture path).
        const t = e.target as HTMLElement | null;
        if (t && this.layer.contains(t) && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        this.close();
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
        // A labelled, non-modal dialog: many controls, its own focus management, and a
        // screen reader should hear what it is the moment it opens.
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', this.opts.setupOnly ? 'Layout setup' : 'Layout, link and sync settings');
        if (this.opts.setupOnly) panel.dataset.setupOnly = '1';
        panel.tabIndex = -1; // a keyboard-open focus target; never in the tab order itself
        panel.addEventListener('keydown', this.onPanelKeydown);
        this.layer.appendChild(panel);
        this.panel = panel;
        this.drag = makePanelDraggable(this.layer, {
            handle: '.vela-lp-panehead',
            resizeHandle: '.vela-size-grip',
            boundary: () => opts.host.getBoundingClientRect(),
        });

        // Both setup-only and combined layout panels have the same compact move/resize
        // header; the controls below remain separate and scroll independently.
        const head = doc.createElement('div');
        head.className = 'vela-lp-panehead';
        head.tabIndex = 0;
        head.setAttribute('aria-label', 'Move layout panel');
        const mark = doc.createElement('span');
        mark.className = 'vela-lp-panemark';
        mark.appendChild(iconEl('layout', doc));
        const id = doc.createElement('div');
        id.className = 'vela-lp-paneid';
        const title = doc.createElement('b');
        title.className = 'vela-lp-panetitle';
        title.textContent = this.opts.setupOnly ? 'Layout setup' : 'Layout';
        id.append(title);
        head.append(mark, id, panelResizeGrip(doc, 'layout panel'));
        panel.appendChild(head);

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
        this.gridEl = grid;
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
        chartsCol.append(chartsHeading, chartsScroll);
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
        // The canvas is ONE control, not sixteen: a single tab stop sits on the square
        // that matches the current layout, and the arrows move the cursor inside it —
        // the APG grid rule, and the reason the panel stopped costing 16 tab presses.
        grid.addEventListener('keydown', (e) => this.onGridKey(e));
        grid.addEventListener('focusin', () => {
            // Arriving on the canvas previews the layout ON SCREEN, so the first arrow
            // key moves one square from where the user actually is.
            this.syncGridCursor();
            this.hover = { rows: this.gridPos.r + 1, cols: this.gridPos.c + 1 };
            this.render();
        });

        // Keyboard-open detection: a click synthesised from Enter/Space has detail === 0.
        // A popover must move focus INTO itself only for the keyboard user — doing it on
        // a mouse click would yank the caret away from wherever the pointer is.
        opts.trigger.addEventListener('click', (e) => {
            this.keyboardOpen = e.detail === 0;
            this.toggle();
        });
        opts.trigger.setAttribute('aria-haspopup', 'true');
        opts.trigger.setAttribute('aria-expanded', 'false');
        // NOT mounted here: a picker nobody has opened must not cost the page a node.
        // `open()` mounts it — see `mounted`.
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
        this.drag.reset();
        this.isOpen = true;
        // Built in the constructor, mounted on the first open: the layout matrix, the sync
        // switches and the footer are a closed picker's nodes until someone looks at them.
        if (!this.layer.isConnected) this.opts.host.appendChild(this.layer);
        this.exit?.cancel();
        this.exit = null;
        this.hover = null;
        this.refresh();
        this.syncGridCursor(); // arrows start from the layout on screen
        this.layer.style.display = '';
        this.position();
        this.opts.trigger.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.addEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(true);
        // After the host heard it — a listener that closes the picker again then reports last.
        if (this.isOpen) announceSurface(this.panel, true, 'popover', this.opts.trigger);
        // The panel is portalled at the END of the root: without this, a keyboard user
        // who pressed Enter on the trigger had to tab through the whole shell to reach
        // the panel they had just opened. Focus lands on the panel itself (tabindex -1),
        // so Escape still works and the next Tab enters its first control.
        const doc = this.doc;
        const focused = doc.activeElement;
        if (this.isOpen && (this.keyboardOpen || focused === this.opts.trigger) && doc.activeElement === this.opts.trigger) {
            // Focus the FIRST CONTROL, not the panel box: a focused scroll container
            // swallows Tab in Chromium (the panel would become a keyboard trap).
            const first = this.firstFocusable();
            try {
                (first ?? this.panel).focus({ preventScroll: true });
            } catch {
                /* a detached panel */
            }
        }
        this.keyboardOpen = false;
    }

    /** Where the roving focus sits inside the 4×4 canvas. */
    private gridPos = { r: 0, c: 0 };

    /** Seed the cursor from the layout currently on screen (arrow keys start there). */
    private syncGridCursor(): void {
        const shape = this.opts.shape();
        this.gridPos = {
            r: Math.max(0, Math.min(GRID - 1, (shape?.rows ?? 1) - 1)),
            c: Math.max(0, Math.min(GRID - 1, (shape?.cols ?? 1) - 1)),
        };
    }

    private onGridKey(e: KeyboardEvent): void {
        const { r, c } = this.gridPos;
        let nr = r;
        let nc = c;
        if (e.key === 'ArrowRight') nc = Math.min(GRID - 1, c + 1);
        else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1);
        else if (e.key === 'ArrowDown') nr = Math.min(GRID - 1, r + 1);
        else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
        else if (e.key === 'Home') { nr = 0; nc = 0; }
        else if (e.key === 'End') { nr = GRID - 1; nc = GRID - 1; }
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.close();
            this.opts.onSelectGrid(r + 1, c + 1);
            return;
        } else return;
        e.preventDefault();
        e.stopPropagation();
        this.gridPos = { r: nr, c: nc };
        // The arrow previews the rectangle exactly like a hover does. Focus stays on the
        // container (the tab stop), so Tab keeps working in every engine.
        this.hover = { rows: nr + 1, cols: nc + 1 };
        this.render();
        const live = this.gridEl;
        if (live) live.setAttribute('aria-label', `Layout size — ${nc + 1} by ${nr + 1}, Enter applies`);
    }

    /** Every focusable control in the panel, in DOM order (visible + enabled only). */
    private focusables(): HTMLElement[] {
        const selector = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const out: HTMLElement[] = [];
        for (const el of this.panel.querySelectorAll<HTMLElement>(selector)) {
            if (el.hasAttribute('disabled')) continue;
            if (el.tabIndex < 0) continue; // a roving/programmatic stop, not a Tab stop
            if (el.hidden || el.closest('[hidden]')) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            out.push(el);
        }
        return out;
    }

    private firstFocusable(): HTMLElement | null {
        return this.focusables()[0] ?? null;
    }

    /**
     * Tab is handled HERE, not by the browser.
     *
     * Chromium does not advance out of the layout canvas' squares (they live in a grid
     * whose pointer handlers cancel the press), so a keyboard user who reached the panel
     * could not leave the first square — a real trap, measured. Cycling the panel's own
     * focusables makes the behaviour explicit and identical in every engine, and a
     * settings popover that keeps Tab inside itself until Escape is the standard
     * non-modal-dialog reading of APG.
     */
    private readonly onPanelKeydown = (e: KeyboardEvent): void => {
        if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
        const list = this.focusables();
        if (list.length === 0) return;
        const at = list.indexOf(this.doc.activeElement as HTMLElement);
        const step = e.shiftKey ? -1 : 1;
        const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : at + step;
        // At either END the browser keeps the keystroke: Shift+Tab from the first control
        // returns to the trigger, Tab from the last one leaves the panel. A popover that
        // wraps its own focus is a keyboard trap — the thing this round set out to fix.
        if (next < 0 || next >= list.length) return;
        e.preventDefault();
        list[next]!.focus({ preventScroll: false });
    };

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
        // Focus was inside the panel (a keyboard user) → hand it back to the trigger
        // rather than dropping it on <body>, which loses the user's place.
        if (this.layer.contains(this.doc.activeElement)) this.opts.trigger.focus({ preventScroll: true });
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
        this.drag.destroy();
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
                b.addEventListener('keydown', (e) => this.onPresetKey(e));
                row.appendChild(b);
            }
            this.presetsEl.appendChild(row);
        }
        // The presets are a single choice — say so, and spend ONE tab stop on it. Before
        // this each of the 32 presets was its own tab stop: eleven presses to walk past a
        // list you were not going to use (measured, tab-stop probe).
        this.presetsEl.setAttribute('role', 'radiogroup');
        this.presetsEl.setAttribute('aria-label', 'Layout presets');
        const buttons = [...this.presetsEl.querySelectorAll<HTMLButtonElement>('.vela-lp-preset')];
        const chosen = buttons.findIndex((b) => b.dataset.checked === '1');
        buttons.forEach((b, i) => {
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(b.dataset.checked === '1'));
            b.tabIndex = i === (chosen >= 0 ? chosen : 0) ? 0 : -1;
        });
    }

    /** Arrow keys walk the presets, Home/End jump to the ends; Enter/Space choose (the
     *  button's own click). Same contract as the link-tab radiogroup below it. */
    private onPresetKey(e: KeyboardEvent): void {
        const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const list = [...this.presetsEl.querySelectorAll<HTMLButtonElement>('.vela-lp-preset')];
        if (list.length === 0) return;
        const at = list.indexOf(this.doc.activeElement as HTMLButtonElement);
        const rtl = isRtl(this.presetsEl);
        const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (rtl && e.key === 'ArrowLeft' ? 1 : -1) : e.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0;
        let next = at < 0 ? 0 : at + step;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = list.length - 1;
        e.preventDefault();
        e.stopPropagation(); // the panel's Tab walk must not also move
        const target = list[Math.max(0, Math.min(list.length - 1, next))]!;
        for (const b of list) b.tabIndex = -1;
        target.tabIndex = 0;
        target.focus({ preventScroll: true });
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
    private beginRename(row: HTMLElement, label: HTMLElement, from: string, apply?: (from: string, to: string) => boolean): void {
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
            const ok = (apply ?? this.opts.onRenameLayout)?.(from, to) ?? false;
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

    /**
     * Copy the permalink and SAY SO on the button itself. A copy action that reports
     * nothing is indistinguishable from a broken one, and a toast for this is noise:
     * the label flips to "Copied" (and the title/aria-label with it) for 1.6 s.
     */
    private async copyShare(btn: HTMLElement): Promise<void> {
        const url = await this.opts.onCopyLink?.();
        if (!url) return;
        btn.dataset.copied = '1';
        btn.title = 'Link copied to the clipboard';
        btn.setAttribute('aria-label', 'Share link copied');
        const win = this.doc.defaultView;
        const clear = (): void => {
            delete btn.dataset.copied;
            btn.title = 'Copy a link that restores this exact workspace';
            btn.setAttribute('aria-label', 'Copy share link');
        };
        if (win) win.setTimeout(clear, 1600);
        else clear();
    }

    /** Per-layout link: same flip-to-copied language as the workspace permalink. */
    private async shareLayout(btn: HTMLElement, name: string): Promise<void> {
        const url = await this.opts.onShareLayout?.(name);
        if (!url) {
            btn.title = 'This layout is too large to travel in a link';
            btn.setAttribute('aria-label', 'Layout too large to share as a link');
            return;
        }
        btn.dataset.copied = '1';
        btn.title = 'Link copied to the clipboard';
        btn.setAttribute('aria-label', `Link to ${name} copied`);
        const win = this.doc.defaultView;
        const clear = (): void => {
            delete btn.dataset.copied;
            btn.title = `Copy a link to “${name}”`;
            btn.setAttribute('aria-label', `Copy a link to ${name}`);
        };
        if (win) win.setTimeout(clear, 1600);
        else clear();
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

    /** A file-import action: one icon in the row that owns it (label in title + aria). */
    private importButton(label: string, title: string, run: () => void, glyph = 'upload'): HTMLButtonElement {
        const b = this.doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-lp-importbtn';
        b.title = title;
        b.setAttribute('aria-label', label);
        b.appendChild(iconEl(glyph, this.doc));
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
        // Desktop split: the grid panel keeps its OWN controls and offers exactly one
        // door to the separate management popover. No autosave/save/export/import/template
        // controls are mixed into Layout setup.
        if (this.opts.setupOnly) {
            const door = doc.createElement('button');
            door.type = 'button';
            door.className = 'vela-lp-managerdoor';
            door.dataset.action = 'manage-layouts';
            door.setAttribute('aria-label', 'Manage layouts — save, autosave, share and export');
            door.append(iconEl('layout', doc), doc.createTextNode('Manage layouts…'));
            door.addEventListener('click', () => this.opts.onOpenManager?.(door));
            this.footEl.appendChild(door);
        }
        const saved = this.opts.savedLayouts;
        if (!this.opts.setupOnly && saved) {
            // ── the open layout, its drift, and autosave ──
            const active = this.opts.activeLayout?.() ?? null;
            const dirty = (saved() ?? []).some((l) => l.dirty);
            if (active) {
                const strip = doc.createElement('div');
                strip.className = 'vela-lp-open';
                const nameWrap = doc.createElement('span');
                nameWrap.className = 'vela-lp-openname';
                if (dirty) {
                    const dot = doc.createElement('span');
                    dot.className = 'vela-lp-dot';
                    dot.setAttribute('aria-hidden', 'true');
                    nameWrap.appendChild(dot);
                }
                const bold = doc.createElement('b');
                bold.textContent = active;
                bold.title = active;
                nameWrap.appendChild(bold);
                const state = doc.createElement('span');
                // Words AND the dot: colour is never the only carrier (WCAG 1.4.1).
                state.className = 'vela-lp-auto-hint';
                state.textContent = dirty ? 'unsaved changes' : 'saved';
                nameWrap.appendChild(state);
                strip.appendChild(nameWrap);
                if (dirty && this.opts.onSaveChanges) {
                    const b = doc.createElement('button');
                    b.type = 'button';
                    b.textContent = 'Save changes';
                    b.setAttribute('aria-label', `Save changes to “${active}”`);
                    b.addEventListener('click', () => {
                        this.opts.onSaveChanges?.();
                        this.renderFooter();
                    });
                    strip.appendChild(b);
                }
                this.footEl.appendChild(strip);
            }
            if (this.opts.onToggleAutosave) {
                const auto = doc.createElement('button');
                auto.type = 'button';
                auto.className = 'vela-lp-auto';
                auto.setAttribute('role', 'switch');
                const on = this.opts.autosave?.() === true;
                auto.setAttribute('aria-checked', String(on));
                auto.title = on ? 'Autosave is on — the open layout follows every change' : 'Turn autosave on: the open layout follows every change';
                const label = doc.createElement('span');
                label.className = 'vela-lp-label';
                label.textContent = 'Autosave';
                const hint = doc.createElement('span');
                hint.className = 'vela-lp-auto-hint';
                hint.textContent = on ? 'on' : 'off';
                const pill = doc.createElement('span');
                pill.className = 'vela-lp-switch' + (on ? ' on' : '');
                pill.setAttribute('aria-hidden', 'true');
                auto.append(label, hint, pill);
                auto.addEventListener('click', () => {
                    this.opts.onToggleAutosave?.(!on);
                    this.renderFooter();
                });
                this.footEl.appendChild(auto);
            }
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
            if (this.opts.onCopyLink) {
                // Share sits with save/import because it IS a save — to a URL instead of a
                // file. The glyph is a chain, not a page-arrow: import/export already own
                // the arrow verbs and a link is neither.
                const share = this.importButton(
                    'Copy share link',
                    'Copy a link that restores this exact workspace',
                    () => {
                        void this.copyShare(share);
                    },
                    'link',
                );
                share.classList.add('vela-lp-sharebtn');
                form.appendChild(share);
            }
            this.footEl.appendChild(form);
            // Export chart data — the sheet's only non-layout file. Two scopes, side by
            // side and always visible: the whole dataset for a spreadsheet, or just the
            // window the trader is looking at (the same split TradingView offers).
            if (this.opts.onExportData) {
                const csv = doc.createElement('div');
                csv.className = 'vela-lp-csv';
                const cap = doc.createElement('span');
                cap.className = 'vela-lp-csvcap';
                cap.textContent = 'Export chart data';
                csv.appendChild(cap);
                // Time format: TradingView's dialog offers ISO and UNIX; ours is one chip
                // that always SHOWS the active choice, because a hidden mode is a trap.
                let timeFormat: CsvTimeFormat = 'iso';
                const fmt = doc.createElement('button');
                fmt.type = 'button';
                fmt.className = 'vela-lp-csvseg';
                const paintFmt = (): void => {
                    fmt.textContent = timeFormat === 'iso' ? 'ISO' : 'UNIX';
                    fmt.dataset.on = timeFormat === 'unix' ? '1' : '0';
                    fmt.title =
                        timeFormat === 'iso'
                            ? 'Time column: ISO-8601 (click for UNIX milliseconds)'
                            : 'Time column: UNIX milliseconds (click for ISO-8601)';
                };
                paintFmt();
                fmt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    timeFormat = timeFormat === 'iso' ? 'unix' : 'iso';
                    paintFmt();
                });
                for (const [scope, label, title] of [
                    ['visible', 'Visible', 'Save only the bars currently in view as CSV'],
                    ['all', 'All', 'Save every loaded bar as CSV'],
                ] as const) {
                    const b = doc.createElement('button');
                    b.type = 'button';
                    b.className = 'vela-lp-csvseg';
                    b.textContent = label;
                    b.title = title;
                    b.setAttribute('aria-label', `Export chart data — ${label.toLowerCase()} range as CSV`);
                    b.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const res = this.opts.onExportData?.(scope, timeFormat);
                        // The receipt is the point: a download the browser swallows is
                        // otherwise indistinguishable from a dead button.
                        if (res) {
                            cap.textContent = `${res.rows} bars · ${timeFormat === 'iso' ? 'ISO' : 'UNIX'} · ${res.filename}`;
                            cap.dataset.done = '1';
                            setTimeout(() => {
                                cap.textContent = 'Export chart data';
                                delete cap.dataset.done;
                            }, 2600);
                        }
                    });
                    csv.appendChild(b);
                }
                csv.appendChild(fmt);
                this.footEl.appendChild(csv);
            }
            // TradingView's "Open layout…" is a searchable list; ours only needs the
            // search once the list is long enough that scanning costs more than typing.
            const total = saved().length;
            if (total >= 8) {
                const filter = doc.createElement('input');
                filter.type = 'text';
                filter.className = 'vela-lp-filter';
                filter.placeholder = `Filter ${total} layouts…`;
                filter.setAttribute('aria-label', 'Filter saved layouts');
                filter.addEventListener('input', () => {
                    const q = filter.value.trim().toLowerCase();
                    for (const el of this.footEl.querySelectorAll<HTMLElement>('.vela-lp-saved')) {
                        el.hidden = q !== '' && !(el.dataset.layout ?? '').toLowerCase().includes(q);
                    }
                });
                filter.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                        filter.value = '';
                        filter.dispatchEvent(new Event('input'));
                    }
                });
                this.footEl.appendChild(filter);
            }
            for (const l of saved()) {
                const row = doc.createElement('div');
                row.className = 'vela-lp-saved';
                row.dataset.layout = l.name;
                if (l.active) row.dataset.active = '1';
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
                name.setAttribute('role', 'button');
                name.tabIndex = 0;
                name.addEventListener('click', () => this.opts.onOpenLayout?.(l.name));
                name.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    this.opts.onOpenLayout?.(l.name);
                });
                row.append(name);
                if (typeof l.charts === 'number' || typeof l.indicators === 'number') {
                    const meta = doc.createElement('span');
                    meta.className = 'vela-lp-rowmeta';
                    const bits: string[] = [];
                    if (typeof l.charts === 'number') bits.push(`${l.charts} chart${l.charts === 1 ? '' : 's'}`);
                    if (typeof l.indicators === 'number') bits.push(`${l.indicators} ind`);
                    meta.textContent = bits.join(' · ');
                    row.appendChild(meta);
                }
                if (l.dirty) {
                    const dot = doc.createElement('span');
                    dot.className = 'vela-lp-dot';
                    dot.title = 'Unsaved changes';
                    dot.setAttribute('aria-label', 'Unsaved changes');
                    row.appendChild(dot);
                }
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
                if (this.opts.onDuplicateLayout) row.appendChild(this.savedAction('clone', `Duplicate “${l.name}”`, () => {
                    this.opts.onDuplicateLayout?.(l.name);
                    this.renderFooter();
                }));
                if (this.opts.onExportLayout) row.appendChild(this.savedAction('download', `Export ${l.name} as JSON`, () => {
                    const json = this.opts.onExportLayout?.(l.name);
                    if (json) downloadText(this.doc, `${l.name}.vela-layout.json`, json);
                }));
                // SHARE THIS ONE LAYOUT — a link that lands the recipient in this exact
                // layout, imported through the same sanitizer as a file. Same "say it on
                // the button" rule as the workspace permalink above.
                if (this.opts.onShareLayout) {
                    const share = this.savedAction('link', `Copy a link to “${l.name}”`, () => {
                        void this.shareLayout(share, l.name);
                    });
                    row.appendChild(share);
                }
                const del = this.savedAction('trash', `Delete ${l.name}`, () => {
                    this.opts.onDeleteLayout?.(l.name);
                    this.renderFooter();
                });
                row.appendChild(del);
                this.footEl.appendChild(row);
            }
        }
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
            // A single-choice control, so it says so: a radiogroup with arrow-key
            // selection beats five unrelated buttons whose state lived only in a
            // data-attribute. (The old dots also carried no aria-state at all.)
            links.setAttribute('role', 'radiogroup');
            links.setAttribute('aria-label', 'Link tabs');
            const current = this.opts.linkGroup?.() ?? null;
            // NEUTRAL by design: four identity-coloured dots competed with the sync marks
            // two rows above them and meant nothing to anyone who had not read the TV
            // desktop docs. The tag is a NUMBER now, colour is reserved for groups, and
            // the selected set is an outline — information no longer depends on hue.
            const dots: HTMLButtonElement[] = [];
            for (const [i, tag] of ([null, 'red', 'green', 'blue', 'amber'] as const).entries()) {
                const dot = doc.createElement('button');
                dot.type = 'button';
                dot.className = 'vela-lp-linkdot';
                dot.dataset.tag = tag ?? 'none';
                dot.textContent = tag ? String(i) : '—';
                dot.title = tag ? `Link to other tabs in set ${i}` : 'Unlink tabs';
                const picked = (current ?? null) === tag;
                dot.setAttribute('role', 'radio');
                dot.setAttribute('aria-checked', String(picked));
                dot.setAttribute('aria-label', dot.title);
                dot.tabIndex = picked ? 0 : -1; // one tab stop for the whole group
                if (picked) dot.dataset.on = '1';
                dot.addEventListener('click', () => {
                    this.opts.onLinkGroup?.(tag);
                    this.renderFooter();
                });
                dots.push(dot);
                links.appendChild(dot);
            }
            // Roving arrow keys, direction-aware: in RTL "next" is to the left.
            links.addEventListener('keydown', (e) => {
                const at = dots.indexOf(doc.activeElement as HTMLButtonElement);
                if (at < 0) return;
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                e.stopPropagation();
                const step = (e.key === 'ArrowRight' ? 1 : -1) * (isRtl(links) ? -1 : 1);
                const next = dots[(at + step + dots.length) % dots.length]!;
                next.focus({ preventScroll: true });
                next.click();
            });
            if (dots.length > 0 && !dots.some((d) => d.tabIndex === 0)) dots[0]!.tabIndex = 0;
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
