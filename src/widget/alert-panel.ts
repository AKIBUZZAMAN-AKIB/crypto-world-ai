// Alerts use the same docked/phone-pane shell as Object tree and Data window. Creation,
// management and logs share the real workspace alert engine; this view owns no market data.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { MIN_FLOAT_PANEL_WIDTH, SidePanel } from './side-panel';
import { AlertSelect } from './alert-select';
import { AlertCreateForm, type AlertDrawingPrefill, type AlertFormOptions, type AlertRequest, type AlertTarget } from './alert-create';
import type { AlertChartRef, AlertEntry, ArmedAlertRow } from './alert-list';

const STYLE_ID = 'vela-widget-alert-panel';
const CSS = `
.vela-ap[data-standard-pane] .vela-panel-body { display:flex; flex-direction:column; padding:0; overflow:hidden; }
.vela-ap-tabs { display:flex; flex:none; border-bottom:1px solid var(--vela-border); min-width:0; overflow-x:auto; scrollbar-width:none; }
.vela-ap-tabs::-webkit-scrollbar { display:none; }
.vela-ap-tab { all:unset; box-sizing:border-box; position:relative; display:flex; flex:1 0 auto; align-items:center; justify-content:center; gap:5px; min-width:64px; min-height:38px; padding:0 8px; color:var(--vela-fg-muted); font-size:12px; font-weight:600; cursor:pointer; }
.vela-ap-tab:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ap-tab[aria-selected='true'] { color:var(--vela-fg-bright); }
.vela-ap-tab[aria-selected='true']::after { content:''; position:absolute; left:8px; right:8px; bottom:0; height:2px; background:var(--vela-accent); }
.vela-ap-tab:focus-visible, .vela-ap-view:focus-visible, .vela-ap-action:focus-visible, .vela-ap-filter:focus-visible { outline:2px solid var(--vela-accent-ink,var(--vela-accent)); outline-offset:-2px; }
.vela-ap-count { min-width:16px; box-sizing:border-box; padding:1px 4px; border-radius:9px; background:var(--vela-hover); color:var(--vela-fg-muted); font-size:10px; text-align:center; }
.vela-ap-count[hidden], .vela-ap-view[hidden], .vela-ap-section[hidden], .vela-ap-manage-head[hidden], .vela-ap-editor[hidden] { display:none !important; }
.vela-ap-view { flex:1 1 auto; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding:10px; }
.vela-ap[data-compact-height='1'] .vela-panel-body { overflow:auto; }
.vela-ap[data-compact-height='1'] .vela-ap-view { flex:none; overflow:visible; }
.vela-ap-view::-webkit-scrollbar { width:8px; }
.vela-ap-view::-webkit-scrollbar-thumb { background:var(--vela-scroll); border:2px solid transparent; background-clip:padding-box; border-radius:4px; }
.vela-ap-section { border-top:1px solid var(--vela-border); }
.vela-ap-manage-head, .vela-ap-log-head, .vela-ap-editor-head { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:38px; color:var(--vela-fg-muted); font-size:11px; }
.vela-ap-manage-head { margin-bottom:6px; }
.vela-ap-manage-title { min-width:0; display:flex; flex-direction:column; gap:2px; }
.vela-ap-manage-head strong, .vela-ap-log-head strong, .vela-ap-editor-head strong { color:var(--vela-fg-bright); font-size:12px; }
.vela-ap-filter { box-sizing:border-box; max-width:54%; min-height:34px; padding:0 6px; border:1px solid var(--vela-border); border-radius:4px; background:var(--vela-surface-elev,var(--vela-bg)); color:var(--vela-fg-bright); font:inherit; font-size:12px; cursor:pointer; }
.vela-ap-status { color:var(--vela-fg-muted); font-size:11px; line-height:1.4; }
.vela-ap-status:not(:empty) { margin:0 0 8px; }
.vela-ap-empty { padding:15px 4px; color:var(--vela-fg-muted); font-size:12px; line-height:1.45; }
.vela-ap-armed-row { display:grid; grid-template-columns:9px minmax(0,1fr); column-gap:8px; min-width:0; padding:10px 0 6px; border-bottom:1px solid var(--vela-border); }
.vela-ap-state-dot { margin-top:5px; width:7px; height:7px; border:1px solid var(--vela-fg-muted); border-radius:50%; }
.vela-ap-state-dot[data-state='active'] { background:var(--vela-accent-ink,var(--vela-accent)); border-color:var(--vela-accent-ink,var(--vela-accent)); }
.vela-ap-armed-text { min-width:0; }
.vela-ap-armed-title { display:block; color:var(--vela-fg-bright); font-size:12px; font-weight:600; line-height:1.35; overflow-wrap:anywhere; }
.vela-ap-meta { display:block; margin-top:4px; color:var(--vela-fg-muted); font-size:11px; line-height:1.4; overflow-wrap:anywhere; }
.vela-ap-row-actions { grid-column:2; display:flex; flex-wrap:wrap; gap:2px; margin:4px -4px 0; }
.vela-ap-confirm { display:flex; flex-wrap:wrap; align-items:center; gap:2px; color:var(--vela-fg); font-size:11px; }
.vela-ap-action { all:unset; box-sizing:border-box; flex:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; min-width:30px; min-height:30px; padding:0 6px; border-radius:4px; color:var(--vela-fg-muted); font-size:11px; font-weight:600; cursor:pointer; }
.vela-ap-action:hover:not(:disabled) { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ap-action:disabled { color:var(--vela-mono-muted,var(--vela-fg-muted)); opacity:1; cursor:not-allowed; }
html.vela-premium .vela-ap .vela-ap-action:disabled { opacity:1; cursor:not-allowed; }
.vela-ap-action .vela-icon { width:15px; height:15px; font-size:15px; }
.vela-ap-editor-head { margin:-3px 0 8px; }
.vela-ap-log-head { margin:-2px 0 6px; }
.vela-ap-group { border:1px solid var(--vela-border); margin-bottom:8px; min-width:0; }
.vela-ap-group-head { display:flex; align-items:center; gap:4px; min-width:0; padding:5px 6px 5px 8px; background:var(--vela-surface-elev,var(--vela-bg)); border-bottom:1px solid var(--vela-border); }
.vela-ap-group-title { flex:1 1 auto; min-width:0; font-size:12px; font-weight:700; color:var(--vela-fg-bright); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vela-ap-group-count { flex:none; color:var(--vela-fg-muted); font-size:10px; }
.vela-ap-log-row { min-width:0; padding:9px 10px; font-size:12px; line-height:1.4; overflow-wrap:anywhere; }
.vela-ap-log-row + .vela-ap-log-row { border-top:1px solid var(--vela-border); }
.vela-ap-log-time { display:block; margin-bottom:3px; color:var(--vela-fg-muted); font-size:10.5px; font-variant-numeric:tabular-nums; }
.vela-ap-log-title { color:var(--vela-fg-bright); font-weight:700; }
.vela-ap-log-source { display:block; margin-top:3px; color:var(--vela-fg-muted); font-size:11px; overflow-wrap:anywhere; }
@media (pointer:coarse) { .vela-ap-tab, .vela-ap-filter { min-height:44px; } .vela-ap-action { min-height:44px; min-width:44px; } }
`;

export interface AlertEditDraft { request: AlertRequest; target: AlertTarget; sourceLabel?: string }
export interface AlertPanelOptions extends Omit<AlertFormOptions, 'host' | 'mode'> {
    getAlerts: () => readonly AlertEntry[];
    getCharts: () => readonly AlertChartRef[];
    getArmed: () => readonly ArmedAlertRow[];
    onBeginEdit: (id: string) => AlertEditDraft | null;
    onSaveEdit: (id: string, request: AlertRequest, target: AlertTarget) => boolean;
    onToggleAlert: (id: string) => boolean;
    onGo: (cellId: string) => void;
    onClearChart: (cellId: string) => void;
    onClearAll: () => void;
}

type Tab = 'create' | 'alerts' | 'log';
type Filter = 'all' | 'active' | 'paused' | 'fired';
const TAB_ORDER: readonly Tab[] = ['create', 'alerts', 'log'];
let panelSequence = 0;

export class AlertPanel extends SidePanel {
    private readonly opts: AlertPanelOptions;
    private readonly form: AlertCreateForm;
    private editForm: AlertCreateForm | null = null;
    private editingId: string | null = null;
    private confirmingId: string | null = null;
    private readonly tabs = new Map<Tab, HTMLButtonElement>();
    private readonly views = new Map<Tab, HTMLElement>();
    private readonly armed: HTMLElement;
    private readonly manageHead: HTMLElement;
    private readonly manageSummary: HTMLElement;
    private readonly filter: HTMLSelectElement;
    private readonly filterControl: AlertSelect;
    private readonly editor: HTMLElement;
    private readonly status: HTMLElement;
    private readonly log: HTMLElement;
    private readonly alertsCount: HTMLElement;
    private readonly logCount: HTMLElement;
    private selected: Tab = 'create';
    private armedSignature = '';
    private logSignature = '';
    private scrollUntil = 0;
    private pending: ReturnType<typeof setTimeout> | null = null;
    private pointer: number | null = null;
    private pointerRefresh = false;
    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (event.pointerId === this.pointer) this.finishPointer();
    };
    private readonly onWindowBlur = (): void => { if (this.pointer != null) this.finishPointer(); };
    private finishPointer(): void {
        this.pointer = null;
        if (!this.pointerRefresh) return;
        this.pointerRefresh = false;
        // Let the release/click and any native momentum finish before replacing rows.
        this.scrollUntil = Math.max(this.scrollUntil, Date.now() + 180);
        this.schedule();
    }

    constructor(host: HTMLElement, opts: AlertPanelOptions) {
        super(host, 'Alerts', 'vela-ap', { resizable: true, width: 340, minWidth: MIN_FLOAT_PANEL_WIDTH, maxWidth: 560, standardPane: true, mobileMinHeight: 216 });
        this.opts = opts;
        const doc = host.ownerDocument;
        const id = ++panelSequence;
        injectStyles(STYLE_ID, CSS, doc);
        const tablist = doc.createElement('div');
        tablist.className = 'vela-ap-tabs';
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Alerts');
        this.alertsCount = doc.createElement('span');
        this.alertsCount.className = 'vela-ap-count';
        this.alertsCount.setAttribute('aria-hidden', 'true');
        this.logCount = doc.createElement('span');
        this.logCount.className = 'vela-ap-count';
        this.logCount.setAttribute('aria-hidden', 'true');
        for (const [key, label] of [['create', 'Create'], ['alerts', 'Alerts'], ['log', 'Log']] as const) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'vela-ap-tab';
            button.dataset.tab = key;
            button.id = `vela-ap-${id}-tab-${key}`;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', `vela-ap-${id}-view-${key}`);
            button.appendChild(doc.createTextNode(label));
            if (key === 'alerts') button.appendChild(this.alertsCount);
            if (key === 'log') button.appendChild(this.logCount);
            button.addEventListener('click', () => this.select(key));
            button.addEventListener('keydown', (event) => {
                const index = TAB_ORDER.indexOf(key);
                const next = event.key === 'Home' ? TAB_ORDER[0] : event.key === 'End' ? TAB_ORDER[TAB_ORDER.length - 1]
                    : event.key === 'ArrowLeft' ? TAB_ORDER[(index + TAB_ORDER.length - 1) % TAB_ORDER.length]
                        : event.key === 'ArrowRight' ? TAB_ORDER[(index + 1) % TAB_ORDER.length] : undefined;
                if (!next) return;
                event.preventDefault();
                this.select(next, true);
            });
            this.tabs.set(key, button);
            tablist.appendChild(button);
            const view = doc.createElement('div');
            view.className = `vela-ap-view vela-ap-${key}-view`;
            view.id = `vela-ap-${id}-view-${key}`;
            view.tabIndex = 0;
            view.setAttribute('role', 'tabpanel');
            view.setAttribute('aria-labelledby', button.id);
            // A live alert must not replace content under a finger or cancel a native
            // momentum scroll. Repaint after the scroll has been idle for 180 ms.
            view.addEventListener('pointerdown', (event) => { this.pointer = event.pointerId; });
            view.addEventListener('scroll', () => {
                this.scrollUntil = Date.now() + 180;
                if (this.pending) this.schedule();
            }, { passive: true });
            this.views.set(key, view);
        }
        doc.defaultView?.addEventListener('pointerup', this.onPointerEnd);
        doc.defaultView?.addEventListener('pointercancel', this.onPointerEnd);
        doc.defaultView?.addEventListener('blur', this.onWindowBlur);
        const createView = this.views.get('create')!;
        this.form = new AlertCreateForm({ host: createView, target: opts.target, drawingLevel: opts.drawingLevel, onCreate: opts.onCreate });
        const alertsView = this.views.get('alerts')!;
        this.manageHead = doc.createElement('div');
        this.manageHead.className = 'vela-ap-manage-head';
        const title = doc.createElement('div');
        title.className = 'vela-ap-manage-title';
        const strong = doc.createElement('strong');
        strong.textContent = 'Price alerts';
        this.manageSummary = doc.createElement('span');
        title.append(strong, this.manageSummary);
        this.filter = doc.createElement('select');
        this.filter.className = 'vela-ap-filter';
        this.filter.setAttribute('aria-label', 'Filter alerts by status');
        for (const [value, label] of [['all', 'All statuses'], ['active', 'Active'], ['paused', 'Paused'], ['fired', 'Triggered']] as const) {
            const option = doc.createElement('option'); option.value = value; option.textContent = label; this.filter.appendChild(option);
        }
        this.filter.addEventListener('change', () => { this.confirmingId = null; this.armedSignature = ''; this.refresh(); });
        this.manageHead.append(title, this.filter);
        this.filterControl = new AlertSelect(this.filter, true);
        this.status = doc.createElement('div');
        this.status.className = 'vela-ap-status';
        this.status.setAttribute('role', 'status');
        this.armed = doc.createElement('section');
        this.armed.className = 'vela-ap-section';
        this.armed.setAttribute('aria-label', 'Created price alerts');
        this.editor = doc.createElement('div');
        this.editor.className = 'vela-ap-editor';
        this.editor.hidden = true;
        alertsView.append(this.manageHead, this.status, this.armed, this.editor);
        this.log = doc.createElement('div');
        this.log.className = 'vela-ap-log';
        this.views.get('log')!.appendChild(this.log);
        this.body.append(tablist, createView, alertsView, this.views.get('log')!);
        this.select('create');
    }

    private select(tab: Tab, focus = false): void {
        this.selected = tab;
        for (const [name, button] of this.tabs) {
            const active = name === tab;
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            this.views.get(name)!.hidden = !active;
        }
        this.refresh();
        if (focus) this.tabs.get(tab)?.focus();
    }

    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (open && this.open) this.refresh();
        if (!open && this.pending) { clearTimeout(this.pending); this.pending = null; }
    }

    /** Open the Create tab on a fresh active-chart or drawing-backed draft. */
    createOnActive(prefill?: AlertDrawingPrefill): void {
        this.form.bind(prefill);
        this.select('create');
    }

    /** Update price/drawing hints without rebuilding any list on a market tick. */
    refreshTarget(): void { if (this.open) { this.form.refresh(); this.editForm?.refresh(); } }

    /** A replay jump changes the chart's time without changing its market identity. */
    refreshReplay(): void {
        this.form.reseedUntouchedPrice();
        this.refresh();
    }

    /** Cancel an edit when a restored document replaces the underlying runtime IDs. */
    cancelEdit(): void {
        this.confirmingId = null;
        if (!this.editingId) return;
        this.editingId = null;
        this.editForm?.destroy();
        this.editForm = null;
        this.editor.replaceChildren();
        this.editor.hidden = true;
        this.manageHead.hidden = false;
        this.armed.hidden = false;
    }

    private beginEdit(id: string): void {
        const draft = this.opts.onBeginEdit(id);
        if (!draft) { this.status.textContent = 'The alert cannot be edited until its chart, market and drawing are ready.'; return; }
        this.confirmingId = null;
        this.editingId = id;
        this.status.textContent = '';
        this.editor.replaceChildren();
        const head = this.el.ownerDocument.createElement('div');
        head.className = 'vela-ap-editor-head';
        const title = this.el.ownerDocument.createElement('strong');
        title.textContent = 'Edit alert';
        const cancel = this.action('chevron-left', 'Cancel editing alert', () => {
            this.cancelEdit(); this.refresh(); this.focusRowAction(`edit:${id}`);
        }, 'Cancel');
        head.append(title, cancel);
        const formHost = this.el.ownerDocument.createElement('div');
        this.editor.append(head, formHost);
        this.editForm = new AlertCreateForm({
            host: formHost, target: this.opts.target, drawingLevel: this.opts.drawingLevel, mode: 'edit',
            onCreate: (request, target) => {
                if (this.editingId !== id || !this.opts.onSaveEdit(id, request, target)) return false;
                this.cancelEdit();
                this.status.textContent = 'Alert updated.';
                this.refresh();
                this.focusRowAction(`edit:${id}`);
                return true;
            },
        });
        this.editForm.bindEdit(draft.request, draft.target, draft.sourceLabel);
        this.manageHead.hidden = true;
        this.armed.hidden = true;
        this.editor.hidden = false;
        this.views.get('alerts')!.scrollTop = 0;
        cancel.focus({ preventScroll: true });
    }

    private focusRowAction(key: string): void {
        const action = Array.from(this.armed.querySelectorAll<HTMLElement>('[data-focus-key]')).find((el) => el.dataset.focusKey === key);
        if (action) action.focus({ preventScroll: true });
        else this.filterControl.focus();
    }

    /** Update in place; a tick never rebuilds the form or steals keyboard focus. */
    refresh(): void {
        if (!this.open) return;
        this.form.refresh();
        this.editForm?.refresh();
        const armed = this.opts.getArmed();
        if (this.editingId && !armed.some((row) => row.id === this.editingId)) {
            this.cancelEdit();
            this.status.textContent = 'The alert is no longer available.';
        }
        const count = armed.length;
        this.alertsCount.hidden = count === 0;
        this.alertsCount.textContent = count > 99 ? '99+' : String(count);
        this.tabs.get('alerts')!.setAttribute('aria-label', count ? `Alerts, ${count} price alert${count === 1 ? '' : 's'}` : 'Alerts');
        const logCount = this.opts.getAlerts().length;
        this.logCount.hidden = logCount === 0;
        this.logCount.textContent = logCount > 99 ? '99+' : String(logCount);
        this.tabs.get('log')!.setAttribute('aria-label', logCount ? `Log, ${logCount} entr${logCount === 1 ? 'y' : 'ies'}` : 'Log');
        this.manageSummary.textContent = `${count} total · ${armed.filter((row) => row.state === 'active').length} active`;
        if (this.pointer != null) { this.pointerRefresh = true; return; }
        if (Date.now() < this.scrollUntil) { this.schedule(); return; }
        this.paintLists(armed);
    }

    private schedule(): void {
        if (this.pending) clearTimeout(this.pending);
        this.pending = setTimeout(() => { this.pending = null; if (this.open) this.refresh(); }, Math.max(0, this.scrollUntil - Date.now()) + 4);
    }

    private paintLists(armed: readonly ArmedAlertRow[]): void {
        const charts = this.opts.getCharts();
        const armedSignature = JSON.stringify([armed.map(({ id, cellId, label, state, fires, offChart, waitingChart, waitingDrawing, waitingMarket, frequency, drawingSource, editUnavailable }) => [id, cellId, label, state, fires, offChart, waitingChart, waitingDrawing, waitingMarket, frequency, drawingSource, editUnavailable]), charts.map(({ id, label }) => [id, label]), this.filter.value, this.confirmingId]);
        const alerts = this.opts.getAlerts();
        const logSignature = JSON.stringify([alerts, charts]);
        if (armedSignature !== this.armedSignature) {
            this.armedSignature = armedSignature;
            this.replacePreservingFocus(this.armed, () => this.renderArmed(armed, charts));
        }
        if (logSignature !== this.logSignature) {
            this.logSignature = logSignature;
            this.replacePreservingFocus(this.log, () => this.renderLog(alerts, charts));
        }
    }

    /** Keep a focused list action and its reading anchor when another chart fires. */
    private replacePreservingFocus(host: HTMLElement, render: () => void): void {
        const active = host.ownerDocument.activeElement as HTMLElement | null;
        const key = active && host.contains(active) ? active.dataset.focusKey : undefined;
        const view = host.closest<HTMLElement>('.vela-ap-view');
        const previousScroll = view?.scrollTop ?? 0;
        const edge = view?.getBoundingClientRect().top ?? 0;
        const anchor = previousScroll > 0 ? Array.from(host.querySelectorAll<HTMLElement>('[data-anchor]'))
            .find((el) => el.getBoundingClientRect().bottom > edge) : undefined;
        const anchorKey = anchor?.dataset.anchor;
        const anchorTop = anchor?.getBoundingClientRect().top;
        render();
        if (view) {
            view.scrollTop = previousScroll;
            const replacement = anchorKey == null ? undefined : Array.from(host.querySelectorAll<HTMLElement>('[data-anchor]')).find((el) => el.dataset.anchor === anchorKey);
            if (replacement && anchorTop != null) view.scrollTop += replacement.getBoundingClientRect().top - anchorTop;
        }
        if (!key) return;
        const same = Array.from(host.querySelectorAll<HTMLElement>('[data-focus-key]')).find((el) => el.dataset.focusKey === key);
        (same ?? this.tabs.get(this.selected))?.focus({ preventScroll: true });
    }

    private renderArmed(rows: readonly ArmedAlertRow[], charts: readonly AlertChartRef[]): void {
        const doc = this.el.ownerDocument;
        this.armed.replaceChildren();
        const filter = this.filter.value as Filter;
        const visible = filter === 'all' ? rows : rows.filter((row) => row.state === filter);
        if (!visible.length) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ap-empty';
            empty.textContent = !rows.length ? 'No price alerts yet. Create one to watch this chart.' : `No ${filter === 'fired' ? 'triggered' : filter} alerts.`;
            this.armed.appendChild(empty);
            return;
        }
        for (const row of visible) {
            const item = doc.createElement('div');
            item.className = 'vela-ap-armed-row';
            item.dataset.alert = row.id;
            item.dataset.anchor = `armed:${row.id}`;
            const dot = doc.createElement('span');
            dot.className = 'vela-ap-state-dot';
            dot.dataset.state = row.state;
            dot.setAttribute('aria-hidden', 'true');
            const text = doc.createElement('div');
            text.className = 'vela-ap-armed-text';
            const label = doc.createElement('span');
            label.className = 'vela-ap-armed-title';
            label.textContent = row.label;
            const meta = doc.createElement('span');
            meta.className = 'vela-ap-meta';
            const chart = charts.find((c) => c.id === row.cellId);
            const status = row.state === 'active' ? 'Active' : row.state === 'fired' ? 'Triggered' : 'Paused';
            meta.textContent = [chart ? `Chart ${chart.label}` : `Chart ${row.cellId}`, status,
                row.frequency === 'each' ? 'Every time' : row.frequency === 'once' ? 'Once only' : '',
                row.drawingSource ? 'Drawing' : '',
                row.fires > 0 && row.state !== 'fired' ? `Triggered ${row.fires}×` : row.fires > 1 ? `${row.fires}×` : '',
                row.waitingChart ? 'Waiting for chart' : row.waitingMarket ? 'Waiting for chart to load' : row.offChart ? `Waiting for ${row.offChart}` : row.waitingDrawing ? 'Waiting for drawing' : ''].filter(Boolean).join(' · ');
            text.append(label, meta);
            const actions = doc.createElement('div');
            actions.className = 'vela-ap-row-actions';
            if (this.confirmingId === row.id) {
                const confirm = doc.createElement('span');
                confirm.className = 'vela-ap-confirm';
                confirm.textContent = 'Delete this alert?';
                const yes = this.action('trash', `Confirm delete alert ${row.label}`, () => {
                    this.confirmingId = null; row.onDelete(); this.status.textContent = 'Alert deleted.'; this.refresh();
                }, 'Delete');
                yes.dataset.focusKey = `delete:${row.id}`;
                const no = this.action('close', `Cancel delete alert ${row.label}`, () => {
                    this.confirmingId = null; this.refresh();
                }, 'Cancel');
                // Cancelling restores focus to the original Delete control.
                no.dataset.focusKey = `delete:${row.id}`;
                confirm.append(yes, no); actions.appendChild(confirm);
            } else {
                const edit = this.action('pen', `Edit alert ${row.label}`, () => this.beginEdit(row.id), 'Edit');
                edit.dataset.focusKey = `edit:${row.id}`;
                if (row.editUnavailable) { edit.disabled = true; edit.title = row.editUnavailable; }
                const verb = row.state === 'active' ? 'Pause' : row.state === 'fired' ? 'Re-arm' : 'Resume';
                const toggle = this.action(row.state === 'active' ? 'pause' : 'play', `${verb} alert ${row.label}`, () => {
                    const changed = this.opts.onToggleAlert(row.id);
                    this.status.textContent = changed ? `Alert ${row.state === 'active' ? 'paused' : 'armed'}.` : 'The alert is no longer available.';
                    this.refresh();
                }, verb);
                toggle.dataset.focusKey = `toggle:${row.id}`;
                actions.append(edit, toggle);
                if (chart) {
                    const go = this.action('chevron-right', `Go to chart ${chart.label} for ${row.label}`, () => this.opts.onGo(row.cellId), 'Chart');
                    go.dataset.focusKey = `chart:${row.id}`;
                    actions.appendChild(go);
                }
                const del = this.action('trash', `Delete alert ${row.label}`, () => { this.confirmingId = row.id; this.refresh(); }, 'Delete');
                del.dataset.focusKey = `delete:${row.id}`;
                actions.appendChild(del);
            }
            item.append(dot, text, actions);
            this.armed.appendChild(item);
        }
    }

    private action(icon: string, label: string, click: () => void, text = ''): HTMLButtonElement {
        const b = this.el.ownerDocument.createElement('button');
        b.type = 'button';
        b.className = 'vela-ap-action';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.appendChild(iconEl(icon, this.el.ownerDocument));
        if (text) b.appendChild(this.el.ownerDocument.createTextNode(text));
        b.addEventListener('click', click);
        return b;
    }

    private renderLog(entries: readonly AlertEntry[], charts: readonly AlertChartRef[]): void {
        const doc = this.el.ownerDocument;
        this.log.replaceChildren();
        const head = doc.createElement('div');
        head.className = 'vela-ap-log-head';
        const title = doc.createElement('strong');
        title.textContent = 'Triggered alerts';
        title.title = 'Recent events in this session';
        head.appendChild(title);
        if (entries.length) {
            const clear = this.action('trash', 'Clear every alert log entry', () => { this.opts.onClearAll(); this.refresh(); }, 'Clear all');
            clear.dataset.focusKey = 'clear-all';
            head.appendChild(clear);
        }
        this.log.appendChild(head);
        if (!entries.length) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ap-empty';
            empty.textContent = 'Nothing has triggered yet. Price and script alerts from this layout appear here.';
            this.log.appendChild(empty);
            return;
        }
        // Charts still in the layout first, then orphaned/hidden chart IDs. No logged
        // event disappears just because its chart was removed or the layout got smaller.
        const ids = [...charts.map((c) => c.id).filter((id) => entries.some((entry) => entry.cellId === id))];
        for (const entry of entries) if (!ids.includes(entry.cellId)) ids.push(entry.cellId);
        for (const id of ids) {
            const chart = charts.find((c) => c.id === id);
            const mine = entries.filter((entry) => entry.cellId === id);
            const group = doc.createElement('section');
            group.className = 'vela-ap-group';
            group.dataset.cell = id;
            const groupHead = doc.createElement('div');
            groupHead.className = 'vela-ap-group-head';
            const name = doc.createElement('span');
            name.className = 'vela-ap-group-title';
            name.textContent = chart ? `Chart ${chart.label}${chart.symbol ? ` · ${chart.symbol}` : ''}` : `Chart ${id} · not in layout`;
            name.title = name.textContent;
            const count = doc.createElement('span');
            count.className = 'vela-ap-group-count';
            count.textContent = String(mine.length);
            groupHead.append(name, count);
            if (chart) {
                const go = this.action('chevron-right', `Go to chart ${chart.label}`, () => this.opts.onGo(id));
                go.dataset.focusKey = `go:${id}`;
                groupHead.appendChild(go);
            }
            const clear = this.action('trash', chart ? `Clear alerts for chart ${chart.label}` : `Clear alerts for chart ${id}`, () => { this.opts.onClearChart(id); this.refresh(); });
            clear.dataset.focusKey = `clear:${id}`;
            groupHead.appendChild(clear);
            group.appendChild(groupHead);
            const occurrences = new Map<string, number>();
            for (const entry of mine) {
                const row = doc.createElement('div');
                row.className = 'vela-ap-log-row';
                const key = JSON.stringify([entry.cellId, entry.time, entry.source, entry.title, entry.message]);
                const occurrence = occurrences.get(key) ?? 0;
                occurrences.set(key, occurrence + 1);
                row.dataset.anchor = `log:${key}:${occurrence}`;
                const time = doc.createElement('time');
                time.className = 'vela-ap-log-time';
                const when = new Date(entry.time);
                if (Number.isFinite(when.getTime())) {
                    time.dateTime = when.toISOString();
                    time.textContent = when.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    time.title = when.toLocaleString();
                } else time.textContent = 'Time unavailable';
                const message = doc.createElement('div');
                const titleEl = doc.createElement('span');
                titleEl.className = 'vela-ap-log-title';
                titleEl.textContent = `${entry.title}: `;
                message.append(titleEl, doc.createTextNode(entry.message));
                const source = doc.createElement('span');
                source.className = 'vela-ap-log-source';
                source.textContent = entry.source;
                row.append(time, message, source);
                group.appendChild(row);
            }
            this.log.appendChild(group);
        }
    }

    override destroy(): void {
        this.form.destroy();
        this.editForm?.destroy();
        this.filterControl.destroy();
        if (this.pending) clearTimeout(this.pending);
        this.pending = null;
        this.el.ownerDocument.defaultView?.removeEventListener('pointerup', this.onPointerEnd);
        this.el.ownerDocument.defaultView?.removeEventListener('pointercancel', this.onPointerEnd);
        this.el.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
        super.destroy();
    }
}
