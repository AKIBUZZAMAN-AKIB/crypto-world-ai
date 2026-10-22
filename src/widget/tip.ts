// A one-time coach mark — the small "by the way" card a new affordance gets.
//
// WHY NOT A TOOLTIP: a tooltip is a *hover* answer to "what is this?" and vanishes the
// moment the pointer moves. A coach mark is the opposite — it is shown unbidden, once,
// and waits. So this is its own tiny component: portalled into <body> (a chart cell
// clips its own overflow), pinned to an anchor's live rect, and dismissed by the three
// things a user actually does: press the ×, press Escape, or press the thing it points
// at.
//
// RESEARCH NOTES
//   • ARIA: `role="note"` would be the obvious fit — and it is wrong HERE, because
//     WAI-ARIA 1.3 says a note carrying interactive content (our close button) should
//     use a different structure. A NON-MODAL dialog is the accurate container: it names
//     itself, it is allowed to hold a button, and — unlike a modal dialog — it must NOT
//     move focus or trap it (the card appears unbidden, so stealing focus would be
//     hostile). `aria-modal="false"` says exactly that; the element is still reachable
//     by Tab, so a screen-reader user meets the note and its × in the normal order.
//     Nothing is announced on arrival: an aria-live region that fires on load is noise
//     for someone whose focus is elsewhere.
//   • Positioning: prefer above the anchor (status-line badges live at the bottom of a
//     chart, so below would fall off the cell), flip when there is no room, then clamp
//     inside the viewport — the same ladder the popover clamp uses.
//   • Motion: 120 ms fade/rise, cancelled entirely under `prefers-reduced-motion`
//     (2.3.3 — motion that comes from an interaction must be disableable).

import { injectStyles } from '../ui/styles';
import { prefersReducedMotion } from '../ui/motion';

const STYLE_ID = 'vela-widget-tip-v1';

const CSS = `
.vela-tip {
    position: fixed;
    z-index: 2147482000;
    max-width: 264px;
    padding: 10px 12px;
    border-radius: 10px;
    /* Theme tokens that EXIST (an undefined custom property is not a fallback — the
       declaration is dropped and the card renders as a white box on a dark chart). */
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    box-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3);
    font: 500 12px/1.45 var(--vela-font, system-ui, -apple-system, 'Segoe UI', sans-serif);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: start;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 120ms ease, transform 120ms ease;
    /* The card floats OVER the thing it explains, and on a phone there is nowhere else to
       put it: a 264px card over a 41px chip covers it. The card is therefore transparent to
       the pointer — a press lands on the chip, which is exactly the action the hint is
       asking for (and which dismisses it, see the anchor's pointerdown). Only the close
       button takes input, so the hint is still dismissible by thumb. */
    pointer-events: none;
}
.vela-tip[data-in] { opacity: 1; transform: none; }
.vela-tip-arrow {
    position: fixed;
    pointer-events: none;
    z-index: 2147481999;
    width: 9px;
    height: 9px;
    background: var(--vela-surface-elev);
    border-right: 1px solid var(--vela-border-strong);
    border-bottom: 1px solid var(--vela-border);
    transform: rotate(45deg);
    opacity: 0;
    transition: opacity 120ms ease;
}
.vela-tip-arrow[data-in] { opacity: 1; }
.vela-tip-text { margin: 0; }
.vela-tip-key {
    display: inline-block;
    margin: 0 2px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--vela-surface-sunken);
    border: 1px solid var(--vela-border);
    font-weight: 600;
}
.vela-tip-x {
    all: unset;
    pointer-events: auto;
    box-sizing: border-box;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    margin: -2px -4px 0 0;
}
.vela-tip-x:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-tip-x:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
    .vela-tip, .vela-tip-arrow { transition: none; transform: none; }
}
`;

export type TipPlacement = 'top' | 'bottom';

export interface TipOptions {
    /** What the card points at. Its live rect is read on every reposition. */
    anchor: HTMLElement;
    /** Plain text, or a DocumentFragment for rich content (the caller owns the nodes). */
    content: string | Node;
    /** Called once — by the ×, by Escape, or by the anchor being pressed. */
    onDismiss: () => void;
    placement?: TipPlacement;
    /** Root to inject the sheet into (Shadow DOM hosts pass their root). */
    root?: Document | ShadowRoot;
}

const GAP = 10;
const MARGIN = 8;

/** The theme custom properties the card's sheet reads. Copied from the widget root because
 *  the card lives outside it (one `getComputedStyle` per show, not per token). */
const TIP_TOKENS = [
    '--vela-surface-elev',
    '--vela-surface-sunken',
    '--vela-fg',
    '--vela-fg-muted',
    '--vela-fg-bright',
    '--vela-border',
    '--vela-border-strong',
    '--vela-hover-strong',
    '--vela-focus',
    '--vela-font',
    '--vela-radius-md',
] as const;

/**
 * Show a coach mark. The returned handle can be dismissed programmatically (after the
 * user performs the action the tip was asking for) and is safe to call twice.
 */
export class Tip {
    readonly el: HTMLDivElement;
    private readonly arrow: HTMLDivElement;
    private readonly anchor: HTMLElement;
    private readonly onDismiss: () => void;
    private readonly doc: Document;
    private readonly win: Window | null;
    private placement: TipPlacement;
    private frame = 0;
    private gone = false;
    private readonly cleanups: Array<() => void> = [];

    constructor(opts: TipOptions) {
        this.anchor = opts.anchor;
        this.onDismiss = opts.onDismiss;
        this.placement = opts.placement ?? 'top';
        this.doc = opts.anchor.ownerDocument;
        this.win = this.doc.defaultView;
        injectStyles(STYLE_ID, CSS, opts.root ?? this.doc);

        const doc = this.doc;
        this.el = doc.createElement('div');
        // `vela-ui-layer` carries the kit's static tokens; the THEME tokens are inline on the
        // widget root, so they have to be copied across the portal (see copyTokens).
        this.el.className = 'vela-tip vela-ui-layer';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-modal', 'false');
        this.el.setAttribute('aria-label', 'Hint');

        const text = doc.createElement('div');
        text.className = 'vela-tip-text';
        if (typeof opts.content === 'string') text.textContent = opts.content;
        else text.appendChild(opts.content);
        this.el.appendChild(text);

        const x = doc.createElement('button');
        x.type = 'button';
        x.className = 'vela-tip-x';
        x.setAttribute('aria-label', 'Dismiss hint');
        x.innerHTML =
            '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dismiss();
        });
        this.el.appendChild(x);

        this.arrow = doc.createElement('div');
        this.arrow.className = 'vela-tip-arrow vela-ui-layer';
        this.arrow.setAttribute('aria-hidden', 'true');

        // THE BUG THIS FIXES: the card is portalled into <body>, but the theme's custom
        // properties live as inline styles on the `.vela-ui` root. At body level every
        // `var(--vela-surface-elev)` resolved to nothing, the declarations were dropped, and
        // the coach mark rendered as black text with a transparent background — invisible on
        // a dark chart (measured: `background: rgba(0,0,0,0)`, `color: rgb(0,0,0)`).
        this.copyTokens();

        doc.body.appendChild(this.arrow);
        doc.body.appendChild(this.el);

        // The anchor being pressed is the strongest possible "I have read it": on a chip
        // the press is what the tip was asking for. Capture, so it fires before the
        // action it triggers.
        const onAnchorDown = (): void => this.dismiss();
        this.anchor.addEventListener('pointerdown', onAnchorDown, { capture: true });
        this.cleanups.push(() => this.anchor.removeEventListener('pointerdown', onAnchorDown, { capture: true }));

        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.dismiss();
            }
        };
        doc.addEventListener('keydown', onKey, { capture: true });
        this.cleanups.push(() => doc.removeEventListener('keydown', onKey, { capture: true }));

        // Reposition is cheap but reads layout; coalesce to one per frame, and only while
        // something that can move the anchor happens.
        const schedule = (): void => this.schedulePosition();
        this.doc.addEventListener('scroll', schedule, { capture: true, passive: true });
        this.cleanups.push(() => this.doc.removeEventListener('scroll', schedule, { capture: true }));
        if (this.win) {
            this.win.addEventListener('resize', schedule, { passive: true });
            this.cleanups.push(() => this.win?.removeEventListener('resize', schedule));
        }

        this.position();
        if (this.win?.requestAnimationFrame && !prefersReducedMotion()) {
            this.frame = this.win.requestAnimationFrame(() => {
                this.el.dataset.in = '';
                this.arrow.dataset.in = '';
            });
        } else {
            this.el.dataset.in = '';
            this.arrow.dataset.in = '';
        }
    }

    /** Carry the theme across the portal: the widget root's custom properties onto both
     *  floating nodes. Missing host (a tip anchored outside a kit root) is fine — the sheet's
     *  own fallbacks take over, which is the pre-existing behaviour for generic anchors. */
    private copyTokens(): void {
        const host = this.anchor.closest('.vela-ui') as HTMLElement | null;
        const win = this.win;
        if (!host || !win) return;
        const cs = win.getComputedStyle(host);
        for (const key of TIP_TOKENS) {
            const value = cs.getPropertyValue(key).trim();
            if (value === '') continue;
            this.el.style.setProperty(key, value);
            this.arrow.style.setProperty(key, value);
        }
    }

    /** Hide it now. Idempotent; `onDismiss` runs exactly once. */
    dismiss(): void {
        if (this.gone) return;
        this.gone = true;
        if (this.frame) this.win?.cancelAnimationFrame(this.frame);
        for (const off of this.cleanups.splice(0)) off();
        this.el.remove();
        this.arrow.remove();
        this.onDismiss();
    }

    /** Re-measure and re-place (call after the anchor moved for a reason we do not hear). */
    reposition(): void {
        this.position();
    }

    private schedulePosition(): void {
        if (this.gone || this.frame !== 0) return;
        const raf = this.win?.requestAnimationFrame;
        if (!raf) {
            this.position();
            return;
        }
        this.frame = this.win!.requestAnimationFrame(() => {
            this.frame = 0;
            if (!this.gone) this.position();
        });
    }

    private position(): void {
        const win = this.win;
        if (!win) return;
        const a = this.anchor.getBoundingClientRect();
        // Hidden anchor (collapsed cell, closed sheet): nothing to point at.
        if (a.width === 0 && a.height === 0) {
            this.el.style.visibility = 'hidden';
            this.arrow.style.visibility = 'hidden';
            return;
        }
        this.el.style.visibility = '';
        this.arrow.style.visibility = '';
        const vw = win.innerWidth;
        const vh = win.innerHeight;
        const w = this.el.offsetWidth || 240;
        const h = this.el.offsetHeight || 56;
        const roomAbove = a.top;
        const roomBelow = vh - a.bottom;
        // Prefer the requested side, but only when it actually FITS. The old ladder compared
        // "which side is roomier" and then clamped into the viewport, which on a phone pushed
        // the card straight back over its own anchor (measured: card at top 8, anchor at 40).
        const fits = (side: TipPlacement): boolean => (side === 'top' ? roomAbove >= h + GAP : roomBelow >= h + GAP);
        let place = this.placement;
        if (!fits(place)) {
            const other: TipPlacement = place === 'top' ? 'bottom' : 'top';
            place = fits(other) ? other : roomAbove >= roomBelow ? 'top' : 'bottom';
        }
        this.el.dataset.place = place;

        let top = place === 'top' ? a.top - h - GAP : a.bottom + GAP;
        top = Math.max(MARGIN, Math.min(vh - h - MARGIN, top));
        // Horizontally centred on the anchor, then clamped into the viewport.
        let left = a.left + a.width / 2 - w / 2;
        left = Math.max(MARGIN, Math.min(vw - w - MARGIN, left));
        // Neither side had room and the clamp put the card on top of the anchor: step to the
        // RIGHT of it (or the left, when that is the roomier side) so the thing being explained
        // stays visible. The card is pointer-transparent either way — this is about reading it.
        const covers = (l: number): boolean => !(l + w <= a.left || l >= a.right || top + h <= a.top || top >= a.bottom);
        if (covers(left)) {
            const rightRoom = vw - a.right - GAP - MARGIN;
            const leftRoom = a.left - GAP - MARGIN;
            if (rightRoom >= w) left = a.right + GAP;
            else if (leftRoom >= w) left = a.left - GAP - w;
        }
        this.el.style.left = `${Math.round(left)}px`;
        this.el.style.top = `${Math.round(top)}px`;

        // Arrow: on the anchor's centre, clamped to the card's own rounded body, and on
        // the side that faces the anchor.
        const cx = Math.max(left + 14, Math.min(left + w - 14, a.left + a.width / 2));
        const ay = place === 'top' ? Math.round(top + h - 4) : Math.round(top - 5);
        this.arrow.style.left = `${Math.round(cx - 4.5)}px`;
        this.arrow.style.top = `${ay}px`;
    }
}
