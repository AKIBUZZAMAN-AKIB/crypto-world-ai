// Data window — the active chart's formatted bar and indicator readout, in the same
// standard docked panel. The renderer owns numeric formatting and bar resolution;
// this view never derives prices or invents feed status.
import type { Vela } from '../Vela';
import type { DataWindowReadout } from '../core/ports/IChartRenderer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { DataTable } from './data-table';
import { MIN_FLOAT_PANEL_WIDTH, SidePanel } from './side-panel';
import { timeframeLabel } from './timeframe';

const STYLE_ID = 'vela-widget-datawindow';
const CSS = `
.vela-dw .vela-panel-header-slot { justify-content: flex-end; }
.vela-dw[data-standard-pane] .vela-panel-body { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.vela-dw-tabs { display: flex; flex: none; border-bottom: 1px solid var(--vela-border); min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
.vela-dw-tabs::-webkit-scrollbar { display: none; }
/* A tiny card scrolls the whole view instead of squeezing the table below its metadata. */
.vela-dw[data-compact-height='1'] .vela-panel-body { overflow: auto; }
.vela-dw[data-compact-height='1'] .vela-dw-data-view { flex: none; overflow: visible; }
.vela-dw[data-compact-height='1'] .vela-dw-table-view { flex: none; height: 160px; }
.vela-dw-tab {
    all: unset; box-sizing: border-box; position: relative; display: flex; align-items: center;
    justify-content: center; min-width: 68px; min-height: 38px; padding: 0 14px;
    color: var(--vela-fg-muted); font-size: 12px; font-weight: 600; cursor: pointer;
}
.vela-dw-tab:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-dw-tab[aria-selected='true'] { color: var(--vela-fg-bright); }
.vela-dw-tab[aria-selected='true']::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px; background: var(--vela-accent); }
.vela-dw-tab:focus-visible, .vela-dw-data-view:focus-visible, .vela-dw-table-scroll:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-dw-view[hidden], .vela-dw-table[hidden], .vela-dw-table-empty[hidden], .vela-dw-table-spacer[hidden] { display: none !important; }
.vela-dw-data-view { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 8px; }
.vela-dw-table-view { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.vela-dw-table-meta { flex: none; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; padding: 7px 9px; border-bottom: 1px solid var(--vela-border); color: var(--vela-fg-muted); font-size: 11px; line-height: 1.25; }
.vela-dw-table-identity { min-width: 0; max-width: 100%; color: var(--vela-fg-bright); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dw-table-scope { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dw-table-zone { min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dw-table-scroll { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; position: relative; }
.vela-dw-table { table-layout: fixed; border-spacing: 0; border-collapse: separate; font-size: 11px; font-variant-numeric: tabular-nums; user-select: text; -webkit-user-select: text; }
.vela-dw-table th, .vela-dw-table td { box-sizing: border-box; height: 32px; padding: 0 9px; border-right: 1px solid var(--vela-border); border-bottom: 1px solid var(--vela-border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.vela-dw-table th { position: sticky; top: 0; z-index: 2; background: var(--vela-surface-elev, var(--vela-bg)); color: var(--vela-fg-muted); font-weight: 600; }
.vela-dw-table th:first-child, .vela-dw-table td:first-child { position: sticky; left: 0; z-index: 1; background: var(--vela-bg); text-align: left; }
.vela-dw-table th:first-child { z-index: 3; background: var(--vela-surface-elev, var(--vela-bg)); }
.vela-dw-table tbody tr:not(.vela-dw-table-spacer):hover td { background: var(--vela-hover); }
/* The hover wash is translucent. Composite it over the opaque pinned surface rather
   than replacing that surface, or horizontally scrolled values show through it. */
.vela-dw-table tbody tr:not(.vela-dw-table-spacer):hover td:first-child {
    background: linear-gradient(var(--vela-hover), var(--vela-hover)), var(--vela-bg);
}
.vela-dw-table-navigable { cursor: pointer; }
.vela-dw-time-link {
    all: unset; box-sizing: border-box; display: flex; align-items: center; width: 100%; height: 100%;
    cursor: pointer; color: inherit; white-space: nowrap; user-select: text; -webkit-user-select: text;
}
.vela-dw-time-link:hover { color: var(--vela-fg-bright); text-decoration: underline; text-underline-offset: 3px; }
.vela-dw-time-link:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-dw-table td[data-direction='up'] { color: var(--vela-up); }
.vela-dw-table td[data-direction='down'] { color: var(--vela-down); }
.vela-dw-table .vela-dw-table-spacer td { position: static; padding: 0; border: 0; line-height: 0; }
.vela-dw-table-empty { padding: 20px 10px; }
@media (pointer: coarse) { .vela-dw-tab { min-height: 44px; } }
.vela-dw-copy {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 38px;
    min-height: 28px;
    padding: 0 7px;
    border: 1px solid var(--vela-border);
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
}
.vela-dw-copy:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dw-copy:focus-visible, .vela-dw-disclosure:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-dw-copy:disabled { opacity: .45; cursor: default; }
.vela-dw-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 8px;
    padding: 1px 1px 8px;
    min-width: 0;
}
.vela-dw-identity { display: flex; flex: 1 1 100px; min-width: 0; align-items: baseline; flex-wrap: wrap; gap: 4px 6px; }
.vela-dw-symbol { min-width: 0; color: var(--vela-fg-bright); font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.vela-dw-period { color: var(--vela-fg-muted); font-size: 11px; font-weight: 600; white-space: nowrap; }
.vela-dw-source { color: var(--vela-fg-muted); font-size: 11px; white-space: nowrap; }
.vela-dw-feedback { padding: 0 1px 8px; color: var(--vela-fg-muted); font-size: 11px; overflow-wrap: anywhere; }
.vela-dw-feedback:empty { display: none; }
.vela-dw-sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
    align-items: start;
    gap: 8px;
    min-width: 0;
}
.vela-dw-section { min-width: 0; border: 1px solid var(--vela-border); border-radius: 5px; overflow: hidden; container-type: inline-size; }
.vela-dw-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
    line-height: 1.25;
    text-transform: uppercase;
    overflow-wrap: anywhere;
}
.vela-dw-group-name { min-width: 0; overflow-wrap: anywhere; }
.vela-dw-zone { flex: 0 1 auto; color: var(--vela-fg-muted); font-size: 10px; font-weight: 500; letter-spacing: 0; text-align: right; text-transform: none; overflow-wrap: anywhere; }
.vela-dw-group:has(.vela-dw-disclosure) { padding: 0; }
.vela-dw-disclosure {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    min-height: 28px;
    padding: 5px 8px;
    cursor: pointer;
}
.vela-dw-disclosure:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dw-disclosure .vela-icon { width: 13px; height: 13px; transition: transform .12s ease; }
.vela-dw-disclosure[aria-expanded='true'] .vela-icon { transform: rotate(90deg); }
.vela-dw-list { margin: 0; padding: 0 2px 4px; min-width: 0; }
.vela-dw-list[hidden], .vela-dw-sections[hidden], .vela-dw-empty[hidden], .vela-dw-source[hidden], .vela-dw-period[hidden], .vela-dw-zone[hidden] { display: none !important; }
.vela-dw-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    align-items: baseline;
    gap: 8px;
    min-height: 24px;
    padding: 3px 6px;
    box-sizing: border-box;
    border-radius: 3px;
    line-height: 1.35;
}
.vela-dw-row:hover { background: var(--vela-hover); }
.vela-dw-label, .vela-dw-value { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.vela-dw-label { color: var(--vela-fg-muted); }
.vela-dw-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
/* Date and time share a line when possible, keeping OHLC in view on short phones. */
.vela-dw-section[data-kind='time'] .vela-dw-list { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
.vela-dw-section[data-kind='time'] .vela-dw-row { gap: 4px; }
/* A wider card can put the four prices in two columns without dropping a value. */
@container (min-width: 260px) {
    .vela-dw-section[data-kind='price'] .vela-dw-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* The readout is DATA, not chrome: users can select and copy text in every group. */
.vela-dw-symbol, .vela-dw-period, .vela-dw-source, .vela-dw-group, .vela-dw-row { user-select: text; -webkit-user-select: text; }
.vela-dw-disclosure { user-select: none; -webkit-user-select: none; }
.vela-dw-empty { padding: 20px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; line-height: 1.4; }
@media (pointer: coarse) {
    .vela-dw-copy { min-width: 42px; min-height: 36px; }
    .vela-dw-disclosure { min-height: 36px; }
}
@media (prefers-reduced-motion: reduce) { .vela-dw-disclosure .vela-icon { transition: none; } }
`;

/** Events that change the chart's values, visible plots, or the current market. */
const REFRESH_EVENTS = ['bar', 'context:changed', 'indicator:added', 'indicator:removed', 'indicator:visibility', 'indicator:moved', 'pane:changed', 'market:changed', 'history:progress', 'history:complete', 'replay:start', 'replay:step', 'replay:end', 'theme:changed'] as const;

/** One readout line. `color` empty ⇒ the value inherits the panel's text color. */
export interface DataWindowLine {
    label: string;
    value: string;
    color: string;
}

/** A titled block of readout lines. */
export interface DataWindowSection {
    title: string;
    lines: DataWindowLine[];
}

const EM_DASH = '—';

/**
 * Lay out the renderer's already-formatted values: Time, Price, then every indicator.
 * Missing date/time reads as a dash; no market or indicator value is synthesized here.
 */
export function dataWindowSections(readout: DataWindowReadout): DataWindowSection[] {
    const sections: DataWindowSection[] = [];
    if (readout.date || readout.time) {
        sections.push({
            title: 'Time',
            lines: [
                { label: 'Date', value: readout.date || EM_DASH, color: '' },
                { label: 'Time', value: readout.time || EM_DASH, color: '' },
            ],
        });
    }
    const { ohlc } = readout;
    if (ohlc) {
        const color = ohlc.up ? 'var(--vela-up)' : 'var(--vela-down)';
        const lines: DataWindowLine[] = [
            { label: 'Open', value: ohlc.o, color },
            { label: 'High', value: ohlc.h, color },
            { label: 'Low', value: ohlc.l, color },
            { label: 'Close', value: ohlc.c, color },
        ];
        if (ohlc.vol !== undefined) lines.push({ label: 'Volume', value: ohlc.vol, color });
        sections.push({ title: 'Price', lines });
    }
    for (const group of readout.groups) {
        sections.push({ title: group.name, lines: group.rows.map((r) => ({ label: r.label, value: r.value, color: r.color })) });
    }
    return sections;
}

interface Snapshot {
    symbol: string;
    timeframe: string;
    zone: string;
    readout: DataWindowReadout;
}

type SectionKind = 'time' | 'price' | 'indicator';
interface SectionModel extends DataWindowSection {
    key: string;
    kind: SectionKind;
}
interface RowView {
    el: HTMLElement;
    label: HTMLElement;
    value: HTMLElement;
    color: string;
}
interface SectionView {
    el: HTMLElement;
    name: HTMLElement;
    zone: HTMLElement | null;
    button: HTMLButtonElement | null;
    list: HTMLElement;
    rows: RowView[];
}

let sectionSequence = 0;
let windowSequence = 0;
type DataWindowTab = 'data' | 'table';

/** Stable indicator IDs distinguish two studies with the same title. */
function sectionModels(readout: DataWindowReadout): SectionModel[] {
    const sections = dataWindowSections(readout);
    const keys: Array<{ key: string; kind: SectionKind }> = [];
    if (readout.date || readout.time) keys.push({ key: 'time', kind: 'time' });
    if (readout.ohlc) keys.push({ key: 'price', kind: 'price' });
    const seen = new Map<string, number>();
    readout.groups.forEach((group, index) => {
        const base = group.id != null ? `id:${group.id}` : `index:${index}`;
        const occurrence = seen.get(base) ?? 0;
        seen.set(base, occurrence + 1);
        keys.push({ key: `indicator:${base}:${occurrence}`, kind: 'indicator' });
    });
    return sections.map((section, index) => ({ ...section, ...keys[index]! }));
}

/** Plain, complete and spreadsheet-friendly; collapsed indicator sections are included. */
function snapshotText(snapshot: Snapshot): string {
    const identity = [snapshot.symbol, snapshot.timeframe].filter(Boolean).join(' · ');
    const blocks = dataWindowSections(snapshot.readout).map((section, index) => {
        const title = index === 0 && section.title === 'Time' && snapshot.zone ? `Time (${snapshot.zone})` : section.title;
        return [title, ...section.lines.map((line) => `${line.label}\t${line.value}`)].join('\n');
    });
    return [identity, ...blocks].filter(Boolean).join('\n\n');
}

function setText(el: HTMLElement, text: string): void {
    // Setting textContent unnecessarily destroys text selections, even on the same node.
    if (el.textContent !== text) el.textContent = text;
}

export class DataWindow extends SidePanel {
    private chart: Vela | null = null;
    private unsubs: Array<() => void> = [];
    /** Frame-level readout observation is needed only while this panel is open. */
    private readoutUnsub: (() => void) | null = null;
    private loading = false;
    private tab: DataWindowTab = 'data';
    private readonly dataTab: HTMLButtonElement;
    private readonly tableTab: HTMLButtonElement;
    private readonly dataView: HTMLElement;
    private readonly tableView: DataTable;
    private readonly copyButton: HTMLButtonElement;
    private readonly symbol: HTMLElement;
    private readonly period: HTMLElement;
    private readonly source: HTMLElement;
    private readonly feedback: HTMLElement;
    private readonly empty: HTMLElement;
    private readonly sectionsEl: HTMLElement;
    private readonly views = new Map<string, SectionView>();
    private readonly collapsed = new Set<string>();
    private displayed: Snapshot | null = null;
    private feedbackTimer: number | null = null;
    private destroyed = false;

    constructor(host: HTMLElement) {
        super(host, 'Data window', 'vela-dw', {
            resizable: true,
            width: 280,
            minWidth: MIN_FLOAT_PANEL_WIDTH,
            maxWidth: 520,
            standardPane: true,
            // Room for the grip, title, tabs, metadata, table header and a candle even
            // in a 240×320 host; the pane never exceeds the host itself.
            mobileMinHeight: 216,
        });
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        const id = ++windowSequence;
        const tabs = doc.createElement('div');
        tabs.className = 'vela-dw-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Data window view');
        this.dataTab = doc.createElement('button');
        this.tableTab = doc.createElement('button');
        for (const [tab, name] of [[this.dataTab, 'Data'], [this.tableTab, 'Table']] as const) {
            tab.type = 'button';
            tab.className = 'vela-dw-tab';
            tab.id = `vela-dw-${id}-tab-${name.toLowerCase()}`;
            tab.textContent = name;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', `vela-dw-${id}-view-${name.toLowerCase()}`);
            tab.addEventListener('click', () => this.selectTab(name.toLowerCase() as DataWindowTab));
            tab.addEventListener('keydown', (event) => {
                // Tabs wrap in either direction; Home/End jump to the endpoints.
                const next = event.key === 'Home' ? 'data' : event.key === 'End' ? 'table'
                    : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                        ? name === 'Data' ? 'table' : 'data' : null;
                if (!next) return;
                event.preventDefault();
                this.selectTab(next, true);
            });
        }
        tabs.append(this.dataTab, this.tableTab);
        this.dataView = doc.createElement('div');
        this.dataView.className = 'vela-dw-view vela-dw-data-view';
        this.dataView.id = `vela-dw-${id}-view-data`;
        this.dataView.tabIndex = 0;
        this.dataView.setAttribute('role', 'tabpanel');
        this.dataView.setAttribute('aria-labelledby', this.dataTab.id);
        this.tableView = new DataTable(doc);
        this.tableView.el.id = `vela-dw-${id}-view-table`;
        this.tableView.el.setAttribute('role', 'tabpanel');
        this.tableView.el.setAttribute('aria-labelledby', this.tableTab.id);
        this.body.append(tabs, this.dataView, this.tableView.el);
        const summary = doc.createElement('div');
        summary.className = 'vela-dw-summary';
        const identity = doc.createElement('div');
        identity.className = 'vela-dw-identity';
        this.symbol = doc.createElement('span');
        this.symbol.className = 'vela-dw-symbol';
        this.period = doc.createElement('span');
        this.period.className = 'vela-dw-period';
        identity.append(this.symbol, this.period);
        this.source = doc.createElement('span');
        this.source.className = 'vela-dw-source';
        this.copyButton = doc.createElement('button');
        this.copyButton.type = 'button';
        this.copyButton.className = 'vela-dw-copy';
        this.copyButton.textContent = 'Copy';
        this.copyButton.title = 'Copy all data window values';
        this.copyButton.setAttribute('aria-label', 'Copy all data window values');
        this.copyButton.addEventListener('click', () => { void this.copyValues(); });
        summary.append(identity, this.source, this.copyButton);
        this.feedback = doc.createElement('div');
        this.feedback.className = 'vela-dw-feedback';
        this.feedback.setAttribute('role', 'status'); // only explicit copy actions announce
        this.empty = doc.createElement('div');
        this.empty.className = 'vela-dw-empty';
        this.sectionsEl = doc.createElement('div');
        this.sectionsEl.className = 'vela-dw-sections';
        this.dataView.append(summary, this.feedback, this.empty, this.sectionsEl);
        this.selectTab('data');
    }

    private selectTab(tab: DataWindowTab, focus = false): void {
        this.tab = tab;
        const data = tab === 'data';
        this.dataTab.setAttribute('aria-selected', String(data));
        this.tableTab.setAttribute('aria-selected', String(!data));
        this.dataTab.tabIndex = data ? 0 : -1;
        this.tableTab.tabIndex = data ? -1 : 0;
        this.dataView.hidden = !data;
        this.tableView.el.hidden = data;
        this.tableView.setActive(this.open && !data);
        if (this.open) this.refresh();
        if (focus) (data ? this.dataTab : this.tableTab).focus();
    }

    override toggle(open = !this.open, instant = false): void {
        if (!open && this.open) {
            this.readoutUnsub?.();
            this.readoutUnsub = null;
        }
        super.toggle(open, instant);
        this.tableView.setActive(open && this.open && this.tab === 'table');
        if (open && this.open) {
            this.observeReadout();
            this.refresh();
        }
    }

    /** Rebind to the active chart; no values leak between cells. */
    onChart(chart: Vela): void {
        if (this.chart === chart) { this.refresh(); return; }
        this.detach();
        this.chart = chart;
        // A panel can be opened/rebound after load:start already fired.
        this.loading = chart.loading === true;
        this.tableView.onChart(chart, this.loading);
        this.collapsed.clear();
        for (const ev of REFRESH_EVENTS) this.unsubs.push(chart.on(ev, () => this.refresh()));
        this.unsubs.push(chart.on('market:requested', () => {
            // A superseding identity shares the existing transition-guarded load:start.
            this.loading = true;
            this.refresh();
        }));
        this.unsubs.push(chart.on('load:start', () => {
            // load:start precedes the renderer blanking OLD bars. Do not put the newly
            // requested symbol above those old values, even for a single async load.
            this.loading = true;
            this.refresh();
        }));
        this.unsubs.push(chart.on('load:end', () => { this.loading = false; this.refresh(); }));
        if (typeof chart.renderer.onCrosshairMove === 'function') this.unsubs.push(chart.renderer.onCrosshairMove(() => { if (this.tab === 'data') this.refresh(); }));
        // The event precedes the renderer's data re-derivation; read the settled style on
        // the next frame, even if its latest candle happened to remain numerically equal.
        this.unsubs.push(chart.on('priceStyle:change', () => {
            this.el.ownerDocument.defaultView?.requestAnimationFrame(() => this.refresh());
        }));
        if (typeof chart.renderer.onConfigChanged === 'function') this.unsubs.push(chart.renderer.onConfigChanged(() => this.refresh()));
        if (this.open) this.observeReadout();
        this.refresh();
    }

    override destroy(): void {
        this.destroyed = true;
        this.detach();
        this.tableView.destroy();
        const doc = this.el.ownerDocument;
        if (this.feedbackTimer != null) doc.defaultView?.clearTimeout(this.feedbackTimer);
        super.destroy();
    }

    private observeReadout(): void {
        if (!this.readoutUnsub && this.chart && typeof this.chart.renderer.onDataWindowChange === 'function') {
            this.readoutUnsub = this.chart.renderer.onDataWindowChange(() => this.refresh());
        }
    }

    private detach(): void {
        this.readoutUnsub?.();
        this.readoutUnsub = null;
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.chart = null;
    }

    private readSnapshot(): Snapshot | null {
        const chart = this.chart;
        if (!chart) return null;
        const readout = chart.renderer.dataWindowReadout();
        if (!readout) return null;
        const market = chart.market;
        const zone = chart.renderer.get('timezone');
        return {
            symbol: market.symbol ?? '',
            timeframe: market.timeframe ? timeframeLabel(market.timeframe) : '',
            zone: typeof zone === 'string' ? zone : '',
            readout,
        };
    }

    private async copyValues(): Promise<void> {
        const snapshot = this.displayed;
        if (!snapshot) return;
        const clipboard = this.el.ownerDocument.defaultView?.navigator.clipboard;
        try {
            if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
            await clipboard.writeText(snapshotText(snapshot));
            if (!this.destroyed) this.showFeedback('Copied');
        } catch {
            if (!this.destroyed) this.showFeedback('Copy unavailable. Select the values to copy.');
        }
    }

    private showFeedback(message: string): void {
        const win = this.el.ownerDocument.defaultView;
        if (this.feedbackTimer != null) win?.clearTimeout(this.feedbackTimer);
        setText(this.feedback, message);
        this.feedbackTimer = win?.setTimeout(() => { setText(this.feedback, ''); this.feedbackTimer = null; }, 3000) ?? null;
    }

    private refresh(current?: Snapshot | null): void {
        if (!this.open || !this.chart) return;
        this.tableView.refresh(this.loading);
        if (this.tab !== 'data') return;
        const actual = current === undefined ? this.readSnapshot() : current;
        const snapshot = this.loading ? null : actual;
        this.displayed = snapshot;
        const market = this.chart.market;
        setText(this.symbol, snapshot?.symbol || market.symbol || 'Chart');
        const timeframe = snapshot?.timeframe ?? (market.timeframe ? timeframeLabel(market.timeframe) : '');
        setText(this.period, timeframe);
        this.period.hidden = !timeframe;
        const models = snapshot ? sectionModels(snapshot.readout) : [];
        const available = models.length > 0;
        this.copyButton.disabled = !available;
        const source = snapshot?.readout.source === 'crosshair' ? 'Crosshair'
            : snapshot?.readout.source === 'synced' ? 'Synced crosshair'
                : snapshot?.readout.source === 'latest' ? 'Latest bar' : '';
        setText(this.source, available ? source : '');
        this.source.hidden = !available || !source;
        this.empty.hidden = available;
        this.sectionsEl.hidden = !available;
        if (!available) {
            setText(this.empty, this.loading ? 'Loading chart data…' : actual ? 'No chart data' : 'This renderer provides no data readout.');
            return;
        }
        this.syncSections(models, snapshot?.zone ?? '');
    }

    private makeSection(model: SectionModel): SectionView {
        const doc = this.el.ownerDocument;
        const el = doc.createElement('section');
        el.className = 'vela-dw-section';
        el.dataset.kind = model.kind;
        const heading = doc.createElement('h3');
        heading.className = 'vela-dw-group';
        const name = doc.createElement('span');
        name.className = 'vela-dw-group-name';
        const list = doc.createElement('dl');
        list.className = 'vela-dw-list';
        let button: HTMLButtonElement | null = null;
        let zone: HTMLElement | null = null;
        if (model.kind === 'indicator') {
            button = doc.createElement('button');
            button.type = 'button';
            button.className = 'vela-dw-disclosure';
            list.id = `vela-dw-values-${++sectionSequence}`;
            button.setAttribute('aria-controls', list.id);
            button.append(name, iconEl('chevron-right', doc));
            button.addEventListener('click', () => {
                if (this.collapsed.has(model.key)) this.collapsed.delete(model.key);
                else this.collapsed.add(model.key);
                this.paintDisclosure(model.key, button!, list);
            });
            heading.appendChild(button);
        } else {
            heading.appendChild(name);
            if (model.kind === 'time') {
                zone = doc.createElement('span');
                zone.className = 'vela-dw-zone';
                heading.appendChild(zone);
            }
        }
        el.append(heading, list);
        return { el, name, zone, button, list, rows: [] };
    }

    private paintDisclosure(key: string, button: HTMLButtonElement, list: HTMLElement): void {
        const expanded = !this.collapsed.has(key);
        button.setAttribute('aria-expanded', String(expanded));
        list.hidden = !expanded;
    }

    /** Reconcile only structural changes; a crosshair/tick touches changed text nodes only. */
    private syncSections(models: SectionModel[], zone: string): void {
        const doc = this.el.ownerDocument;
        const focused = doc.activeElement && this.sectionsEl.contains(doc.activeElement) ? doc.activeElement as HTMLElement : null;
        const scrollTop = this.dataView.scrollTop;
        const wanted = new Set(models.map((model) => model.key));
        for (const [key, view] of this.views) {
            if (wanted.has(key)) continue;
            view.el.remove();
            this.views.delete(key);
            this.collapsed.delete(key);
        }
        for (const [index, model] of models.entries()) {
            let view = this.views.get(model.key);
            if (!view) {
                view = this.makeSection(model);
                this.views.set(model.key, view);
            }
            const at = this.sectionsEl.children[index];
            if (at !== view.el) this.sectionsEl.insertBefore(view.el, at ?? null);
            setText(view.name, model.title);
            if (view.zone) { setText(view.zone, zone); view.zone.hidden = !zone; }
            if (view.button) this.paintDisclosure(model.key, view.button, view.list);
            for (const [rowIndex, line] of model.lines.entries()) {
                let row = view.rows[rowIndex];
                if (!row) {
                    const doc = this.el.ownerDocument;
                    const el = doc.createElement('div');
                    el.className = 'vela-dw-row';
                    const label = doc.createElement('dt');
                    label.className = 'vela-dw-label';
                    const value = doc.createElement('dd');
                    value.className = 'vela-dw-value';
                    el.append(label, value);
                    view.list.appendChild(el);
                    row = { el, label, value, color: '' };
                    view.rows.push(row);
                }
                setText(row.label, line.label);
                setText(row.value, line.value);
                if (row.color !== line.color) {
                    row.color = line.color;
                    row.value.style.color = line.color;
                }
            }
            while (view.rows.length > model.lines.length) view.rows.pop()!.el.remove();
        }
        // insertBefore of a reordered section can blur its focused disclosure button in
        // browsers. Restore only that same still-connected control, without scrolling.
        if (focused?.isConnected && doc.activeElement !== focused) focused.focus({ preventScroll: true });
        if (this.dataView.scrollTop !== scrollTop) this.dataView.scrollTop = scrollTop;
    }
}
