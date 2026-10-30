// Tooltip VIEW — one shared floating surface for the whole page.
//
// A tooltip used to be its own floating layer: `new Tooltip(trigger, …)` built a positioner
// (`.vela-ui-layer`) and a content box (`.vela-tooltip`), ran a Zag machine on the trigger and
// left the pair in the document, hidden, for the page's whole life. A desktop workspace has
// twenty-odd of them — every topbar tool, the panel toggles, the timeframe caret, the status
// line's market and eye — so ~46 nodes and a machine's worth of listeners each sat in the tree
// to show one line of text on hover.
//
// There is now ONE surface: 0 nodes at rest (it is built by the first open) and four
// document-level listeners that resolve the trigger from the event. A registered trigger
// carries a single `data-vela-tip` marker; everything else about its tip (content, placement,
// delays, interactive) lives in this module's map, so nothing else is added to the DOM.
//
// The behaviour is Zag's, which is TradingView's: instant on hover, centred 8px off the
// trigger's side (above by default), flipped when that side would overflow the viewport,
// clamped to the viewport, `role="tooltip"` with the trigger's `aria-describedby` while open,
// `data-state` on both, Escape closes, a press closes, keyboard focus opens. Touch pointers
// never open one — a finger has no hover to wait for and a tip that appeared under a tap
// would cover the control it just pressed.
import { injectStyles } from '../../styles';
import { TOOLTIP_CSS, TOOLTIP_STYLE_ID } from './styles';
import type { TooltipControllerOptions } from './controller';

export type TooltipPlacement =
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'right';

export interface TooltipOptions extends Omit<TooltipControllerOptions, 'placement'> {
    content: string | Node | (() => Node);
    host?: HTMLElement;
    /** Zag's machine took a `Placement`; the single surface supports the six sides the shell
     *  actually uses. Anything else falls back to `top`. */
    placement?: TooltipPlacement;
}

type TipContent = TooltipOptions['content'];

interface TipDef {
    content: TipContent;
    placement: TooltipPlacement;
    openDelay: number;
    closeDelay: number;
    interactive: boolean;
    host?: HTMLElement;
}

/** The marker every registered trigger carries. */
const TIP_ATTR = 'data-vela-tip';
/** The id of the shared content box — what a trigger's `aria-describedby` points at. */
const TIP_ID = 'vela-shared-tip';
/** Gap between the trigger's edge and the tip, and the smallest gap to the viewport. */
const OFFSET = 8;
const VIEWPORT_MARGIN = 4;
/** Time to cross the small gap from a trigger onto its hoverable tooltip. */
const HOVER_BRIDGE_MS = 300;

const SIDES = new Set(['top', 'bottom', 'left', 'right']);
const FLIP: Record<string, TooltipPlacement> = {
    top: 'bottom',
    'top-start': 'bottom-start',
    'top-end': 'bottom-end',
    bottom: 'top',
    'bottom-start': 'top-start',
    'bottom-end': 'top-end',
    left: 'right',
    right: 'left',
};

/** Keyboard focus? A pointer click focuses too, and its tip would outlive the click. */
function focusVisible(el: Element): boolean {
    try {
        return el.matches(':focus-visible');
    } catch {
        return false;
    }
}

const isElement = (n: unknown): n is Element =>
    typeof n === 'object' && n !== null && (n as Element).nodeType === 1;

/**
 * The one tooltip surface. Module-private in spirit: `Tooltip` below is the public door, and
 * every instance of it registers here rather than building anything.
 */
class SharedTips {
    private readonly defs = new Map<HTMLElement, TipDef>();
    /** Documents already listening — one delegated set per document, however many triggers. */
    private readonly wired = new WeakSet<Document>();
    private layer: HTMLElement | null = null;
    private box: HTMLElement | null = null;
    private openFor: HTMLElement | null = null;
    private hoveredTrigger: HTMLElement | null = null;
    private hoveringTip = false;
    /** Unregistered button titles are borrowed only while their tooltip is visible. */
    private auto: { trigger: HTMLElement; title: string | null } | null = null;
    private openTimer: ReturnType<typeof setTimeout> | null = null;
    private closeTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly reposition = (): void => {
        if (this.openFor) this.place(this.openFor);
    };

    /** Use the same surface for titled or icon-only buttons inside a workspace. */
    enableButtons(root: HTMLElement): () => void {
        root.setAttribute('data-vela-auto-tips', '');
        this.wire(root.ownerDocument);
        return () => {
            if (this.auto && (root.contains(this.auto.trigger) || !this.auto.trigger.isConnected)) this.close();
            root.removeAttribute('data-vela-auto-tips');
        };
    }

    register(trigger: HTMLElement, opts: TooltipOptions): void {
        if (this.auto?.trigger === trigger) this.close();
        if (opts.triggerId) trigger.id = opts.triggerId;
        trigger.setAttribute(TIP_ATTR, '');
        this.defs.set(trigger, {
            content: opts.content,
            placement: opts.placement && SIDES.has(opts.placement.split('-')[0]!) ? opts.placement : 'top',
            openDelay: opts.openDelay ?? 0,
            closeDelay: opts.closeDelay ?? 0,
            interactive: opts.interactive ?? false,
            host: opts.host,
        });
        this.wire(trigger.ownerDocument);
    }

    /** Replace a tip's content (a label that follows state, e.g. the compare button). */
    setContent(trigger: HTMLElement, content: TipContent): void {
        const def = this.defs.get(trigger);
        if (!def) return;
        def.content = content;
        if (this.openFor === trigger && this.box) {
            this.fill(def);
            this.place(trigger);
        }
    }

    /** Forget a trigger. Safe to call twice, and while its tip is open. */
    unregister(trigger: HTMLElement): void {
        if (this.openFor === trigger) this.close();
        this.defs.delete(trigger);
        trigger.removeAttribute(TIP_ATTR);
        trigger.removeAttribute('data-state');
        trigger.removeAttribute('data-scope');
        trigger.removeAttribute('data-part');
    }

    private wire(doc: Document): void {
        if (this.wired.has(doc)) return;
        this.wired.add(doc);
        doc.addEventListener('pointerover', (e) => this.onOver(e as PointerEvent), true);
        doc.addEventListener('pointerout', (e) => this.onOut(e as PointerEvent), true);
        doc.addEventListener('pointerdown', (e) => {
            if (isElement(e.target) && isElement(this.box) && this.box.contains(e.target as Node)) return;
            this.close();
        }, true);
        doc.addEventListener('focusin', (e) => {
            // Keyboard focus only: a button clicked with a pointer also takes focus, and a tip
            // left floating after the click would cover what the click opened.
            const t = this.triggerOf(e.target, true);
            if (t && isElement(e.target) && focusVisible(e.target)) {
                this.prepareAuto(t);
                this.open(t);
            }
        }, true);
        doc.addEventListener('focusout', (e) => {
            const trigger = this.triggerOf(e.target);
            if (!trigger || trigger !== this.openFor || (isElement(e.relatedTarget) && trigger.contains(e.relatedTarget))) return;
            if (this.hoveredTrigger !== trigger && !this.hoveringTip) this.scheduleClose(this.defs.get(trigger)?.closeDelay ?? 0);
        }, true);
        // Capture at the window before dialog/popover dismissal listeners: the first
        // Escape dismisses the tooltip, not the panel underneath it.
        const keyTarget: Window | Document = doc.defaultView ?? doc;
        keyTarget.addEventListener('keydown', (e: Event) => {
            if ((e as KeyboardEvent).key === 'Escape' && this.openFor) {
                this.close();
                e.stopImmediatePropagation();
            }
        }, true);
        doc.addEventListener('vela:surface-close', (e) => {
            if (this.openFor && isElement(e.target) && e.target.contains(this.openFor)) this.close();
        }, true);
    }

    private triggerOf(target: EventTarget | null, allowAuto = false): HTMLElement | null {
        if (!isElement(target)) return null;
        const el = target.closest(`[${TIP_ATTR}]`);
        if (el && this.defs.has(el as HTMLElement)) return el as HTMLElement;
        if (this.auto?.trigger.contains(target)) return this.auto.trigger;
        if (!allowAuto) return null;
        const control = target.closest('button, [role="separator"][title]') as HTMLElement | null;
        if (!control || !control.closest('[data-vela-auto-tips]') || control.closest('[data-vela-no-tip]')) return null;
        // Keep visible text as the name; otherwise nameless icon buttons and the titled
        // pane separator need the same styled hint instead of a native browser tooltip.
        const title = control.getAttribute('title')?.trim();
        const label = control.matches('button') && !control.textContent?.trim() ? control.getAttribute('aria-label')?.trim() : '';
        return title || label ? control : null;
    }

    private prepareAuto(trigger: HTMLElement): void {
        if (this.defs.has(trigger)) return;
        if (this.auto) this.close();
        const title = trigger.getAttribute('title');
        const content = title?.trim() || trigger.getAttribute('aria-label')?.trim();
        if (!content) return;
        this.auto = { trigger, title };
        // Restore on close; this suppresses the browser's second, differently styled tip.
        if (title !== null) trigger.removeAttribute('title');
        this.defs.set(trigger, { content, placement: 'top', openDelay: 0, closeDelay: 0, interactive: false });
    }

    private releaseAuto(trigger: HTMLElement): void {
        const saved = this.auto;
        if (!saved || saved.trigger !== trigger) return;
        this.auto = null;
        this.defs.delete(trigger);
        if (saved.title !== null && !trigger.hasAttribute('title')) trigger.setAttribute('title', saved.title);
        // Do not overwrite descriptions another control added or changed while open.
        const descriptions = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== TIP_ID);
        if (descriptions.length) trigger.setAttribute('aria-describedby', descriptions.join(' '));
        else trigger.removeAttribute('aria-describedby');
    }

    private hasKeyboardFocus(trigger: HTMLElement): boolean {
        const focused = trigger.ownerDocument.activeElement;
        return isElement(focused) && trigger.contains(focused) && focusVisible(focused);
    }

    private onOver(e: PointerEvent): void {
        if (e.pointerType === 'touch') return;
        if (isElement(e.target) && this.box?.contains(e.target)) {
            this.hoveringTip = true;
            this.clearClose();
            return;
        }
        const t = this.triggerOf(e.target, true);
        if (!t) return;
        this.hoveredTrigger = t;
        this.hoveringTip = false;
        this.clearClose();
        if (this.openFor === t) return;
        // Moving inside the open trigger (button → icon) is not a new tip.
        if (isElement(e.relatedTarget) && t.contains(e.relatedTarget as Node)) return;
        this.prepareAuto(t);
        this.hoveredTrigger = t;
        const def = this.defs.get(t);
        if (!def) return;
        this.clearOpen();
        if (def.openDelay > 0) this.openTimer = setTimeout(() => this.open(t), def.openDelay);
        else this.open(t);
    }

    private onOut(e: PointerEvent): void {
        if (e.pointerType === 'touch') return;
        const to = e.relatedTarget;
        if (isElement(e.target) && this.box?.contains(e.target)) {
            if (isElement(to) && this.box.contains(to)) return;
            this.hoveringTip = false;
            const trigger = this.openFor;
            if (!trigger) return;
            if (isElement(to) && trigger.contains(to)) { this.hoveredTrigger = trigger; return; }
            if (!this.hasKeyboardFocus(trigger)) this.scheduleClose(this.defs.get(trigger)?.closeDelay ?? 0);
            return;
        }
        const t = this.triggerOf(e.target);
        if (!t || t !== this.openFor) return;
        if (isElement(to) && t.contains(to)) return;
        this.hoveredTrigger = null;
        if (isElement(to) && this.box?.contains(to)) { this.hoveringTip = true; return; }
        if (!this.hasKeyboardFocus(t)) this.scheduleClose(Math.max(HOVER_BRIDGE_MS, this.defs.get(t)?.closeDelay ?? 0));
    }

    private open(trigger: HTMLElement): void {
        const def = this.defs.get(trigger);
        if (!def) return;
        this.clearClose();
        this.clearOpen();
        if (this.openFor && this.openFor !== trigger) {
            this.mark(this.openFor, false);
            this.releaseAuto(this.openFor);
        }
        this.build(trigger, def);
        this.openFor = trigger;
        this.fill(def);
        this.mark(trigger, true);
        // The trigger may be detached (a rebuilt topbar) — a tip for it would float alone.
        if (!trigger.isConnected) {
            this.close();
            return;
        }
        this.place(trigger);
        const doc = trigger.ownerDocument;
        doc.addEventListener('scroll', this.reposition, { capture: true, passive: true });
        doc.defaultView?.addEventListener('resize', this.reposition);
    }

    private build(trigger: HTMLElement, def: TipDef): void {
        const doc = trigger.ownerDocument;
        if (!this.layer) {
            injectStyles(TOOLTIP_STYLE_ID, TOOLTIP_CSS, doc);
            this.layer = doc.createElement('div');
            this.layer.className = 'vela-ui-layer';
            this.layer.dataset.scope = 'tooltip';
            this.layer.dataset.part = 'positioner';
            this.layer.style.position = 'fixed';
            this.layer.style.top = '0';
            this.layer.style.left = '0';
            this.layer.style.zIndex = 'var(--vela-z-tooltip)';
            this.layer.style.pointerEvents = 'none';
            this.box = doc.createElement('div');
            this.box.className = 'vela-tooltip';
            this.box.id = TIP_ID;
            this.box.setAttribute('role', 'tooltip');
            this.box.dataset.scope = 'tooltip';
            this.box.dataset.part = 'content';
            this.box.dataset.state = 'closed';
            this.box.hidden = true;
            this.layer.appendChild(this.box);
        }
        const host = def.host ?? (trigger.closest('.vela-ui') as HTMLElement | null) ?? doc.body;
        if (this.layer.parentElement !== host) host.appendChild(this.layer);
        // The text remains non-interactive, but it must be hoverable so a magnifier or
        // low-vision user can move onto it without the description disappearing.
        if (this.box) this.box.style.pointerEvents = 'auto';
    }

    private fill(def: TipDef): void {
        if (!this.box) return;
        const c = def.content;
        if (typeof c === 'string') this.box.textContent = c;
        else this.box.replaceChildren(typeof c === 'function' ? c() : c);
    }

    private mark(trigger: HTMLElement, open: boolean): void {
        const descriptions = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== TIP_ID);
        if (open) descriptions.push(TIP_ID);
        if (descriptions.length) trigger.setAttribute('aria-describedby', descriptions.join(' '));
        else trigger.removeAttribute('aria-describedby');
        // A delegated fallback must not overwrite the component's own state attribute.
        if (this.auto?.trigger !== trigger) trigger.dataset.state = open ? 'open' : 'closed';
    }

    /** Put the surface beside `trigger`: centred on the side it asked for, flipped to the
     *  opposite side when it would leave the viewport, then clamped inside it. */
    private place(trigger: HTMLElement): void {
        const layer = this.layer;
        const box = this.box;
        if (!layer || !box) return;
        box.hidden = false;
        box.dataset.state = 'open';
        // Measure at the origin so the previous position never skews the size read.
        // A fixed layer can have a non-viewport containing block (for example inside
        // a layout-contained panel or a transformed host). Its painted origin must be
        // subtracted from viewport coordinates to keep the tip beside its trigger.
        layer.style.transform = 'translate3d(0px, 0px, 0)';
        const origin = layer.getBoundingClientRect();
        const t = trigger.getBoundingClientRect();
        // Layout size, not the painted box: the open animation scales from 0.97, and a size
        // read through a running transform would centre the tip a pixel off its trigger.
        const b = { width: box.offsetWidth, height: box.offsetHeight };
        const doc = trigger.ownerDocument;
        const vw = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0;
        const vh = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0;
        const def = this.defs.get(trigger);
        let placement = def?.placement ?? 'top';

        const fits = (p: TooltipPlacement): boolean => {
            const side = p.split('-')[0];
            if (side === 'top') return t.top - OFFSET - b.height >= VIEWPORT_MARGIN;
            if (side === 'bottom') return t.bottom + OFFSET + b.height <= vh - VIEWPORT_MARGIN;
            if (side === 'left') return t.left - OFFSET - b.width >= VIEWPORT_MARGIN;
            return t.right + OFFSET + b.width <= vw - VIEWPORT_MARGIN;
        };
        if (!fits(placement) && FLIP[placement] && fits(FLIP[placement]!)) placement = FLIP[placement]!;

        const side = placement.split('-')[0]!;
        const align = placement.split('-')[1];
        let x: number;
        let y: number;
        if (side === 'top' || side === 'bottom') {
            x = align === 'start' ? t.left : align === 'end' ? t.right - b.width : t.left + (t.width - b.width) / 2;
            y = side === 'top' ? t.top - OFFSET - b.height : t.bottom + OFFSET;
        } else {
            y = align === 'start' ? t.top : align === 'end' ? t.bottom - b.height : t.top + (t.height - b.height) / 2;
            x = side === 'left' ? t.left - OFFSET - b.width : t.right + OFFSET;
        }
        x = Math.max(VIEWPORT_MARGIN, Math.min(x, Math.max(VIEWPORT_MARGIN, vw - b.width - VIEWPORT_MARGIN)));
        y = Math.max(VIEWPORT_MARGIN, Math.min(y, Math.max(VIEWPORT_MARGIN, vh - b.height - VIEWPORT_MARGIN)));
        layer.style.transform = `translate3d(${Math.round(x - origin.left)}px, ${Math.round(y - origin.top)}px, 0)`;
        layer.dataset.placement = placement;
        box.dataset.placement = placement;
    }

    private close(): void {
        this.clearOpen();
        this.clearClose();
        const trigger = this.openFor;
        this.openFor = null;
        this.hoveredTrigger = null;
        this.hoveringTip = false;
        if (trigger) {
            this.mark(trigger, false);
            this.releaseAuto(trigger);
            trigger.ownerDocument.removeEventListener('scroll', this.reposition, { capture: true } as EventListenerOptions);
            (trigger.ownerDocument.defaultView as Window | null)?.removeEventListener('resize', this.reposition);
        }
        if (this.box) {
            this.box.hidden = true;
            this.box.dataset.state = 'closed';
            // Rich tips are rebuilt per open, so nothing of a closed one stays in the tree.
            this.box.replaceChildren();
            this.box.textContent = '';
        }
    }

    private scheduleClose(delay: number): void {
        this.clearClose();
        if (delay <= 0) this.close();
        else this.closeTimer = setTimeout(() => this.close(), delay);
    }

    private clearOpen(): void {
        if (this.openTimer !== null) {
            clearTimeout(this.openTimer);
            this.openTimer = null;
        }
    }

    private clearClose(): void {
        if (this.closeTimer !== null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
}

const shared = new SharedTips();

/** Give a workspace's titled and icon-only buttons the shared tooltip without native duplicates. */
export function enableButtonTooltips(root: HTMLElement): () => void {
    return shared.enableButtons(root);
}

/**
 * Attach a tooltip to `trigger`. Costs one attribute on the trigger and one map entry: the
 * floating surface itself is the page's single shared one, built by the first open.
 */
export class Tooltip {
    constructor(
        private readonly trigger: HTMLElement,
        private readonly opts: TooltipOptions,
    ) {
        shared.register(trigger, opts);
    }

    setContent(content: TipContent): void {
        this.opts.content = content;
        shared.setContent(this.trigger, content);
    }

    destroy(): void {
        shared.unregister(this.trigger);
    }
}
