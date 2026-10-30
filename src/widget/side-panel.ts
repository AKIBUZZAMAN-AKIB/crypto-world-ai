// The docked side-panel shell: a column on the chart's right edge with a titled header, a close
// button, and a scrolling body. Closed by default — a topbar button toggles it, and because the
// shell is a flex SIBLING of the chart (not an overlay) opening it shrinks the chart. The object
// tree and the data window are built on it, and contributed panels (`registerSidePanel`) get the
// same shell from the dock, so every panel in the column looks and behaves alike.
//
// A docked panel is fixed by default, or `resizable` by its inner-edge handle within its
// declared bounds. On desktop the header action switches any panel to a free-floating card;
// its button after Close directly resizes both dimensions without remounting the content.
// Legacy `overlay` contributions retain their pin, and phone panes remain height-resizable.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { announceSurface } from '../ui/surface-events';
import { holdForExit, type SurfaceExit } from '../ui/surface-exit';
import { focusViewportDelta, linkPanelResizeGrip } from '../ui/panel-drag';
import { Tooltip } from '../ui/components/tooltip';
import type { FloatingPanelPosition } from '../state/document';

const STYLE_ID = 'vela-widget-sidepanel';

/** Width (px) a panel takes when it declares none. */
export const DEFAULT_PANEL_WIDTH = 280;
/** Bounds a RESIZABLE panel takes when it declares none. */
export const DEFAULT_PANEL_MIN_WIDTH = 200;
export const DEFAULT_PANEL_MAX_WIDTH = 640;
/** A usable compact card; panel-specific contributed bounds still take precedence. */
export const MIN_FLOAT_PANEL_WIDTH = 160;
/** Legacy default top offset, kept for old serialized panel geometry. */
export const DEFAULT_PANEL_TOP = 0.55;
export const DEFAULT_PANEL_HEIGHT = 0.4;
export const MIN_PANEL_TOP = 0;
export const MAX_PANEL_TOP = 0.95;
export const PANEL_TOP_STEP = 0.05;

const CSS = `
.vela-panel[hidden] { display: none !important; }
.vela-panel {
    position: relative;
    width: var(--vela-panel-w, ${DEFAULT_PANEL_WIDTH}px);
    flex: none;
    border-left: 1px solid var(--vela-border);
    display: flex;
    flex-direction: column;
    color: var(--vela-fg);
    font-size: 13px;
    box-sizing: border-box;
    background: var(--vela-bg);
}
.vela-panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    min-width: 0;
    border-bottom: 1px solid var(--vela-border);
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg-bright);
}
.vela-panel-header:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-panel-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-panel-title:empty { display: none; }
/* The contributed slot claims the space between title and close; its children lay out
   inline and the close button stays pinned right. */
.vela-panel-header-slot { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
.vela-panel .vela-panel-header-slot > * { flex-shrink: 0; }
.vela-panel-header-slot::-webkit-scrollbar { display: none; }
.vela-panel-close {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 16px;
}
.vela-panel-close .vela-icon { width: 16px; height: 16px; }
.vela-panel-close:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* Keep the shell controls and panel-specific actions reachable in a narrow card. */
.vela-panel[data-compact-width='1'] .vela-panel-header { flex-wrap: wrap; justify-content: flex-end; gap: 2px; padding: 4px 6px; }
.vela-panel[data-compact-width='1'] .vela-panel-title { flex: 1 1 0; }
.vela-panel[data-compact-width='1'] .vela-panel-header-slot { order: 2; flex: 1 0 100%; width: 100%; margin-left: 0; }
.vela-panel[data-compact-width='1'] .vela-panel-header-slot:empty { display: none; }
.vela-panel[data-compact-width='1'] .vela-panel-pin,
.vela-panel[data-compact-width='1'] .vela-panel-max,
.vela-panel[data-compact-width='1'] .vela-panel-dock-toggle,
.vela-panel[data-compact-width='1'] .vela-panel-close,
.vela-panel[data-compact-width='1'] .vela-panel-corner-resize { order: 1; }
/* In an unusually short landscape host, keep a body viewport rather than spending
   most of the available height on a second header row. Its slot still scrolls. */
.vela-panel[data-compact-width='1'][data-very-short='1'] .vela-panel-header { flex-wrap: nowrap; }
.vela-panel[data-compact-width='1'][data-very-short='1'] .vela-panel-title { flex: 0 1 auto; max-width: 30%; }
.vela-panel[data-compact-width='1'][data-very-short='1'] .vela-panel-header-slot { order: 0; flex: 1 1 34px; min-width: 34px; width: auto; }
/* One explicit action beside Close switches between the dock and a movable card. */
.vela-panel-dock-toggle {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
}
.vela-panel-dock-toggle .vela-icon { width: 16px; height: 16px; }
.vela-panel-dock-toggle:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-dock-toggle:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
[data-layout='mobile'] .vela-panel-dock-toggle { display: none; }
/* Directly draggable top-right resize control, with keyboard resizing. */
.vela-panel-corner-resize {
    all: unset; box-sizing: border-box; display: none; flex: none; width: 26px; height: 26px;
    align-items: center; justify-content: center; border-radius: 4px; color: var(--vela-fg-muted);
    cursor: nesw-resize; touch-action: none; user-select: none; -webkit-user-select: none;
}
.vela-panel-corner-resize .vela-icon { width: 16px; height: 16px; }
.vela-panel-corner-resize:hover, .vela-panel-corner-resize[data-dragging] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-corner-resize:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
[data-layout='desktop'] .vela-panel[data-free-floating='1']:not([data-maximized]) .vela-panel-corner-resize { display: inline-flex; }
[data-layout='desktop'] .vela-panel[data-free-floating='1'] .vela-panel-grip,
[data-layout='desktop'] .vela-panel[data-free-floating='1'] .vela-panel-resizer { display: none; }
.vela-panel-position-control {
    position: absolute; z-index: 90; right: 6px; box-sizing: border-box;
    width: min(240px, calc(100% - 12px)); max-height: calc(100% - 8px); overflow: auto;
    padding: 7px; border: 1px solid var(--vela-border-strong); border-radius: 0;
    background: var(--vela-surface-elev, var(--vela-bg)); color: var(--vela-fg);
    box-shadow: var(--vela-shadow); font-size: 12px;
}
.vela-panel-position-head, .vela-panel-position-row { display: flex; align-items: center; gap: 6px; }
.vela-panel-position-head { justify-content: flex-end; }
.vela-panel-position-close {
    all: unset; cursor: pointer; width: 24px; height: 24px; text-align: center;
    color: var(--vela-fg-muted); font-size: 16px;
}
.vela-panel-position-close:hover, .vela-panel-position-close:focus-visible { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-position-row span { width: 37px; flex: none; }
.vela-panel-position-row input[type='range'] { flex: 1; min-width: 0; height: 24px; margin: 0; accent-color: var(--vela-fg-bright); }
.vela-panel-position-row input[type='number'] { box-sizing: border-box; width: 56px; height: 26px; padding: 2px 3px; border: 1px solid var(--vela-border-strong); background: var(--vela-bg); color: var(--vela-fg); font: inherit; }
/* The pin: same footprint as the close button it sits beside; filled + bright once pinned. */
.vela-panel-pin {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
}
.vela-panel-pin .vela-icon { width: 15px; height: 15px; }
.vela-panel-pin:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-pin[data-on='1'] { color: var(--vela-fg-bright); }
.vela-panel-max {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    flex: none;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
}
[data-layout='desktop'] .vela-panel[data-desktop-maximizable] .vela-panel-max { display: inline-flex; }
.vela-panel-max .vela-icon { width: 15px; height: 15px; }
.vela-panel-max:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* The phone grip gets its own row; desktop docks retain the inline handle. */
.vela-panel-grip {
    display: flex;
    flex: 0 0 32px;
    width: 32px;
    height: 26px;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-muted);
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}
.vela-panel-grip::before {
    content: '';
    width: 32px;
    height: 3px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.55;
}
.vela-panel-grip:hover, .vela-panel-grip:focus-visible { color: var(--vela-fg-bright); outline: none; }
.vela-panel-grip:focus-visible::before { outline: 2px solid var(--vela-fg-bright); outline-offset: 3px; }
.vela-panel-grip[data-dragging] { cursor: ns-resize; }
.vela-panel-grip[data-dragging]::before { opacity: 1; }
/* MAXIMIZED: the panel covers the whole dock host — every chart of the shell — whatever
   its placement; the width handle and the pin have nothing to do meanwhile. */
.vela-panel[data-maximized] {
    position: absolute;
    inset: 0;
    width: auto;
    max-width: none;
    z-index: 37;
    border-left: none;
}
.vela-panel[data-maximized] .vela-panel-resizer,
.vela-panel[data-maximized] .vela-panel-pin,
.vela-panel[data-maximized] .vela-panel-grip { display: none !important; }
.vela-panel-body { flex: 1; min-height: 0; min-width: 0; overflow: auto; padding: 8px; }
.vela-panel-body::-webkit-scrollbar { width: 8px; }
.vela-panel-body::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
/* Straddles the panel's inner border so the whole seam is grabbable; it paints only under the
   pointer — a permanently visible bar would read as a second border. */
.vela-panel-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 7px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;
}
.vela-panel-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
}
/* Extend the hit area without painting another border or moving the seam. */
.vela-panel-resizer::before { content: ''; position: absolute; inset: 0 -9px 0 -8px; }
/* The same hover ink as the workspace grid splitters and the canvas pane separators, so
   every draggable seam in the shell reads as one family. */
.vela-panel-resizer:hover::after,
.vela-panel-resizer:focus-visible::after,
.vela-panel-resizer[data-dragging]::after { background: var(--vela-separator-hover-line); }
.vela-panel-resizer:focus-visible { outline: none; }
.vela-panel-resizer:focus-visible::after { box-shadow: 0 0 0 2px var(--vela-fg-bright); }
/* An OVERLAY panel floats over the chart's right edge instead of taking a column: the
   chart keeps its width and layout (the dock host is position:relative — the anchoring the
   mobile rule below relies on too). Same z-order as that mobile overlay, above the chart's
   own DOM overlays; the shadow separates it from the plot it covers. */
.vela-panel[data-overlay] {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    max-width: 100%;
    z-index: 35;
    box-shadow: var(--vela-shadow);
}
/* A docked column can shrink from its top edge while staying attached to the bottom.
   Its title can still undock it into a freely movable card. */
[data-layout='desktop'] .vela-panel:not([data-maximized]):not([data-free-floating]) {
    align-self: flex-end;
    height: var(--vela-panel-desktop-height, 100%);
    min-height: min(112px, 100%);
    max-height: 100%;
}
[data-layout='desktop'] .vela-panel[data-overlay]:not([data-maximized]):not([data-free-floating]) { top: auto; bottom: 0; }
[data-layout='desktop'] .vela-panel-header { cursor: grab; touch-action: none; }
[data-layout='desktop'] .vela-panel[data-free-floating='1']:not([data-maximized]) {
    position: absolute;
    left: var(--vela-panel-float-left, 8px);
    top: var(--vela-panel-float-top, 8px);
    right: auto;
    bottom: auto;
    width: min(var(--vela-panel-w, 280px), var(--vela-panel-float-max-width, calc(100% - 8px)));
    max-width: var(--vela-panel-float-max-width, calc(100% - 8px));
    height: var(--vela-panel-desktop-height, min(65%, 620px));
    min-height: min(112px, var(--vela-panel-float-max-height, calc(100% - 8px)));
    max-height: var(--vela-panel-float-max-height, calc(100% - 8px));
    z-index: 35;
    border: 1px solid var(--vela-border-strong);
    border-radius: 0;
    box-shadow: var(--vela-shadow);
}
[data-layout='desktop'] .vela-panel[data-free-floating='1'][data-floating-front]:not([data-maximized]),
[data-layout='desktop'] .vela-panel[data-dock-front]:not([data-free-floating]):not([data-maximized]) { z-index: 36; }
/* A portrait phone panel stays attached to the bottom; only its top strip resizes it. */
[data-layout='mobile'] .vela-panel {
    position: absolute;
    left: 6px;
    right: 6px;
    top: auto;
    bottom: 0;
    height: clamp(min(112px, 100%), var(--vela-panel-mobile-height, 40%), 100%);
    width: auto;
    max-width: none;
    /* The chart's grid splitters use z=30; the floating panel must receive drags. */
    z-index: 35;
    border: 1px solid var(--vela-border-strong);
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
}
[data-layout='mobile'] .vela-panel[data-maximized] {
    inset: 0;
    height: auto;
    border-radius: 0;
}
[data-layout='mobile'] .vela-panel-resizer { display: none; }
[data-layout='mobile'] .vela-panel > .vela-panel-grip {
    flex: 0 0 24px; width: 100%; height: 24px; align-self: stretch;
}
[data-layout='mobile'] .vela-panel-header { cursor: default; touch-action: none; }
[data-layout='mobile'] .vela-panel-max { display: inline-flex; }
[data-layout='mobile'] .vela-panel-body { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; }
/* Standard chart panels start as full-height columns. Their floating form keeps
   the square corners, a movable header, and the shared two-axis resize button. */
[data-layout='desktop'] .vela-panel[data-standard-pane]:not([data-free-floating]) {
    height: 100% !important;
    max-width: calc(100% - min(48px, 15%));
    border-radius: 0;
    box-shadow: none;
}
[data-layout='desktop'] .vela-panel[data-standard-pane][data-free-floating] { border-radius: 0; }
[data-layout='desktop'] .vela-panel[data-standard-pane]:not([data-free-floating]) .vela-panel-grip { display: none; }
[data-layout='desktop'] .vela-panel[data-standard-pane]:not([data-free-floating]) .vela-panel-header { cursor: default; touch-action: auto; }
[data-layout='mobile'] .vela-panel[data-standard-pane] {
    left: 0;
    right: 0;
    top: auto;
    bottom: 0;
    width: auto;
    height: clamp(min(var(--vela-panel-mobile-min, 112px), 100%), var(--vela-panel-mobile-height, 40%), 100%);
    border: 0;
    border-top: 1px solid var(--vela-border-strong);
    border-radius: 0;
    box-shadow: none;
}
/* Fullscreen means the visible workspace, never the surrounding embedded host page. */
[data-layout='mobile'] .vela-panel[data-maximized] {
    left: var(--vela-panel-max-left, 0); top: var(--vela-panel-max-top, 0);
    right: auto; bottom: auto; width: var(--vela-panel-max-width, 100%);
    height: var(--vela-panel-max-height, 100%); max-height: none;
    border: 0; border-radius: 0; z-index: 100;
}
`;

/** Per-panel width policy. Omitted fields fall back to the module defaults. */
export interface SidePanelOptions {
    /** Declared width in px — also where a double-click on the drag handle returns. */
    width?: number;
    /** Let the user drag the dock's inner edge; when omitted the dock is fixed. Every
     *  free-floating card has a size button; declared resizable bounds still apply. */
    resizable?: boolean;
    minWidth?: number;
    maxWidth?: number;
    /** Float over the chart's right edge instead of docking beside it — the chart keeps
     *  its width. Docked when false/omitted. A floating panel gets a header pin the user
     *  can dock it with (see {@link SidePanel.onPlacementChange}). */
    overlay?: boolean;
    /** A header button that MAXIMIZES the panel over every chart of the shell, and restores
     *  it. For panels that are sometimes the main work surface (an editor). */
    maximizable?: boolean;
    /** A fixed desktop dock and bottom-attached, height-resizable phone pane. */
    standardPane?: boolean;
    /** Minimum phone-pane height in pixels (clamped to the available host height). */
    mobileMinHeight?: number;
}

/**
 * Clamp a width to its bounds and round to whole pixels — PURE. The drag, a programmatic
 * {@link SidePanel.setWidth}, and the restore of a persisted width all go through it, so a bad
 * stored value (or a `maxWidth` below `minWidth`) can never paint an unusable column.
 */
export function clampPanelWidth(px: number, min = DEFAULT_PANEL_MIN_WIDTH, max = DEFAULT_PANEL_MAX_WIDTH): number {
    const lo = Number.isFinite(min) && min > 0 ? min : DEFAULT_PANEL_MIN_WIDTH;
    // An infinite max is "no upper bound" (a fixed panel); a finite one below the min is a
    // caller's mistake — the min wins rather than collapsing the range.
    const hi = Number.isFinite(max) ? Math.max(max, lo) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(px)) return lo;
    return Math.round(Math.min(Math.max(px, lo), hi));
}

/** Clamp a mobile sheet's top offset to a fraction of the host height. PURE. */
export function clampPanelTop(fraction: number): number {
    if (!Number.isFinite(fraction)) return DEFAULT_PANEL_TOP;
    return Math.round(Math.min(Math.max(fraction, MIN_PANEL_TOP), MAX_PANEL_TOP) * 1000) / 1000;
}

/** Store heights as host fractions so a restored panel adapts to rotation and split views. */
export function clampPanelHeight(fraction: number): number {
    if (!Number.isFinite(fraction)) return DEFAULT_PANEL_HEIGHT;
    return Math.round(Math.min(Math.max(fraction, 0.05), 1) * 1000) / 1000;
}

export class SidePanel {
    readonly el: HTMLElement;
    /**
     * Notified whenever the panel opens or closes, by ANY path — a topbar toggle, the header ✕,
     * or another panel taking the dock. The owning shell reflects it on its chrome, so a button's
     * pressed state can never drift from the panel it controls.
     */
    onOpenChange: ((open: boolean) => void) | null = null;
    /** Notified when the USER settles a new width (drag, keyboard, control, or reset) — never on
     *  a programmatic {@link setWidth}, so restoring a persisted width raises no change. */
    onWidthChange: ((px: number) => void) | null = null;
    /** Notified when the USER pins or unpins a floating panel (`overlay` is the NEW placement) —
     *  never on a programmatic {@link setOverlay}, for the same reason as widths. */
    onPlacementChange: ((overlay: boolean) => void) | null = null;
    /** Notified when the USER settles a mobile sheet's top offset (fraction of host height). */
    onTopChange: ((top: number) => void) | null = null;
    /** A resize changes both edges atomically for persistence and undo. */
    onSheetResize: ((top: number, height: number) => void) | null = null;
    onDesktopHeightChange: ((height: number) => void) | null = null;
    /** Desktop free-float mode and a settled user position (never presentation-only clamps). */
    onFloatingChange: ((floating: boolean) => void) | null = null;
    onFloatingPositionChange: ((position: FloatingPanelPosition) => void) | null = null;
    /** One corner resize changes size and position together in a single history step. */
    onFloatingResize: ((width: number, height: number | null, position: FloatingPanelPosition | null) => void) | null = null;
    /** The dock raises an interacted-with panel without reparenting its content. */
    onActivate: (() => void) | null = null;
    protected readonly body: HTMLElement;
    /** Where the panel mounts, remembered so mounting can wait for the first open. */
    private readonly hostEl: HTMLElement;
    /** In the document? A panel nobody has opened stays OUT of it — a workspace with four
     *  closed panels carries none of their nodes (see {@link mount}). */
    private mounted = false;
    private readonly heading: HTMLElement;
    private readonly header: HTMLElement;
    private readonly slot: HTMLElement;
    private readonly dockButton: HTMLButtonElement;
    private readonly cornerResize: HTMLButtonElement;
    private dockTip: Tooltip | null = null;
    private positionControl: HTMLElement | null = null;
    private positionAnchor: HTMLElement | null = null;
    private positionCleanup: (() => void) | null = null;
    /** Intended position survives temporary viewport clamps and is stored as host fractions. */
    private floatPosition: FloatingPanelPosition | null = null;
    private readonly declaredWidth: number;
    private readonly minWidth: number;
    private readonly maxWidth: number;
    private readonly resizable: boolean;
    private widthPx: number;
    private widthGrip: HTMLElement | null = null;
    private updateWidthGrip: (() => void) | null = null;
    /** Declared `overlay` — the panel CAN float; {@link overlay} says whether it does right now. */
    private readonly floatable: boolean;
    private readonly standardPane: boolean;
    private readonly mobileMinHeight: number;
    private readonly desktopMaximizable: boolean;
    private overlayOn: boolean;
    private readonly pin: HTMLButtonElement | null = null;
    private readonly maxButton: HTMLButtonElement | null = null;
    private readonly sheetGrip: HTMLElement;
    private sizeObserver: ResizeObserver | null = null;
    private updateResizeGrip: (() => void) | null = null;
    private viewportCleanup: (() => void) | null = null;
    private cancelCornerDrag: (() => void) | null = null;
    /** Transient visual-viewport adjustment; never written to saved panel geometry. */
    private visualShiftY = 0;
    private maximizedOn = false;
    /** Mobile geometry and optional desktop height, as fractions of the dock host. */
    private topPct = DEFAULT_PANEL_TOP;
    private heightPct = DEFAULT_PANEL_HEIGHT;
    private desktopHeightPct: number | null = null;
    /** Set while the close is announced, so a listener's own close does not re-enter. */
    private closing = false;
    /** Open as far as the dock and the host are concerned — a closed panel can still be on
     *  screen while its exit animation runs. */
    private isOpen = false;
    /** The exit animation of a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;

    /** `modifier` is the panel's own class, carrying its content styles (e.g. `vela-ot`). */
    constructor(host: HTMLElement, title: string, modifier: string, opts: SidePanelOptions = {}) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        // A FIXED panel is its own bound — the resize bounds would otherwise silently rewrite a
        // declared width a host set from code (or restored) outside the resizable defaults.
        this.resizable = opts.resizable === true;
        this.minWidth = opts.resizable ? (opts.minWidth ?? DEFAULT_PANEL_MIN_WIDTH) : 1;
        this.maxWidth = opts.resizable ? (opts.maxWidth ?? DEFAULT_PANEL_MAX_WIDTH) : Number.POSITIVE_INFINITY;
        this.declaredWidth = clampPanelWidth(opts.width ?? DEFAULT_PANEL_WIDTH, this.minWidth, this.maxWidth);
        this.widthPx = this.declaredWidth;
        this.el = doc.createElement('div');
        this.el.className = `vela-panel ${modifier}`;
        this.el.hidden = true;
        this.standardPane = opts.standardPane === true;
        this.desktopMaximizable = opts.maximizable === true && !this.standardPane;
        if (this.desktopMaximizable) this.el.dataset.desktopMaximizable = '1';
        this.mobileMinHeight = Number.isFinite(opts.mobileMinHeight) ? Math.max(112, opts.mobileMinHeight!) : 112;
        if (this.standardPane) {
            this.el.dataset.standardPane = '1';
            this.el.style.setProperty('--vela-panel-mobile-min', `${this.mobileMinHeight}px`);
        }
        this.floatable = !this.standardPane && opts.overlay === true;
        this.overlayOn = this.floatable;
        if (this.overlayOn) this.el.dataset.overlay = '1';
        this.el.style.setProperty('--vela-panel-w', `${this.widthPx}px`);
        const header = doc.createElement('div');
        this.header = header;
        header.className = 'vela-panel-header';
        if (!this.standardPane) {
            header.tabIndex = 0;
            header.setAttribute('role', 'group');
            header.setAttribute('aria-label', `Move ${title} panel`);
        }
        this.heading = doc.createElement('span');
        this.heading.className = 'vela-panel-title';
        this.heading.textContent = title;
        // The header SLOT — the space between the title and the close button, handed to a
        // contributed panel's `mount` so it can dock its own compact controls there
        // (script name, action icons) instead of spending a toolbar row on them.
        this.slot = doc.createElement('div');
        this.slot.className = 'vela-panel-header-slot';
        const close = doc.createElement('button');
        close.className = 'vela-panel-close';
        close.appendChild(iconEl('close', doc));
        close.title = 'Close';
        close.addEventListener('click', () => this.toggle(false));
        this.dockButton = doc.createElement('button');
        this.dockButton.type = 'button';
        this.dockButton.className = 'vela-panel-dock-toggle';
        this.dockButton.addEventListener('click', () => this.setFloating(!this.floating, true));
        // Real documents use the shared themed tooltip; tiny unit-test DOMs have no listeners.
        if (typeof doc.addEventListener === 'function') {
            this.dockTip = new Tooltip(this.dockButton, { content: 'Float panel' });
        }
        this.refreshDockButton();
        this.cornerResize = doc.createElement('button');
        this.cornerResize.type = 'button';
        this.cornerResize.className = 'vela-panel-corner-resize';
        this.cornerResize.setAttribute('aria-label', `Resize ${title} panel`);
        this.cornerResize.title = 'Drag to resize · use arrow keys';
        this.cornerResize.appendChild(iconEl('pane-expand', doc));
        linkPanelResizeGrip(this.cornerResize, this.el);
        // The pin exists only on a panel that can float: pressed, it docks the panel as a
        // column (the chart makes room); released, the panel floats again.
        if (this.floatable) {
            this.pin = doc.createElement('button');
            this.pin.className = 'vela-panel-pin';
            this.pin.addEventListener('click', () => {
                const wasOverlay = this.overlayOn;
                if (this.floating) {
                    this.setFloating(false, true);
                    if (!wasOverlay) {
                        this.setOverlay(true);
                        this.onPlacementChange?.(true);
                    }
                    return;
                }
                this.setOverlay(!this.overlayOn);
                this.onPlacementChange?.(this.overlayOn);
            });
            this.refreshPin();
        }
        this.maxButton = doc.createElement('button');
        this.maxButton.type = 'button';
        this.maxButton.className = 'vela-panel-max';
        this.maxButton.addEventListener('click', () => this.setMaximized(!this.maximizedOn));
        this.refreshMaxButton();
        // The resize target is separate from both the header and content scroller.
        this.sheetGrip = doc.createElement('div');
        this.sheetGrip.className = 'vela-panel-grip';
        this.sheetGrip.tabIndex = 0;
        this.sheetGrip.setAttribute('role', 'separator');
        this.sheetGrip.setAttribute('aria-orientation', 'horizontal');
        this.sheetGrip.setAttribute('aria-label', `Resize ${title} panel`);
        this.sheetGrip.setAttribute('aria-valuemin', '0');
        this.sheetGrip.setAttribute('aria-valuemax', '100');
        this.sheetGrip.setAttribute('aria-valuenow', '40');
        this.sheetGrip.title = 'Drag to resize · use arrow keys';
        this.mountSheetControls(header);
        this.setTop(DEFAULT_PANEL_TOP);
        header.append(
            this.sheetGrip,
            this.heading,
            this.slot,
            ...(this.pin ? [this.pin] : []),
            ...(this.maxButton ? [this.maxButton] : []),
            this.dockButton,
            close,
            this.cornerResize,
        );
        this.body = doc.createElement('div');
        this.body.className = 'vela-panel-body';
        this.el.append(header, this.body);
        if (opts.resizable) this.mountResizer(doc);
        this.hostEl = host;
        this.mountDesktopMovement(header);
        this.mountCornerResize();
        // Raising changes only stacking order; the editor and its inputs are never remounted.
        this.el.addEventListener('pointerdown', () => {
            if (this.isOpen && this.isDesktop()) this.onActivate?.();
        }, true);
        this.el.addEventListener('focusin', (event: FocusEvent) => {
            if (this.isOpen && this.isDesktop()) this.onActivate?.();
            this.revealFocusedTarget(event.target instanceof Element ? event.target : null);
        });
        this.mountVisualViewport();
    }

    /** Put the panel in the document — once, on its first open. */
    private mount(): void {
        if (this.mounted) return;
        this.mounted = true;
        this.hostEl.appendChild(this.el);
    }

    get open(): boolean {
        return this.isOpen;
    }

    /**
     * Open/close the panel — a bare call flips it. The panel reports closed at once, but a
     * close keeps it on screen, marked `data-closing`, while a host exit animation runs.
     * `instant` skips that, and also cuts short the exit of a panel already closing: a panel
     * handing the dock to another leaves at once.
     */
    toggle(open = !this.isOpen, instant = false): void {
        if (open === this.isOpen) {
            if (!open && instant) this.exit?.finish();
            return;
        }
        if (!open && this.closing) return;
        // Close announces while the panel still shows, open once it does.
        if (!open) {
            this.cancelCornerDrag?.();
            this.closePositionControl();
            this.closing = true;
            announceSurface(this.el, false, 'panel');
            this.closing = false;
        }
        this.isOpen = open;
        if (open) {
            this.mount();
            if (this.exit) {
                this.exit.cancel();
                this.exit = null;
                this.setMaximized(false);
            }
            this.el.hidden = false;
            this.reflowVisualViewport();
        } else {
            const hide = (): void => {
                this.exit = null;
                this.el.hidden = true;
                // A closed panel reopens at its own size — maximizing is a moment, not a placement.
                this.setMaximized(false);
            };
            if (instant) hide();
            else this.exit = holdForExit(this.el, hide);
        }
        this.onOpenChange?.(open);
        // After the host heard it — a listener that closes the panel again then reports last.
        if (open && this.isOpen) announceSurface(this.el, true, 'panel');
    }

    /** Whether the panel covers every chart right now. */
    get maximized(): boolean {
        return this.maximizedOn;
    }

    /** Maximize the panel over the shell's charts, or restore it. A no-op on a panel not
     *  declared `maximizable`. */
    setMaximized(maximized: boolean): void {
        if (!this.maxButton || maximized === this.maximizedOn) return;
        if (maximized && !this.desktopMaximizable && !this.el.closest?.('[data-layout="mobile"]')) return;
        if (maximized) this.cancelCornerDrag?.();
        this.maximizedOn = maximized;
        if (maximized) this.closePositionControl();
        if (maximized) this.el.dataset.maximized = '1';
        else delete this.el.dataset.maximized;
        this.reflowVisualViewport();
        this.refreshMaxButton();
    }

    private refreshMaxButton(): void {
        if (!this.maxButton) return;
        const doc = this.maxButton.ownerDocument;
        this.maxButton.replaceChildren(iconEl(this.maximizedOn ? 'restore' : 'maximize', doc));
        this.maxButton.title = this.maximizedOn ? 'Restore' : 'Maximize';
        this.maxButton.setAttribute('aria-label', this.maxButton.title);
        this.maxButton.setAttribute('aria-pressed', this.maximizedOn ? 'true' : 'false');
    }

    /** Mobile geometry as fractions of the host height. */
    get top(): number { return this.topPct; }
    get mobileHeight(): number { return this.heightPct; }
    get desktopHeight(): number | null { return this.desktopHeightPct; }

    private setMobileGeometry(height: number): void {
        this.heightPct = clampPanelHeight(height);
        // A phone pane has a single bottom-attached geometry. Older documents can
        // contain an independently dragged top; its height remains valid, but the
        // old offset must not detach the pane again on restore or undo/redo.
        this.topPct = Math.round((1 - this.heightPct) * 1000) / 1000;
        this.el.style.setProperty('--vela-panel-top', `${(this.topPct * 100).toFixed(1)}%`);
        this.el.style.setProperty('--vela-panel-mobile-height', `${(this.heightPct * 100).toFixed(1)}%`);
        this.el.dataset.sheetTop = String(this.topPct);
        this.reflowVisualViewport();
    }

    /** Legacy top setter: report the bottom-attached top rather than detaching the pane. */
    setTop(_fraction: number, notify = false): void {
        this.setMobileGeometry(this.heightPct);
        if (notify) this.onTopChange?.(this.topPct);
    }

    /** Old saved top offsets no longer detach phone panes; retain their saved heights. */
    restoreMobileTop(_fraction: number | undefined): void {
        this.setMobileGeometry(this.heightPct);
    }

    /** Restore a sheet height without confusing it with a desktop panel height. */
    setMobileHeight(fraction: number, notify = false): void {
        this.setMobileGeometry(fraction);
        if (notify) this.onSheetResize?.(this.topPct, this.heightPct);
    }

    /** Null restores the desktop panel's automatic default (docked/full or floating/compact). */
    setDesktopHeight(fraction: number | null, notify = false): void {
        // A stored height must not shrink a standard dock; its floating form can resize.
        if (this.standardPane && !this.floating && fraction !== null) return;
        this.desktopHeightPct = fraction === null ? null : clampPanelHeight(fraction);
        if (this.desktopHeightPct === null) this.el.style.removeProperty('--vela-panel-desktop-height');
        else this.el.style.setProperty('--vela-panel-desktop-height', `${(this.desktopHeightPct * 100).toFixed(1)}%`);
        // Undo/restore can expand a freely floating panel; keep it inside the host.
        if (this.el.dataset.freeFloating && this.el.isConnected && !this.maximizedOn && this.el.closest('[data-layout="desktop"]')) {
            const host = this.hostEl.getBoundingClientRect();
            const panel = this.el.getBoundingClientRect();
            const top = Math.min(Math.max(4, panel.top - host.top), Math.max(4, host.height - this.header.getBoundingClientRect().height - 4));
            this.el.style.setProperty('--vela-panel-float-top', `${Math.round(top)}px`);
        }
        if (notify && this.desktopHeightPct !== null) this.onDesktopHeightChange?.(this.desktopHeightPct);
    }

    /** Temporarily keep a phone panel above a shrunken visual viewport (e.g. a keyboard).
     * This presentation-only translation/max-height does not rewrite the saved geometry. */
    private reflowVisualViewport(): void {
        if (!this.hostEl || !this.el.isConnected || this.el.hidden) return;
        const win = this.el.ownerDocument.defaultView;
        const view = win?.visualViewport;
        this.refreshMovementHeader();
        this.updateWidthGrip?.();
        if (!this.isDesktop()) { this.cancelCornerDrag?.(); this.closePositionControl(); }
        if (this.isDesktop() && this.floating && !this.maximizedOn) {
            this.el.style.removeProperty('translate');
            this.el.style.removeProperty('max-height');
            this.el.style.removeProperty('max-width');
            this.visualShiftY = 0;
            const host = this.hostEl.getBoundingClientRect();
            const pos = this.floatPosition;
            const panel = this.el.getBoundingClientRect();
            this.placeFloating(pos ? pos.x * host.width : panel.left - host.left,
                pos ? pos.y * host.height : panel.top - host.top, false);
            this.updateResizeGrip?.();
            this.revealFocusedTarget(this.el.ownerDocument.activeElement);
            return;
        }
        if (this.maximizedOn && this.el.closest?.('[data-layout="mobile"]')) this.syncMobileMaxBounds();
        this.el.style.removeProperty('translate');
        this.el.style.removeProperty('max-height');
        this.el.style.removeProperty('max-width');
        this.visualShiftY = 0;
        if (!view || !this.el.closest('[data-layout="mobile"]') || this.maximizedOn) {
            this.updateResizeGrip?.();
            return;
        }
        const host = this.hostEl.getBoundingClientRect();
        const top = Math.max(host.top, view.offsetTop);
        const bottom = Math.min(host.bottom, view.offsetTop + view.height);
        const left = Math.max(host.left, view.offsetLeft);
        const right = Math.min(host.right, view.offsetLeft + view.width);
        if (bottom <= top || right <= left) { this.updateResizeGrip?.(); return; }
        const clippedVertically = top > host.top + 1 || bottom < host.bottom - 1;
        const clippedHorizontally = left > host.left + 1 || right < host.right - 1;
        if (clippedVertically) this.el.style.maxHeight = `${Math.max(1, bottom - top)}px`;
        if (clippedHorizontally) this.el.style.maxWidth = `${Math.max(1, right - left)}px`;
        const panel = this.el.getBoundingClientRect();
        if (!panel.height) return;
        // A keyboard or zoom can shrink the visible viewport. Keep the pane attached
        // to its visible bottom temporarily, without rewriting its saved height.
        const safeTop = clippedVertically ? bottom - panel.height : panel.top;
        const safeLeft = clippedHorizontally
            ? Math.min(Math.max(panel.left, left), Math.max(left, right - panel.width)) : panel.left;
        this.visualShiftY = Math.round(safeTop - panel.top);
        const shiftX = Math.round(safeLeft - panel.left);
        if (shiftX || this.visualShiftY) this.el.style.setProperty('translate', `${shiftX}px ${this.visualShiftY}px`);
        this.updateResizeGrip?.();
    }

    private syncMobileMaxBounds(): void {
        const root = this.el.closest<HTMLElement>('[data-layout="mobile"]');
        if (!root) return;
        const host = this.hostEl.getBoundingClientRect();
        const rect = root.getBoundingClientRect();
        const view = this.el.ownerDocument.defaultView?.visualViewport;
        const left = view ? Math.max(rect.left, view.offsetLeft) : rect.left;
        const top = view ? Math.max(rect.top, view.offsetTop) : rect.top;
        const right = view ? Math.min(rect.right, view.offsetLeft + view.width) : rect.right;
        const bottom = view ? Math.min(rect.bottom, view.offsetTop + view.height) : rect.bottom;
        if (right <= left || bottom <= top) return;
        this.el.style.setProperty('--vela-panel-max-left', `${Math.round(left - host.left)}px`);
        this.el.style.setProperty('--vela-panel-max-top', `${Math.round(top - host.top)}px`);
        this.el.style.setProperty('--vela-panel-max-width', `${Math.round(right - left)}px`);
        this.el.style.setProperty('--vela-panel-max-height', `${Math.round(bottom - top)}px`);
    }

    private mountVisualViewport(): void {
        const win = this.el.ownerDocument.defaultView;
        const onResize = (): void => {
            this.reflowVisualViewport();
            // Layout-mode can switch in a ResizeObserver after the window resize event.
            win?.requestAnimationFrame?.(() => this.reflowVisualViewport());
        };
        win?.addEventListener('resize', onResize);
        win?.visualViewport?.addEventListener('resize', onResize);
        win?.visualViewport?.addEventListener('scroll', onResize);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
        observer?.observe(this.hostEl);
        this.viewportCleanup = () => {
            observer?.disconnect();
            win?.removeEventListener('resize', onResize);
            win?.visualViewport?.removeEventListener('resize', onResize);
            win?.visualViewport?.removeEventListener('scroll', onResize);
        };
    }

    /** Host height for a pointer drag; a minimal test DOM falls back to its viewport. */
    private sheetHostHeight(): number {
        const rect = typeof this.hostEl?.getBoundingClientRect === 'function' ? this.hostEl.getBoundingClientRect() : null;
        const h = rect?.height || this.el.ownerDocument.defaultView?.innerHeight || 640;
        return Math.max(1, h);
    }

    /** Resize the top edge, leaving the bottom fixed. Phone titles are not handles. */
    private mountSheetControls(header: HTMLElement): void {
        const grip = this.sheetGrip;
        const isMobile = (): boolean => typeof this.el.closest !== 'function' || !!this.el.closest('[data-layout="mobile"]');
        type Geometry = { height: number; bottom: number; hostTop: number; hostHeight: number; min: number; max: number };
        const geometry = (bottom?: number): Geometry => {
            const hostRect = typeof this.hostEl.getBoundingClientRect === 'function' ? this.hostEl.getBoundingClientRect() : null;
            const hostHeight = this.sheetHostHeight();
            const hostTop = hostRect?.top ?? 0;
            const r = typeof this.el.getBoundingClientRect === 'function' ? this.el.getBoundingClientRect() : null;
            const height = r?.height || hostHeight * (isMobile() ? this.heightPct : this.desktopHeightPct ?? 1);
            const panelBottom = bottom ?? (r?.height ? r.bottom : hostTop + hostHeight * (this.topPct + this.heightPct));
            const view = this.el.ownerDocument.defaultView?.visualViewport;
            const visibleTop = isMobile() && view ? Math.max(hostTop, view.offsetTop) : hostTop;
            const max = Math.max(1, Math.min(hostHeight, panelBottom - visibleTop));
            const headRect = typeof header.getBoundingClientRect === 'function' ? header.getBoundingClientRect() : null;
            const chrome = headRect?.height && r?.height ? Math.max(headRect.height, headRect.bottom - r.top) : (headRect?.height || 34);
            const min = Math.min(max, Math.max(this.standardPane ? this.mobileMinHeight : 112, chrome + 48));
            return { height, bottom: panelBottom, hostTop, hostHeight, min, max };
        };
        const updateGrip = (): void => {
            linkPanelResizeGrip(grip, this.el);
            const { height, min, max } = geometry();
            grip.setAttribute('aria-valuemin', String(Math.round(min)));
            grip.setAttribute('aria-valuemax', String(Math.round(max)));
            grip.setAttribute('aria-valuenow', String(Math.round(Math.min(Math.max(height, min), max))));
            grip.setAttribute('aria-valuetext', `${Math.round(height)} pixels high`);
        };
        this.updateResizeGrip = updateGrip;
        const resizeTo = (height: number, bottom: number, commit = false): void => {
            const g = geometry(bottom);
            const next = Math.min(Math.max(height, g.min), g.max);
            if (isMobile()) {
                this.setMobileGeometry(next / g.hostHeight);
                if (commit) this.onSheetResize?.(this.topPct, this.heightPct);
            } else {
                this.setDesktopHeight(next / g.hostHeight);
                if (this.floating) {
                    const host = this.hostEl.getBoundingClientRect();
                    const panel = this.el.getBoundingClientRect();
                    this.placeFloating(panel.left - host.left, bottom - next - g.hostTop, true);
                    if (commit && this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
                }
                if (commit && this.desktopHeightPct !== null) this.onDesktopHeightChange?.(this.desktopHeightPct);
            }
            updateGrip();
        };
        grip.addEventListener('dblclick', () => {
            const g = geometry();
            const target = isMobile() ? DEFAULT_PANEL_HEIGHT * g.hostHeight
                : this.el.dataset.freeFloating ? Math.min(g.hostHeight * 0.65, 620) : g.hostHeight;
            resizeTo(target, g.bottom, true);
        });
        grip.addEventListener('focus', updateGrip);
        grip.addEventListener('keydown', (e: KeyboardEvent) => {
            const g = geometry();
            const step = e.shiftKey ? 96 : 32;
            if (e.key === 'ArrowUp') resizeTo(g.height + step, g.bottom, true);
            else if (e.key === 'ArrowDown') resizeTo(g.height - step, g.bottom, true);
            else if (e.key === 'Home') resizeTo(g.min, g.bottom, true);
            else if (e.key === 'End') resizeTo(g.max, g.bottom, true);
            else return;
            e.preventDefault();
        });
        let drag: { id: number; y: number; height: number; bottom: number; moved: boolean;
            mobile: boolean; savedHeight: number;
            savedDesktopHeight: number | null; savedPosition: FloatingPanelPosition | null } | null = null;
        grip.addEventListener('pointerdown', (e: PointerEvent) => {
            if (drag || e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0) || this.maximizedOn) return;
            const g = geometry();
            drag = { id: e.pointerId, y: e.clientY, height: g.height, bottom: g.bottom, moved: false,
                mobile: isMobile(), savedHeight: this.heightPct,
                savedDesktopHeight: this.desktopHeightPct, savedPosition: this.floatingPosition };
            try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        });
        grip.addEventListener('pointermove', (e: PointerEvent) => {
            if (!drag || drag.id !== e.pointerId) return;
            const dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dy) < 4) return;
            drag.moved = true;
            grip.dataset.dragging = '1';
            resizeTo(drag.height - dy, drag.bottom);
            e.preventDefault();
        });
        const end = (e: PointerEvent): void => {
            if (!drag || drag.id !== e.pointerId) return;
            const finished = drag;
            drag = null;
            delete grip.dataset.dragging;
            try { grip.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
            if (!finished.moved) return;
            if (e.type !== 'pointerup') {
                if (finished.mobile) this.setMobileGeometry(finished.savedHeight);
                else {
                    this.setDesktopHeight(finished.savedDesktopHeight);
                    this.setFloatingPosition(finished.savedPosition);
                }
                updateGrip();
                return;
            }
            if (finished.mobile) this.onSheetResize?.(this.topPct, this.heightPct);
            else if (this.desktopHeightPct !== null) this.onDesktopHeightChange?.(this.desktopHeightPct);
        };
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
        grip.addEventListener('lostpointercapture', end);
        if (typeof ResizeObserver !== 'undefined') {
            this.sizeObserver = new ResizeObserver(() => {
                if (!this.el.isConnected || this.el.hidden) return;
                const rect = this.el.getBoundingClientRect();
                if (rect.width < 225) this.el.dataset.compactWidth = '1';
                else delete this.el.dataset.compactWidth;
                if (rect.height < 180) this.el.dataset.compactHeight = '1';
                else delete this.el.dataset.compactHeight;
                if (rect.height < 105) this.el.dataset.veryShort = '1';
                else delete this.el.dataset.veryShort;
                if (!this.maximizedOn) updateGrip();
            });
            this.sizeObserver.observe(this.el);
        }
    }

    /** A standard dock moves only after the explicit Float action. Existing contributed
     *  panels also retain their title-drag-to-undock shortcut. */
    private mountDesktopMovement(header: HTMLElement): void {
        const origin = (): { left: number; top: number } => {
            const host = this.hostEl.getBoundingClientRect();
            const panel = this.el.getBoundingClientRect();
            return { left: panel.left - host.left, top: panel.top - host.top };
        };
        const commit = (): void => {
            if (this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
        };
        let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
        header.addEventListener('pointerdown', (e: PointerEvent) => {
            if (!this.isDesktop() || (this.standardPane && !this.floating) || e.isPrimary === false
                || (e.pointerType === 'mouse' && e.button !== 0)) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('button, input, select, textarea, a, [role="button"], [role="separator"]')) return;
            const start = origin();
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ...start, moved: false };
            try { header.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        });
        header.addEventListener('pointermove', (e: PointerEvent) => {
            if (!drag || drag.id !== e.pointerId) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            if (!drag.moved) {
                if (this.maximizedOn) this.setMaximized(false);
                if (!this.floating) this.setFloating(true, true, 'current');
                const start = origin();
                drag.left = start.left;
                drag.top = start.top;
                drag.moved = true;
            }
            this.placeFloating(drag.left + dx, drag.top + dy, true);
            e.preventDefault();
        });
        const end = (e: PointerEvent): void => {
            if (!drag || drag.id !== e.pointerId) return;
            const moved = drag.moved;
            drag = null;
            try { header.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
            if (moved) commit();
            // A tap on the title reveals non-drag positioning on touch-only landscape devices.
            else if (e.type === 'pointerup' && e.pointerType === 'touch' && this.floating) this.openPositionControl();
        };
        header.addEventListener('pointerup', end);
        header.addEventListener('pointercancel', end);
        header.addEventListener('lostpointercapture', end);
        header.addEventListener('dblclick', (e: MouseEvent) => {
            if (!this.isDesktop() || (e.target as HTMLElement | null)?.closest?.('button, input, select, textarea, a')) return;
            this.setFloating(false, true);
        });
        header.addEventListener('contextmenu', (e: MouseEvent) => {
            if (!this.isDesktop() || !this.floating || (e.target as HTMLElement | null)?.closest?.('button, input, select, textarea, a')) return;
            e.preventDefault();
            this.openPositionControl();
        });
        header.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.isDesktop() || e.target !== header || (this.standardPane && !this.floating)) return;
            if (this.floating && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
                this.openPositionControl(true); e.preventDefault(); return;
            }
            if (e.key === 'Home' && this.floating) { this.setFloating(false, true); e.preventDefault(); return; }
            const step = e.shiftKey ? 48 : 16;
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            if (!dx && !dy) return;
            if (this.maximizedOn) this.setMaximized(false);
            if (!this.floating) this.setFloating(true, true, 'current');
            const start = origin();
            this.placeFloating(start.left + dx, start.top + dy, true);
            commit();
            e.preventDefault();
        });
    }

    /** The scrolling body, for a panel filled from OUTSIDE the class — a contributed panel's
     *  `mount` receives exactly this element. Subclasses use the protected `body`. */
    get content(): HTMLElement {
        return this.body;
    }

    /** The header slot between the title and the close button — a contributed panel's
     *  `mount` receives it (via {@link SidePanelHeader}) to dock compact controls. */
    get headerSlot(): HTMLElement {
        return this.slot;
    }

    /** Replace the header title. The topbar toggle keeps the DECLARED title as its
     *  tooltip — this only changes what the open column says about itself. */
    setTitle(title: string): void {
        this.heading.textContent = title;
        this.sheetGrip.setAttribute('aria-label', `Resize ${title} panel`);
        this.cornerResize.setAttribute('aria-label', `Resize ${title} panel`);
        this.widthGrip?.setAttribute('aria-label', `Resize ${title} panel width`);
        this.refreshMovementHeader();
    }

    /** Current width in px. */
    get width(): number {
        return this.widthPx;
    }

    /** Resize the panel (clamped). Silent — {@link onWidthChange} reports user drags only. */
    setWidth(px: number): void {
        const next = clampPanelWidth(px, this.minWidth, this.maxWidth);
        if (next === this.widthPx) return;
        this.widthPx = next;
        this.el.style.setProperty('--vela-panel-w', `${next}px`);
        this.updateWidthGrip?.();
    }

    /** Restore the declared default when a complete document has no stored width. */
    resetWidth(): void {
        this.setWidth(this.declaredWidth);
    }

    /** Desktop free-floating mode; the phone still presents the same panel as its sheet. */
    get floating(): boolean {
        return this.el.dataset.freeFloating === '1';
    }

    get floatingPosition(): FloatingPanelPosition | null {
        return this.floatPosition ? { ...this.floatPosition } : null;
    }

    private isDesktop(): boolean {
        // A detached or minimal test DOM has no active desktop movement surface yet.
        return typeof this.el.closest === 'function' && !!this.el.closest('[data-layout="desktop"]');
    }

    /** Real visible limits, including the narrower host/viewport cap of standard and floating panes. */
    private widthGeometry(): { value: number; min: number; max: number } {
        const declaredMin = !this.resizable && this.floating ? MIN_FLOAT_PANEL_WIDTH
            : Number.isFinite(this.minWidth) && this.minWidth > 0 ? this.minWidth : DEFAULT_PANEL_MIN_WIDTH;
        let max = Number.isFinite(this.maxWidth) ? Math.max(declaredMin, this.maxWidth) : Number.POSITIVE_INFINITY;
        const host = this.hostEl?.getBoundingClientRect?.();
        const panel = this.el.isConnected ? this.el.getBoundingClientRect?.() : null;
        if (this.isDesktop() && this.floating) {
            const g = this.floatingGeometry();
            if (g) max = Math.min(max, Math.max(1, g.maxLeft - g.minLeft + g.panel.width));
        } else if (this.isDesktop() && this.standardPane && host?.width) {
            max = Math.min(max, Math.max(1, host.width - Math.min(48, host.width * 0.15)));
        }
        const min = Math.min(declaredMin, max);
        return { value: panel?.width || this.widthPx, min, max };
    }

    /** Resize from the inner edge while keeping a floating panel's outer edge fixed. */
    private resizeWidth(px: number, commit: boolean): void {
        const before = this.widthPx;
        const host = this.floating && this.isDesktop() ? this.hostEl.getBoundingClientRect() : null;
        const panel = host ? this.el.getBoundingClientRect() : null;
        this.setWidth(px);
        if (this.widthPx === before) return;
        if (host && panel) {
            this.placeFloating(panel.right - host.left - this.el.getBoundingClientRect().width, panel.top - host.top, true);
        }
        if (commit) {
            this.onWidthChange?.(this.widthPx);
            if (host && this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
        }
    }

    /** Switch modes in place so scroll positions, drafts, subscriptions and Monaco survive. */
    setFloating(floating: boolean, notify = false, origin: 'center' | 'current' = 'center'): void {
        if (floating === this.floating) return;
        this.cancelCornerDrag?.();
        if (this.maximizedOn) this.setMaximized(false);
        this.closePositionControl();
        if (floating) {
            const host = this.hostEl.getBoundingClientRect?.();
            const before = this.el.getBoundingClientRect?.();
            this.el.dataset.freeFloating = '1';
            delete this.el.dataset.dockFront;
            if (!this.floatPosition && host?.width && host.height && before?.width && before.height) {
                const card = this.el.getBoundingClientRect();
                let left = origin === 'center' ? (host.width - card.width) / 2 : before.left - host.left;
                let top = origin === 'center' ? (host.height - card.height) / 2 : before.top - host.top;
                if (origin === 'center') {
                    const existing = Array.from(this.hostEl.querySelectorAll<HTMLElement>(':scope > .vela-panel[data-free-floating]'))
                        .filter((panel) => panel !== this.el && !panel.hidden && !panel.hasAttribute('data-closing')).length;
                    if (existing) {
                        const step = Math.ceil(existing / 2) * (existing % 2 ? 1 : -1);
                        // A title row remains visible behind the next card, not a pile of
                        // indistinguishable windows in exactly the same coordinates.
                        left -= step * 32;
                        top += step * 64;
                    }
                }
                this.floatPosition = {
                    x: Math.max(0, Math.min(1, left / host.width)),
                    y: Math.max(0, Math.min(1, top / host.height)),
                };
            }
        } else {
            delete this.el.dataset.freeFloating;
            delete this.el.dataset.floatingFront;
            // An anchored overlay is not a side column: the explicit Dock action pins it.
            if (notify && this.overlayOn) {
                this.setOverlay(false);
                this.onPlacementChange?.(false);
            }
        }
        this.refreshDockButton();
        this.reflowVisualViewport();
        if (notify) {
            this.onFloatingChange?.(floating);
            if (floating && this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
        }
        if (this.isOpen && this.isDesktop()) this.onActivate?.();
    }

    /** Restore a preferred desktop position silently, including while a panel is closed. */
    setFloatingPosition(position: FloatingPanelPosition | null): void {
        this.floatPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
            ? { x: Math.min(1, Math.max(0, position.x)), y: Math.min(1, Math.max(0, position.y)) }
            : null;
        if (this.floating) this.reflowVisualViewport();
    }

    setFloatingFront(front: boolean): void {
        if (front && this.floating) this.el.dataset.floatingFront = '1';
        else delete this.el.dataset.floatingFront;
    }

    setDockFront(front: boolean): void {
        if (front && !this.floating) this.el.dataset.dockFront = '1';
        else delete this.el.dataset.dockFront;
    }

    private refreshDockButton(): void {
        const action = this.floating ? 'Dock panel beside chart' : 'Float panel';
        this.dockButton.replaceChildren(iconEl(this.floating ? 'panel-dock' : 'panel-float', this.el.ownerDocument));
        this.dockButton.setAttribute('aria-label', action);
        this.dockTip?.setContent(action);
        this.refreshMovementHeader();
    }

    /** Move only the grip, never the panel contents, as phone/desktop chrome changes. */
    private syncGripPlacement(): void {
        if (!this.sheetGrip || !this.el.isConnected) return;
        const mobile = !!this.el.closest('[data-layout="mobile"]');
        const target = mobile ? this.el : this.header;
        if (this.sheetGrip.parentElement === target) return;
        const focused = this.el.ownerDocument.activeElement === this.sheetGrip;
        if (mobile) this.el.insertBefore(this.sheetGrip, this.header);
        else this.header.prepend(this.sheetGrip);
        if (focused && this.el.ownerDocument.defaultView?.getComputedStyle(this.sheetGrip).display !== 'none') {
            this.sheetGrip.focus({ preventScroll: true });
        }
    }

    private refreshMovementHeader(): void {
        this.syncGripPlacement();
        const mobile = !!this.el.closest?.('[data-layout="mobile"]');
        const desktopMovable = this.floating && this.isDesktop();
        this.heading.title = desktopMovable ? 'Drag to move · right-click or tap for position controls' : '';
        if (this.standardPane) {
            this.header.tabIndex = desktopMovable ? 0 : -1;
            if (desktopMovable) {
                this.header.setAttribute('role', 'group');
                this.header.setAttribute('aria-label', `Move ${this.heading.textContent || 'panel'} panel`);
            } else {
                this.header.removeAttribute?.('role');
                this.header.removeAttribute?.('aria-label');
            }
        } else if (mobile) {
            this.header.tabIndex = -1;
            this.header.removeAttribute?.('role');
            this.header.removeAttribute?.('aria-label');
        } else {
            // Contributed desktop docks can still be floated by dragging their heading.
            this.header.tabIndex = 0;
            this.header.setAttribute('role', 'group');
            this.header.setAttribute('aria-label', `Move ${this.heading.textContent || 'panel'} panel`);
        }
        if (desktopMovable) this.header.setAttribute('aria-description', 'Use arrow keys, or press Shift F10 for position controls.');
        else this.header.removeAttribute?.('aria-description');
    }

    private floatingGeometry(): { host: DOMRect; panel: DOMRect; minLeft: number; minTop: number; maxLeft: number; maxTop: number } | null {
        if (!this.el.isConnected || !this.floating || !this.isDesktop()) return null;
        const host = this.hostEl.getBoundingClientRect();
        if (!(host.width > 0 && host.height > 0)) return null;
        const view = this.el.ownerDocument.defaultView?.visualViewport;
        const visible = view && view.width > 0 && view.height > 0
            ? { left: Math.max(host.left, view.offsetLeft), top: Math.max(host.top, view.offsetTop),
                right: Math.min(host.right, view.offsetLeft + view.width), bottom: Math.min(host.bottom, view.offsetTop + view.height) }
            : { left: host.left, top: host.top, right: host.right, bottom: host.bottom };
        if (visible.right <= visible.left || visible.bottom <= visible.top) return null;
        const marginX = Math.min(4, (visible.right - visible.left) / 2);
        const marginY = Math.min(4, (visible.bottom - visible.top) / 2);
        this.el.style.setProperty('--vela-panel-float-max-width', `${Math.max(0, visible.right - visible.left - marginX * 2)}px`);
        this.el.style.setProperty('--vela-panel-float-max-height', `${Math.max(0, visible.bottom - visible.top - marginY * 2)}px`);
        const panel = this.el.getBoundingClientRect();
        const minLeft = visible.left - host.left + marginX;
        const minTop = visible.top - host.top + marginY;
        return { host, panel, minLeft, minTop,
            maxLeft: Math.max(minLeft, visible.right - host.left - panel.width - marginX),
            maxTop: Math.max(minTop, visible.bottom - host.top - this.header.getBoundingClientRect().height - marginY) };
    }

    /** Move within the visible host without storing temporary viewport clamps. */
    private revealFocusedTarget(target: Element | null): void {
        if (!target || !this.el.contains(target) || !this.floating || this.maximizedOn || !this.isDesktop()) return;
        const delta = focusViewportDelta(target);
        if (!delta.x && !delta.y) return;
        const host = this.hostEl.getBoundingClientRect();
        const panel = this.el.getBoundingClientRect();
        // Focus adjustments are temporary; only a user move updates the saved position.
        this.placeFloating(panel.left - host.left + delta.x, panel.top - host.top + delta.y, false);
    }

    private placeFloating(left: number, top: number, remember: boolean): void {
        const geometry = this.floatingGeometry();
        if (!geometry) return;
        const { host, minLeft, minTop, maxLeft, maxTop } = geometry;
        const x = Math.min(Math.max(left, minLeft), maxLeft);
        const y = Math.min(Math.max(top, minTop), maxTop);
        this.el.style.setProperty('--vela-panel-float-left', `${Math.round(x)}px`);
        this.el.style.setProperty('--vela-panel-float-top', `${Math.round(y)}px`);
        if (remember) {
            this.floatPosition = {
                x: Math.round(Math.min(1, Math.max(0, x / host.width)) * 10000) / 10000,
                y: Math.round(Math.min(1, Math.max(0, y / host.height)) * 10000) / 10000,
            };
        }
    }

    /** Size bounds for the top-right control. The bottom-left stays in place while the
     *  right and top edges move; the header remains in the visible host/viewport. */
    private floatingSizeGeometry(anchor?: { left: number; bottom: number }): {
        width: number; height: number; minWidth: number; maxWidth: number; minHeight: number; maxHeight: number;
        left: number; bottom: number; hostHeight: number;
    } | null {
        const g = this.floatingGeometry();
        if (!g) return null;
        const left = anchor?.left ?? g.panel.left - g.host.left;
        const bottom = anchor?.bottom ?? g.panel.bottom - g.host.top;
        const availableRight = g.maxLeft + g.panel.width;
        const maxWidth = Math.max(1, Math.min(this.widthGeometry().max, availableRight - left));
        const declaredMin = this.resizable ? this.minWidth : MIN_FLOAT_PANEL_WIDTH;
        const minWidth = Math.min(maxWidth, declaredMin);
        const maxHeight = Math.max(1, Math.min(g.host.height, bottom - g.minTop));
        const headerHeight = this.header.getBoundingClientRect().height;
        const minHeight = Math.min(maxHeight, Math.max(112, headerHeight + 48, bottom - g.maxTop));
        return { width: g.panel.width, height: g.panel.height, minWidth, maxWidth, minHeight, maxHeight,
            left, bottom, hostHeight: g.host.height };
    }

    private notifyFloatingResize(): void {
        const position = this.floatPosition ? { ...this.floatPosition } : null;
        if (this.onFloatingResize) this.onFloatingResize(this.widthPx, this.desktopHeightPct, position);
        else {
            this.onWidthChange?.(this.widthPx);
            if (this.desktopHeightPct !== null) this.onDesktopHeightChange?.(this.desktopHeightPct);
            if (position) this.onFloatingPositionChange?.(position);
        }
    }

    /** Apply one or both dimensions without changing the opposite corner. */
    private resizeFloatingTo(width: number, height: number, commit: boolean, anchor?: { left: number; bottom: number }): boolean {
        const g = this.floatingSizeGeometry(anchor);
        if (!g) return false;
        const nextWidth = Math.min(Math.max(width, g.minWidth), g.maxWidth);
        const nextHeight = Math.min(Math.max(height, g.minHeight), g.maxHeight);
        const widthChanged = Math.abs(nextWidth - g.width) > 0.5;
        const heightChanged = Math.abs(nextHeight - g.height) > 0.5;
        if (!widthChanged && !heightChanged) return false;
        if (widthChanged) this.setWidth(nextWidth);
        if (heightChanged) this.setDesktopHeight(nextHeight / g.hostHeight);
        const rendered = this.el.getBoundingClientRect();
        this.placeFloating(g.left, g.bottom - rendered.height, true);
        if (commit) this.notifyFloatingResize();
        return true;
    }

    /** Drag the actual button, not an added perimeter handle. Arrow keys resize too. */
    private mountCornerResize(): void {
        const button = this.cornerResize;
        const win = this.el.ownerDocument.defaultView;
        button.setAttribute('aria-description', 'Drag to resize; use arrow keys to adjust size.');
        type Drag = { id: number; x: number; y: number; width: number; height: number; left: number; bottom: number; top: number;
            widthPx: number; heightPct: number | null; position: FloatingPanelPosition | null; moved: boolean; changed: boolean };
        let drag: Drag | null = null;
        let suppressClick = false;
        const suppressCompatibilityClick = (): void => {
            suppressClick = true;
            win?.setTimeout(() => { suppressClick = false; }, 0);
        };
        const restore = (started: Drag): void => {
            this.setWidth(started.widthPx);
            this.setDesktopHeight(started.heightPct);
            this.floatPosition = started.position ? { ...started.position } : null;
            this.el.style.setProperty('--vela-panel-float-left', `${Math.round(started.left)}px`);
            this.el.style.setProperty('--vela-panel-float-top', `${Math.round(started.top)}px`);
        };
        const cancel = (): void => {
            if (!drag) return;
            const started = drag;
            drag = null;
            delete button.dataset.dragging;
            restore(started);
            try { button.releasePointerCapture(started.id); } catch { /* capture already lost */ }
            suppressCompatibilityClick();
        };
        this.cancelCornerDrag = cancel;
        button.addEventListener('pointerdown', (event: PointerEvent) => {
            if (!this.isDesktop() || !this.floating || this.maximizedOn || drag || event.isPrimary === false
                || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const g = this.floatingSizeGeometry();
            const host = this.hostEl.getBoundingClientRect();
            const panel = this.el.getBoundingClientRect();
            if (!g) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: g.width, height: g.height,
                left: g.left, bottom: g.bottom, top: panel.top - host.top, widthPx: this.widthPx,
                heightPct: this.desktopHeightPct, position: this.floatingPosition, moved: false, changed: false };
            try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
        });
        button.addEventListener('pointermove', (event: PointerEvent) => {
            if (!drag || drag.id !== event.pointerId || !this.isDesktop() || !this.floating) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            if (!drag.moved) { this.closePositionControl(); button.dataset.dragging = '1'; }
            drag.moved = true;
            drag.changed = this.resizeFloatingTo(drag.width + dx, drag.height - dy, false, drag) || drag.changed;
            event.preventDefault();
        });
        button.addEventListener('pointerup', (event: PointerEvent) => {
            if (!drag || drag.id !== event.pointerId) return;
            const finished = drag;
            drag = null;
            delete button.dataset.dragging;
            try { button.releasePointerCapture(event.pointerId); } catch { /* capture already lost */ }
            if (finished.moved) {
                suppressCompatibilityClick();
                if (finished.changed) {
                    const panel = this.el.getBoundingClientRect();
                    const host = this.hostEl.getBoundingClientRect();
                    if (Math.abs(panel.width - finished.width) < 1 && Math.abs(panel.height - finished.height) < 1
                        && Math.abs(panel.left - host.left - finished.left) < 1 && Math.abs(panel.top - host.top - finished.top) < 1) {
                        // Dragging away and back is not an edit or a new history step.
                        restore(finished);
                    } else this.notifyFloatingResize();
                }
            }
        });
        button.addEventListener('pointercancel', (event: PointerEvent) => { if (drag?.id === event.pointerId) cancel(); });
        button.addEventListener('lostpointercapture', (event: PointerEvent) => { if (drag?.id === event.pointerId) cancel(); });
        button.addEventListener('click', (event: MouseEvent) => {
            if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
        });
        button.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape' && drag) { cancel(); event.preventDefault(); event.stopPropagation(); return; }
            if (!this.isDesktop() || !this.floating || this.maximizedOn) return;
            const g = this.floatingSizeGeometry();
            if (!g) return;
            const step = event.shiftKey ? 48 : 16;
            const width = event.key === 'ArrowRight' ? g.width + step : event.key === 'ArrowLeft' ? g.width - step : g.width;
            const height = event.key === 'ArrowUp' ? g.height + step : event.key === 'ArrowDown' ? g.height - step : g.height;
            if (width === g.width && height === g.height) return;
            this.resizeFloatingTo(width, height, true);
            event.preventDefault();
        });
    }

    private closePositionControl(): void {
        this.positionCleanup?.();
        this.positionCleanup = null;
        if (this.positionControl) {
            // Notify shared tooltip/surface managers before removing their trigger nodes.
            announceSurface(this.positionControl, false, 'popover', this.positionAnchor);
            this.positionControl.remove();
            this.positionControl = null;
        }
        this.positionAnchor = null;
    }

    /** Non-drag position alternatives, kept inside the existing panel. */
    private openPositionControl(focus = false): void {
        if (this.positionControl) { this.closePositionControl(); return; }
        if (!this.isDesktop() || !this.floatingGeometry() || this.maximizedOn) return;
        const anchor = this.header;
        const doc = this.el.ownerDocument;
        const win = doc.defaultView;
        const card = doc.createElement('div');
        card.className = 'vela-panel-position-control';
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', 'Panel position controls');
        const head = doc.createElement('div');
        head.className = 'vela-panel-position-head';
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'vela-panel-position-close';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Close position controls');
        close.addEventListener('click', () => {
            this.closePositionControl();
            anchor.focus();
        });
        head.appendChild(close);
        card.appendChild(head);
        type Axis = 'left' | 'top';
        const axes: Array<{ axis: Axis; label: string }> = [{ axis: 'left', label: 'Left' }, { axis: 'top', label: 'Top' }];
        const inputs = new Map<Axis, { range: HTMLInputElement; number: HTMLInputElement }>();
        for (const { axis, label } of axes) {
            const row = doc.createElement('div');
            row.className = 'vela-panel-position-row';
            const text = doc.createElement('span');
            text.textContent = label;
            const range = doc.createElement('input');
            range.type = 'range';
            const name = `Panel ${axis} position`;
            range.setAttribute('aria-label', name);
            const number = doc.createElement('input');
            number.type = 'number';
            number.inputMode = 'numeric';
            number.setAttribute('aria-label', `${name} in pixels`);
            inputs.set(axis, { range, number });
            row.append(text, range, number);
            card.appendChild(row);
        }
        this.el.appendChild(card);
        this.positionControl = card;
        this.positionAnchor = anchor;
        const refresh = (): void => {
            if (!this.positionControl) return;
            const panel = this.el.getBoundingClientRect();
            const g = this.floatingGeometry();
            const values: Partial<Record<Axis, { value: number; min: number; max: number }>> = {};
            if (g) {
                values.left = { value: g.panel.left - g.host.left, min: g.minLeft, max: g.maxLeft };
                values.top = { value: g.panel.top - g.host.top, min: g.minTop, max: g.maxTop };
            }
            for (const { axis } of axes) {
                const item = inputs.get(axis)!;
                const value = values[axis];
                if (!value) continue;
                const min = Math.ceil(value.min);
                const max = Number.isFinite(value.max) ? Math.max(min, Math.floor(value.max)) : Math.max(1000, Math.ceil(value.value * 2));
                for (const input of [item.range, item.number]) {
                    input.min = String(min); input.max = String(max); input.step = '1';
                    input.value = String(Math.round(Math.min(max, Math.max(min, value.value))));
                }
            }
            const headerBottom = this.header.getBoundingClientRect().bottom - panel.top;
            card.style.top = `${Math.max(2, Math.min(headerBottom + 2, panel.height - card.offsetHeight - 2))}px`;
        };
        const apply = (axis: Axis, input: HTMLInputElement): void => {
            const value = input.valueAsNumber;
            if (!Number.isFinite(value)) return;
            const g = this.floatingGeometry();
            if (!g) return;
            const left = axis === 'left' ? value : g.panel.left - g.host.left;
            const top = axis === 'top' ? value : g.panel.top - g.host.top;
            const nextLeft = Math.round(Math.min(Math.max(left, g.minLeft), g.maxLeft));
            const nextTop = Math.round(Math.min(Math.max(top, g.minTop), g.maxTop));
            if (nextLeft !== Math.round(g.panel.left - g.host.left) || nextTop !== Math.round(g.panel.top - g.host.top)) {
                this.placeFloating(left, top, true);
                if (this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
            }
            refresh();
        };
        for (const { axis } of axes) {
            const item = inputs.get(axis)!;
            // Commit on release so moving the surface never steals a track click. WebKit can
            // emit input but no change for a touch-track tap; settle that value on pointerup.
            let touchPending = false;
            let touchChanged = false;
            item.range.addEventListener('pointerdown', (event: PointerEvent) => {
                if (event.pointerType === 'touch') { touchPending = true; touchChanged = false; }
            });
            item.range.addEventListener('input', () => { if (touchPending) touchChanged = true; });
            item.range.addEventListener('pointerup', (event: PointerEvent) => {
                if (event.pointerType !== 'touch' || !touchPending) return;
                touchPending = false;
                if (touchChanged) apply(axis, item.range);
            });
            item.range.addEventListener('pointercancel', () => { touchPending = false; refresh(); });
            item.range.addEventListener('change', () => apply(axis, item.range));
            item.number.addEventListener('change', () => apply(axis, item.number));
        }
        const onOutside = (event: PointerEvent): void => {
            if (!card.contains(event.target as Node)) this.closePositionControl();
        };
        card.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            this.closePositionControl();
            anchor.focus();
        });
        doc.addEventListener('pointerdown', onOutside, true);
        win?.addEventListener('resize', refresh);
        win?.visualViewport?.addEventListener('resize', refresh);
        this.positionCleanup = () => {
            doc.removeEventListener('pointerdown', onOutside, true);
            win?.removeEventListener('resize', refresh);
            win?.visualViewport?.removeEventListener('resize', refresh);
        };
        refresh();
        announceSurface(card, true, 'popover', anchor);
        if (focus) inputs.get('left')?.range.focus();
    }

    /** Whether the panel floats over the chart right now (false for every docked panel). */
    get overlay(): boolean {
        return this.overlayOn;
    }

    /** Float or dock the panel. Only a panel declared `overlay` can float — on any other this is
     *  a no-op. Silent — {@link onPlacementChange} reports the user's pin clicks only. */
    setOverlay(overlay: boolean): void {
        if (!this.floatable || overlay === this.overlayOn) return;
        // Explicit pin/unpin takes precedence over a temporary free-drag position.
        if (this.floating) this.setFloating(false);
        this.overlayOn = overlay;
        if (overlay) this.el.dataset.overlay = '1';
        else delete this.el.dataset.overlay;
        this.refreshPin();
    }

    private refreshPin(): void {
        if (!this.pin) return;
        const pinned = !this.overlayOn;
        const doc = this.pin.ownerDocument;
        this.pin.replaceChildren(iconEl(pinned ? 'pin-filled' : 'pin', doc));
        this.pin.dataset.on = pinned ? '1' : '0';
        this.pin.title = pinned ? 'Unpin — float over the chart' : 'Pin beside the chart';
        this.pin.setAttribute('aria-label', this.pin.title);
        this.pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }

    destroy(): void {
        this.cancelCornerDrag?.();
        this.cancelCornerDrag = null;
        this.closePositionControl();
        this.sizeObserver?.disconnect();
        this.sizeObserver = null;
        this.updateResizeGrip = null;
        this.updateWidthGrip = null;
        this.widthGrip = null;
        this.viewportCleanup?.();
        this.viewportCleanup = null;
        this.dockTip?.destroy();
        this.dockTip = null;
        if (this.open) announceSurface(this.el, false, 'panel');
        this.exit?.finish();
        this.el.remove();
    }

    /** The inner seam resizes by drag or keyboard; double-click resets its width. */
    private mountResizer(doc: Document): void {
        const handle = doc.createElement('div');
        this.widthGrip = handle;
        handle.className = 'vela-panel-resizer';
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `Resize ${this.heading.textContent || 'panel'} panel width`);
        handle.setAttribute('aria-description', 'Use left and right arrow keys to resize.');
        handle.title = 'Drag to resize · use arrow keys';
        linkPanelResizeGrip(handle, this.el);
        const updateGrip = (): void => {
            const { value, min, max } = this.widthGeometry();
            const lower = Math.ceil(min);
            const upper = Number.isFinite(max) ? Math.max(lower, Math.floor(max)) : Math.max(1000, Math.ceil(value * 2));
            handle.setAttribute('aria-valuemin', String(lower));
            handle.setAttribute('aria-valuemax', String(upper));
            handle.setAttribute('aria-valuenow', String(Math.round(Math.min(upper, Math.max(lower, value)))));
            handle.setAttribute('aria-valuetext', `${Math.round(value)} pixels wide`);
        };
        this.updateWidthGrip = updateGrip;
        updateGrip();
        let startX = 0;
        let startWidth = 0;
        let startRight = 0;
        let startTop = 0;
        let pointerId: number | null = null;

        const end = (e: PointerEvent): void => {
            if (pointerId !== e.pointerId) return;
            pointerId = null;
            delete handle.dataset.dragging;
            try { handle.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
            if (this.widthPx !== startWidth) {
                this.onWidthChange?.(this.widthPx);
                if (this.floating && this.floatPosition) this.onFloatingPositionChange?.({ ...this.floatPosition });
            }
        };
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0 || e.isPrimary === false || pointerId !== null) return;
            pointerId = e.pointerId;
            startX = e.clientX;
            startWidth = this.widthPx;
            if (this.floating && this.isDesktop()) {
                const host = this.hostEl.getBoundingClientRect();
                const panel = this.el.getBoundingClientRect();
                startRight = panel.right - host.left;
                startTop = panel.top - host.top;
            }
            handle.dataset.dragging = '1';
            try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
            e.preventDefault(); // no text selection, and no drag starting on the chart underneath
        });
        handle.addEventListener('pointermove', (e: PointerEvent) => {
            if (pointerId !== e.pointerId) return;
            this.setWidth(startWidth + (startX - e.clientX));
            if (this.floating && this.isDesktop()) {
                this.placeFloating(startRight - this.el.getBoundingClientRect().width, startTop, true);
            }
            e.preventDefault();
        });
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        handle.addEventListener('lostpointercapture', end);
        handle.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.isDesktop()) return;
            const { value, min, max } = this.widthGeometry();
            const step = e.shiftKey ? 48 : 16;
            const next = e.key === 'ArrowLeft' ? value + step : e.key === 'ArrowRight' ? value - step
                : e.key === 'Home' ? min : e.key === 'End' ? max : null;
            if (next === null || !Number.isFinite(next)) return;
            this.resizeWidth(Math.min(Math.max(next, min), max), true);
            e.preventDefault();
        });
        handle.addEventListener('dblclick', () => {
            this.closePositionControl();
            this.resizeWidth(this.declaredWidth, true);
        });
        this.el.appendChild(handle);
    }
}
