// The WATCHLIST panel — TradingView's right-hand widget, the list a trader actually trades
// from. One row per market: the ticker, its venue, the last price and the day's change,
// live. Clicking a row puts that market on the active chart; the row for the chart's own
// symbol is marked so the list and the chart can never disagree about where you are.
//
// It owns no data: the shell hands it the symbol list and a {@link QuoteSource} per symbol,
// and {@link QuoteTracker} does the fetching/subscribing once for every panel that asks.
import type { OHLCV } from '../core/model/ohlcv';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { quoteOf, QuoteTracker, type Quote, type QuoteSourceFactory } from './quotes';
import { SidePanel } from './side-panel';

const STYLE_ID = 'vela-watchlist';
const CSS = `
.vela-wl { --vela-wl-row: 42px; }
.vela-wl-bar { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px; }
.vela-wl-search {
    flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 8px 0 26px;
    border: 1px solid var(--vela-border); border-radius: 6px;
    background: var(--vela-surface-sunken, var(--vela-hover)); color: var(--vela-fg-bright);
    font: inherit; font-size: 12.5px;
}
.vela-wl-search::placeholder { color: var(--vela-fg-muted); }
.vela-wl-search:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }
.vela-wl-searchwrap { position: relative; flex: 1 1 auto; min-width: 0; display: flex; }
.vela-wl-searchwrap .vela-icon {
    position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
    width: 13px; height: 13px; color: var(--vela-fg-muted); pointer-events: none;
}
.vela-wl-add {
    all: unset; flex: none; width: 28px; height: 28px; display: grid; place-items: center;
    border-radius: 6px; color: var(--vela-fg-muted); cursor: pointer;
}
.vela-wl-add:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-wl-add:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }
.vela-wl-add .vela-icon { width: 14px; height: 14px; }
.vela-wl-list { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 0 4px 8px; }
.vela-wl-row {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
    width: 100%; height: var(--vela-wl-row); padding: 0 6px 0 8px; border-radius: 6px;
    cursor: pointer; position: relative;
}
.vela-wl-row:hover { background: var(--vela-hover); }
.vela-wl-row:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-wl-row[aria-selected='true'] { background: var(--vela-hover-strong); }
.vela-wl-row[aria-selected='true']::before {
    content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px;
    border-radius: 2px; background: var(--vela-accent);
}
.vela-wl-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-wl-sym {
    font-size: 13px; font-weight: 600; color: var(--vela-fg-bright);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vela-wl-venue {
    font-size: 10.5px; letter-spacing: 0.02em; color: var(--vela-fg-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vela-wl-px {
    flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 1px;
    font-variant-numeric: tabular-nums;
}
.vela-wl-last { font-size: 12.5px; color: var(--vela-fg-bright); }
.vela-wl-chg { font-size: 11px; color: var(--vela-fg-muted); }
.vela-wl-chg[data-dir='up'] { color: var(--vela-up, #089981); }
.vela-wl-chg[data-dir='down'] { color: var(--vela-down, #f23645); }
/* The remove chip is a HOVER affordance: present for the pointer and the keyboard, out of
   the way of the reading eye. */
.vela-wl-del {
    all: unset; flex: none; width: 22px; height: 22px; display: grid; place-items: center;
    border-radius: 5px; color: var(--vela-fg-muted); cursor: pointer; opacity: 0;
}
.vela-wl-row:hover .vela-wl-del, .vela-wl-del:focus-visible { opacity: 1; }
.vela-wl-del:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-wl-del .vela-icon { width: 12px; height: 12px; }
@media (pointer: coarse) { .vela-wl-del { opacity: 1; width: 30px; } }
.vela-wl-empty { padding: 28px 16px; text-align: center; font-size: 12.5px; line-height: 1.5; color: var(--vela-fg-muted); }
.vela-wl-empty b { display: block; margin-bottom: 4px; color: var(--vela-fg-bright); font-size: 13px; }
.vela-wl-more { padding: 28px 16px; text-align: center; font-size: 12px; color: var(--vela-fg-muted); }
`;

/** The verbs a shell must supply. Everything is read live, so a panel never goes stale. */
export interface WatchlistPanelOptions {
    /** The symbols to list, in the trader's own order. */
    symbols: () => readonly string[];
    /** How to quote one symbol off-chart (the shell's feed, wrapped). */
    quote: QuoteSourceFactory;
    /** A row was clicked: put this market on the active chart. */
    onPick: (symbol: string) => void;
    /** The "+" button: open the shell's symbol search. */
    onAdd?: () => void;
    /** The row's ✕ / the sort menu's clear: drop this symbol from the list. */
    onRemove?: (symbol: string) => void;
    onClear?: () => void;
    /** The active chart's symbol, for the selected row. */
    activeSymbol?: () => string | null;
}

type Sort = 'manual' | 'symbol' | 'change-asc' | 'change-desc';

const SORTS: ReadonlyArray<readonly [Sort, string]> = [
    ['manual', 'Your order'],
    ['symbol', 'Symbol A–Z'],
    ['change-desc', 'Biggest gainers'],
    ['change-asc', 'Biggest losers'],
];

/** "BINANCE:BTCUSDT" → `{ venue: 'BINANCE', ticker: 'BTCUSDT' }`. */
export function splitSymbol(symbol: string): { venue: string | null; ticker: string } {
    const at = symbol.indexOf(':');
    if (at <= 0 || at === symbol.length - 1) return { venue: null, ticker: symbol };
    return { venue: symbol.slice(0, at).toUpperCase(), ticker: symbol.slice(at + 1) };
}

/** A price with the precision its own magnitude deserves (the shell's readouts do the same). */
function priceText(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const a = Math.abs(value);
    const dp = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
    return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function changeText(pct: number | null): string {
    if (pct == null || !Number.isFinite(pct)) return '—';
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export class WatchlistPanel extends SidePanel {
    private readonly opts: WatchlistPanelOptions;
    private readonly tracker: QuoteTracker;
    private readonly list: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly empty: HTMLElement;
    private readonly more: HTMLElement;
    private readonly rows = new Map<string, { el: HTMLElement; last: HTMLElement; change: HTMLElement; symbol: string }>();
    private readonly unsubs = new Map<string, () => void>();
    private readonly sortMenu: HTMLElement;
    private sort: Sort = 'manual';
    private filter = '';
    private active: string | null = null;
    private rendered: string[] = [];

    constructor(host: HTMLElement, opts: WatchlistPanelOptions) {
        super(host, 'Watchlist', 'vela-wl', { resizable: true, width: 252, minWidth: 208, maxWidth: 420 });
        this.opts = opts;
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.tracker = new QuoteTracker(opts.quote);
        const doc = host.ownerDocument;

        // ── the header's kebab: sorting and the destructive-clearing pair ──
        const kebab = doc.createElement('button');
        kebab.type = 'button';
        kebab.className = 'vela-panel-btn vela-wl-kebab';
        kebab.setAttribute('aria-label', 'Watchlist options');
        kebab.setAttribute('aria-haspopup', 'menu');
        kebab.appendChild(iconEl('kebab', doc));
        this.sortMenu = doc.createElement('div');
        this.sortMenu.className = 'vela-wl-sortmenu';
        this.sortMenu.hidden = true;
        kebab.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sortMenu.hidden = !this.sortMenu.hidden;
        });
        doc.addEventListener('pointerdown', (e) => {
            if (this.sortMenu.hidden) return;
            const target = e.target as Node;
            if (this.sortMenu.contains(target) || kebab.contains(target)) return;
            this.sortMenu.hidden = true;
        });
        this.headerSlot.append(kebab);

        // ── search + add ──
        const bar = doc.createElement('div');
        bar.className = 'vela-wl-bar';
        const wrap = doc.createElement('div');
        wrap.className = 'vela-wl-searchwrap';
        wrap.appendChild(iconEl('search', doc));
        this.search = doc.createElement('input');
        this.search.type = 'search';
        this.search.className = 'vela-wl-search';
        this.search.placeholder = 'Filter symbols';
        this.search.setAttribute('aria-label', 'Filter the watchlist');
        this.search.addEventListener('input', () => {
            this.filter = this.search.value.trim().toLowerCase();
            this.applyFilter();
        });
        wrap.appendChild(this.search);
        bar.appendChild(wrap);
        if (opts.onAdd) {
            const add = doc.createElement('button');
            add.type = 'button';
            add.className = 'vela-wl-add';
            add.setAttribute('aria-label', 'Add a symbol to the watchlist');
            add.title = 'Add a symbol';
            add.appendChild(iconEl('plus', doc));
            add.addEventListener('click', () => opts.onAdd?.());
            bar.appendChild(add);
        }
        this.body.appendChild(bar);
        this.body.appendChild(this.sortMenu);

        // ── the list ──
        this.list = doc.createElement('div');
        this.list.className = 'vela-wl-list';
        this.list.setAttribute('role', 'listbox');
        this.list.setAttribute('aria-label', 'Watchlist symbols');
        this.body.appendChild(this.list);
        this.empty = doc.createElement('div');
        this.empty.className = 'vela-wl-empty';
        this.empty.innerHTML = '<b>No symbols yet</b>Add one with the + above, or star a symbol in search.';
        this.body.appendChild(this.empty);
        this.more = doc.createElement('div');
        this.more.className = 'vela-wl-more';
        this.more.hidden = true;
        this.body.appendChild(this.more);

        this.list.addEventListener('keydown', (e) => this.onKey(e));
        this.refresh();
    }

    /** Re-read the shell's list (add/remove/reorder) and repaint every row. */
    refresh(): void {
        const symbols = [...this.opts.symbols()];
        const sameSet = symbols.length === this.rendered.length && symbols.every((s, i) => s === this.rendered[i]);
        this.rendered = symbols;
        if (!sameSet) this.rebuild(symbols);
        else this.paintAll();
        this.renderSortMenu();
        const empty = symbols.length === 0;
        this.empty.hidden = !empty;
        this.list.hidden = empty;
        if (empty) {
            this.empty.innerHTML =
                this.opts.onAdd
                    ? '<b>No symbols yet</b>Add one with the + above, or star a symbol in search.'
                    : '<b>No symbols yet</b>';
        }
    }

    /** The active chart's symbol — the row that answers "where am I". */
    setActive(symbol: string | null): void {
        this.active = symbol;
        for (const row of this.rows.values()) {
            const on = row.symbol === symbol || row.symbol === symbol?.split(':').pop();
            row.el.setAttribute('aria-selected', String(on));
        }
    }

    /** Repaint one symbol after the chart's own market changed. */
    repaint(symbol: string | null): void {
        if (symbol) this.paintRow(symbol);
    }

    override destroy(): void {
        for (const un of this.unsubs.values()) un();
        this.unsubs.clear();
        this.tracker.destroy();
        super.destroy();
    }

    // ── rows ────────────────────────────────────────────────────────────────────

    private rebuild(symbols: string[]): void {
        // Drop the subscriptions of the symbols that left the list.
        for (const [symbol, un] of [...this.unsubs]) {
            if (symbols.includes(symbol)) continue;
            un();
            this.unsubs.delete(symbol);
        }
        this.rows.clear();
        this.list.replaceChildren();
        for (const symbol of symbols) this.list.appendChild(this.buildRow(symbol));
        this.applyFilter();
        this.setActive(this.active ?? this.opts.activeSymbol?.() ?? null);
        this.paintAll();
    }

    private buildRow(symbol: string): HTMLElement {
        const doc = this.list.ownerDocument;
        const { venue, ticker } = splitSymbol(symbol);
        const row = doc.createElement('div');
        row.className = 'vela-wl-row';
        row.tabIndex = 0;
        row.dataset.symbol = symbol;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.setAttribute('aria-label', `Open ${ticker}${venue ? ` from ${venue}` : ''}`);

        const id = doc.createElement('span');
        id.className = 'vela-wl-id';
        const sym = doc.createElement('span');
        sym.className = 'vela-wl-sym';
        sym.textContent = ticker;
        const ven = doc.createElement('span');
        ven.className = 'vela-wl-venue';
        ven.textContent = venue ?? '\u00a0';
        id.append(sym, ven);

        const px = doc.createElement('span');
        px.className = 'vela-wl-px';
        const last = doc.createElement('span');
        last.className = 'vela-wl-last';
        last.textContent = '—';
        const change = doc.createElement('span');
        change.className = 'vela-wl-chg';
        change.textContent = '—';
        px.append(last, change);

        row.append(id, px);
        if (this.opts.onRemove) {
            const del = doc.createElement('button');
            del.type = 'button';
            del.className = 'vela-wl-del';
            del.tabIndex = -1;
            del.setAttribute('aria-label', `Remove ${ticker} from the watchlist`);
            del.title = 'Remove from the watchlist';
            del.appendChild(iconEl('close', doc));
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                this.opts.onRemove?.(symbol);
            });
            row.appendChild(del);
        }

        row.addEventListener('click', () => this.opts.onPick(symbol));
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.opts.onPick(symbol);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.opts.onRemove?.(symbol);
            }
        });

        this.rows.set(symbol, { el: row, last, change, symbol });
        // A warm quote (the tracker already knows this market) paints immediately.
        const known = this.tracker.peek(symbol);
        if (known) this.paint(symbol, known);
        const un = this.tracker.watch(symbol, 3, (q) => this.paint(symbol, q));
        this.unsubs.set(symbol, un);
        return row;
    }

    private paintAll(): void {
        for (const symbol of this.rows.keys()) this.paintRow(symbol);
    }

    private paintRow(symbol: string): void {
        const known = this.tracker.peek(symbol);
        if (known) this.paint(symbol, known);
    }

    private paint(symbol: string, quote: Quote): void {
        const row = this.rows.get(symbol);
        if (!row) return;
        row.last.textContent = priceText(quote.last);
        row.change.textContent = changeText(quote.changePct);
        const dir = quote.changePct == null ? '' : quote.changePct > 0 ? 'up' : quote.changePct < 0 ? 'down' : '';
        if (dir) row.change.dataset.dir = dir;
        else delete row.change.dataset.dir;
    }

    private applyFilter(): void {
        const needle = this.filter;
        let shown = 0;
        for (const row of this.rows.values()) {
            const hit = needle === '' || row.symbol.toLowerCase().includes(needle);
            row.el.hidden = !hit;
            if (hit) shown += 1;
        }
        const any = this.rows.size > 0 && shown === 0;
        this.more.hidden = !any;
        if (any) this.more.textContent = `Nothing matches “${this.search.value.trim()}”.`;
    }

    /** Arrow keys walk the list; the rows are a roving-tabindex listbox. */
    private onKey(e: KeyboardEvent): void {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const rows = [...this.rows.values()].filter((r) => !r.el.hidden);
        if (rows.length === 0) return;
        e.preventDefault();
        const at = rows.findIndex((r) => r.el === (e.target as HTMLElement).closest('.vela-wl-row'));
        const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at <= 0 ? 0 : at - 1);
        rows[next]!.el.focus();
    }

    // ── sorting ────────────────────────────────────────────────────────────────

    private orderedSymbols(): string[] {
        const symbols = [...this.opts.symbols()];
        if (this.sort === 'symbol') return symbols.sort((a, b) => splitSymbol(a).ticker.localeCompare(splitSymbol(b).ticker));
        if (this.sort === 'manual') return symbols;
        const pct = (s: string): number => {
            const q = this.tracker.peek(s);
            return q?.changePct ?? Number.NEGATIVE_INFINITY;
        };
        return this.sort === 'change-desc' ? symbols.sort((a, b) => pct(b) - pct(a)) : symbols.sort((a, b) => pct(a) - pct(b));
    }

    private applySort(): void {
        const order = this.orderedSymbols();
        for (const symbol of order) {
            const row = this.rows.get(symbol);
            if (row) this.list.appendChild(row.el);
        }
    }

    private renderSortMenu(): void {
        const doc = this.sortMenu.ownerDocument;
        this.sortMenu.replaceChildren();
        this.sortMenu.setAttribute('role', 'menu');
        for (const [id, label] of SORTS) {
            const item = doc.createElement('button');
            item.type = 'button';
            item.className = 'vela-wl-sortrow';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(this.sort === id));
            const check = doc.createElement('span');
            check.className = 'vela-wl-sortcheck';
            if (this.sort === id) check.appendChild(iconEl('check', doc));
            const text = doc.createElement('span');
            text.textContent = label;
            item.append(check, text);
            item.addEventListener('click', () => {
                this.sort = id;
                this.sortMenu.hidden = true;
                this.renderSortMenu();
                this.applySort();
            });
            this.sortMenu.appendChild(item);
        }
        if (this.opts.onClear) {
            const sep = doc.createElement('div');
            sep.className = 'vela-wl-sortsep';
            this.sortMenu.appendChild(sep);
            const clear = doc.createElement('button');
            clear.type = 'button';
            clear.className = 'vela-wl-sortrow vela-wl-sortrow--danger';
            clear.setAttribute('role', 'menuitem');
            clear.textContent = 'Clear the watchlist';
            clear.addEventListener('click', () => {
                this.sortMenu.hidden = true;
                this.opts.onClear?.();
            });
            this.sortMenu.appendChild(clear);
        }
    }
}

/** Sort menu row / surface styles live beside the panel's, appended once. */
injectStyles(
    `${STYLE_ID}-sort`,
    `
.vela-wl-sortmenu {
    position: absolute; z-index: 20; right: 8px; top: 40px; min-width: 190px; padding: 5px;
    background: var(--vela-surface-elev, var(--vela-bg)); color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong); border-radius: 10px;
    box-shadow: var(--vela-shadow-dialog, 0 10px 30px rgba(0,0,0,0.35)); font-size: 12.5px;
}
.vela-wl-sortmenu[hidden] { display: none !important; }
.vela-wl-sortrow {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
    width: 100%; height: 28px; padding: 0 8px; border-radius: 6px; cursor: pointer;
    color: var(--vela-fg);
}
.vela-wl-sortrow:hover { background: var(--vela-hover); }
.vela-wl-sortrow[aria-checked='true'] { color: var(--vela-fg-bright); font-weight: 600; }
.vela-wl-sortcheck { flex: none; width: 13px; height: 13px; display: grid; place-items: center; color: var(--vela-accent); }
.vela-wl-sortcheck .vela-icon { width: 13px; height: 13px; }
.vela-wl-sortsep { height: 1px; margin: 4px 6px; background: var(--vela-border); }
.vela-wl-sortrow--danger { color: var(--vela-danger, #f23645); }
`,
    typeof document === 'undefined' ? undefined : document,
);

export type { OHLCV as WatchlistBar };
export { quoteOf as watchlistQuoteOf };
