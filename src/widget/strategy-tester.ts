// Strategy Tester — the backtest report for the strategy running on the bound chart.
// A docked side panel (the object tree's and data window's sibling) with the reference
// platform's four readings of one run:
//
//   Overview     key stats + the cumulative-P&L curve
//   Performance  every metric, in All / Long / Short columns
//   Trades       one row per round trip, with the running total
//   Properties   what the strategy DECLARED (initial capital, commission, inputs)
//
// It owns no math: `buildStrategyReport` turns the run's broker state and ledger into
// numbers, and this file only formats and lays them out — so a wrong column is a test
// failure in the model, never a rendering mystery. The panel subscribes to `script:run`
// and re-reads the ledger (an async call the engine makes cheap) whenever a run lands,
// ignoring a late answer that a newer run has already superseded.
import type { Vela } from '../Vela';
import type { ScriptRun } from '../core/script-run';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import type { InputSchema } from '../core/model/inputs';
import { buildStrategyReport, type ReportStats, type StrategyReport, type TradeReportRow } from '../core/strategy-report';
import { BEARISH, BULLISH, NEUTRAL } from '../core/palette';
import { injectStyles } from '../ui/styles';
import { fmtPrice } from './format';
import { SidePanel } from './side-panel';
import { timeframeMs } from './timeframe';

const STYLE_ID = 'vela-widget-strategy-tester';

const CSS = `
.vela-st { --st-pad: 10px; container-type: inline-size; }
/* Four EQUAL columns, so the tab bar never scrolls sideways: a 300px column gives each
   tab 75px, which fits the longest label at this size (and the phone's full width gives
   them far more). */
.vela-st-tabs {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 2px;
    padding: 6px 6px 0;
    border-bottom: 1px solid var(--vela-border);
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--vela-bg);
}
.vela-st-tab {
    all: unset;
    cursor: pointer;
    padding: 6px 2px 7px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--vela-fg-muted);
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
    border-radius: 4px 4px 0 0;
}
.vela-st-tab:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-st-tab[aria-selected='true'] { color: var(--vela-fg-bright); border-bottom-color: var(--vela-accent); }
.vela-st-tab:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-st-body { padding: var(--st-pad); }
.vela-st-empty { padding: 26px 12px; text-align: center; color: var(--vela-fg-muted); font-size: 12.5px; line-height: 1.5; }
.vela-st-title { font-size: 12px; color: var(--vela-fg-muted); margin: 0 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-st-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vela-st-stat { border: 1px solid var(--vela-border); border-radius: 6px; padding: 8px 10px; min-width: 0; }
.vela-st-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vela-fg-muted); }
.vela-st-stat-value {
    font-size: 16px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-st-stat-sub { font-size: 11px; color: var(--vela-fg-muted); font-variant-numeric: tabular-nums; }
.vela-st-chart-wrap { margin-top: 12px; border: 1px solid var(--vela-border); border-radius: 6px; padding: 8px; }
.vela-st-chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.vela-st-chart-head span:first-child { font-size: 11px; color: var(--vela-fg-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.vela-st-canvas { display: block; width: 100%; height: 96px; }
/* Two table shapes, each laid out explicitly so a column is never squeezed into a clipped
   stub and the last column never falls outside the panel.
   • METRICS (.vela-st-perf): fixed layout — three equal figure columns, the label column
     takes the remainder, and a figure too long for its cell ellipsises (with the row's
     tooltip carrying the full name).
   • TRADES (.vela-st-trades): fixed layout too, narrow columns for the ordinal side and
     date, and the last column takes the remainder — P&L and the running total, the numbers
     a trader reads first, are always on screen. A phone gets slightly wider columns. */
.vela-st-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.vela-st-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.vela-st-table th, .vela-st-table td { text-align: right; padding: 5px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vela-st-table th:first-child, .vela-st-table td:first-child { text-align: left; }
/* In a FIXED-layout table the columns with a declared width take it and the ones without
   share the remainder — so a label column needs no width of its own. */
.vela-st-perf { font-size: 11.5px; }
.vela-st-perf th:not(:first-child) { width: 74px; }
.vela-st-trades th:nth-child(1) { width: 30px; }
.vela-st-trades th:nth-child(2) { width: 50px; }
.vela-st-trades th:nth-child(3) { width: 70px; }
.vela-st-trades th:nth-child(4) { width: 84px; }
.vela-st-trades th:nth-child(5) { width: 82px; }
.vela-st-trades tbody tr { cursor: default; }
/* The panel is a COLUMN whose width the user chooses, so the tables read their own width
   rather than the window's: a docked 380px column drops the entry price (its exact value
   stays in the row's tooltip) and spends the space on P&L and the running total; drag the
   panel wider and the full list of trades comes back. This is why the panel needs no
   sideways scrolling at any width. */
@container (max-width: 470px) {
    .vela-st-trades .c-price { display: none; }
    .vela-st-trades th:nth-child(1) { width: 33px; }
    .vela-st-trades th:nth-child(2) { width: 52px; }
    .vela-st-trades th:nth-child(3) { width: 81px; }
    .vela-st-trades th:nth-child(5) { width: 80px; }
    .vela-st-perf th:not(:first-child) { width: 70px; }
}
@container (max-width: 330px) {
    .vela-st-perf th:not(:first-child) { width: 62px; }
    .vela-st-perf { font-size: 11px; }
}
[data-layout='mobile'] .vela-st-trades th:nth-child(1) { width: 32px; }
[data-layout='mobile'] .vela-st-trades th:nth-child(2) { width: 54px; }
[data-layout='mobile'] .vela-st-trades th:nth-child(3) { width: 74px; }
[data-layout='mobile'] .vela-st-trades th:nth-child(4) { width: 84px; }
[data-layout='mobile'] .vela-st-trades th:nth-child(5) { width: 84px; }
.vela-st-table thead th {
    position: sticky;
    top: 0;
    background: var(--vela-bg);
    color: var(--vela-fg-muted);
    font-weight: 600;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--vela-border);
    z-index: 1;
}
.vela-st-table tbody tr:hover { background: var(--vela-hover); }
.vela-st-table td { font-variant-numeric: tabular-nums; color: var(--vela-fg-bright); }
.vela-st-table td.lbl { color: var(--vela-fg); }
.vela-st-table tr.group td {
    padding-top: 12px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--vela-fg-muted);
    font-weight: 650;
}
.vela-st-table tr.group:first-child td { padding-top: 4px; }
.vela-st-up { color: ${BULLISH}; }
.vela-st-down { color: ${BEARISH}; }
.vela-st-flat { color: ${NEUTRAL}; }
.vela-st-note { margin-top: 10px; font-size: 11px; color: var(--vela-fg-muted); line-height: 1.45; }
.vela-st-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; font-size: 12px; }
.vela-st-kv dt { color: var(--vela-fg-muted); overflow: hidden; text-overflow: ellipsis; }
.vela-st-kv dd { margin: 0; text-align: right; color: var(--vela-fg-bright); font-variant-numeric: tabular-nums; }
.vela-st-h4 { margin: 14px 0 6px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--vela-fg-muted); }
/* Phone: the stats stay two-up (they are the whole point of the Overview), the tables
   scroll sideways instead of squeezing their columns into unreadable slivers. */
[data-layout='mobile'] .vela-st-stat-value { font-size: 15px; }
[data-layout='mobile'] .vela-st-tab { padding: 7px 6px; font-size: 12px; }
`;

/** The four readings, in the reference's order. */
const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'performance', label: 'Performance' },
    { id: 'trades', label: 'Trades' },
    { id: 'properties', label: 'Properties' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** A money amount with an explicit sign, in the account's own units. */
export function money(v: number | null, signed = true): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = fmtPrice(Math.abs(v), Math.abs(v) >= 1000 ? 2 : 2);
    if (!signed) return s;
    if (v > 0) return `+${s}`;
    if (v < 0) return `−${s}`;
    return s;
}

/**
 * A money figure for a TABLE cell: no `+` prefix (the cell's ink carries the direction and
 * the column header carries the unit), a true minus for a loss, and an em dash when there is
 * nothing to show. The plus-free form is what lets three columns fit a docked panel.
 */
export function moneyCell(v: number | null): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = fmtPrice(Math.abs(v), 2);
    return v < 0 ? `−${s}` : s;
}

/** A ratio (profit factor, win/loss) — two decimals, an em dash when it cannot exist. */
export function ratio(v: number | null): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toFixed(2);
}

/** A percentage with two decimals and a sign where it is a change. */
export function pct(v: number | null, signed = false): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = `${Math.abs(v).toFixed(2)}%`;
    if (!signed) return s;
    return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** Direction ink for a money value: green up, red down, neutral flat. */
export function ink(v: number | null): string {
    if (v == null || !Number.isFinite(v) || v === 0) return 'vela-st-flat';
    return v > 0 ? 'vela-st-up' : 'vela-st-down';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A compact UTC date + time for a trade row (the chart's zone is not a report concern). */
export function stamp(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A short UTC day for a trade row ("1 Jul 26"); the row's tooltip carries the full stamp,
 *  the way a phone-sized list stays readable without a sideways scroller. */
export function shortStamp(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    const yy = String(d.getUTCFullYear()).slice(2);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''} ${yy}`;
}

/** The label a row of the Performance table shows, and the stat it reads. */
interface PerfRow {
    label: string;
    /** The full name, shown on hover when `label` is the table's short form. */
    hint?: string;
    pick: (s: ReportStats) => string;
    /** The direction a money row points in — set only for rows whose cell drops its sign. */
    dir?: (s: ReportStats) => number | null;
    /** Renders as a group heading rather than a metric. */
    group?: boolean;
}

const PERF_ROWS: PerfRow[] = [
    { label: 'Profitability', pick: () => '', group: true },
    { label: 'Net profit', pick: (s) => moneyCell(s.netProfit) , dir: (s) => s.netProfit },
    { label: 'Gross profit', pick: (s) => moneyCell(s.grossProfit) , dir: (s) => s.grossProfit },
    { label: 'Gross loss', pick: (s) => (s.grossLoss > 0 ? moneyCell(-s.grossLoss) : moneyCell(0)) , dir: (s) => s.grossLoss > 0 ? -s.grossLoss : 0 },
    { label: 'Commission', hint: 'Commission paid', pick: (s) => moneyCell(-s.commission) , dir: (s) => -s.commission },
    { label: 'Max drawdown', hint: 'Max equity drawdown', pick: (s) => (s.maxDrawdown > 0 ? moneyCell(-s.maxDrawdown) : '—') , dir: (s) => s.maxDrawdown > 0 ? -s.maxDrawdown : null },
    { label: 'Max run-up', hint: 'Max equity run-up', pick: (s) => (s.maxRunup > 0 ? moneyCell(s.maxRunup) : '—') , dir: (s) => s.maxRunup > 0 ? s.maxRunup : null },
    { label: 'Trades', pick: () => '', group: true },
    { label: 'Closed trades', hint: 'Total closed trades', pick: (s) => String(s.trades) },
    { label: 'Open trades', hint: 'Total open trades', pick: (s) => String(s.openTrades) },
    { label: 'Winning trades', pick: (s) => String(s.wins) },
    { label: 'Losing trades', pick: (s) => String(s.losses) },
    { label: 'Even trades', pick: (s) => String(s.even) },
    { label: 'Percent profitable', pick: (s) => pct(s.percentProfitable) },
    { label: 'Avg trade', pick: (s) => moneyCell(s.avgTrade) , dir: (s) => s.avgTrade },
    { label: 'Avg win', hint: 'Avg winning trade', pick: (s) => moneyCell(s.avgWin) , dir: (s) => s.avgWin },
    { label: 'Avg loss', hint: 'Avg losing trade', pick: (s) => (s.avgLoss != null ? moneyCell(-s.avgLoss) : '—') , dir: (s) => s.avgLoss != null ? -s.avgLoss : null },
    { label: 'Ratio avg win/loss', hint: 'Ratio avg win / avg loss', pick: (s) => ratio(s.ratioWinLoss) },
    { label: 'Largest win', hint: 'Largest winning trade', pick: (s) => moneyCell(s.largestWin) , dir: (s) => s.largestWin },
    { label: 'Largest loss', hint: 'Largest losing trade', pick: (s) => (s.largestLoss != null ? moneyCell(-s.largestLoss) : '—') , dir: (s) => s.largestLoss != null ? -s.largestLoss : null },
    { label: 'Avg # bars', hint: 'Avg # bars in trades', pick: (s) => (s.avgBars == null ? '—' : s.avgBars.toFixed(1)) },
    { label: 'Ratios', pick: () => '', group: true },
    { label: 'Profit factor', pick: (s) => ratio(s.profitFactor) },
];

/** One formatted cell: the text, and which way it points (the table inks it, since a table
 *  cell drops the `+` that would otherwise say "winning"). */
export interface CellView {
    text: string;
    dir: -1 | 0 | 1;
}

/** One laid-out line of the Performance table — a group heading, or a metric's three columns. */
export type PerfRowView =
    | { kind: 'group'; label: string }
    | { kind: 'metric'; label: string; hint: string; all: CellView; long: CellView; short: CellView };

/** A money cell plus its direction. */
function cellOf(v: number | null): CellView {
    const text = moneyCell(v);
    return { text, dir: text === '—' || v == null ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0 };
}

/**
 * The Performance table as DATA: group headings and metric rows, already formatted, one
 * string per column. A missing column (an engine with no per-trade ledger) is an em dash
 * rather than a plausible-looking zero. Exported so the table's shape is testable without
 * a DOM.
 */
export function performanceRows(report: StrategyReport): PerfRowView[] {
    const out: PerfRowView[] = [];
    for (const row of PERF_ROWS) {
        if (row.group) {
            out.push({ kind: 'group', label: row.label });
            continue;
        }
        const cells = (stats: ReportStats | null): CellView => {
            if (!stats) return { text: '—', dir: 0 };
            const text = row.pick(stats);
            if (!row.dir) return { text, dir: 0 };
            const v = row.dir(stats);
            const dir: -1 | 0 | 1 = v == null || !Number.isFinite(v) ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0;
            return { text, dir };
        };
        out.push({
            kind: 'metric',
            label: row.label,
            hint: row.hint ?? row.label,
            all: cells(report.all),
            long: cells(report.long),
            short: cells(report.short),
        });
    }
    return out;
}

/**
 * The panel. `setRun` is called by the shell for every strategy run in ANY cell (the
 * workspace relays them), so a strategy that computed before the panel opened still has a
 * report waiting; `onChart` decides which of those runs is the one on screen.
 */
export class StrategyTester extends SidePanel {
    private chart: Vela | null = null;
    private unsubs: Array<() => void> = [];
    /** The latest strategy run per chart instance — a cell switch restores its report at once. */
    private readonly runs = new WeakMap<Vela, ScriptRun>();
    private run: ScriptRun | null = null;
    private report: StrategyReport | null = null;
    private tab: TabId = 'overview';
    /** Token guarding the async ledger read: a stale answer must not overwrite a newer run. */
    private ledgerToken = 0;
    private readonly tabsEl: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D | null;
    private resizeObs: ResizeObserver | null = null;

    constructor(host: HTMLElement) {
        // Docked, like its siblings (data window, object tree): a report is read BESIDE the
        // chart, not on top of it. `maximizable` covers the phone case, where the list of
        // trades wants the whole width.
        super(host, 'Strategy tester', 'vela-st', { resizable: true, width: 380, minWidth: 280, maxWidth: 620, maximizable: true });
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.tabsEl = doc.createElement('div');
        this.tabsEl.className = 'vela-st-tabs';
        this.tabsEl.setAttribute('role', 'tablist');
        for (const t of TABS) {
            const b = doc.createElement('button');
            b.className = 'vela-st-tab';
            b.setAttribute('role', 'tab');
            b.textContent = t.label;
            b.dataset.tab = t.id;
            b.addEventListener('click', () => this.selectTab(t.id));
            this.tabsEl.appendChild(b);
        }
        this.body.appendChild(this.tabsEl);
        this.canvas = doc.createElement('canvas');
        this.canvas.className = 'vela-st-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.syncTabs();
    }

    /**
     * Remember a strategy run — the shell calls this for every cell, bound or not.
     *
     * Two paths deliver the same run (the panel's own `script:run` subscription and the
     * workspace's relay), so an unchanged run is ignored: adopting it again would re-read
     * the ledger for nothing. Identity is the test — a run object is emitted once.
     */
    setRun(chart: Vela, run: ScriptRun): void {
        this.runs.set(chart, run);
        if (chart !== this.chart || run === this.run) return;
        this.adopt(run);
    }

    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (open) this.refresh();
    }

    /** (Re)bind to a chart instance — after a widget rebuild and on every active-cell switch. */
    onChart(chart: Vela): void {
        this.detach();
        this.chart = chart;
        // Runs that land while this chart is on screen; the workspace already relays them,
        // so re-reading the ledger here keeps the panel live as bars stream.
        this.unsubs.push(
            chart.on('script:run', (run) => {
                if (run.kind === 'strategy') this.setRun(chart, run);
            }),
        );
        this.unsubs.push(chart.on('market:changed', () => this.adopt(this.runs.get(chart) ?? null)));
        const known = this.runs.get(chart) ?? null;
        this.adopt(known);
        if (!known && !this.el.hidden) this.renderEmpty('This chart runs no strategy yet.');
    }

    override destroy(): void {
        this.detach();
        this.resizeObs?.disconnect();
        this.resizeObs = null;
        super.destroy();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.run = null;
        this.report = null;
        this.chart = null;
    }

    /** Take a run as the one on screen and re-read its ledger. */
    private adopt(run: ScriptRun | null): void {
        this.run = run;
        if (!run || !run.strategy) {
            this.report = null;
            this.ledgerToken += 1;
            this.render();
            return;
        }
        this.report = buildStrategyReport([], { state: run.strategy, barMs: this.barMs() });
        this.render();
        const token = ++this.ledgerToken;
        void run
            .trades()
            .then((trades) => {
                if (token !== this.ledgerToken) return; // a newer run won the race
                this.report = buildStrategyReport(trades, { state: this.run?.strategy ?? null, barMs: this.barMs() });
                this.render();
            })
            .catch(() => {
                /* an engine that cannot list its ledger keeps the state-only report */
            });
    }

    /** Milliseconds per bar on the bound chart — null while the timeframe is unknown. */
    private barMs(): number | null {
        const tf = this.chart?.market.timeframe;
        if (!tf) return null;
        const ms = timeframeMs(tf);
        return Number.isFinite(ms) && ms > 0 ? ms : null;
    }

    /** The handle behind the shown run — the Properties tab reads its declaration props. */
    private handle(): IndicatorHandle | null {
        const id = this.run?.id;
        if (!id || !this.chart) return null;
        return this.chart.indicators().find((h) => h.id === id) ?? null;
    }

    private selectTab(id: TabId): void {
        if (this.tab === id) return;
        this.tab = id;
        this.syncTabs();
        this.render();
    }

    private syncTabs(): void {
        for (const b of Array.from(this.tabsEl.children) as HTMLElement[]) {
            b.setAttribute('aria-selected', b.dataset.tab === this.tab ? 'true' : 'false');
        }
    }

    private refresh(): void {
        this.adopt(this.run ?? (this.chart ? (this.runs.get(this.chart) ?? null) : null));
    }

    private renderEmpty(text: string): void {
        const doc = this.el.ownerDocument;
        this.body.replaceChildren(this.tabsEl);
        const empty = doc.createElement('div');
        empty.className = 'vela-st-empty';
        empty.textContent = text;
        this.body.appendChild(empty);
    }

    private render(): void {
        if (this.el.hidden) return;
        const report = this.report;
        if (!report || !this.run) {
            this.renderEmpty('Add a strategy to the chart to see its backtest report.');
            return;
        }
        const doc = this.el.ownerDocument;
        const wrap = doc.createElement('div');
        wrap.className = 'vela-st-body';
        const title = doc.createElement('div');
        title.className = 'vela-st-title';
        title.textContent = this.run.title;
        title.title = this.run.title;
        wrap.appendChild(title);
        if (this.tab === 'overview') this.renderOverview(wrap, report);
        else if (this.tab === 'performance') this.renderPerformance(wrap, report);
        else if (this.tab === 'trades') this.renderTrades(wrap, report);
        else this.renderProperties(wrap);
        this.body.replaceChildren(this.tabsEl, wrap);
    }

    // ---- Overview -------------------------------------------------------------------

    private renderOverview(root: HTMLElement, report: StrategyReport): void {
        const doc = this.el.ownerDocument;
        const all = report.all;
        const grid = doc.createElement('div');
        grid.className = 'vela-st-stats';
        grid.append(
            this.stat('Total P&L', money(all.netProfit), all.netProfit !== 0 ? ink(all.netProfit) : undefined, pct(report.returnPct, true)),
            this.stat('Max drawdown', all.maxDrawdown > 0 ? money(-all.maxDrawdown) : '—', all.maxDrawdown > 0 ? 'vela-st-down' : undefined),
            this.stat('Profitable trades', pct(all.percentProfitable)),
            this.stat('Profit factor', ratio(all.profitFactor)),
        );
        root.appendChild(grid);

        const chartWrap = doc.createElement('div');
        chartWrap.className = 'vela-st-chart-wrap';
        const head = doc.createElement('div');
        head.className = 'vela-st-chart-head';
        const label = doc.createElement('span');
        label.textContent = 'Cumulative P&L';
        const last = doc.createElement('span');
        last.className = `vela-st-stat-sub ${report.equity.length ? ink(report.equity[report.equity.length - 1]!.value) : ''}`;
        last.textContent = report.equity.length ? money(report.equity[report.equity.length - 1]!.value) : '—';
        head.append(label, last);
        chartWrap.append(head, this.canvas);
        root.appendChild(chartWrap);

        if (all.trades === 0 && all.openTrades === 0) {
            const note = doc.createElement('div');
            note.className = 'vela-st-note';
            note.textContent = 'The strategy has not traded over the loaded history.';
            root.appendChild(note);
        }
        // Draw after the canvas is in the document so its client width is real.
        requestAnimationFrame(() => this.paintEquity(report));
        if (!this.resizeObs && typeof ResizeObserver !== 'undefined') {
            this.resizeObs = new ResizeObserver(() => this.paintEquity(this.report));
            this.resizeObs.observe(this.canvas);
        }
    }

    private stat(label: string, value: string, inkClass?: string, sub?: string): HTMLElement {
        const doc = this.el.ownerDocument;
        const box = doc.createElement('div');
        box.className = 'vela-st-stat';
        const l = doc.createElement('div');
        l.className = 'vela-st-stat-label';
        l.textContent = label;
        const v = doc.createElement('div');
        v.className = `vela-st-stat-value${inkClass ? ` ${inkClass}` : ''}`;
        v.textContent = value;
        v.title = value;
        box.append(l, v);
        if (sub && sub !== '—') {
            const s = doc.createElement('div');
            s.className = 'vela-st-stat-sub';
            s.textContent = sub;
            box.appendChild(s);
        }
        return box;
    }

    /** The cumulative-P&L curve: a zero baseline, an area tinted by the sign of the run,
     *  and the last point marked. Purely the report's `equity` points, so it cannot
     *  disagree with the List of trades. */
    private paintEquity(report: StrategyReport | null): void {
        const ctx = this.ctx;
        if (!ctx || !report || this.tab !== 'overview') return;
        const dpr = this.el.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const w = Math.max(40, this.canvas.clientWidth);
        const h = Math.max(40, this.canvas.clientHeight);
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const pts = report.equity;
        if (pts.length === 0) return;
        let lo = 0;
        let hi = 0;
        for (const p of pts) {
            if (p.value < lo) lo = p.value;
            if (p.value > hi) hi = p.value;
        }
        if (lo === hi) {
            lo -= 1;
            hi += 1;
        }
        const pad = 4;
        const y = (v: number): number => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
        const x = (i: number): number => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * w);
        const zero = y(0);
        const final = pts[pts.length - 1]!.value;
        const tint = final >= 0 ? BULLISH : BEARISH;
        // Zero baseline
        ctx.save();
        ctx.strokeStyle = NEUTRAL;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(zero) + 0.5);
        ctx.lineTo(w, Math.round(zero) + 0.5);
        ctx.stroke();
        ctx.restore();
        // Area under the curve
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x(0), zero);
        pts.forEach((p, i) => ctx.lineTo(x(i), y(p.value)));
        ctx.lineTo(x(pts.length - 1), zero);
        ctx.closePath();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = tint;
        ctx.fill();
        ctx.restore();
        // The curve itself
        ctx.save();
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))));
        ctx.strokeStyle = tint;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        // The last point
        ctx.beginPath();
        ctx.arc(x(pts.length - 1), y(final), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = tint;
        ctx.fill();
        ctx.restore();
    }

    // ---- Performance ----------------------------------------------------------------

    private renderPerformance(root: HTMLElement, report: StrategyReport): void {
        const scroll = this.el.ownerDocument.createElement('div');
        scroll.className = 'vela-st-scroll';
        const table = this.el.ownerDocument.createElement('table');
        table.className = 'vela-st-table vela-st-perf';
        const thead = this.el.ownerDocument.createElement('thead');
        const hr = this.el.ownerDocument.createElement('tr');
        for (const h of ['', 'All', 'Long', 'Short']) {
            const th = this.el.ownerDocument.createElement('th');
            th.textContent = h;
            hr.appendChild(th);
        }
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = this.el.ownerDocument.createElement('tbody');
        for (const row of performanceRows(report)) {
            const tr = this.el.ownerDocument.createElement('tr');
            if (row.kind === 'group') {
                tr.className = 'group';
                const td = this.el.ownerDocument.createElement('td');
                td.colSpan = 4;
                td.textContent = row.label;
                tr.appendChild(td);
                tbody.appendChild(tr);
                continue;
            }
            const lbl = this.el.ownerDocument.createElement('td');
            lbl.className = 'lbl';
            lbl.textContent = row.label;
            lbl.title = row.hint;
            tr.appendChild(lbl);
            for (const cell of [row.all, row.long, row.short]) {
                const td = this.el.ownerDocument.createElement('td');
                td.textContent = cell.text;
                // A money cell wears the direction it reports: the `+` is gone from the text
                // (three columns have to fit), so the ink is what says "winning".
                if (cell.dir !== 0) td.className = cell.dir > 0 ? 'vela-st-up' : 'vela-st-down';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        root.appendChild(scroll);
        if (!report.long && !report.short) {
            const note = this.el.ownerDocument.createElement('div');
            note.className = 'vela-st-note';
            note.textContent = 'Long / Short columns need the engine’s per-trade ledger.';
            root.appendChild(note);
        }
    }

    // ---- Trades ---------------------------------------------------------------------

    private renderTrades(root: HTMLElement, report: StrategyReport): void {
        const doc = this.el.ownerDocument;
        if (report.rows.length === 0) {
            const note = doc.createElement('div');
            note.className = 'vela-st-empty';
            note.textContent = 'No trades in this run.';
            root.appendChild(note);
            return;
        }
        const scroll = doc.createElement('div');
        scroll.className = 'vela-st-scroll';
        const table = doc.createElement('table');
        table.className = 'vela-st-table vela-st-trades';
        const thead = doc.createElement('thead');
        const hr = doc.createElement('tr');
        for (const h of ['#', 'Side', 'Date', 'Price', 'P&L', 'Total']) {
            const th = doc.createElement('th');
            th.textContent = h;
            if (h === 'Price') th.className = 'c-price';
            hr.appendChild(th);
        }
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = doc.createElement('tbody');
        for (const row of report.rows) {
            const tr = doc.createElement('tr');
            tr.append(
                this.cell(String(row.n)),
                this.cell(row.side === 'long' ? 'Long' : 'Short', row.side === 'long' ? 'vela-st-up' : 'vela-st-down'),
                this.cell(shortStamp(row.entryTime)),
                this.cell(this.priceText(row), 'c-price'),
                this.cell(moneyCell(row.pnl), row.pnl == null ? '' : ink(row.pnl)),
                this.cell(moneyCell(row.cumulative), row.cumulative == null ? '' : ink(row.cumulative)),
            );
            tr.title = this.tradeTip(row);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        root.appendChild(scroll);
        const note = doc.createElement('div');
        note.className = 'vela-st-note';
        note.textContent = 'Price is the entry fill — hover a row for its exit, size and duration.';
        root.appendChild(note);
    }

    private priceText(row: TradeReportRow): string {
        const dp = Math.abs(row.entryPrice) >= 1 ? 2 : 6;
        return fmtPrice(row.entryPrice, dp);
    }

    private tradeTip(row: TradeReportRow): string {
        const parts = [`${row.side === 'long' ? 'Long' : 'Short'} ${row.qty}`, `Entry ${stamp(row.entryTime)} @ ${this.priceText(row)}`];
        if (row.exitTime != null && row.exitPrice != null) parts.push(`Exit ${stamp(row.exitTime)} @ ${fmtPrice(row.exitPrice, Math.abs(row.exitPrice) >= 1 ? 2 : 6)}`);
        if (row.bars != null) parts.push(`${row.bars} bars`);
        return parts.join('\n');
    }

    private cell(text: string, cls = ''): HTMLElement {
        const td = this.el.ownerDocument.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        return td;
    }

    // ---- Properties -----------------------------------------------------------------

    private renderProperties(root: HTMLElement): void {
        const doc = this.el.ownerDocument;
        const handle = this.handle();
        const initial = this.report?.initialCapital ?? null;
        const dl = doc.createElement('dl');
        dl.className = 'vela-st-kv';
        const push = (k: string, v: string): void => {
            const dt = doc.createElement('dt');
            dt.textContent = k;
            const dd = doc.createElement('dd');
            dd.textContent = v;
            dl.append(dt, dd);
        };
        push('Strategy', this.run?.title ?? '—');
        push('Status', this.run?.complete ? 'Complete' : 'Computing…');
        push('Bars computed', this.run ? String(this.run.bar + 1) : '—');
        const props = handle?.props ?? [];
        const inputs = handle?.inputs ?? [];
        const values = handle?.propValues() ?? {};
        const inputValues = handle?.inputValues() ?? {};
        // The capital row appears ONCE: the strategy's own declaration lists it when the engine
        // exposes properties, and the account figure stands in when it does not.
        const declaresCapital = props.some((p) => /capital/i.test(p.key) || /capital/i.test(p.title));
        if (!declaresCapital) push('Initial capital', initial != null ? fmtPrice(initial, 2) : '—');
        root.appendChild(dl);
        if (props.length > 0) {
            root.appendChild(this.section('Properties'));
            const pl = doc.createElement('dl');
            pl.className = 'vela-st-kv';
            for (const p of props) {
                const v = values[p.key] ?? p.defval;
                pl.append(this.dt(p.title || p.key), this.dd(this.inputText(p, v)));
            }
            root.appendChild(pl);
        }
        if (inputs.length > 0) {
            root.appendChild(this.section('Inputs'));
            const il = doc.createElement('dl');
            il.className = 'vela-st-kv';
            for (const p of inputs) {
                const v = inputValues[p.key] ?? p.defval;
                il.append(this.dt(p.title || p.key), this.dd(this.inputText(p, v)));
            }
            root.appendChild(il);
        }
        if (props.length === 0 && inputs.length === 0) {
            const note = doc.createElement('div');
            note.className = 'vela-st-note';
            note.textContent = 'This engine exposes no declaration properties for the strategy.';
            root.appendChild(note);
        }
    }

    private dt(text: string): HTMLElement {
        const el = this.el.ownerDocument.createElement('dt');
        el.textContent = text;
        el.title = text;
        return el;
    }

    private dd(text: string): HTMLElement {
        const el = this.el.ownerDocument.createElement('dd');
        el.textContent = text;
        return el;
    }

    private section(title: string): HTMLElement {
        const h = this.el.ownerDocument.createElement('h4');
        h.className = 'vela-st-h4';
        h.textContent = title;
        return h;
    }

    private inputText(schema: InputSchema, value: unknown): string {
        if (typeof value === 'boolean') return value ? 'On' : 'Off';
        if (typeof value === 'number') {
            // Prices and money read like money; a bare count keeps its own digits.
            if (/capital|commission|risk|price|profit|slippage/i.test(schema.key)) return fmtPrice(value, 2);
            const dp = Number.isInteger(value) ? 0 : 2;
            return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: Math.max(dp, 4) });
        }
        if (value == null || value === '') return '—';
        return String(value);
    }
}
