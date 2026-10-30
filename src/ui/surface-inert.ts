// Modal surfaces must leave the page BEHIND them unreachable — not just dimmed.
//
// A sheet or dialog that only paints a scrim still lets a screen reader walk the chart
// underneath it and lets Tab land on a button the user cannot see (the scrim swallows the
// pointer, not the keyboard). The dialog pattern answers this with `inert` on everything
// outside the surface; that is what this module applies, host-agnostically:
//
//  · everything outside the surface's ANCESTOR PATH is inert, found by walking down from
//    `body` and, at each level, taking the siblings of the step that leads to the surface —
//    so a sheet mounted inside the chart's own `.vela-ui` host still takes the chart away,
//    not just its sibling panels;
//  · every element sibling of that root gets `inert` for as long as the surface is the
//    topmost one, and is restored exactly (an `inert` the HOST set is never removed);
//  · surfaces stack: closing the top re-applies the one beneath, closing the last
//    restores everything.
//
// Menus and popovers are deliberately excluded — they are non-modal by design, and
// inerting the page under a dropdown would break the very control that opened it.
import type { SurfaceKind } from './surface-events';

/** What we added to which element, per document — restore must not touch host-set inert. */
const applied = new WeakMap<Document, HTMLElement[]>();
/** The open modal surfaces, oldest first (the last one owns the isolation). */
const stacks = new WeakMap<Document, HTMLElement[]>();

const MODAL: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['dialog', 'drawer']);

function elementChildren(el: Element): HTMLElement[] {
    return Array.from(el.children).filter((c): c is HTMLElement => c instanceof (el.ownerDocument.defaultView?.HTMLElement ?? HTMLElement));
}

/** The chain body → … → `el` (exclusive of body), used to decide what lies OUTSIDE it. */
export function isolationPath(el: HTMLElement): HTMLElement[] {
    const path: HTMLElement[] = [];
    for (let node: HTMLElement | null = el; node && node !== el.ownerDocument.body; node = node.parentElement) path.unshift(node);
    return path;
}

/** Every element outside `surface`'s ancestor path — the set a modal must take away.
 *  PURE read of the tree; the caller owns what it does with the result. */
export function outsideNodes(surface: HTMLElement): HTMLElement[] {
    const path = isolationPath(surface);
    const doc = surface.ownerDocument;
    const out: HTMLElement[] = [];
    let siblings: HTMLElement[] = elementChildren(doc.body);
    for (const step of path) {
        for (const sibling of siblings) if (sibling !== step && !sibling.contains(surface)) out.push(sibling);
        siblings = elementChildren(step);
    }
    return out;
}

function restore(doc: Document): void {
    for (const el of applied.get(doc) ?? []) {
        el.removeAttribute('inert');
        el.removeAttribute('data-vela-inert');
    }
    applied.set(doc, []);
}

function isolate(doc: Document, surface: HTMLElement | null): void {
    restore(doc);
    if (!surface || !surface.isConnected) return;
    const touched: HTMLElement[] = [];
    for (const el of outsideNodes(surface)) {
        if (el.hasAttribute('inert')) continue; // the host already did it — leave it alone
        el.setAttribute('inert', '');
        el.setAttribute('data-vela-inert', '');
        touched.push(el);
    }
    applied.set(doc, touched);
}

/** Note that `surface` opened (or closed) and re-isolate the page around the topmost one. */
export function surfaceInert(surface: HTMLElement, open: boolean, kind: SurfaceKind): void {
    if (!MODAL.has(kind)) return;
    // A Zag dialog can be explicitly non-modal (e.g. live chart settings). Such a
    // floating card/pane must not inert the chart just because it has role="dialog".
    if (open && kind === 'dialog' && surface.getAttribute('aria-modal') === 'false') return;
    const doc = surface.ownerDocument;
    const stack = stacks.get(doc) ?? [];
    const at = stack.indexOf(surface);
    if (open) {
        if (at < 0) stack.push(surface);
    } else if (at >= 0) {
        stack.splice(at, 1);
    }
    stacks.set(doc, stack);
    // Drop surfaces that left the DOM (a dialog destroyed without its close event).
    while (stack.length > 0 && !stack[stack.length - 1]!.isConnected) stack.pop();
    isolate(doc, stack[stack.length - 1] ?? null);
}

/** Clear every isolation this module applied for a document (teardown / tests). */
export function releaseSurfaceInert(doc: Document): void {
    stacks.set(doc, []);
    restore(doc);
}
