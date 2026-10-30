// The workspace's layout-and-sync pane. One live view is shared by the desktop dock,
// floating cards and the bottom-attached phone pane. The actual layout and sync state
// stays in the workspace; this class only projects it and routes user actions.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { isRtl } from '../ui/gesture';
import { Tooltip } from '../ui/components/tooltip';
import { layoutGridCanvas, paintLayoutGrid, type LayoutPickerShape } from './layout-picker';
import { SidePanel, MIN_FLOAT_PANEL_WIDTH } from './side-panel';
import { SyncMatrix, type SyncMatrixChart, type SyncMatrixLink } from './sync-matrix';

const STYLE_ID = 'vela-layout-setup-v1';
const CSS = `
.vela-layout-setup[data-standard-pane] .vela-panel-body { display:flex; flex-direction:column; padding:0; overflow:hidden; }
.vela-ls-tabs { display:flex; flex:none; min-width:0; overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none; border-bottom:1px solid var(--vela-border); }
.vela-ls-tabs::-webkit-scrollbar { display:none; }
.vela-ls-tab { all:unset; box-sizing:border-box; position:relative; flex:none; min-height:38px; padding:0 14px; color:var(--vela-fg-muted); font-size:12px; font-weight:600; white-space:nowrap; cursor:pointer; }
.vela-ls-tab:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ls-tab[aria-selected='true'] { color:var(--vela-fg-bright); }
.vela-ls-tab[aria-selected='true']::after { content:''; position:absolute; left:12px; right:12px; bottom:0; height:2px; background:var(--vela-accent); }
.vela-ls-view[hidden], .vela-ls-panel-section[hidden], .vela-ls-row[hidden], .vela-ls-message[hidden] { display:none !important; }
.vela-ls-view { flex:1 1 auto; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; padding:10px; }
.vela-layout-setup[data-compact-height='1'] .vela-panel-body { overflow:auto; }
.vela-layout-setup[data-compact-height='1'] .vela-ls-view { flex:none; min-height:120px; overflow:visible; }
.vela-ls-summary { display:flex; align-items:center; gap:9px; min-width:0; padding:10px; border:1px solid var(--vela-border); background:var(--vela-surface-elev, var(--vela-bg)); }
.vela-ls-summary-glyph { display:grid; place-items:center; flex:none; width:36px; height:36px; color:var(--vela-accent-ink, var(--vela-accent)); background:var(--vela-hover); border:1px solid var(--vela-border); }
.vela-ls-summary-glyph svg { width:22px; height:22px; }
.vela-ls-summary-text { display:flex; flex:1 1 auto; flex-direction:column; gap:2px; min-width:0; }
.vela-ls-summary-label, .vela-ls-summary-meta { color:var(--vela-fg-muted); font-size:11px; line-height:1.25; }
.vela-ls-summary-name { overflow:hidden; color:var(--vela-fg-bright); font-size:13px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.vela-ls-share { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:none; width:30px; height:30px; color:var(--vela-fg-muted); cursor:pointer; }
.vela-ls-share:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ls-share svg { width:16px; height:16px; }
.vela-ls-message { margin:6px 1px 0; color:var(--vela-fg-muted); font-size:11px; overflow-wrap:anywhere; }
.vela-ls-panel-section { margin-top:14px; min-width:0; }
.vela-ls-sectionhead { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:4px 8px; margin-bottom:6px; }
.vela-ls-heading { margin:0; color:var(--vela-fg-bright); font-size:12px; font-weight:650; }
.vela-ls-caption { color:var(--vela-fg-muted); font-size:11px; line-height:1.35; }
.vela-ls-help { all:unset; box-sizing:border-box; display:grid; place-items:center; width:24px; height:24px; border:1px solid var(--vela-border); color:var(--vela-fg-muted); font-size:11px; font-weight:650; cursor:pointer; }
.vela-ls-help:hover, .vela-ls-help:focus-visible { color:var(--vela-fg-bright); border-color:var(--vela-fg-bright); outline:none; }
.vela-ls-helptext { margin:0 0 8px; color:var(--vela-fg-muted); font-size:11px; line-height:1.4; }
.vela-ls-helptext[hidden] { display:none; }
.vela-ls-gridbox { display:flex; flex-wrap:wrap; align-items:center; gap:12px; min-width:0; padding:9px; border:1px solid var(--vela-border); }
.vela-layout-setup .vela-lp-grid { display:grid; flex:0 1 172px; width:min(100%, 172px); min-width:min(120px, 100%); grid-template-columns:repeat(4, minmax(0, 1fr)); grid-auto-rows:auto; gap:4px; }
.vela-layout-setup.vela-panel .vela-lp-sq { box-sizing:border-box; width:100%; height:auto; aspect-ratio:1; border-radius:0; }
.vela-layout-setup .vela-lp-sq[data-on='1'] { background:var(--vela-accent-ink, var(--vela-accent)); border-color:var(--vela-accent-ink, var(--vela-accent)); }
.vela-ls-gridstatus { flex:1 1 0; min-width:0; color:var(--vela-fg-muted); font-size:11px; line-height:1.4; overflow-wrap:anywhere; }
.vela-ls-gridstatus b { display:block; color:var(--vela-fg-bright); font-size:12px; font-weight:650; }
.vela-ls-presets { display:flex; flex-direction:column; gap:8px; }
.vela-ls-presetcount { margin:0 0 5px; color:var(--vela-fg-muted); font-size:11px; font-weight:600; }
.vela-ls-presetrow { display:grid; grid-template-columns:repeat(auto-fill, minmax(42px, 1fr)); gap:5px; }
.vela-ls-preset { all:unset; box-sizing:border-box; display:flex; align-items:center; justify-content:center; min-width:0; min-height:40px; aspect-ratio:1.1; padding:7px; border:1px solid var(--vela-border); background:var(--vela-surface-elev, var(--vela-bg)); color:var(--vela-fg-muted); cursor:pointer; }
.vela-ls-preset:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ls-preset[aria-checked='true'] { color:var(--vela-accent-ink, var(--vela-accent)); border-color:var(--vela-accent-ink, var(--vela-accent)); background:color-mix(in srgb, var(--vela-accent) 12%, var(--vela-bg)); }
.vela-ls-preset svg { width:100%; height:100%; max-width:32px; max-height:32px; }
.vela-ls-preset:not([data-icon]) { aspect-ratio:auto; grid-column:span 2; font-size:11px; text-align:center; overflow-wrap:anywhere; }
.vela-ls-rows { border:1px solid var(--vela-border); }
.vela-ls-row { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:8px; width:100%; min-width:0; min-height:36px; padding:7px 9px; color:var(--vela-fg); font-size:12px; line-height:1.3; cursor:pointer; }
.vela-ls-row + .vela-ls-row { border-top:1px solid var(--vela-border); }
.vela-ls-row:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ls-row-label { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
.vela-ls-row-value { flex:none; color:var(--vela-fg-muted); font-size:11px; }
.vela-ls-row[data-danger='1'] { color:var(--vela-down); }
.vela-ls-row .vela-icon { width:15px; height:15px; flex:none; color:var(--vela-fg-muted); }
.vela-ls-syncrows { border:1px solid var(--vela-border); }
.vela-ls-switch { flex:none; position:relative; box-sizing:border-box; width:28px; height:16px; border:1px solid var(--vela-border-strong); border-radius:9px; background:var(--vela-hover); }
.vela-ls-switch::after { content:''; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:var(--vela-fg-muted); transition:transform .12s ease; }
.vela-ls-row[aria-checked='true'] .vela-ls-switch { background:var(--vela-selected-bg); border-color:var(--vela-selected-bg); }
.vela-ls-row[aria-checked='true'] .vela-ls-switch::after { transform:translateX(12px); background:var(--vela-selected-fg); }
.vela-ls-matrix { padding:8px; border:1px solid var(--vela-border); background:var(--vela-surface-elev, var(--vela-bg)); min-width:0; }
.vela-ls-matrix .vela-md-matrixwrap { max-width:100%; }
.vela-ls-legend { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
.vela-ls-legend:empty { display:none; }
.vela-ls-group { display:inline-flex; align-items:center; max-width:100%; border:1px solid var(--vela-border); background:var(--vela-bg); }
.vela-ls-group button { all:unset; box-sizing:border-box; min-height:28px; padding:3px 6px; font-size:11px; cursor:pointer; }
.vela-ls-group button:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-ls-group-mark { font-size:14px !important; }
.vela-ls-group-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px; }
.vela-ls-group input { box-sizing:border-box; width:90px; min-width:0; height:28px; padding:2px 5px; color:var(--vela-fg-bright); background:var(--vela-bg); border:1px solid var(--vela-accent); font:inherit; font-size:11px; }
.vela-ls-group input[data-mark] { width:40px; }
.vela-ls-linkbar { display:flex; flex-wrap:wrap; gap:5px; }
.vela-ls-linktag { all:unset; box-sizing:border-box; display:grid; place-items:center; min-width:32px; height:32px; padding:0 5px; border:1px solid var(--vela-border); background:var(--vela-surface-elev, var(--vela-bg)); color:var(--vela-fg-muted); font-size:11px; font-weight:650; cursor:pointer; }
.vela-ls-linktag:hover { color:var(--vela-fg-bright); background:var(--vela-hover); }
.vela-ls-linktag[aria-checked='true'] { color:var(--vela-accent-ink, var(--vela-accent)); border-color:var(--vela-accent-ink, var(--vela-accent)); }
.vela-ls-tab:focus-visible, .vela-ls-view:focus-visible, .vela-ls-preset:focus-visible, .vela-ls-row:focus-visible, .vela-ls-share:focus-visible, .vela-ls-linktag:focus-visible, .vela-ls-group button:focus-visible, .vela-layout-setup .vela-lp-grid:focus-visible { outline:2px solid var(--vela-fg-bright); outline-offset:-2px; }
@media (pointer:coarse) {
  .vela-layout-setup .vela-lp-grid { flex-basis:188px; width:min(100%, 188px); }
  .vela-ls-tab { min-height:44px; }
  .vela-ls-row { min-height:44px; }
  .vela-ls-share, .vela-ls-linktag { min-width:44px; min-height:44px; }
  .vela-ls-preset { min-height:44px; }
  .vela-ls-group button { min-height:40px; }
}
@media (prefers-reduced-motion:reduce) { .vela-ls-switch::after { transition:none; } }
`;

type SetupTab = 'layout' | 'sync';
type SyncRow = SyncMatrixLink & { checked: boolean };
type Preset = { id: string; label: string; checked: boolean; icon?: string; cells?: number };
type Group = { id: string; mark: string; color?: string; name: string; count: number };

export interface LayoutSetupPanelOptions {
    shape: () => LayoutPickerShape | null;
    presets: () => Preset[];
    glyph: () => string;
    onSelectGrid: (rows: number, cols: number) => void;
    onSelectPreset: (id: string) => void;
    syncs: () => SyncRow[];
    onToggleSync: (id: string) => void;
    charts: () => SyncMatrixChart[];
    onSelectChart: (id: string) => void;
    onCycleCellGroup: (kind: string, id: string) => void;
    onSetCellGroup: (kind: string, id: string, mark: string | null) => void;
    onAllInOneGroup: (kind: string) => void;
    legend: () => Group[];
    groupName: (id: string) => string | undefined;
    onRenameGroup: (id: string, name: string | null) => void;
    onSetGroupMark: (id: string, mark: string | null) => void;
    drawingsScope: () => 'layout' | 'global';
    onToggleDrawingsScope: () => void;
    onApplySettingsToAll: () => void;
    onApplyIndicatorsToAll: () => void;
    hiddenCharts: () => number;
    onClearPooled: () => void;
    clearedCharts: () => number;
    onRestorePooled: () => void;
    linkGroup: () => string | null;
    onLinkGroup: (tag: string | null) => void;
    onOpenManager: (anchor: HTMLElement) => void;
    onShareLink: () => Promise<string | null>;
}

let setupSequence = 0;

export class LayoutSetupPanel extends SidePanel {
    private readonly doc: Document;
    private readonly layoutTab: HTMLButtonElement;
    private readonly syncTab: HTMLButtonElement;
    private readonly layoutView: HTMLElement;
    private readonly syncView: HTMLElement;
    private readonly summaryGlyph: HTMLElement;
    private readonly summaryName: HTMLElement;
    private readonly summaryMeta: HTMLElement;
    private readonly message: HTMLElement;
    private readonly grid: HTMLElement;
    private readonly squares: HTMLButtonElement[];
    private readonly gridStatus: HTMLElement;
    private readonly infoTip: Tooltip;
    private readonly presetsEl: HTMLElement;
    private readonly syncRows: HTMLElement;
    private readonly scopeValue: HTMLElement;
    private readonly matrixSection: HTMLElement;
    private readonly matrix: SyncMatrix;
    private readonly legendEl: HTMLElement;
    private readonly poolButton: HTMLButtonElement;
    private readonly poolUndo: HTMLButtonElement;
    private readonly linkButtons: HTMLButtonElement[] = [];
    private tab: SetupTab = 'layout';
    private cursor = { rows: 1, cols: 1 };
    private preview: LayoutPickerShape | null = null;
    private presetSignature = '';
    private syncSignature = '';
    private legendSignature = '';
    private poolArmed = false;
    private messageTimer: ReturnType<typeof setTimeout> | null = null;
    private dead = false;
    private returnFocus: HTMLElement | null = null;

    constructor(host: HTMLElement, private readonly opts: LayoutSetupPanelOptions) {
        super(host, 'Layout setup', 'vela-layout-setup', { resizable: true, width: 340, minWidth: MIN_FLOAT_PANEL_WIDTH, maxWidth: 720, standardPane: true, mobileMinHeight: 216 });
        this.doc = host.ownerDocument;
        const doc = this.doc;
        injectStyles(STYLE_ID, CSS, doc);
        const id = ++setupSequence;
        this.el.id = `vela-layout-setup-${id}`;
        this.el.setAttribute('role', 'region');
        this.el.setAttribute('aria-label', 'Layout setup');
        // Unlike the old popover, this is a persistent, non-modal pane. Escape still
        // closes it when focus is inside, preserving the prior keyboard exit without
        // intercepting Escape from the chart or another floating surface.
        this.el.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            this.toggle(false);
        });
        const tabs = doc.createElement('div');
        tabs.className = 'vela-ls-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Layout setup views');
        const makeTab = (name: string, key: SetupTab): HTMLButtonElement => {
            const tab = doc.createElement('button');
            tab.type = 'button';
            tab.id = `vela-ls-${id}-tab-${key}`;
            tab.className = 'vela-ls-tab';
            tab.textContent = name;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', `vela-ls-${id}-view-${key}`);
            tab.addEventListener('click', () => this.selectTab(key));
            tab.addEventListener('keydown', (event) => {
                const next = event.key === 'Home' ? 'layout' : event.key === 'End' ? 'sync'
                    : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (key === 'layout' ? 'sync' : 'layout') : null;
                if (!next) return;
                event.preventDefault();
                event.stopPropagation();
                this.selectTab(next, true);
            });
            return tab;
        };
        this.layoutTab = makeTab('Layout', 'layout');
        this.syncTab = makeTab('Chart syncing', 'sync');
        tabs.append(this.layoutTab, this.syncTab);
        const view = (key: SetupTab, tab: HTMLButtonElement): HTMLElement => {
            const el = doc.createElement('div');
            el.className = `vela-ls-view vela-ls-${key}-view`;
            el.id = `vela-ls-${id}-view-${key}`;
            el.tabIndex = 0;
            el.setAttribute('role', 'tabpanel');
            el.setAttribute('aria-labelledby', tab.id);
            return el;
        };
        this.layoutView = view('layout', this.layoutTab);
        this.syncView = view('sync', this.syncTab);
        this.body.append(tabs, this.layoutView, this.syncView);

        const summary = doc.createElement('div');
        summary.className = 'vela-ls-summary';
        this.summaryGlyph = doc.createElement('span');
        this.summaryGlyph.className = 'vela-ls-summary-glyph';
        this.summaryGlyph.setAttribute('aria-hidden', 'true');
        const summaryText = doc.createElement('div');
        summaryText.className = 'vela-ls-summary-text';
        const summaryLabel = doc.createElement('span');
        summaryLabel.className = 'vela-ls-summary-label';
        summaryLabel.textContent = 'Current layout';
        this.summaryName = doc.createElement('b');
        this.summaryName.className = 'vela-ls-summary-name';
        this.summaryMeta = doc.createElement('span');
        this.summaryMeta.className = 'vela-ls-summary-meta';
        summaryText.append(summaryLabel, this.summaryName, this.summaryMeta);
        const share = doc.createElement('button');
        share.type = 'button';
        share.className = 'vela-ls-share';
        share.title = 'Copy workspace share link';
        share.setAttribute('aria-label', share.title);
        share.append(iconEl('link', doc));
        share.addEventListener('click', () => { void this.share(); });
        summary.append(this.summaryGlyph, summaryText, share);
        this.message = doc.createElement('div');
        this.message.className = 'vela-ls-message';
        this.message.setAttribute('role', 'status');
        this.message.hidden = true;
        this.layoutView.append(summary, this.message);

        const gridSec = this.section(this.layoutView, 'Custom grid', 'Choose up to 4 × 4');
        const help = doc.createElement('button');
        help.type = 'button';
        help.className = 'vela-ls-help';
        help.textContent = '?';
        help.setAttribute('aria-label', 'How to choose a layout');
        help.setAttribute('aria-expanded', 'false');
        help.setAttribute('aria-controls', `vela-ls-${id}-grid-help`);
        gridSec.querySelector('.vela-ls-sectionhead')!.append(help);
        const helpText = doc.createElement('p');
        helpText.id = `vela-ls-${id}-grid-help`;
        helpText.className = 'vela-ls-helptext';
        helpText.textContent = 'Select a square to apply that columns × rows layout. Use arrow keys and Enter on a keyboard.';
        helpText.hidden = true;
        help.addEventListener('click', () => { helpText.hidden = !helpText.hidden; help.setAttribute('aria-expanded', String(!helpText.hidden)); });
        gridSec.append(helpText);
        this.infoTip = new Tooltip(help, {
            host: host.closest<HTMLElement>('.vela-workspace') ?? host,
            placement: 'bottom',
            content: () => {
                const tip = doc.createElement('div');
                tip.className = 'vela-lp-tip';
                tip.textContent = 'Select a square to apply that columns × rows layout.';
                return tip;
            },
        });
        const gridBox = doc.createElement('div');
        gridBox.className = 'vela-ls-gridbox';
        const { el, squares } = layoutGridCanvas(doc);
        this.grid = el;
        this.squares = squares;
        for (const sq of squares) sq.type = 'button';
        this.gridStatus = doc.createElement('div');
        this.gridStatus.className = 'vela-ls-gridstatus';
        gridBox.append(this.grid, this.gridStatus);
        gridSec.append(gridBox);
        this.grid.addEventListener('click', (event) => {
            const target = (event.target as Element | null)?.closest<HTMLButtonElement>('.vela-lp-sq');
            if (!target || !this.grid.contains(target)) return;
            this.applyGrid(Number(target.dataset.r) + 1, Number(target.dataset.c) + 1);
        });
        this.grid.addEventListener('pointermove', (event) => {
            if (event.pointerType === 'touch') return;
            const target = (event.target as Element | null)?.closest<HTMLButtonElement>('.vela-lp-sq');
            if (!target) return;
            this.preview = { rows: Number(target.dataset.r) + 1, cols: Number(target.dataset.c) + 1 };
            this.paintGrid();
        });
        this.grid.addEventListener('pointerleave', () => { this.preview = null; this.paintGrid(); });
        this.grid.addEventListener('focus', () => {
            this.cursor = { ...(this.opts.shape() ?? { rows: 1, cols: 1 }) };
            this.preview = { ...this.cursor };
            this.paintGrid();
        });
        this.grid.addEventListener('blur', () => { this.preview = null; this.paintGrid(); });
        this.grid.addEventListener('keydown', (event) => this.onGridKey(event));

        const presetSec = this.section(this.layoutView, 'Layout presets');
        // Radios in a toolbar use arrow keys to move focus and Space/Enter to apply,
        // so exploring expensive layouts does not rebuild the workspace on every arrow.
        presetSec.setAttribute('role', 'toolbar');
        presetSec.setAttribute('aria-label', 'Layout presets');
        this.presetsEl = doc.createElement('div');
        this.presetsEl.className = 'vela-ls-presets';
        this.presetsEl.setAttribute('role', 'radiogroup');
        this.presetsEl.setAttribute('aria-label', 'Layout presets');
        this.presetsEl.addEventListener('keydown', (event) => this.onPresetKey(event));
        presetSec.append(this.presetsEl);
        const actions = this.section(this.layoutView, 'This layout');
        const actionRows = doc.createElement('div');
        actionRows.className = 'vela-ls-rows';
        actionRows.append(
            this.row('Apply settings to all charts', () => this.opts.onApplySettingsToAll(), 'style-line'),
            this.row('Apply indicators to all charts', () => this.opts.onApplyIndicatorsToAll(), 'indicators'),
        );
        this.poolButton = this.row('Remove hidden charts', () => {
            if (!this.poolArmed) this.poolArmed = true;
            else { this.poolArmed = false; this.opts.onClearPooled(); }
            this.refresh();
        });
        this.poolUndo = this.row('Undo — restore hidden charts', () => { this.opts.onRestorePooled(); this.refresh(); });
        this.poolButton.dataset.action = 'clear-hidden-charts';
        this.poolUndo.dataset.action = 'undo-hidden-charts';
        actionRows.append(this.poolButton, this.poolUndo);
        actions.append(actionRows);
        const linkSec = this.section(this.layoutView, 'Link tabs', 'Share market changes with linked tabs');
        const linkbar = doc.createElement('div');
        linkbar.className = 'vela-ls-linkbar';
        linkbar.setAttribute('role', 'radiogroup');
        linkbar.setAttribute('aria-label', 'Link tabs');
        const tags = [null, 'red', 'green', 'blue', 'amber'] as const;
        tags.forEach((tag, i) => {
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'vela-ls-linktag';
            button.dataset.tag = tag ?? 'none';
            button.textContent = tag ? String(i) : '—';
            button.title = tag ? `Link to other tabs in set ${i}` : 'Unlink tabs';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', () => { this.opts.onLinkGroup(tag); this.refresh(); });
            this.linkButtons.push(button);
            linkbar.append(button);
        });
        linkbar.addEventListener('keydown', (event) => {
            if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            const at = this.linkButtons.indexOf(doc.activeElement as HTMLButtonElement);
            if (at < 0) return;
            event.preventDefault();
            event.stopPropagation();
            const rtl = isRtl(linkbar);
            const step = event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowUp' ? -1 : 1;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tags.length - 1 : (at + step + tags.length) % tags.length;
            this.linkButtons[next]!.click();
            this.linkButtons[next]!.focus({ preventScroll: true });
        });
        linkSec.append(linkbar);
        const manageSec = this.section(this.layoutView, 'Saved workspaces');
        const manager = this.row('Manage layouts', () => this.opts.onOpenManager(manager), 'layout');
        manager.classList.add('vela-ls-manager');
        const manageRows = doc.createElement('div');
        manageRows.className = 'vela-ls-rows';
        manageRows.append(manager);
        manageSec.append(manageRows);
        // Keep layout-wide actions and the manager near the grid instead of burying
        // them below dozens of asymmetric preset tiles. The preset gallery remains
        // fully available, in the same scrollable view.
        this.layoutView.append(presetSec);

        const syncSec = this.section(this.syncView, 'Sync options', 'Choose what follows between charts');
        this.syncRows = doc.createElement('div');
        this.syncRows.className = 'vela-ls-syncrows';
        syncSec.append(this.syncRows);
        const scope = this.row('Drawing scope', () => { this.opts.onToggleDrawingsScope(); this.refresh(); });
        scope.dataset.action = 'drawing-scope';
        this.scopeValue = doc.createElement('span');
        this.scopeValue.className = 'vela-ls-row-value';
        scope.append(this.scopeValue);
        const scopeRows = doc.createElement('div');
        scopeRows.className = 'vela-ls-rows';
        scopeRows.style.marginTop = '8px';
        scopeRows.append(scope);
        syncSec.append(scopeRows);
        this.matrixSection = this.section(this.syncView, 'Chart groups', 'Same mark, same group · tap to change, hold for palette');
        const matrixBox = doc.createElement('div');
        matrixBox.className = 'vela-ls-matrix';
        this.matrix = new SyncMatrix({
            doc, host: host.closest<HTMLElement>('.vela-workspace') ?? host,
            onSelectChart: (id) => this.opts.onSelectChart(id),
            onCycleCellGroup: (kind, id) => this.opts.onCycleCellGroup(kind, id),
            onSetCellGroup: (kind, id, mark) => this.opts.onSetCellGroup(kind, id, mark),
            onAllInOneGroup: (kind) => this.opts.onAllInOneGroup(kind),
            groupName: (id) => this.opts.groupName(id),
            onChange: () => this.refresh(),
        });
        this.legendEl = doc.createElement('div');
        this.legendEl.className = 'vela-ls-legend';
        this.legendEl.setAttribute('aria-label', 'Sync groups');
        matrixBox.append(this.matrix.el, this.legendEl);
        this.matrixSection.append(matrixBox);
        this.selectTab('layout');
    }

    private section(parent: HTMLElement, heading: string, caption?: string): HTMLElement {
        const section = this.doc.createElement('section');
        section.className = 'vela-ls-panel-section';
        const head = this.doc.createElement('div');
        head.className = 'vela-ls-sectionhead';
        const title = this.doc.createElement('h3');
        title.className = 'vela-ls-heading';
        title.textContent = heading;
        head.append(title);
        if (caption) {
            const hint = this.doc.createElement('span');
            hint.className = 'vela-ls-caption';
            hint.textContent = caption;
            head.append(hint);
        }
        section.append(head);
        parent.append(section);
        return section;
    }

    private row(label: string, run: () => void, icon?: string): HTMLButtonElement {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.className = 'vela-ls-row';
        if (icon) button.append(iconEl(icon, this.doc));
        const text = this.doc.createElement('span');
        text.className = 'vela-ls-row-label';
        text.textContent = label;
        button.append(text);
        button.addEventListener('click', run);
        return button;
    }

    selectTab(tab: SetupTab, focus = false): void {
        this.tab = tab;
        const layout = tab === 'layout';
        this.layoutTab.setAttribute('aria-selected', String(layout));
        this.syncTab.setAttribute('aria-selected', String(!layout));
        this.layoutTab.tabIndex = layout ? 0 : -1;
        this.syncTab.tabIndex = layout ? -1 : 0;
        this.layoutView.hidden = !layout;
        this.syncView.hidden = layout;
        if (this.open) this.refresh();
        if (focus) (layout ? this.layoutTab : this.syncTab).focus({ preventScroll: true });
    }

    focusSelectedTab(): void { (this.tab === 'layout' ? this.layoutTab : this.syncTab).focus({ preventScroll: true }); }
    focusChart(id: string): void { this.matrix.focus(id); }

    /** Remember the door so an in-pane close returns keyboard focus meaningfully. */
    rememberFocus(element: Element | null): void {
        if (element && typeof (element as HTMLElement).focus === 'function' && !this.el.contains(element)) this.returnFocus = element as HTMLElement;
    }

    override toggle(open = !this.open, instant = false): void {
        const changed = open !== this.open;
        const returnFocus = !open && changed && this.el.contains(this.doc.activeElement) ? this.returnFocus : null;
        super.toggle(open, instant);
        if (!changed) return;
        if (open && this.open) this.refresh();
        else if (!open) {
            this.poolArmed = false;
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        }
    }

    /** Reconcile visible state without replacing controls under the pointer or text editor. */
    refresh(): void {
        if (!this.open || this.dead) return;
        const shape = this.opts.shape();
        const charts = this.opts.charts();
        const syncs = this.opts.syncs();
        const presets = this.opts.presets();
        const picked = presets.find((p) => p.checked);
        const name = shape ? `${shape.cols} × ${shape.rows} grid` : picked?.label ?? 'Custom layout';
        const glyph = this.opts.glyph();
        if (this.summaryGlyph.innerHTML !== glyph) this.summaryGlyph.innerHTML = glyph;
        this.summaryName.textContent = name;
        this.summaryName.title = name;
        const enabled = syncs.filter((s) => s.checked).length;
        this.summaryMeta.textContent = `${charts.length} chart${charts.length === 1 ? '' : 's'} · ${enabled} sync${enabled === 1 ? '' : 's'} on`;
        this.paintGrid();
        this.updatePresets(presets);
        this.updateSyncRows(syncs);
        this.scopeValue.textContent = this.opts.drawingsScope() === 'global' ? 'Global' : 'This layout';
        this.matrixSection.hidden = charts.length < 2;
        this.matrix.el.dataset.shell = this.el.closest('[data-layout="mobile"]') ? 'phone' : 'desktop';
        this.matrix.update(charts, syncs);
        this.updateLegend(this.opts.legend());
        const hidden = this.opts.hiddenCharts();
        if (!hidden) this.poolArmed = false;
        this.poolButton.hidden = hidden === 0;
        this.poolButton.dataset.danger = this.poolArmed ? '1' : '0';
        this.poolButton.querySelector<HTMLElement>('.vela-ls-row-label')!.textContent = this.poolArmed
            ? `Remove ${hidden} hidden chart${hidden === 1 ? '' : 's'} — confirm`
            : `Remove ${hidden} hidden chart${hidden === 1 ? '' : 's'}`;
        const cleared = this.opts.clearedCharts();
        this.poolUndo.hidden = cleared === 0;
        this.poolUndo.querySelector<HTMLElement>('.vela-ls-row-label')!.textContent = `Undo — restore ${cleared} hidden chart${cleared === 1 ? '' : 's'}`;
        const link = this.opts.linkGroup() ?? 'none';
        for (const button of this.linkButtons) {
            const pickedTag = button.dataset.tag === link;
            button.setAttribute('aria-checked', String(pickedTag));
            button.tabIndex = pickedTag ? 0 : -1;
        }
    }

    private paintGrid(): void {
        const shape = this.preview ?? this.opts.shape();
        paintLayoutGrid(this.squares, shape);
        const bold = this.doc.createElement('b');
        bold.textContent = shape ? `${shape.cols} × ${shape.rows}` : 'Preset';
        const detail = this.doc.createElement('span');
        detail.textContent = shape ? `${shape.rows * shape.cols} chart${shape.rows * shape.cols === 1 ? '' : 's'}` : 'Select a grid';
        this.gridStatus.replaceChildren(bold, detail);
        this.grid.setAttribute('aria-label', `Layout size${shape ? `, ${shape.cols} by ${shape.rows}` : ''} — arrow keys choose, Enter applies`);
    }

    private applyGrid(rows: number, cols: number): void {
        this.cursor = { rows, cols };
        this.preview = null;
        this.opts.onSelectGrid(rows, cols);
        this.refresh();
    }

    private onGridKey(event: KeyboardEvent): void {
        let { rows, cols } = this.cursor;
        if (event.key === 'ArrowRight') cols += isRtl(this.grid) ? -1 : 1;
        else if (event.key === 'ArrowLeft') cols += isRtl(this.grid) ? 1 : -1;
        else if (event.key === 'ArrowDown') rows += 1;
        else if (event.key === 'ArrowUp') rows -= 1;
        else if (event.key === 'Home') { rows = 1; cols = 1; }
        else if (event.key === 'End') { rows = 4; cols = 4; }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); this.applyGrid(rows, cols); return; }
        else return;
        event.preventDefault();
        event.stopPropagation();
        this.cursor = { rows: Math.max(1, Math.min(4, rows)), cols: Math.max(1, Math.min(4, cols)) };
        this.preview = { ...this.cursor };
        this.paintGrid();
    }

    private updatePresets(presets: Preset[]): void {
        const signature = JSON.stringify(presets.map(({ id, label, icon, cells }) => [id, label, icon, cells]));
        if (signature !== this.presetSignature) {
            this.presetSignature = signature;
            this.presetsEl.replaceChildren();
            const counts = [...new Set(presets.map((p) => p.cells ?? 0))].sort((a, b) => a - b);
            for (const count of counts) {
                const group = this.doc.createElement('div');
                const heading = this.doc.createElement('div');
                heading.className = 'vela-ls-presetcount';
                heading.textContent = count ? `${count} charts` : 'Other layouts';
                const row = this.doc.createElement('div');
                row.className = 'vela-ls-presetrow';
                for (const preset of presets.filter((p) => (p.cells ?? 0) === count)) {
                    const button = this.doc.createElement('button');
                    button.type = 'button';
                    button.className = 'vela-ls-preset';
                    button.dataset.preset = preset.id;
                    button.setAttribute('role', 'radio');
                    button.title = preset.label;
                    button.setAttribute('aria-label', preset.label);
                    if (preset.icon) { button.dataset.icon = '1'; button.innerHTML = preset.icon; }
                    else button.textContent = preset.label;
                    button.addEventListener('click', () => { this.opts.onSelectPreset(preset.id); this.refresh(); });
                    row.append(button);
                }
                group.append(heading, row);
                this.presetsEl.append(group);
            }
        }
        const buttons = [...this.presetsEl.querySelectorAll<HTMLButtonElement>('.vela-ls-preset')];
        const picked = presets.find((p) => p.checked)?.id;
        const focus = this.doc.activeElement;
        const roving = buttons.find((b) => b === focus) ?? buttons.find((b) => b.dataset.preset === picked) ?? buttons[0];
        for (const button of buttons) {
            button.setAttribute('aria-checked', String(button.dataset.preset === picked));
            button.tabIndex = button === roving ? 0 : -1;
        }
    }

    private onPresetKey(event: KeyboardEvent): void {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...this.presetsEl.querySelectorAll<HTMLButtonElement>('.vela-ls-preset')];
        const at = buttons.indexOf(this.doc.activeElement as HTMLButtonElement);
        if (at < 0 || !buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        const rtl = isRtl(this.presetsEl);
        const step = event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowUp' ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, at + step));
        for (const b of buttons) b.tabIndex = -1;
        buttons[next]!.tabIndex = 0;
        buttons[next]!.focus();
    }

    private updateSyncRows(syncs: SyncRow[]): void {
        const signature = JSON.stringify(syncs.map((s) => [s.id, s.label]));
        if (signature !== this.syncSignature) {
            this.syncSignature = signature;
            this.syncRows.replaceChildren();
            for (const item of syncs) {
                const row = this.row(item.label, () => { this.opts.onToggleSync(item.id); this.refresh(); });
                row.dataset.sync = item.id;
                row.setAttribute('role', 'switch');
                row.setAttribute('aria-label', `${item.label} sync`);
                const switchEl = this.doc.createElement('span');
                switchEl.className = 'vela-ls-switch';
                switchEl.setAttribute('aria-hidden', 'true');
                row.append(switchEl);
                this.syncRows.append(row);
            }
        }
        const state = new Map(syncs.map((item) => [item.id, item.checked]));
        for (const row of this.syncRows.querySelectorAll<HTMLElement>('[data-sync]')) row.setAttribute('aria-checked', String(state.get(row.dataset.sync ?? '') === true));
    }

    private updateLegend(groups: Group[]): void {
        const signature = JSON.stringify(groups);
        if (signature === this.legendSignature || this.legendEl.contains(this.doc.activeElement) && this.doc.activeElement?.tagName === 'INPUT') return;
        this.legendSignature = signature;
        this.legendEl.replaceChildren();
        for (const group of groups) {
            const chip = this.doc.createElement('span');
            chip.className = 'vela-ls-group';
            chip.dataset.group = group.id;
            const mark = this.doc.createElement('button');
            mark.type = 'button';
            mark.className = 'vela-ls-group-mark';
            mark.textContent = group.mark;
            if (group.color) mark.style.color = group.color;
            mark.setAttribute('aria-label', `Mark for group ${group.name} is ${group.mark}. Change mark`);
            mark.title = 'Change group mark';
            const name = this.doc.createElement('button');
            name.type = 'button';
            name.className = 'vela-ls-group-name';
            name.textContent = group.name;
            name.title = `${group.count} chart${group.count === 1 ? '' : 's'} · rename group`;
            name.setAttribute('aria-label', `Group ${group.mark}: ${group.name}. Rename`);
            mark.addEventListener('click', () => this.editGroup(mark, group, 'mark'));
            name.addEventListener('click', () => this.editGroup(name, group, 'name'));
            chip.append(mark, name);
            this.legendEl.append(chip);
        }
    }

    private editGroup(button: HTMLButtonElement, group: Group, field: 'mark' | 'name'): void {
        const input = this.doc.createElement('input');
        input.type = 'text';
        input.value = field === 'mark' ? group.mark : group.name;
        input.maxLength = field === 'mark' ? 4 : 24;
        if (field === 'mark') input.dataset.mark = '1';
        input.setAttribute('aria-label', field === 'mark' ? `New mark for group ${group.name}` : `Name for group ${group.mark}`);
        let settled = false;
        const finish = (commit: boolean, refocus: boolean): void => {
            if (settled) return;
            settled = true;
            if (commit) {
                if (field === 'mark') this.opts.onSetGroupMark(group.id, input.value.trim() || null);
                else this.opts.onRenameGroup(group.id, input.value.trim() || null);
            }
            // A cancel must repaint even when the underlying model has not changed.
            this.legendSignature = '';
            input.remove();
            this.updateLegend(this.opts.legend());
            if (refocus) {
                const chip = [...this.legendEl.querySelectorAll<HTMLElement>('[data-group]')].find((el) => el.dataset.group === group.id);
                chip?.querySelector<HTMLElement>(`.vela-ls-group-${field}`)?.focus({ preventScroll: true });
            }
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter', true); }
        });
        input.addEventListener('blur', () => finish(true, false));
        button.replaceWith(input);
        input.focus();
        input.select();
    }

    private async share(): Promise<void> {
        const url = await this.opts.onShareLink();
        if (this.dead) return;
        this.message.hidden = false;
        this.message.textContent = url ? 'Workspace link copied.' : 'Could not copy the link. Check clipboard permission.';
        if (this.messageTimer) clearTimeout(this.messageTimer);
        this.messageTimer = setTimeout(() => { this.message.hidden = true; this.messageTimer = null; }, 2000);
    }

    override destroy(): void {
        this.dead = true;
        if (this.messageTimer) clearTimeout(this.messageTimer);
        this.matrix.destroy();
        this.infoTip.destroy();
        super.destroy();
    }
}
