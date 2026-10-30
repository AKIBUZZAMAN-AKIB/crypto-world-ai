// Layout mode — the shell's size class. The widget is embeddable, so the honest
// signal is the CONTAINER width, not the viewport: a 380px widget on a desktop page
// gets the mobile chrome, a full-screen tablet widget keeps the desktop one unless
// the pointer is coarse and the container is narrow enough that desktop affordances
// (hover flyouts, 30px targets) stop working.
import type { Unsubscribe } from '../core/util/types';

export type LayoutMode = 'mobile' | 'desktop';
export type LayoutModeOption = 'auto' | LayoutMode;

/** Below this container width the shell is unconditionally mobile. */
export const MOBILE_BREAKPOINT_PX = 640;
/** With a coarse pointer (touch-first device) the mobile chrome applies wider —
 *  desktop affordances assume hover, which a coarse pointer does not have. */
export const COARSE_BREAKPOINT_PX = 920;

/**
 * Resolve the effective layout mode. Pure — the controller feeds it measurements.
 * An unmeasured container (width 0: display:none, not yet attached) stays desktop
 * until a real measurement arrives, so nothing flashes mobile during construction.
 *
 * On a touch-first device a wider-than-tall workspace uses desktop chrome: this gives
 * the chart the requested top toolbar after rotation, instead of spending its short
 * height on the phone's bottom bar. The workspace bounds, not a user-agent string,
 * decide orientation, so embedded workspaces use their actual available space too.
 *
 * `height` is only a signal for orientation; width/breaks still decide the chrome.
 * A fine pointer keeps the width rules unchanged (a short desktop window is still
 * desktop). An explicit option always wins.
 */
export function resolveLayoutMode(option: LayoutModeOption, width: number, coarsePointer: boolean, height = 0): LayoutMode {
    if (option !== 'auto') return option;
    if (width <= 0) return 'desktop';
    // Rotated touch device → desktop chrome. Gate on a REAL height so an unmeasured
    // box can't accidentally flip. Portrait (height > width) keeps the phone chrome.
    if (coarsePointer && height > 0 && width > height) return 'desktop';
    if (width < MOBILE_BREAKPOINT_PX) return 'mobile';
    if (coarsePointer && width < COARSE_BREAKPOINT_PX) return 'mobile';
    return 'desktop';
}

/**
 * Observes one element and keeps its `data-layout` attribute (`'mobile'`/`'desktop'`)
 * in sync with the resolved mode — chrome stylesheets key off it. Change listeners
 * fire only on actual transitions, after the attribute is already updated.
 */
export class LayoutModeController {
    private mode: LayoutMode;
    private readonly listeners = new Set<(mode: LayoutMode) => void>();
    private ro: ResizeObserver | null = null;
    private mql: MediaQueryList | null = null;
    private readonly onMediaChange = (): void => this.evaluate();
    private readonly onViewportChange = (): void => this.evaluate();

    constructor(
        private readonly el: HTMLElement,
        private readonly option: LayoutModeOption = 'auto',
    ) {
        const win = el.ownerDocument.defaultView;
        if (win && typeof win.matchMedia === 'function') {
            this.mql = win.matchMedia('(pointer: coarse)');
            // Older WebViews only ship addListener.
            if (typeof this.mql.addEventListener === 'function') this.mql.addEventListener('change', this.onMediaChange);
            else this.mql.addListener?.(this.onMediaChange);
        }
        const bounds = el.getBoundingClientRect();
        this.mode = resolveLayoutMode(option, bounds.width, this.mql?.matches ?? false, bounds.height);
        el.dataset.layout = this.mode;
        if (option === 'auto' && win) {
            // ResizeObserver catches embedded-container changes; viewport/orientation
            // events also cover older WebViews without ResizeObserver.
            win.addEventListener('resize', this.onViewportChange);
            win.addEventListener('orientationchange', this.onViewportChange);
            if (typeof win.ResizeObserver === 'function') {
                this.ro = new win.ResizeObserver(() => this.evaluate());
                this.ro.observe(el);
            }
        }
    }

    get current(): LayoutMode {
        return this.mode;
    }

    /** Subscribe to mode transitions (fires with the NEW mode). */
    onChange(cb: (mode: LayoutMode) => void): Unsubscribe {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    destroy(): void {
        this.ro?.disconnect();
        this.ro = null;
        if (this.mql && typeof this.mql.removeEventListener === 'function') this.mql.removeEventListener('change', this.onMediaChange);
        else this.mql?.removeListener?.(this.onMediaChange);
        this.mql = null;
        const win = this.el.ownerDocument.defaultView;
        win?.removeEventListener('resize', this.onViewportChange);
        win?.removeEventListener('orientationchange', this.onViewportChange);
        this.listeners.clear();
    }

    private evaluate(): void {
        const bounds = this.el.getBoundingClientRect();
        const next = resolveLayoutMode(this.option, bounds.width, this.mql?.matches ?? false, bounds.height);
        if (next === this.mode) return;
        this.mode = next;
        this.el.dataset.layout = next;
        for (const cb of [...this.listeners]) cb(next);
    }
}
