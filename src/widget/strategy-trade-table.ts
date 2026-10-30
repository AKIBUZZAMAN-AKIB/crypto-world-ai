// A bounded, native trade table. The strategy report remains the source of truth;
// only the small slice near the scroll viewport is mounted at any one time.
import type { TradeReportRow } from '../core/strategy-report';

const OVERSCAN = 6;
const MAX_MOUNTED = 100;
const ESTIMATED_DETAIL_HEIGHT = 190;
const HEADERS = ['#', 'Side', 'Entry date', 'Entry price', 'P&L', 'Total'];

export interface StrategyTradeTableOptions {
    expandedKey: string | null;
    detailId: string;
    key(row: TradeReportRow): string;
    date(row: TradeReportRow): string;
    price(row: TradeReportRow): string;
    money(value: number | null): string;
    ink(value: number | null): string;
    tooltip(row: TradeReportRow): string;
    details(row: TradeReportRow): HTMLTableRowElement;
    onExpand(key: string | null): void;
}

/** Conservative width estimate: formatted digits, separators, sign, decimals and padding.
 *  Two extra digits cover a rounded carry (999.999 → 1,000.00). */
function numberWidth(value: number | null, decimals: number): number {
    if (value == null || !Number.isFinite(value)) return 36;
    const magnitude = Math.abs(value);
    const whole = magnitude < 1 ? 1 : Math.floor(Math.log10(magnitude)) + 1;
    const digits = whole + Math.floor((whole - 1) / 3) + (decimals ? decimals + 1 : 0) + (value < 0 ? 1 : 0) + 2;
    return Math.ceil(digits * 8.5 + 20);
}

/** The rows use a fixed measured design height; a single disclosure can be taller. */
export class StrategyTradeTable {
    readonly el: HTMLElement;
    private readonly table: HTMLTableElement;
    private readonly body: HTMLTableSectionElement;
    private readonly top: HTMLTableRowElement;
    private readonly bottom: HTMLTableRowElement;
    private readonly mounted = new Map<number, HTMLTableRowElement>();
    private expandedKey: string | null;
    private expandedIndex: number;
    private detail: HTMLTableRowElement | null = null;
    private detailHeight = ESTIMATED_DETAIL_HEIGHT;
    private readonly rowHeight: number;
    private observer: ResizeObserver | null = null;
    private destroyed = false;

    constructor(
        private readonly doc: Document,
        private readonly rows: readonly TradeReportRow[],
        private readonly opts: StrategyTradeTableOptions,
    ) {
        this.rowHeight = doc.defaultView?.matchMedia?.('(pointer: coarse)').matches ? 44 : 36;
        this.expandedKey = opts.expandedKey;
        this.expandedIndex = this.findExpanded();
        if (this.expandedIndex < 0 && this.expandedKey !== null) {
            this.expandedKey = null;
            opts.onExpand(null);
        }
        this.el = doc.createElement('div');
        this.el.className = 'vela-st-scroll';
        this.el.tabIndex = 0;
        this.el.setAttribute('role', 'region');
        this.el.setAttribute('aria-label', 'Trade table. Scroll for more rows and columns. Use arrow keys, Home or End on a trade to navigate.');
        this.el.addEventListener('scroll', this.onScroll);
        this.table = doc.createElement('table');
        this.table.className = 'vela-st-table vela-st-trades';
        this.table.setAttribute('aria-label', 'Strategy trades, closed first and open last');
        this.table.setAttribute('aria-colcount', String(HEADERS.length));
        const cols = doc.createElement('colgroup');
        const widths = this.columnWidths();
        for (const width of widths) {
            const col = doc.createElement('col');
            col.style.width = `${width}px`;
            cols.appendChild(col);
        }
        this.table.style.width = `max(100%, ${widths.reduce((sum, width) => sum + width, 0)}px)`;
        const thead = doc.createElement('thead');
        const hr = doc.createElement('tr');
        hr.setAttribute('aria-rowindex', '1');
        for (const label of HEADERS) {
            const th = doc.createElement('th');
            th.scope = 'col';
            th.textContent = label;
            hr.appendChild(th);
        }
        thead.appendChild(hr);
        this.body = doc.createElement('tbody');
        this.top = this.spacer();
        this.bottom = this.spacer();
        this.body.append(this.top, this.bottom);
        this.table.append(cols, thead, this.body);
        this.el.appendChild(this.table);
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.paint());
            this.observer.observe(this.el);
        }
        this.paint();
    }

    /** Restore both axes before resolving a formerly focused virtual row. */
    restoreScroll(top: number, left: number): void {
        this.el.scrollTop = top;
        this.el.scrollLeft = left;
        this.paint();
    }

    destroy(): void {
        this.destroyed = true;
        this.el.removeEventListener('scroll', this.onScroll);
        this.observer?.disconnect();
        this.observer = null;
        this.mounted.clear();
    }

    private readonly onScroll = (): void => { this.paint(); };

    private spacer(): HTMLTableRowElement {
        const tr = this.doc.createElement('tr');
        tr.className = 'vela-st-spacer';
        tr.setAttribute('aria-hidden', 'true');
        const td = this.doc.createElement('td');
        td.colSpan = HEADERS.length;
        tr.appendChild(td);
        return tr;
    }

    private findExpanded(): number {
        return this.expandedKey == null ? -1 : this.rows.findIndex((row) => this.opts.key(row) === this.expandedKey);
    }

    private columnWidths(): number[] {
        const widths = [Math.max(52, String(this.rows.length).length * 8.5 + 32), 64, 96, 102, 98, 98];
        for (const row of this.rows) {
            widths[3] = Math.max(widths[3]!, numberWidth(row.entryPrice, Math.abs(row.entryPrice) >= 1 ? 2 : 6));
            widths[4] = Math.max(widths[4]!, numberWidth(row.pnl, 2));
            widths[5] = Math.max(widths[5]!, numberWidth(row.cumulative, 2));
        }
        return widths;
    }

    private offset(index: number): number {
        return index * this.rowHeight + (this.expandedIndex >= 0 && this.expandedIndex < index ? this.detailHeight : 0);
    }

    /** Translate a body offset into a row, including the expanded detail's variable height. */
    private rowAt(y: number): number {
        const detailStart = (this.expandedIndex + 1) * this.rowHeight;
        if (this.expandedIndex >= 0 && y >= detailStart) {
            if (y < detailStart + this.detailHeight) return this.expandedIndex;
            return Math.floor((y - this.detailHeight) / this.rowHeight);
        }
        return Math.floor(y / this.rowHeight);
    }

    private makeRow(index: number): HTMLTableRowElement {
        const row = this.rows[index]!;
        const key = this.opts.key(row);
        const tr = this.doc.createElement('tr');
        tr.className = 'vela-st-trade-row';
        tr.dataset.tradeIndex = String(index);
        const number = this.doc.createElement('td');
        const toggle = this.doc.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vela-st-trade-toggle';
        toggle.dataset.tradeKey = key;
        toggle.textContent = String(row.n);
        toggle.setAttribute('aria-label', `Trade ${row.n} details`);
        toggle.addEventListener('click', () => this.toggle(index));
        toggle.addEventListener('keydown', (event) => this.onKey(event, index));
        number.appendChild(toggle);
        tr.append(
            number,
            this.cell(row.side === 'long' ? 'Long' : 'Short', row.side === 'long' ? 'vela-st-up' : 'vela-st-down'),
            this.cell(this.opts.date(row)),
            this.cell(this.opts.price(row)),
            this.cell(this.opts.money(row.pnl), row.pnl == null ? '' : this.opts.ink(row.pnl)),
            this.cell(this.opts.money(row.cumulative), row.cumulative == null ? '' : this.opts.ink(row.cumulative)),
        );
        tr.title = this.opts.tooltip(row);
        return tr;
    }

    private cell(text: string, cls = ''): HTMLTableCellElement {
        const td = this.doc.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        return td;
    }

    private toggle(index: number): void {
        const key = this.opts.key(this.rows[index]!);
        this.expandedKey = this.expandedKey === key ? null : key;
        this.expandedIndex = this.expandedKey == null ? -1 : index;
        this.detail?.remove();
        this.detail = null;
        this.detailHeight = ESTIMATED_DETAIL_HEIGHT;
        this.opts.onExpand(this.expandedKey);
        this.paint();
        if (this.expandedIndex >= 0) this.revealDetails();
    }

    /** Arrow keys reach virtual rows even when they are not mounted yet. */
    private onKey(event: KeyboardEvent, index: number): void {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.rows.length - 1
            : Math.min(this.rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
        const head = this.table.tHead?.getBoundingClientRect().height ?? 27;
        const start = this.offset(next);
        const available = Math.max(this.rowHeight, this.el.clientHeight - head);
        if (start < this.el.scrollTop) this.el.scrollTop = start;
        else if (start + this.rowHeight > this.el.scrollTop + available) this.el.scrollTop = start + this.rowHeight - available;
        this.paint();
        this.mounted.get(next)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }

    private revealDetails(): void {
        if (!this.detail) return;
        const bounds = this.el.getBoundingClientRect();
        const detail = this.detail.getBoundingClientRect();
        const head = this.table.tHead?.getBoundingClientRect().height ?? 27;
        if (bounds.height > 0 && bounds.bottom - detail.top < Math.min(60, detail.height)) {
            this.el.scrollTop += Math.max(0, detail.top - (bounds.top + head));
            this.paint();
        }
    }

    private paint(measure = true): void {
        if (this.destroyed || this.rows.length === 0) return;
        const height = this.el.clientHeight || 256;
        const start = Math.max(0, Math.min(this.rows.length - 1, this.rowAt(this.el.scrollTop) - OVERSCAN));
        const last = this.rowAt(this.el.scrollTop + height) + OVERSCAN + 1;
        // Even an unusually tall viewport gets enough rows to cover it; the ordinary
        // bounded cap only limits overscan, never visible content.
        const cap = Math.max(MAX_MOUNTED, Math.ceil(height / this.rowHeight) + OVERSCAN * 2 + 1);
        const end = Math.min(this.rows.length, Math.max(start + 1, Math.min(start + cap, last)));
        for (const [index, node] of this.mounted) {
            if (index < start || index >= end) { node.remove(); this.mounted.delete(index); }
        }
        const detailVisible = this.expandedIndex >= start && this.expandedIndex < end;
        if (!detailVisible) this.detail?.remove();
        this.table.setAttribute('aria-rowcount', String(this.rows.length + 1 + (this.expandedIndex >= 0 ? 1 : 0)));
        let next: ChildNode | null = this.top.nextSibling;
        for (let index = start; index < end; index += 1) {
            let tr = this.mounted.get(index);
            if (!tr) {
                tr = this.makeRow(index);
                this.mounted.set(index, tr);
            }
            const expanded = index === this.expandedIndex;
            tr.setAttribute('aria-rowindex', String(index + 2 + (this.expandedIndex >= 0 && index > this.expandedIndex ? 1 : 0)));
            const button = tr.querySelector<HTMLButtonElement>('button')!;
            button.setAttribute('aria-expanded', String(expanded));
            if (expanded) button.setAttribute('aria-controls', this.opts.detailId);
            else button.removeAttribute('aria-controls');
            if (tr !== next) this.body.insertBefore(tr, next);
            next = tr.nextSibling;
            if (expanded) {
                this.detail ??= this.opts.details(this.rows[index]!);
                this.detail.setAttribute('aria-rowindex', String(index + 3));
                if (this.detail !== next) this.body.insertBefore(this.detail, next);
                next = this.detail.nextSibling;
            }
        }
        if (this.bottom !== next) this.body.insertBefore(this.bottom, next);
        this.top.cells[0]!.style.height = `${this.offset(start)}px`;
        this.bottom.cells[0]!.style.height = `${Math.max(0, this.offset(this.rows.length) - this.offset(end))}px`;
        this.top.hidden = start === 0;
        this.bottom.hidden = end >= this.rows.length;
        if (measure && detailVisible && this.detail?.isConnected) {
            const actual = this.detail.getBoundingClientRect().height;
            if (actual > 0 && Math.abs(actual - this.detailHeight) > 0.5) {
                this.detailHeight = actual;
                this.paint(false);
            }
        }
    }
}
