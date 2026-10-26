// Best-effort SYNCHRONOUS rasterization of DOM chrome overlays for the PNG export —
// the indicator legend, a host status line, the symbol watermark. Screenshot export is
// a synchronous port (`screenshot(): string | null`), so a full HTML renderer is out of
// reach; what a chart overlay actually carries is text on (rounded) color chips, and
// that subset rasterizes faithfully with plain canvas calls:
//   - element backgrounds and borders (border-radius honored, '50%' reads as a circle),
//     plus `box-shadow` — outer rings sit BEHIND the fill, inset ones are drawn clipped to
//     the box (the legend's control cluster wears a 1px inset ring when it is out),
//   - text nodes in their computed font/color, at their measured on-screen rects,
//   - already-loaded <img>s (clipped by their radius) — but only when drawing them
//     leaves the canvas untainted: a cross-origin ticker icon must not poison the
//     whole export (`toDataURL` would throw at the end),
//   - inline SVG icons, through the geometry subset the icon registry actually uses
//     (path / circle / rect / line / polyline / polygon, fill + stroke from computed
//     style, so `currentColor` and inheritance resolve for free). Elements carrying a
//     `transform` are skipped — honest absence beats a wrongly placed glyph,
//   - MASKED icons (`.vela-icon`, the kit's whole icon story): the glyph is the mask's
//     alpha, so the export redraws the mask's own shapes in the element's colour instead
//     of filling its box — a plain background fill would have exported solid squares.

/** How the overlay's viewport coordinates map onto the export canvas. */
export interface OverlayRasterFrame {
    /** The canvas' top-left in viewport coordinates (the plot's bounding rect). */
    left: number;
    top: number;
    /** Device-pixel ratio of the export canvas (canvas px per CSS px). */
    dpr: number;
}

/** True when a computed color actually puts ink down (not transparent). */
function hasInk(color: string): boolean {
    if (!color || color === 'transparent') return false;
    const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(color);
    return m ? parseFloat(m[1]!) > 0.001 : true;
}

/** Uniform corner radius in px — '50%' (and any percentage) resolves against the box. */
function cornerRadius(cs: CSSStyleDeclaration, w: number, h: number): number {
    const raw = cs.borderTopLeftRadius;
    const v = parseFloat(raw) || 0;
    const px = raw.endsWith('%') ? (v / 100) * Math.min(w, h) : v;
    return Math.max(0, Math.min(px, Math.min(w, h) / 2));
}

/** Trace a rounded rect (falls back to a plain rect where roundRect is missing). */
function tracePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

interface CanvasShadow {
    inset: boolean;
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: string;
}

/** A computed `box-shadow` list, split on its TOP-LEVEL commas (colours carry commas). */
function boxShadows(cs: CSSStyleDeclaration): CanvasShadow[] {
    const raw = (cs.boxShadow ?? '').trim();
    if (!raw || raw === 'none') return [];
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]!;
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            parts.push(raw.slice(from, i));
            from = i + 1;
        }
    }
    parts.push(raw.slice(from));
    const out: CanvasShadow[] = [];
    for (const part of parts) {
        const inset = /(^|\s)inset(\s|$)/.test(part);
        const color = /(rgba?\([^)]*\)|#[\da-f]{3,8}|\b(?:transparent|currentColor)\b)/i.exec(part)?.[0] ?? '';
        if (!color || !hasInk(color)) continue;
        const nums = (part.replace(color, '').match(/-?[\d.]+px/g) ?? []).map((v) => parseFloat(v));
        const [x = 0, y = 0, blur = 0, spread = 0] = nums;
        out.push({ inset, x, y, blur: Math.max(0, blur), spread, color });
    }
    return out;
}

/** Paint one element's `box-shadow` list. Outer shadows land BEFORE the fill (they sit
 *  behind it), inset ones clip to the box and ride on top — the same order the browser
 *  paints them, so a ring reads as a ring and not as a second border. */
function paintShadows(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    shadows: CanvasShadow[],
    alpha: number,
    phase: 'outer' | 'inset',
): void {
    for (const sh of shadows) {
        if (sh.inset !== (phase === 'inset')) continue;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (phase === 'outer') {
            // Clip OUT the element's own box: the caster is the box, so only the halo it
            // throws survives — an opaque box fill would otherwise paint the shadow over
            // the very thing it belongs to.
            if (typeof ctx.clip === 'function' && typeof ctx.roundRect === 'function') {
                const both = new Path2D();
                both.rect(x - 400, y - 400, w + 800, h + 800);
                if (radius > 0) both.roundRect(x, y, w, h, radius);
                else both.rect(x, y, w, h);
                try {
                    ctx.clip(both, 'evenodd');
                } catch {
                    /* an engine without the fill-rule form: draw the halo unclipped */
                }
            }
            ctx.shadowColor = sh.color;
            ctx.shadowBlur = sh.blur;
            ctx.shadowOffsetX = sh.x;
            ctx.shadowOffsetY = sh.y;
            ctx.fillStyle = sh.color;
            tracePath(ctx, x + sh.x - sh.spread, y + sh.y - sh.spread, w + sh.spread * 2, h + sh.spread * 2, Math.max(0, radius + sh.spread));
            ctx.fill();
        } else {
            tracePath(ctx, x, y, w, h, radius);
            ctx.clip();
            ctx.shadowColor = sh.color;
            ctx.shadowBlur = sh.blur;
            ctx.shadowOffsetX = sh.x;
            ctx.shadowOffsetY = sh.y;
            ctx.strokeStyle = sh.color;
            // `inset 0 0 0 1px` is a 1px ring just inside the border box. The clip already
            // cut away anything outside it, so stroking a path inset by half the band puts
            // the ink on 0..1px — where the browser paints it — instead of straddling the edge.
            const band = Math.max(sh.spread, 1);
            const edge = band / 2 + (sh.blur > 0 ? sh.blur / 2 : 0);
            ctx.lineWidth = band;
            tracePath(ctx, x + edge, y + edge, w - edge * 2, h - edge * 2, Math.max(0, radius - edge));
            ctx.stroke();
        }
        ctx.restore();
    }
}

/** Probe-draw on a throwaway canvas: a cross-origin image without CORS taints whatever
 *  it lands on, and `toDataURL` then throws for the WHOLE export — test it in isolation. */
function canDrawUntainted(img: HTMLImageElement): boolean {
    try {
        const probe = img.ownerDocument.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const ctx = probe.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0, 1, 1);
        probe.toDataURL();
        return true;
    } catch {
        return false;
    }
}

/** The SVG behind a masked element's `mask-image`, decoded — or null. */
function maskSvg(el: HTMLElement, cs: CSSStyleDeclaration): string | null {
    const raw = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : (cs as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage ?? 'none';
    const m = /url\(\s*["']?data:image\/svg\+xml,([^"')]+)["']?\s*\)/.exec(raw);
    if (!m) return null;
    try {
        const svg = decodeURIComponent(m[1]!);
        return svg.includes('<svg') ? svg : null;
    } catch {
        return null;
    }
}

/** Paint a masked element's glyph: the mask's shapes, in the element's `color`. */
function drawMaskGlyph(ctx: CanvasRenderingContext2D, el: HTMLElement, cs: CSSStyleDeclaration, rect: DOMRect, frame: OverlayRasterFrame, alpha: number): void {
    const markup = maskSvg(el, cs);
    if (!markup) return;
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    if (!parsed || parsed.nodeName.toLowerCase() !== 'svg') return;
    const vb = (parsed.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const vx = vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? vb[0]! : 0;
    const vy = vb.length === 4 ? vb[1]! : 0;
    const vw = vb.length === 4 && vb[2]! > 0 ? vb[2]! : rect.width;
    const vh = vb.length === 4 && vb[3]! > 0 ? vb[3]! : rect.height;
    // A mask token is an alpha silhouette: whatever colour it names, the export paints the
    // element's own `color` (that is what `background-color: currentColor` does on screen).
    const ink = cs.color;
    const resolve = (name: string): string | null => {
        const v = (name || '').trim();
        if (!v || v === 'none') return null;
        if (v === 'currentColor' || /^#(fff|ffffff)$/i.test(v) || v === 'white') return ink;
        return v;
    };
    const strokeOf = (node: Element, inherited: { stroke: string | null; width: number; cap: CanvasLineCap; join: CanvasLineJoin; fill: string | null }) => ({
        fill: resolve(node.getAttribute('fill') ?? '') ?? (node.hasAttribute('fill') ? null : inherited.fill),
        stroke: resolve(node.getAttribute('stroke') ?? '') ?? (node.hasAttribute('stroke') ? null : inherited.stroke),
        width: node.hasAttribute('stroke-width') ? parseFloat(node.getAttribute('stroke-width') ?? '0') || 0 : inherited.width,
        cap: (node.getAttribute('stroke-linecap') as CanvasLineCap | null) ?? inherited.cap,
        join: (node.getAttribute('stroke-linejoin') as CanvasLineJoin | null) ?? inherited.join,
    });
    const rootStyle = strokeOf(parsed, { stroke: ink, width: 1, cap: 'butt', join: 'miter', fill: null });

    const walk = (parent: Element, inherited: typeof rootStyle): void => {
        for (const node of parent.children) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'g') {
                walk(node, strokeOf(node, inherited));
                continue;
            }
            const num = (name: string): number => parseFloat(node.getAttribute(name) ?? '0') || 0;
            let path: Path2D | null = null;
            if (tag === 'path') {
                const d = node.getAttribute('d');
                if (d) path = new Path2D(d);
            } else if (tag === 'circle') {
                path = new Path2D();
                path.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2);
            } else if (tag === 'ellipse') {
                path = new Path2D();
                path.ellipse(num('cx'), num('cy'), num('rx'), num('ry'), 0, 0, Math.PI * 2);
            } else if (tag === 'rect') {
                path = new Path2D();
                path.rect(num('x'), num('y'), num('width'), num('height'));
            } else if (tag === 'line') {
                path = new Path2D();
                path.moveTo(num('x1'), num('y1'));
                path.lineTo(num('x2'), num('y2'));
            } else if (tag === 'polyline' || tag === 'polygon') {
                const pts = (node.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
                if (pts.length < 4 || pts.some(Number.isNaN)) continue;
                path = new Path2D();
                path.moveTo(pts[0]!, pts[1]!);
                for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i]!, pts[i + 1]!);
                if (tag === 'polygon') path.closePath();
            }
            if (!path) continue;
            const own = strokeOf(node, inherited);
            if (own.fill) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = own.fill;
                ctx.fill(path);
            }
            if (own.stroke && own.width > 0) {
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = own.stroke;
                ctx.lineWidth = own.width;
                ctx.lineCap = own.cap;
                ctx.lineJoin = own.join;
                ctx.stroke(path);
            }
        }
    };

    ctx.save();
    ctx.translate(rect.left - frame.left, rect.top - frame.top);
    ctx.scale(rect.width / vw, rect.height / vh);
    ctx.translate(-vx, -vy);
    walk(parsed, rootStyle);
    ctx.restore();
}

/**
 * Draw `root`'s subtree onto `ctx`. Coordinates come from live layout
 * (`getBoundingClientRect`), so what lands on the canvas is what is on screen —
 * hidden segments (`display:none`), folded legend rows and zero-size boxes are
 * skipped, and subtree opacity multiplies down (the 5%-alpha watermark stays 5%).
 */
export function rasterizeOverlay(ctx: CanvasRenderingContext2D, root: Element, frame: OverlayRasterFrame): void {
    const win = root.ownerDocument.defaultView;
    if (!win) return;
    ctx.save();
    ctx.scale(frame.dpr, frame.dpr);

    const drawText = (node: Text, cs: CSSStyleDeclaration, alpha: number): void => {
        const text = node.textContent?.replace(/\s+/g, ' ').trim();
        if (!text) return;
        const range = node.ownerDocument.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = cs.color;
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, r.left - frame.left, r.top - frame.top + r.height / 2);
    };

    const drawImg = (img: HTMLImageElement, cs: CSSStyleDeclaration, alpha: number): void => {
        if (!img.complete || img.naturalWidth <= 0 || !canDrawUntainted(img)) return;
        const r = img.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const x = r.left - frame.left;
        const y = r.top - frame.top;
        ctx.save();
        ctx.globalAlpha = alpha;
        tracePath(ctx, x, y, r.width, r.height, cornerRadius(cs, r.width, r.height));
        ctx.clip();
        ctx.drawImage(img, x, y, r.width, r.height);
        ctx.restore();
    };

    const drawSvgShapes = (parent: Element, alpha: number): void => {
        for (const el of parent.children) {
            if (el.hasAttribute('transform')) continue;
            const tag = el.tagName.toLowerCase();
            if (tag === 'g') {
                drawSvgShapes(el, alpha);
                continue;
            }
            const num = (name: string): number => parseFloat(el.getAttribute(name) ?? '0') || 0;
            let path: Path2D | null = null;
            if (tag === 'path') {
                const d = el.getAttribute('d');
                if (d) path = new Path2D(d);
            } else if (tag === 'circle') {
                path = new Path2D();
                path.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2);
            } else if (tag === 'ellipse') {
                path = new Path2D();
                path.ellipse(num('cx'), num('cy'), num('rx'), num('ry'), 0, 0, Math.PI * 2);
            } else if (tag === 'rect') {
                path = new Path2D();
                path.rect(num('x'), num('y'), num('width'), num('height'));
            } else if (tag === 'line') {
                path = new Path2D();
                path.moveTo(num('x1'), num('y1'));
                path.lineTo(num('x2'), num('y2'));
            } else if (tag === 'polyline' || tag === 'polygon') {
                const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
                if (pts.length < 4 || pts.some(Number.isNaN)) continue;
                path = new Path2D();
                path.moveTo(pts[0]!, pts[1]!);
                for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i]!, pts[i + 1]!);
                if (tag === 'polygon') path.closePath();
            }
            if (!path) continue;
            const cs = win.getComputedStyle(el);
            if (cs.fill && cs.fill !== 'none' && hasInk(cs.fill)) {
                ctx.globalAlpha = alpha * (parseFloat(cs.fillOpacity) || 1);
                ctx.fillStyle = cs.fill;
                ctx.fill(path);
            }
            const sw = parseFloat(cs.strokeWidth) || 0;
            if (cs.stroke && cs.stroke !== 'none' && hasInk(cs.stroke) && sw > 0) {
                ctx.globalAlpha = alpha * (parseFloat(cs.strokeOpacity) || 1);
                ctx.strokeStyle = cs.stroke;
                ctx.lineWidth = sw;
                if (cs.strokeLinecap === 'round' || cs.strokeLinecap === 'square' || cs.strokeLinecap === 'butt') ctx.lineCap = cs.strokeLinecap;
                if (cs.strokeLinejoin === 'round' || cs.strokeLinejoin === 'bevel' || cs.strokeLinejoin === 'miter') ctx.lineJoin = cs.strokeLinejoin;
                ctx.stroke(path);
            }
        }
    };

    const drawSvg = (svg: SVGSVGElement, parentAlpha: number): void => {
        const r = svg.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const cs = win.getComputedStyle(svg);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const alpha = parentAlpha * (parseFloat(cs.opacity) || 1);
        if (alpha <= 0.001) return;
        const vb = svg.viewBox.baseVal;
        const vw = vb && vb.width > 0 ? vb.width : r.width;
        const vh = vb && vb.height > 0 ? vb.height : r.height;
        ctx.save();
        ctx.translate(r.left - frame.left, r.top - frame.top);
        ctx.scale(r.width / vw, r.height / vh);
        if (vb) ctx.translate(-vb.x, -vb.y);
        drawSvgShapes(svg, alpha);
        ctx.restore();
    };

    const drawElement = (el: HTMLElement, parentAlpha: number): void => {
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const alpha = parentAlpha * (parseFloat(cs.opacity) || 1);
        if (alpha <= 0.001) return;
        const r = el.getBoundingClientRect();
        // A masked icon paints its GLYPH: the box's background is the mask's paint on
        // screen, and filling it here would export a solid square.
        const masked = el.classList.contains('vela-icon') && maskSvg(el, cs) !== null;
        if (masked && r.width > 0 && r.height > 0) {
            drawMaskGlyph(ctx, el, cs, r, frame, alpha);
            return;
        }
        if (r.width > 0 && r.height > 0) {
            const x = r.left - frame.left;
            const y = r.top - frame.top;
            const radius = cornerRadius(cs, r.width, r.height);
            const shadows = boxShadows(cs);
            if (shadows.length > 0) paintShadows(ctx, x, y, r.width, r.height, radius, shadows, alpha, 'outer');
            if (hasInk(cs.backgroundColor)) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = cs.backgroundColor;
                tracePath(ctx, x, y, r.width, r.height, radius);
                ctx.fill();
            }
            const bw = parseFloat(cs.borderTopWidth) || 0;
            if (bw > 0 && cs.borderTopStyle !== 'none' && hasInk(cs.borderTopColor)) {
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = cs.borderTopColor;
                ctx.lineWidth = bw;
                tracePath(ctx, x + bw / 2, y + bw / 2, r.width - bw, r.height - bw, Math.max(0, radius - bw / 2));
                ctx.stroke();
            }
            // Inset rings ride ON TOP of the fill — the browser paints them last too.
            if (shadows.length > 0) paintShadows(ctx, x, y, r.width, r.height, radius, shadows, alpha, 'inset');
        }
        for (const child of el.childNodes) {
            if (child.nodeType === 3) drawText(child as Text, cs, alpha);
            else if (child instanceof win.HTMLImageElement) drawImg(child, win.getComputedStyle(child), alpha);
            else if (child instanceof win.SVGSVGElement) drawSvg(child, alpha);
            else if (child instanceof win.HTMLElement) drawElement(child, alpha);
        }
    };

    if (root instanceof win.HTMLElement) drawElement(root, 1);
    ctx.restore();
}
