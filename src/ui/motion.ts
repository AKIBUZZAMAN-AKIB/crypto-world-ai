// Reduced motion — ONE preference, honored everywhere.
//
// The system setting (`prefers-reduced-motion: reduce`) is the platform's answer to
// WCAG 2.3.3 "Animation from Interactions" (AAA) and the W3C technique C39: motion that
// starts from an interaction must be suppressible unless it is essential. Two kinds of
// motion exist in this library and both are covered here:
//
//   1. CSS chrome (popovers, sheets, chips, toasts). One `@media` block neutralizes
//      every transition/animation under our roots. Durations become 0.01ms rather than
//      0 so `transitionend`/`animationend` still fire (code that waits for them keeps
//      working — the standard advice, and why a blanket `none` is not used).
//   2. Canvas motion (zoom/pan easing, autoscale glide, live-bar glide). A chart cannot
//      be fixed by CSS, so the renderer asks `prefersReducedMotion()` when it builds its
//      ease settings, and the keyboard glide snaps instead of following.
//
// The preference is read at CALL time (not cached at module load) so a user who flips
// the OS switch mid-session is respected on the next interaction, and `watchReducedMotion`
// lets a long-lived surface react immediately.

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the user asked the platform for reduced motion. Safe outside a DOM. */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia(REDUCED_MOTION_QUERY).matches;
    } catch {
        return false;
    }
}

/** Subscribe to preference changes. Returns an unsubscribe function (no-op without DOM). */
export function watchReducedMotion(cb: (reduced: boolean) => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    let mq: MediaQueryList;
    try {
        mq = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
        return () => {};
    }
    const fire = (e: MediaQueryList | MediaQueryListEvent): void => cb(e.matches);
    if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', fire);
        return () => mq.removeEventListener('change', fire);
    }
    // Legacy Safari (no EventTarget on MediaQueryList).
    const legacy = mq as MediaQueryList & {
        addListener?: (fn: (e: MediaQueryList) => void) => void;
        removeListener?: (fn: (e: MediaQueryList) => void) => void;
    };
    legacy.addListener?.(fire);
    return () => legacy.removeListener?.(fire);
}

/**
 * The CSS half. Scoped to the library's own roots so an embedding page keeps its own
 * motion. `animation-iteration-count: 1` stops infinite spins; `scroll-behavior: auto`
 * kills smooth scrolling. 0.01ms (not 0) preserves end events.
 */
export const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
    :where(.vela-workspace, .vela-widget) *,
    :where(.vela-workspace, .vela-widget) *::before,
    :where(.vela-workspace, .vela-widget) *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        transition-delay: 0ms !important;
        scroll-behavior: auto !important;
    }
}
`;

/** How long a CSS transition should take, given the preference (0.01ms when reduced). */
export function motionDuration(ms: number): number {
    return prefersReducedMotion() ? 0.01 : ms;
}
