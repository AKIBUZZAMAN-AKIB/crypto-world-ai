// The three-dots drawer (mobile) — the catch-all for everything the hidden topbar and
// desktop bottombar used to carry: undo/redo/screenshot as an action row, then rows for
// chart type, the multi-chart layout (workspace shells), the side panels (data window,
// object tree, contributed), alerts, and every contributed topbar action. Chart type,
// layout and alerts open as IN-DRAWER sub-views with a back button — a drawer inside a
// drawer would stack sheets. Time zone lives on a long-press of the time axis (see
// `timezone-drawer.ts`), not here.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { downloadText } from '../ui/download';
import { injectStyles } from '../ui/styles';
import { SyncMatrix } from './sync-matrix';
import { layoutGridCanvas, paintLayoutGrid } from './layout-picker';
import { IMPLICIT_GROUP } from '../state/document';
import { groupMarkColor } from '../workspace/sync-marks';
import { CURSOR_SPECS, cursorSpec, type CursorStyle } from '../core/cursor';

const STYLE_ID = 'vela-widget-more-drawer';
/** "just now" / "3h ago" / "2d ago" — a saved row's second line. */
function agoLabel(ms: number): string {
    const diff = Date.now() - ms;
    if (!Number.isFinite(diff) || diff < 0) return '';
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
}

const CSS = `

/* Share: the hero card's one action. 44px tall, so it is a thumb target even though it
   sits inside a card; the copied state flips the ink and the label for 1.6 s. */
.vela-md-share {
    all: unset;
    flex: none;
    align-self: center;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--vela-border);
    color: var(--vela-fg);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-share .vela-icon { font-size: 15px; width: 15px; height: 15px; }
.vela-md-share:active { background: var(--vela-hover); }
.vela-md-share[data-copied='1'] { color: var(--vela-up); border-color: color-mix(in srgb, var(--vela-up) 55%, transparent); }
.vela-md-share[data-copied='0'] { color: var(--vela-down); border-color: color-mix(in srgb, var(--vela-down) 55%, transparent); }
@media (pointer: coarse) {
    .vela-md-share { height: 44px; padding: 0 14px; font-size: 13.5px; }
    /* The sheet's tab bar is navigation, not a caption: a thumb needs the full 44.
       Scoped to .vela-md-nav so it beats the later base rule regardless of source order. */
    .vela-md-nav .vela-md-navbtn { min-height: 44px; }
}
.vela-md-actions {
    display: flex;
    gap: 6px;
    padding: 2px 2px 10px;
    border-bottom: 1px solid var(--vela-border);
}
.vela-md-action {
    all: unset;
    flex: 1 1 0;
    min-height: 48px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 8px;
    font-size: 11px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-action:active { background: var(--vela-hover); }
.vela-md-action:disabled { opacity: 0.35; cursor: default; }
.vela-md-action .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-md-list { padding: 6px 0 4px; }
.vela-md-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-row:active { background: var(--vela-hover); }
.vela-md-row[data-checked='1'] { background: var(--vela-hover-strong); }
.vela-md-row .vela-icon { flex: none; font-size: 17px; width: 17px; height: 17px; color: var(--vela-fg-muted); }
.vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-row-value { flex: none; font-size: 13px; color: var(--vela-fg-muted); }
.vela-md-back {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
    border-bottom: 1px solid var(--vela-border);
    width: 100%;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}
/* The layout sub-view's grid canvas, centered and touch-sized (the base .vela-lp-grid
   squares are popover-sized for a mouse). */
.vela-md-gridwrap { display: flex; justify-content: center; padding: 14px 0 10px; }
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 44px); grid-auto-rows: 44px; gap: 8px; }
.vela-md-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-md-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
/* Layout sheet: glyph tiles, three across on a phone, larger where there is room. */
/* The uniform-grid canvas, phone-sized: 20px squares keep the 4×4 block compact so the
   asymmetric presets below it are one small scroll away, not a page. */
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 20px); grid-auto-rows: 20px; gap: 3px; }
.vela-md-gridwrap { padding: 4px 0 2px; }
.vela-md-presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
    padding: 2px 0 4px;
}
.vela-md-preset {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-height: 76px;
    padding: 10px 6px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 10px;
    background: var(--vela-panel);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-preset:active { background: var(--vela-hover); }
.vela-md-preset[data-checked='1'] {
    border-color: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 65%, transparent);
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 14%, transparent);
}
.vela-md-preset-glyph { display: block; width: 40px; height: 30px; color: var(--vela-fg-muted); }
.vela-md-preset[data-checked='1'] .vela-md-preset-glyph { color: var(--vela-fg-bright); }
.vela-md-preset-glyph svg { display: block; width: 100%; height: 100%; }
.vela-md-preset-label {
    font-size: 10.5px;
    line-height: 1.25;
    text-align: center;
    color: var(--vela-fg-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.vela-md-preset[data-checked='1'] .vela-md-preset-label { color: var(--vela-fg-bright); }
/* A sync row is a SWITCH, not a tinted list item: the track/thumb is the same language
   the desktop dropdown uses (.vela-lp-switch), sized for a thumb. */
.vela-md-sync {
    all: unset;
    box-sizing: border-box;
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-sync:active { background: var(--vela-hover); }
.vela-md-sync:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-sync .vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-switch {
    flex: none;
    position: relative;
    width: 40px;
    height: 24px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--vela-fg) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-fg) 14%, transparent);
    transition: background 120ms ease;
}
.vela-md-switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--vela-fg-bright);
    transition: transform 120ms ease, background 120ms ease;
}
.vela-md-sync[aria-checked='true'] .vela-md-switch { background: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-sync[aria-checked='true'] .vela-md-switch::after { transform: translateX(16px); background: #fff; }
/* The group chip: the ACTIVE chart's mark for this link, and its own tap target. */
.vela-md-chip:active { background: var(--vela-hover); }
.vela-md-hint { padding: 2px 2px 8px; font-size: 12px; line-height: 1.4; color: var(--vela-fg-muted); }
/* ── Layout setup: the hero card + the sticky two-stop nav ─────────────────────── */
.vela-md-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 2px 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--vela-border);
    border-radius: 12px;
    background: var(--vela-surface-elev);
}
.vela-md-hero-glyph { flex: none; width: 34px; height: 26px; color: var(--vela-fg-bright); }
.vela-md-hero-glyph svg { display: block; width: 100%; height: 100%; }
.vela-md-hero-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vela-md-hero-text b { font-size: 14px; font-weight: 600; color: var(--vela-fg-bright); }
.vela-md-hero-text small { font-size: 11.5px; color: var(--vela-fg-muted); }
.vela-md-nav {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 6px;
    padding: 6px 0;
    background: var(--vela-surface-elev);
    border-bottom: 1px solid var(--vela-border);
}
/* The two tabs share one track — an inactive tab must read as a tab, not as a label. */
.vela-md-navtrack {
    flex: 1 1 auto;
    display: flex;
    gap: 2px;
    min-width: 0;
    padding: 3px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vela-fg) 8%, transparent);
}
.vela-md-navback {
    all: unset;
    flex: none;
    width: 40px;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navback:active { background: var(--vela-hover); }
.vela-md-navback .vela-icon { font-size: 16px; width: 16px; height: 16px; }
.vela-md-navbtn {
    all: unset;
    box-sizing: border-box;
    flex: 1 1 0;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navbtn[data-active] {
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 22%, transparent);
    color: var(--vela-fg-bright);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 55%, transparent);
}
/* [hidden] must WIN over the section's own display — a plain [hidden] loses to
   any class that sets display, and both tabs would show at once. */
.vela-md-sec { display: block; min-width: 0; }
.vela-md-sec[hidden] { display: none !important; }

/* ── Chart syncing: the switches, then the link × chart table ───────────────── */
.vela-md-sublabel {
    padding: 10px 2px 4px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
/* The table scrolls SIDEWAYS INSIDE ITSELF — never the page. Four charts fit a 390px
   sheet; the eight-chart layouts scroll a little, with the link column pinned. */
/* Only while there IS more table to the right (set from JS after layout). */
.vela-md-legend {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 2px 2px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--vela-fg-muted);
}
/* ── Layout setup: the hero card + the sticky two-stop nav ─────────────────────── */
.vela-md-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 2px 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--vela-border);
    border-radius: 12px;
    background: var(--vela-surface-elev);
}
.vela-md-hero-glyph { flex: none; width: 34px; height: 26px; color: var(--vela-fg-bright); }
.vela-md-hero-glyph svg { display: block; width: 100%; height: 100%; }
.vela-md-hero-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vela-md-hero-text b { font-size: 14px; font-weight: 600; color: var(--vela-fg-bright); }
.vela-md-hero-text small { font-size: 11.5px; color: var(--vela-fg-muted); }
.vela-md-nav {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 6px;
    padding: 6px 0;
    background: var(--vela-surface-elev);
    border-bottom: 1px solid var(--vela-border);
}
/* The two tabs share one track — an inactive tab must read as a tab, not as a label. */
.vela-md-navtrack {
    flex: 1 1 auto;
    display: flex;
    gap: 2px;
    min-width: 0;
    padding: 3px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vela-fg) 8%, transparent);
}
.vela-md-navback {
    all: unset;
    flex: none;
    width: 40px;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navback:active { background: var(--vela-hover); }
.vela-md-navback .vela-icon { font-size: 16px; width: 16px; height: 16px; }
.vela-md-navbtn {
    all: unset;
    box-sizing: border-box;
    flex: 1 1 0;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navbtn[data-active] {
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 22%, transparent);
    color: var(--vela-fg-bright);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 55%, transparent);
}
/* [hidden] must WIN over the section's own display — a plain [hidden] loses to
   any class that sets display, and both tabs would show at once. */
.vela-md-sec { display: block; min-width: 0; }
.vela-md-sec[hidden] { display: none !important; }

/* ── Chart syncing: links (switches) then charts (expanding rows) ───────────── */
.vela-md-sublabel {
    padding: 10px 2px 4px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-md-chart {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-chart:active { background: var(--vela-hover); }
.vela-md-chart:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-chart .vela-md-row-label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13.5px;
    color: var(--vela-fg);
}
.vela-md-chart[data-active] .vela-md-row-label { color: var(--vela-fg-bright); font-weight: 600; }
.vela-md-chart-caret {
    flex: none;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-muted);
    transition: transform 130ms ease;
}
.vela-md-chart-caret .vela-icon { font-size: 15px; width: 15px; height: 15px; }
.vela-md-chart[data-open] .vela-md-chart-caret { transform: rotate(90deg); }
.vela-md-chart-tag {
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--vela-accent, var(--vela-selected-bg));
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 16%, transparent);
}
/* The aggregate badge: every DISTINCT group this chart sits in, e.g. "A 🔴". */
.vela-md-chart-marks {
    flex: none;
    min-width: 24px;
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--vela-fg-muted);
    background: color-mix(in srgb, var(--vela-fg) 8%, transparent);
}
.vela-md-chart-marks:not([data-on]) { opacity: 0; }
.vela-md-chart-marks[data-on] {
    color: var(--vela-fg-bright);
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 20%, transparent);
}
/* The expansion: one full-width row per link. Nothing here scrolls sideways. */
.vela-md-chart-links {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 6px 24px;
    padding: 2px 0 2px 10px;
    border-left: 1px solid var(--vela-border);
}
.vela-md-chart-links[hidden] { display: none !important; }
.vela-md-chart-link {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    min-width: 0;
}
.vela-md-chart-link-label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: var(--vela-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-md-chart-link .vela-md-chip { min-width: 64px; height: 36px; border-radius: 18px; }
.vela-md-chart-all { margin-top: 4px; border-top: 1px solid var(--vela-border); }
.vela-md-chart-all .vela-md-row-label { color: var(--vela-fg-muted); font-size: 12.5px; }
/* A plain action row (no switch): same rhythm, the value as a pill. */
.vela-md-sync.vela-md-plain .vela-md-pill {
    flex: none;
    padding: 3px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
}
/* Save-as field (TV's \"Save layout as…\"). */
/* The three per-row verbs are ICONS, not three more boxes: on a 390 px row four
   outlines read as four equally-important actions. The Open pill keeps its border;
   the rest stay quiet until touched (their 34 px hit area is unchanged). */
/* The open layout's strip: name + state on the left, Save on the right. */
/* "Show all N layouts": a quiet row, not a button-shaped box. */
/* The library's own top gap: it opens the sheet, so it needs air above the actions. */
/* ── the Cursors stop ─────────────────────────────────────────────────────────
   56 px rows: a pointer choice needs two lines (name + what it does) and a finger.
   The glyph sits in its own slot so all seven icons line up like a type specimen. */
.vela-md-cursors { padding-top: 4px; }
.vela-md-cursorrow {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 6px 8px;
    border-radius: 10px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-cursorrow:active { background: var(--vela-hover); }
.vela-md-cursorrow[data-active] { background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 12%, transparent); }
.vela-md-cursorrow:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-cursorglyph { flex: none; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; color: var(--vela-fg-muted); }
.vela-md-cursorglyph svg { width: 24px; height: 24px; }
.vela-md-cursorrow[data-active] .vela-md-cursorglyph { color: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-cursortext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-md-cursorlabel { font-size: 14px; color: var(--vela-fg-bright); }
.vela-md-cursorsub { font-size: 11.5px; color: var(--vela-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The choice dot: an outline that fills when this pointer is the one in use. */
.vela-md-cursorcheck {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--vela-border-strong);
    position: relative;
}
.vela-md-cursorrow[data-active] .vela-md-cursorcheck { border-color: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-cursorrow[data-active] .vela-md-cursorcheck::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--vela-accent, var(--vela-selected-bg));
}
.vela-md-lib { padding-top: 2px; padding-bottom: 0; }
/* The library and the settings rows are two lists in one scroll: give the second
   one a heading, but not a second page's worth of air between them. */
.vela-md-charthead { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--vela-border); }
/* Autosave's row: a real switch row, not a stray native button — the dialog's row
   primitive is all:unset + flex, and a class without it paints UA white on dark. */
.vela-md-switchrow {
    all: unset;
    box-sizing: border-box;
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-switchrow:active { background: var(--vela-hover); }
.vela-md-switchrow:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-switchrow[aria-checked='true'] .vela-md-switch { background: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-switchrow[aria-checked='true'] .vela-md-switch::after { transform: translateX(16px); background: #fff; }
.vela-md-row[data-danger='1'] .vela-md-row-value { color: var(--vela-danger); }
.vela-md-rename {
    flex: 1 1 auto;
    min-width: 0;
    background: var(--vela-hover);
    border: 1px solid var(--vela-selected-bg);
    border-radius: 6px;
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
}
.vela-md-rename[data-refused] { border-color: var(--vela-danger); }
.vela-md-saveas { display: flex; gap: 8px; padding: 4px 0 8px; }
/* A muted one-line subtitle inside a switch row (Autosave's "saving as you edit"). */
.vela-md-row-sub { flex: none; font-size: 11.5px; color: var(--vela-fg-muted); }
/* A saved layout's preview: 56×34 — big enough to recognise the grid at a glance. */
/* The house-template star: 30px square so it is a real target, and gold only when on. */
/* The legend under the matrix: mark + the name the user gave the group. */
.vela-md-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 2px 2px 6px; }
.vela-md-leg { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--vela-fg-muted); min-height: 26px; }
.vela-md-leg button { all: unset; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
/* The glyph is a BUTTON (it opens a two-character editor), 26px because a phone finger
   needs a target and because the legend is the only place a custom mark is set. */
.vela-md-leg button.vela-md-legmark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    min-height: 26px;
    max-width: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease);
}
.vela-md-leg button.vela-md-legmark:active { background: var(--vela-hover-strong); }
.vela-md-leg button.vela-md-legmark:disabled { cursor: default; }
.vela-md-leg input { width: 90px; height: 26px; padding: 0 6px; border: 1px solid var(--vela-selected-bg); border-radius: 6px; background: var(--vela-hover); color: var(--vela-fg-bright); font: inherit; font-size: 11.5px; }
.vela-md-saveas input {
    flex: 1 1 auto;
    min-width: 0;
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    background: var(--vela-bg, transparent);
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-family: inherit;
}
.vela-md-saveas input::placeholder { color: var(--vela-fg-faint, var(--vela-fg-muted)); }
.vela-md-saveas button {
    all: unset;
    flex: none;
    padding: 0 14px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    background: var(--vela-accent, var(--vela-selected-bg));
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.vela-md-saveas button:disabled { opacity: 0.4; }

/* ── the layout library: two panes, one row language ────────────────────────── */
.vela-md-libhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px; }
/* The sheet's tab strip is sticky and 50-ish px tall: anything that scrolls into view
   (a focused field, a kebab opened far down the list) must stop BELOW it, not under it. */
.vela-md-libhead, .vela-md-libpane { scroll-margin-top: 56px; }
.vela-md-libhead .vela-md-section { padding: 0; margin: 0; }
/* The toggle: two stops, 30 px tall, the selected one lifted — a segmented control,
   not two buttons that both look pressable. */
.vela-md-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: color-mix(in srgb, var(--vela-fg) 8%, transparent); }
.vela-md-segbtn {
    all: unset;
    box-sizing: border-box;
    min-width: 74px;
    min-height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 12px;
    text-align: center;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-segbtn[data-active] { background: var(--vela-elevated, var(--vela-hover-strong)); color: var(--vela-fg-bright); }
.vela-md-segbtn:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: 1px; }
.vela-md-libpane { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; }

/* The open layout: one line, name + state, and a Save pill only when it has drifted. */
.vela-md-lopen { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 2px; }
.vela-md-lopen .vela-md-ltext { flex: 1 1 auto; min-width: 0; }
.vela-md-lopen b { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-lopen small { display: block; font-size: 11px; color: var(--vela-fg-muted); }
.vela-md-pill {
    all: unset;
    flex: none;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: var(--vela-accent, var(--vela-selected-bg));
    color: #fff;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
}
.vela-md-pill:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: 2px; }

/* A row: tap to use, the kebab to manage. Nothing else. */
.vela-md-lrow { position: relative; display: flex; align-items: center; gap: 4px; min-height: 48px; border-radius: 9px; }
.vela-md-lrow[data-active] { background: var(--vela-hover); }
.vela-md-lrow[data-active]::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px; border-radius: 1px; background: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-lrow.renaming { padding: 4px 2px; }
.vela-md-lmain {
    all: unset;
    box-sizing: border-box;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 2px 0 8px;
    border-radius: 9px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-lmain:active { background: var(--vela-hover-strong); }
.vela-md-lmain:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-ltext { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vela-md-ltext b { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-ltext small { font-size: 11px; color: var(--vela-fg-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-lswatch {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-fg) 18%, transparent);
}
.vela-md-lthumb { flex: none; width: 44px; height: 28px; border-radius: 4px; object-fit: cover; border: 1px solid var(--vela-border); background: var(--vela-hover); }
/* The drift dot: small, filled, and never the only signal (the state is in words too). */
.vela-md-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-lkebab {
    all: unset;
    flex: none;
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-lkebab .vela-icon { width: 18px; height: 18px; font-size: 18px; }
.vela-md-lkebab[aria-expanded='true'] { color: var(--vela-fg-bright); background: color-mix(in srgb, var(--vela-fg) 10%, transparent); }
.vela-md-lkebab:active { background: var(--vela-hover); }
.vela-md-lkebab:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
/* The unfolded verbs: text on one line, 40 px tall, delete in the down colour. */
.vela-md-lacts { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 6px 10px; }
.vela-md-lact {
    all: unset;
    box-sizing: border-box;
    min-height: 36px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-lact:active { background: var(--vela-hover-strong); }
.vela-md-lact:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-lact[data-danger] { color: var(--vela-down); }
.vela-md-linput { flex: 1 1 auto; min-width: 0; box-sizing: border-box; min-height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--vela-border); background: var(--vela-hover); color: var(--vela-fg-bright); font: inherit; font-size: 14px; }
.vela-md-linput:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -1px; }
.vela-md-linput[data-refused] { border-color: var(--vela-down); }
/* The house template: a star that is a state, not a verb. */
.vela-md-star {
    all: unset;
    flex: none;
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-star .vela-icon { width: 18px; height: 18px; font-size: 18px; color: var(--vela-fg-faint); }
.vela-md-star[data-on='1'] .vela-icon { color: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-star:active { background: var(--vela-hover); }
.vela-md-star:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
/* "Show all N" and the two "+ save" / "import" entry points: quiet rows, no boxes. */
.vela-md-more, .vela-md-lghost {
    all: unset;
    box-sizing: border-box;
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-more { justify-content: space-between; }
.vela-md-more .vela-icon { width: 14px; height: 14px; font-size: 14px; transform: rotate(0deg); transition: transform 120ms ease; }
.vela-md-more[aria-expanded='true'] .vela-icon { transform: rotate(180deg); }
.vela-md-lghost { color: var(--vela-fg); }
.vela-md-lghost .vela-icon { width: 15px; height: 15px; font-size: 15px; color: var(--vela-fg-muted); }
.vela-md-lghost:active, .vela-md-more:active { background: var(--vela-hover); }
.vela-md-lghost:focus-visible, .vela-md-more:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }

`;

/** Paint a group chip: its mark, lit when it is in a group, dashed while it is the
 *  IMPLICIT all-cells group (every chart follows, so the mark is 'A' rather than an
 *  emoji the user picked), and an em-dash when the chart does not follow the link. */
function syncChipState(chip: HTMLElement, mark: string | undefined): void {
    const text = mark ?? '–';
    if (chip.textContent !== text) chip.textContent = text;
    if (mark) chip.dataset.on = '1';
    else delete chip.dataset.on;
    if (mark === IMPLICIT_GROUP) chip.dataset.implicit = '1';
    else delete chip.dataset.implicit;
    // The group's own hue: ten groups have to LOOK like ten groups, not one accent.
    const color = groupMarkColor(mark);
    if (color) chip.style.setProperty('--vela-md-mark', color);
    else chip.style.removeProperty('--vela-md-mark');
}

export interface MoreDrawerAction {
    label: string;
    icon?: string;
    run: () => void;
}

export interface MoreDrawerOptions {
    host: HTMLElement;
    /** Omitted (with onRedo) ⇒ no undo/redo action buttons — the shell's topbar
     *  composition removed `'undo-redo'`; the keyboard chords are the shell's call. */
    onUndo?: () => void;
    onRedo?: () => void;
    /** Omitted ⇒ no screenshot action button (composition removed `'screenshot'`). */
    onScreenshot?: () => void;
    /** Bar replay entry — opens the shell's replay menu. Omitted (with the composition's
     *  `'replay'` removed, or a shell without replay) ⇒ no Replay action button. */
    onReplay?: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Chart style list + current selection (read live at open). */
    priceStyles: () => Array<{ id: string; label: string; icon?: string }>;
    priceStyle: () => string;
    onPriceStyle: (id: string) => void;
    /** Docked side panels (built-in + contributed), toggled by id. */
    panels: () => Array<{ id: string; title: string; icon: string }>;
    onTogglePanel: (id: string) => void;
    /** Omitted ⇒ no Alerts row (composition removed `'alerts'`). */
    alerts?: () => Array<{ title: string; message: string; time: number }>;
    /** "Reset chart view" — the desktop chart-body menu's one row a phone has no other
     *  door to (right-click is the crosshair hold here). Omitted ⇒ no row. */
    onResetView?: () => void;
    /** The display time zone, read live at open — the row's value. */
    timezone?: () => string;
    /** Saved DRAWING templates (`{ tool, toolLabel, name, color, settings }`), read live —
     *  the third stop of the library. Omitted ⇒ the stop is hidden. */
    drawingTemplates?: () => Array<{ tool: string; toolLabel: string; name: string; color?: string; settings: unknown }>;
    /** Use a drawing template: the NEXT drawing of that tool starts from it. */
    onApplyDrawingTemplate?: (tool: string, name: string) => void;
    /** Delete one saved drawing template. */
    onDeleteDrawingTemplate?: (tool: string, name: string) => void;
    /** Export one saved drawing template as JSON. */
    onExportDrawingTemplate?: (tool: string, name: string) => string | null;
    /** The pointer style over the plot (Cross / Dot / Arrow / Demonstration / Magic /
     *  Eraser / None), read live — the Cursors row's value. Omitted ⇒ no row. */
    cursorStyle?: () => CursorStyle;
    /** Set the pointer style on every chart (the Cursors stop's radio rows). */
    onCursorStyle?: (style: CursorStyle) => void;
    /** Opens the timezone overflow sheet (the same one a hold on the time axis opens).
     *  Omitted ⇒ no Time zone row. */
    onTimeZone?: () => void;
    /** The desktop chart-body menu (Reset · syncing · apply-to-all · clear · settings) as
     *  a sheet. Omitted ⇒ no "Chart actions…" row. */
    onChartMenu?: () => void;
    /** Contributed topbar actions, projected as plain rows at the end of the list. */
    actions: () => MoreDrawerAction[];
    /** Contributed PRIMARY actions (left cluster, menu-placed) — rows right after Layout. */
    primaryActions?: () => MoreDrawerAction[];
    /** Multi-chart layout switching (workspace shells) — the row is hidden when omitted.
     *  The sub-view carries the SAME surface as the desktop layout dropdown: the 4×4
     *  tap-to-apply grid canvas, the presets the canvas cannot express as rows, and the
     *  sync switches. Everything is read live at open. */
    layout?: {
        /** Current layout's canvas shape (null = a preset the canvas cannot express). */
        shape: () => { rows: number; cols: number } | null;
        /** Registered layouts NOT expressible on the canvas — rendered as glyph tiles,
         *  grouped by chart count. `icon` is 16px SVG markup; `cells` is the count. */
        presets: () => Array<{ id: string; label: string; checked: boolean; icon?: string; cells?: number }>;
        onSelectGrid: (rows: number, cols: number) => void;
        onSelectPreset: (id: string) => void;
        /** One entry per link. `marks` is the DISPLAY truth — every chart that follows
         *  the link, keyed by cell id (the all-cells form reports the implicit group on
         *  every chart). */
        syncs?: () => Array<{ id: string; label: string; checked: boolean; group?: string; marks?: Record<string, string> }>;
        onToggleSync?: (id: string) => void;
        /** Cycle the ACTIVE cell through a link's groups (the row's chip). */
        onCycleGroup?: (id: string) => void;
        /** The charts the marking matrix lists, in slot order. Omitted ⇒ no matrix. */
        charts?: () => Array<{ id: string; label: string; symbol?: string; active: boolean }>;
        /** Pick ONE group for a chart outright (the cell's palette). `null` = leave it. */
        onSetCellGroup?: (kind: string, cellId: string, mark: string | null) => void;
        /** Cycle ONE chart through a link's groups (a matrix tap) — no active-cell detour. */
        onCycleCellGroup?: (id: string, cellId: string) => void;
        /** Make a chart active by tapping its matrix column header (the phone's way of
         *  picking a chart without touching the grid behind the sheet). */
        onSelectChart?: (cellId: string) => void;
        /** Put EVERY chart in one group for this link (the matrix's ALL chip). */
        onAllInOneGroup?: (id: string) => void;
        /** "Apply settings to all charts" (TV's Chart Settings → Apply to all). */
        onApplySettingsToAll?: () => void;
        /** "Apply indicators to all charts" (TV's Apply these indicators to entire layout). */
        onApplyIndicatorsToAll?: () => void;
        drawingsScope?: () => 'layout' | 'global';
        onToggleDrawingsScope?: () => void;
        hiddenCharts?: () => number;
        onClearPooled?: () => void;
        clearedCharts?: () => number;
        onRestorePooled?: () => void;
        savedLayouts?: () => Array<{
            name: string;
            active: boolean;
            thumb?: string | null;
            savedAt?: number | null;
            charts?: number;
            indicators?: number;
            dirty?: boolean;
        }>;
        /** The open layout, and the manager's verbs that fit a phone. */
        activeLayout?: () => string | null;
        onSaveChanges?: () => void;
        autosave?: () => boolean;
        onToggleAutosave?: (on: boolean) => void;
        onDuplicateLayout?: (name: string) => void;
        onSaveLayout?: (name: string) => void;
        onOpenLayout?: (name: string) => void;
        onDeleteLayout?: (name: string) => void;
        onRenameLayout?: (from: string, to: string) => boolean;
        onExportLayout?: (name: string) => string | null;
        onImportLayout?: (json: string) => string | null;
        /** Save with a preview picture (the row then SHOWS the layout). */
        onSaveLayoutWithThumb?: (name: string) => boolean;
        /** Chart templates (indicator sets; drawings never travel). */
        templates?: () => Array<{ name: string; count: number; symbol?: string; timeframe?: string }>;
        onSaveTemplate?: (name: string, includeMarket: boolean) => boolean;
        onApplyTemplate?: (name: string, target: 'active' | 'all') => number;
        onDeleteTemplate?: (name: string) => void;
        onRenameTemplate?: (from: string, to: string) => boolean;
        defaultTemplate?: () => string | null;
        onSetDefaultTemplate?: (name: string | null) => void;
        onExportTemplate?: (name: string) => string | null;
        onImportTemplate?: (json: string) => string | null;
        /** Groups in use with the user's names (the legend). */
        legend?: () => Array<{ id: string; mark: string; color?: string; name: string; count: number }>;
        onRenameGroup?: (id: string, name: string | null) => void;
        /** Repaint a group's glyph (null = palette mark). Optional: without it the phone
         *  legend still shows and renames groups, it just cannot change their mark. */
        onSetGroupMark?: (id: string, glyph: string | null) => void;
        /** The user's name for a group id (matrix palette). */
        groupName?: (id: string) => string | undefined;
        linkGroup?: () => string | null;
        onLinkGroup?: (tag: string | null) => void;
        /** The current layout's 16px glyph (`<svg>` markup) for the Layout row. Omitted
         *  ⇒ the registered `'layout'` icon. */
        glyph?: () => string;
        /** Copy the workspace share link — the phone's twin of the desktop card's chain
         *  button. Resolves null when the clipboard refuses (the caller reports why). */
        onShareLink?: () => Promise<string | null>;
    };
    onOpenChange?: (open: boolean) => void;
}

type MoreView = 'main' | 'style' | 'layout' | 'alerts' | 'cursor';

export class MoreDrawer {
    private readonly drawer: Drawer;
    /** First tap arms the "hidden charts" row; the second one commits. */
    private poolArmed = false;
    /** "Show all N layouts" — the sheet shows the newest few until asked for more. */
    private layoutsExpanded = false;
    /** Which half of the library is showing (layouts sit first: they are the workspace). */
    private libTab: 'layouts' | 'templates' | 'drawings' = 'layouts';
    /** The row whose `⋯` menu is open, keyed `L:<name>` / `T:<name>`. */
    private openRow: string | null = null;
    /** The name field a "+ save" row unfolded, if any. */
    private saveField: 'layout' | 'template' | null = null;
    /** Selector for the field the sheet should focus once this render is mounted. */
    private pendingFocus: string | null = null;
    private view: MoreView = 'main';
    /** Scroll the layout sheet to its sync block on the next paint. */
    private focus: 'sync' | undefined;
    /** The chart whose links panel opens straight away (the status line's badge names
     *  it, so the sheet must not make the user hunt for that row). */
    private focusCell: string | undefined;
    /** Which of the sheet's two tabs was last open — reopening keeps the place. */
    private tab: 'layouts' | 'sync' = 'layouts';

    constructor(private readonly opts: MoreDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
    }

    /** Show the sheet. `focus: 'sync'` lands on the Sync tab (the status line's marks
     *  open there) — same surface, TV's Layout setup, just the second tab. */
    open(view: MoreView = 'main', opts: { focus?: 'sync'; cell?: string } = {}): void {
        this.view = view;
        this.focus = opts.focus;
        this.focusCell = opts.cell;
        this.tab = opts.focus ?? 'layouts';
        // Transient library state does not survive a close: a reopened sheet must not
        // come back with a half-typed rename or a save form unfolded on a stale row.
        this.openRow = null;
        this.saveField = null;
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private show(view: MoreView): void {
        this.view = view;
        this.focus = undefined;
        this.render();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();

        // The layout sheet carries its own back button INSIDE its sticky nav (a header
        // that scrolls away leaves the sheet looking like a dead end).
        if (this.view !== 'main' && this.view !== 'layout') {
            const back = doc.createElement('button');
            back.className = 'vela-md-back';
            back.appendChild(iconEl('chevron-left', doc));
            const backLabel = this.view === 'style' ? 'Chart type' : this.view === 'cursor' ? 'Cursor' : 'Alerts';
            back.appendChild(doc.createTextNode(backLabel));
            back.addEventListener('click', () => this.show('main'));
            this.drawer.body.appendChild(back);
        }

        if (this.view === 'main') this.renderMain(doc);
        else if (this.view === 'style') this.renderStyle(doc);
        else if (this.view === 'layout') this.renderLayout(doc, this.focus, this.focusCell);
        else if (this.view === 'cursor') this.renderCursor(doc);
        else this.renderAlerts(doc);
        this.focus = undefined;
        this.focusCell = undefined;
        // Fields built inside a detached pane cannot take focus; the sheet asks for it
        // here, once everything is mounted (the phone keyboard follows the cursor).
        if (this.pendingFocus) {
            const target = this.drawer.body.querySelector<HTMLElement>(this.pendingFocus);
            this.pendingFocus = null;
            target?.focus({ preventScroll: true });
        }
    }

    private row(doc: Document, label: string, opts: { icon?: string; glyph?: string; value?: string; chevron?: boolean; checked?: boolean; danger?: boolean; onClick: () => void }): HTMLElement {
        const el = doc.createElement('div');
        el.className = 'vela-md-row';
        if (opts.icon) {
            const icon = iconEl(opts.icon, doc);
            if (opts.glyph) icon.innerHTML = opts.glyph;
            el.appendChild(icon);
        }
        const text = doc.createElement('span');
        text.className = 'vela-md-row-label';
        text.textContent = label;
        el.appendChild(text);
        if (opts.value) {
            const value = doc.createElement('span');
            value.className = 'vela-md-row-value';
            value.textContent = opts.value;
            el.appendChild(value);
        }
        if (opts.checked) el.dataset.checked = '1';
        if (opts.danger) el.dataset.danger = '1';
        if (opts.chevron) el.appendChild(iconEl('chevron-right', doc));
        el.addEventListener('click', opts.onClick);
        return el;
    }

    private renderMain(doc: Document): void {
        const actions = doc.createElement('div');
        actions.className = 'vela-md-actions';
        const action = (icon: string, label: string, enabled: boolean, run: () => void): void => {
            const b = doc.createElement('button');
            b.className = 'vela-md-action';
            b.disabled = !enabled;
            b.appendChild(iconEl(icon, doc));
            b.appendChild(doc.createTextNode(label));
            b.addEventListener('click', () => {
                run();
                this.drawer.hide();
            });
            actions.appendChild(b);
        };
        if (this.opts.onUndo) action('undo', 'Undo', this.opts.canUndo(), this.opts.onUndo);
        if (this.opts.onRedo) action('redo', 'Redo', this.opts.canRedo(), this.opts.onRedo);
        if (this.opts.onScreenshot) action('camera', 'Screenshot', true, this.opts.onScreenshot);
        if (this.opts.onReplay) action('replay', 'Replay', true, this.opts.onReplay);
        if (actions.childElementCount > 0) this.drawer.body.appendChild(actions);

        const list = doc.createElement('div');
        list.className = 'vela-md-list';

        // ── the library, first ─────────────────────────────────────────────────
        // TradingView's layout manager verbs (open / save / autosave / make a copy and
        // the templates) belong on the FIRST screen: they are the reason this drawer
        // gets opened, while the rows beneath are occasional settings.
        if (this.opts.layout) {
            const lib = doc.createElement('div');
            lib.className = 'vela-md-list vela-md-lib';
            this.renderLibrary(doc, lib, this.opts.layout);
            if (lib.childElementCount > 0) this.drawer.body.append(lib);
        }
        const current = this.opts.priceStyles().find((s) => s.id === this.opts.priceStyle());
        list.appendChild(this.row(doc, 'Chart type', { icon: 'style-line', value: current?.label, chevron: true, onClick: () => this.show('style') }));
        if (this.opts.cursorStyle) {
            // The pointer is the same kind of choice as the chart type — how you READ the
            // chart — so it sits beside it, with the live label as its value.
            const style = cursorSpec(this.opts.cursorStyle());
            list.appendChild(this.row(doc, 'Cursor', { icon: style.icon, value: style.label, chevron: true, onClick: () => this.show('cursor') }));
        }
        if (this.opts.layout) {
            const shape = this.opts.layout.shape();
            const value = shape ? `${shape.cols} × ${shape.rows}` : this.opts.layout.presets().find((p) => p.checked)?.label;
            list.appendChild(this.row(doc, 'Layout', { icon: 'layout', glyph: this.opts.layout.glyph?.(), value, chevron: true, onClick: () => this.show('layout') }));
        }
        for (const act of this.opts.primaryActions?.() ?? []) list.appendChild(this.actionRow(doc, act));
        for (const panel of this.opts.panels()) {
            list.appendChild(
                this.row(doc, panel.title, {
                    icon: panel.icon,
                    onClick: () => {
                        this.opts.onTogglePanel(panel.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        if (this.opts.onResetView) {
            list.appendChild(
                this.row(doc, 'Reset chart view', {
                    icon: 'reset',
                    onClick: () => {
                        this.opts.onResetView?.();
                        this.drawer.hide();
                    },
                }),
            );
        }
        // Two more doors a phone otherwise only finds by accident: the chart body's own
        // menu (a desktop right-click) and the display time zone (a long-press on the time
        // axis). Both open their own sheet, so this one closes first — two stacked
        // backdrops would leave the user tapping through a ghost surface.
        if (this.opts.onChartMenu) {
            list.appendChild(
                this.row(doc, 'Chart actions…', {
                    icon: 'more',
                    onClick: () => {
                        this.drawer.hide();
                        this.opts.onChartMenu?.();
                    },
                }),
            );
        }
        if (this.opts.onTimeZone) {
            list.appendChild(
                this.row(doc, 'Time zone', {
                    icon: 'clock',
                    value: this.opts.timezone?.(),
                    chevron: true,
                    onClick: () => {
                        this.drawer.hide();
                        this.opts.onTimeZone?.();
                    },
                }),
            );
        }
        if (this.opts.alerts) {
            const alertCount = this.opts.alerts().length;
            list.appendChild(this.row(doc, 'Alerts', { icon: 'bell', value: alertCount > 0 ? String(alertCount) : undefined, chevron: true, onClick: () => this.show('alerts') }));
        }
        for (const act of this.opts.actions()) list.appendChild(this.actionRow(doc, act));
        // The settings rows sit under their own heading — without it the library above
        // and these rows read as one undifferentiated pile.
        if (list.childElementCount > 0) {
            const chartHead = doc.createElement('div');
            chartHead.className = 'vela-md-section vela-md-charthead';
            chartHead.textContent = 'Chart';
            list.prepend(chartHead);
        }
        this.drawer.body.appendChild(list);
    }

    /** A contributed action's row: runs it and closes the drawer. */
    private actionRow(doc: Document, act: MoreDrawerAction): HTMLElement {
        return this.row(doc, act.label, {
            icon: act.icon,
            onClick: () => {
                act.run();
                this.drawer.hide();
            },
        });
    }

    private renderStyle(doc: Document): void {
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        const current = this.opts.priceStyle();
        for (const style of this.opts.priceStyles()) {
            list.appendChild(
                this.row(doc, style.label, {
                    icon: style.icon,
                    checked: style.id === current,
                    onClick: () => {
                        this.opts.onPriceStyle(style.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        this.drawer.body.appendChild(list);
    }

    /** The Cursors stop: seven radio rows, each saying what the pointer does. */
    private renderCursor(doc: Document): void {
        const list = doc.createElement('div');
        list.className = 'vela-md-list vela-md-cursors';
        const current = this.opts.cursorStyle?.() ?? 'cross';
        const hint = doc.createElement('div');
        hint.className = 'vela-md-hint';
        hint.textContent = 'One pointer for every chart. It is a view setting — it never enters a saved layout.';
        list.appendChild(hint);
        for (const spec of CURSOR_SPECS) {
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'vela-md-row vela-md-cursorrow';
            row.dataset.cursor = spec.id;
            row.toggleAttribute('data-active', spec.id === current);
            row.setAttribute('role', 'radio');
            row.setAttribute('aria-checked', String(spec.id === current));
            const glyph = iconEl(spec.icon, doc);
            glyph.classList.add('vela-md-cursorglyph');
            const text = doc.createElement('span');
            text.className = 'vela-md-cursortext';
            const label = doc.createElement('span');
            label.className = 'vela-md-cursorlabel';
            label.textContent = spec.label;
            const sub = doc.createElement('span');
            sub.className = 'vela-md-cursorsub';
            sub.textContent = spec.hint;
            text.append(label, sub);
            const check = doc.createElement('span');
            check.className = 'vela-md-cursorcheck';
            check.setAttribute('aria-hidden', 'true');
            row.append(glyph, text, check);
            row.addEventListener('click', () => {
                this.opts.onCursorStyle?.(spec.id);
                this.render();
            });
            list.appendChild(row);
        }
        this.drawer.body.appendChild(list);
    }

    /**
     * TradingView's LAYOUT SETUP, as one sheet. The desktop app splits it into a wide
     * popover with a layouts column and a sync column; a phone has one column, so the
     * same surface becomes one scroll with a sticky two-stop nav (Layouts · Sync) — the
     * pairing TV keeps is intact, and nothing is hidden behind a second tab. (TV's own
     * guide for the menu: pick a layout, then "scroll down to Sync in Layout".)
     *
     *   • the grid canvas + the asymmetric presets, grouped by chart count;
     *   • "Chart syncing", ONE block: the link x chart table (a cell per chart per link,
     *     ten distinct marks so ten charts never collide, an ALL column that drops the
     *     whole grid back into one group) and, under it, the seven switches that decide
     *     WHAT follows — `role=switch` + `aria-checked`, never a tinted div;
     *   • the layout actions TV puts in the same menu (apply settings / indicators to
     *     every chart, drawing scope, dormant charts);
     *   • saved layouts, with TV's "Save layout as…" field.
     *
     * Switch and chip taps repaint in place (values, aria-checked, marks) — the sheet is
     * never rebuilt under the finger, so the list does not jump to the top mid-edit.
     */
    private renderLayout(doc: Document, focus?: 'sync', focusCell?: string): void {
        const layout = this.opts.layout;
        if (!layout) return;
        type LayoutOpts = NonNullable<MoreDrawerOptions['layout']>;
        type SyncRowData = NonNullable<LayoutOpts['syncs']> extends () => Array<infer T> ? T : never;
        // Narrowed once, outside the closures: TS drops captured narrowing inside a
        // nested function, and every chip handler re-reads the live state.
        const syncsOf: (() => SyncRowData[]) | null = layout.syncs ?? null;

        const list = doc.createElement('div');
        list.className = 'vela-md-list';

        // ── the summary card: what this layout IS, at a glance ─────────────────
        const shape = layout.shape();
        const charts = layout.charts?.() ?? [];
        const on = (syncsOf?.() ?? []).filter((s) => s.checked).length;
        const hero = doc.createElement('div');
        hero.className = 'vela-md-hero';
        const heroGlyph = doc.createElement('span');
        heroGlyph.className = 'vela-md-hero-glyph';
        if (layout.glyph) heroGlyph.innerHTML = layout.glyph();
        const heroText = doc.createElement('span');
        heroText.className = 'vela-md-hero-text';
        const heroTitle = doc.createElement('b');
        heroTitle.textContent = shape ? `${shape.cols} × ${shape.rows} grid` : (layout.presets().find((p) => p.checked)?.label ?? 'Layout');
        const heroSub = doc.createElement('small');
        const heroSummary = `${charts.length || '?'} chart${charts.length === 1 ? '' : 's'} · ${on} link${on === 1 ? '' : 's'} on`;
        heroSub.textContent = heroSummary;
        heroText.append(heroTitle, heroSub);
        hero.append(heroGlyph, heroText);
        if (layout.onShareLink) {
            const share = doc.createElement('button');
            share.type = 'button';
            share.className = 'vela-md-share';
            share.setAttribute('aria-label', 'Copy share link');
            share.title = 'Copy a link to this whole workspace';
            share.append(iconEl('link', doc), doc.createTextNode('Share'));
            let timer: ReturnType<typeof setTimeout> | null = null;
            share.addEventListener('click', () => {
                void (async () => {
                    const url = await layout.onShareLink?.();
                    if (timer) clearTimeout(timer);
                    share.dataset.copied = url ? '1' : '0';
                    share.setAttribute('aria-label', url ? 'Share link copied' : 'Could not copy the link');
                    heroSub.textContent = url ? 'Link copied to the clipboard' : 'Could not copy — check the clipboard permission';
                    timer = setTimeout(() => {
                        delete share.dataset.copied;
                        share.setAttribute('aria-label', 'Copy share link');
                        heroSub.textContent = heroSummary; // the status is a beat, not a state
                        timer = null;
                    }, 1600);
                })();
            });
            hero.append(share);
        }
        list.append(hero);

        // ── sticky nav ─────────────────────────────────────────────────────────
        const nav = doc.createElement('div');
        nav.className = 'vela-md-nav';
        nav.setAttribute('role', 'tablist');
        const navButtons: HTMLElement[] = [];
        const navBack = doc.createElement('button');
        navBack.type = 'button';
        navBack.className = 'vela-md-navback';
        navBack.setAttribute('aria-label', 'Back to menu');
        navBack.appendChild(iconEl('chevron-left', doc));
        navBack.addEventListener('click', () => this.show('main'));
        nav.append(navBack);
        const navTrack = doc.createElement('div');
        navTrack.className = 'vela-md-navtrack';
        nav.append(navTrack);
        // REAL tabs, not scroll anchors: TV's layout popover has a layouts column and a
        // sync column side by side; a phone gets the same two panes one at a time. Two
        // scroll stops in one long sheet read as "one page with a jump menu" — and the
        // jump menu was the only thing making the sheet feel long.
        const goTo = (key: 'layouts' | 'sync'): void => {
            for (const b of navButtons) {
                const on = b.dataset.tab === key;
                b.toggleAttribute('data-active', on);
                b.setAttribute('aria-selected', String(on));
                // Roving tabindex, the ARIA tabs pattern: one tab stop, arrows move.
                b.tabIndex = on ? 0 : -1;
            }
            layoutsSec.hidden = key !== 'layouts';
            syncSec.hidden = key !== 'sync';
            this.tab = key;
            // A tab is a fresh page, not a scroll position shared with the other one.
            this.drawer.body.scrollTop = 0;
        };
        for (const [key, label] of [['layouts', 'Layout'], ['sync', 'Sync']] as const) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-md-navbtn';
            b.dataset.tab = key;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-controls', `vela-md-pane-${key}`);
            b.textContent = label;
            b.addEventListener('click', () => goTo(key));
            b.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next: 'layouts' | 'sync' = key === 'layouts' ? 'sync' : 'layouts';
                goTo(next);
                navButtons.find((x) => x.dataset.tab === next)?.focus();
            });
            navTrack.append(b);
            navButtons.push(b);
        }
        list.append(nav);

        // ── layouts ────────────────────────────────────────────────────────────
        const layoutsSec = doc.createElement('section');
        layoutsSec.className = 'vela-md-sec';
        layoutsSec.id = 'vela-md-pane-layouts';
        layoutsSec.setAttribute('role', 'tabpanel');
        layoutsSec.setAttribute('aria-label', 'Layout');

        const caption = doc.createElement('div');
        caption.className = 'vela-md-section';
        caption.textContent = 'Custom grid';
        layoutsSec.append(caption);
        const wrap = doc.createElement('div');
        wrap.className = 'vela-md-gridwrap';
        const { el: grid, squares } = layoutGridCanvas(doc);
        paintLayoutGrid(squares, layout.shape());
        grid.addEventListener('click', (e) => {
            const sq = (e.target as Element | null)?.closest?.('.vela-lp-sq');
            if (!(sq instanceof HTMLButtonElement)) return;
            layout.onSelectGrid(Number(sq.dataset.r) + 1, Number(sq.dataset.c) + 1);
            this.drawer.hide();
        });
        wrap.append(grid);
        layoutsSec.append(wrap);

        // The layouts TradingView calls "asymmetric" are the interesting ones — each gets
        // a GLYPH TILE (the same mini-diagram the desktop dropdown draws) grouped by
        // chart count, so a phone shows the shape instead of a wall of text rows.
        const presets = layout.presets();
        const byCount = new Map<number, typeof presets>();
        for (const preset of presets) {
            const n = preset.cells ?? 0;
            const bucket = byCount.get(n);
            if (bucket) bucket.push(preset);
            else byCount.set(n, [preset]);
        }
        for (const n of [...byCount.keys()].sort((a, b) => a - b)) {
            const group = byCount.get(n)!;
            const heading = doc.createElement('div');
            heading.className = 'vela-md-section';
            heading.textContent = n > 0 ? `${n} chart${n === 1 ? '' : 's'}` : 'Layouts';
            layoutsSec.append(heading);
            const tiles = doc.createElement('div');
            tiles.className = 'vela-md-presets';
            for (const preset of group) {
                const tile = doc.createElement('button');
                tile.type = 'button';
                tile.className = 'vela-md-preset';
                tile.setAttribute('role', 'option');
                tile.setAttribute('aria-selected', String(preset.checked));
                tile.setAttribute('aria-label', preset.label);
                tile.title = preset.label;
                if (preset.checked) tile.dataset.checked = '1';
                const glyph = doc.createElement('span');
                glyph.className = 'vela-md-preset-glyph';
                if (preset.icon) glyph.innerHTML = preset.icon;
                const label = doc.createElement('span');
                label.className = 'vela-md-preset-label';
                label.textContent = preset.label;
                tile.append(glyph, label);
                tile.addEventListener('click', () => {
                    layout.onSelectPreset(preset.id);
                    this.drawer.hide();
                });
                tiles.append(tile);
            }
            layoutsSec.append(tiles);
        }

        // ── the layout-wide actions TV keeps in the same menu ──────────────
        if (layout.onApplySettingsToAll || layout.onApplyIndicatorsToAll) {
            const heading = doc.createElement('div');
            heading.className = 'vela-md-section';
            heading.textContent = 'This layout';
            layoutsSec.append(heading);
        }
        if (layout.onApplySettingsToAll) {
            layoutsSec.append(
                this.row(doc, 'Apply settings to all charts', {
                    icon: 'style-line',
                    onClick: () => {
                        layout.onApplySettingsToAll?.();
                        this.drawer.hide();
                    },
                }),
            );
        }
        if (layout.onApplyIndicatorsToAll) {
            layoutsSec.append(
                this.row(doc, 'Apply indicators to all charts', {
                    icon: 'indicators',
                    onClick: () => {
                        layout.onApplyIndicatorsToAll?.();
                        this.drawer.hide();
                    },
                }),
            );
        }
        const hidden = layout.hiddenCharts?.() ?? 0;
        if (hidden === 0) this.poolArmed = false; // nothing left to arm
        if (hidden > 0 && layout.onClearPooled) {
            // Two taps: the row destroys state the trader cannot see, so the first tap
            // arms it and the second one commits (the drawer re-renders in between).
            layoutsSec.append(
                this.row(doc, this.poolArmed ? 'Hidden charts — tap to confirm' : 'Hidden charts', {
                    value: this.poolArmed ? `remove ${hidden}?` : `remove ${hidden}`,
                    ...(this.poolArmed ? { danger: true } : {}),
                    onClick: () => {
                        if (!this.poolArmed) {
                            this.poolArmed = true;
                            this.render();
                            return;
                        }
                        this.poolArmed = false;
                        layout.onClearPooled?.();
                        this.render();
                    },
                }),
            );
        }
        if (layout.onRestorePooled && (layout.clearedCharts?.() ?? 0) > 0) {
            const count = layout.clearedCharts?.() ?? 0;
            layoutsSec.append(
                this.row(doc, `Undo — bring back ${count} hidden chart${count === 1 ? '' : 's'}`, {
                    onClick: () => {
                        layout.onRestorePooled?.();
                        this.render();
                    },
                }),
            );
        }

        // ── sync ───────────────────────────────────────────────────────────────
        const syncSec = doc.createElement('section');
        syncSec.className = 'vela-md-sec';
        syncSec.id = 'vela-md-pane-sync';
        syncSec.setAttribute('role', 'tabpanel');
        syncSec.setAttribute('aria-label', 'Sync');

        type SwitchRow = { id: string; el: HTMLElement };
        const switchRows: SwitchRow[] = [];
        // The shared table (built below when there is more than one chart).
        let matrix: SyncMatrix | null = null;
        // The table repaints through `refresh`, which is defined at the end of the build
        // (it also repaints the switch rows). Calls arrive only after that.
        let repaint: () => void = () => {};

        if (syncsOf) {
            // ONE section. TradingView splits the same idea across two stops ("Sync in
            // layout" in the menu, "Chart syncing" on the status line); on a phone that
            // reads as two features that do the same thing. Here it is one block:
            //   Links  — WHAT follows (seven switches)
            //   Charts — WHO follows whom (a chip per link, per chart)
            const head = doc.createElement('div');
            head.className = 'vela-md-section';
            head.textContent = 'Chart syncing';
            syncSec.append(head);

            const hint = doc.createElement('div');
            hint.className = 'vela-md-hint';
            hint.textContent = 'Links decide what follows. Charts decide who follows whom — same emoji, same group.';
            syncSec.append(hint);

            // ── the TABLE: one row per link, one column per chart ────────────────
            // TV marks a chart with an emoji, not a table; the table is our synthesis —
            // every (link, chart) pair one tap away — and a table with ten charts is fine
            // as long as IT scrolls, not the page. The component is shared with the
            // desktop popover (sync-matrix.ts), so both shells mark charts the same way:
            // same ten marks, same colours, same "uncheck to leave" cycle.
            if (charts.length > 1 && (layout.onCycleCellGroup || layout.onAllInOneGroup)) {
                const chartsLabel = doc.createElement('div');
                chartsLabel.className = 'vela-md-sublabel';
                chartsLabel.textContent = 'Charts';
                syncSec.append(chartsLabel);

                matrix = new SyncMatrix({
                    doc,
                    host: this.opts.host,
                    shell: 'phone',
                    ...(layout.onSelectChart ? { onSelectChart: (id: string) => layout.onSelectChart?.(id) } : {}),
                    ...(layout.onCycleCellGroup ? { onCycleCellGroup: (kind: string, id: string) => layout.onCycleCellGroup?.(kind, id) } : {}),
                    ...(layout.onSetCellGroup ? { onSetCellGroup: (kind: string, id: string, mark: string | null) => layout.onSetCellGroup?.(kind, id, mark) } : {}),
                    ...(layout.onAllInOneGroup ? { onAllInOneGroup: (kind: string) => layout.onAllInOneGroup?.(kind) } : {}),
                    ...(layout.groupName ? { groupName: (id: string) => layout.groupName?.(id) } : {}),
                    onChange: () => repaint(),
                });
                matrix.update(charts, syncsOf());
                syncSec.append(matrix.el);

                const legend = doc.createElement('div');
                legend.className = 'vela-md-legend';
                const legendHint = doc.createElement('span');
                // The cue exists only when the table really does overflow: telling a
                // four-chart layout to scroll sideways that it cannot would be a lie.
                legendHint.textContent = charts.length > 4
                    ? 'Same mark, same group · scroll sideways for the rest'
                    : 'Same mark, same group · tap a cell to cycle it';
                legend.append(legendHint);
                // The groups IN USE, with the names the trader gave them ("🔴 scalp").
                // The table says which chart; this says what the group is FOR. Tap a
                // name to edit it in place — the name is stored by the stable group id,
                // so it survives any palette change.
                for (const g of layout.legend?.() ?? []) {
                    const chip = doc.createElement('span');
                    chip.className = 'vela-md-leg';
                    chip.dataset.group = g.id;
                    const mark = doc.createElement('button');
                    mark.type = 'button';
                    mark.className = 'vela-md-legmark';
                    mark.textContent = g.mark;
                    if (g.color) mark.style.color = g.color;
                    if (layout.onSetGroupMark) {
                        mark.title = `Change the mark for ${g.name}`;
                        mark.setAttribute('aria-label', `Mark for group ${g.name} is ${g.mark}. Change mark`);
                        mark.addEventListener('click', () => {
                            const input = doc.createElement('input');
                            input.type = 'text';
                            input.value = g.mark;
                            input.maxLength = 4;
                            input.setAttribute('aria-label', `New mark for group ${g.name}`);
                            const commit = (keep: boolean): void => {
                                if (!input.isConnected) return;
                                if (keep) layout.onSetGroupMark?.(g.id, input.value.trim() || null);
                                this.render();
                            };
                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter') commit(true);
                                else if (e.key === 'Escape') commit(false);
                                e.stopPropagation();
                            });
                            input.addEventListener('blur', () => commit(true));
                            mark.replaceWith(input);
                            input.focus();
                            input.select();
                        });
                    } else {
                        mark.disabled = true;
                    }
                    const nameBtn = doc.createElement('button');
                    nameBtn.type = 'button';
                    nameBtn.textContent = g.name;
                    nameBtn.title = `${g.count} chart${g.count === 1 ? '' : 's'} · tap to name this group`;
                    nameBtn.setAttribute('aria-label', `Group ${g.mark}: ${g.name}. Rename`);
                    nameBtn.addEventListener('click', () => {
                        if (!layout.onRenameGroup) return;
                        const input = doc.createElement('input');
                        input.type = 'text';
                        input.value = g.name;
                        input.maxLength = 24;
                        input.setAttribute('aria-label', `Name for group ${g.mark}`);
                        const commit = (keep: boolean): void => {
                            if (!input.isConnected) return;
                            if (keep) layout.onRenameGroup?.(g.id, input.value.trim() || null);
                            this.render();
                        };
                        input.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') commit(true);
                            else if (e.key === 'Escape') commit(false);
                            e.stopPropagation();
                        });
                        input.addEventListener('blur', () => commit(true));
                        nameBtn.replaceWith(input);
                        input.focus();
                        input.select();
                    });
                    chip.append(mark, nameBtn);
                    legend.appendChild(chip);
                }
                syncSec.append(legend);
            }

            const linksLabel = doc.createElement('div');
            linksLabel.className = 'vela-md-sublabel';
            linksLabel.textContent = 'Links';
            syncSec.append(linksLabel);

            for (const s of syncsOf()) {
                const row = doc.createElement('button');
                row.type = 'button';
                row.className = 'vela-md-sync';
                row.setAttribute('role', 'switch');
                row.setAttribute('aria-checked', String(s.checked));
                row.setAttribute('aria-label', `${s.label} sync`);
                const label = doc.createElement('span');
                label.className = 'vela-md-row-label';
                label.textContent = s.label;
                row.append(label);
                const track = doc.createElement('span');
                track.className = 'vela-md-switch';
                track.setAttribute('aria-hidden', 'true');
                row.append(track);
                row.addEventListener('click', () => {
                    layout.onToggleSync?.(s.id);
                    refresh();
                });
                syncSec.append(row);
                switchRows.push({ id: s.id, el: row });
            }

            if (layout.drawingsScope) {
                const scopeRow = doc.createElement('button');
                scopeRow.type = 'button';
                scopeRow.className = 'vela-md-sync vela-md-plain';
                const scopeLabel = doc.createElement('span');
                scopeLabel.className = 'vela-md-row-label';
                scopeLabel.textContent = 'Drawing scope';
                const scopeValue = doc.createElement('span');
                scopeValue.className = 'vela-md-pill';
                scopeRow.append(scopeLabel, scopeValue);
                scopeRow.addEventListener('click', () => {
                    layout.onToggleDrawingsScope?.();
                    scopeValue.textContent = layout.drawingsScope?.() ?? 'layout';
                });
                scopeValue.textContent = layout.drawingsScope() ?? 'layout';
                syncSec.append(scopeRow);
            }

        }

        list.append(layoutsSec, syncSec);
        // The library (saved layouts, autosave, templates) lives on the MAIN tab — it is
        // the thing a trader opens this drawer FOR, and burying it one tab down mirrors
        // a desktop popover, not a phone. This pane stays "the grid and its links".
        this.drawer.body.append(list);

        // Re-read the live state and repaint the nodes that already exist.
        const refresh = (): void => {
            if (!syncsOf) return;
            const live = syncsOf();
            const byId = new Map(live.map((l) => [l.id, l]));
            for (const r of switchRows) {
                const s = byId.get(r.id);
                if (s) r.el.setAttribute('aria-checked', String(s.checked));
            }
            // The table repaints itself (marks, hues, header glyphs, the ALL cells).
            matrix?.update(charts, live);
            // The hero's link count follows the switches.
            const liveOn = live.filter((l) => l.checked).length;
            heroSub.textContent = `${charts.length || '?'} chart${charts.length === 1 ? '' : 's'} · ${liveOn} link${liveOn === 1 ? '' : 's'} on`;
        };
        refresh();
        repaint = refresh;
        // A plain open lands on Layout; the status-line "Chart syncing" entry (and the
        // sheet's own focus option) opens straight on the Sync tab.
        goTo(focus ?? this.tab ?? 'layouts');
        // Opened from a chart's own marks badge: unfold THAT chart's links and bring the
        // row into view, so the tap lands on a chip instead of on a list to hunt through.
        if (focusCell) matrix?.focus(focusCell);
    }

    // ── the library ─────────────────────────────────────────────────────────────
    /**
     * Layouts and indicator templates, on ONE screen with a two-stop toggle.
     *
     * TradingView keeps these apart on purpose: a LAYOUT is the whole workspace
     * (Ctrl+S, "Manage layouts"), a TEMPLATE is an indicator set that re-skins any
     * chart. Printing both as one long list made the drawer read as a wall of rows —
     * the measured complaint — so the sheet gives each its own pane, and every row is
     * one tap to USE plus one `⋯` to manage (rename / copy / export / delete). The
     * four bordered buttons a row used to wear are gone.
     */
    private renderLibrary(doc: Document, list: HTMLElement, layout: NonNullable<MoreDrawerOptions['layout']>): void {
        const hasLayouts = !!layout.savedLayouts;
        const hasTemplates = !!(layout.onSaveTemplate && layout.templates);
        const hasDrawings = !!this.opts.drawingTemplates;
        if (!hasLayouts && !hasTemplates && !hasDrawings) return;
        if (this.libTab === 'layouts' && !hasLayouts) this.libTab = hasTemplates ? 'templates' : 'drawings';
        if (this.libTab === 'templates' && !hasTemplates) this.libTab = hasLayouts ? 'layouts' : 'drawings';
        if (this.libTab === 'drawings' && !hasDrawings) this.libTab = hasLayouts ? 'layouts' : 'templates';
        const stopCount = Number(hasLayouts) + Number(hasTemplates) + Number(hasDrawings);

        const head = doc.createElement('div');
        head.className = 'vela-md-libhead';
        // With both panes the toggle IS the heading — printing "LAYOUTS" beside a
        // control that already says Layouts is the kind of noise this screen is losing.
        if (stopCount === 1) {
            head.appendChild(this.sectionLabel(doc, hasLayouts ? 'Layouts' : hasTemplates ? 'Templates' : 'Drawings'));
        }
        if (stopCount > 1) {
            const seg = doc.createElement('div');
            seg.className = 'vela-md-seg';
            seg.setAttribute('role', 'tablist');
            seg.setAttribute('aria-label', 'Layouts, templates or drawings');
            const stops: Array<['layouts' | 'templates' | 'drawings', string]> = [];
            if (hasLayouts) stops.push(['layouts', 'Layouts']);
            if (hasTemplates) stops.push(['templates', 'Templates']);
            if (hasDrawings) stops.push(['drawings', 'Drawings']);
            for (const [key, label] of stops) {
                const b = doc.createElement('button');
                b.type = 'button';
                b.className = 'vela-md-segbtn';
                b.id = `vela-md-libtab-${key}`;
                b.dataset.tab = key;
                b.setAttribute('role', 'tab');
                b.setAttribute('aria-controls', 'vela-md-libpane');
                b.setAttribute('aria-selected', String(this.libTab === key));
                b.toggleAttribute('data-active', this.libTab === key);
                b.tabIndex = this.libTab === key ? 0 : -1;
                b.textContent = label;
                b.addEventListener('click', () => {
                    this.libTab = key;
                    this.openRow = null;
                    this.saveField = null;
                    // Re-render replaces this node, so the tab that was just chosen asks
                    // for focus back — a toggle that drops focus to the document makes
                    // the next arrow key scroll the page instead of moving the tab.
                    this.pendingFocus = '.vela-md-segbtn[data-active]';
                    this.render();
                });
                b.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    const order = stops.map(([k]) => k);
                    const at = order.indexOf(key);
                    const step = e.key === 'ArrowRight' ? 1 : -1;
                    this.libTab = order[(at + step + order.length) % order.length] ?? order[0]!;
                    this.openRow = null;
                    this.saveField = null;
                    this.pendingFocus = '.vela-md-segbtn[data-active]';
                    this.render();
                });
                seg.appendChild(b);
            }
            head.appendChild(seg);
        }
        list.appendChild(head);

        const pane = doc.createElement('div');
        pane.className = 'vela-md-libpane';
        // A real tabpanel: the toggle is a tablist, so the pane it swaps must say which
        // tab it belongs to (a bare div leaves the screen reader with two tabs and no body).
        pane.setAttribute('role', 'tabpanel');
        pane.id = 'vela-md-libpane';
        pane.setAttribute('aria-labelledby', `vela-md-libtab-${this.libTab}`);
        if (this.libTab === 'layouts') this.renderLayoutsPane(doc, pane, layout);
        else if (this.libTab === 'templates') this.renderTemplatesPane(doc, pane, layout);
        else this.renderDrawingsPane(doc, pane);
        // Focus lands after the pane is in the document (see render()): focusing a
        // detached input is a no-op and leaves the phone keyboard closed.
        if (pane.querySelector('.vela-md-linput, .vela-md-saveas input')) {
            this.pendingFocus = '.vela-md-linput, .vela-md-saveas input';
        }
        list.appendChild(pane);
    }

    /** The small caps heading this sheet uses above every group. */
    private sectionLabel(doc: Document, text: string): HTMLElement {
        const el = doc.createElement('div');
        el.className = 'vela-md-section';
        el.textContent = text;
        return el;
    }

    /** The row's `⋯` — the ONLY per-row control besides the row itself. */
    private kebab(doc: Document, label: string, open: boolean, run: () => void): HTMLElement {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-md-lkebab';
        b.setAttribute('aria-label', label);
        b.title = label;
        b.setAttribute('aria-expanded', String(open));
        b.appendChild(iconEl('more', doc));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            run();
        });
        return b;
    }

    /** The card of verbs a `⋯` unfolds — text, not four more icons. */
    private actionsStrip(doc: Document, entries: Array<{ label: string; danger?: boolean; run: () => void }>): HTMLElement {
        const strip = doc.createElement('div');
        strip.className = 'vela-md-lacts';
        for (const entry of entries) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-md-lact';
            if (entry.danger) b.dataset.danger = '1';
            b.textContent = entry.label;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                entry.run();
            });
            strip.appendChild(b);
        }
        return strip;
    }

    /** Rename in place: the row's own text field, never a modal for one word. */
    private rowRename(doc: Document, row: HTMLElement, from: string, apply: (from: string, to: string) => boolean, onLeave: () => void): void {
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'vela-md-linput';
        input.value = from;
        input.setAttribute('aria-label', `Rename ${from}`);
        let done = false;
        const finish = (allowRetry: boolean): void => {
            if (done) return;
            const to = input.value.trim();
            if (!to || to === from) {
                done = true;
                onLeave();
                return;
            }
            if (apply(from, to) || !allowRetry) {
                done = true;
                onLeave();
                return;
            }
            input.dataset.refused = to; // taken: stay editable, say why
            input.title = `“${to}” is already used — pick another name`;
            input.focus();
            input.select();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                done = true;
                onLeave();
            }
        });
        input.addEventListener('blur', () => finish(false));
        row.replaceChildren(input);
        row.classList.add('renaming');
        input.focus();
        input.select();
    }

    /** Saved snapshots: tap to open, `⋯` to manage. */
    private renderLayoutsPane(doc: Document, pane: HTMLElement, layout: NonNullable<MoreDrawerOptions['layout']>): void {
        const rows = layout.savedLayouts?.() ?? [];

        // ── the open layout: name, drift, and the one-tap write ──────────────
        const activeName = layout.activeLayout?.() ?? null;
        const dirty = rows.some((r) => r.dirty);
        if (activeName) {
            const strip = doc.createElement('div');
            strip.className = 'vela-md-lopen';
            const text = doc.createElement('span');
            text.className = 'vela-md-ltext';
            const name = doc.createElement('b');
            name.textContent = activeName;
            text.appendChild(name);
            const state = doc.createElement('small');
            if (dirty) {
                const dot = doc.createElement('span');
                dot.className = 'vela-md-dot';
                dot.setAttribute('aria-hidden', 'true');
                text.querySelector('b')?.prepend(dot);
                state.textContent = 'unsaved changes';
            } else {
                state.textContent = 'saved';
            }
            text.appendChild(state);
            strip.appendChild(text);
            if (dirty && layout.onSaveChanges) {
                const save = doc.createElement('button');
                save.type = 'button';
                save.className = 'vela-md-pill';
                save.textContent = 'Save';
                save.setAttribute('aria-label', `Save changes to ${activeName}`);
                save.addEventListener('click', () => {
                    layout.onSaveChanges?.();
                    this.render();
                });
                strip.appendChild(save);
            }
            pane.appendChild(strip);
        }

        // ── autosave: a real switch, not a checkbox ─────────────────────────
        if (layout.onToggleAutosave) {
            const on = layout.autosave?.() === true;
            const auto = doc.createElement('button');
            auto.type = 'button';
            auto.className = 'vela-md-switchrow';
            auto.setAttribute('role', 'switch');
            auto.setAttribute('aria-checked', String(on));
            const alabel = doc.createElement('span');
            alabel.className = 'vela-md-row-label';
            alabel.textContent = 'Autosave';
            const hint = doc.createElement('span');
            hint.className = 'vela-md-row-sub';
            hint.textContent = on ? 'on' : 'off';
            const pill = doc.createElement('span');
            pill.className = 'vela-md-switch' + (on ? ' on' : '');
            pill.setAttribute('aria-hidden', 'true');
            auto.append(alabel, hint, pill);
            auto.addEventListener('click', () => {
                layout.onToggleAutosave?.(!on);
                this.render();
            });
            pane.appendChild(auto);
        }

        if (rows.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-md-hint';
            empty.textContent = 'No saved layouts yet — name one below and the whole grid is kept.';
            pane.appendChild(empty);
        }

        const COLLAPSE_AT = 3;
        const shown = this.layoutsExpanded || rows.length <= COLLAPSE_AT ? rows : rows.slice(0, COLLAPSE_AT);
        for (const l of shown) {
            const row = doc.createElement('div');
            row.className = 'vela-md-lrow';
            row.dataset.layout = l.name;
            if (l.active) row.dataset.active = '1';
            const main = doc.createElement('button');
            main.type = 'button';
            main.className = 'vela-md-lmain';
            main.setAttribute('aria-label', `Open layout ${l.name}`);
            if (typeof l.thumb === 'string' && l.thumb.startsWith('data:image/')) {
                const img = doc.createElement('img');
                img.className = 'vela-md-lthumb';
                img.src = l.thumb;
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                main.appendChild(img);
            }
            const text = doc.createElement('span');
            text.className = 'vela-md-ltext';
            const name = doc.createElement('b');
            name.textContent = l.name;
            if (l.dirty) {
                const dot = doc.createElement('span');
                dot.className = 'vela-md-dot';
                dot.setAttribute('aria-hidden', 'true');
                name.prepend(dot);
            }
            text.appendChild(name);
            const bits: string[] = [];
            if (typeof l.charts === 'number') bits.push(`${l.charts} chart${l.charts === 1 ? '' : 's'}`);
            if (typeof l.indicators === 'number') bits.push(`${l.indicators} ind`);
            if (typeof l.savedAt === 'number' && l.savedAt > 0) bits.push(agoLabel(l.savedAt));
            if (bits.length > 0) {
                const meta = doc.createElement('small');
                meta.className = 'vela-md-lmeta';
                meta.textContent = bits.join(' · ');
                text.appendChild(meta);
            }
            main.appendChild(text);
            main.addEventListener('click', () => layout.onOpenLayout?.(l.name));
            row.appendChild(main);
            row.appendChild(
                this.kebab(doc, `Actions for ${l.name}`, this.openRow === `L:${l.name}`, () => {
                    this.openRow = this.openRow === `L:${l.name}` ? null : `L:${l.name}`;
                    this.saveField = null;
                    this.render();
                }),
            );
            pane.appendChild(row);

            if (this.openRow === `L:${l.name}`) {
                pane.appendChild(
                    this.actionsStrip(
                        doc,
                        [
                            ...(layout.onRenameLayout ? [{ label: 'Rename', run: () => this.rowRename(doc, row, l.name, layout.onRenameLayout ?? (() => false), () => { this.openRow = null; this.render(); }) }] : []),
                            ...(layout.onDuplicateLayout ? [{ label: 'Duplicate', run: () => { this.openRow = null; layout.onDuplicateLayout?.(l.name); this.render(); } }] : []),
                            ...(layout.onExportLayout ? [{ label: 'Export', run: () => { const json = layout.onExportLayout?.(l.name); if (json) downloadText(doc, `${l.name}.vela-layout.json`, json); } }] : []),
                            ...(layout.onDeleteLayout ? [{ label: 'Delete', danger: true, run: () => { this.openRow = null; layout.onDeleteLayout?.(l.name); this.render(); } }] : []),
                        ].map((e) => ({ ...e })),
                    ),
                );
            }
        }

        if (rows.length > COLLAPSE_AT) {
            const more = doc.createElement('button');
            more.type = 'button';
            more.className = 'vela-md-more';
            more.setAttribute('aria-expanded', String(this.layoutsExpanded));
            more.textContent = this.layoutsExpanded ? 'Show fewer' : `Show all ${rows.length} layouts`;
            more.appendChild(iconEl('chevron-down', doc));
            more.addEventListener('click', () => {
                this.layoutsExpanded = !this.layoutsExpanded;
                this.openRow = null;
                this.render();
            });
            pane.appendChild(more);
        }

        // ── save ─────────────────────────────────────────────────────────────
        if (layout.onSaveLayout) {
            if (this.saveField === 'layout') {
                const form = doc.createElement('div');
                form.className = 'vela-md-saveas';
                const input = doc.createElement('input');
                input.type = 'text';
                input.placeholder = `Name (Layout ${rows.length + 1})`;
                input.setAttribute('aria-label', 'Save layout as');
                const button = doc.createElement('button');
                button.type = 'button';
                button.textContent = 'Save';
                const commit = (): void => {
                    const name = input.value.trim();
                    if (!name) return;
                    this.saveField = null;
                    layout.onSaveLayout?.(name);
                    this.render();
                };
                button.addEventListener('click', commit);
                input.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        this.saveField = null;
                        this.render();
                    }
                });
                form.append(input, button);
                pane.appendChild(form);
                input.focus();
            } else {
                pane.appendChild(
                    this.ghostButton(doc, 'plus', 'Save as new layout', () => {
                        this.saveField = 'layout';
                        this.openRow = null;
                        this.render();
                    }),
                );
            }
        }
        if (layout.onImportLayout) {
            pane.appendChild(this.fileButton(doc, 'layout', layout.onImportLayout));
        }
    }

    /** Indicator templates: tap to apply, `⋯` to manage. */
    private renderTemplatesPane(doc: Document, pane: HTMLElement, layout: NonNullable<MoreDrawerOptions['layout']>): void {
        const templates = layout.templates?.() ?? [];
        if (templates.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-md-hint';
            empty.textContent = 'No templates yet — save this chart’s indicators below and they re-skin any chart.';
            pane.appendChild(empty);
        }
        for (const t of templates) {
            const row = doc.createElement('div');
            row.className = 'vela-md-lrow';
            row.dataset.template = t.name;
            if (layout.defaultTemplate?.() === t.name) row.dataset.house = '1';
            const main = doc.createElement('button');
            main.type = 'button';
            main.className = 'vela-md-lmain';
            main.setAttribute('aria-label', `Apply template ${t.name} to this chart`);
            const text = doc.createElement('span');
            text.className = 'vela-md-ltext';
            const name = doc.createElement('b');
            name.textContent = t.name;
            text.appendChild(name);
            const meta = doc.createElement('small');
            meta.className = 'vela-md-lmeta';
            // "tap to apply" is not decoration: the row has no chevron and no Apply
            // button, so the meta line is the only place that says what a tap does.
            meta.textContent = `${t.count} indicator${t.count === 1 ? '' : 's'}${t.symbol ? ` · ${t.symbol}` : ''} · tap to apply`;
            text.appendChild(meta);
            main.appendChild(text);
            main.addEventListener('click', () => {
                layout.onApplyTemplate?.(t.name, 'active');
                this.drawer.hide();
            });
            row.appendChild(main);
            // The house template is a STATE, so it is a star, not a verb in the menu.
            if (layout.onSetDefaultTemplate) {
                const isDefault = layout.defaultTemplate?.() === t.name;
                const star = doc.createElement('button');
                star.type = 'button';
                star.className = 'vela-md-star';
                star.dataset.on = isDefault ? '1' : '0';
                star.setAttribute('aria-pressed', String(isDefault));
                const label = isDefault ? `${t.name} seeds new charts — turn off` : `Start new charts with ${t.name}`;
                star.setAttribute('aria-label', label);
                star.title = label;
                star.appendChild(iconEl(isDefault ? 'star-filled' : 'star', doc));
                star.addEventListener('click', (e) => {
                    e.stopPropagation();
                    layout.onSetDefaultTemplate?.(isDefault ? null : t.name);
                    this.render();
                });
                row.appendChild(star);
            }
            row.appendChild(
                this.kebab(doc, `Actions for ${t.name}`, this.openRow === `T:${t.name}`, () => {
                    this.openRow = this.openRow === `T:${t.name}` ? null : `T:${t.name}`;
                    this.saveField = null;
                    this.render();
                }),
            );
            pane.appendChild(row);
            if (this.openRow === `T:${t.name}`) {
                pane.appendChild(
                    this.actionsStrip(doc, [
                        ...((layout.charts?.() ?? []).length > 1 && layout.onApplyTemplate
                            ? [{ label: 'Apply to all charts', run: () => { this.openRow = null; layout.onApplyTemplate?.(t.name, 'all'); this.drawer.hide(); } }]
                            : []),
                        ...(layout.onExportTemplate ? [{ label: 'Export', run: () => { const json = layout.onExportTemplate?.(t.name); if (json) downloadText(doc, `${t.name}.vela-template.json`, json); } }] : []),
                        ...(layout.onDeleteTemplate ? [{ label: 'Delete', danger: true, run: () => { this.openRow = null; layout.onDeleteTemplate?.(t.name); this.render(); } }] : []),
                    ]),
                );
            }
        }

        if (layout.onSaveTemplate) {
            if (this.saveField === 'template') {
                const form = doc.createElement('div');
                form.className = 'vela-md-saveas';
                const input = doc.createElement('input');
                input.type = 'text';
                input.placeholder = 'Template name';
                input.setAttribute('aria-label', 'Save chart template as');
                const chip = doc.createElement('label');
                chip.className = 'vela-md-tplmarket';
                chip.title = 'Also store the symbol and timeframe';
                const box = doc.createElement('input');
                box.type = 'checkbox';
                const chipText = doc.createElement('span');
                chipText.textContent = 'market';
                chip.append(box, chipText);
                const button = doc.createElement('button');
                button.type = 'button';
                button.textContent = 'Save';
                const commit = (): void => {
                    const name = input.value.trim();
                    if (!name) return;
                    this.saveField = null;
                    layout.onSaveTemplate?.(name, box.checked);
                    this.render();
                };
                button.addEventListener('click', commit);
                input.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        this.saveField = null;
                        this.render();
                    }
                });
                form.append(input, chip, button);
                pane.appendChild(form);
                input.focus();
            } else {
                pane.appendChild(
                    this.ghostButton(doc, 'plus', 'Save indicators as template', () => {
                        this.saveField = 'template';
                        this.openRow = null;
                        this.render();
                    }),
                );
            }
        }
        if (layout.onImportTemplate) pane.appendChild(this.fileButton(doc, 'template', layout.onImportTemplate));
    }

    /**
     * Drawing templates — the SAVED LOOKS of the drawing tools, grouped by tool. The
     * reference keeps these on the floating drawing toolbar (Vela has them there too, and
     * in a drawing's settings panel); this pane is the library view: you can see every
     * saved look in one place, use one for the NEXT drawing of its tool, export or delete.
     */
    private renderDrawingsPane(doc: Document, pane: HTMLElement): void {
        const all = this.opts.drawingTemplates?.() ?? [];
        const hint = doc.createElement('div');
        hint.className = 'vela-md-hint';
        hint.textContent = all.length
            ? 'Tap a template to use it for the next drawing of that tool. Save a look from any drawing’s Templates button.'
            : 'No drawing templates yet. Select a drawing → Templates → Save as template, and it lands here.';
        pane.appendChild(hint);
        let lastTool = '';
        for (const t of all) {
            const key = `D:${t.tool}:${t.name}`;
            if (t.tool !== lastTool) {
                lastTool = t.tool;
                pane.appendChild(this.sectionLabel(doc, t.toolLabel));
            }
            const row = doc.createElement('div');
            row.className = 'vela-md-lrow';
            row.dataset.drawingTemplate = t.name;
            row.dataset.tool = t.tool;
            const main = doc.createElement('button');
            main.type = 'button';
            main.className = 'vela-md-lmain';
            main.setAttribute('aria-label', `Use template ${t.name} for the next ${t.toolLabel}`);
            const swatch = doc.createElement('span');
            swatch.className = 'vela-md-lswatch';
            swatch.style.background = t.color ?? 'transparent';
            main.appendChild(swatch);
            const text = doc.createElement('span');
            text.className = 'vela-md-ltext';
            const name = doc.createElement('b');
            name.textContent = t.name;
            const meta = doc.createElement('small');
            meta.className = 'vela-md-lmeta';
            meta.textContent = `${t.toolLabel} · tap to use`;
            text.append(name, meta);
            main.appendChild(text);
            main.addEventListener('click', () => {
                this.opts.onApplyDrawingTemplate?.(t.tool, t.name);
                this.drawer.hide();
            });
            row.appendChild(main);
            row.appendChild(
                this.kebab(doc, `Actions for ${t.name}`, this.openRow === key, () => {
                    this.openRow = this.openRow === key ? null : key;
                    this.saveField = null;
                    this.render();
                }),
            );
            pane.appendChild(row);
            if (this.openRow === key) {
                pane.appendChild(
                    this.actionsStrip(doc, [
                        { label: 'Use for next drawing', run: () => { this.openRow = null; this.opts.onApplyDrawingTemplate?.(t.tool, t.name); this.drawer.hide(); } },
                        ...(this.opts.onExportDrawingTemplate
                            ? [{ label: 'Export', run: () => { const json = this.opts.onExportDrawingTemplate?.(t.tool, t.name); if (json) downloadText(doc, `${t.name}.vela-drawing.json`, json); } }]
                            : []),
                        ...(this.opts.onDeleteDrawingTemplate
                            ? [{ label: 'Delete', danger: true, run: () => { this.openRow = null; this.opts.onDeleteDrawingTemplate?.(t.tool, t.name); this.render(); } }]
                            : []),
                    ]),
                );
            }
        }
    }

    /** A quiet full-width “+ something” row — the entry point to a save form. */
    private ghostButton(doc: Document, icon: string, label: string, run: () => void): HTMLElement {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-md-lghost';
        b.appendChild(iconEl(icon, doc));
        b.appendChild(doc.createTextNode(label));
        b.addEventListener('click', () => run());
        return b;
    }

    /** Import a JSON file; the picker lives in the body so iOS can open it. */
    private fileButton(doc: Document, kind: 'layout' | 'template', apply: (json: string) => unknown): HTMLElement {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-md-lghost vela-md-limport';
        b.appendChild(iconEl('upload', doc));
        b.appendChild(doc.createTextNode(kind === 'layout' ? 'Import layout file' : 'Import template file'));
        b.addEventListener('click', () => {
            const picker = doc.createElement('input');
            picker.type = 'file';
            picker.accept = 'application/json,.json';
            picker.style.display = 'none';
            picker.addEventListener('change', () => {
                const file = picker.files?.[0];
                picker.remove();
                if (!file) return;
                void file.text().then((text) => {
                    if (apply(text)) this.render();
                });
            });
            doc.body.appendChild(picker);
            picker.click();
        });
        return b;
    }

    private renderAlerts(doc: Document): void {
        const alerts = this.opts.alerts?.() ?? [];
        if (alerts.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-md-empty';
            empty.textContent = 'No alerts yet.';
            this.drawer.body.appendChild(empty);
            return;
        }
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        for (const a of alerts) {
            list.appendChild(this.row(doc, `${a.title}: ${a.message}`, { value: new Date(a.time).toLocaleTimeString(), onClick: () => undefined }));
        }
        this.drawer.body.appendChild(list);
    }
}
