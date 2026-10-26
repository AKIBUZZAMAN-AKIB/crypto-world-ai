// The UI kit's view of the icon registry: the icons themselves are pure string data in
// `core/icons` (shared with the renderer's own chrome), and this module adds the one DOM
// helper the kit and the widget consume them through.

import { iconIdOf, iconMarkup } from '../core/icons';

export { iconIdOf, iconMarkup, registerIcon, svg16, svg24, svg24Solid } from '../core/icons';

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
function maskUri(raw: string): string {
    let svg = raw
        .replace(/\swidth="[^"]*"/, '') // mask-size owns the box; the viewBox keeps the shape
        .replace(/\sheight="[^"]*"/, '')
        // WHITE, not black: Chromium treats an SVG image used as a mask by its LUMINANCE, so
        // black shapes mask the element *out* completely. White is opaque under luminance
        // masking and fully opaque under alpha masking, so it is correct either way.
        .replace(/currentColor/g, '#fff');
    // A data-URI image is its own DOCUMENT: without the SVG namespace the browser cannot
    // decode it and the mask paints nothing (the icons are invisible, not merely unshaded).
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The shared sheet: base geometry once, then one mask rule per icon actually used. */
function ensureSheet(doc: Document): IconSheet {
    const found = sheets.get(doc);
    if (found && found.style.isConnected) return found;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
        '.vela-icon{width:1em;height:1em;flex:none;display:inline-flex;background-color:currentColor;' +
        '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain;' +
        '-webkit-mask-position:center;mask-position:center;}';
    (doc.head ?? doc.documentElement).appendChild(style);
    const sheet: IconSheet = { style, rules: new Map() };
    sheets.set(doc, sheet);
    return sheet;
}

/** One rule per icon id — shared by every instance of that icon. */
function addRule(sheet: IconSheet, id: string, uri: string): void {
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
    const raw = iconMarkup(id);
    if (raw) {
        addRule(ensureSheet(doc), id, maskUri(raw));
        span.classList.add(`vela-ic-${id}`);
    }
    return span;
}

/** The same masked glyph from raw `<svg>` markup, at an explicit pixel size — for the
 *  renderer's chrome, whose tool tables carry markup instead of registry ids. Markup that
 *  is not in the registry still paints (an inline mask) rather than falling back to nodes. */
export function iconGlyph(markup: string, size: number, doc: Document = document): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'vela-icon';
    span.setAttribute('aria-hidden', 'true');
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    const raw = markup.trim();
    if (!raw) return span;
    const sheet = ensureSheet(doc);
    const id = iconIdOf(raw);
    if (id) {
        addRule(sheet, id, maskUri(raw));
        span.classList.add(`vela-ic-${id}`);
        return span;
    }
    const uri = maskUri(raw);
    span.style.setProperty('-webkit-mask-image', uri);
    span.style.setProperty('mask-image', uri);
    return span;
}
