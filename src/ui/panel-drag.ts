// Floating panels keep header movement and add an independent, compact resize grip.
// A title drag normally moves the surface; the grip moves its top edge and holds the
// bottom steady. Bottom-attached phone panes may disable header movement. Content keeps
// its own scrolling gestures.
import { injectStyles } from './styles';

export interface PanelDrag {
    /** Reapply temporary viewport clamping without changing the preferred position. */
    reflow(): void;
    reset(): void;
    destroy(): void;
}

export interface PanelDragOptions {
    /** Header used for movement and minimum-size measurement. */
    handle: string;
    /** Disable header movement while retaining measurement and resizing. Defaults to true. */
    allowMove?: boolean;
    /** Optional descendant that resizes vertically instead of moving the panel. */
    resizeHandle?: string;
    /** Optional top-right button that directly resizes both width and height. */
    cornerResizeHandle?: string;
    /** Return the usable viewport/host bounds; default is the owning window. */
    boundary?: () => DOMRect | null;
    /** Keep a bottom-attached pane fixed to its host while resizing its top edge. */
    anchoredBottom?: boolean;
    /** Clamp the complete surface, not just its header, inside its current bounds. */
    keepWithinBounds?: boolean;
    /** Match a surface's CSS minimum so the grip reports and applies the real limit. */
    minHeight?: number;
    /** Report a user-requested height; the owner can persist a relative size. */
    onResize?: (height: number) => void;
    /** Reveal a keyboard-focused control without scrolling the containing page. */
    revealFocus?: () => boolean;
}

const GRIP_CSS = `
.vela-size-grip {
    box-sizing: border-box;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-muted);
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    border-radius: 5px;
}
.vela-size-grip::before { content: ''; display: block; width: 18px; height: 3px; border-radius: 2px; background: currentColor; opacity: .65; }
.vela-size-grip:hover, .vela-size-grip:focus-visible { color: var(--vela-fg-bright); background: var(--vela-hover); outline: none; }
.vela-size-grip:focus-visible::before { outline: 2px solid var(--vela-fg-bright); outline-offset: 3px; }
[data-dragging='1'] .vela-size-grip { color: var(--vela-fg-bright); }

`;

/** A compact, keyboard-focusable separator for direct height resizing. */
export function panelResizeGrip(doc: Document, label: string): HTMLElement {
    injectStyles('vela-panel-size-grip', GRIP_CSS, doc);
    const grip = doc.createElement('div');
    grip.className = 'vela-size-grip';
    grip.tabIndex = 0;
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', `Resize ${label}`);
    grip.setAttribute('aria-valuemin', '0');
    grip.setAttribute('aria-valuemax', '100');
    grip.setAttribute('aria-valuenow', '50');
    grip.title = 'Drag to resize · use arrow keys';
    return grip;
}

let panelSurfaceSequence = 0;

/** Connect a focusable separator to the surface whose height it controls. */
export function linkPanelResizeGrip(grip: HTMLElement, surface: HTMLElement): void {
    if (!surface.id) surface.id = `vela-resizable-panel-${++panelSurfaceSequence}`;
    grip.setAttribute('aria-controls', surface.id);
}

/** Viewport translation needed to reveal a focused control, without scrolling the page. */
export function focusViewportDelta(target: Element): { x: number; y: number } {
    const win = target.ownerDocument.defaultView;
    if (!win) return { x: 0, y: 0 };
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    const view = win.visualViewport;
    const left = (view?.offsetLeft ?? 0) + 4;
    const top = (view?.offsetTop ?? 0) + 4;
    const right = (view?.offsetLeft ?? 0) + (view?.width || win.innerWidth) - 4;
    const bottom = (view?.offsetTop ?? 0) + (view?.height || win.innerHeight) - 4;
    return {
        x: rect.left < left ? left - rect.left : rect.right > right ? right - rect.right : 0,
        y: rect.top < top ? top - rect.top : rect.bottom > bottom ? bottom - rect.bottom : 0,
    };
}

export function makePanelDraggable(surface: HTMLElement, opts: PanelDragOptions): PanelDrag {
    const doc = surface.ownerDocument;
    const win = doc.defaultView;
    let offsetX = 0;
    let offsetY = 0;
    // Viewport-only shifts are presentation, not the user's preferred position.
    let viewportShiftX = 0;
    let viewportShiftY = 0;
    let defaultHeight: number | null = null;
    let drag: {
        id: number; capture: HTMLElement; mode: 'move' | 'resize' | 'corner'; x: number; y: number;
        left: number; top: number; bottom: number; width: number; height: number;
        ox: number; oy: number; moved: boolean;
        styleWidth: string; styleHeight: string; styleMinWidth: string; styleMaxWidth: string; styleMaxHeight: string;
        resized: string | null;
    } | null = null;

    const bounds = (): { left: number; top: number; right: number; bottom: number } => {
        const b = opts.boundary?.();
        const base = b && b.width > 0 && b.height > 0 ? b : { left: 0, top: 0, right: win?.innerWidth ?? 0, bottom: win?.innerHeight ?? 0 };
        const view = win?.visualViewport;
        if (!view || view.width <= 0 || view.height <= 0) return base;
        const visible = { left: Math.max(base.left, view.offsetLeft), top: Math.max(base.top, view.offsetTop),
            right: Math.min(base.right, view.offsetLeft + view.width), bottom: Math.min(base.bottom, view.offsetTop + view.height) };
        return visible.right > visible.left && visible.bottom > visible.top ? visible : base;
    };
    const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));
    const paint = (): void => {
        const x = Math.round(offsetX + viewportShiftX);
        const y = Math.round(offsetY + viewportShiftY);
        if (x || y) surface.style.setProperty('translate', `${x}px ${y}px`);
        else surface.style.removeProperty('translate');
    };
    // A new user gesture starts from what is visible, not a stale preferred position.
    const adoptViewportShift = (): void => {
        offsetX += viewportShiftX;
        offsetY += viewportShiftY;
        viewportShiftX = 0;
        viewportShiftY = 0;
    };
    const grip = (): HTMLElement | null => opts.resizeHandle ? surface.querySelector<HTMLElement>(opts.resizeHandle) : null;
    const limits = (bottom: number): { min: number; max: number } => {
        const b = bounds();
        const inset = opts.anchoredBottom ? 0 : 8;
        const max = Math.max(1, Math.min(b.bottom - b.top - inset, bottom - b.top - (opts.anchoredBottom ? 0 : 4)));
        const handle = surface.querySelector<HTMLElement>(opts.handle);
        const handleHeight = handle?.getBoundingClientRect().height ?? 0;
        const resize = grip();
        const separateGrip = opts.anchoredBottom && resize && !handle?.contains(resize) ? resize.getBoundingClientRect().height : 0;
        const footer = surface.querySelector<HTMLElement>('.vela-dialog-footer')?.getBoundingClientRect().height ?? 0;
        return { min: Math.min(max, Math.max(112, opts.minHeight ?? 0, handleHeight + separateGrip + footer + 48)), max };
    };
    const updateGrip = (): void => {
        const el = grip();
        if (!el || !surface.isConnected) return;
        linkPanelResizeGrip(el, surface);
        const r = surface.getBoundingClientRect();
        if (!r.height) return;
        const { min, max } = limits(r.bottom);
        el.setAttribute('aria-valuemin', String(Math.round(min)));
        el.setAttribute('aria-valuemax', String(Math.round(max)));
        el.setAttribute('aria-valuenow', String(Math.round(clamp(r.height, min, max))));
        el.setAttribute('aria-valuetext', `${Math.round(r.height)} pixels high`);
    };
    // Clamp the complete header, not the whole body. The lower part of a dragged
    // surface may extend below the host, while every header action remains reachable.
    const movementLimits = (r: DOMRect): { minLeft: number; maxLeft: number; minTop: number; maxTop: number } => {
        const b = bounds();
        if (opts.keepWithinBounds) {
            const insetX = Math.min(4, Math.max(0, (b.right - b.left - r.width) / 2));
            const insetY = Math.min(4, Math.max(0, (b.bottom - b.top - r.height) / 2));
            const minLeft = b.left + insetX, minTop = b.top + insetY;
            return { minLeft, maxLeft: Math.max(minLeft, b.right - insetX - r.width),
                minTop, maxTop: Math.max(minTop, b.bottom - insetY - r.height) };
        }
        const measured = surface.querySelector<HTMLElement>(opts.handle)?.getBoundingClientRect();
        const head = measured && measured.width > 0 && measured.height > 0 ? measured : r;
        // A phone grip may be a separate strip above the heading; keep both visible.
        const strip = opts.anchoredBottom ? grip()?.getBoundingClientRect() : null;
        const extra = strip && strip.width > 0 && strip.height > 0 ? strip : head;
        const left = Math.min(head.left, extra.left) - r.left;
        const top = Math.min(head.top, extra.top) - r.top;
        const right = Math.max(head.right, extra.right) - r.left;
        const bottom = Math.max(head.bottom, extra.bottom) - r.top;
        const insetX = Math.min(4, Math.max(0, (b.right - b.left - (right - left)) / 2));
        const insetY = Math.min(4, Math.max(0, (b.bottom - b.top - (bottom - top)) / 2));
        const minLeft = b.left + insetX - left;
        const minTop = b.top + insetY - top;
        return { minLeft, maxLeft: Math.max(minLeft, b.right - insetX - right),
            minTop, maxTop: Math.max(minTop, b.bottom - insetY - bottom) };
    };
    const resizeCorner = (width: number, height: number, left: number, bottom: number): void => {
        const b = bounds();
        const header = surface.querySelector<HTMLElement>(opts.handle)?.getBoundingClientRect();
        const headerHeight = header?.height || 40;
        const availableWidth = Math.max(1, b.right - b.left - 8);
        const minWidth = Math.min(160, availableWidth);
        const maxWidth = Math.max(minWidth, b.right - left - 4);
        const maxHeight = Math.max(1, Math.min(b.bottom - b.top - 8, bottom - b.top - 4));
        const minHeight = Math.min(maxHeight, Math.max(112, headerHeight + 48, bottom - b.bottom + headerHeight + 4));
        surface.dataset.panelResized = '1';
        surface.style.minWidth = `${Math.round(minWidth)}px`;
        surface.style.maxWidth = `${Math.round(availableWidth)}px`;
        surface.style.maxHeight = `${Math.round(Math.max(1, b.bottom - b.top - 8))}px`;
        surface.style.width = `${Math.round(clamp(width, minWidth, maxWidth))}px`;
        surface.style.height = `${Math.round(clamp(height, minHeight, maxHeight))}px`;
        // A centred flex card moves as it grows. Keep its original bottom-left fixed.
        const after = surface.getBoundingClientRect();
        offsetX += left - after.left;
        offsetY += bottom - after.bottom;
        paint();
    };
    const resizeTo = (height: number, bottom: number): void => {
        const b = bounds();
        const { min, max } = limits(bottom);
        const next = clamp(height, min, max);
        // This also covers a resizable wrapper whose scrolling card is its child.
        surface.dataset.panelResized = '1';
        surface.style.maxHeight = opts.anchoredBottom ? '100%' : `${Math.max(1, b.bottom - b.top - 8)}px`;
        surface.style.height = `${Math.round(next)}px`;
        if (!opts.anchoredBottom) {
            // Flex-centred dialogs otherwise expand in BOTH directions. Translate by the
            // measured difference so the bottom stays put under the moving top edge.
            const after = surface.getBoundingClientRect();
            offsetY += bottom - after.bottom;
            paint();
        }
        opts.onResize?.(next);
        updateGrip();
    };
    const onDown = (e: PointerEvent): void => {
        if (surface.hasAttribute('data-maximized') || drag || e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const target = e.target instanceof Element ? e.target : null;
        const corner = opts.cornerResizeHandle ? target?.closest<HTMLElement>(opts.cornerResizeHandle) : null;
        const resize = opts.resizeHandle ? target?.closest<HTMLElement>(opts.resizeHandle) : null;
        const handle = corner ?? resize ?? (opts.allowMove === false ? null : target?.closest<HTMLElement>(opts.handle));
        if (!handle || !surface.contains(handle)) return;
        // A close button, text field, link or custom header control is not a move handle.
        if (!resize && !corner && target?.closest('button, input, select, textarea, a, [role="button"], [role="separator"], [contenteditable="true"]')) return;
        adoptViewportShift();
        const r = surface.getBoundingClientRect();
        if (resize) defaultHeight ??= r.height;
        drag = { id: e.pointerId, capture: handle, mode: corner ? 'corner' : resize ? 'resize' : 'move', x: e.clientX, y: e.clientY, left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height, ox: offsetX, oy: offsetY, moved: false,
            styleWidth: surface.style.width, styleHeight: surface.style.height, styleMinWidth: surface.style.minWidth,
            styleMaxWidth: surface.style.maxWidth, styleMaxHeight: surface.style.maxHeight,
            resized: surface.getAttribute('data-panel-resized') };
        try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    };
    const onMove = (e: PointerEvent): void => {
        const d = drag;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        surface.dataset.dragging = '1';
        if (d.mode === 'resize') {
            resizeTo(d.height - dy, d.bottom);
        } else if (d.mode === 'corner') {
            resizeCorner(d.width + dx, d.height - dy, d.left, d.bottom);
        } else {
            const current = surface.getBoundingClientRect();
            const bounds = movementLimits(current);
            const left = clamp(d.left + dx, bounds.minLeft, bounds.maxLeft);
            const top = clamp(d.top + dy, bounds.minTop, bounds.maxTop);
            offsetX = d.ox + left - d.left;
            offsetY = d.oy + top - d.top;
            paint();
        }
        e.preventDefault();
    };
    const onEnd = (e: PointerEvent): void => {
        if (!drag || drag.id !== e.pointerId) return;
        const finished = drag;
        drag = null;
        delete surface.dataset.dragging;
        try { finished.capture.releasePointerCapture(e.pointerId); } catch { /* capture already lost */ }
        if (e.type !== 'pointerup' && finished.moved) {
            surface.style.width = finished.styleWidth;
            surface.style.height = finished.styleHeight;
            surface.style.minWidth = finished.styleMinWidth;
            surface.style.maxWidth = finished.styleMaxWidth;
            surface.style.maxHeight = finished.styleMaxHeight;
            if (finished.resized === null) delete surface.dataset.panelResized;
            else surface.setAttribute('data-panel-resized', finished.resized);
            offsetX = finished.ox;
            offsetY = finished.oy;
            paint();
            // Owners such as Settings remember the height outside the DOM as well.
            if (finished.mode === 'resize') opts.onResize?.(finished.height);
            updateGrip();
        }
    };
    const onDoubleClick = (e: MouseEvent): void => {
        if (!opts.resizeHandle || !(e.target instanceof Element) || !e.target.closest(opts.resizeHandle) || defaultHeight === null) return;
        adoptViewportShift();
        resizeTo(defaultHeight, surface.getBoundingClientRect().bottom);
        e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
        if (!(e.target instanceof Element) || surface.hasAttribute('data-maximized')) return;
        if (e.key === 'Escape' && drag) {
            const d = drag;
            onEnd({ type: 'pointercancel', pointerId: d.id } as PointerEvent);
            e.preventDefault(); e.stopPropagation(); return;
        }
        if (opts.cornerResizeHandle && e.target.matches(opts.cornerResizeHandle)) {
            adoptViewportShift();
            const r = surface.getBoundingClientRect();
            const step = e.shiftKey ? 48 : 16;
            const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
            const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
            if (!dx && !dy) return;
            resizeCorner(r.width + dx, r.height + dy, r.left, r.bottom);
            e.preventDefault(); return;
        }
        if (opts.resizeHandle && e.target.matches(opts.resizeHandle)) {
            adoptViewportShift();
            const r = surface.getBoundingClientRect();
            defaultHeight ??= r.height;
            const { min, max } = limits(r.bottom);
            const step = e.shiftKey ? 96 : 32;
            if (e.key === 'ArrowUp') resizeTo(r.height + step, r.bottom);
            else if (e.key === 'ArrowDown') resizeTo(r.height - step, r.bottom);
            else if (e.key === 'Home') resizeTo(min, r.bottom);
            else if (e.key === 'End') resizeTo(max, r.bottom);
            else return;
            e.preventDefault();
            return;
        }
        // Only the focused movement handle owns these keys; never steal them from
        // a tab, input, button, or other control in the header.
        if (opts.allowMove === false || !e.target.matches(opts.handle)) return;
        adoptViewportShift();
        if (e.key === 'Home') {
            offsetX = 0;
            offsetY = 0;
            surface.style.removeProperty('translate');
            e.preventDefault();
            return;
        }
        const step = e.shiftKey ? 48 : 16;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx === 0 && dy === 0) return;
        const r = surface.getBoundingClientRect();
        const b = movementLimits(r);
        offsetX += clamp(r.left + dx, b.minLeft, b.maxLeft) - r.left;
        offsetY += clamp(r.top + dy, b.minTop, b.maxTop) - r.top;
        paint();
        e.preventDefault();
    };
    const revealFocusedTarget = (target: Element | null): void => {
        if (!opts.revealFocus?.() || !target || !surface.contains(target) || surface.hasAttribute('data-maximized')) return;
        const delta = focusViewportDelta(target);
        if (!delta.x && !delta.y) return;
        const rect = surface.getBoundingClientRect();
        const limits = movementLimits(rect);
        viewportShiftX += clamp(rect.left + delta.x, limits.minLeft, limits.maxLeft) - rect.left;
        viewportShiftY += clamp(rect.top + delta.y, limits.minTop, limits.maxTop) - rect.top;
        paint();
    };
    // Clamp for a transient visual viewport without overwriting the user's chosen position.
    const onResize = (): void => {
        if (!surface.isConnected || surface.hasAttribute('data-maximized')) return;
        viewportShiftX = 0;
        viewportShiftY = 0;
        paint();
        if (opts.anchoredBottom) surface.style.maxHeight = '100%';
        else if (surface.dataset.panelResized) {
            const b = bounds();
            // Keep the chosen height in the inline style; a temporary max-height lifts
            // as soon as the viewport expands again.
            surface.style.maxHeight = `${Math.max(1, b.bottom - b.top - 8)}px`;
        }
        const r = surface.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const b = movementLimits(r);
        viewportShiftX = clamp(r.left, b.minLeft, b.maxLeft) - r.left;
        viewportShiftY = clamp(r.top, b.minTop, b.maxTop) - r.top;
        paint();
        updateGrip();
        revealFocusedTarget(doc.activeElement);
    };
    const onFocusIn = (event: FocusEvent): void => {
        updateGrip();
        revealFocusedTarget(event.target instanceof Element ? event.target : null);
    };
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onEnd);
    surface.addEventListener('pointercancel', onEnd);
    surface.addEventListener('lostpointercapture', onEnd);
    surface.addEventListener('dblclick', onDoubleClick);
    surface.addEventListener('keydown', onKeyDown);
    surface.addEventListener('focusin', onFocusIn);
    // Opening transforms do not change the ResizeObserver's content box, but they do
    // change getBoundingClientRect(). Refresh the announced height when they settle.
    const onAnimationEnd = (event: Event): void => { if (event.target === surface) updateGrip(); };
    surface.addEventListener('animationend', onAnimationEnd);
    surface.addEventListener('animationcancel', onAnimationEnd);
    win?.addEventListener('resize', onResize);
    win?.visualViewport?.addEventListener('resize', onResize);
    win?.visualViewport?.addEventListener('scroll', onResize);
    const ro = opts.resizeHandle && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateGrip) : null;
    ro?.observe(surface);
    const hostObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (surface.parentElement) hostObserver?.observe(surface.parentElement);
    return {
        reflow: onResize,
        reset(): void {
            drag = null;
            offsetX = 0;
            offsetY = 0;
            viewportShiftX = 0;
            viewportShiftY = 0;
            delete surface.dataset.dragging;
            surface.style.removeProperty('translate');
            // Placement is applied by the owner after reset; clamp once it is visible.
            win?.requestAnimationFrame?.(onResize);
        },
        destroy(): void {
            ro?.disconnect();
            hostObserver?.disconnect();
            surface.removeEventListener('pointerdown', onDown);
            surface.removeEventListener('pointermove', onMove);
            surface.removeEventListener('pointerup', onEnd);
            surface.removeEventListener('pointercancel', onEnd);
            surface.removeEventListener('lostpointercapture', onEnd);
            surface.removeEventListener('dblclick', onDoubleClick);
            surface.removeEventListener('keydown', onKeyDown);
            surface.removeEventListener('focusin', onFocusIn);
            surface.removeEventListener('animationend', onAnimationEnd);
            surface.removeEventListener('animationcancel', onAnimationEnd);
            win?.removeEventListener('resize', onResize);
            win?.visualViewport?.removeEventListener('resize', onResize);
            win?.visualViewport?.removeEventListener('scroll', onResize);
        },
    };
}
