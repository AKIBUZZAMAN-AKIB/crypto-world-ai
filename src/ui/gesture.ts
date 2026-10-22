// Pointer gestures — the numbers every platform agrees on, in one place.
//
// The library has two gestures that can collide on a phone: a LONG PRESS (open the group
// palette on a sync cell) and a DRAG (trade two chart slots). Per the platform baselines
// this is resolved with a time + distance split rather than two competing handlers:
//
//   • iOS `UILongPressGestureRecognizer`: 0.5 s minimum press, 10 pt allowable movement.
//   • Android `ViewConfiguration`: 500 ms long-press, 8 dp touch slop.
//   • Material: a drag only starts once the pointer leaves the slop, so a finger that
//     rests and drifts a few pixels is still a press, not a drag.
//
// Hence: LONG_PRESS_MS = 500, TOUCH_SLOP = 10 px (pen and touch), 4 px for a mouse. A
// press that passes the slop is CANCELED (the browser may scroll), and a press that fires
// swallows the click that follows so the tap does not also cycle the group. That single
// rule is what keeps long-press and drag-swap from firing together.

/** Platform long-press threshold (iOS 0.5 s / Android 500 ms). */
export const LONG_PRESS_MS = 500;

/** Movement that turns a press into a drag — Android 8 dp ≈ 8 px, iOS 10 pt. */
export const TOUCH_SLOP_PX = 10;

/** Mouse pointers are far more precise; a 4 px jitter is not a drag. */
export const MOUSE_SLOP_PX = 4;

/** The slop for a pointer type. */
export function slopFor(pointerType: string): number {
    return pointerType === 'mouse' ? MOUSE_SLOP_PX : TOUCH_SLOP_PX;
}

export interface LongPressOptions {
    /** Fired once the press has been held for `ms` without passing the slop. */
    onFire: (down: PointerEvent) => void;
    /** Default {@link LONG_PRESS_MS}. */
    ms?: number;
    /** Default {@link slopFor}; a fixed number overrides both pointer types. */
    slop?: number;
    /** Restrict to touch-like pointers (default true — a mouse uses the context menu). */
    touchOnly?: boolean;
}

/**
 * Arm a long press on an element. Returns a disposer. The handler is passive: it never
 * calls `preventDefault`, so scrolling and the browser's own gestures still work — a
 * finger that moves past the slop simply cancels the timer.
 */
export function attachLongPress(el: HTMLElement, opts: LongPressOptions): () => void {
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    if (!view) return () => {};
    let timer: number | null = null;
    let down: PointerEvent | null = null;
    let fired = false;

    const clear = (): void => {
        if (timer != null) view.clearTimeout(timer);
        timer = null;
    };

    const onDown = (e: PointerEvent): void => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (opts.touchOnly !== false && e.pointerType === 'mouse') return;
        clear();
        fired = false;
        down = e;
        const { clientX, clientY } = e;
        const slop = opts.slop ?? slopFor(e.pointerType);
        timer = view.setTimeout(() => {
            timer = null;
            if (!down || !el.isConnected) return;
            fired = true;
            // The tap that ends the press must not ALSO cycle the group: swallow the
            // single click that follows. Capture phase, one shot, same target only.
            const swallow = (ce: MouseEvent): void => {
                ce.preventDefault();
                ce.stopPropagation();
            };
            el.addEventListener('click', swallow, { capture: true, once: true });
            view.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 700);
            el.dataset.longPressed = '1';
            view.setTimeout(() => delete el.dataset.longPressed, 700);
            opts.onFire({ ...down, clientX, clientY } as PointerEvent);
        }, opts.ms ?? LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent): void => {
        if (timer == null || !down) return;
        const slop = opts.slop ?? slopFor(e.pointerType);
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > slop) clear();
    };

    const onUp = (): void => {
        if (fired) {
            fired = false;
            return;
        }
        clear();
        down = null;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
        clear();
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
    };
}

/**
 * The reading direction of an element (or of the document when nothing declares one).
 * `dir` is inherited, so the nearest attribute wins; the computed style then covers a
 * `direction: rtl` stylesheet on an ancestor.
 */
export function isRtl(el: Element | null): boolean {
    if (!el) return false;
    const declared = el.closest('[dir]')?.getAttribute('dir');
    if (declared) return declared.toLowerCase() === 'rtl';
    const view = el.ownerDocument?.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
        try {
            return view.getComputedStyle(el).direction === 'rtl';
        } catch {
            /* detached node */
        }
    }
    const html = el.ownerDocument?.documentElement?.getAttribute('dir');
    return html?.toLowerCase() === 'rtl';
}
