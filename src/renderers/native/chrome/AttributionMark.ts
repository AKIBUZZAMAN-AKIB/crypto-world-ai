// Attribution seam — NEUTRALIZED build. The original shipped an in-chart brand mark
// (logo SVG + project link); this distribution renders nothing by default. The public
// surface is kept intact so call sites (NativeRenderer, VelaWorkspace) and host
// configuration (`attribution: false | '<html>'`) keep working unchanged:
//   - `createAttributionMark` returns an inert, invisible placeholder element.
//   - `createCustomMark` still lets a HOST supply its own branding markup.
// The upstream NOTICE file ships with this source tree and remains the governing
// attribution document for products that display charts rendered by this software.

import { isDarkColor } from '../../../core/color';

const STYLE_ID = 'vela-attribution-styles';

function ensureStyles(doc: Document): void {
    let s = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!s) {
        s = doc.createElement('style');
        s.id = STYLE_ID;
        doc.head.appendChild(s);
    }
    s.textContent = '';
}

/**
 * Ink switch for host-supplied marks — kept for `createCustomMark` callers.
 */
export function attributionMarkColor(background: string): string {
    return isDarkColor(background) ? '#ffffff' : '#000000';
}

/**
 * Re-ink hook kept for API compatibility (VelaWorkspace theme swaps call it). The
 * neutralized built-in placeholder carries no ink of its own, so this is a no-op
 * beyond what a custom mark needs.
 */
export function applyAttributionMarkTheme(el: HTMLElement, background: string): void {
    // No `classList` here: the node-test stubs provide `className` only.
    const cls = (el as { className?: unknown }).className;
    if (typeof cls === 'string' && cls.includes('vela-attribution-custom')) {
        el.style.color = attributionMarkColor(background);
    }
}

/**
 * Build a HOST-supplied mark for the same corner. The string is inserted as HTML inside a
 * positioned wrapper, so plain text renders as plain text and markup renders as markup —
 * it is DEVELOPER-supplied branding, never a place to pass user input through. The
 * wrapper carries no link and no theming of its own beyond the ink color, so the content
 * looks exactly as its author wrote it.
 */
export function createCustomMark(doc: Document, html: string, background: string): HTMLElement {
    const el = doc.createElement('div');
    el.className = 'vela-attribution-custom';
    Object.assign(el.style, {
        position: 'absolute',
        zIndex: '6',
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        lineHeight: '1',
    });
    el.style.color = attributionMarkColor(background);
    el.innerHTML = html;
    // A mark visible on screen belongs in the PNG export too — the renderer rasterizes
    // every `data-vela-screenshot` overlay (a hidden mark is skipped by the rasterizer).
    el.dataset.velaScreenshot = '1';
    return el;
}

/**
 * Build the built-in mark element. NEUTRALIZED: returns an inert placeholder with no
 * logo, no link, and no visible content — callers can append/remove/position it as
 * before without anything rendering.
 */
export function createAttributionMark(doc: Document, _background?: string): HTMLElement {
    ensureStyles(doc);
    const el = doc.createElement('div');
    el.className = 'vela-attribution';
    el.style.display = 'none';
    return el;
}
