import type { AxisLongPressEvent, ClickEvent, CrosshairEvent, DataWindowReadout, DataWindowTableSlice, IChartRenderer, LegendActionView, LegendCalloutView, RendererCapabilities, VisibleRange } from './ports/IChartRenderer';
import type { Unsubscribe } from './util/types';
import type { WallClock } from './util/wall-clock';
import type { SymbolPickerFn } from './model/inputs';
import type { OHLCV } from './model/ohlcv';


/**
 * The public control surface for the active renderer — `chart.renderer`. A thin
 * facade over the renderer port: get/set/inspect render features without exposing
 * the internal orchestration methods (`setBars`, `mountIndicator`, …). A key the
 * active renderer doesn't support warns in the console and is ignored — the chart
 * is never touched.
 */
export class RendererControl {
    constructor(private readonly renderer: IChartRenderer) {}

    /** The active renderer's identity, e.g. `'native'` or `'lwc'`. */
    get name(): string {
        return this.renderer.name;
    }

    /**
     * The geometry backend the active renderer actually mounted, when it has one
     * (`'webgl2'` or `'canvas2d'`). A diagnostic: the multi-chart workspace spends WebGL
     * on at most a handful of cells and flips the whole grid to canvas2d past that.
     */
    get backend(): 'canvas2d' | 'webgl2' | undefined {
        const kind = (this.renderer as { backendKind?: unknown }).backendKind;
        return kind === 'canvas2d' || kind === 'webgl2' ? kind : undefined;
    }

    /**
     * The bar CONTAINING `time` — the renderer's own floor-by-index lookup (a 1h instant
     * inside a 1D bar lights that day). `null` when this renderer has no such seam or the
     * instant is off the loaded series. Crosshair sync uses it to give every follower the
     * leader's instant in ITS data.
     */
    /**
     * The loaded bars, oldest first (source OHLCV, not the price style's output).
     * An empty array when the renderer cannot hand its data back.
     */
    getBars(): readonly OHLCV[] {
        return this.renderer.getBars?.() ?? [];
    }

    /** The data-bounded window on screen — both edges are REAL bar times. */
    getVisibleRange(): VisibleRange | null {
        return this.renderer.getVisibleRange();
    }

    barAt(time: number): OHLCV | null {
        const fn = (this.renderer as { barAt?: (t: number) => OHLCV | null }).barAt;
        return typeof fn === 'function' ? fn.call(this.renderer, time) : null;
    }

    /** What the active renderer can draw (drives graceful degradation). */
    get capabilities(): RendererCapabilities {
        return this.renderer.capabilities;
    }

    /** Whether the active renderer supports a feature — use to show/hide a UI control. */
    supports(feature: string): boolean {
        return this.renderer.features.includes(feature);
    }

    /** Read a feature's current value (`undefined` if unsupported). */
    get(feature: string): unknown {
        return this.renderer.readFeature(feature);
    }

    /**
     * Set one feature (`set('glow', 0.6)`) or several at once
     * (`set({ logScale: true, upColor: '#fff' })`). A key the active renderer does
     * not support emits a console warning and is ignored, with no effect on the UI.
     */
    set(feature: string | Record<string, unknown>, value?: unknown): this {
        const entries: [string, unknown][] = typeof feature === 'string' ? [[feature, value]] : Object.entries(feature);
        for (const [key, val] of entries) {
            if (this.renderer.features.includes(key)) this.renderer.applyFeature(key, val);
            else console.warn(`[vela] renderer "${this.renderer.name}" has no feature "${key}" — set ignored.`);
        }
        return this;
    }

    /**
     * Wire the legend rows' HOST-CONTRIBUTED actions (the shells route the plugin
     * registry through this; see `registerLegendAction`). Silent on a renderer without
     * the seam — contributed legend actions simply never show there, same graceful
     * degradation as the sync ghost crosshair.
     */
    setLegendActions(provider: ((indicatorId: string) => LegendActionView[]) | null): void {
        this.renderer.setLegendActions?.(provider);
    }

    /**
     * Wire the legend rows' HOST-CONTRIBUTED callout bubbles (the shells route the
     * plugin registry through this; see `registerLegendCallout`). Silent on a renderer
     * without the seam — contributed callouts simply never show there, same graceful
     * degradation as {@link setLegendActions}.
     */
    setLegendCallouts(provider: ((indicatorId: string) => LegendCalloutView[]) | null): void {
        this.renderer.setLegendCallouts?.(provider);
    }

    /**
     * Replace the indicator legend's fold toggle with a host action (or restore it with
     * `null`) — multi-chart shells point the chip at their indicator overview instead of
     * unfolding rows in place. Silent no-op on a renderer without a foldable legend.
     */
    setLegendOverviewAction(action: (() => void) | null): this {
        this.renderer.setLegendOverviewAction?.(action);
        return this;
    }

    /** Whether the active renderer can open a per-indicator settings dialog. */
    get supportsIndicatorSettings(): boolean {
        return typeof this.renderer.openIndicatorSettings === 'function';
    }

    /**
     * Open one indicator's settings dialog — the programmatic twin of the legend gear
     * (see {@link supportsIndicatorSettings}). Silent no-op without the seam or for an
     * unknown id.
     */
    openIndicatorSettings(indicatorId: string): this {
        this.renderer.openIndicatorSettings?.(indicatorId);
        return this;
    }

    /**
     * Export the current chart as a PNG data URL, or null if the active renderer
     * doesn't support it (warns). DOM overlays (tables, legend) are not included.
     */
    screenshot(): string | null {
        if (typeof this.renderer.screenshot === 'function') return this.renderer.screenshot();
        console.warn(`[vela] renderer "${this.renderer.name}" does not support screenshot().`);
        return null;
    }

    /**
     * Raster of the current chart onto a canvas (same pixels as {@link screenshot}),
     * or null if the renderer has no canvas export. Silent — a host compositing
     * several charts skips a renderer that cannot contribute.
     */
    screenshotCanvas(): HTMLCanvasElement | null {
        if (typeof this.renderer.screenshotCanvas === 'function') return this.renderer.screenshotCanvas();
        return null;
    }

    /**
     * The active renderer's full cosmetic config as a serializable, versioned JSON
     * document — persist it (templates, saved settings) and feed it back to
     * `applyConfig`. Returns null if the renderer has no rich config (warns).
     */
    getConfig(): unknown {
        if (typeof this.renderer.getConfig === 'function') return this.renderer.getConfig();
        console.warn(`[vela] renderer "${this.renderer.name}" does not support getConfig().`);
        return null;
    }

    /**
     * Apply a (possibly partial) config document from `getConfig()` — load a template
     * or restore saved settings. Malformed/unknown fields are ignored; no indicator
     * re-run. No-ops with a warning if the renderer has no rich config.
     */
    applyConfig(config: unknown): this {
        if (typeof this.renderer.applyConfig === 'function') this.renderer.applyConfig(config);
        else console.warn(`[vela] renderer "${this.renderer.name}" does not support applyConfig().`);
        return this;
    }

    /**
     * Subscribe to cosmetic-config changes (`applyConfig` — the in-chart settings dialog
     * commits through it). Host chrome that mirrors a config value (a bottom-bar timezone)
     * re-pulls {@link get}/{@link getConfig} here. Silent no-op unsubscribe on a renderer
     * without a rich config.
     */
    onConfigChanged(cb: () => void): Unsubscribe {
        return this.renderer.onConfigChanged?.(cb) ?? (() => undefined);
    }

    /**
     * Subscribe to crosshair movement — `time`/`price` under the cursor, per-series values,
     * and the hovered bar's OHLC (null fields when the cursor leaves the chart). This is the
     * public seam host chrome (status lines, data windows) builds on.
     */
    onCrosshairMove(cb: (e: CrosshairEvent) => void): Unsubscribe {
        return this.renderer.onCrosshairMove(cb);
    }

    /** End local touch inspection if the renderer supports it. */
    endTouchTracking(): void {
        this.renderer.endTouchTracking?.();
    }

    /** A click — or a touch tap — on the plot, never the end of a pan: the open time of
     *  the bar under it (`null` off the bars). On touch, where a tap moves no crosshair,
     *  this is how an interaction learns which bar was chosen. */
    onClick(cb: (e: ClickEvent) => void): Unsubscribe {
        return this.renderer.onClick(cb);
    }

    /** Touch long-press on a price or time axis strip — silent no-op without the seam. */
    onAxisLongPress(cb: (e: AxisLongPressEvent) => void): Unsubscribe {
        return this.renderer.onAxisLongPress?.(cb) ?? (() => undefined);
    }

    /**
     * The formatted data-window readout: time, OHLCV and indicator values on their pane's
     * scale. The native renderer resolves a local or synced crosshair bar, falling back to
     * its latest bar. Pair it with {@link onCrosshairMove} and {@link onDataWindowChange}.
     * Null on a renderer that does not provide the readout.
     */
    dataWindowReadout(): DataWindowReadout | null {
        return this.renderer.getDataWindowReadout?.() ?? null;
    }

    /** Bounded newest-first rows for the candle table, or null when unsupported. */
    dataWindowTable(offset: number, count: number): DataWindowTableSlice | null {
        return this.renderer.getDataWindowTable?.(offset, count) ?? null;
    }

    /** Whether this renderer can reveal and temporarily mark a table candle. */
    get supportsCandleNavigation(): boolean {
        return typeof this.renderer.revealTableCandle === 'function';
    }

    /** Reveal a loaded table candle; false when it is missing or the renderer cannot do so. */
    revealTableCandle(timestamp: number, newestOffset: number): boolean {
        return this.renderer.revealTableCandle?.(timestamp, newestOffset) ?? false;
    }

    /** Readout-only changes (such as a synced crosshair or timezone); silent on older renderers. */
    onDataWindowChange(cb: () => void): Unsubscribe {
        return this.renderer.onDataWindowChange?.(cb) ?? (() => undefined);
    }

    /**
     * Wire (or clear with `null`) the host's symbol picker for the settings dialog's `input.symbol`
     * control — the host opens its own ticker-selection UI and reports the chosen symbol back.
     * No-ops with a warning if the active renderer doesn't support it (only the native renderer does).
     */
    setSymbolPicker(picker: SymbolPickerFn | null): this {
        if (typeof this.renderer.setSymbolPicker === 'function') this.renderer.setSymbolPicker(picker);
        else console.warn(`[vela] renderer "${this.renderer.name}" does not support setSymbolPicker().`);
        return this;
    }

    /**
     * Move keyboard focus back onto the chart's interactive surface — call after a host
     * control (a shared toolbar button) stole focus, so chart/drawing shortcuts keep
     * working. Silent no-op on a renderer without a focusable surface.
     */
    focus(): this {
        this.renderer.focus?.();
        return this;
    }

    /** Whether the active renderer can display an EXTERNAL (synced) crosshair. */
    get supportsExternalCrosshair(): boolean {
        return typeof this.renderer.setExternalCrosshair === 'function';
    }

    /**
     * Show (or clear, with `null`) a data-space ghost crosshair driven from OUTSIDE
     * this chart — the multi-chart crosshair-sync seam. Silent no-op on a renderer
     * without the capability (see {@link supportsExternalCrosshair}).
     */
    setExternalCrosshair(time: number | null, price: number | null = null): this {
        this.renderer.setExternalCrosshair?.(time, price);
        return this;
    }

    /**
     * Close any in-chart dialogs the active renderer owns (indicator settings, chart-settings
     * gear) — for keeping host dialogs mutually exclusive with the renderer's. Silent no-op if
     * the renderer has no such dialogs; safe to call speculatively.
     */
    closeDialogs(options?: { preserveSettings?: boolean }): this {
        this.renderer.closeDialogs?.(options);
        return this;
    }

    /**
     * Open (or toggle) the renderer's in-chart settings dialog — silent no-op without one.
     * Pass a section title (e.g. `'Canvas'`) to land on that tab; an unknown one opens the
     * dialog on its first tab, and with a section an open dialog switches tab instead of closing.
     */
    openSettings(section?: string): this {
        this.renderer.openSettingsDialog?.(section);
        return this;
    }

    /** Contribute host settings tabs (callback rows) to the renderer's settings dialog —
     *  e.g. the widget's Status line toggles. Silent no-op without a dialog. */
    setSettingsSections(sections: ReadonlyArray<{ title: string; rows: readonly unknown[]; id?: string }>): this {
        this.renderer.setSettingsSections?.(sections);
        return this;
    }

    /** Hand the renderer's chart-settings dialog the shell's TEMPLATES store (TradingView's
     *  Settings → Templates). `null` removes the control. No-op on renderers without the
     *  seam; the templates themselves always live in the shell. */
    setSettingsTemplates(host: import('./ports/IChartRenderer').SettingsTemplateHost | null): this {
        this.renderer.setSettingsTemplates?.(host);
        return this;
    }

    /** Hand the renderer's INDICATOR settings dialog the shell's per-type defaults
     *  (TradingView's Defaults menu). `null` restores the plain "Reset defaults" chip.
     *  No-op on renderers without the seam; the values always live in the shell. */
    setIndicatorDefaults(host: import('./ports/IChartRenderer').IndicatorDefaultsHost | null): this {
        this.renderer.setIndicatorDefaults?.(host);
        return this;
    }

    /**
     * Set the settings-dialog visibility policy: `hidden` lists setting ids to hide —
     * a tab (`'canvas'`), a group (`'canvas.grid'`), or a single row
     * (`'canvas.grid.vertical'`); an id hides its whole subtree, and a tab with nothing
     * left disappears from the rail. Presentation-only: hidden values keep being stored
     * and applied (e.g. hide `'advanced'` while forcing the widget's `bars` option).
     * Seeded from `VelaOptions.settings`; silent no-op without a settings dialog.
     */
    setSettingsVisibility(policy: { hidden?: readonly string[] }): this {
        this.renderer.setSettingsVisibility?.(policy);
        return this;
    }

    /** Every addressable setting id of this chart (built-in tabs/groups/rows, chart-type
     *  sections, host sections) — enumerate these to build a `hidden` list instead of
     *  reading contributor source. Empty on a renderer without a settings dialog. */
    listSettingsIds(): string[] {
        return this.renderer.listSettingsIds?.() ?? [];
    }

    /** Tell the renderer's own chrome which size class the host shell is in —
     *  `'mobile'` switches its dialogs/toolbars to the touch-first presentation.
     *  Silent no-op on a renderer without adaptive chrome. */
    setLayoutMode(mode: 'mobile' | 'desktop'): this {
        this.renderer.setLayoutMode?.(mode);
        return this;
    }

    /**
     * Drive the renderer's time-of-day chrome (the countdown-to-bar-close chip) from the
     * host's own second pulse, so it ticks in step with a host clock display instead of
     * on a separate timer that can read a different second. `null` hands the pulse back
     * to the renderer. Silent no-op on a renderer without time-of-day chrome.
     */
    setWallClock(clock: WallClock | null): this {
        this.renderer.setWallClock?.(clock);
        return this;
    }
}
