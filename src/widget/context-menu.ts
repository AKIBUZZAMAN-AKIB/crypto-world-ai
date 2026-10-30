// Chart context menu — right-click on the chart area. Items depend on the zone
// (price axis / time axis / chart body) and current renderer feature states; the menu
// itself is the kit Menu anchored at the pointer.
import type { Vela } from '../Vela';
import { Menu, type MenuItemDescriptor, type MenuOptions } from '../ui/components/menu';
import { injectStyles } from '../ui/styles';
import { widgetActions, type ContextMenuPointer, type WidgetContext } from './contributions';
import {
    bodyItems,
    composeMenu,
    invertWrite,
    paneScaleAt,
    priceAxisItems,
    scaleChoiceOf,
    scaleWrites,
    settingsSectionOf,
    timeAxisItems,
    type ContributedRow,
    type PaneScaleInfo,
    type ScaleChoice,
    type Zone,
} from './context-menu-model';
import { resolveTimezone } from './timezones';

/** Approximate chrome insets used only to classify the right-clicked zone. */
const PRICE_AXIS_W = 60;
const TIME_AXIS_H = 26;

const OFF_PLOT: ContextMenuPointer = { price: null, time: null, paneKind: null };

// The phone's More → Chart actions uses the same compact menu vocabulary as Visual
// order and Manage layouts, not a drawer. Its width/height are clamped to the workspace
// and visual viewport when it opens; a long list scrolls inside the menu.
const CHART_ACTIONS_STYLE_ID = 'vela-chart-actions-menu';
const CHART_ACTIONS_CSS = `
.vela-menu.vela-chart-actions {
    width: var(--vela-chart-actions-width, 224px); min-width: 0;
    max-width: 100%; max-height: var(--vela-chart-actions-height, 70vh);
    padding: 5px; box-sizing: border-box; overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
}
.vela-chart-actions > .vela-menu-item { min-height: 40px; padding: 6px 9px; }
.vela-chart-actions .vela-menu-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
`;

// Phone axis hold: the exact desktop price-scale model, displayed as a compact
// touch-sized floating menu. Nested lists use the same language and workspace bounds.
const PRICE_TOUCH_STYLE_ID = 'vela-price-scale-touch-menu';
const PRICE_TOUCH_CSS = `
.vela-menu.vela-price-scale-menu {
    width: var(--vela-price-touch-width, 240px); min-width: 0;
    max-width: 100%; max-height: var(--vela-price-touch-height, 70vh);
    padding: 5px; box-sizing: border-box; overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
}
.vela-menu.vela-price-scale-submenu {
    min-width: 0; max-width: var(--vela-price-touch-subwidth, calc(100vw - 12px));
    max-height: var(--vela-price-touch-subheight, calc(100vh - 12px));
    box-sizing: border-box; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
}
.vela-price-scale-menu > .vela-menu-item, .vela-price-scale-submenu > .vela-menu-item {
    min-height: 44px; box-sizing: border-box; border-radius: 0; padding: 6px 8px;
}
.vela-price-scale-menu .vela-menu-label, .vela-price-scale-submenu .vela-menu-label {
    min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
`;

export interface ContextMenuCallbacks {
    /** Reset the view (all history, autoscale back on). */
    resetView: () => void;
    /** Multi-chart hosts: carry THIS chart's settings onto every other chart. */
    applySettingsToAll?: () => void;
    /** Multi-chart hosts: open the chart-syncing surface on this chart — the right-click
     *  door TradingView has (Series context menu → Chart Syncing). */
    chartSyncing?: () => void;
    /** The display-timezone choice the host holds — a zone or the exchange rule (the time-axis menu checks it). */
    timezone?: () => string;
    /** Switch the display timezone through the host, so its own chrome follows.
     *  `scope` is the menu's "Apply to" choice: this chart alone, or every chart. */
    setTimezone?: (zone: string, scope: 'cell' | 'all') => void;
    /** The zone in force for THIS chart (drives the checkmarks). */
    timezoneScope?: () => 'cell' | 'all';
    /** Live widget context for contributed `context:*` actions. */
    getContext?: () => WidgetContext;
}

export class ChartContextMenu {
    private readonly menu: Menu;
    /** Lazily made, separately positioned phone menu; the model and actions are shared. */
    private bodyMenu: Menu | null = null;
    private priceTouchMenu: Menu | null = null;
    private priceTouchCleanup: (() => void) | null = null;
    private bodyAnchor: HTMLElement | null = null;
    private bodyWatch: (() => void) | null = null;
    private readonly host: HTMLElement;
    private chart: Vela | null = null;
    private offCrosshair: (() => void) | null = null;
    /** The bound chart's latest crosshair report — a right-click always follows a pointer
     *  move to its spot, so this is where it landed. */
    private crosshair: ContextMenuPointer = OFF_PLOT;
    /** {@link crosshair} as it stood when the menu opened: the pointer moves on through the
     *  menu before a row is picked, and `run` must see the right-clicked spot. */
    private pointer: ContextMenuPointer = OFF_PLOT;
    private lastZone: Zone = 'body';
    /** The open time-axis menu's "Apply to" choice (this chart / all charts). */
    private tzScope: 'cell' | 'all' = 'cell';
    /** The pane whose scale the open price-axis menu targets (null ⇒ the main scale). */
    private lastPane: PaneScaleInfo | null = null;
    private readonly onContextMenu = (e: MouseEvent): void => {
        e.preventDefault();
        if (!this.chart) return;
        this.bodyMenu?.close();
        this.priceTouchMenu?.close();
        this.pointer = this.crosshair;
        this.lastZone = this.zoneOf(e);
        this.lastPane = this.lastZone === 'price-axis' ? this.paneAt(e) : null;
        this.menu.setItems(this.itemsFor(this.lastZone));
        this.menu.openAt(e.clientX, e.clientY);
    };

    constructor(host: HTMLElement, private readonly cbs: ContextMenuCallbacks) {
        this.host = host;
        this.menu = new Menu({
            host,
            items: [],
            placement: 'bottom-start',
            // Pointer-anchored action menu: checked state reads as a leading ✓, not a
            // washed row (which would read as hover in a menu with no trigger button).
            checkmarks: true,
            iconBadges: true,
            onSelect: (id) => this.run(id),
        });
        host.addEventListener('contextmenu', this.onContextMenu);
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.offCrosshair?.();
        this.chart = chart;
        this.crosshair = OFF_PLOT;
        this.offCrosshair = chart.renderer.onCrosshairMove((e) => {
            this.crosshair = { price: e.price, time: e.time, paneKind: e.paneKind ?? null };
        });
    }

    /** Phone More → Chart actions. The More button is the stable visible anchor after
     *  its drawer closes; this menu has no chart-coordinate pointer. */
    openBody(anchor: HTMLElement): void {
        if (!this.chart || !anchor.isConnected) return;
        this.menu.close();
        this.priceTouchMenu?.close();
        if (this.bodyMenu?.api.open) {
            this.bodyMenu.close();
            return;
        }
        const boundary = this.host.closest<HTMLElement>('.vela-ui') ?? this.host;
        const menu = this.bodyMenu ?? this.createBodyMenu(boundary);
        this.pointer = OFF_PLOT;
        this.lastZone = 'body';
        this.lastPane = null;
        menu.setItems(this.itemsFor('body'));
        const rect = this.bodyGeometry(anchor, boundary, menu);
        if (!rect) return;
        this.watchBodyAnchor(anchor, boundary, menu);
        anchor.setAttribute('aria-haspopup', 'menu');
        anchor.setAttribute('aria-expanded', 'true');
        anchor.setAttribute('aria-controls', menu.element.id);
        menu.openAtRect(rect);
        // A closing More drawer may restore focus after the menu has opened. Re-enter
        // only when that restoration won, never over a later deliberate focus change.
        setTimeout(() => {
            const doc = anchor.ownerDocument;
            if (this.bodyAnchor === anchor && menu.api.open && (doc.activeElement === anchor || doc.activeElement === doc.body)) {
                menu.element.focus({ preventScroll: true });
            }
        }, 220);
    }

    /** A touch hold on a chart's price axis; `localY` selects that chart's pane. */
    openPriceScale(clientX: number, clientY: number, localY: number): void {
        if (!this.chart) return;
        this.menu.close();
        this.bodyMenu?.close();
        this.priceTouchMenu?.close();
        const boundary = this.host.closest<HTMLElement>('.vela-ui') ?? this.host;
        const menu = this.priceTouchMenu ?? this.createPriceTouchMenu(boundary);
        const win = this.host.ownerDocument.defaultView;
        const viewport = win?.visualViewport;
        const rect = boundary.getBoundingClientRect();
        const left = Math.max(rect.width ? rect.left : 0, viewport?.offsetLeft ?? 0);
        const top = Math.max(rect.height ? rect.top : 0, viewport?.offsetTop ?? 0);
        const right = Math.min(rect.width ? rect.right : (win?.innerWidth ?? 0), (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win?.innerWidth ?? 0));
        const bottom = Math.min(rect.height ? rect.bottom : (win?.innerHeight ?? 0), (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? 0));
        const width = Math.max(1, Math.min(240, right - left - 12));
        const height = Math.max(1, bottom - top - 12);
        if (right - left < 12 || bottom - top < 12) return;
        menu.element.style.setProperty('--vela-price-touch-width', `${width}px`);
        menu.element.style.setProperty('--vela-price-touch-height', `${height}px`);
        // Submenus are sibling floating layers, so their size tokens live on the shared
        // workspace host rather than on the root list.
        boundary.style.setProperty('--vela-price-touch-subwidth', `${Math.min(240, width)}px`);
        boundary.style.setProperty('--vela-price-touch-subheight', `${height}px`);
        const panes = this.chart.renderer.get('paneScales');
        this.lastPane = Array.isArray(panes) ? paneScaleAt(panes as PaneScaleInfo[], localY) : null;
        this.pointer = OFF_PLOT;
        this.lastZone = 'price-axis';
        menu.setItems(this.itemsFor('price-axis'));
        menu.openAt(Math.max(left + 6, Math.min(right - 6, clientX)), Math.max(top + 6, Math.min(bottom - 6, clientY)));
        // The anchor is a point on the chart; on rotation/scroll it is no longer valid.
        // Close rather than let the menu drift outside an embedded/zoomed workspace.
        const close = (): void => menu.close();
        win?.addEventListener('resize', close);
        const closeForScroll = (event: Event): void => {
            // A long menu's own scroll is not an anchor movement.
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('.vela-price-scale-menu, .vela-price-scale-submenu')) return;
            close();
        };
        win?.addEventListener('scroll', closeForScroll, true);
        viewport?.addEventListener('resize', close);
        viewport?.addEventListener('scroll', close);
        this.priceTouchCleanup = () => {
            win?.removeEventListener('resize', close);
            win?.removeEventListener('scroll', closeForScroll, true);
            viewport?.removeEventListener('resize', close);
            viewport?.removeEventListener('scroll', close);
        };
    }

    private createPriceTouchMenu(boundary: HTMLElement): Menu {
        injectStyles(PRICE_TOUCH_STYLE_ID, PRICE_TOUCH_CSS, this.host.ownerDocument);
        const bounded: NonNullable<MenuOptions['positioning']> = {
            strategy: 'fixed',
            boundary: () => boundary,
            flip: ['left-end', 'right-start', 'right-end', 'bottom-start', 'top-start'],
            slide: true,
            overlap: true,
            overflowPadding: 6,
            gutter: 5,
        };
        const menu = new Menu({
            host: boundary, items: [], ariaLabel: 'Price scale', placement: 'left-start',
            positioning: bounded,
            submenuPositioning: { ...bounded, flip: ['right-start', 'left-start', 'bottom-start', 'top-start'] },
            submenuClassName: 'vela-price-scale-submenu',
            checkmarks: true,
            iconBadges: true,
            onSelect: (id) => { this.priceTouchMenu?.close(); this.run(id); },
            onOpenChange: (open) => {
                if (!open) {
                    this.priceTouchCleanup?.();
                    this.priceTouchCleanup = null;
                }
            },
        });
        menu.element.classList.add('vela-price-scale-menu');
        this.priceTouchMenu = menu;
        return menu;
    }

    private createBodyMenu(boundary: HTMLElement): Menu {
        injectStyles(CHART_ACTIONS_STYLE_ID, CHART_ACTIONS_CSS, this.host.ownerDocument);
        const menu = new Menu({
            host: boundary,
            items: [],
            ariaLabel: 'Chart actions',
            placement: 'top-end',
            positioning: {
                strategy: 'fixed',
                boundary: () => boundary,
                flip: ['bottom-end', 'top-start', 'bottom-start'],
                slide: true,
                overlap: true,
                overflowPadding: 6,
                gutter: 5,
            },
            onSelect: (id) => {
                // Some rows open a modal or the sync surface. Dismiss the menu first.
                this.bodyMenu?.close();
                this.run(id);
            },
            onOpenChange: (open) => { if (!open) this.releaseBodyAnchor(); },
        });
        menu.element.classList.add('vela-chart-actions');
        this.bodyMenu = menu;
        return menu;
    }

    /** Fit a menu within the intersection of the workspace and visible viewport. */
    private bodyGeometry(anchor: HTMLElement, boundary: HTMLElement, menu: Menu): { x: number; y: number; width: number; height: number } | null {
        const win = anchor.ownerDocument.defaultView;
        const host = boundary.getBoundingClientRect();
        const visual = win?.visualViewport;
        const viewportWidth = visual?.width ?? win?.innerWidth ?? 0;
        const viewportHeight = visual?.height ?? win?.innerHeight ?? 0;
        const left = Math.max(host.width > 0 ? host.left : 0, visual?.offsetLeft ?? 0);
        const top = Math.max(host.height > 0 ? host.top : 0, visual?.offsetTop ?? 0);
        const right = Math.min(host.width > 0 ? host.right : viewportWidth, (visual?.offsetLeft ?? 0) + viewportWidth);
        const bottom = Math.min(host.height > 0 ? host.bottom : viewportHeight, (visual?.offsetTop ?? 0) + viewportHeight);
        const rect = anchor.getBoundingClientRect();
        const style = win?.getComputedStyle(anchor);
        if (!anchor.isConnected || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return null;
        if (host.width > 0 && (anchor.getClientRects().length === 0 || rect.right <= left || rect.left >= right || rect.bottom <= top || rect.top >= bottom)) return null;
        const width = Math.max(1, Math.min(224, right - left - 12));
        const above = Math.max(0, Math.min(rect.top, bottom) - top - 11);
        const below = Math.max(0, bottom - Math.max(rect.bottom, top) - 11);
        const room = Math.max(above, below);
        const height = Math.max(1, Math.min(bottom - top - 12, room > 0 ? room : bottom - top - 12));
        menu.element.style.setProperty('--vela-chart-actions-width', `${width}px`);
        menu.element.style.setProperty('--vela-chart-actions-height', `${height}px`);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }

    /** Follow a moving anchor, and release listeners as soon as it is dismissed. */
    private watchBodyAnchor(anchor: HTMLElement, boundary: HTMLElement, menu: Menu): void {
        this.releaseBodyAnchor();
        this.bodyAnchor = anchor;
        const doc = anchor.ownerDocument;
        const win = doc.defaultView;
        const reflow = (): void => {
            if (this.bodyAnchor !== anchor || !menu.api.open) return;
            const rect = this.bodyGeometry(anchor, boundary, menu);
            if (!rect) { menu.close(); return; }
            menu.api.reposition({ getAnchorRect: () => rect });
        };
        const onScroll = (e: Event): void => {
            if (e.target instanceof Node && menu.element.contains(e.target)) return;
            reflow();
        };
        const onEscape = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || !menu.api.open) return;
            e.preventDefault();
            e.stopPropagation();
            menu.close();
            if (anchor.isConnected && anchor.getClientRects().length > 0) anchor.focus({ preventScroll: true });
        };
        doc.addEventListener('scroll', onScroll, true);
        win?.addEventListener('keydown', onEscape, true);
        win?.addEventListener('resize', reflow);
        win?.visualViewport?.addEventListener('resize', reflow);
        win?.visualViewport?.addEventListener('scroll', reflow);
        const modeObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(reflow) : null;
        for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
            modeObserver?.observe(node, {
                attributes: true,
                attributeFilter: ['data-layout', 'hidden', 'style', 'class'],
                childList: node !== anchor,
            });
            if (node === boundary) break;
        }
        const sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reflow) : null;
        sizeObserver?.observe(boundary);
        sizeObserver?.observe(anchor);
        this.bodyWatch = () => {
            modeObserver?.disconnect();
            sizeObserver?.disconnect();
            doc.removeEventListener('scroll', onScroll, true);
            win?.removeEventListener('keydown', onEscape, true);
            win?.removeEventListener('resize', reflow);
            win?.visualViewport?.removeEventListener('resize', reflow);
            win?.visualViewport?.removeEventListener('scroll', reflow);
        };
    }

    private releaseBodyAnchor(): void {
        this.bodyAnchor?.setAttribute('aria-expanded', 'false');
        this.bodyAnchor?.removeAttribute('aria-controls');
        this.bodyWatch?.();
        this.bodyWatch = null;
        this.bodyAnchor = null;
    }

    destroy(): void {
        this.releaseBodyAnchor();
        this.offCrosshair?.();
        this.offCrosshair = null;
        this.host.removeEventListener('contextmenu', this.onContextMenu);
        this.bodyMenu?.destroy();
        this.bodyMenu = null;
        this.priceTouchCleanup?.();
        this.priceTouchCleanup = null;
        this.priceTouchMenu?.destroy();
        this.priceTouchMenu = null;
        this.menu.destroy();
    }

    private zoneOf(e: MouseEvent): Zone {
        const rect = this.host.getBoundingClientRect();
        if (e.clientX - rect.left > rect.width - PRICE_AXIS_W) return 'price-axis';
        if (e.clientY - rect.top > rect.height - TIME_AXIS_H) return 'time-axis';
        return 'body';
    }

    /** The pane under the pointer, so every pane's price scale has its own menu. */
    private paneAt(e: MouseEvent): PaneScaleInfo | null {
        const panes = this.chart?.renderer.get('paneScales');
        if (!Array.isArray(panes)) return null;
        return paneScaleAt(panes as PaneScaleInfo[], e.clientY - this.host.getBoundingClientRect().top);
    }

    private flag(feature: string): boolean {
        return Boolean(this.chart?.renderer.get(feature));
    }

    /** A fresh widget context carrying the pointer captured at open. Copied by property
     *  descriptor: the context's getters must stay LIVE, and a spread would freeze them. */
    private context(): WidgetContext | undefined {
        const ctx = this.cbs.getContext?.();
        if (!ctx) return undefined;
        return Object.create(Object.getPrototypeOf(ctx) as object | null, {
            ...Object.getOwnPropertyDescriptors(ctx),
            pointer: { value: this.pointer, enumerable: true },
        }) as WidgetContext;
    }

    private contributed(zone: Zone): ContributedRow[] {
        return widgetActions(`context:${zone}`, this.context()).map((a) => ({
            item: { id: `action:${a.id}`, label: a.label, icon: a.icon },
            order: a.order,
        }));
    }

    private itemsFor(zone: Zone): MenuItemDescriptor[] {
        return composeMenu(zone, this.builtinItems(zone), this.contributed(zone));
    }

    private builtinItems(zone: Zone): MenuItemDescriptor[] {
        if (zone === 'price-axis') {
            const pane = this.lastPane;
            return priceAxisItems({
                auto: this.chart?.renderer.get('autoScale') !== false,
                invert: pane ? pane.invert : this.flag('invertScale'),
                choice: scaleChoiceOf(pane ?? { mode: String(this.chart?.renderer.get('scaleMode') ?? 'price'), log: this.flag('logScale') }),
                axisLabels: this.flag('axisLabels'),
                priceLabel: this.flag('priceLabel'),
                countdown: this.flag('countdown'),
                priceLine: this.flag('currentPriceLine'),
            });
        }
        if (zone === 'time-axis') {
            this.tzScope = this.cbs.timezoneScope?.() ?? 'cell';
            return timeAxisItems(this.cbs.timezone?.() ?? String(this.chart?.renderer.get('timezone') ?? 'Etc/UTC'), {
                scope: this.tzScope,
                // A single-chart host has nothing to scope: the choice only offers "this chart".
                scoped: this.cbs.setTimezone !== undefined,
            });
        }
        const chart = this.chart;
        return bodyItems({
            drawings: chart?.drawings.supported ? chart.drawings.all().length : 0,
            indicators: chart?.indicators().length ?? 0,
            multi: this.cbs.applySettingsToAll !== undefined,
            syncing: this.cbs.chartSyncing !== undefined,
        });
    }

    private run(id: string): void {
        const chart = this.chart;
        if (!chart) return;
        if (id.startsWith('action:')) {
            const ctx = this.context();
            if (ctx) widgetActions(`context:${this.lastZone}`, ctx).find((a) => a.id === id.slice('action:'.length))?.run(ctx);
            return;
        }
        if (id.startsWith('toggle:')) {
            const feature = id.slice('toggle:'.length);
            chart.renderer.set(feature, !this.flag(feature));
        } else if (id.startsWith('scale:')) {
            for (const [feature, value] of scaleWrites(id.slice('scale:'.length) as ScaleChoice, this.lastPane)) chart.renderer.set(feature, value);
        } else if (id === 'tzscope:cell' || id === 'tzscope:all') {
            this.tzScope = id === 'tzscope:all' ? 'all' : 'cell';
            // Re-open with the new scope so the checkmarks move where the user just clicked.
            this.menu.setItems(this.itemsFor(this.lastZone));
        } else if (id.startsWith('tz:')) {
            const zone = id.slice('tz:'.length);
            if (this.cbs.setTimezone) this.cbs.setTimezone(zone, this.tzScope);
            // No host to hold (and resolve) the rule: the renderer only understands a real zone.
            else chart.renderer.set('timezone', resolveTimezone(zone, undefined));
        } else if (id === 'auto') {
            chart.renderer.set('autoScale', chart.renderer.get('autoScale') === false);
        } else if (id === 'invert') {
            const pane = this.lastPane;
            const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag('invertScale')), pane);
            chart.renderer.set(feature, value);
        } else if (id.startsWith('settings')) {
            chart.renderer.openSettings(settingsSectionOf(id));
        } else if (id === 'chart-syncing') {
            this.cbs.chartSyncing?.();
        } else if (id === 'apply-settings-all') {
            this.cbs.applySettingsToAll?.();
        } else if (id === 'reset-view') {
            this.cbs.resetView();
        } else if (id === 'remove-drawings') {
            if (chart.drawings.supported) for (const d of chart.drawings.all()) chart.drawings.remove(d.id);
        } else if (id === 'remove-indicators') {
            for (const handle of chart.indicators()) handle.remove();
        }
    }
}
