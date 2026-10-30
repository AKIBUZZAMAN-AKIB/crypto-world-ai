// A bounded, semantic candle table. It reads the active renderer's replay-aware chart
// series; it never fetches more history or invents study values for other renderers.
import type { Vela } from '../Vela';
import type { OHLCV } from '../core/model/ohlcv';
import type { DataWindowTableRow, DataWindowTableSlice } from '../core/ports/IChartRenderer';
import { timeframeLabel } from './timeframe';

const ROW_HEIGHT = 32;
const OVERSCAN = 5;
const MAX_ROWS = 100;
const HEADERS = ['Date / time', 'Open', 'High', 'Low', 'Close', 'Volume'];
// The time column is measured from its actual formatted text, not a fixed 174px.
const BASE_WIDTHS = [0, 112, 112, 112, 112, 112];
const DASH = '—';
const stampFormatters = new Map<string, Intl.DateTimeFormat>();

function setText(el: Element, text: string): void {
    if (el.textContent !== text) el.textContent = text;
}

/** Fallback for a third-party renderer with bars but no formatted historical readout. */
function fallbackStamp(ms: number, zone: string): { date: string; time: string } {
    const opts: Intl.DateTimeFormatOptions = {
        timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    };
    let formatter = stampFormatters.get(zone);
    if (!formatter) {
        try { formatter = new Intl.DateTimeFormat('en-US', opts); }
        catch { formatter = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }); }
        if (stampFormatters.size >= 32) stampFormatters.delete(stampFormatters.keys().next().value!);
        stampFormatters.set(zone, formatter);
    }
    const parts = formatter.formatToParts(ms);
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00';
    const fraction = ms - Math.floor(ms / 1000) * 1000;
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}:${get('second')}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`,
    };
}

function fallbackSlice(bars: readonly OHLCV[], offset: number, count: number, zone: string): DataWindowTableSlice {
    const rows: DataWindowTableRow[] = [];
    for (let i = offset; i < Math.min(bars.length, offset + count); i += 1) {
        const bar = bars[bars.length - 1 - i]!;
        rows.push({
            timestamp: bar.time,
            ...fallbackStamp(bar.time, zone),
            ohlc: { o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), up: bar.close >= bar.open },
            volume: bar.volume != null && Number.isFinite(bar.volume) ? String(bar.volume) : null,
            values: [],
        });
    }
    return { total: bars.length, columns: [], rows };
}

/** The table view owns its own vertical and horizontal scroller, not the page. */
export class DataTable {
    readonly el: HTMLElement;
    private readonly identity: HTMLElement;
    private readonly scope: HTMLElement;
    private readonly zone: HTMLElement;
    private readonly scroll: HTMLElement;
    private readonly empty: HTMLElement;
    private readonly table: HTMLTableElement;
    private readonly head: HTMLTableRowElement;
    private readonly cols: HTMLTableColElement;
    private readonly body: HTMLTableSectionElement;
    private readonly top: HTMLTableRowElement;
    private readonly bottom: HTMLTableRowElement;
    private readonly rendered = new Map<number, HTMLTableRowElement>();
    private readonly widths: number[] = [];
    // Numeric timestamps use tabular figures, so one measurement per format shape
    // (seconds, milliseconds, etc.) is enough even while rows are virtualized.
    private readonly timeWidths = new Map<string, number>();
    private timeFontKey = '';
    private timeMarketKey = '';
    private timeWidthEstimated = false;
    private pressedRow: { row: HTMLTableRowElement; chart: Vela; timestamp: number; offset: number; invalidated: boolean } | null = null;
    private chart: Vela | null = null;
    private active = false;
    private loading = false;
    private columnKey = '';
    private newest: number | null = null;
    private observer: ResizeObserver | null = null;
    private readonly onFontsLoaded = (): void => {
        this.timeWidths.clear();
        this.timeWidthEstimated = false;
        this.widths[0] = 0;
        if (this.active) this.paint();
    };

    constructor(doc: Document) {
        this.el = doc.createElement('div');
        this.el.className = 'vela-dw-table-view vela-dw-view';
        const meta = doc.createElement('div');
        meta.className = 'vela-dw-table-meta';
        this.identity = doc.createElement('span');
        this.identity.className = 'vela-dw-table-identity';
        this.scope = doc.createElement('span');
        this.scope.className = 'vela-dw-table-scope';
        this.scope.title = 'Only bars currently loaded on the chart; replay shows revealed bars only.';
        this.zone = doc.createElement('span');
        this.zone.className = 'vela-dw-table-zone';
        meta.append(this.identity, this.scope, this.zone);
        this.scroll = doc.createElement('div');
        this.scroll.className = 'vela-dw-table-scroll';
        this.scroll.tabIndex = 0;
        this.scroll.setAttribute('role', 'region');
        this.scroll.setAttribute('aria-label', 'Candle table. Scroll vertically for older bars and horizontally for more columns.');
        this.scroll.addEventListener('scroll', () => this.paint());
        this.scroll.addEventListener('pointerdown', (event) => this.onRowPointerDown(event));
        this.scroll.addEventListener('pointercancel', () => { this.pressedRow = null; });
        this.scroll.addEventListener('click', (event) => this.onRowClick(event));
        this.empty = doc.createElement('div');
        this.empty.className = 'vela-dw-empty vela-dw-table-empty';
        this.table = doc.createElement('table');
        this.table.className = 'vela-dw-table';
        this.table.setAttribute('aria-label', 'Loaded chart candles, newest first');
        this.cols = doc.createElement('colgroup');
        const thead = doc.createElement('thead');
        this.head = doc.createElement('tr');
        this.head.setAttribute('aria-rowindex', '1');
        thead.appendChild(this.head);
        this.body = doc.createElement('tbody');
        this.top = this.spacer(doc);
        this.bottom = this.spacer(doc);
        this.body.append(this.top, this.bottom);
        this.table.append(this.cols, thead, this.body);
        this.scroll.append(this.table, this.empty);
        this.el.append(meta, this.scroll);
        doc.fonts?.addEventListener('loadingdone', this.onFontsLoaded);
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => { if (this.active) this.paint(); });
            this.observer.observe(this.scroll);
        }
    }

    private spacer(doc: Document): HTMLTableRowElement {
        const tr = doc.createElement('tr');
        tr.className = 'vela-dw-table-spacer';
        tr.setAttribute('aria-hidden', 'true');
        tr.appendChild(doc.createElement('td'));
        return tr;
    }

    onChart(chart: Vela, loading: boolean): void {
        this.loading = loading;
        if (this.chart === chart) { if (this.active) this.paint(); return; }
        this.chart = chart;
        if (this.pressedRow) this.pressedRow.invalidated = true;
        this.newest = null;
        this.scroll.scrollTop = 0;
        this.scroll.scrollLeft = 0;
        this.widths.length = 0;
        this.timeWidths.clear();
        this.timeFontKey = '';
        this.timeMarketKey = '';
        this.timeWidthEstimated = false;
        this.columnKey = '';
        this.clearRows();
        if (this.active) this.paint();
    }

    setActive(active: boolean): void {
        this.active = active;
        if (!active) this.pressedRow = null;
        if (active) this.paint();
    }

    refresh(loading: boolean): void {
        this.loading = loading;
        if (loading && this.pressedRow) this.pressedRow.invalidated = true;
        if (this.active) this.paint();
    }

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.el.ownerDocument.fonts?.removeEventListener('loadingdone', this.onFontsLoaded);
        this.pressedRow = null;
        this.chart = null;
        this.active = false;
    }

    private clearRows(): void {
        for (const row of this.rendered.values()) row.remove();
        this.rendered.clear();
    }

    private rowFromTarget(target: EventTarget | null): HTMLTableRowElement | null {
        const el = target as Element | null;
        const row = typeof el?.closest === 'function' ? el.closest<HTMLTableRowElement>('tbody tr:not(.vela-dw-table-spacer)') : null;
        return row && this.body.contains(row) ? row : null;
    }

    /** Keep the candle the user pressed, even if a live tick repaints that row before release. */
    private onRowPointerDown(event: PointerEvent): void {
        this.pressedRow = null;
        const chart = this.chart;
        const row = this.rowFromTarget(event.target);
        if (!this.active || this.loading || !chart?.renderer.supportsCandleNavigation || event.button !== 0 || !row) return;
        const timestamp = Number(row.dataset.timestamp);
        const offset = Number(row.dataset.offset);
        if (Number.isFinite(timestamp) && Number.isInteger(offset) && offset >= 0) this.pressedRow = { row, chart, timestamp, offset, invalidated: false };
    }

    /** A row can be clicked anywhere; its time button also supplies native keyboard access. */
    private onRowClick(event: MouseEvent): void {
        const pressed = this.pressedRow;
        this.pressedRow = null;
        const chart = this.chart;
        if (!this.active || this.loading || !chart?.renderer.supportsCandleNavigation || event.button !== 0) return;
        const row = this.rowFromTarget(event.target);
        if (!row) return;
        // Do not reinterpret a press after a market load, chart switch or row replacement.
        if (event.detail > 0 && pressed && (pressed.invalidated || pressed.chart !== chart || pressed.row !== row)) return;
        // Dragging across values to copy them must not unexpectedly move the chart.
        const selection = this.el.ownerDocument.getSelection();
        if (event.detail > 0 && selection && !selection.isCollapsed && selection.anchorNode && this.table.contains(selection.anchorNode)) return;
        const fromPress = event.detail > 0 && pressed?.chart === chart && pressed.row === row ? pressed : null;
        const timestamp = fromPress?.timestamp ?? Number(row.dataset.timestamp);
        const offset = fromPress?.offset ?? Number(row.dataset.offset);
        if (Number.isFinite(timestamp) && Number.isInteger(offset) && offset >= 0) chart.renderer.revealTableCandle(timestamp, offset);
    }

    /** Measure the real text with the table's current font; never truncate a timestamp. */
    private sizeTimeColumn(samples: Map<string, Element>, cell: HTMLTableCellElement): void {
        const doc = this.el.ownerDocument;
        const style = doc.defaultView?.getComputedStyle(cell);
        const key = style ? [style.font, style.fontVariantNumeric, style.letterSpacing, style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].join('|') : '';
        if (key !== this.timeFontKey) {
            this.timeFontKey = key;
            this.timeWidths.clear();
            this.timeWidthEstimated = false;
            this.widths[0] = 0;
        }
        const px = (value: string | undefined): number => Number.parseFloat(value ?? '') || 0;
        const inset = style ? px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth) : 19;
        const range = doc.createRange();
        for (const [shape, sample] of samples) {
            let width = this.timeWidths.get(shape);
            let measured = width != null;
            if (width == null) {
                range.selectNodeContents(sample);
                const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
                // Layout-less environments (and a hidden host) cannot measure text.
                // Do not cache the estimate: a later visible paint will measure for real.
                const actual = rect?.width ?? 0;
                measured = actual > 0;
                width = measured ? actual : (sample.textContent?.length ?? 0) * 6;
                if (measured) {
                    if (this.timeWidths.size >= 64) this.timeWidths.clear();
                    this.timeWidths.set(shape, width);
                }
            }
            if (measured && this.timeWidthEstimated) {
                this.widths[0] = 0; // discard an invisible host's provisional estimate
                this.timeWidthEstimated = false;
            } else if (!measured) {
                this.timeWidthEstimated = true;
            }
            this.widths[0] = Math.max(this.widths[0] ?? 0, Math.ceil(width + inset + 2));
        }
    }

    private read(offset: number, count: number, zone: string): DataWindowTableSlice | null {
        const renderer = this.chart?.renderer;
        if (!renderer) return null;
        const rich = typeof renderer.dataWindowTable === 'function' ? renderer.dataWindowTable(offset, count) : null;
        if (rich) return rich;
        const bars = typeof renderer.getBars === 'function' ? renderer.getBars() : null;
        return bars ? fallbackSlice(bars, offset, count, zone) : null;
    }

    /** Keep a reader on the same historical row when new candles arrive above it. */
    private preserveScroll(next: number | null): void {
        const previous = this.newest;
        this.newest = next;
        if (previous == null || next == null || next <= previous || this.scroll.scrollTop < ROW_HEIGHT) return;
        const bars = this.chart?.renderer.getBars?.();
        if (!bars?.length) return;
        // Latest occurrence of the prior time, so ordinary bars and duplicate-timestamp
        // transformed series both avoid an O(history length) search.
        let lo = 0;
        let hi = bars.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (bars[mid]!.time <= previous) lo = mid;
            else hi = mid - 1;
        }
        if (bars[lo]?.time === previous) {
            const added = bars.length - 1 - lo;
            if (added > 0) this.scroll.scrollTop += added * ROW_HEIGHT;
        }
    }

    private paint(): void {
        if (!this.active || !this.chart) return;
        const chart = this.chart;
        const market = chart.market;
        const rawZone = chart.renderer.get('timezone');
        const zone = typeof rawZone === 'string' && rawZone ? rawZone : 'UTC';
        const identity = [market.symbol || 'Chart', market.timeframe ? timeframeLabel(market.timeframe) : ''].filter(Boolean).join(' · ');
        const timeMarketKey = `${identity}\u0000${zone}`;
        if (timeMarketKey !== this.timeMarketKey) {
            this.timeMarketKey = timeMarketKey;
            this.timeWidths.clear();
            this.timeWidthEstimated = false;
            this.widths[0] = 0;
        }
        setText(this.identity, identity);
        this.identity.title = identity;
        setText(this.zone, zone);
        this.zone.title = zone;
        if (this.loading) {
            setText(this.scope, 'Loading…');
            this.table.hidden = true;
            this.empty.hidden = false;
            setText(this.empty, 'Loading chart data…');
            this.newest = null;
            return;
        }
        const first = this.read(0, 1, zone);
        const total = first?.total ?? 0;
        const replay = chart.replay?.state?.active === true;
        setText(this.scope, `${replay ? 'Replay · ' : ''}${total.toLocaleString('en-US')} loaded · newest first`);
        this.empty.hidden = total > 0;
        this.table.hidden = total === 0;
        if (!total || !first) {
            setText(this.empty, first ? 'No loaded candles' : 'This renderer does not provide candle history.');
            this.newest = null;
            this.clearRows();
            return;
        }
        this.preserveScroll(first.rows[0]?.timestamp ?? null);
        const height = this.scroll.clientHeight || 256;
        const start = Math.min(Math.max(0, total - 1), Math.max(0, Math.floor(this.scroll.scrollTop / ROW_HEIGHT) - OVERSCAN));
        const count = Math.min(MAX_ROWS, Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2);
        const slice = this.read(start, count, zone);
        if (!slice) return;
        const labels = [...HEADERS, ...slice.columns.map((c) => c.label)];
        const key = JSON.stringify(slice.columns);
        if (this.columnKey !== key || this.head.children.length !== labels.length) {
            this.columnKey = key;
            this.head.replaceChildren();
            this.cols.replaceChildren();
            this.widths.length = 0;
            for (const [index, label] of labels.entries()) {
                const th = this.el.ownerDocument.createElement('th');
                th.scope = 'col';
                th.textContent = label;
                th.title = label;
                if (index === 0) th.setAttribute('aria-sort', 'descending');
                this.head.appendChild(th);
                this.cols.appendChild(this.el.ownerDocument.createElement('col'));
                this.widths.push(BASE_WIDTHS[index] ?? 144);
            }
            this.clearRows();
        }
        this.table.setAttribute('aria-rowcount', String(total + 1));
        this.table.setAttribute('aria-colcount', String(labels.length));
        this.top.cells[0]!.colSpan = labels.length;
        this.bottom.cells[0]!.colSpan = labels.length;
        const end = start + slice.rows.length;
        for (const [index, node] of this.rendered) {
            if (index < start || index >= end) { node.remove(); this.rendered.delete(index); }
        }
        const navigable = chart.renderer.supportsCandleNavigation === true;
        const timeSamples = new Map<string, Element>();
        timeSamples.set(HEADERS[0]!, this.head.cells[0]!);
        let timeCell: HTMLTableCellElement | null = null;
        let next: ChildNode | null = this.top.nextSibling;
        for (const [offset, row] of slice.rows.entries()) {
            const index = start + offset;
            let tr = this.rendered.get(index);
            if (!tr) {
                tr = this.el.ownerDocument.createElement('tr');
                for (let i = 0; i < labels.length; i += 1) {
                    const td = this.el.ownerDocument.createElement('td');
                    if (i === 0 && navigable) {
                        const button = this.el.ownerDocument.createElement('button');
                        button.type = 'button';
                        button.className = 'vela-dw-time-link';
                        td.appendChild(button);
                    }
                    tr.appendChild(td);
                }
                tr.classList.toggle('vela-dw-table-navigable', navigable);
                this.rendered.set(index, tr);
            }
            tr.setAttribute('aria-rowindex', String(index + 2));
            tr.dataset.timestamp = String(row.timestamp);
            tr.dataset.offset = String(index);
            const values = [`${row.date} ${row.time}`, row.ohlc.o, row.ohlc.h, row.ohlc.l, row.ohlc.c, row.volume ?? DASH, ...row.values.map((value) => value ?? DASH)];
            for (const [i, text] of values.entries()) {
                const td = tr.cells[i]!;
                const content = i === 0 && navigable ? td.firstElementChild! : td;
                setText(content, text);
                td.title = text;
                if (i === 0) {
                    if (navigable) {
                        content.setAttribute('aria-label', `Show candle for ${text} ${zone} on chart`);
                        (content as HTMLElement).title = 'Show this candle on the chart';
                    }
                    // Tabular figures have equal digit widths; distinct punctuation and
                    // fractional-second formats get independent measurements.
                    timeSamples.set(text.replace(/[0-9]/g, '0'), content);
                    timeCell = td;
                } else {
                    // Never clip a long number; widths only grow while this chart is active.
                    this.widths[i] = Math.max(this.widths[i] ?? 0, Math.min(260, Math.ceil(text.length * 7.5 + 22)));
                }
                if (i === 4) td.dataset.direction = row.ohlc.up ? 'up' : 'down';
            }
            if (tr !== next) this.body.insertBefore(tr, next);
            next = tr.nextSibling;
        }
        if (this.bottom !== next) this.body.insertBefore(this.bottom, next);
        if (timeCell) this.sizeTimeColumn(timeSamples, timeCell);
        this.top.cells[0]!.style.height = `${start * ROW_HEIGHT}px`;
        this.bottom.cells[0]!.style.height = `${Math.max(0, total - end) * ROW_HEIGHT}px`;
        this.top.hidden = start === 0;
        this.bottom.hidden = end >= total;
        for (const [i, col] of [...this.cols.children].entries()) (col as HTMLElement).style.width = `${this.widths[i]}px`;
        this.table.style.width = `${this.widths.reduce((sum, width) => sum + width, 0)}px`;
    }
}
