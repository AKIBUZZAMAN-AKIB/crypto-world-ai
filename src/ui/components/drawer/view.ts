// Drawer VIEW — a bottom sheet: dimmed backdrop, a panel that slides up from the host's
// bottom edge and a draggable top edge. The body is caller-owned. Built for
// the mobile chrome, but host-agnostic like every kit component.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { drawerController, type DrawerControllerOptions } from './controller';
import { DRAWER_CSS, DRAWER_STYLE_ID } from './styles';
import * as zagDialog from '@zag-js/dialog';
import { announceSurface } from '../../surface-events';
import { holdForExit, type SurfaceExit } from '../../surface-exit';
import { linkPanelResizeGrip } from '../../panel-drag';

/** Drag past this fraction of the sheet's height (or this many px, whichever is
 *  smaller) and the release dismisses; anything less springs back. */
const DISMISS_FRACTION = 0.33;
const DISMISS_PX = 96;
/** Movement below this is a tap; past it the gesture commits to a direction. */
const SLOP_PX = 8;
/** A horizontal swipe must travel at least this far to fire `onSwipe`. */
const HSWIPE_MIN_PX = 48;

export interface DrawerOptions extends DrawerControllerOptions {
    title?: string;
    content?: Node | ((body: HTMLElement) => void);
    host?: HTMLElement;
    /** Horizontal swipe across the sheet (fires on release; `'left'` = the finger moved
     *  left). Gestures that start inside a horizontally scrollable strip (tabs, chip
     *  rows) keep their native scroll instead. */
    onSwipe?: (dir: 'left' | 'right') => void;
}

/** What the active pointer gesture has committed to (decided once past the slop). */
type GestureMode = 'idle' | 'pending' | 'drag' | 'move' | 'resize' | 'hswipe' | 'scroll';

/**
 * Classify a pointer gesture over the sheet — PURE. `'pending'` until the movement
 * clears the slop; then a decidedly vertical downward pull becomes the dismiss `'drag'`
 * (only while every scroller under the finger is at rest — a scrolled list keeps native
 * scrolling), a decidedly horizontal move becomes an `'hswipe'` (when the sheet has a
 * swipe handler and the finger is not on a strip that scrolls sideways itself), and
 * everything else stays native `'scroll'`.
 */
export function classifyGesture(dx: number, dy: number, ctx: { canSwipe: boolean; scrolled: boolean; hScrollable: boolean }): 'pending' | 'drag' | 'hswipe' | 'scroll' {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return 'pending';
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 && !ctx.scrolled ? 'drag' : 'scroll';
    return ctx.canSwipe && !ctx.hScrollable ? 'hswipe' : 'scroll';
}

/** Whether releasing a dismiss drag at `dy` px closes the sheet — PURE. */
export function dragDismisses(dy: number, panelHeightPx: number): boolean {
    return dy >= Math.min(DISMISS_PX, panelHeightPx * DISMISS_FRACTION);
}

/** The direction a released horizontal swipe fires, or null when it was too short
 *  (or more vertical than horizontal after all) — PURE. */
export function swipeDirection(dx: number, dy: number): 'left' | 'right' | null {
    if (Math.abs(dx) < HSWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return null;
    return dx < 0 ? 'left' : 'right';
}

export class Drawer {
    /** Caller-owned content area — append your rows/lists here. */
    readonly body: HTMLElement;
    private readonly backdrop: HTMLElement;
    private readonly positioner: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly titleEl: HTMLElement;
    private readonly handle: HandleOf<typeof zagDialog.machine>;
    private readonly ctrl: ReturnType<typeof drawerController>;
    /** Vertical offset of the whole sheet from its default bottom position. */
    private sheetOffsetY = 0;
    private sizeObserver: ResizeObserver | null = null;
    private viewportCleanup: (() => void) | null = null;
    private viewportReflow: (() => void) | null = null;
    /** Tears down the stale-click guard armed by {@link guardStaleClick}. */
    private staleClickOff: (() => void) | null = null;

    constructor(opts: DrawerOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(DRAWER_STYLE_ID, DRAWER_CSS, doc);
        const host = opts.host ?? doc.body;

        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'vela-drawer-backdrop vela-ui-layer';
        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-drawer-positioner vela-ui-layer';
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-drawer';
        // Programmatically focusable: the sheet itself takes the dialog machine's initial
        // focus — focusing the first tabbable (often a search input) would pop the
        // on-screen keyboard over a surface that just slid in.
        this.panel.tabIndex = -1;

        // The grip resizes. Desktop title rails can move; phone rails remain still
        // under their own separate resize strip, including in untitled sheets.
        const top = doc.createElement('div');
        top.className = 'vela-drawer-top';
        top.toggleAttribute('data-untitled', !opts.title);
        top.tabIndex = 0;
        top.setAttribute('aria-label', `Move ${opts.title ?? 'panel'}`);
        top.title = 'Drag to move panel';
        const grab = doc.createElement('div');
        grab.className = 'vela-drawer-grab';
        grab.tabIndex = 0;
        grab.setAttribute('role', 'separator');
        grab.setAttribute('aria-orientation', 'horizontal');
        grab.setAttribute('aria-label', `Resize ${opts.title ?? 'panel'}`);
        grab.setAttribute('aria-valuemin', '0');
        grab.setAttribute('aria-valuemax', '100');
        grab.setAttribute('aria-valuenow', '50');
        grab.title = 'Drag to resize · use arrow keys';
        this.titleEl = doc.createElement('div');
        this.titleEl.className = 'vela-drawer-title';
        this.titleEl.textContent = opts.title ?? '';

        this.body = doc.createElement('div');
        this.body.className = 'vela-drawer-body';
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        top.append(grab, this.titleEl);
        this.panel.append(top, this.body);
        this.positioner.appendChild(this.panel);
        host.append(this.backdrop, this.positioner);
        this.wireGestures(grab, top, opts.onSwipe);

        this.ctrl = drawerController({ ...opts, initialFocusEl: () => this.panel });
        const mid = String(this.ctrl.props.id);
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            // Close announces while the panel still shows (before the close props land), open once it does.
            const closing = this.wasOpen && !api.open;
            if (closing) {
                this.announce(false);
            }
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            spreadProps(this.titleEl, api.getTitleProps(), mid);
            // Dialog-family machines expect conditional rendering (their `hidden` reaches the
            // panel and backdrop only, and the sheet's authored display beats it) — the view
            // toggles visibility from `api.open` itself, once the exit animation of a close has run.
            if (api.open) {
                this.exit?.cancel();
                this.exit = null;
                this.setShown(true);
            } else if (closing) {
                this.holdExit();
            } else if (!this.exit) {
                this.setShown(false);
            }
            if (api.open && !this.wasOpen) {
                // The machine reveals the panel asynchronously; fit it only after it
                // has a box, including when a visual viewport was already narrowed.
                if (this.panel.hasAttribute('data-grip-row')) this.viewportReflow?.();
                this.announce(true);
            }
            if (this.wasOpen && !api.open) this.restoreOpener();
            this.wasOpen = api.open;
        });
    }

    /** Any element between `from` and the panel that has already been scrolled down —
     *  a downward pull there must scroll it back up, never drag the sheet. */
    private scrolledAncestor(from: EventTarget | null): boolean {
        let el = from instanceof Element ? from : null;
        while (el && el !== this.panel) {
            if (el.scrollTop > 0) return true;
            el = el.parentElement;
        }
        return false;
    }

    /** Any element between `from` and the panel that scrolls horizontally on its own
     *  (the tab strip, chip rows) — a sideways move there is ITS scroll, not a swipe. */
    private hScrollableAncestor(from: EventTarget | null): boolean {
        let el = from instanceof Element ? from : null;
        while (el && el !== this.panel) {
            if (el.scrollWidth > el.clientWidth + 1) return true;
            el = el.parentElement;
        }
        return false;
    }

    /**
     * One recognizer for the whole sheet. The grabber resizes at the top edge,
     * desktop titles move the sheet, and content keeps its own scrolling/swipe behaviour.
     */
    private wireGestures(grab: HTMLElement, topRail: HTMLElement, onSwipe?: (dir: 'left' | 'right') => void): void {
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let dy = 0;
        let mode: GestureMode = 'idle';
        let moveTop = 0;
        let moveOffset = 0;
        let resizeStart = 0;
        let resizeBottom = 0;
        let defaultHeight: number | null = null;
        let manualSize = false;
        let activeId: number | null = null;
        let captureTarget: HTMLElement | null = null;
        let handleMoved = false;

        const syncGripPlacement = (): void => {
            const mode = this.panel.closest<HTMLElement>('[data-layout]')?.dataset.layout;
            const win = this.panel.ownerDocument.defaultView;
            const mobile = mode ? mode === 'mobile' : !!win?.matchMedia?.('(max-width: 719px)').matches;
            const enteringMobile = mobile && !this.panel.hasAttribute('data-grip-row');
            const target = mobile ? this.panel : topRail;
            this.panel.toggleAttribute('data-grip-row', mobile);
            if (enteringMobile) {
                this.sheetOffsetY = 0;
                this.panel.style.removeProperty('translate');
            }
            topRail.tabIndex = mobile ? -1 : 0;
            if (mobile) {
                topRail.removeAttribute('aria-label');
                topRail.removeAttribute('title');
            } else {
                topRail.setAttribute('aria-label', `Move ${this.titleEl.textContent || 'panel'}`);
                topRail.title = 'Drag to move panel';
            }
            if (grab.parentElement === target) return;
            const focused = this.panel.ownerDocument.activeElement === grab;
            if (mobile) this.panel.insertBefore(grab, topRail);
            else topRail.prepend(grab);
            if (focused && win?.getComputedStyle(grab).display !== 'none') grab.focus({ preventScroll: true });
        };
        syncGripPlacement();
        const chromeHeight = (): number => {
            const panel = this.panel.getBoundingClientRect();
            const head = topRail.getBoundingClientRect();
            return grab.parentElement === this.panel ? Math.max(head.height, head.bottom - panel.top) : head.height;
        };

        const visibleBounds = (): { top: number; bottom: number; height: number } => {
            const host = this.positioner.getBoundingClientRect();
            const view = this.panel.ownerDocument.defaultView?.visualViewport;
            if (!view || view.height <= 0) return host;
            const top = Math.max(host.top, view.offsetTop);
            const bottom = Math.min(host.bottom, view.offsetTop + view.height);
            return bottom > top ? { top, bottom, height: bottom - top } : host;
        };
        const reposition = (top: number, initialTop: number, initialOffset: number): void => {
            const bounds = visibleBounds();
            const min = bounds.top + 4;
            const max = Math.max(min, bounds.bottom - chromeHeight() - 4);
            const safeTop = Math.min(Math.max(top, min), max);
            this.sheetOffsetY = initialOffset + safeTop - initialTop;
            this.panel.style.setProperty('translate', `0 ${Math.round(this.sheetOffsetY)}px`);
        };
        const limits = (bottom: number): { min: number; max: number } => {
            const bounds = visibleBounds();
            const max = Math.max(1, Math.min(bounds.height - 8, bottom - bounds.top - 4));
            const chrome = chromeHeight();
            return { min: Math.min(max, Math.max(112, chrome + 48)), max };
        };
        const updateGrip = (): void => {
            const panel = this.panel.getBoundingClientRect();
            if (!panel.height) return;
            linkPanelResizeGrip(grab, this.panel);
            const { min, max } = limits(panel.bottom);
            grab.setAttribute('aria-valuemin', String(Math.round(min)));
            grab.setAttribute('aria-valuemax', String(Math.round(max)));
            grab.setAttribute('aria-valuenow', String(Math.round(panel.height)));
            grab.setAttribute('aria-valuetext', `${Math.round(panel.height)} pixels high`);
        };
        const resizeTo = (height: number, bottom: number): void => {
            const { min, max } = limits(bottom);
            const next = Math.min(Math.max(height, min), max);
            manualSize = true;
            this.panel.style.maxHeight = `${Math.max(1, visibleBounds().height - 8)}px`;
            this.panel.style.height = `${Math.round(next)}px`;
            const after = this.panel.getBoundingClientRect();
            this.sheetOffsetY += bottom - after.bottom;
            this.panel.style.setProperty('translate', `0 ${Math.round(this.sheetOffsetY)}px`);
            updateGrip();
        };
        grab.addEventListener('dblclick', () => {
                if (defaultHeight !== null) resizeTo(defaultHeight, this.panel.getBoundingClientRect().bottom);
        });
        grab.addEventListener('focus', updateGrip);
        topRail.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target !== topRail || this.panel.hasAttribute('data-grip-row')) return;
            if (e.key === 'Home') {
                this.sheetOffsetY = 0;
                this.panel.style.removeProperty('translate');
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const panel = this.panel.getBoundingClientRect();
                const step = e.shiftKey ? 80 : 32;
                reposition(panel.top + (e.key === 'ArrowUp' ? -step : step), panel.top, this.sheetOffsetY);
            } else return;
            e.preventDefault();
        });
        grab.addEventListener('keydown', (e: KeyboardEvent) => {
            const panel = this.panel.getBoundingClientRect();
            if (!panel.height) return;
            defaultHeight ??= panel.height;
            const { min, max } = limits(panel.bottom);
            const step = e.shiftKey ? 96 : 32;
            if (e.key === 'ArrowUp') resizeTo(panel.height + step, panel.bottom);
            else if (e.key === 'ArrowDown') resizeTo(panel.height - step, panel.bottom);
            else if (e.key === 'Home') resizeTo(min, panel.bottom);
            else if (e.key === 'End') resizeTo(max, panel.bottom);
            else return;
            e.preventDefault();
        });

        const beginDrag = (e: PointerEvent): void => {
            mode = 'drag';
            // Rebase so the sheet tracks from the commit point instead of jumping by the slop.
            startY = e.clientY;
            this.panel.style.transition = 'none';
            captureTarget = this.panel;
            try {
                this.panel.setPointerCapture(e.pointerId);
            } catch {
                /* detached target or a test double without capture support */
            }
        };

        this.panel.addEventListener('pointerdown', (e) => {
            if (e.isPrimary === false || (activeId !== null && (mode === 'move' || mode === 'resize' || mode === 'drag')) || (e.pointerType === 'mouse' && e.button !== 0)) return;
            activeId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            dx = 0;
            dy = 0;
            const target = e.target instanceof Element ? e.target : null;
            const paneHead = target?.closest('.vela-md-panehead, .vela-drawer-title, .vela-drawer-top');
            const interactive = target?.closest('button, input, select, textarea, a, [role="separator"]');
            if (grab.contains(e.target as Node)) {
                mode = 'resize';
                const panel = this.panel.getBoundingClientRect();
                resizeStart = panel.height;
                resizeBottom = panel.bottom;
                defaultHeight ??= panel.height;
                handleMoved = false;
                captureTarget = grab;
                try { grab.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
            } else if (paneHead && !interactive) {
                // In portrait, the heading is not a movement or dismiss handle.
                if (this.panel.hasAttribute('data-grip-row')) {
                    mode = 'idle';
                    activeId = null;
                    return;
                }
                mode = 'move';
                moveTop = this.panel.getBoundingClientRect().top;
                moveOffset = this.sheetOffsetY;
                handleMoved = false;
                captureTarget = this.panel;
                try { this.panel.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
            } else mode = 'pending';
        });

        this.panel.addEventListener('pointermove', (e) => {
            if (e.pointerId !== activeId || mode === 'idle' || mode === 'scroll') return;
            dx = e.clientX - startX;
            dy = e.clientY - startY;
            if (mode === 'pending') {
                const intent = classifyGesture(dx, dy, {
                    canSwipe: !!onSwipe,
                    scrolled: this.scrolledAncestor(e.target),
                    hScrollable: this.hScrollableAncestor(e.target),
                });
                if (intent === 'pending') return;
                if (intent === 'drag') beginDrag(e);
                else mode = intent;
            }
            if (mode === 'move') {
                if (Math.abs(dy) >= 4) handleMoved = true;
                if (handleMoved) {
                    reposition(moveTop + dy, moveTop, moveOffset);
                    e.preventDefault();
                }
            } else if (mode === 'resize') {
                if (Math.abs(dy) >= 4) handleMoved = true;
                if (handleMoved) {
                    resizeTo(resizeStart - dy, resizeBottom);
                    e.preventDefault();
                }
            } else if (mode === 'drag') {
                dy = Math.max(0, e.clientY - startY);
                this.panel.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
            }
        });

        // Keep the browser's scroll logic off a pull the sheet owns (or may still claim):
        // without preventDefault here, the scroller grabs the touch and cancels the
        // pointer stream before the drag can commit. Only downward pulls on an at-rest
        // scroller are blocked — everything else keeps native behavior.
        this.panel.addEventListener(
            'touchmove',
            (e) => {
                if (mode === 'drag' || mode === 'move' || mode === 'resize' || mode === 'hswipe') {
                    e.preventDefault();
                    return;
                }
                if (mode !== 'pending') return;
                const t = e.touches[0];
                if (!t) return;
                const mdx = t.clientX - startX;
                const mdy = t.clientY - startY;
                if (mdy > Math.abs(mdx) && !this.scrolledAncestor(e.target)) e.preventDefault();
            },
            { passive: false },
        );

        const settle = (e: PointerEvent): void => {
            if (mode === 'idle' || e.pointerId !== activeId) return;
            const finished = mode;
            mode = 'idle';
            activeId = null;
            try { captureTarget?.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
            captureTarget = null;
            if (finished === 'move' || finished === 'resize') {

            } else if (finished === 'drag') {
                this.panel.style.transition = '';
                this.panel.style.transform = '';
                if (e.type !== 'pointercancel' && dragDismisses(dy, this.panel.getBoundingClientRect().height)) this.hide();
            } else if (finished === 'hswipe' && e.type !== 'pointercancel') {
                const dir = swipeDirection(dx, dy);
                if (dir) onSwipe?.(dir);
            }
        };
        this.panel.addEventListener('pointerup', settle);
        this.panel.addEventListener('pointercancel', settle);
        if (typeof ResizeObserver !== 'undefined') {
            this.sizeObserver = new ResizeObserver(() => { syncGripPlacement(); updateGrip(); });
            this.sizeObserver.observe(this.panel);
        }
        const win = this.panel.ownerDocument.defaultView;
        const reflow = (): void => {
            syncGripPlacement();
            let panel = this.panel.getBoundingClientRect();
            if (!panel.height) return;
            const bounds = visibleBounds();
            const max = Math.max(1, bounds.height - 8);
            if (manualSize) this.panel.style.maxHeight = `${max}px`;
            else {
                this.panel.style.removeProperty('max-height');
                panel = this.panel.getBoundingClientRect();
                if (panel.height > max) this.panel.style.maxHeight = `${max}px`;
            }
            panel = this.panel.getBoundingClientRect();
            if (this.panel.hasAttribute('data-grip-row')) {
                // Do not mistake the entry animation (or a dismiss swipe) for the
                // preferred position when fitting the sheet to a visual viewport.
                const transform = win?.getComputedStyle(this.panel).transform;
                let animatedY = 0;
                if (transform && transform !== 'none' && typeof DOMMatrixReadOnly !== 'undefined') {
                    try { animatedY = new DOMMatrixReadOnly(transform).m42; } catch { /* non-matrix transform */ }
                }
                // A keyboard or zoom can shrink the visible viewport. Keep the
                // phone sheet at its visible bottom, then return when it recovers.
                this.sheetOffsetY += bounds.bottom - (panel.bottom - animatedY);
            } else {
                const minTop = bounds.top + 4;
                const maxTop = Math.max(minTop, bounds.bottom - chromeHeight() - 4);
                const safeTop = Math.min(Math.max(panel.top, minTop), maxTop);
                this.sheetOffsetY += safeTop - panel.top;
            }
            this.panel.style.setProperty('translate', `0 ${Math.round(this.sheetOffsetY)}px`);
            updateGrip();
        };
        this.viewportReflow = reflow;
        const onResize = (): void => { reflow(); win?.requestAnimationFrame(reflow); };
        win?.addEventListener('resize', onResize);
        win?.visualViewport?.addEventListener('resize', reflow);
        win?.visualViewport?.addEventListener('scroll', reflow);
        this.viewportCleanup = () => {
            this.viewportReflow = null;
            win?.removeEventListener('resize', onResize);
            win?.visualViewport?.removeEventListener('resize', reflow);
            win?.visualViewport?.removeEventListener('scroll', reflow);
        };
    }

    setTitle(title: string): void {
        this.titleEl.textContent = title;
        this.panel.querySelector('.vela-drawer-grab')?.setAttribute('aria-label', `Resize ${title || 'panel'}`);
        const top = this.panel.querySelector('.vela-drawer-top');
        if (!this.panel.hasAttribute('data-grip-row')) top?.setAttribute('aria-label', `Move ${title || 'panel'}`);
        top?.toggleAttribute('data-untitled', !title);
    }

    private opener: HTMLElement | null = null;
    private wasOpen = false;
    /** The sheet and scrim's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private destroyed = false;

    private setShown(shown: boolean): void {
        this.backdrop.style.display = shown ? '' : 'none';
        this.positioner.style.display = shown ? '' : 'none';
    }

    /** Keep the just-closed sheet up through its exit animation, then hide it — or
     *  remove it, when it was destroyed meanwhile. `spreadProps` re-applies the close
     *  props' `hidden` only when its value changes, so lifting it keeps the sheet and
     *  scrim up until the exit ends. The positioner spans the host: inert, it lets
     *  clicks through to the page while the sheet animates out. */
    private holdExit(): void {
        const held = [this.panel, this.backdrop];
        for (const el of held) el.hidden = false;
        this.exit = holdForExit(
            held,
            () => {
                this.exit = null;
                if (this.destroyed) {
                    this.detach();
                } else if (!this.open) {
                    for (const el of held) el.hidden = true;
                    this.setShown(false);
                }
            },
            { inert: [this.positioner] },
        );
    }

    private detach(): void {
        this.backdrop.remove();
        this.positioner.remove();
    }

    /** Closing hands focus back to whatever opened it (Escape, the ✕, hide(), or a
     *  teardown that outruns the machine's close notification). */
    private restoreOpener(): void {
        const opener = this.opener;
        this.opener = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    private announce(open: boolean): void {
        const opener = this.opener === this.panel.ownerDocument.body ? null : this.opener;
        announceSurface(this.panel, open, 'drawer', opener);
    }

    get open(): boolean {
        return this.ctrl.connect(this.handle.service).open;
    }

    show(): void {
        if (!this.open) {
            this.sheetOffsetY = 0;
            this.panel.style.removeProperty('translate');
        }
        this.opener = this.panel.ownerDocument.activeElement as HTMLElement | null;
        this.ctrl.connect(this.handle.service).setOpen(true);
        this.guardStaleClick();
    }

    hide(): void {
        this.clearStaleClickGuard();
        this.ctrl.connect(this.handle.service).setOpen(false);
    }

    /**
     * Swallow the RELEASE click of the gesture that opened the sheet. A sheet slides up
     * under the very finger that summoned it, so the browser's synthesized click would
     * land on whichever row happens to be under that finger — a long-press on the time
     * axis silently picked a timezone that way. A deliberate tap always starts with a
     * fresh `pointerdown` (which disarms the guard), so nothing a user means to press is
     * ever swallowed; keyboard activation (`detail === 0`) passes untouched.
     */
    private guardStaleClick(): void {
        this.clearStaleClickGuard();
        const win = this.positioner.ownerDocument.defaultView;
        if (!win) return;
        const onClick = (e: MouseEvent): void => {
            if (e.detail === 0) return; // keyboard / assistive activation
            e.stopPropagation();
            e.preventDefault();
            this.clearStaleClickGuard();
        };
        const onDown = (): void => this.clearStaleClickGuard();
        win.addEventListener('click', onClick, true);
        win.addEventListener('pointerdown', onDown, true);
        this.staleClickOff = () => {
            win.removeEventListener('click', onClick, true);
            win.removeEventListener('pointerdown', onDown, true);
        };
    }

    private clearStaleClickGuard(): void {
        this.staleClickOff?.();
        this.staleClickOff = null;
    }

    destroy(): void {
        this.sizeObserver?.disconnect();
        this.sizeObserver = null;
        this.viewportCleanup?.();
        this.viewportCleanup = null;
        // Closed but not projected yet — an owner disposing of the sheet as it reports
        // closing: project the close now, so it animates out like any other close and
        // leaves the DOM when its exit ends. A teardown while open leaves at once.
        if (this.wasOpen && !this.open) this.handle.flush();
        this.handle.stop();
        this.destroyed = true;
        // Torn down while open: the stopped machine never projects the close.
        if (this.wasOpen) {
            this.wasOpen = false;
            this.announce(false);
        }
        this.restoreOpener();
        if (!this.exit) this.detach();
    }
}
