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

// Horizontal tab strips are created lazily by many different panels. One delegated
// recognizer makes mouse-wheel/drag work for all of them; touch keeps native pan-x.
const HORIZONTAL_TABS = [
    '.vela-tm-tabs', '.vela-ip-tabs', '.vela-sp-tabs', '.vela-dd-tabs', '.vela-st-tabs', '.vela-ap-tabs', '.vela-dw-tabs',
    '.vela-sd-itabs', '.vela-sd-mobile .vela-sd-toc', '.vela-ot-mo-segment', '.vela-md-seg',
    '.vela-panel-header-slot',
].join(',');
const wiredDocuments = new WeakSet<Document>();

/** Keep focused children visible in a compact horizontal strip. Wheel users can
 *  scroll it too; at an edge the gesture is released to the parent scroller. */
export function enableCompactHorizontalStrip(strip: HTMLElement): void {
    strip.addEventListener('focusin', (event) => {
        const item = event.target;
        if (!(item instanceof HTMLElement) || item === strip) return;
        // Wait for a pointer click to finish before shifting the target under it.
        setTimeout(() => {
            if (!item.isConnected || item.ownerDocument.activeElement !== item) return;
            const r = item.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
            if (r.left < bounds.left + 2) strip.scrollLeft -= bounds.left + 2 - r.left;
            else if (r.right > bounds.right - 2) strip.scrollLeft += r.right - bounds.right + 2;
        }, 0);
    });
    strip.addEventListener('wheel', (event) => {
        if (event.defaultPrevented || event.ctrlKey || strip.scrollWidth <= strip.clientWidth + 1) return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const before = strip.scrollLeft;
        strip.scrollLeft += delta;
        if (strip.scrollLeft !== before) event.preventDefault();
    }, { passive: false });
}

/** Inject once per document (idempotent — safe to call from every entry point). */
export function installSmoothScrolling(doc: Document = document): void {
    injectStyles(SCROLL_STYLE_ID, SMOOTH_SCROLL_CSS, doc);
    if (wiredDocuments.has(doc)) return;
    wiredDocuments.add(doc);
    const stripOf = (target: EventTarget | null): HTMLElement | null =>
        target instanceof Element ? target.closest<HTMLElement>(HORIZONTAL_TABS) : null;
    doc.addEventListener('wheel', (e: WheelEvent) => {
        if (e.defaultPrevented || e.ctrlKey) return;
        const strip = stripOf(e.target);
        if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const before = strip.scrollLeft;
        strip.scrollLeft += delta;
        // At the edge, release the wheel to the panel's vertical scroller.
        if (strip.scrollLeft !== before) e.preventDefault();
    }, { passive: false });

    let drag: { strip: HTMLElement; id: number; x: number; start: number; moved: boolean } | null = null;
    doc.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.pointerType === 'touch' || e.button !== 0 || e.isPrimary === false) return;
        const strip = stripOf(e.target);
        if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
        drag = { strip, id: e.pointerId, x: e.clientX, start: strip.scrollLeft, moved: false };
    });
    doc.addEventListener('pointermove', (e: PointerEvent) => {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 5) return;
        if (!drag.moved) {
            drag.moved = true;
            try { drag.strip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        }
        drag.strip.scrollLeft = drag.start - dx;
        e.preventDefault();
    });
    const end = (e: PointerEvent): void => {
        if (!drag || drag.id !== e.pointerId) return;
        const finished = drag;
        drag = null;
        try { finished.strip.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
        if (!finished.moved) return;
        // A drag must not also select the tab under the release point.
        const swallow = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); };
        const cleanup = (): void => { doc.removeEventListener('click', swallow, true); };
        doc.addEventListener('click', swallow, true);
        doc.defaultView?.setTimeout(cleanup, 0);
    };
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
}
