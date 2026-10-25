import type { VelaTheme } from '../../../core/options';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { Fill, Background, PriceLine } from '../../../core/model/scene';
import type { SeriesSpec, LineLikeSeries, CandleSeries, LineStyle, CandleBarColor } from '../../../core/model/series';
import { isLineLikeSeries, seriesShownOn } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { candleTier, wickWidth, candleGeometry, snapY, aggregateCandleColumns } from './candle-lod';
import { BASELINE_TOP_LINE, BASELINE_BOTTOM_LINE, BASELINE_FILL_ALPHA, BASELINE_FILL_ALPHA_FAR, withAlpha, effectiveCandlePaint } from '../core/chartConfig';
import { paintFamily, volumeWidthShare } from '../../../core/price-styles/variants';
import type { IRenderBackend } from './IRenderBackend';

/**
 * Canvas2d GEOMETRY backend (L0) — the PRIMARY native backend and the WebGL2
 * backend's permanent fallback. Renders immediate-mode from the scene each frame,
 * culled to the visible bar range: bgcolor, fills (flat/conditional/gradient),
 * candles, line/area/step/histogram/columns/circles/cross with per-point/per-bar
 * color, hline. Per-pane price scales are computed by the renderer BEFORE this
 * runs (it reads pane.scale). Pine drawings, axes, the current-price line, and the
 * crosshair are NOT its concern — they live on the canvas2d chrome (ChromeRenderer)
 * and cursor (CrosshairRenderer) layers above; the grid + session highlights live
 * on the backdrop canvas below (BackdropRenderer).
 */
export class Canvas2dBackend implements IRenderBackend {
    readonly kind = 'canvas2d' as const;
    modelAlpha = 1;
    candleBodyAlpha = 1;
    candleStructureAlpha = 1;
    candleBodyScale = 1;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        const fullW = canvas.width / dpr;
        const fullH = canvas.height / dpr;
        const dataW = coords.width; // excludes the right price-axis strip

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, fullW, fullH);

        const n = coords.barCount;
        if (n === 0) return;
        const vr = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(vr.from));
        const i1 = Math.min(n - 1, Math.ceil(vr.to));
        if (i1 < i0) return;

        const barColorMap = mergeBarColors(scene.indicators);
        const panes = scene.orderedPanes();

        // Session highlights + the grid paint on the renderer's BACKDROP canvas, below
        // every layer canvas (see backdrop/BackdropRenderer) — nothing to do here.

        // ── per-pane data (pane.scale was set by the renderer's autoscale) ──
        for (const pane of panes) {
            // A collapsed pane is a legend-only strip — draw no plots (its separator + legend remain).
            if (pane.collapsed) continue;
            // Indicators sorted by foreground z; the candles are one orderable layer at
            // `scene.candleZ`, so an overlay with z below it draws BEHIND the candles.
            const models = scene.orderedIndicatorsForPane(pane.id);
            const isPrice = pane.kind === 'price';
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, pane.bounds.top, dataW, pane.bounds.height);
            ctx.clip();

            // A merged (own-scale) indicator draws against its own price window inside the pane;
            // everything else against the pane's master scale. `effPane` swaps only the scale.
            const effPane = (m: IndicatorModel): PaneNode => {
                const sc = scene.scaleFor(m, pane);
                return sc === pane.scale ? pane : { ...pane, scale: sc };
            };

            // Behind everything: bgcolor spans — Pine keeps the background under every
            // layer regardless of stacking. Own (non-force_overlay) spans on each model's
            // pane; force_overlay spans on the price pane, whatever pane the indicator
            // owns (Pine semantics — mirrors the chrome's overlay-drawing routing).
            // Fills are NOT here: they paint inside the z loop at their model's slot.
            ctx.globalAlpha = this.modelAlpha; // indicator models fade in after the intro; candles stay opaque
            for (const m of models) for (const bg of m.backgrounds) if (bg.overlay !== true) this.drawBackground(ctx, bg, pane, coords);
            if (isPrice) {
                for (const m of scene.indicators.values()) {
                    for (const bg of m.backgrounds) if (bg.overlay === true) this.drawBackground(ctx, bg, pane, coords);
                }
            }

            // User-drawing interleave layers, prepainted by the renderer: each composites just
            // before the series carrying its `beforeZ`, so a drawing can sit under the candles
            // or between two indicators. Full-opacity — drawings don't fade with the models.
            const slices = scene.drawingSlices.get(pane.id) ?? [];
            let si = 0;
            const drawSlicesUpTo = (z: number): void => {
                for (; si < slices.length && slices[si]!.beforeZ <= z; si += 1) {
                    ctx.globalAlpha = 1;
                    ctx.drawImage(slices[si]!.canvas, 0, 0, fullW, fullH);
                }
            };

            // Foreground: candles + each indicator's series, interleaved by z-order.
            // When the price is hidden, the candle layer is skipped entirely (overlays still draw).
            const drawCandles = isPrice && !scene.candlesHidden;
            let candleDrawn = false;
            for (const m of models) {
                if (drawCandles && !candleDrawn && scene.zOf(m.id) >= scene.candleZ) {
                    drawSlicesUpTo(scene.candleZ);
                    ctx.globalAlpha = this.candleStructureAlpha; // baseline; drawCandles sets body vs structure per-element
                    this.drawPriceSeries(ctx, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                    candleDrawn = true;
                }
                drawSlicesUpTo(scene.zOf(m.id));
                ctx.globalAlpha = this.modelAlpha;
                // Model data is index-aligned from the model's ANCHOR bar (offset 0 = whole-chart).
                const off = scene.offsetOf(m.id);
                const mp = effPane(m);
                // Fills paint at the model's z slot, under its own series — a band between
                // two plots sits behind the plot lines, and the whole model moves as one
                // unit when its object-tree row is reordered.
                for (const f of m.fills) if (f.overlay !== true) this.drawFill(ctx, m, f, mp, coords, i0, i1, off);
                for (const s of m.series) if (s.overlay !== true) this.drawSeries(ctx, s, mp, coords, i0, i1, theme, off);
            }
            if (drawCandles && !candleDrawn) {
                drawSlicesUpTo(scene.candleZ);
                ctx.globalAlpha = this.candleStructureAlpha;
                this.drawPriceSeries(ctx, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
            }
            // force_overlay content from EVERY indicator paints on the price pane, at the
            // top of its series stack, against the master price scale — fills first so a
            // forced band still sits under the forced plot lines.
            if (isPrice) {
                ctx.globalAlpha = this.modelAlpha;
                for (const m of scene.indicators.values()) {
                    const off = scene.offsetOf(m.id);
                    for (const f of m.fills) if (f.overlay === true) this.drawFill(ctx, m, f, pane, coords, i0, i1, off);
                }
                for (const m of scene.indicators.values()) {
                    const off = scene.offsetOf(m.id);
                    for (const s of m.series) if (s.overlay === true) this.drawSeries(ctx, s, pane, coords, i0, i1, theme, off);
                }
            }
            // Stack-top slices: the topmost indicator's drawings, force_overlay drawings,
            // and layers bound to a hidden/removed series — above the forced series too,
            // since drawings always paint over their own plots.
            drawSlicesUpTo(Infinity);

            // On top: price lines.
            ctx.globalAlpha = this.modelAlpha;
            for (const m of models) { const mp = effPane(m); for (const pl of m.priceLines) this.drawHline(ctx, pl, mp, coords, dataW, theme); }

            ctx.restore();
        }
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    // ── base price series (chart type) ──
    /**
     * Draw the base price series in the configured style: candlesticks, OHLC bars,
     * line, area, or baseline. All stay time-indexed.
     */
    private drawPriceSeries(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
        dataW: number,
    ): void {
        if (scene.basePainting === 'none') return; // plugin style fully replaces the price series
        const bars = scene.bars;
        const st = scene.style;
        switch (paintFamily(scene.priceStyle)) {
            // ── the painting variants: same bars, different paint ──
            case 'hollow-candles':
                this.drawHollowCandles(ctx, scene, bars, i0, i1, coords, pane, theme, barColors);
                return;
            case 'volume-candles':
                this.drawVolumeCandles(ctx, scene, bars, i0, i1, coords, pane, theme, barColors);
                return;
            case 'line-markers':
                this.drawPriceLineWithMarkers(ctx, bars, i0, i1, coords, pane, st.line.color ?? theme.upColor, st.line.width, st.variants.markerRadius);
                return;
            case 'stepline':
                this.drawStepLine(ctx, bars, i0, i1, coords, pane, st.line.color ?? theme.upColor, st.line.width);
                return;
            case 'hlc-area':
                this.drawHlcArea(ctx, bars, i0, i1, coords, pane, st.area.lineColor ?? theme.upColor, st.area.topColor ?? st.area.lineColor ?? theme.upColor, st.area.width);
                return;
            case 'columns':
                this.drawColumns(ctx, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, st.variants.columnBaseline);
                return;
            case 'high-low':
                this.drawHighLow(ctx, bars, i0, i1, coords, pane, st.variants.highLowColor ?? st.line.color ?? theme.upColor);
                return;
            case 'hlc-bars':
                this.drawHlcBars(ctx, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, barColors);
                return;
            case 'kagi':
                this.drawKagi(ctx, bars, i0, i1, coords, pane, theme);
                return;
            case 'pnf':
                this.drawPnf(ctx, bars, i0, i1, coords, pane, theme);
                return;
            case 'linebreak':
                this.drawLineBreak(ctx, bars, i0, i1, coords, pane, theme);
                return;
            case 'bars':
                this.drawBars(ctx, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, barColors);
                return;
            case 'line':
                this.drawPriceLine(ctx, bars, i0, i1, coords, pane, st.line.color ?? theme.upColor, st.line.width);
                return;
            case 'area': {
                const lineColor = st.area.lineColor ?? theme.upColor;
                this.drawPriceArea(ctx, bars, i0, i1, coords, pane, st.area.topColor ?? lineColor, st.area.bottomColor ?? 'rgba(0,0,0,0)');
                this.drawPriceLine(ctx, bars, i0, i1, coords, pane, lineColor, st.area.width);
                return;
            }
            case 'baseline':
                this.drawBaseline(ctx, bars, i0, i1, coords, pane, scene, theme, dataW);
                return;
            default: // 'candles' + candle-drawn styles (a plugin style may fade candles to reveal its
                // order-flow layer) and 'heikinashi' (the bars themselves arrive already transformed)
                this.drawCandles(ctx, scene, bars, i0, i1, coords, pane, theme, barColors);
        }
    }

    // ── painting variants ────────────────────────────────────────────────────────
    // Each painter below reuses this file's geometry helpers (candleGeometry, snapY,
    // candleTier) so a variant lands on the same device-pixel grid as the candles it
    // stands in for — a style switch must not shift the chart by half a pixel.

    /** The per-bar direction colour, honouring a `barcolor()` override and the variant's
     *  optional "colour by the previous close" rule (TradingView's volume-candle switch). */
    private barInk(
        bar: OHLCV,
        prev: OHLCV | undefined,
        up: string,
        down: string,
        byPrevClose: boolean,
        barColors: ReadonlyMap<number, string>,
    ): string {
        const bc = barColors.get(bar.time);
        if (bc) return bc;
        const rising = byPrevClose && prev ? bar.close >= prev.close : bar.close >= bar.open;
        return rising ? up : down;
    }

    /** Hollow candles: an OUTLINE body when the close is at/above the open, filled below. */
    private drawHollowCandles(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        const cs = paint.candle;
        const hollowUp = scene.style.variants.hollowUp;
        if (tier !== 'full') {
            // Too thin for a body: the stick IS the candle (same rule as drawCandles).
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, (b) => barColors.get(b.time) ?? (b.close >= b.open ? paint.up : paint.down));
            return;
        }
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);
            const up = b.close >= b.open;
            const color = barColors.get(b.time) ?? (up ? paint.up : paint.down);
            const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
            const top = snapY(Math.min(oY, cY), coords.dpr);
            const bottom = snapY(Math.max(oY, cY), coords.dpr);
            const bodyH = Math.max(1 / coords.dpr, bottom - top);
            if (cs.wickVisible) {
                const hY = snapY(coords.priceToY(b.high, pane.scale, pane.bounds), coords.dpr);
                const lY = snapY(coords.priceToY(b.low, pane.scale, pane.bounds), coords.dpr);
                ctx.strokeStyle = (up ? cs.wickUpColor : cs.wickDownColor) ?? color;
                ctx.lineWidth = g.wickW;
                ctx.beginPath();
                ctx.moveTo(g.center, hY);
                ctx.lineTo(g.center, top);
                ctx.moveTo(g.center, bottom);
                ctx.lineTo(g.center, lY);
                ctx.stroke();
            }
            const hollow = hollowUp && up;
            const bw = Math.max(0, g.bodyW - 1);
            const bh = Math.max(0, bodyH - 1);
            if (!hollow && cs.bodyVisible) {
                ctx.globalAlpha = this.candleBodyAlpha;
                ctx.fillStyle = color;
                ctx.fillRect(g.bodyX, top, g.bodyW, bodyH);
            }
            // The outline is the point of the style, so it is always stroked — that is what
            // separates a hollow candle from a 1px wick with nothing around it.
            ctx.globalAlpha = this.candleStructureAlpha;
            ctx.strokeStyle = (up ? cs.borderUpColor : cs.borderDownColor) ?? color;
            ctx.lineWidth = 1;
            ctx.strokeRect(g.bodyX + 0.5, top + 0.5, bw, bh);
        }
    }

    /**
     * Volume candles: the body's WIDTH carries the volume (TradingView: "the greater the
     * trading volume, the wider the candle"). Width is a share of the bar pitch from
     * {@link volumeWidthShare}, floored so a dead bar still reads as a candle, and the
     * OHLC heights are untouched.
     */
    private drawVolumeCandles(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        const vs = scene.style.variants;
        if (tier !== 'full') {
            // The aggregate path sees one bar at a time, so the previous close is looked up
            // by time rather than by index (the same rule the wick tier uses).
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, (b) =>
                this.barInk(b, bars[bars.indexOf(b) - 1], paint.up, paint.down, vs.volumeColorByPrevClose, barColors),
            );
            return;
        }
        let maxVol = 0;
        for (let i = i0; i <= i1; i += 1) {
            const v = bars[i]?.volume ?? 0;
            if (v > maxVol) maxVol = v;
        }
        ctx.globalAlpha = this.candleStructureAlpha;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const color = this.barInk(b, bars[i - 1], paint.up, paint.down, vs.volumeColorByPrevClose, barColors);
            const share = volumeWidthShare(b.volume ?? 0, maxVol, vs.volumeMinWidthPct);
            const bodyW = Math.max(1 / coords.dpr, Math.round(spacing * share * coords.dpr) / coords.dpr);
            const center = Math.round(coords.logicalToX(i) * coords.dpr) / coords.dpr;
            const bodyX = center - bodyW / 2;
            const hY = snapY(coords.priceToY(b.high, pane.scale, pane.bounds), coords.dpr);
            const lY = snapY(coords.priceToY(b.low, pane.scale, pane.bounds), coords.dpr);
            const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
            const top = snapY(Math.min(oY, cY), coords.dpr);
            const bottom = snapY(Math.max(oY, cY), coords.dpr);
            const bodyH = Math.max(1 / coords.dpr, bottom - top);
            const wickW = Math.max(1 / coords.dpr, Math.min(1.5, bodyW / 2));
            ctx.strokeStyle = color;
            ctx.lineWidth = wickW;
            ctx.beginPath();
            ctx.moveTo(center, hY);
            ctx.lineTo(center, top);
            ctx.moveTo(center, bottom);
            ctx.lineTo(center, lY);
            ctx.stroke();
            if (paint.candle.bodyVisible) {
                ctx.globalAlpha = this.candleBodyAlpha;
                ctx.fillStyle = color;
                ctx.fillRect(bodyX, top, bodyW, bodyH);
                ctx.globalAlpha = this.candleStructureAlpha;
            }
            if (paint.candle.borderVisible) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(bodyX + 0.5, top + 0.5, Math.max(0, bodyW - 1), Math.max(0, bodyH - 1));
            }
        }
    }

    /** Line with markers: the close line plus a dot at every plotted point. */
    private drawPriceLineWithMarkers(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        color: string,
        width: number,
        radius: number,
    ): void {
        this.drawPriceLine(ctx, bars, i0, i1, coords, pane, color, width);
        ctx.fillStyle = color;
        // One dot per bar only while there is room for distinct dots; past that they merge
        // into the line itself and the loop is wasted work.
        if (coords.bodySpacing() < radius * 2.4) return;
        for (let i = Math.max(0, i0); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            ctx.beginPath();
            ctx.arc(coords.logicalToX(i), coords.priceToY(b.close, pane.scale, pane.bounds), radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** Step line: horizontal runs joined by vertical steps (value holds until the next bar). */
    private drawStepLine(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        color: string,
        width: number,
    ): void {
        ctx.lineWidth = width;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.strokeStyle = color;
        ctx.beginPath();
        let prevX = 0;
        let prevY = 0;
        let started = false;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) {
                started = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, prevY); // hold the previous value to this bar's x…
                ctx.lineTo(x, y); // …then step to the new one
            }
            prevX = x;
            prevY = y;
        }
        void prevX;
        ctx.stroke();
    }

    /** HLC area: a filled band between each bar's high and low, with the close as a line. */
    private drawHlcArea(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        lineColor: string,
        bandColor: string,
        width: number,
    ): void {
        const hi: Array<{ x: number; y: number }> = [];
        const lo: Array<{ x: number; y: number }> = [];
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = coords.logicalToX(i);
            hi.push({ x, y: coords.priceToY(b.high, pane.scale, pane.bounds) });
            lo.push({ x, y: coords.priceToY(b.low, pane.scale, pane.bounds) });
        }
        if (hi.length < 2) return;
        ctx.fillStyle = bandColor;
        ctx.beginPath();
        ctx.moveTo(hi[0]!.x, hi[0]!.y);
        for (const p of hi) ctx.lineTo(p.x, p.y);
        for (let i = lo.length - 1; i >= 0; i -= 1) ctx.lineTo(lo[i]!.x, lo[i]!.y);
        ctx.closePath();
        ctx.fill();
        this.drawPriceLine(ctx, bars, i0, i1, coords, pane, lineColor, width);
    }

    /** Columns: each close as a column from the zero line, coloured by direction. */
    private drawColumns(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        up: string,
        down: string,
        baseline: 'zero' | 'first',
    ): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, Math.round(spacing * 0.7));
        const zeroY = coords.priceToY(0, pane.scale, pane.bounds);
        // An instrument trading at 80,000 has no visible zero line: clamp the base to the
        // pane edge so the columns still read as columns (and say so by starting there).
        const baseY = baseline === 'first'
            ? coords.priceToY(bars[Math.max(0, i0)]?.close ?? 0, pane.scale, pane.bounds)
            : Math.min(pane.bounds.top + pane.bounds.height, Math.max(pane.bounds.top, zeroY));
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            const top = Math.min(y, baseY);
            const h = Math.max(1 / coords.dpr, Math.abs(baseY - y));
            ctx.fillStyle = b.close >= (bars[i - 1]?.close ?? b.open) ? up : down;
            const x = coords.logicalToX(i);
            ctx.fillRect(Math.round(x) - w / 2, top, w, h);
        }
    }

    /** High-low: one column per bar spanning high→low, in a single colour (no trend bias). */
    /**
     * Line break: each bar is one LINE — a hairline from its open to its close, coloured by
     * direction. Bodies would read as candles and lose the whole point (the reference draws
     * a bare stroke per line), so the width here is a stroke, not a slot share.
     */
    private drawLineBreak(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
    ): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, Math.round(Math.min(3 * coords.dpr, spacing * 0.5)));
        ctx.lineCap = 'butt';
        for (let i = Math.max(0, i0); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const y0 = coords.priceToY(b.open, pane.scale, pane.bounds);
            const y1 = coords.priceToY(b.close, pane.scale, pane.bounds);
            ctx.strokeStyle = b.close >= b.open ? theme.upColor : theme.downColor;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
        }
    }

    /**
     * Kagi: one continuous line, each leg a vertical run at its own slot. Legs are joined
     * by a short horizontal step (the reference draws them touching, but a step keeps two
     * adjacent legs readable when the price barely turned). Thick (yang) legs carry the
     * stronger weight — the whole point of the chart is that thickness encodes strength.
     */
    private drawKagi(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
    ): void {
        const yOf = (p: number): number => coords.priceToY(p, pane.scale, pane.bounds);
        const thin = Math.max(1, Math.round(1 * coords.dpr));
        const thick = Math.max(thin + 1, Math.round(3 * coords.dpr));
        let prevX: number | null = null;
        let prevY: number | null = null;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = coords.logicalToX(i);
            const up = b.close >= b.open;
            const color = up ? theme.upColor : theme.downColor;
            const w = b.styleHint?.yang ? thick : thin;
            const y0 = yOf(b.open);
            const y1 = yOf(b.close);
            if (prevX != null && prevY != null) {
                // the connector: a hairline step from the last leg's end to this one's start
                ctx.strokeStyle = color;
                ctx.lineWidth = thin;
                ctx.beginPath();
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(x, y0);
                ctx.stroke();
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            prevX = x;
            prevY = y1;
        }
    }

    /**
     * Point & figure: one column per bar, a stack of X (rising) or O (falling) glyphs, one
     * glyph per BOX. The glyph pitch is the pixel height of a box, so the stack always fills
     * the column exactly however the price scale is zoomed.
     */
    private drawPnf(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
    ): void {
        const yOf = (p: number): number => coords.priceToY(p, pane.scale, pane.bounds);
        const spacing = coords.bodySpacing();
        const half = Math.max(2, Math.min(spacing * 0.42, 14 * coords.dpr));
        const lw = Math.max(1, Math.round(1 * coords.dpr));
        for (let i = Math.max(0, i0); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = coords.logicalToX(i);
            const top = yOf(b.high);
            const bottom = yOf(b.low);
            const boxes = Math.max(1, Math.round(b.styleHint?.box ? (b.high - b.low) / b.styleHint.box : 1));
            const pitch = (bottom - top) / boxes;
            const rising = b.styleHint?.mark !== 'o';
            ctx.strokeStyle = rising ? theme.upColor : theme.downColor;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            const pad = Math.min(half, pitch / 2) * 0.86;
            for (let k = 0; k < boxes; k += 1) {
                const yc = top + pitch * (k + 0.5);
                ctx.beginPath();
                if (rising) {
                    ctx.moveTo(x - pad, yc - pad);
                    ctx.lineTo(x + pad, yc + pad);
                    ctx.moveTo(x + pad, yc - pad);
                    ctx.lineTo(x - pad, yc + pad);
                } else {
                    // An octagon ring reads as the reference's O at any body width.
                    const r = pad;
                    for (let a = 0; a < 8; a += 1) {
                        const t = (Math.PI / 4) * a + Math.PI / 8;
                        const px = x + Math.cos(t) * r;
                        const py = yc + Math.sin(t) * r;
                        if (a === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                }
                ctx.stroke();
            }
        }
    }

    private drawHighLow(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        color: string,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, () => color);
            return;
        }
        const w = Math.max(1, Math.round(spacing * 0.7));
        ctx.fillStyle = color;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            ctx.fillRect(Math.round(coords.logicalToX(i)) - w / 2, hY, w, Math.max(1 / coords.dpr, lY - hY));
        }
    }

    /** HLC bars: the OHLC bar without its open tick (high-low stick + close tick). */
    private drawHlcBars(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        up: string,
        down: string,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, (b) => barColors.get(b.time) ?? (b.close >= b.open ? up : down));
            return;
        }
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        const drawTicks = tier === 'full';
        ctx.lineWidth = 1;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const color = barColors.get(b.time) ?? (b.close >= b.open ? up : down);
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            if (drawTicks) {
                const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
                ctx.moveTo(x, cY);
                ctx.lineTo(x + tickW, cY);
            }
            ctx.stroke();
        }
    }

    /** OHLC bars: high-low stick + left open tick + right close tick (no body). */
    private drawBars(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        up: string,
        down: string,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, (b) => barColors.get(b.time) ?? (b.close >= b.open ? up : down));
            return;
        }
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        const drawTicks = tier === 'full';
        ctx.lineWidth = 1;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const color = barColors.get(b.time) ?? (b.close >= b.open ? up : down);
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            if (drawTicks) {
                const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
                ctx.moveTo(x - tickW, oY);
                ctx.lineTo(x, oY);
                ctx.moveTo(x, cY);
                ctx.lineTo(x + tickW, cY);
            }
            ctx.stroke();
        }
    }

    /** Close-price line (also the top stroke of the area style). */
    private drawPriceLine(ctx: CanvasRenderingContext2D, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, color: string, width: number): void {
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        ctx.beginPath();
        let started = false;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) {
                started = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    /** Filled area under the close line: a vertical gradient from `topColor` (at the
     *  line) to `bottomColor` (at the pane floor). Defaults fade the line color out. */
    private drawPriceArea(ctx: CanvasRenderingContext2D, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, topColor: string, bottomColor: string): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const pts: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            pts.push({ x, y });
            if (y < minY) minY = y;
        }
        if (pts.length < 2) return;
        const g = ctx.createLinearGradient(0, minY, 0, baseY);
        g.addColorStop(0, topColor);
        g.addColorStop(1, bottomColor);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, baseY);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1]!.x, baseY);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Baseline style: the close line split at a baseline price — filled+stroked with
     * the up color above the baseline and the down color below it, each fading to
     * transparent at the baseline. Clipping (not geometry-splitting) does the split.
     */
    private drawBaseline(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        scene: SceneGraph,
        theme: VelaTheme,
        dataW: number,
    ): void {
        const baseline = scene.baselinePriceFor(pane.scale);
        const baseY = coords.priceToY(baseline, pane.scale, pane.bounds);
        const top = pane.bounds.top;
        const bottom = pane.bounds.top + pane.bounds.height;
        const bs = scene.style.baseline;
        const topLine = bs.topLineColor ?? BASELINE_TOP_LINE;
        const bottomLine = bs.bottomLineColor ?? BASELINE_BOTTOM_LINE;
        const topFill = bs.topFillColor ?? withAlpha(topLine, BASELINE_FILL_ALPHA);
        const topFill2 = bs.topFillColor2 ?? withAlpha(topLine, BASELINE_FILL_ALPHA_FAR);
        const bottomFill = bs.bottomFillColor ?? withAlpha(bottomLine, BASELINE_FILL_ALPHA);
        const bottomFill2 = bs.bottomFillColor2 ?? withAlpha(bottomLine, BASELINE_FILL_ALPHA_FAR);
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            pts.push({ x: coords.logicalToX(i), y: coords.priceToY(b.close, pane.scale, pane.bounds) });
        }
        if (pts.length < 2) return;
        const poly = (): void => {
            ctx.beginPath();
            ctx.moveTo(pts[0]!.x, baseY);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1]!.x, baseY);
            ctx.closePath();
        };
        // Above the baseline: top fill near the line → fainter top fill at the baseline.
        if (baseY > top) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, top, dataW, baseY - top);
            ctx.clip();
            const gUp = ctx.createLinearGradient(0, top, 0, baseY);
            gUp.addColorStop(0, topFill);
            gUp.addColorStop(1, topFill2);
            ctx.fillStyle = gUp;
            poly();
            ctx.fill();
            ctx.restore();
        }
        // Below the baseline: fainter bottom fill at the baseline → bottom fill near the line.
        if (baseY < bottom) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, baseY, dataW, bottom - baseY);
            ctx.clip();
            const gDn = ctx.createLinearGradient(0, baseY, 0, bottom);
            gDn.addColorStop(0, bottomFill2);
            gDn.addColorStop(1, bottomFill);
            ctx.fillStyle = gDn;
            poly();
            ctx.fill();
            ctx.restore();
        }
        // The baseline marker, then the close line colored per segment by its side.
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        setDash(ctx, 'dashed');
        ctx.beginPath();
        ctx.moveTo(0, Math.round(baseY) + 0.5);
        ctx.lineTo(dataW, Math.round(baseY) + 0.5);
        ctx.stroke();
        setDash(ctx, 'solid');
        ctx.lineWidth = bs.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const seg = (x0: number, y0: number, x1: number, y1: number, color: string): void => {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        };
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            const aUp = a.y <= baseY;
            const cUp = c.y <= baseY;
            // Split the segment AT the baseline so each side is colored correctly — a
            // segment must never be the up color below the baseline (or vice versa).
            if (aUp !== cUp && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                seg(a.x, a.y, xCross, baseY, aUp ? topLine : bottomLine);
                seg(xCross, baseY, c.x, c.y, cUp ? topLine : bottomLine);
            } else {
                seg(a.x, a.y, c.x, c.y, aUp ? topLine : bottomLine);
            }
        }
        ctx.lineCap = 'butt';
    }

    // ── data ──
    private drawCandles(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        // A candle-based plugin style paints with its OWN cosmetics (unset keys inherit
        // the shared candles block); built-ins pass through untouched.
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        const cs = paint.candle;
        if (tier === 'aggregate') {
            // The stick IS the candle, so a bar's paint resolves as in the stick-only tier
            // below: the wick color setting wins, then barcolor(), then the direction color.
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, (b) => {
                const up = b.close >= b.open;
                return (up ? cs.wickUpColor : cs.wickDownColor) ?? barColors.get(b.time) ?? (up ? paint.up : paint.down);
            });
            return;
        }
        const drawBody = tier === 'full';
        // When a fading style drops the body below the structure, draw a body outline even
        // if no border is configured — so the candle keeps a visible (hollow) skeleton.
        const fading = this.candleStructureAlpha > this.candleBodyAlpha + 0.001;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue; // skip zero-range candles (e.g. the intro reveal's un-started state)
            // Wick + body snapped to the device grid as one unit, so the wick is always
            // dead-center in the body and the gap between candles stays uniform.
            const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);
            const x = g.center;
            const up = b.close >= b.open;
            const dir = up ? paint.up : paint.down;
            const bc = barColors.get(b.time);
            const color = bc ?? dir;
            // Body geometry up front so the wick can be clipped to it when the body is hollow.
            let top = 0;
            let bodyH = 0;
            if (drawBody) {
                const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
                // Both edges snapped to the device grid so the horizontal edges rasterize
                // crisp (no blended rim); a doji keeps a visible 1-device-px body.
                top = snapY(Math.min(oY, cY), coords.dpr);
                bodyH = Math.max(1 / coords.dpr, snapY(Math.max(oY, cY), coords.dpr) - top);
            }
            if (cs.wickVisible) {
                // barcolor() recolors only the BODY (TV semantics): the wick keeps the
                // direction color while a body is drawn. At stick-only zoom the stick IS
                // the candle, so it keeps the barcolor tint.
                const wick = (up ? cs.wickUpColor : cs.wickDownColor) ?? (drawBody ? dir : color);
                const hY = snapY(coords.priceToY(b.high, pane.scale, pane.bounds), coords.dpr);
                const lY = snapY(coords.priceToY(b.low, pane.scale, pane.bounds), coords.dpr);
                ctx.globalAlpha = this.candleStructureAlpha;
                ctx.strokeStyle = wick;
                ctx.lineWidth = g.wickW;
                ctx.beginPath();
                if (drawBody) {
                    // Draw the wick only outside the body, so it never shows through it — including
                    // hollow bodies and semi-transparent fills.
                    ctx.moveTo(x, hY);
                    ctx.lineTo(x, top);
                    ctx.moveTo(x, top + bodyH);
                    ctx.lineTo(x, lY);
                } else {
                    ctx.moveTo(x, hY);
                    ctx.lineTo(x, lY);
                }
                ctx.stroke();
            }
            if (drawBody) {
                if (cs.bodyVisible) {
                    ctx.globalAlpha = this.candleBodyAlpha;
                    ctx.fillStyle = color;
                    ctx.fillRect(g.bodyX, top, g.bodyW, bodyH);
                }
                // The border strictly follows its visibility setting — barcolor() never
                // forces one. An unconfigured border color inherits the body color, so a
                // barcolored body gets a matching tinted border, not a direction-colored
                // outline.
                if (cs.borderVisible || (fading && cs.bodyVisible)) {
                    ctx.globalAlpha = this.candleStructureAlpha;
                    ctx.strokeStyle = cs.borderVisible ? ((up ? cs.borderUpColor : cs.borderDownColor) ?? color) : color;
                    ctx.lineWidth = 1;
                    // Inset by half the stroke so the border lands on whole pixels
                    // (crisp) and stays inside the body's snapped footprint.
                    const bw = Math.max(0, g.bodyW - 1);
                    const bh = Math.max(0, bodyH - 1);
                    ctx.strokeRect(g.bodyX + 0.5, top + 0.5, bw, bh);
                }
            }
        }
    }

    /**
     * Sub-pixel LOD: bars sharing a rounded pixel column collapse into high-low
     * sticks (one per contiguous SAME-COLOR coverage run — see
     * {@link aggregateCandleColumns}), so draw cost is bounded by screen width (not
     * bar count) when zoomed far out, a price gap inside the column stays a void, and
     * every bar's extent keeps its own color. `colorOf` is the calling style's per-bar
     * paint rule (candles and OHLC bars resolve theirs differently).
     */
    private drawCandlesAggregated(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        colorOf: (bar: OHLCV) => string,
    ): void {
        const yOf = (price: number): number => coords.priceToY(price, pane.scale, pane.bounds);
        ctx.lineWidth = 1;
        for (const s of aggregateCandleColumns(bars, i0, i1, (i) => coords.logicalToX(i), yOf, colorOf)) {
            const x = s.x + 0.5;
            ctx.strokeStyle = s.color;
            ctx.beginPath();
            ctx.moveTo(x, yOf(s.hi));
            ctx.lineTo(x, yOf(s.lo));
            ctx.stroke();
        }
    }

    private drawSeries(ctx: CanvasRenderingContext2D, spec: SeriesSpec, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        // Off-pane series (legend/data-window-only readouts, hidden fill anchors) are
        // kept in the model for fills and readouts but never painted here.
        if (!seriesShownOn(spec, 'pane')) return;
        if (spec.kind === 'candle' || spec.kind === 'bar') {
            this.drawPlotCandles(ctx, spec, pane, coords, i0, i1, theme, off);
            return;
        }
        if (!isLineLikeSeries(spec)) return;
        switch (spec.kind) {
            case 'histogram':
            case 'columns':
                this.drawHistogram(ctx, spec, pane, coords, i0, i1, off);
                break;
            case 'area':
                this.drawArea(ctx, spec, pane, coords, i0, i1, off);
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, false, off);
                break;
            case 'circles':
            case 'cross':
                this.drawPointMarkers(ctx, spec, pane, coords, i0, i1, off);
                break;
            case 'step':
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, true, off);
                break;
            default:
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, false, off);
        }
    }

    private drawPolyline(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, step: boolean, off = 0): void {
        ctx.lineWidth = Math.max(1, s.style.width);
        ctx.lineJoin = 'round';
        setDash(ctx, s.style.lineStyle);
        // Per-segment stroke so a varying per-point color renders natively
        // (no series split). The segment entering point i takes point i's color.
        let prevX = 0;
        let prevY = 0;
        let have = false;
        for (let i = Math.max(1, i0 - 1); i <= i1; i += 1) {
            const p = s.points[i - off];
            const pv = s.points[i - 1 - off];
            if (!p || p.value === null || !pv || pv.value === null) {
                have = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            if (!have) {
                prevX = coords.logicalToX(i - 1);
                prevY = coords.priceToY(pv.value, pane.scale, pane.bounds);
            }
            ctx.strokeStyle = p.color ?? s.style.color;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            if (step) {
                ctx.lineTo(x, prevY);
                ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            prevX = x;
            prevY = y;
            have = true;
        }
        setDash(ctx, 'solid');
    }

    private drawArea(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        // One filled polygon per contiguous non-null run (breaks on gaps, like the
        // line overlay + AreaSeries), with a top-color → transparent vertical fade.
        let pts: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (pts.length === 0) return;
            const g = ctx.createLinearGradient(0, minY, 0, baseY);
            g.addColorStop(0, s.style.color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(pts[0]!.x, baseY);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1]!.x, baseY);
            ctx.closePath();
            ctx.fill();
            pts = [];
            minY = Infinity;
        };
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            pts.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    private drawHistogram(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, (s.kind === 'columns' ? 0.7 : 0.8) * spacing);
        const half = w / 2;
        const base = s.style.base ?? 0;
        const baseY = coords.priceToY(base, pane.scale, pane.bounds);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            ctx.fillStyle = p.color ?? s.style.color;
            ctx.fillRect(x - half, Math.min(baseY, y), w, Math.max(1, Math.abs(y - baseY)));
        }
    }

    private drawPointMarkers(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const r = Math.max(1.5, s.style.width);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            ctx.strokeStyle = p.color ?? s.style.color;
            ctx.fillStyle = p.color ?? s.style.color;
            if (s.kind === 'cross') {
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - r, y);
                ctx.lineTo(x + r, y);
                ctx.moveTo(x, y - r);
                ctx.lineTo(x, y + r);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    private drawPlotCandles(ctx: CanvasRenderingContext2D, s: CandleSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        const spacing = coords.bodySpacing();
        const up = s.style?.up ?? theme.upColor;
        const down = s.style?.down ?? theme.downColor;
        const isBar = s.kind === 'bar';
        const half = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        for (let i = i0; i <= i1; i += 1) {
            const b = s.bars[i - off];
            if (!b) continue;
            const bc: CandleBarColor | null | undefined = s.barColors?.[i - off];
            const body = bc?.color ?? (b.close >= b.open ? up : down);
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
            if (isBar) {
                // OHLC bar: high-low stick + left open tick + right close tick.
                ctx.strokeStyle = body;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, hY);
                ctx.lineTo(x, lY);
                ctx.moveTo(x - tickW, oY);
                ctx.lineTo(x, oY);
                ctx.moveTo(x, cY);
                ctx.lineTo(x + tickW, cY);
                ctx.stroke();
                continue;
            }
            ctx.strokeStyle = bc?.wickColor ?? body;
            ctx.lineWidth = wickWidth(spacing);
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            ctx.stroke();
            ctx.fillStyle = body;
            ctx.fillRect(x - half, Math.min(oY, cY), half * 2, Math.max(1, Math.abs(cY - oY)));
            if (bc?.borderColor) {
                ctx.strokeStyle = bc.borderColor;
                ctx.strokeRect(x - half, Math.min(oY, cY), half * 2, Math.max(1, Math.abs(cY - oY)));
            }
        }
    }

    private drawFill(ctx: CanvasRenderingContext2D, model: IndicatorModel, fill: Fill, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        // Constant band (`fill(hline1, hline2, …)`): one clipped rect across the pane.
        if (fill.fromPrice !== undefined && fill.toPrice !== undefined) {
            const color = fill.color;
            if (!color) return;
            const yA = coords.priceToY(fill.fromPrice, pane.scale, pane.bounds);
            const yB = coords.priceToY(fill.toPrice, pane.scale, pane.bounds);
            const top = Math.max(pane.bounds.top, Math.min(yA, yB));
            const bottom = Math.min(pane.bounds.top + pane.bounds.height, Math.max(yA, yB));
            if (bottom <= top) return;
            const x0 = Math.max(0, coords.logicalToX(i0));
            const x1 = Math.min(coords.width, coords.logicalToX(i1));
            if (x1 <= x0) return;
            ctx.fillStyle = color;
            ctx.fillRect(x0, top, x1 - x0, bottom - top);
            return;
        }
        if (!fill.fromSeriesId || !fill.toSeriesId) return;
        const from = findPoints(model, fill.fromSeriesId);
        const to = findPoints(model, fill.toSeriesId);
        if (!from || !to) return;
        // Gradient pool: reuse one CanvasGradient across a run of bars with identical
        // top/bottom y + colors (a constant gradient → 1 object for the whole fill,
        // instead of one createLinearGradient per bar per frame).
        let gTop = NaN;
        let gBot = NaN;
        let gTC = '';
        let gBC = '';
        let gObj: CanvasGradient | null = null;
        // Per-bar quads (flat / conditional / vertical gradient), culled to view.
        for (let i = Math.max(1, i0); i <= i1; i += 1) {
            const a0 = from[i - 1 - off];
            const b0 = to[i - 1 - off];
            const a1 = from[i - off];
            const b1 = to[i - off];
            if (!a0 || !b0 || !a1 || !b1 || a0.value === null || b0.value === null || a1.value === null || b1.value === null) continue;
            const xPrev = coords.logicalToX(i - 1);
            const xCur = coords.logicalToX(i);
            const tPrev = coords.priceToY(a0.value, pane.scale, pane.bounds);
            const bPrev = coords.priceToY(b0.value, pane.scale, pane.bounds);
            const tCur = coords.priceToY(a1.value, pane.scale, pane.bounds);
            const bCur = coords.priceToY(b1.value, pane.scale, pane.bounds);

            // Style a span [i-1, i] by its LEFT/head column (matches FillPrimitive's
            // run-head convention — keying off i would shift colours/gradient by 1 bar).
            const grad = fill.gradient?.[i - 1 - off];
            if (grad) {
                const yTop = coords.priceToY(grad.topValue, pane.scale, pane.bounds);
                const yBot0 = coords.priceToY(grad.bottomValue, pane.scale, pane.bounds);
                const yBot = yBot0 === yTop ? yTop + 1 : yBot0;
                if (!gObj || yTop !== gTop || yBot !== gBot || grad.topColor !== gTC || grad.bottomColor !== gBC) {
                    gObj = ctx.createLinearGradient(0, yTop, 0, yBot);
                    gObj.addColorStop(0, grad.topColor);
                    gObj.addColorStop(1, grad.bottomColor);
                    gTop = yTop;
                    gBot = yBot;
                    gTC = grad.topColor;
                    gBC = grad.bottomColor;
                }
                ctx.fillStyle = gObj;
            } else {
                const color = fill.colors ? fill.colors[i - 1 - off] : fill.color;
                if (!color) continue;
                ctx.fillStyle = color;
            }
            ctx.beginPath();
            ctx.moveTo(xPrev, tPrev);
            ctx.lineTo(xCur, tCur);
            ctx.lineTo(xCur, bCur);
            ctx.lineTo(xPrev, bPrev);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawBackground(ctx: CanvasRenderingContext2D, bg: Background, pane: PaneNode, coords: CoordinateSystem): void {
        const x1 = coords.timeToX(bg.from);
        const x2 = coords.timeToX(bg.to);
        if (x2 < 0 || x1 > coords.width || x2 <= x1) return;
        ctx.fillStyle = bg.color;
        ctx.fillRect(x1, pane.bounds.top, x2 - x1, pane.bounds.height);
    }

    private drawHline(ctx: CanvasRenderingContext2D, pl: PriceLine, pane: PaneNode, coords: CoordinateSystem, dataW: number, theme: VelaTheme): void {
        const y = Math.round(coords.priceToY(pl.price, pane.scale, pane.bounds)) + 0.5;
        if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) return;
        ctx.strokeStyle = pl.color ?? theme.textColor;
        ctx.lineWidth = pl.width ?? 1;
        setDash(ctx, pl.lineStyle ?? 'solid');
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(dataW, y);
        ctx.stroke();
        setDash(ctx, 'solid');
    }
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

function findPoints(model: IndicatorModel, seriesId: string): LineLikeSeries['points'] | null {
    const s = model.series.find((x) => x.id === seriesId);
    return s && isLineLikeSeries(s) ? s.points : null;
}

const EMPTY_BARCOLORS: ReadonlyMap<number, string> = new Map();

function mergeBarColors(indicators: Map<string, IndicatorModel>): ReadonlyMap<number, string> {
    // Common case (no barcolor() anywhere) → shared empty map, no per-frame alloc.
    let any = false;
    for (const m of indicators.values()) {
        if (m.barColors && m.barColors.length > 0) {
            any = true;
            break;
        }
    }
    if (!any) return EMPTY_BARCOLORS;
    const map = new Map<number, string>();
    for (const m of indicators.values()) {
        if (m.barColors) for (const bc of m.barColors) map.set(bc.time, bc.color);
    }
    return map;
}

