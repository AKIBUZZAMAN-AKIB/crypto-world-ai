// The UI kit's view of the icon registry: the icons themselves are pure string data in
// `core/icons` (shared with the renderer's own chrome), and this module adds the one DOM
// helper the kit and the widget consume them through.

import { iconMarkup } from '../core/icons';

export { iconMarkup, registerIcon, svg16, svg24, svg24Solid } from '../core/icons';

// AN ICON IS A COLOUR, NOT A DRAWING.
//
// The glyph is painted as a CSS mask: the element carries no SVG children at all, and the
// shape lives in one shared stylesheet rule per icon id (`.vela-ic-<id>`). The old span
// wrapped an inline `<svg>` with one to four shapes inside it, so a single 16px chevron cost
// the document three or four nodes and the top bar paid 60 of them. A mask is exactly the
// same drawing — the SVG is the same markup, used as the mask's alpha — but the instance is
// ONE element, its colour is `background-color: currentColor` (so `color` transitions and
// `color: var(--…-muted)` still tint it), and every instance of an icon shares a single rule.
//
// `-webkit-` duplicates are kept beside the standard properties for older Safari.

const STYLE_ID = 'vela-icon-styles';
interface IconSheet {
    style: HTMLStyleElement;
    rules: Map<string, string>;
}
const sheets = new WeakMap<Document, IconSheet>();

/** The icon's markup as a data URI: sized by `mask-size`, painted by its own alpha. */
function maskUri(id: string): string | null {
    const raw = iconMarkup(id);
    if (!raw) return null;
    const svg = raw
        .replace(/\swidth="[^"]*"/, '') // mask-size owns the box; the viewBox keeps the shape
        .replace(/\sheight="[^"]*"/, '')
        .replace(/currentColor/g, '#000'); // a mask reads alpha only — the token must resolve
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The shared sheet: base geometry once, then one mask rule per icon actually used. */
function ensureSheet(doc: Document, id: string, uri: string): void {
    let sheet = sheets.get(doc);
    if (!sheet || !sheet.style.isConnected) {
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.vela-icon{width:1em;height:1em;flex:none;display:inline-flex;background-color:currentColor;' +
            '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain;' +
            '-webkit-mask-position:center;mask-position:center;}';
        (doc.head ?? doc.documentElement).appendChild(style);
        sheet = { style, rules: new Map() };
        sheets.set(doc, sheet);
    }
    if (sheet.rules.has(id)) return;
    const rule = `.vela-ic-${id}{-webkit-mask-image:${uri};mask-image:${uri}}`;
    sheet.rules.set(id, rule);
    sheet.style.textContent = sheet.style.textContent + rule;
}

/** A ready-to-insert element rendering the icon (an empty span when the id is unknown). */
export function iconEl(id: string, doc: Document = document): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'vela-icon';
    span.setAttribute('aria-hidden', 'true');
    const uri = maskUri(id);
    if (uri) {
        ensureSheet(doc, id, uri);
        span.classList.add(`vela-ic-${id}`);
    }
    return span;
}
