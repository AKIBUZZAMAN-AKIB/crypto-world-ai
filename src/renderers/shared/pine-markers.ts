// Pine marker series (`plotshape` / `plotchar` / `plotarrow`) — the glyphs a script stamps on
// a pane: an arrow hugging the bar, a circle/square/diamond/cross, or a TradingView-style text
// label (a rounded pill with a notch pointing at the anchor). `location.absolute` markers carry
// an exact price, so they land ON the series line rather than at the bar's edge.
//
// Pure canvas2d painting + measurement, shared across backends the same way trade-markers.ts is
// (the chrome canvas is always 2d) and node-testable: the caller supplies coordinate closures,
// no renderer types cross this boundary. Glyphs and text keep a FIXED pixel size at every zoom.
import type { MarkerPoint } from '../../core/model/series';

/** Chart-side resolvers the painter needs. All y values are PANE-RELATIVE pixels. */
export interface PineMarkerDeps {
    /** Marker time (ms) → x in CSS pixels. */
    xOf(time: number): number;
    /** Price → pane-relative y. */
    yOfPrice(price: number): number;
    /** Bar extremes at a time (pane-relative y), for the non-absolute locations. */
    barYAt(time: number): { high: number; low: number } | null;
    /** Pane-relative y of the pane's top/bottom edges — the ink clamp. */
    top: number;
    bottom: number;
    /** Width of the data area (markers never paint over the price scale). */
    width: number;
}

export interface PineMarkerStyle {
    fontSize: number;
    fontFamily: string;
    /** Ink for the label text when the marker carries no `textColor`. */
    textColor: string;
}

/** Marker glyphs are drawn in a fixed 1x pixel space; the caller pre-applies dpr scaling. */
const GLYPH = 9;

function sizeScale(size: MarkerPoint['size']): number {
    switch (size) {
        case 'tiny':
            return 0.62;
        case 'small':
            return 0.8;
        case 'large':
            return 1.3;
        case 'huge':
            return 1.65;
        default:
            return 1;
    }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * A TradingView label: the pill is centred on the anchor when the shape is `labelup`/`labeldown`
 * (the notch points at the anchor price), and stacked clear of the bar for the plain shapes.
 */
function paintLabel(
    ctx: CanvasRenderingContext2D,
    point: MarkerPoint,
    x: number,
    y: number,
    style: PineMarkerStyle,
    scale: number,
    upward: boolean,
): void {
    const text = point.text ?? '';
    const font = Math.max(7, Math.round((style.fontSize - 1) * scale));
    ctx.font = `600 ${font}px ${style.fontFamily}`;
    const padX = 5 * scale;
    const padY = 2.5 * scale;
    const notch = 4 * scale;
    const textW = text.length > 0 ? ctx.measureText(text).width : 0;
    const w = Math.max(12 * scale, textW + padX * 2);
    const h = Math.max(12 * scale, font + padY * 2);
    // The pill sits ABOVE the anchor for a label-up (its notch touches the price) and BELOW
    // for a label-down — TradingView anchors the tip, not the box centre.
    const boxTop = upward ? y - h - notch : y + notch;
    ctx.fillStyle = point.color;
    ctx.beginPath();
    ctx.moveTo(x, upward ? y : y);
    if (upward) {
        ctx.lineTo(x - notch, boxTop + h);
        ctx.lineTo(x + notch, boxTop + h);
    } else {
        ctx.lineTo(x - notch, boxTop);
        ctx.lineTo(x + notch, boxTop);
    }
    ctx.closePath();
    ctx.fill();
    roundRect(ctx, x - w / 2, boxTop, w, h, 2 * scale);
    ctx.fill();
    if (text.length > 0) {
        ctx.fillStyle = point.textColor ?? style.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, boxTop + h / 2 + 0.5);
    }
}

/** Paint one marker glyph at (x, y) — `y` is the anchor (price for absolute markers). */
function paintShape(
    ctx: CanvasRenderingContext2D,
    point: MarkerPoint,
    x: number,
    y: number,
    style: PineMarkerStyle,
    relative: 'above' | 'below' | 'in',
): void {
    const scale = sizeScale(point.size);
    const g = GLYPH * scale;
    ctx.fillStyle = point.color;
    ctx.strokeStyle = point.color;
    switch (point.shape) {
        case 'labelUp':
            paintLabel(ctx, point, x, y, style, scale, true);
            return;
        case 'labelDown':
            paintLabel(ctx, point, x, y, style, scale, false);
            return;
        case 'arrowUp': {
            ctx.beginPath();
            ctx.moveTo(x, y - g / 2);
            ctx.lineTo(x + g / 2, y + g / 2);
            ctx.lineTo(x - g / 2, y + g / 2);
            ctx.closePath();
            ctx.fill();
            return;
        }
        case 'arrowDown': {
            ctx.beginPath();
            ctx.moveTo(x, y + g / 2);
            ctx.lineTo(x + g / 2, y - g / 2);
            ctx.lineTo(x - g / 2, y - g / 2);
            ctx.closePath();
            ctx.fill();
            return;
        }
        case 'triangleUp':
        case 'triangleDown': {
            const s = g / 2;
            ctx.beginPath();
            if (point.shape === 'triangleUp') {
                ctx.moveTo(x, y - s);
                ctx.lineTo(x + s, y + s);
                ctx.lineTo(x - s, y + s);
            } else {
                ctx.moveTo(x, y + s);
                ctx.lineTo(x + s, y - s);
                ctx.lineTo(x - s, y - s);
            }
            ctx.closePath();
            ctx.fill();
            return;
        }
        case 'square':
            ctx.fillRect(x - g / 2, y - g / 2, g, g);
            return;
        case 'diamond': {
            const s = g / 2;
            ctx.beginPath();
            ctx.moveTo(x, y - s);
            ctx.lineTo(x + s, y);
            ctx.lineTo(x, y + s);
            ctx.lineTo(x - s, y);
            ctx.closePath();
            ctx.fill();
            return;
        }
        case 'cross': {
            const s = g / 2;
            ctx.lineWidth = Math.max(1.5, 1.6 * scale);
            ctx.beginPath();
            ctx.moveTo(x - s, y - s);
            ctx.lineTo(x + s, y + s);
            ctx.moveTo(x + s, y - s);
            ctx.lineTo(x - s, y + s);
            ctx.stroke();
            return;
        }
        case 'flag': {
            const s = g / 2;
            ctx.lineWidth = Math.max(1, scale);
            ctx.beginPath();
            ctx.moveTo(x - s, y + s);
            ctx.lineTo(x - s, y - s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - s, y - s);
            ctx.lineTo(x + s, y - s * 0.2);
            ctx.lineTo(x - s, y + s * 0.2);
            ctx.closePath();
            ctx.fill();
            return;
        }
        default: {
            ctx.beginPath();
            ctx.arc(x, y, g / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
    }
    void relative;
}

/**
 * Paint every `plotshape`/`plotchar`/`plotarrow` marker of ONE pane. Callers clip to the pane
 * before calling (the painter still clamps ink to `deps.top`/`deps.bottom` so a label anchored
 * on the pane's edge stays readable inside the plot).
 */
export function renderPineMarkers(
    ctx: CanvasRenderingContext2D,
    markers: readonly MarkerPoint[],
    deps: PineMarkerDeps,
    style: PineMarkerStyle,
): void {
    if (markers.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const point of markers) {
        const x = deps.xOf(point.time);
        if (x < -40 || x > deps.width + 40) continue;
        const bars = deps.barYAt(point.time);
        const hasPrice = typeof point.price === 'number' && Number.isFinite(point.price);
        let y: number;
        let relative: 'above' | 'below' | 'in';
        if (hasPrice) {
            y = deps.yOfPrice(point.price as number);
            relative = 'in';
        } else if (!bars) {
            continue;
        } else if (point.position === 'aboveBar') {
            y = bars.high - GLYPH * 0.75;
            relative = 'above';
        } else if (point.position === 'belowBar') {
            y = bars.low + GLYPH * 0.75;
            relative = 'below';
        } else {
            y = (bars.high + bars.low) / 2;
            relative = 'in';
        }
        // Clamp the ANCHOR into the pane so a label on the very edge still reads (TV scrolls
        // the same way); the pill itself may overhang by its own height, which is clipped.
        const inset = 2;
        if (y < deps.top + inset) y = deps.top + inset;
        if (y > deps.bottom - inset) y = deps.bottom - inset;
        paintShape(ctx, point, x, y, style, relative);
    }
    ctx.restore();
}
