// The UI kit's view of the icon registry: the icons themselves are pure string data in
// `core/icons` (shared with the renderer's own chrome), and this module adds the one DOM
// helper the kit and the widget consume them through.

import { iconIdOf, iconMarkup } from '../core/icons';

export { iconIdOf, iconIds, iconMarkup, registerIcon, svg16, svg24, svg24Solid } from '../core/icons';

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
    /** Whether the style element made it into the tree (a stub document has no head). */
    attached: boolean;
}
const sheets = new WeakMap<Document, IconSheet>();

/**
 * Drop DUPLICATED attributes from one tag, keeping the FIRST — which is exactly what the
 * HTML parser does with the inline markup the registry emits (`svg16`/`svg24` put an icon's
 * own attributes BEFORE the tier defaults on purpose, so `fill="currentColor"` wins over
 * `fill="none"`). A mask, though, is loaded as an XML DOCUMENT, and XML forbids the same
 * attribute twice: the image fails to decode and the glyph vanishes. That is how the kebab,
 * the code glyph and every other icon whose root overrides a tier default went blank.
 */
export function dedupeSvgAttrs(tag: string): string {
    const open = /^<([\w:-]+)([\s\S]*?)(\/?)>$/.exec(tag);
    if (!open) return tag; // a closing tag, a comment, a doctype — nothing to do
    const [, name, body, selfClose] = open;
    const seen = new Set<string>();
    const kept: string[] = [];
    const ATTR = /([\w:-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = ATTR.exec(body ?? '')) !== null) {
        const key = (m[1] ?? '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        kept.push(m[0].trim());
    }
    return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClose}>`;
}

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
    // …and it is parsed as XML, where a repeated attribute is a fatal error (see above).
    svg = svg.replace(/<[^>]+>/g, dedupeSvgAttrs);
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The shared sheet: base geometry once, then one mask rule per icon actually used. */
function ensureSheet(doc: Document): IconSheet {
    const found = sheets.get(doc);
    // A detached sheet is only rebuilt when it WAS attached and has since left the tree (a
    // re-render dropped it). A document with nowhere to put one — the stub document a unit
    // test hands in, with no <head> and no documentElement — keeps its sheet, so the rules
    // of every icon used keep accumulating instead of one sheet per icon.
    if (found && (!found.attached || found.style.isConnected)) return found;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    // No background here: an icon with NO mask (an unknown id) must paint nothing at all.
    // The paint is added per glyph, together with the mask (see withPaint).
    style.textContent =
        '.vela-icon{width:1em;height:1em;flex:none;display:inline-flex;' +
        '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain;' +
        '-webkit-mask-position:center;mask-position:center;}';
    const root = doc.head ?? doc.documentElement;
    if (root) root.appendChild(style);
    const sheet: IconSheet = { style, rules: new Map(), attached: !!root };
    sheets.set(doc, sheet);
    return sheet;
}

/** Add the per-icon class. Written against the two spellings of `classList` a document can
 *  hand back: the real one, and the shape a MINIMAL test stub returns (no classList at all —
 *  the widget suites stub the DOM down to `className` + a style bag). */
function addClass(span: HTMLElement, cls: string): void {
    const list = (span as Partial<HTMLElement>).classList;
    if (list) list.add(cls);
    else span.className = `${span.className} ${cls}`.trim();
}

/** Mask AND paint — the two always travel together (the paint is `currentColor`, which is
 *  what makes `color` tint a glyph and its transitions animate). */
function withPaint(span: HTMLElement): HTMLElement {
    if (span.style) span.style.backgroundColor = 'currentColor';
    return span;
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
        addClass(span, `vela-ic-${id}`);
        withPaint(span);
    }
    return span;
}

/** The same masked glyph from raw `<svg>` markup — or, just as often, straight from an icon
 *  ID — at an explicit pixel size. The renderer's chrome carries markup in its tool tables
 *  while the kit's callers hold ids; both land here, and an id is resolved through the
 *  registry. Markup that is not in the registry still paints (an inline mask), and anything
 *  that is neither is an empty span: a mask built from a NON-SVG string decodes to nothing,
 *  so the element would sit there invisible (that is exactly how the status line's market
 *  bubble lost its glyph). */
export function iconGlyph(markup: string, size: number, doc: Document = document): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'vela-icon';
    span.setAttribute('aria-hidden', 'true');
    if (span.style) {
        span.style.width = `${size}px`;
        span.style.height = `${size}px`;
    }
    let raw = markup.trim();
    if (raw && !raw.startsWith('<')) {
        const fromId = iconMarkup(raw);
        if (fromId) {
            addRule(ensureSheet(doc), raw, maskUri(fromId));
            addClass(span, `vela-ic-${raw}`);
            withPaint(span);
            return span;
        }
        raw = '';
    }
    if (!raw) return span;
    const sheet = ensureSheet(doc);
    const id = iconIdOf(raw);
    if (id) {
        addRule(sheet, id, maskUri(raw));
        addClass(span, `vela-ic-${id}`);
        return withPaint(span);
    }
    const uri = maskUri(raw);
    span.style?.setProperty('-webkit-mask-image', uri);
    span.style?.setProperty('mask-image', uri);
    return withPaint(span);
}
