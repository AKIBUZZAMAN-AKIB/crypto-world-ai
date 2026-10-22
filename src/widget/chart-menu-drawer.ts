// Chart menu sheet (mobile) — what a touch long-press on the PLOT opens. It projects the
// exact rows the desktop chart-body right-click menu shows (same model, same order, same
// contributed `context:body` actions), but as a bottom sheet with thumb-sized rows: the
// desktop right-click has no touch equivalent, and a long-press has to mean ONE thing.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { bodyItems, composeMenu, settingsSectionOf, type ContributedRow } from './context-menu-model';
import { widgetActions, type ContextMenuPointer, type WidgetContext } from './contributions';
import type { MenuItemDescriptor } from '../ui/components/menu';
import type { Vela } from '../Vela';

const STYLE_ID = 'vela-widget-chart-menu-drawer';
const CSS = `
.vela-cmd-list { padding: 2px 0 4px; }
.vela-cmd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cmd-row:active { background: var(--vela-hover); }
.vela-cmd-row[data-sep='1'] { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--vela-border); border-radius: 0 0 8px 8px; }
.vela-cmd-row[data-disabled='1'] { opacity: 0.38; cursor: default; }
.vela-cmd-row[data-disabled='1']:active { background: none; }
.vela-cmd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-cmd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
`;

/** The press landed on the plot, not on a bar: the contributed actions see an empty
 *  pointer (same shape the desktop menu hands over an off-plot right-click). */
const OFF_PLOT: ContextMenuPointer = { price: null, time: null, paneKind: null };

export interface ChartMenuDrawerOptions {
    host: HTMLElement;
    /** The chart the sheet acts on — read lazily: a rebuild swaps the instance. */
    chart: () => Vela | null;
    /** Reset the view (all history, autoscale back on). */
    resetView: () => void;
    /** Multi-chart hosts: carry THIS chart's settings onto every other chart. */
    applySettingsToAll?: () => void;
    /** Multi-chart hosts: open the chart-syncing surface on this chart. */
    chartSyncing?: () => void;
    /** Live widget context for contributed `context:body` actions. */
    getContext?: () => WidgetContext | undefined;
    onOpenChange?: (open: boolean) => void;
}

export class ChartMenuDrawer {
    private readonly drawer: Drawer;

    constructor(private readonly opts: ChartMenuDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, title: 'Chart', onOpenChange: opts.onOpenChange });
    }

    open(): void {
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    /** Live widget context carrying the sheet's off-plot pointer. Copied by property
     *  descriptor so the context's getters stay LIVE (a spread would freeze them). */
    private context(): WidgetContext | undefined {
        const ctx = this.opts.getContext?.();
        if (!ctx) return undefined;
        return Object.create(Object.getPrototypeOf(ctx) as object | null, {
            ...Object.getOwnPropertyDescriptors(ctx),
            pointer: { value: OFF_PLOT, enumerable: true },
        }) as WidgetContext;
    }

    private items(): MenuItemDescriptor[] {
        const chart = this.opts.chart();
        const builtin = bodyItems({
            drawings: chart?.drawings.supported ? chart.drawings.all().length : 0,
            indicators: chart?.indicators().length ?? 0,
            multi: this.opts.applySettingsToAll !== undefined,
            syncing: this.opts.chartSyncing !== undefined,
        });
        const contributed: ContributedRow[] = widgetActions('context:body', this.context()).map((a) => ({
            item: { id: `action:${a.id}`, label: a.label, icon: a.icon },
            order: a.order,
        }));
        return composeMenu('body', builtin, contributed);
    }

    private render(): void {
        const chart = this.opts.chart();
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();
        if (!chart) return;

        const list = doc.createElement('div');
        list.className = 'vela-cmd-list';
        for (const item of this.items()) {
            const row = doc.createElement('div');
            row.className = 'vela-cmd-row';
            if (item.separatorBefore) row.dataset.sep = '1';
            if (item.disabled) row.dataset.disabled = '1';
            if (item.icon) row.appendChild(iconEl(item.icon, doc));
            const label = doc.createElement('span');
            label.className = 'vela-cmd-row-label';
            label.textContent = item.label;
            row.appendChild(label);
            if (!item.disabled) {
                row.setAttribute('role', 'button');
                row.setAttribute('aria-label', item.label);
                row.addEventListener('click', () => this.run(item.id));
            } else {
                row.setAttribute('aria-disabled', 'true');
            }
            list.appendChild(row);
        }
        this.drawer.body.appendChild(list);
    }

    /** One row picked: do its work and dismiss — every row here is a one-shot action. */
    private run(id: string): void {
        const chart = this.opts.chart();
        if (!chart) return;
        this.drawer.hide();
        if (id.startsWith('action:')) {
            const ctx = this.context();
            if (ctx) widgetActions('context:body', ctx).find((a) => a.id === id.slice('action:'.length))?.run(ctx);
            return;
        }
        if (id === 'reset-view') this.opts.resetView();
        else if (id === 'chart-syncing') this.opts.chartSyncing?.();
        else if (id === 'apply-settings-all') this.opts.applySettingsToAll?.();
        else if (id === 'remove-drawings') {
            if (chart.drawings.supported) for (const d of chart.drawings.all()) chart.drawings.remove(d.id);
        } else if (id === 'remove-indicators') {
            for (const handle of chart.indicators()) handle.remove();
        } else if (id.startsWith('settings')) {
            chart.renderer.openSettings(settingsSectionOf(id));
        }
    }
}
