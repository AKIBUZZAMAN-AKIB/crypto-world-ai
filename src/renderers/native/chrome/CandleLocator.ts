import type { OHLCV } from '../../../core/model/ohlcv';
import type { VelaTheme } from '../../../core/options';
import { isDarkColor, parseRgb, withAlpha } from '../../../core/color';
import { prefersReducedMotion } from '../../../ui/motion';
import type { CoordinateSystem } from '../core/CoordinateSystem';

/** Resolve only a real displayed bar; never extrapolate into unloaded or replay-hidden data. */
export function displayedCandleIndex(bars: readonly OHLCV[], timestamp: number, newestOffset: number): number {
    if (!Number.isFinite(timestamp)) return -1;
    const hint = bars.length - 1 - newestOffset;
    if (Number.isInteger(hint) && hint >= 0 && bars[hint]?.time === timestamp) return hint;
    // A new live bar may have shifted the newest-first row index since the table painted.
    let lo = 0;
    let hi = bars.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (bars[mid]!.time < timestamp) lo = mid + 1;
        else hi = mid;
    }
    return bars[lo]?.time === timestamp ? lo : -1;
}

/**
 * A disposable, pointer-transparent background wash below every candle/drawing layer.
 * It is deliberately separate from the host's persisted highlight bands. Geometry is
 * refreshed on normal chart frames; opacity is composited by CSS, so the brief fade
 * does not keep the renderer repainting an otherwise idle chart.
 */
export class CandleLocator {
    private root: HTMLDivElement | null = null;
    private band: HTMLDivElement | null = null;
    private timestamp = 0;
    private index = -1;
    private active = false;
    private moving = false;
    private reduced = false;
    private frameHandle: number | null = null;
    private readonly timers = new Set<number>();
    private color = '';
    private readonly win: Window | null;

    constructor(
        private readonly plot: HTMLElement,
        private readonly backdrop: HTMLElement,
        private readonly coords: CoordinateSystem,
        private readonly bars: () => readonly OHLCV[],
        private readonly theme: () => VelaTheme,
    ) {
        this.win = plot.ownerDocument.defaultView;
    }

    /** Replace an earlier reveal immediately; its timers can never remove this one. */
    show(index: number, timestamp: number, moving: boolean, maxWaitMs = 15000): boolean {
        if (!this.win) return false;
        this.clear();
        const doc = this.plot.ownerDocument;
        const root = doc.createElement('div');
        root.className = 'vela-candle-locator';
        root.dataset.timestamp = String(timestamp);
        root.setAttribute('aria-hidden', 'true');
        Object.assign(root.style, { position: 'absolute', left: '0', top: '0', overflow: 'hidden', pointerEvents: 'none' });
        const band = doc.createElement('div');
        band.className = 'vela-candle-locator-band';
        Object.assign(band.style, { position: 'absolute', left: '0', top: '0', height: '100%', opacity: '0', pointerEvents: 'none', willChange: 'transform, opacity' });
        root.appendChild(band);
        // The grid and host highlights remain beneath it; all candles and drawings remain above it.
        this.plot.insertBefore(root, this.backdrop.nextSibling);
        this.root = root;
        this.band = band;
        this.timestamp = timestamp;
        this.index = index;
        this.moving = moving;
        this.reduced = prefersReducedMotion();
        this.active = false;
        this.color = '';
        band.style.transition = this.reduced ? 'none' : 'opacity 180ms ease-out';
        // If a gesture interrupts a long navigation before the candle enters the view,
        // the invisible marker still cleans itself up.
        this.after(Math.max(3000, Math.min(120000, maxWaitMs)), () => this.clear());
        return true;
    }

    get navigating(): boolean { return this.moving; }
    cancelNavigation(abandon = false): void {
        const wasMoving = this.moving;
        this.moving = false;
        if (abandon && wasMoving && !this.active) this.clear();
    }

    /** Re-resolve an index after a backfill, trim or replay/view replacement. */
    navigationIndex(): number | null {
        if (!this.moving || !this.root) return null;
        const index = this.resolveIndex();
        if (index < 0) { this.clear(); return null; }
        return index;
    }

    /** Called on data/viewport paints, including resize and animated pans. */
    update(): void {
        const root = this.root;
        const band = this.band;
        if (!root || !band) return;
        const index = this.resolveIndex();
        if (index < 0) { this.clear(); return; }
        const width = this.coords.width;
        const x = this.coords.logicalToX(index);
        const bandWidth = Math.max(20, Math.min(52, this.coords.pxPerBar() * 2.4));
        root.style.width = `${width}px`;
        root.style.height = `${this.coords.height}px`;
        root.dataset.index = String(index);
        band.style.width = `${bandWidth}px`;
        band.style.transform = `translate3d(${x - bandWidth / 2}px, 0, 0)`;
        const theme = this.theme();
        const color = parseRgb(theme.textColor) ? theme.textColor : (isDarkColor(theme.background) ? '#ffffff' : '#000000');
        if (color !== this.color) {
            this.color = color;
            const edge = withAlpha(color, 0.05);
            const center = withAlpha(color, 0.19);
            band.style.background = `linear-gradient(90deg, transparent 0%, ${edge} 25%, ${center} 50%, ${edge} 75%, transparent 100%)`;
        }
        const inView = x >= -bandWidth / 2 && x <= width + bandWidth / 2;
        // Wait until the glide has nearly reached the candle, rather than spending the
        // flash while the marker is still sweeping in from the edge on a long pan.
        const arrived = !this.moving || Math.abs(x - width / 2) <= Math.max(10, width * 0.04);
        if (!this.active && inView && arrived) this.activate();
    }

    clear(): void {
        if (this.win) {
            for (const timer of this.timers) this.win.clearTimeout(timer);
            if (this.frameHandle != null) this.win.cancelAnimationFrame(this.frameHandle);
        }
        this.timers.clear();
        this.frameHandle = null;
        this.root?.remove();
        this.root = null;
        this.band = null;
        this.active = false;
        this.moving = false;
        this.index = -1;
    }

    private resolveIndex(): number {
        const bars = this.bars();
        if (bars[this.index]?.time === this.timestamp) return this.index;
        this.index = displayedCandleIndex(bars, this.timestamp, -1);
        return this.index;
    }

    private activate(): void {
        const band = this.band;
        const root = this.root;
        const win = this.win;
        if (!band || !root || !win) return;
        this.active = true;
        this.reduced = this.reduced || prefersReducedMotion();
        root.dataset.visible = 'true';
        if (this.reduced) {
            band.style.transition = 'none';
            band.style.opacity = '1';
        } else {
            // A separate frame lets the browser establish opacity zero before the fade in.
            this.frameHandle = win.requestAnimationFrame(() => {
                this.frameHandle = null;
                if (this.band === band) band.style.opacity = '1';
            });
        }
        this.after(1150, () => {
            if (this.band !== band) return;
            if (this.reduced || prefersReducedMotion()) { this.clear(); return; }
            band.style.transition = 'opacity 450ms ease-in';
            band.style.opacity = '0';
            this.after(470, () => this.clear());
        });
    }

    private after(ms: number, cb: () => void): void {
        const win = this.win;
        if (!win) return;
        const timer = win.setTimeout(() => { this.timers.delete(timer); cb(); }, ms);
        this.timers.add(timer);
    }
}
