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
import { MIN_FLOAT_PANEL_WIDTH, SidePanel } from './side-panel';
import { StrategyTradeTable } from './strategy-trade-table';
import { timeframeLabel, timeframeMs } from './timeframe';

const STYLE_ID = 'vela-widget-strategy-tester';
/** Leave an active touch/wheel scroll alone until momentum has settled. */
const SCROLL_IDLE_MS = 180;

const CSS = `
.vela-st { container-type: inline-size; }
.vela-st[data-standard-pane] > .vela-panel-body {
    display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0; overflow: hidden;
}
.vela-st-tabs {
    flex: none; display: flex; min-width: 0; overflow-x: auto; overflow-y: hidden;
    overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
    border-bottom: 1px solid var(--vela-border); background: var(--vela-bg);
}
.vela-st-tab {
    all: unset; box-sizing: border-box; flex: 1 0 auto; min-height: 36px;
    padding: 0 10px; border-bottom: 2px solid transparent; cursor: pointer;
    color: var(--vela-fg-muted); font-size: 12px; font-weight: 600;
    text-align: center; white-space: nowrap;
}
.vela-st-tab:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-st-tab[aria-selected='true'] { color: var(--vela-fg-bright); border-bottom-color: var(--vela-accent); }
.vela-st-tab:focus-visible, .vela-st-view:focus-visible, .vela-st-scroll:focus-visible,
.vela-st-trade-toggle:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-st-view[hidden] { display: none !important; }
/* Preserve a usable report/table scrollport even when the card is extremely short. */
.vela-st[data-compact-height='1'] > .vela-panel-body { overflow: auto; }
.vela-st[data-compact-height='1'] .vela-st-view { flex: 0 0 160px; }
.vela-st-view, .vela-st-body {
    flex: 1 1 auto; display: flex; flex-direction: column;
    min-width: 0; min-height: 0; overflow: hidden;
}
.vela-st-meta {
    flex: none; display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 8px;
    padding: 7px 9px; border-bottom: 1px solid var(--vela-border); font-size: 11px; line-height: 1.3;
}
.vela-st-title { flex: 1 1 100px; min-width: 0; color: var(--vela-fg-bright); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-st-scope { min-width: 0; max-width: 100%; color: var(--vela-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-st-status { min-width: 0; max-width: 100%; color: var(--vela-fg-muted); overflow-wrap: anywhere; }
.vela-st-status:empty, .vela-st-scope:empty { display: none; }
.vela-st-content { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 10px; }
.vela-st-content-table { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
.vela-st-empty { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 20px 12px; text-align: center; color: var(--vela-fg-muted); font-size: 12.5px; line-height: 1.5; }
.vela-st-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.vela-st-stat { min-width: 0; padding: 9px; border: 1px solid var(--vela-border); }
.vela-st-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--vela-fg-muted); }
.vela-st-stat-value { margin-top: 3px; font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.vela-st-stat-sub { font-size: 11px; color: var(--vela-fg-muted); font-variant-numeric: tabular-nums; }
.vela-st-chart-wrap { margin-top: 10px; padding: 9px; border: 1px solid var(--vela-border); }
.vela-st-chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.vela-st-chart-head span:first-child { font-size: 10.5px; color: var(--vela-fg-muted); text-transform: uppercase; letter-spacing: .04em; }
.vela-st-canvas { display: block; width: 100%; height: 96px; }
/* Both axes belong to the same scrollport, so the header stays visible on a long report.
   Natural column widths keep financial figures readable instead of clipping them. */
.vela-st-scroll { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.vela-st-table { width: 100%; border-spacing: 0; border-collapse: separate; table-layout: auto; font-size: 12px; font-variant-numeric: tabular-nums; user-select: text; -webkit-user-select: text; }
.vela-st-perf { min-width: 400px; }
.vela-st-trades { min-width: 580px; table-layout: fixed; }
.vela-st-spacer[hidden] { display: none !important; }
.vela-st-table tr.vela-st-spacer > td { padding: 0; border: 0; line-height: 0; }
.vela-st-table th, .vela-st-table td { box-sizing: border-box; padding: 7px 9px; border-bottom: 1px solid var(--vela-border); text-align: right; white-space: nowrap; }
.vela-st-table thead th { position: sticky; top: 0; z-index: 3; background: var(--vela-surface-elev, var(--vela-bg)); color: var(--vela-fg-muted); font-size: 10.5px; font-weight: 650; }
.vela-st-table thead th:first-child { left: 0; z-index: 4; text-align: left; }
.vela-st-perf thead th:first-child, .vela-st-perf tbody th.lbl { min-width: 150px; }
.vela-st-perf thead th:not(:first-child) { min-width: 80px; }
.vela-st-trades thead th:first-child { min-width: 52px; }
.vela-st-trades thead th:nth-child(2) { min-width: 64px; }
.vela-st-trades thead th:nth-child(3) { min-width: 88px; }
.vela-st-trades thead th:nth-child(n+4) { min-width: 94px; }
.vela-st-perf tbody th.lbl, .vela-st-trade-row > td:first-child {
    position: sticky; left: 0; z-index: 2; background: var(--vela-bg); text-align: left;
}
.vela-st-perf tbody th.lbl { color: var(--vela-fg); font-weight: 500; }
.vela-st-table td { color: var(--vela-fg-bright); }
.vela-st-table tbody tr:not(.group):not(.vela-st-trade-details):hover > td,
.vela-st-table tbody tr:not(.group):hover > th.lbl { background: var(--vela-hover); }
/* Hover is translucent: composite it over an opaque pinned column. */
.vela-st-perf tbody tr:hover > th.lbl, .vela-st-trade-row:hover > td:first-child {
    background: linear-gradient(var(--vela-hover), var(--vela-hover)), var(--vela-bg) !important;
}
.vela-st-table tr.group th { padding: 9px; color: var(--vela-fg-muted); font-size: 10.5px; font-weight: 650; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
.vela-st-table td.vela-st-up, .vela-st-up { color: ${BULLISH}; }
.vela-st-table td.vela-st-down, .vela-st-down { color: ${BEARISH}; }
.vela-st-flat { color: ${NEUTRAL}; }
.vela-st-trade-row > td { height: 36px; }
.vela-st-trade-row > td:first-child { padding: 0; }
.vela-st-trade-toggle { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 5px; width: 100%; min-width: 52px; min-height: 35px; padding: 0 9px; cursor: pointer; color: var(--vela-fg-bright); }
.vela-st-trade-toggle::after { content: '›'; font-size: 16px; line-height: 1; color: var(--vela-fg-muted); transform: rotate(0deg); }
.vela-st-trade-toggle[aria-expanded='true']::after { transform: rotate(90deg); }
.vela-st-trade-toggle:hover { background: var(--vela-hover); }
.vela-st-trade-details > td { padding: 0; text-align: left; white-space: normal; background: var(--vela-bg); }
.vela-st-detail-inner { position: sticky; left: 0; box-sizing: border-box; width: min(100%, 100cqw); padding: 9px; }
.vela-st-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin: 0; }
.vela-st-detail-grid div { min-width: 0; }
.vela-st-detail-grid dt { color: var(--vela-fg-muted); font-size: 10.5px; }
.vela-st-detail-grid dd { margin: 2px 0 0; color: var(--vela-fg-bright); font-size: 11.5px; overflow-wrap: anywhere; }
.vela-st-note { margin-top: 10px; color: var(--vela-fg-muted); font-size: 11px; line-height: 1.45; }
.vela-st-scroll > .vela-st-note { margin: 0; padding: 10px; }
.vela-st-kv { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, auto); gap: 6px 12px; margin: 0; font-size: 12px; }
.vela-st-kv dt, .vela-st-kv dd { min-width: 0; overflow-wrap: anywhere; }
.vela-st-kv dt { color: var(--vela-fg-muted); }
.vela-st-kv dd { margin: 0; text-align: right; color: var(--vela-fg-bright); font-variant-numeric: tabular-nums; }
.vela-st-h4 { margin: 14px 0 7px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--vela-fg-muted); }
@media (pointer: coarse) {
    .vela-st-tab { min-height: 44px; }
    .vela-st-trade-row > td { height: 44px; }
    .vela-st-trade-toggle { min-height: 43px; }
}
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
type LedgerStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
interface RememberedRun { run: ScriptRun; marketKey: string }
let testerSequence = 0;

/** Identity of the requested market, not the formerly displayed candles. */
function marketKey(chart: Vela): string {
    const m = chart.market;
    return JSON.stringify([m.symbol ?? '', m.timeframe ?? '', m.provider ?? '', m.session ?? '', m.offline ?? false]);
}

export class StrategyTester extends SidePanel {
    private chart: Vela | null = null;
    private unsubs: Array<() => void> = [];
    /** Every chart's latest run is guarded by the market it actually belongs to. */
    private readonly runs = new WeakMap<Vela, RememberedRun>();
    private run: ScriptRun | null = null;
    private report: StrategyReport | null = null;
    private ledgerStatus: LedgerStatus = 'idle';
    private hasLedgerReport = false;
    private loading = false;
    private waitingForRun = false;
    private waitingStrategyId: string | null = null;
    private tab: TabId = 'overview';
    private expandedTrade: string | null = null;
    private tradeView: StrategyTradeTable | null = null;
    /** Token guarding the async ledger read: a stale answer must not overwrite a newer run. */
    private ledgerToken = 0;
    private readonly tabsEl: HTMLElement;
    private readonly views = new Map<TabId, HTMLElement>();
    private readonly tabScroll = new Map<TabId, { top: number; left: number }>();
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D | null;
    private resizeObs: ResizeObserver | null = null;
    private destroyed = false;
    private readonly pressedPointers = new Set<number>();
    private releaseTimer: number | null = null;
    private scrollTimer: number | null = null;
    private pendingRender = false;

    constructor(host: HTMLElement) {
        // The same standard dock as Data window: a desktop column and a bottom-attached,
        // height-adjustable portrait phone pane. Landscape uses desktop layout mode.
        super(host, 'Strategy tester', 'vela-st', {
            resizable: true, width: 380, minWidth: MIN_FLOAT_PANEL_WIDTH, maxWidth: 620,
            standardPane: true, mobileMinHeight: 216,
        });
        const doc = host.ownerDocument;
        const id = ++testerSequence;
        injectStyles(STYLE_ID, CSS, doc);
        this.tabsEl = doc.createElement('div');
        this.tabsEl.className = 'vela-st-tabs';
        this.tabsEl.setAttribute('role', 'tablist');
        this.tabsEl.setAttribute('aria-label', 'Strategy report');
        this.body.appendChild(this.tabsEl);
        for (const t of TABS) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-st-tab';
            b.id = `vela-st-${id}-tab-${t.id}`;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-controls', `vela-st-${id}-view-${t.id}`);
            b.textContent = t.label;
            b.dataset.tab = t.id;
            b.addEventListener('click', () => this.selectTab(t.id));
            this.tabsEl.appendChild(b);
            const view = doc.createElement('div');
            view.className = 'vela-st-view';
            view.id = `vela-st-${id}-view-${t.id}`;
            view.tabIndex = 0;
            view.setAttribute('role', 'tabpanel');
            view.setAttribute('aria-labelledby', b.id);
            this.views.set(t.id, view);
            this.body.appendChild(view);
        }
        this.tabsEl.addEventListener('keydown', (event) => this.onTabKey(event));
        // Do not replace the row under a finger/mouse press, or erase a text selection
        // mid-copy when a live strategy update lands. Safety resets bypass this deferral.
        this.body.addEventListener('pointerdown', this.onPointerDown);
        this.body.addEventListener('scroll', this.onScroll, true);
        doc.addEventListener('pointerup', this.onPointerEnd, true);
        doc.addEventListener('pointercancel', this.onPointerEnd, true);
        doc.addEventListener('selectionchange', this.onSelectionChange);
        this.canvas = doc.createElement('canvas');
        this.canvas.className = 'vela-st-canvas';
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', 'Cumulative profit and loss');
        this.ctx = this.canvas.getContext('2d');
        this.syncTabs();
    }

    /** Remember runs for every cell, even when a different chart is active. */
    setRun(chart: Vela, run: ScriptRun): void {
        if (this.destroyed || chart.loading === true) return;
        this.runs.set(chart, { run, marketKey: marketKey(chart) });
        if (chart !== this.chart || run === this.run) return;
        this.loading = false;
        this.waitingForRun = false;
        this.waitingStrategyId = null;
        this.adopt(run);
    }

    /** Forget a removed strategy, including a run belonging to an inactive chart. */
    forgetRun(chart: Vela, id: string): void {
        const known = this.runs.get(chart);
        if (known?.run.id === id) this.runs.delete(chart);
        if (chart !== this.chart) return;
        const wasWaiting = this.waitingStrategyId === id;
        if (wasWaiting) {
            this.waitingStrategyId = null;
            this.waitingForRun = false;
        }
        if (this.run?.id !== id) { if (wasWaiting) this.requestRender(true); return; }
        this.waitingForRun = false;
        this.expandedTrade = null;
        this.tabScroll.clear();
        this.adopt(null, true);
    }

    /** A market request invalidates old results even on an inactive chart. */
    invalidateMarket(chart: Vela): void {
        this.runs.delete(chart);
        if (chart !== this.chart) return;
        if (this.run) this.waitingStrategyId = this.run.id;
        this.waitingForRun = this.waitingForRun || this.run !== null;
        this.loading = true;
        this.expandedTrade = null;
        this.tabScroll.clear();
        this.adopt(null, true);
    }

    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (!open) {
            this.tradeView?.destroy();
            this.tradeView = null;
        } else if (this.open) this.refresh();
    }

    /** (Re)bind to the active chart; stale async replies never cross the boundary. */
    onChart(chart: Vela): void {
        if (chart === this.chart) { this.refresh(); return; }
        this.detach();
        this.chart = chart;
        this.loading = chart.loading === true;
        this.waitingForRun = false;
        this.waitingStrategyId = null;
        this.expandedTrade = null;
        this.tabScroll.clear();
        for (const view of this.views.values()) view.replaceChildren();
        this.unsubs.push(chart.on('script:run', (run) => {
            if (run.kind === 'strategy') this.setRun(chart, run);
        }));
        this.unsubs.push(chart.on('load:start', () => this.invalidateMarket(chart)));
        this.unsubs.push(chart.on('market:requested', () => this.invalidateMarket(chart)));
        this.unsubs.push(chart.on('load:end', () => {
            this.loading = false;
            const known = this.knownRun(chart);
            if (known) this.adopt(known);
            else this.requestRender(true);
        }));
        this.unsubs.push(chart.on('indicator:removed', ({ id }) => this.forgetRun(chart, id)));
        this.adopt(this.loading ? null : this.knownRun(chart), true);
    }

    override destroy(): void {
        this.destroyed = true;
        this.detach();
        this.resizeObs?.disconnect();
        this.resizeObs = null;
        this.tradeView?.destroy();
        this.tradeView = null;
        const doc = this.el.ownerDocument;
        this.body.removeEventListener('pointerdown', this.onPointerDown);
        this.body.removeEventListener('scroll', this.onScroll, true);
        doc.removeEventListener('pointerup', this.onPointerEnd, true);
        doc.removeEventListener('pointercancel', this.onPointerEnd, true);
        doc.removeEventListener('selectionchange', this.onSelectionChange);
        if (this.releaseTimer != null) doc.defaultView?.clearTimeout(this.releaseTimer);
        if (this.scrollTimer != null) doc.defaultView?.clearTimeout(this.scrollTimer);
        this.releaseTimer = null;
        this.scrollTimer = null;
        super.destroy();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.ledgerToken += 1;
        this.run = null;
        this.report = null;
        this.ledgerStatus = 'idle';
        this.hasLedgerReport = false;
        this.chart = null;
        this.tradeView?.destroy();
        this.tradeView = null;
        this.pressedPointers.clear();
        if (this.scrollTimer != null) this.el.ownerDocument.defaultView?.clearTimeout(this.scrollTimer);
        this.scrollTimer = null;
    }

    private knownRun(chart: Vela): ScriptRun | null {
        const known = this.runs.get(chart);
        if (!known) return null;
        if (known.marketKey === marketKey(chart)) return known.run;
        this.runs.delete(chart);
        return null;
    }

    /** Re-read the ledger. Keep the last complete report marked updating while it resolves. */
    private adopt(run: ScriptRun | null, force = false): void {
        const previous = this.run;
        const keepReport = !!run && !!run.strategy && !!previous && previous.id === run.id && this.hasLedgerReport && !!this.report;
        if (previous && run && previous.id !== run.id) {
            this.expandedTrade = null;
            this.tabScroll.clear();
        }
        this.run = run;
        const token = ++this.ledgerToken;
        if (!run || !run.strategy) {
            this.report = null;
            this.hasLedgerReport = false;
            this.ledgerStatus = 'idle';
            this.requestRender(force);
            return;
        }
        this.ledgerStatus = 'loading';
        if (!keepReport) {
            this.report = buildStrategyReport([], { state: run.strategy, barMs: this.barMs() });
            this.hasLedgerReport = false;
            this.requestRender(force);
        } else {
            this.updateStatus();
        }
        const chart = this.chart;
        const barMs = this.barMs();
        void Promise.resolve().then(() => run.trades()).then((trades) => {
            if (this.destroyed || token !== this.ledgerToken || this.chart !== chart || this.loading) return;
            this.report = buildStrategyReport(trades, { state: run.strategy ?? null, barMs });
            this.hasLedgerReport = true;
            this.ledgerStatus = 'ready';
            this.requestRender();
        }).catch(() => {
            if (this.destroyed || token !== this.ledgerToken || this.chart !== chart || this.loading) return;
            // The summary remains usable, but do not call an unavailable ledger "no trades".
            this.report = buildStrategyReport([], { state: run.strategy ?? null, barMs });
            this.hasLedgerReport = false;
            this.ledgerStatus = 'unavailable';
            this.requestRender();
        });
    }

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
        const current = this.views.get(this.tab);
        const scroll = current?.querySelector<HTMLElement>('.vela-st-scroll') ?? current?.querySelector<HTMLElement>('.vela-st-content');
        if (scroll) this.tabScroll.set(this.tab, { top: scroll.scrollTop, left: scroll.scrollLeft });
        this.tab = id;
        // Update the formerly hidden view before revealing it. In particular, a market
        // switch must never flash the previous market's report during a pointer release.
        this.requestRender(true);
        this.syncTabs();
        // Hidden elements have no scrollable geometry, so restore only after display.
        const saved = this.tabScroll.get(id);
        const view = this.views.get(id);
        const next = view?.querySelector<HTMLElement>('.vela-st-scroll') ?? view?.querySelector<HTMLElement>('.vela-st-content');
        if (saved && next) {
            if (this.tradeView?.el === next) this.tradeView.restoreScroll(saved.top, saved.left);
            else { next.scrollTop = saved.top; next.scrollLeft = saved.left; }
        }
    }

    private onTabKey(event: KeyboardEvent): void {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const i = TABS.findIndex((t) => t.id === this.tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
            : (i + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        const id = TABS[next]!.id;
        this.selectTab(id);
        const button = this.tabsEl.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
        button?.focus();
        button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    private syncTabs(): void {
        for (const b of Array.from(this.tabsEl.children) as HTMLButtonElement[]) {
            const selected = b.dataset.tab === this.tab;
            b.setAttribute('aria-selected', String(selected));
            b.tabIndex = selected ? 0 : -1;
        }
        for (const [id, view] of this.views) view.hidden = id !== this.tab;
    }

    private refresh(): void {
        if (this.loading) { this.requestRender(true); return; }
        const known = this.chart ? this.knownRun(this.chart) : null;
        if (known === this.run && this.report) this.requestRender(true);
        else this.adopt(known, true);
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        this.pressedPointers.add(event.pointerId);
    };
    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (!this.pressedPointers.delete(event.pointerId) || this.pressedPointers.size) return;
        const win = this.el.ownerDocument.defaultView;
        if (this.releaseTimer != null) win?.clearTimeout(this.releaseTimer);
        this.releaseTimer = win?.setTimeout(() => {
            this.releaseTimer = null;
            if (this.pendingRender) this.requestRender();
        }, 0) ?? null;
    };
    private readonly onScroll = (event: Event): void => {
        const target = event.target as HTMLElement | null;
        if (!target?.matches('.vela-st-scroll, .vela-st-content')) return;
        const win = this.el.ownerDocument.defaultView;
        if (this.scrollTimer != null) win?.clearTimeout(this.scrollTimer);
        this.scrollTimer = win?.setTimeout(() => {
            this.scrollTimer = null;
            if (this.pendingRender) this.requestRender();
        }, SCROLL_IDLE_MS) ?? null;
    };
    private readonly onSelectionChange = (): void => {
        if (this.pendingRender && !this.hasSelection()) this.requestRender();
    };

    private hasSelection(): boolean {
        const selection = this.el.ownerDocument.getSelection();
        return !!selection && !selection.isCollapsed && !!selection.anchorNode && this.body.contains(selection.anchorNode);
    }

    private requestRender(force = false): void {
        if (this.destroyed || this.el.hidden) return;
        if (!force && (this.pressedPointers.size > 0 || this.releaseTimer != null || this.scrollTimer != null || this.hasSelection())) {
            this.pendingRender = true;
            return;
        }
        this.pendingRender = false;
        this.render();
    }

    private statusText(): string {
        if (this.ledgerStatus === 'loading') return this.hasLedgerReport ? 'Updating…' : 'Loading trades…';
        if (this.ledgerStatus === 'unavailable') return 'Trade ledger unavailable';
        const status = this.run && !this.run.complete ? 'Computing…' : '';
        const broker = this.run?.strategy?.netPnl;
        // Different engines can report a broker net that does not reconcile with the
        // supplied trade P&Ls (for example, commission or independently rounded fills).
        // Keep the established ledger-based calculations, but surface the discrepancy
        // rather than silently presenting the two as the same financial result.
        const differs = this.hasLedgerReport && this.report && broker != null && Number.isFinite(broker)
            && Math.abs(this.report.all.netProfit - broker) >= 0.005;
        const reconciliation = differs ? `Broker net ${money(broker)} ≠ ledger` : '';
        return [status, reconciliation].filter(Boolean).join(' · ');
    }

    private updateStatus(): void {
        const view = this.views.get(this.tab);
        const status = view?.querySelector<HTMLElement>('.vela-st-status');
        if (status) status.textContent = this.statusText();
        view?.setAttribute('aria-busy', String(this.ledgerStatus === 'loading'));
    }

    private render(): void {
        const view = this.views.get(this.tab)!;
        const oldScroll = view.querySelector<HTMLElement>('.vela-st-scroll') ?? view.querySelector<HTMLElement>('.vela-st-content');
        const top = oldScroll?.scrollTop ?? 0;
        const left = oldScroll?.scrollLeft ?? 0;
        const active = this.el.ownerDocument.activeElement as HTMLElement | null;
        const focusKey = active && view.contains(active) ? active.dataset.tradeKey : undefined;
        const focusScroll = active === oldScroll;
        const focusView = active === view;
        this.tradeView?.destroy();
        this.tradeView = null;
        view.setAttribute('aria-busy', String(this.loading || this.ledgerStatus === 'loading'));
        const report = this.report;
        if (this.loading || !report || !this.run) {
            const empty = this.el.ownerDocument.createElement('div');
            empty.className = 'vela-st-empty';
            empty.textContent = this.loading ? 'Loading chart data…'
                : this.run && !this.run.strategy ? 'This strategy did not provide a broker state.'
                    : this.waitingForRun ? 'Waiting for strategy results on this chart.'
                        : 'Add a strategy to the chart to see its backtest report.';
            view.replaceChildren(empty);
            if (focusView) view.focus({ preventScroll: true });
            return;
        }
        const doc = this.el.ownerDocument;
        const wrap = doc.createElement('div');
        wrap.className = 'vela-st-body';
        const meta = doc.createElement('div');
        meta.className = 'vela-st-meta';
        const title = doc.createElement('span');
        title.className = 'vela-st-title';
        title.textContent = this.run.title;
        title.title = this.run.title;
        const scope = doc.createElement('span');
        scope.className = 'vela-st-scope';
        const market = this.chart?.market;
        scope.textContent = [market?.symbol, market?.timeframe ? timeframeLabel(market.timeframe) : ''].filter(Boolean).join(' · ');
        scope.title = scope.textContent;
        const status = doc.createElement('span');
        status.className = 'vela-st-status';
        status.textContent = this.statusText();
        meta.append(title, scope, status);
        const content = doc.createElement('div');
        content.className = 'vela-st-content';
        if (this.tab === 'performance' || this.tab === 'trades') content.classList.add('vela-st-content-table');
        wrap.append(meta, content);
        if (this.tab === 'overview') this.renderOverview(content, report);
        else if (this.tab === 'performance') this.renderPerformance(content, report);
        else if (this.tab === 'trades') this.renderTrades(content, report);
        else this.renderProperties(content);
        view.replaceChildren(wrap);
        const nextScroll = view.querySelector<HTMLElement>('.vela-st-scroll') ?? view.querySelector<HTMLElement>('.vela-st-content');
        const tradeView = this.tradeView as StrategyTradeTable | null; // renderTrades may have installed it
        if (nextScroll) {
            if (tradeView?.el === nextScroll) tradeView.restoreScroll(top, left);
            else { nextScroll.scrollTop = top; nextScroll.scrollLeft = left; }
        }
        if (focusKey) {
            const next = Array.from(view.querySelectorAll<HTMLButtonElement>('.vela-st-trade-toggle'))
                .find((button) => button.dataset.tradeKey === focusKey);
            next?.focus({ preventScroll: true });
        } else if (focusScroll) nextScroll?.focus({ preventScroll: true });
        else if (focusView) view.focus({ preventScroll: true });
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

        if (report.equity.length === 0) {
            const note = doc.createElement('div');
            note.className = 'vela-st-note';
            note.textContent = this.ledgerStatus === 'loading' ? 'Loading the trade ledger…'
                : this.ledgerStatus === 'unavailable' ? 'The trade ledger is unavailable; the curve cannot be displayed.'
                    : all.trades === 0 && all.openTrades === 0 ? 'The strategy has not traded over the loaded history.'
                        : 'The engine did not provide individual trades for the curve.';
            root.appendChild(note);
        }
        // Do not paint a superseded report if two runs arrive in the same frame.
        requestAnimationFrame(() => { if (this.report === report) this.paintEquity(report); });
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

    private tableScroll(label: string): HTMLElement {
        const scroll = this.el.ownerDocument.createElement('div');
        scroll.className = 'vela-st-scroll';
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', label);
        return scroll;
    }

    private renderPerformance(root: HTMLElement, report: StrategyReport): void {
        const doc = this.el.ownerDocument;
        const scroll = this.tableScroll('Performance table. Scroll for more rows and columns.');
        const table = doc.createElement('table');
        table.className = 'vela-st-table vela-st-perf';
        table.setAttribute('aria-label', 'Strategy performance');
        const thead = doc.createElement('thead');
        const hr = doc.createElement('tr');
        for (const h of ['Metric', 'All', 'Long', 'Short']) {
            const th = doc.createElement('th');
            th.scope = 'col';
            th.textContent = h;
            hr.appendChild(th);
        }
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = doc.createElement('tbody');
        for (const row of performanceRows(report)) {
            const tr = doc.createElement('tr');
            if (row.kind === 'group') {
                tr.className = 'group';
                const th = doc.createElement('th');
                th.colSpan = 4;
                th.textContent = row.label;
                tr.appendChild(th);
                tbody.appendChild(tr);
                continue;
            }
            const lbl = doc.createElement('th');
            lbl.scope = 'row';
            lbl.className = 'lbl';
            lbl.textContent = row.label;
            lbl.title = row.hint;
            lbl.setAttribute('aria-label', row.hint);
            tr.appendChild(lbl);
            for (const cell of [row.all, row.long, row.short]) {
                const td = doc.createElement('td');
                td.textContent = cell.text;
                if (cell.dir !== 0) td.className = cell.dir > 0 ? 'vela-st-up' : 'vela-st-down';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        if (!report.long && !report.short) {
            const note = doc.createElement('div');
            note.className = 'vela-st-note';
            note.textContent = this.ledgerStatus === 'loading' ? 'Loading the trade ledger…'
                : this.ledgerStatus === 'unavailable' ? 'The trade ledger is unavailable for this run.'
                    : 'Long / Short columns need the engine’s per-trade ledger.';
            scroll.appendChild(note);
        }
        root.appendChild(scroll);
    }

    // ---- Trades ---------------------------------------------------------------------

    private renderTrades(root: HTMLElement, report: StrategyReport): void {
        const doc = this.el.ownerDocument;
        if (report.rows.length === 0) {
            const note = doc.createElement('div');
            note.className = 'vela-st-empty';
            note.textContent = this.ledgerStatus === 'loading' ? 'Loading the trade ledger…'
                : this.ledgerStatus === 'unavailable' ? 'The trade ledger is unavailable for this run.'
                    : report.all.trades || report.all.openTrades ? 'The engine did not provide individual trades for this run.'
                        : 'The strategy has not traded over the loaded history.';
            root.appendChild(note);
            return;
        }
        this.tradeView = new StrategyTradeTable(doc, report.rows, {
            expandedKey: this.expandedTrade,
            detailId: `${this.views.get('trades')!.id}-detail`,
            // The ordinal plus entry identity avoids transferring a disclosure to a
            // different trade after a live ledger reorder; no engine id is invented.
            key: (row) => JSON.stringify([row.n, row.side, row.entryTime, row.entryPrice, row.qty]),
            date: (row) => shortStamp(row.entryTime),
            price: (row) => this.priceText(row),
            money: moneyCell,
            ink,
            tooltip: (row) => this.tradeTip(row),
            details: (row) => this.tradeDetails(row),
            onExpand: (key) => { this.expandedTrade = key; },
        });
        root.appendChild(this.tradeView.el);
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

    private tradeDetails(row: TradeReportRow): HTMLTableRowElement {
        const doc = this.el.ownerDocument;
        const tr = doc.createElement('tr');
        tr.className = 'vela-st-trade-details';
        tr.id = `${this.views.get('trades')!.id}-detail`;
        const td = doc.createElement('td');
        td.colSpan = 6;
        const inner = doc.createElement('div');
        inner.className = 'vela-st-detail-inner';
        const dl = doc.createElement('dl');
        dl.className = 'vela-st-detail-grid';
        const fields: Array<[string, string]> = [
            ['Status', row.open ? 'Open' : 'Closed'],
            ['Size', Number.isFinite(row.qty) ? String(row.qty) : '—'],
            ['Entry time (UTC)', stamp(row.entryTime)],
            ['Entry price', this.priceText(row)],
            ['Exit time (UTC)', row.exitTime != null ? stamp(row.exitTime) : '—'],
            ['Exit price', row.exitPrice != null ? fmtPrice(row.exitPrice, Math.abs(row.exitPrice) >= 1 ? 2 : 6) : '—'],
            ['Bars held', row.bars != null ? String(row.bars) : '—'],
            ['Run-up', moneyCell(row.runup)],
            ['Drawdown', moneyCell(row.drawdown)],
        ];
        for (const [label, value] of fields) {
            const pair = doc.createElement('div');
            pair.append(this.dt(label), this.dd(value));
            dl.appendChild(pair);
        }
        inner.appendChild(dl);
        td.appendChild(inner);
        tr.appendChild(td);
        return tr;
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
