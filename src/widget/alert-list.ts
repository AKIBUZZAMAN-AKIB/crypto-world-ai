// ALERTS ACROSS THE GRID — the answer to "which chart fired what?".
//
// Every chart in the workspace can raise alerts, and until now they lived in one flat
// bell menu: fifty rows of text with no chart numbers and no way to clear one chart's
// noise. TradingView's Alert manager solves the same problem the same way (support
// 43000595311: one list, status per alert, per-row actions) with a **symbol** column;
// in a grid the useful first key is the CHART — the number you can see on screen.
//
// So this list groups by chart:
//
//   ┌ 2  BTCUSDT · 60       3 alerts   [Go] [Clear] ┐
//   │  12:30  Alert  Price crossed 71,200            │
//   │  12:04  Alert  RSI overbought                  │
//   └────────────────────────────────────────────────┘
//
// "Go" makes that chart active (the alert names the chart you should be looking at);
// "Clear" drops that chart's rows; the header clears everything. It is a dialog, not a
// menu, because the list is the point — a menu that closes on the first click cannot be
// used to work through one chart's alerts.
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';

const STYLE_ID = 'vela-widget-alert-list';
const CSS = `
.vela-al-list { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vela-al-group { margin-bottom: 10px; }
.vela-al-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px 6px;
    position: sticky;
    top: 0;
    background: var(--vela-surface-elev, var(--vela-bg));
    z-index: 1;
}
.vela-al-num {
    flex: none;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: var(--vela-surface-overlay, var(--vela-hover));
    border: 1px solid var(--vela-border-soft, var(--vela-border));
    font-size: 10.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--vela-fg-muted);
}
.vela-al-sym { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.vela-al-count { flex: none; font-size: 10.5px; color: var(--vela-fg-faint, var(--vela-fg-muted)); }
.vela-al-act {
    all: unset;
    flex: none;
    height: 26px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 6px;
    border: 1px solid var(--vela-border);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-al-act:hover { color: var(--vela-fg-bright); background: var(--vela-hover); border-color: var(--vela-border-strong, var(--vela-border)); }
.vela-al-act:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-selected-bg)); outline-offset: 1px; }
.vela-al-act .vela-icon { font-size: 12px; width: 12px; height: 12px; }
.vela-al-row {
    display: flex;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--vela-fg);
    background: var(--vela-surface-overlay, transparent);
}
.vela-al-row + .vela-al-row { margin-top: 2px; }
.vela-al-time { flex: none; font-variant-numeric: tabular-nums; color: var(--vela-fg-faint, var(--vela-fg-muted)); font-size: 11px; padding-top: 1px; }
.vela-al-body { flex: 1 1 auto; min-width: 0; }
.vela-al-title { font-weight: 600; }
.vela-al-src { color: var(--vela-fg-muted); }
.vela-al-actions {
    display: flex;
    justify-content: flex-end;
    padding: 0 0 10px;
}
.vela-al-create {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--vela-accent);
    color: var(--vela-on-accent, #0b0d12);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-al-create:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: 2px; }
.vela-al-state { flex: 0 0 auto; width: 16px; text-align: center; font-size: 11px; color: var(--vela-fg-muted); }
.vela-al-state[data-state='active'] { color: var(--vela-accent); }
.vela-al-empty { padding: 18px 6px; text-align: center; color: var(--vela-fg-muted); font-size: 12.5px; }
.vela-al-foot { display: flex; justify-content: flex-end; padding-top: 6px; border-top: 1px solid var(--vela-border-soft, var(--vela-border)); }
`;

export interface AlertEntry {
    cellId: string;
    source: string;
    title: string;
    message: string;
    time: number;
}

export interface AlertChartRef {
    id: string;
    /** The chart number the grid shows ("1"…"16"). */
    label: string;
    symbol?: string;
    timeframe?: string;
}

export interface AlertListOptions {
    doc: Document;
    /** Where the dialog mounts (the shell's root — the same host as the other dialogs). */
    host?: HTMLElement;
    /** Newest first (the shell owns insertion order). */
    getAlerts: () => readonly AlertEntry[];
    getCharts: () => readonly AlertChartRef[];
    /** Make a chart active — the "look at this" verb. */
    onGo: (cellId: string) => void;
    onClearChart: (cellId: string) => void;
    onClearAll: () => void;
    onOpenChange?: (open: boolean) => void;
    /** The Alert Manager's "+" — open the create-alert sheet. Omitted ⇒ no create verb. */
    onCreate?: () => void;
    /** Price alerts still armed (the reference's "Active" tab), newest first. */
    getArmed?: () => readonly ArmedAlertRow[];
}

/** One armed price alert, flattened for the manager's rows. */
export interface ArmedAlertRow {
    id: string;
    cellId: string;
    label: string;
    state: 'active' | 'fired' | 'paused';
    fires: number;
    onDelete: () => void;
}

export class AlertList {
    private readonly dialog: Dialog;
    private readonly body: HTMLElement;
    private readonly opts: AlertListOptions;
    /** The dialog component exposes no `isOpen` — the shell's own flag is the truth. */
    private open_ = false;

    constructor(opts: AlertListOptions) {
        this.opts = opts;
        const doc = opts.doc;
        injectStyles(STYLE_ID, CSS, doc);
        this.body = doc.createElement('div');
        this.body.className = 'vela-al-list';
        this.dialog = new Dialog({
            title: 'Alerts',
            ...(opts.host ? { host: opts.host } : {}),
            closeOnInteractOutside: true,
            content: (host) => host.appendChild(this.body),
            onOpenChange: (open) => {
                this.open_ = open;
                if (open) this.render();
                opts.onOpenChange?.(open);
            },
        });
    }

    open(): void {
        this.dialog.show();
    }

    close(): void {
        this.dialog.hide();
    }

    /** Re-render while open (a new alert arrived). */
    refresh(): void {
        if (this.isOpen) this.render();
    }

    get isOpen(): boolean {
        return this.open_;
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private render(): void {
        const doc = this.opts.doc;
        this.body.replaceChildren();
        const armed = this.opts.getArmed?.() ?? [];
        if (this.opts.onCreate) {
            const bar = doc.createElement('div');
            bar.className = 'vela-al-actions';
            const create = doc.createElement('button');
            create.type = 'button';
            create.className = 'vela-al-create';
            create.setAttribute('aria-label', 'Create alert');
            create.append(iconEl('bell', doc), doc.createTextNode('Create alert'));
            create.addEventListener('click', () => {
                this.dialog.hide();
                this.opts.onCreate?.();
            });
            bar.appendChild(create);
            this.body.appendChild(bar);
        }
        if (armed.length > 0) {
            // Armed levels lead: they are the things that are still WATCHING, and a fired
            // `once` alert leaves this list while its log row stays below.
            const section = doc.createElement('section');
            section.className = 'vela-al-group';
            section.dataset.armed = '1';
            const head = doc.createElement('div');
            head.className = 'vela-al-head';
            const num = doc.createElement('span');
            num.className = 'vela-al-num';
            num.textContent = 'ARMED';
            const count = doc.createElement('span');
            count.className = 'vela-al-count';
            const live = armed.filter((a) => a.state === 'active').length;
            count.textContent = `${live} active`;
            head.append(num, count);
            section.appendChild(head);
            for (const a of armed) {
                const row = doc.createElement('div');
                row.className = 'vela-al-row';
                row.dataset.alert = a.id;
                const badge = doc.createElement('span');
                badge.className = 'vela-al-state';
                badge.dataset.state = a.state;
                badge.textContent = a.state === 'active' ? '●' : a.state === 'fired' ? '✓' : '❙❙';
                badge.title = a.state === 'active' ? 'Active' : a.state === 'fired' ? 'Fired' : 'Paused';
                const text = doc.createElement('span');
                text.className = 'vela-al-body';
                const title = doc.createElement('span');
                title.className = 'vela-al-title';
                title.textContent = a.label;
                text.appendChild(title);
                if (a.fires > 1) {
                    const fired = doc.createElement('span');
                    fired.className = 'vela-al-src';
                    fired.textContent = ` · fired ${a.fires}×`;
                    text.appendChild(fired);
                }
                const del = doc.createElement('button');
                del.type = 'button';
                del.className = 'vela-al-act';
                del.setAttribute('aria-label', `Delete alert ${a.label}`);
                del.appendChild(iconEl('trash', doc));
                del.addEventListener('click', () => {
                    a.onDelete();
                    this.render();
                });
                row.append(badge, text, del);
                section.appendChild(row);
            }
            this.body.appendChild(section);
        }
        const alerts = this.opts.getAlerts();
        if (alerts.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-al-empty';
            empty.textContent = armed.length > 0
                ? 'Nothing has fired yet.'
                : 'No alerts yet. Alerts raised by any chart in the layout land here.';
            this.body.appendChild(empty);
            return;
        }
        const charts = this.opts.getCharts();
        // Group in CHART order (slot order = the numbers on screen), not in the order the
        // alerts happened to arrive — the list should read like the grid.
        for (const chart of charts) {
            const mine = alerts.filter((a) => a.cellId === chart.id);
            if (mine.length === 0) continue;
            const group = doc.createElement('section');
            group.className = 'vela-al-group';
            group.dataset.cell = chart.id;
            const head = doc.createElement('div');
            head.className = 'vela-al-head';
            const num = doc.createElement('span');
            num.className = 'vela-al-num';
            num.textContent = chart.label;
            const sym = doc.createElement('span');
            sym.className = 'vela-al-sym';
            sym.textContent = `${chart.symbol ?? chart.id}${chart.timeframe ? ` · ${chart.timeframe}` : ''}`;
            const count = doc.createElement('span');
            count.className = 'vela-al-count';
            count.textContent = `${mine.length} alert${mine.length === 1 ? '' : 's'}`;
            const go = doc.createElement('button');
            go.type = 'button';
            go.className = 'vela-al-act';
            go.setAttribute('aria-label', `Go to chart ${chart.label}`);
            go.append(iconEl('chevron-right', doc), doc.createTextNode('Go'));
            go.addEventListener('click', () => {
                this.opts.onGo(chart.id);
                this.dialog.hide();
            });
            const clear = doc.createElement('button');
            clear.type = 'button';
            clear.className = 'vela-al-act';
            clear.setAttribute('aria-label', `Clear alerts for chart ${chart.label}`);
            clear.append(iconEl('trash', doc), doc.createTextNode('Clear'));
            clear.addEventListener('click', () => {
                this.opts.onClearChart(chart.id);
                this.render();
            });
            head.append(num, sym, count, go, clear);
            group.appendChild(head);
            for (const a of mine) {
                const row = doc.createElement('div');
                row.className = 'vela-al-row';
                const time = doc.createElement('span');
                time.className = 'vela-al-time';
                time.textContent = new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                time.title = new Date(a.time).toLocaleString();
                const text = doc.createElement('span');
                text.className = 'vela-al-body';
                const title = doc.createElement('span');
                title.className = 'vela-al-title';
                title.textContent = `${a.title}: `;
                const msg = doc.createElement('span');
                msg.textContent = a.message;
                const src = doc.createElement('span');
                src.className = 'vela-al-src';
                src.textContent = ` · ${a.source}`;
                text.append(title, msg, src);
                row.append(time, text);
                group.appendChild(row);
            }
            this.body.appendChild(group);
        }
        const foot = doc.createElement('div');
        foot.className = 'vela-al-foot';
        const clearAll = doc.createElement('button');
        clearAll.type = 'button';
        clearAll.className = 'vela-al-act';
        clearAll.setAttribute('aria-label', 'Clear every alert');
        clearAll.append(iconEl('trash', doc), doc.createTextNode('Clear all'));
        clearAll.addEventListener('click', () => {
            this.opts.onClearAll();
            this.render();
        });
        foot.appendChild(clearAll);
        this.body.appendChild(foot);
    }
}
