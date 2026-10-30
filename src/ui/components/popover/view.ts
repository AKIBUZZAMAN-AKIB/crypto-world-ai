// Popover VIEW — a positioned floating shell. Content is caller-owned; this class
// owns portal, placement, capture-phase outside-dismiss, and the single-open registry.
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../styles';
import { ensureUIHost, floatingLayerHost } from '../../tokens';
import { announceSurface } from '../../surface-events';
import { holdForExit, type SurfaceExit } from '../../surface-exit';
import { makePanelDraggable, type PanelDrag } from '../../panel-drag';
import {
    insetRect,
    intersectRects,
    placePopover,
    popoverController,
    viewportRect,
    type PopoverAlign,
    type PopoverControllerOptions,
    type PopoverPosition,
    type Rect,
} from './controller';
import { POPOVER_CSS, POPOVER_STYLE_ID } from './styles';

export type PopoverBoundary = 'viewport' | HTMLElement | (() => DOMRect | null);

export interface PopoverOptions extends PopoverControllerOptions {
    trigger: HTMLElement;
    content?: Node | ((body: HTMLElement) => void);
    /** Portal target. Defaults to `document.body`. Drawing chrome passes the chart host. */
    host?: HTMLElement;
    theme?: VelaTheme;
    className?: string;
    zIndex?: string | number;
    /** Clamp rectangle. `'viewport'` (default) or an element (dialog / chart host). */
    boundary?: PopoverBoundary;
    /** Fade the shell in on show and out on hide over this many ms (default 0 — instant). */
    fadeMs?: number;
    /** Return focus to the trigger on Escape when focus was inside this popover. */
    restoreFocusOnEscape?: boolean;
    /** Constrain the surface to its visible viewport/boundary and scroll its content. */
    fitWithinBoundary?: boolean;
}

let open: Popover | null = null;
/** Closed popovers still playing their exit animation. */
const leaving = new Set<Popover>();

/** Close whichever kit popover is showing (dialog teardown, a second trigger). */
export function closeOpenPopovers(): void {
    open?.hide();
}

export function isPopoverOpen(): boolean {
    return open !== null;
}

export function openPopoverTrigger(): HTMLElement | null {
    return open?.trigger ?? null;
}

/** The currently open shell, for live control synchronization without retaining closed popovers. */
export function openPopoverElement(): HTMLElement | null {
    return open?.el ?? null;
}

/** Flag stamped on a pointer event whose only job was dismissing an open popover. */
const POPOVER_DISMISS_FLAG = '__velaPopoverDismiss';

function markPopoverDismiss(e: Event): void {
    (e as Event & { [POPOVER_DISMISS_FLAG]?: boolean })[POPOVER_DISMISS_FLAG] = true;
}

/**
 * True when this event already dismissed a popover on its way down — a dialog's
 * outside-click close must swallow it instead of closing the dialog too (the popover
 * hides itself on document CAPTURE, so by the time a backdrop listener runs,
 * {@link isPopoverOpen} is already false).
 */
export function eventDismissedPopover(e: Event): boolean {
    return (e as Event & { [POPOVER_DISMISS_FLAG]?: boolean })[POPOVER_DISMISS_FLAG] === true;
}

function toRect(r: DOMRect): Rect {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/** An inset viewport that stays valid even when a keyboard leaves only a few pixels. */
function visibleRect(left: number, top: number, width: number, height: number, inset: number): Rect {
    const w = Math.max(0, width), h = Math.max(0, height), gap = Math.max(0, inset);
    const x = Math.min(gap, w / 2), y = Math.min(gap, h / 2);
    return { left: left + x, top: top + y, right: left + w - x, bottom: top + h - y, width: w - x * 2, height: h - y * 2 };
}

export class Popover {
    readonly el: HTMLElement;
    readonly trigger: HTMLElement;
    private readonly host: HTMLElement;
    private readonly ctrl: ReturnType<typeof popoverController>;
    private readonly boundary: PopoverBoundary;
    private readonly theme?: VelaTheme;
    /** Hosted under a `.vela-ui` we resolved ourselves — its tokens win over `theme`. */
    private readonly inheritsTokens: boolean;
    private onOutside: ((e: Event) => void) | null = null;
    private onKey: ((e: KeyboardEvent) => void) | null = null;
    private onReflow: ((event?: Event) => void) | null = null;
    private onFitFocus: (() => void) | null = null;
    private onFitPointerDown: (() => void) | null = null;
    private onFitPointerEnd: (() => void) | null = null;
    private fitPointerActive = false;
    private focusRevealTimer: ReturnType<typeof setTimeout> | null = null;
    private shown = false;
    private drag: PanelDrag | null = null;
    private layoutRoot: HTMLElement | null = null;
    private readonly fadeMs: number;
    private readonly restoreFocusOnEscape: boolean;
    private readonly fitWithinBoundary: boolean;
    private sizeObserver: ResizeObserver | null = null;
    private fitFrame: number | null = null;
    private fitBoxDefaults: { padding: string; borderWidth: string } | null = null;
    /** The pending removal of a fading-out shell; a show() that reuses the shell cancels it. */
    private leaveTimer: ReturnType<typeof setTimeout> | null = null;
    /** The shell's exit animation before it leaves the DOM; a show() that reuses the shell cancels it. */
    private exit: SurfaceExit | null = null;

    constructor(opts: PopoverOptions) {
        const doc = opts.trigger.ownerDocument;
        injectStyles(POPOVER_STYLE_ID, POPOVER_CSS, doc);
        this.trigger = opts.trigger;
        // No explicit host: portal to the trigger's `.vela-ui` (app-theme tokens) rather
        // than <body>. Explicit hosts (drawing chrome, mark popups) keep their own tokens.
        this.host = opts.host ?? floatingLayerHost(opts.trigger, doc.body);
        this.inheritsTokens = !opts.host && this.host !== doc.body;
        this.ctrl = popoverController(opts);
        this.boundary = opts.boundary ?? 'viewport';
        this.theme = opts.theme;
        this.fadeMs = Math.max(0, opts.fadeMs ?? 0);
        this.restoreFocusOnEscape = opts.restoreFocusOnEscape === true;
        this.fitWithinBoundary = opts.fitWithinBoundary === true;

        this.el = doc.createElement('div');
        this.el.className = 'vela-popover vela-ui-layer' + (opts.className ? ` ${opts.className}` : '');
        this.el.dataset.position = this.ctrl.position;
        if (opts.zIndex !== undefined) this.el.style.zIndex = String(opts.zIndex);
        // Clicks inside must not bubble to a dialog's outside-dismiss.
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        if (opts.content instanceof Node) this.el.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.el);
    }

    get open(): boolean {
        return this.shown;
    }

    get position(): PopoverPosition {
        return this.ctrl.position;
    }

    get align(): PopoverAlign {
        return this.ctrl.align;
    }

    show(): void {
        if (this.shown) {
            this.place();
            return;
        }
        if (open && open !== this) open.hide();
        if (this.leaveTimer !== null) {
            clearTimeout(this.leaveTimer);
            this.leaveTimer = null;
        }
        this.exit?.cancel();
        this.exit = null;
        leaving.delete(this);
        // Owners that build a fresh popover per open (color pickers, select lists): the new
        // one takes the place of the one still leaving from the same trigger.
        for (const p of [...leaving]) if (p.trigger === this.trigger) p.exit?.finish();
        // A caller theme is often the live plot surface (settings dialogs pass
        // `this.theme`); stamping it on a `.vela-ui`-hosted shell would recolor the
        // list to layout.background.
        ensureUIHost(this.el, this.inheritsTokens ? undefined : this.theme);
        if (this.fadeMs > 0) {
            this.el.style.transition = `opacity ${this.fadeMs}ms ease`;
            this.el.style.opacity = '0';
            this.el.style.pointerEvents = '';
        }
        // A separate layout-containment layer prevents a dragged popover's overflow
        // from growing the page, even when the host creates a fixed containing block.
        // The surface is created inside it from the start; no live panel is remounted.
        const movable = !!this.el.querySelector('.vela-tm-head, .vela-lm-head');
        const containOverflow = movable && this.ctrl.position === 'fixed' && !!this.host.closest('[data-layout="desktop"]');
        if (containOverflow) {
            this.layoutRoot ??= this.el.ownerDocument.createElement('div');
            this.layoutRoot.className = 'vela-popover-layout-root';
            this.layoutRoot.style.zIndex = this.el.style.zIndex;
            this.layoutRoot.appendChild(this.el);
            this.host.appendChild(this.layoutRoot);
        } else {
            this.host.appendChild(this.el);
            this.layoutRoot?.remove();
        }
        this.shown = true;
        open = this;
        // Only panel-style popovers with a title bar are movable. Small select/color
        // popovers stay anchored to their input, and header controls remain clickable.
        if (movable) {
            this.drag = makePanelDraggable(this.el, {
                handle: '.vela-tm-head, .vela-lm-head', resizeHandle: '.vela-size-grip',
                revealFocus: () => !!this.host.closest('[data-layout="desktop"]'),
            });
        }
        this.place();
        // place() measured the shell (a style flush at opacity 0) — flipping it now runs the transition.
        if (this.fadeMs > 0) this.el.style.opacity = '1';
        const onOutside = (ev: Event): void => {
            const t = ev.target as Node;
            if (this.el.contains(t) || this.trigger.contains(t)) return;
            // Mark the event: it spent itself dismissing this popover, so listeners
            // further down the path (a dialog backdrop) must not ALSO dismiss on it.
            markPopoverDismiss(ev);
            this.hide();
        };
        // Window CAPTURE, not document: a dialog nested underneath listens for Escape on
        // `document` (the kit dialog machine does), and stopping the event at the document
        // in capture does not stop another listener registered on that same node. Claiming
        // it one node earlier — window is the first stop of every capture pass — makes the
        // top-most surface the only one Escape closes. Escape twice: the popover, then the
        // dialog, exactly like TradingView.
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            const returnFocus = this.restoreFocusOnEscape && this.el.contains(this.el.ownerDocument.activeElement);
            this.hide();
            if (returnFocus && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
        };
        const onReflow = (event?: Event): void => {
            // A resized card scrolls internally. That must not re-anchor the whole
            // panel while the user is reading it; outside scrolling can move its trigger.
            if (event?.type === 'scroll' && event.target instanceof Node && this.el.contains(event.target)) return;
            this.place();
        };
        // Capture phase, deferred so the opening click does not immediately dismiss — and only
        // if this show is still the live one: a hide (or hide + show) in the same tick cleared or
        // replaced the handler, and attaching it then would leave it behind for good.
        setTimeout(() => {
            if (this.onOutside === onOutside) document.addEventListener('pointerdown', onOutside, true);
        }, 0);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onReflow, true);
        // A scroll anywhere (dialog body, chart container) moves the trigger while the
        // popover is fixed — re-place so the shell tracks it instead of detaching.
        document.addEventListener('scroll', onReflow, true);
        if (this.fitWithinBoundary) {
            // Some mobile browsers do not scroll a focused descendant into its overflow
            // container. During a pointer gesture wait until its click has dispatched,
            // so revealing the target cannot move it out from under the user's finger.
            const onFocus = (): void => { if (!this.fitPointerActive) this.revealFocusedControl(); };
            const onPointerDown = (): void => { this.fitPointerActive = true; };
            const onPointerEnd = (): void => {
                if (!this.fitPointerActive) return;
                this.fitPointerActive = false;
                if (this.focusRevealTimer !== null) clearTimeout(this.focusRevealTimer);
                this.focusRevealTimer = setTimeout(() => {
                    this.focusRevealTimer = null;
                    if (this.shown) this.revealFocusedControl();
                }, 0);
            };
            this.onFitFocus = onFocus;
            this.onFitPointerDown = onPointerDown;
            this.onFitPointerEnd = onPointerEnd;
            this.el.addEventListener('focusin', onFocus);
            this.el.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointerup', onPointerEnd, true);
            window.addEventListener('pointercancel', onPointerEnd, true);
            // A mobile keyboard and pinch zoom change the visible viewport without
            // necessarily resizing the layout viewport or firing a window resize.
            window.visualViewport?.addEventListener('resize', onReflow);
            window.visualViewport?.addEventListener('scroll', onReflow);
            if (typeof ResizeObserver !== 'undefined') {
                this.sizeObserver = new ResizeObserver(() => {
                    if (this.fitFrame !== null) return;
                    const view = this.el.ownerDocument.defaultView;
                    if (!view?.requestAnimationFrame) { this.place(); return; }
                    this.fitFrame = view.requestAnimationFrame(() => {
                        this.fitFrame = null;
                        if (this.shown) this.place();
                    });
                });
                this.sizeObserver.observe(this.el);
                if (typeof this.boundary !== 'string' && typeof this.boundary !== 'function') this.sizeObserver.observe(this.boundary);
            }
        }
        this.onOutside = onOutside;
        this.onKey = onKey;
        this.onReflow = onReflow;
        // Last: a listener may hide it again at once, and must find it fully open.
        announceSurface(this.el, true, 'popover', this.trigger);
    }

    hide(): void {
        if (!this.shown) return;
        // Closed before announcing (a listener's own hide() must not re-enter), but still
        // attached — a fade-out or removal follows — so the close bubbles to the host.
        this.shown = false;
        this.drag?.destroy();
        this.drag = null;
        this.el.style.removeProperty('translate');
        announceSurface(this.el, false, 'popover', this.trigger);
        if (this.onOutside) document.removeEventListener('pointerdown', this.onOutside, true);
        if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
        if (this.onReflow) {
            window.removeEventListener('resize', this.onReflow, true);
            document.removeEventListener('scroll', this.onReflow, true);
            if (this.fitWithinBoundary) {
                window.visualViewport?.removeEventListener('resize', this.onReflow);
                window.visualViewport?.removeEventListener('scroll', this.onReflow);
            }
        }
        this.sizeObserver?.disconnect();
        this.sizeObserver = null;
        if (this.fitFrame !== null) this.el.ownerDocument.defaultView?.cancelAnimationFrame(this.fitFrame);
        this.fitFrame = null;
        if (this.onFitFocus) this.el.removeEventListener('focusin', this.onFitFocus);
        if (this.onFitPointerDown) this.el.removeEventListener('pointerdown', this.onFitPointerDown);
        if (this.onFitPointerEnd) {
            window.removeEventListener('pointerup', this.onFitPointerEnd, true);
            window.removeEventListener('pointercancel', this.onFitPointerEnd, true);
        }
        if (this.focusRevealTimer !== null) clearTimeout(this.focusRevealTimer);
        this.focusRevealTimer = null;
        this.fitPointerActive = false;
        this.onFitFocus = null;
        this.onFitPointerDown = null;
        this.onFitPointerEnd = null;
        this.onOutside = null;
        this.onKey = null;
        this.onReflow = null;
        if (this.fadeMs > 0) {
            // Fade out, then leave the DOM; the shell is inert meanwhile (no listeners, not `open`, no hits).
            this.el.style.opacity = '0';
            this.el.style.pointerEvents = 'none';
            this.leaveTimer = setTimeout(() => {
                this.leaveTimer = null;
                this.detach();
            }, this.fadeMs);
        } else {
            this.exit = holdForExit(this.el, () => {
                this.exit = null;
                leaving.delete(this);
                this.detach();
            });
            if (this.exit) leaving.add(this);
        }
        if (open === this) open = null;
        this.ctrl.onClose?.();
    }

    private detach(): void {
        this.el.remove();
        this.layoutRoot?.remove();
    }

    /** Show if closed, hide if this instance is the open popover. */
    toggle(): void {
        if (this.shown) this.hide();
        else this.show();
    }

    destroy(): void {
        this.hide();
        this.exit?.finish();
    }

    reposition(): void {
        if (this.shown) this.place();
    }

    private clampRect(): Rect {
        let view = this.fitWithinBoundary
            ? visibleRect(0, 0, window.innerWidth, window.innerHeight, this.ctrl.viewportInset)
            : viewportRect(window.innerWidth, window.innerHeight, this.ctrl.viewportInset);
        const visual = this.fitWithinBoundary ? window.visualViewport : null;
        if (visual) {
            view = intersectRects(view, visibleRect(visual.offsetLeft, visual.offsetTop, visual.width, visual.height, this.ctrl.viewportInset));
        }
        const bound = this.readBoundary();
        if (!bound) return view;
        const intersection = intersectRects(view, insetRect(bound, this.ctrl.boundaryInset));
        // If the host has moved completely off screen there is no rectangle in both;
        // prefer the visible viewport to placing a surface at negative coordinates.
        return this.fitWithinBoundary && (intersection.width <= 0 || intersection.height <= 0) ? view : intersection;
    }

    private readBoundary(): Rect | null {
        const b = this.boundary;
        if (b === 'viewport') return null;
        const raw = typeof b === 'function' ? b() : b.getBoundingClientRect();
        return raw ? toRect(raw) : null;
    }

    private place(): void {
        const ar = this.trigger.getBoundingClientRect();
        const clamp = this.clampRect();
        if (this.ctrl.matchWidth) {
            const width = Math.max(this.el.offsetWidth, ar.width);
            this.el.style.minWidth = `${Math.round(this.fitWithinBoundary ? Math.min(width, Math.max(0, clamp.width)) : width)}px`;
        }
        if (this.fitWithinBoundary) {
            // Border and padding are minimum physical dimensions even with max-width:
            // 0. Remove them only when the available rectangle is smaller than the
            // chrome itself, and restore the caller's original styles when it grows.
            this.fitBoxDefaults ??= { padding: this.el.style.padding, borderWidth: this.el.style.borderWidth };
            this.el.style.padding = this.fitBoxDefaults.padding;
            this.el.style.borderWidth = this.fitBoxDefaults.borderWidth;
            const style = getComputedStyle(this.el);
            const number = (value: string): number => Number.parseFloat(value) || 0;
            const borderX = number(style.borderLeftWidth) + number(style.borderRightWidth);
            const borderY = number(style.borderTopWidth) + number(style.borderBottomWidth);
            const chromeX = borderX + number(style.paddingLeft) + number(style.paddingRight);
            const chromeY = borderY + number(style.paddingTop) + number(style.paddingBottom);
            if (clamp.width < chromeX || clamp.height < chromeY) this.el.style.padding = '0';
            if (clamp.width < borderX || clamp.height < borderY) this.el.style.borderWidth = '0';
            // Size before placement: flipping an oversized panel cannot fit it. The
            // surface becomes its own scroll region when the visible space is short.
            this.el.style.maxWidth = `${Math.max(0, Math.floor(clamp.width))}px`;
            this.el.style.maxHeight = `${Math.max(0, Math.floor(clamp.height))}px`;
            this.el.style.overflowX = 'hidden';
            this.el.style.overflowY = 'auto';
            this.el.style.overscrollBehavior = 'contain';
        }
        // A fixed layer inside layout containment or a transformed host is no longer
        // viewport-relative. Measure its real zero point, without adopting a drag shift,
        // so anchored popovers remain beside the trigger in either coordinate system.
        let origin: { left: number; top: number };
        if (this.ctrl.position === 'absolute') origin = this.host.getBoundingClientRect();
        else {
            const style = this.el.style;
            const properties = ['left', 'top', 'translate'] as const;
            const saved = properties.map((name) => ({ name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) }));
            style.setProperty('left', '0px');
            style.setProperty('top', '0px');
            style.setProperty('translate', 'none');
            origin = this.el.getBoundingClientRect();
            for (const { name, value, priority } of saved) {
                if (value) style.setProperty(name, value, priority);
                else style.removeProperty(name);
            }
        }
        const pos = placePopover({
            trigger: toRect(ar),
            pop: { width: this.el.offsetWidth, height: this.el.offsetHeight },
            gap: this.ctrl.gap,
            align: this.ctrl.align,
            clamp,
            originX: origin.left,
            originY: origin.top,
        });
        this.el.style.left = `${pos.left}px`;
        this.el.style.top = `${pos.top}px`;
        if (this.fitWithinBoundary) this.revealFocusedControl();
    }

    private revealFocusedControl(): void {
        // Keep the active control usable when the keyboard shrinks the viewport or
        // focus advances through a short panel. Never scroll the chart or the page.
        const active = this.el.ownerDocument.activeElement;
        if (!(active instanceof HTMLElement) || !this.el.contains(active)) return;
        const a = active.getBoundingClientRect(), r = this.el.getBoundingClientRect();
        if (a.bottom > r.bottom - 4) this.el.scrollTop += a.bottom - r.bottom + 4;
        else if (a.top < r.top + 4) this.el.scrollTop -= r.top - a.top + 4;
    }
}
