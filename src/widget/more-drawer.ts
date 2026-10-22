// The three-dots drawer (mobile) — the catch-all for everything the hidden topbar and
// desktop bottombar used to carry: undo/redo/screenshot as an action row, then rows for
// chart type, the multi-chart layout (workspace shells), the side panels (data window,
// object tree, contributed), alerts, and every contributed topbar action. Chart type,
// layout and alerts open as IN-DRAWER sub-views with a back button — a drawer inside a
// drawer would stack sheets. Time zone lives on a long-press of the time axis (see
// `timezone-drawer.ts`), not here.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { layoutGridCanvas, paintLayoutGrid } from './layout-picker';
import { IMPLICIT_GROUP } from '../state/document';

const STYLE_ID = 'vela-widget-more-drawer';
const CSS = `
.vela-md-actions {
    display: flex;
    gap: 6px;
    padding: 2px 2px 10px;
    border-bottom: 1px solid var(--vela-border);
}
.vela-md-action {
    all: unset;
    flex: 1 1 0;
    min-height: 48px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 8px;
    font-size: 11px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-action:active { background: var(--vela-hover); }
.vela-md-action:disabled { opacity: 0.35; cursor: default; }
.vela-md-action .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-md-list { padding: 6px 0 4px; }
.vela-md-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-row:active { background: var(--vela-hover); }
.vela-md-row[data-checked='1'] { background: var(--vela-hover-strong); }
.vela-md-row .vela-icon { flex: none; font-size: 17px; width: 17px; height: 17px; color: var(--vela-fg-muted); }
.vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-row-value { flex: none; font-size: 13px; color: var(--vela-fg-muted); }
.vela-md-back {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
    border-bottom: 1px solid var(--vela-border);
    width: 100%;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}
/* The layout sub-view's grid canvas, centered and touch-sized (the base .vela-lp-grid
   squares are popover-sized for a mouse). */
.vela-md-gridwrap { display: flex; justify-content: center; padding: 14px 0 10px; }
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 44px); grid-auto-rows: 44px; gap: 8px; }
.vela-md-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-md-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
/* Layout sheet: glyph tiles, three across on a phone, larger where there is room. */
/* The uniform-grid canvas, phone-sized: 20px squares keep the 4×4 block compact so the
   asymmetric presets below it are one small scroll away, not a page. */
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 20px); grid-auto-rows: 20px; gap: 3px; }
.vela-md-gridwrap { padding: 4px 0 2px; }
.vela-md-presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
    padding: 2px 0 4px;
}
.vela-md-preset {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-height: 76px;
    padding: 10px 6px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 10px;
    background: var(--vela-panel);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-preset:active { background: var(--vela-hover); }
.vela-md-preset[data-checked='1'] {
    border-color: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 65%, transparent);
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 14%, transparent);
}
.vela-md-preset-glyph { display: block; width: 40px; height: 30px; color: var(--vela-fg-muted); }
.vela-md-preset[data-checked='1'] .vela-md-preset-glyph { color: var(--vela-fg-bright); }
.vela-md-preset-glyph svg { display: block; width: 100%; height: 100%; }
.vela-md-preset-label {
    font-size: 10.5px;
    line-height: 1.25;
    text-align: center;
    color: var(--vela-fg-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.vela-md-preset[data-checked='1'] .vela-md-preset-label { color: var(--vela-fg-bright); }
/* A sync row is a SWITCH, not a tinted list item: the track/thumb is the same language
   the desktop dropdown uses (.vela-lp-switch), sized for a thumb. */
.vela-md-sync {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-sync:active { background: var(--vela-hover); }
.vela-md-sync:focus-visible { outline: 2px solid var(--vela-focus, var(--vela-selected-bg)); outline-offset: -2px; }
.vela-md-sync .vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-switch {
    flex: none;
    position: relative;
    width: 40px;
    height: 24px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--vela-fg) 18%, transparent);
    transition: background 120ms ease;
}
.vela-md-switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 120ms ease, background 120ms ease;
}
.vela-md-sync[aria-checked='true'] .vela-md-switch { background: var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-sync[aria-checked='true'] .vela-md-switch::after { transform: translateX(16px); background: #fff; }
/* The group chip: the ACTIVE chart's mark for this link, and its own tap target. */
.vela-md-chip {
    all: unset;
    flex: none;
    box-sizing: border-box;
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--vela-border);
    border-radius: 15px;
    font-size: 14px;
    line-height: 1;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-chip:active { background: var(--vela-hover); }
.vela-md-chip[data-on='1'] {
    color: var(--vela-fg-bright);
    border-color: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 60%, transparent);
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 18%, transparent);
}
.vela-md-chip[data-implicit='1'] { border-style: dashed; }
.vela-md-hint { padding: 2px 2px 8px; font-size: 12px; line-height: 1.4; color: var(--vela-fg-muted); }
/* The marking MATRIX — one row per link, one chip per chart, so a phone can mark ANY
   chart for ANY link in a single tap (the desktop has the room for the per-row chip;
   a phone does not, so the whole grid is the chip). */
.vela-md-matrix {
    display: grid;
    grid-template-columns: minmax(56px, 1fr) repeat(var(--vela-md-matrix-cols, 5), minmax(26px, 34px));
    gap: 4px 2px;
    align-items: center;
    padding: 2px 0 6px;
}
.vela-md-matrix-head {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--vela-fg-muted);
    text-align: center;
    padding-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-md-matrix-head[data-active='1'] { color: var(--vela-fg-bright); }
.vela-md-matrix-label { font-size: 12px; color: var(--vela-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ── Layout setup: the hero card + the sticky two-stop nav ─────────────────────── */
.vela-md-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 2px 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--vela-border);
    border-radius: 12px;
    background: var(--vela-surface-elev);
}
.vela-md-hero-glyph { flex: none; width: 34px; height: 26px; color: var(--vela-fg-bright); }
.vela-md-hero-glyph svg { display: block; width: 100%; height: 100%; }
.vela-md-hero-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vela-md-hero-text b { font-size: 14px; font-weight: 600; color: var(--vela-fg-bright); }
.vela-md-hero-text small { font-size: 11.5px; color: var(--vela-fg-muted); }
.vela-md-nav {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    gap: 4px;
    margin: 0 0 6px;
    padding: 6px 0;
    background: var(--vela-surface-elev);
    border-bottom: 1px solid var(--vela-border);
}
.vela-md-navback {
    all: unset;
    flex: none;
    width: 40px;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navback:active { background: var(--vela-hover); }
.vela-md-navback .vela-icon { font-size: 16px; width: 16px; height: 16px; }
.vela-md-navbtn {
    all: unset;
    flex: 1 1 0;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-navbtn[data-active] {
    background: color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 22%, transparent);
    color: var(--vela-fg-bright);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-accent, var(--vela-selected-bg)) 55%, transparent);
}
.vela-md-sec { display: block; scroll-margin-top: 48px; }
/* A plain action row (no switch): same rhythm, the value as a pill. */
.vela-md-sync.vela-md-plain .vela-md-pill {
    flex: none;
    padding: 3px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
}
/* The ALL column: the one-tap \"every chart in one group\" reset. */
.vela-md-matrix-all { color: var(--vela-fg); font-weight: 700; }
.vela-md-chip-all[data-on='1'] { border-style: solid; }
/* Save-as field (TV's \"Save layout as…\"). */
.vela-md-saved { gap: 6px; }
.vela-md-saved-open, .vela-md-saved-del {
    all: unset;
    flex: none;
    height: 32px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid var(--vela-border);
    font-size: 12px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-saved-open:active, .vela-md-saved-del:active { background: var(--vela-hover); }
.vela-md-saved-del { padding: 0 8px; width: 34px; }
.vela-md-saved-del .vela-icon { font-size: 15px; width: 15px; height: 15px; color: var(--vela-fg-muted); }
.vela-md-saveas { display: flex; gap: 8px; padding: 4px 0 8px; }
.vela-md-saveas input {
    flex: 1 1 auto;
    min-width: 0;
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    background: var(--vela-bg, transparent);
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-family: inherit;
}
.vela-md-saveas input::placeholder { color: var(--vela-fg-faint, var(--vela-fg-muted)); }
.vela-md-saveas button {
    all: unset;
    flex: none;
    padding: 0 14px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    background: var(--vela-accent, var(--vela-selected-bg));
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.vela-md-saveas button:disabled { opacity: 0.4; }
`;

/** Paint a group chip: its mark, lit when it is in a group, dashed while it is the
 *  IMPLICIT all-cells group (every chart follows, so the mark is 'A' rather than an
 *  emoji the user picked), and an em-dash when the chart does not follow the link. */
function syncChipState(chip: HTMLElement, mark: string | undefined): void {
    const text = mark ?? '–';
    if (chip.textContent !== text) chip.textContent = text;
    if (mark) chip.dataset.on = '1';
    else delete chip.dataset.on;
    if (mark === IMPLICIT_GROUP) chip.dataset.implicit = '1';
    else delete chip.dataset.implicit;
}

export interface MoreDrawerAction {
    label: string;
    icon?: string;
    run: () => void;
}

export interface MoreDrawerOptions {
    host: HTMLElement;
    /** Omitted (with onRedo) ⇒ no undo/redo action buttons — the shell's topbar
     *  composition removed `'undo-redo'`; the keyboard chords are the shell's call. */
    onUndo?: () => void;
    onRedo?: () => void;
    /** Omitted ⇒ no screenshot action button (composition removed `'screenshot'`). */
    onScreenshot?: () => void;
    /** Bar replay entry — opens the shell's replay menu. Omitted (with the composition's
     *  `'replay'` removed, or a shell without replay) ⇒ no Replay action button. */
    onReplay?: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Chart style list + current selection (read live at open). */
    priceStyles: () => Array<{ id: string; label: string; icon?: string }>;
    priceStyle: () => string;
    onPriceStyle: (id: string) => void;
    /** Docked side panels (built-in + contributed), toggled by id. */
    panels: () => Array<{ id: string; title: string; icon: string }>;
    onTogglePanel: (id: string) => void;
    /** Omitted ⇒ no Alerts row (composition removed `'alerts'`). */
    alerts?: () => Array<{ title: string; message: string; time: number }>;
    /** Contributed topbar actions, projected as plain rows at the end of the list. */
    actions: () => MoreDrawerAction[];
    /** Contributed PRIMARY actions (left cluster, menu-placed) — rows right after Layout. */
    primaryActions?: () => MoreDrawerAction[];
    /** Multi-chart layout switching (workspace shells) — the row is hidden when omitted.
     *  The sub-view carries the SAME surface as the desktop layout dropdown: the 4×4
     *  tap-to-apply grid canvas, the presets the canvas cannot express as rows, and the
     *  sync switches. Everything is read live at open. */
    layout?: {
        /** Current layout's canvas shape (null = a preset the canvas cannot express). */
        shape: () => { rows: number; cols: number } | null;
        /** Registered layouts NOT expressible on the canvas — rendered as glyph tiles,
         *  grouped by chart count. `icon` is 16px SVG markup; `cells` is the count. */
        presets: () => Array<{ id: string; label: string; checked: boolean; icon?: string; cells?: number }>;
        onSelectGrid: (rows: number, cols: number) => void;
        onSelectPreset: (id: string) => void;
        /** One entry per link. `marks` is the DISPLAY truth — every chart that follows
         *  the link, keyed by cell id (the all-cells form reports the implicit group on
         *  every chart). */
        syncs?: () => Array<{ id: string; label: string; checked: boolean; group?: string; marks?: Record<string, string> }>;
        onToggleSync?: (id: string) => void;
        /** Cycle the ACTIVE cell through a link's groups (the row's chip). */
        onCycleGroup?: (id: string) => void;
        /** The charts the marking matrix lists, in slot order. Omitted ⇒ no matrix. */
        charts?: () => Array<{ id: string; label: string; active: boolean }>;
        /** Cycle ONE chart through a link's groups (a matrix tap) — no active-cell detour. */
        onCycleCellGroup?: (id: string, cellId: string) => void;
        /** Put EVERY chart in one group for this link (the matrix's ALL chip). */
        onAllInOneGroup?: (id: string) => void;
        /** "Apply settings to all charts" (TV's Chart Settings → Apply to all). */
        onApplySettingsToAll?: () => void;
        /** "Apply indicators to all charts" (TV's Apply these indicators to entire layout). */
        onApplyIndicatorsToAll?: () => void;
        drawingsScope?: () => 'layout' | 'global';
        onToggleDrawingsScope?: () => void;
        hiddenCharts?: () => number;
        onClearPooled?: () => void;
        savedLayouts?: () => Array<{ name: string; active: boolean }>;
        onSaveLayout?: (name: string) => void;
        onOpenLayout?: (name: string) => void;
        onDeleteLayout?: (name: string) => void;
        linkGroup?: () => string | null;
        onLinkGroup?: (tag: string | null) => void;
        /** The current layout's 16px glyph (`<svg>` markup) for the Layout row. Omitted
         *  ⇒ the registered `'layout'` icon. */
        glyph?: () => string;
    };
    onOpenChange?: (open: boolean) => void;
}

type MoreView = 'main' | 'style' | 'layout' | 'alerts';

export class MoreDrawer {
    private readonly drawer: Drawer;
    private view: MoreView = 'main';
    /** Scroll the layout sheet to its sync block on the next paint. */
    private focus: 'sync' | undefined;

    constructor(private readonly opts: MoreDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
    }

    /** Show the sheet. `focus: 'sync'` opens the layout sheet scrolled to its sync
     *  block (the status line's marks land there) — one surface, TV's Layout setup, not
     *  a second tab. */
    open(view: MoreView = 'main', opts: { focus?: 'sync' } = {}): void {
        this.view = view;
        this.focus = opts.focus;
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private show(view: MoreView): void {
        this.view = view;
        this.focus = undefined;
        this.render();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();

        // The layout sheet carries its own back button INSIDE its sticky nav (a header
        // that scrolls away leaves the sheet looking like a dead end).
        if (this.view !== 'main' && this.view !== 'layout') {
            const back = doc.createElement('button');
            back.className = 'vela-md-back';
            back.appendChild(iconEl('chevron-left', doc));
            const backLabel = this.view === 'style' ? 'Chart type' : 'Alerts';
            back.appendChild(doc.createTextNode(backLabel));
            back.addEventListener('click', () => this.show('main'));
            this.drawer.body.appendChild(back);
        }

        if (this.view === 'main') this.renderMain(doc);
        else if (this.view === 'style') this.renderStyle(doc);
        else if (this.view === 'layout') this.renderLayout(doc, this.focus);
        else this.renderAlerts(doc);
        this.focus = undefined;
    }

    private row(doc: Document, label: string, opts: { icon?: string; glyph?: string; value?: string; chevron?: boolean; checked?: boolean; onClick: () => void }): HTMLElement {
        const el = doc.createElement('div');
        el.className = 'vela-md-row';
        if (opts.icon) {
            const icon = iconEl(opts.icon, doc);
            if (opts.glyph) icon.innerHTML = opts.glyph;
            el.appendChild(icon);
        }
        const text = doc.createElement('span');
        text.className = 'vela-md-row-label';
        text.textContent = label;
        el.appendChild(text);
        if (opts.value) {
            const value = doc.createElement('span');
            value.className = 'vela-md-row-value';
            value.textContent = opts.value;
            el.appendChild(value);
        }
        if (opts.checked) el.dataset.checked = '1';
        if (opts.chevron) el.appendChild(iconEl('chevron-right', doc));
        el.addEventListener('click', opts.onClick);
        return el;
    }

    private renderMain(doc: Document): void {
        const actions = doc.createElement('div');
        actions.className = 'vela-md-actions';
        const action = (icon: string, label: string, enabled: boolean, run: () => void): void => {
            const b = doc.createElement('button');
            b.className = 'vela-md-action';
            b.disabled = !enabled;
            b.appendChild(iconEl(icon, doc));
            b.appendChild(doc.createTextNode(label));
            b.addEventListener('click', () => {
                run();
                this.drawer.hide();
            });
            actions.appendChild(b);
        };
        if (this.opts.onUndo) action('undo', 'Undo', this.opts.canUndo(), this.opts.onUndo);
        if (this.opts.onRedo) action('redo', 'Redo', this.opts.canRedo(), this.opts.onRedo);
        if (this.opts.onScreenshot) action('camera', 'Screenshot', true, this.opts.onScreenshot);
        if (this.opts.onReplay) action('replay', 'Replay', true, this.opts.onReplay);
        if (actions.childElementCount > 0) this.drawer.body.appendChild(actions);

        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        const current = this.opts.priceStyles().find((s) => s.id === this.opts.priceStyle());
        list.appendChild(this.row(doc, 'Chart type', { icon: 'style-line', value: current?.label, chevron: true, onClick: () => this.show('style') }));
        if (this.opts.layout) {
            const shape = this.opts.layout.shape();
            const value = shape ? `${shape.cols} × ${shape.rows}` : this.opts.layout.presets().find((p) => p.checked)?.label;
            list.appendChild(this.row(doc, 'Layout', { icon: 'layout', glyph: this.opts.layout.glyph?.(), value, chevron: true, onClick: () => this.show('layout') }));
            // TV keeps sync INSIDE the layout menu; a phone cannot show its two columns,
            // so the same sheet is one scroll. This second row is a shortcut that opens
            // that sheet already at its sync block — not a second screen.
            const links = this.opts.layout.syncs?.() ?? [];
            if (links.length > 0) {
                const on = links.filter((l) => l.checked).length;
                list.appendChild(
                    this.row(doc, 'Sync in layout', {
                        icon: 'group',
                        value: on > 0 ? `${on}/${links.length}` : 'off',
                        chevron: true,
                        onClick: () => {
                            this.view = 'layout';
                            this.focus = 'sync';
                            this.render();
                        },
                    }),
                );
            }
        }
        for (const act of this.opts.primaryActions?.() ?? []) list.appendChild(this.actionRow(doc, act));
        for (const panel of this.opts.panels()) {
            list.appendChild(
                this.row(doc, panel.title, {
                    icon: panel.icon,
                    onClick: () => {
                        this.opts.onTogglePanel(panel.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        if (this.opts.alerts) {
            const alertCount = this.opts.alerts().length;
            list.appendChild(this.row(doc, 'Alerts', { icon: 'bell', value: alertCount > 0 ? String(alertCount) : undefined, chevron: true, onClick: () => this.show('alerts') }));
        }
        for (const act of this.opts.actions()) list.appendChild(this.actionRow(doc, act));
        this.drawer.body.appendChild(list);
    }

    /** A contributed action's row: runs it and closes the drawer. */
    private actionRow(doc: Document, act: MoreDrawerAction): HTMLElement {
        return this.row(doc, act.label, {
            icon: act.icon,
            onClick: () => {
                act.run();
                this.drawer.hide();
            },
        });
    }

    private renderStyle(doc: Document): void {
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        const current = this.opts.priceStyle();
        for (const style of this.opts.priceStyles()) {
            list.appendChild(
                this.row(doc, style.label, {
                    icon: style.icon,
                    checked: style.id === current,
                    onClick: () => {
                        this.opts.onPriceStyle(style.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        this.drawer.body.appendChild(list);
    }

    /**
     * TradingView's LAYOUT SETUP, as one sheet. The desktop app splits it into a wide
     * popover with a layouts column and a sync column; a phone has one column, so the
     * same surface becomes one scroll with a sticky two-stop nav (Layouts · Sync) — the
     * pairing TV keeps is intact, and nothing is hidden behind a second tab. (TV's own
     * guide for the menu: pick a layout, then "scroll down to Sync in Layout".)
     *
     *   • the grid canvas + the asymmetric presets, grouped by chart count;
     *   • "Sync in layout": seven real switches (role=switch + aria-checked + a thumb —
     *     the rows here used to be inert divs whose only ON cue was a background tint),
     *     each with the ACTIVE chart's group chip beside it;
     *   • "Chart syncing": the per-chart emoji matrix — any chart into any group in one
     *     tap, plus an ALL chip per link that drops the whole grid back into one group;
     *   • the layout actions TV puts in the same menu (apply settings / indicators to
     *     every chart, drawing scope, dormant charts);
     *   • saved layouts, with TV's "Save layout as…" field.
     *
     * Switch and chip taps repaint in place (values, aria-checked, marks) — the sheet is
     * never rebuilt under the finger, so the list does not jump to the top mid-edit.
     */
    private renderLayout(doc: Document, focus?: 'sync'): void {
        const layout = this.opts.layout;
        if (!layout) return;
        type LayoutOpts = NonNullable<MoreDrawerOptions['layout']>;
        type SyncRowData = NonNullable<LayoutOpts['syncs']> extends () => Array<infer T> ? T : never;
        // Narrowed once, outside the closures: TS drops captured narrowing inside a
        // nested function, and every chip handler re-reads the live state.
        const syncsOf: (() => SyncRowData[]) | null = layout.syncs ?? null;

        const list = doc.createElement('div');
        list.className = 'vela-md-list';

        // ── the summary card: what this layout IS, at a glance ─────────────────
        const shape = layout.shape();
        const charts = layout.charts?.() ?? [];
        const on = (syncsOf?.() ?? []).filter((s) => s.checked).length;
        const hero = doc.createElement('div');
        hero.className = 'vela-md-hero';
        const heroGlyph = doc.createElement('span');
        heroGlyph.className = 'vela-md-hero-glyph';
        if (layout.glyph) heroGlyph.innerHTML = layout.glyph();
        const heroText = doc.createElement('span');
        heroText.className = 'vela-md-hero-text';
        const heroTitle = doc.createElement('b');
        heroTitle.textContent = shape ? `${shape.cols} × ${shape.rows} grid` : (layout.presets().find((p) => p.checked)?.label ?? 'Layout');
        const heroSub = doc.createElement('small');
        heroSub.textContent = `${charts.length || '?'} chart${charts.length === 1 ? '' : 's'} · ${on} link${on === 1 ? '' : 's'} on`;
        heroText.append(heroTitle, heroSub);
        hero.append(heroGlyph, heroText);
        list.append(hero);

        // ── sticky nav ─────────────────────────────────────────────────────────
        const nav = doc.createElement('div');
        nav.className = 'vela-md-nav';
        const navButtons: HTMLElement[] = [];
        const navBack = doc.createElement('button');
        navBack.type = 'button';
        navBack.className = 'vela-md-navback';
        navBack.setAttribute('aria-label', 'Back to menu');
        navBack.appendChild(iconEl('chevron-left', doc));
        navBack.addEventListener('click', () => this.show('main'));
        nav.append(navBack);
        const goTo = (key: 'layouts' | 'sync'): void => {
            for (const b of navButtons) b.toggleAttribute('data-active', b.dataset.tab === key);
            const target = key === 'layouts' ? layoutsSec : syncSec;
            // jsdom has no scrollIntoView — the sheet still renders, it just stays put.
            try {
                target.scrollIntoView?.({ block: 'start' });
            } catch {
                /* no scroller in this environment */
            }
        };
        for (const [key, label] of [['layouts', 'Layouts'], ['sync', 'Sync']] as const) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-md-navbtn';
            b.dataset.tab = key;
            b.textContent = label;
            b.addEventListener('click', () => goTo(key));
            nav.append(b);
            navButtons.push(b);
        }
        list.append(nav);

        // ── layouts ────────────────────────────────────────────────────────────
        const layoutsSec = doc.createElement('section');
        layoutsSec.className = 'vela-md-sec';

        const caption = doc.createElement('div');
        caption.className = 'vela-md-section';
        caption.textContent = 'Custom grid';
        layoutsSec.append(caption);
        const wrap = doc.createElement('div');
        wrap.className = 'vela-md-gridwrap';
        const { el: grid, squares } = layoutGridCanvas(doc);
        paintLayoutGrid(squares, layout.shape());
        grid.addEventListener('click', (e) => {
            const sq = (e.target as Element | null)?.closest?.('.vela-lp-sq');
            if (!(sq instanceof HTMLButtonElement)) return;
            layout.onSelectGrid(Number(sq.dataset.r) + 1, Number(sq.dataset.c) + 1);
            this.drawer.hide();
        });
        wrap.append(grid);
        layoutsSec.append(wrap);

        // The layouts TradingView calls "asymmetric" are the interesting ones — each gets
        // a GLYPH TILE (the same mini-diagram the desktop dropdown draws) grouped by
        // chart count, so a phone shows the shape instead of a wall of text rows.
        const presets = layout.presets();
        const byCount = new Map<number, typeof presets>();
        for (const preset of presets) {
            const n = preset.cells ?? 0;
            const bucket = byCount.get(n);
            if (bucket) bucket.push(preset);
            else byCount.set(n, [preset]);
        }
        for (const n of [...byCount.keys()].sort((a, b) => a - b)) {
            const group = byCount.get(n)!;
            const heading = doc.createElement('div');
            heading.className = 'vela-md-section';
            heading.textContent = n > 0 ? `${n} chart${n === 1 ? '' : 's'}` : 'Layouts';
            layoutsSec.append(heading);
            const tiles = doc.createElement('div');
            tiles.className = 'vela-md-presets';
            for (const preset of group) {
                const tile = doc.createElement('button');
                tile.type = 'button';
                tile.className = 'vela-md-preset';
                tile.setAttribute('role', 'option');
                tile.setAttribute('aria-selected', String(preset.checked));
                tile.setAttribute('aria-label', preset.label);
                tile.title = preset.label;
                if (preset.checked) tile.dataset.checked = '1';
                const glyph = doc.createElement('span');
                glyph.className = 'vela-md-preset-glyph';
                if (preset.icon) glyph.innerHTML = preset.icon;
                const label = doc.createElement('span');
                label.className = 'vela-md-preset-label';
                label.textContent = preset.label;
                tile.append(glyph, label);
                tile.addEventListener('click', () => {
                    layout.onSelectPreset(preset.id);
                    this.drawer.hide();
                });
                tiles.append(tile);
            }
            layoutsSec.append(tiles);
        }
        list.append(layoutsSec);

        // ── sync ───────────────────────────────────────────────────────────────
        const syncSec = doc.createElement('section');
        syncSec.className = 'vela-md-sec';

        type SwitchRow = { id: string; el: HTMLElement; chip: HTMLButtonElement | null };
        const switchRows: SwitchRow[] = [];
        const matrixChips = new Map<string, HTMLButtonElement>();

        if (syncsOf) {
            const head = doc.createElement('div');
            head.className = 'vela-md-section';
            head.textContent = 'Sync in layout';
            syncSec.append(head);

            for (const s of syncsOf()) {
                const row = doc.createElement('button');
                row.type = 'button';
                row.className = 'vela-md-sync';
                row.setAttribute('role', 'switch');
                row.setAttribute('aria-checked', String(s.checked));
                row.setAttribute('aria-label', `${s.label} sync`);
                const label = doc.createElement('span');
                label.className = 'vela-md-row-label';
                label.textContent = s.label;
                row.append(label);
                // The chip: the ACTIVE chart's mark for this link. Its own tap target, and
                // it never flips the switch (stopPropagation).
                let chip: HTMLButtonElement | null = null;
                if (layout.onCycleGroup) {
                    chip = doc.createElement('button');
                    chip.type = 'button';
                    chip.className = 'vela-md-chip';
                    chip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        layout.onCycleGroup?.(s.id);
                        refresh();
                    });
                    row.append(chip);
                }
                const track = doc.createElement('span');
                track.className = 'vela-md-switch';
                track.setAttribute('aria-hidden', 'true');
                row.append(track);
                row.addEventListener('click', () => {
                    layout.onToggleSync?.(s.id);
                    refresh();
                });
                syncSec.append(row);
                switchRows.push({ id: s.id, el: row, chip });
            }

            if (layout.drawingsScope) {
                const scopeRow = doc.createElement('button');
                scopeRow.type = 'button';
                scopeRow.className = 'vela-md-sync vela-md-plain';
                const scopeLabel = doc.createElement('span');
                scopeLabel.className = 'vela-md-row-label';
                scopeLabel.textContent = 'Drawing scope';
                const scopeValue = doc.createElement('span');
                scopeValue.className = 'vela-md-pill';
                scopeRow.append(scopeLabel, scopeValue);
                scopeRow.addEventListener('click', () => {
                    layout.onToggleDrawingsScope?.();
                    scopeValue.textContent = layout.drawingsScope?.() ?? 'layout';
                });
                scopeValue.textContent = layout.drawingsScope() ?? 'layout';
                syncSec.append(scopeRow);
            }

            // ── chart syncing (the emoji matrix) ────────────────────────────────
            if (charts.length > 1 && layout.onCycleCellGroup) {
                const heading = doc.createElement('div');
                heading.className = 'vela-md-section';
                heading.textContent = 'Chart syncing';
                syncSec.append(heading);
                const hint = doc.createElement('div');
                hint.className = 'vela-md-hint';
                hint.textContent = 'Tap a chart’s emoji to pick the group it follows — charts wearing the same emoji follow each other. ALL drops the link back into one group.';
                syncSec.append(hint);

                const gridEl = doc.createElement('div');
                gridEl.className = 'vela-md-matrix';
                gridEl.style.setProperty('--vela-md-charts', String(charts.length));
                gridEl.style.setProperty('--vela-md-matrix-cols', String(charts.length + 1)); // + ALL
                gridEl.append(doc.createElement('span')); // empty corner
                for (const c of charts) {
                    const head2 = doc.createElement('span');
                    head2.className = 'vela-md-matrix-head';
                    head2.textContent = c.label;
                    head2.title = c.active ? `${c.label} (active)` : c.label;
                    if (c.active) head2.dataset.active = '1';
                    gridEl.append(head2);
                }
                const allHead = doc.createElement('span');
                allHead.className = 'vela-md-matrix-head vela-md-matrix-all';
                allHead.textContent = 'ALL';
                gridEl.append(allHead);

                for (const s of syncsOf()) {
                    const label = doc.createElement('span');
                    label.className = 'vela-md-matrix-label';
                    label.textContent = s.label;
                    gridEl.append(label);
                    for (const c of charts) {
                        const cell = doc.createElement('button');
                        cell.type = 'button';
                        cell.className = 'vela-md-chip';
                        cell.dataset.kind = s.id;
                        cell.dataset.cell = c.id;
                        cell.addEventListener('click', () => {
                            layout.onCycleCellGroup?.(s.id, c.id);
                            refresh();
                        });
                        gridEl.append(cell);
                        matrixChips.set(`${s.id}\u0000${c.id}`, cell);
                    }
                    // ALL: one group for every chart (TV's all-cells form) — the fast way
                    // out of a split grid.
                    const all = doc.createElement('button');
                    all.type = 'button';
                    all.className = 'vela-md-chip vela-md-chip-all';
                    all.dataset.kind = s.id;
                    all.dataset.all = '1';
                    all.addEventListener('click', () => {
                        layout.onAllInOneGroup?.(s.id);
                        refresh();
                    });
                    gridEl.append(all);
                    matrixChips.set(`${s.id}\u0000all`, all);
                }
                syncSec.append(gridEl);
            }

            // ── the layout-wide actions TV keeps in the same menu ──────────────
            if (layout.onApplySettingsToAll || layout.onApplyIndicatorsToAll) {
                const heading = doc.createElement('div');
                heading.className = 'vela-md-section';
                heading.textContent = 'This layout';
                syncSec.append(heading);
            }
            if (layout.onApplySettingsToAll) {
                syncSec.append(
                    this.row(doc, 'Apply settings to all charts', {
                        icon: 'style-line',
                        onClick: () => {
                            layout.onApplySettingsToAll?.();
                            this.drawer.hide();
                        },
                    }),
                );
            }
            if (layout.onApplyIndicatorsToAll) {
                syncSec.append(
                    this.row(doc, 'Apply indicators to all charts', {
                        icon: 'indicators',
                        onClick: () => {
                            layout.onApplyIndicatorsToAll?.();
                            this.drawer.hide();
                        },
                    }),
                );
            }
            const hidden = layout.hiddenCharts?.() ?? 0;
            if (hidden > 0 && layout.onClearPooled) {
                syncSec.append(
                    this.row(doc, 'Hidden charts', {
                        value: `remove ${hidden}`,
                        onClick: () => {
                            layout.onClearPooled?.();
                            this.render();
                        },
                    }),
                );
            }
        }
        list.append(syncSec);

        this.renderSavedLayouts(doc, list, layout);
        this.drawer.body.append(list);

        // Re-read the live state and repaint the nodes that already exist.
        const refresh = (): void => {
            if (!syncsOf) return;
            const live = syncsOf();
            const activeId = charts.find((c) => c.active)?.id;
            const byId = new Map(live.map((l) => [l.id, l]));
            for (const r of switchRows) {
                const s = byId.get(r.id);
                if (!s) continue;
                r.el.setAttribute('aria-checked', String(s.checked));
                if (r.chip) syncChipState(r.chip, s.marks?.[activeId ?? '']);
                if (r.id === 'drawings') {
                    /* the scope pill is its own row */
                }
            }
            for (const [key, chip] of matrixChips) {
                const [kind, cellId] = key.split('\u0000');
                const s = byId.get(kind ?? '');
                const mark = cellId === 'all' ? (s?.checked ? IMPLICIT_GROUP : undefined) : s?.marks?.[cellId ?? ''];
                syncChipState(chip, mark);
                chip.setAttribute('aria-label', cellId === 'all'
                    ? `All charts into one ${s?.label ?? ''} group`
                    : `${s?.label ?? kind} — ${cellId}: ${mark ?? 'not linked'}`);
            }
            // The hero's link count follows the switches.
            const liveOn = live.filter((l) => l.checked).length;
            heroSub.textContent = `${charts.length || '?'} chart${charts.length === 1 ? '' : 's'} · ${liveOn} link${liveOn === 1 ? '' : 's'} on`;
        };
        refresh();
        // A plain open starts at the top (hero, grid, presets) with the nav reading
        // "Layouts"; only an explicit `focus` scrolls straight to the sync block.
        for (const b of navButtons) b.toggleAttribute('data-active', b.dataset.tab === (focus ?? 'layouts'));
        if (focus) {
            // The scroll runs after layout, once the sheet has its height.
            doc.defaultView?.requestAnimationFrame(() => goTo(focus));
        }
    }

    /** Saved snapshots: open on tap, plus a one-tap save (auto-named). */
    private renderSavedLayouts(
        doc: Document,
        list: HTMLElement,
        layout: NonNullable<MoreDrawerOptions['layout']>,
    ): void {
        if (!layout.savedLayouts) return;
        const rows = layout.savedLayouts();
        const heading = doc.createElement('div');
        heading.className = 'vela-md-section';
        heading.textContent = 'Saved layouts';
        list.appendChild(heading);
        for (const l of rows) {
            const rowEl = doc.createElement('div');
            rowEl.className = 'vela-md-row vela-md-saved';
            if (l.active) rowEl.dataset.checked = '1';
            const label = doc.createElement('span');
            label.className = 'vela-md-row-label';
            label.textContent = l.name;
            rowEl.append(label);
            const open = doc.createElement('button');
            open.type = 'button';
            open.className = 'vela-md-saved-open';
            open.textContent = 'Open';
            open.addEventListener('click', () => {
                layout.onOpenLayout?.(l.name);
                this.drawer.hide();
            });
            rowEl.append(open);
            if (layout.onDeleteLayout) {
                const del = doc.createElement('button');
                del.type = 'button';
                del.className = 'vela-md-saved-del';
                del.setAttribute('aria-label', `Delete layout ${l.name}`);
                del.appendChild(iconEl('trash', doc));
                del.addEventListener('click', () => {
                    layout.onDeleteLayout?.(l.name);
                    this.render();
                });
                rowEl.append(del);
            }
            list.appendChild(rowEl);
        }
        if (layout.onSaveLayout) {
            // TV's "Save layout as…": a name field, not a numbered default — the layout
            // list IS the name picker when you come back to it.
            const save = doc.createElement('div');
            save.className = 'vela-md-saveas';
            const input = doc.createElement('input');
            input.type = 'text';
            input.placeholder = `Save layout as… (Layout ${rows.length + 1})`;
            input.setAttribute('aria-label', 'Save layout as');
            const button = doc.createElement('button');
            button.type = 'button';
            button.textContent = 'Save';
            button.addEventListener('click', () => {
                const name = input.value.trim() || `Layout ${rows.length + 1}`;
                layout.onSaveLayout?.(name);
                this.render();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') button.click();
            });
            save.append(input, button);
            list.appendChild(save);
        }
    }

    private renderAlerts(doc: Document): void {
        const alerts = this.opts.alerts?.() ?? [];
        if (alerts.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-md-empty';
            empty.textContent = 'No alerts yet.';
            this.drawer.body.appendChild(empty);
            return;
        }
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        for (const a of alerts) {
            list.appendChild(this.row(doc, `${a.title}: ${a.message}`, { value: new Date(a.time).toLocaleTimeString(), onClick: () => undefined }));
        }
        this.drawer.body.appendChild(list);
    }
}
