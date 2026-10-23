// ONE SCROLL FEEL for every scrolling surface in the kit (round 23).
//
// The app grew a dozen scroll containers — menus, the layout picker, both drawers, the
// indicator picker, the drawing palette, the docked panel bodies, the settings panes. Each
// one had its own scrollbar recipe (some none at all), so the same wheel gesture felt
// different depending on where the pointer was: chained into the page, snapped to items in
// one list and glided in another.
//
// This sheet is the single source of that feel:
//   * `overscroll-behavior: contain` — a list past its end never scrolls the page behind it
//     (the single most visible "cheap" tell on a scrolling UI);
//   * `-webkit-overflow-scrolling: touch` — momentum on iOS, where the default is a hard
//     stop at the finger;
//   * a thin, thumb-only, transparent-track scrollbar (the reference's own look) applied to
//     the same class list, so no surface is left with a 15 px OS gutter;
//   * `scroll-padding-block` — a keyboard-focused row lands 6 px inside the edge instead of
//     flush against it.
//
// `scroll-behavior: smooth` is deliberately NOT global: a menu driven by arrow keys must
// jump (an animated list lags behind repeated presses). It is applied to the SURFACES that
// are paged by pointer only — the drawers, the pickers and the panel bodies.
import { injectStyles } from './styles';

export const SCROLL_STYLE_ID = 'vela-ui-scrolling';

/** Surfaces that animate a programmatic / paged scroll. */
const SMOOTH = [
    '.vela-drawer-body',
    '.vela-panel-body',
    '.vela-lp',
    '.vela-ip-list',
    '.vela-cp-list',
    '.vela-marks-panel',
    '.vela-dsp-scroll',
    '.vela-dialog-body',
];

/** Surfaces that must keep native (instant) keyboard scrolling but share the rest. */
const INSTANT = ['.vela-menu', '.vela-lp-presets', '.vela-dtb-flyout'];

const ALL = [...SMOOTH, ...INSTANT];

export const SMOOTH_SCROLL_CSS = `
${SMOOTH.join(',\n')} {
    scroll-behavior: smooth;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    scroll-padding-block: 6px;
}
${INSTANT.join(',\n')} {
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    scroll-padding-block: 6px;
}
${ALL.join(',\n')} {
    scrollbar-width: thin;
    scrollbar-color: var(--vela-scroll) transparent;
}
${ALL.map((s) => `${s}::-webkit-scrollbar{width:8px;height:8px;}`).join('\n')}
${ALL.map((s) => `${s}::-webkit-scrollbar-track,${s}::-webkit-scrollbar-corner{background:transparent;}`).join('\n')}
${ALL.map((s) => `${s}::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}`).join('\n')}
${ALL.map((s) => `${s}::-webkit-scrollbar-thumb:hover{background:var(--vela-fg-faint);}`).join('\n')}
${ALL.map((s) => `${s}::-webkit-scrollbar-button{display:none;width:0;height:0;}`).join('\n')}
/* A user who asked the OS for less motion gets none of it — the lists still scroll. */
@media (prefers-reduced-motion: reduce) {
    ${SMOOTH.join(',\n')} { scroll-behavior: auto; }
}
`;

/** Inject once per document (idempotent — safe to call from every entry point). */
export function installSmoothScrolling(doc: Document = document): void {
    injectStyles(SCROLL_STYLE_ID, SMOOTH_SCROLL_CSS, doc);
}
