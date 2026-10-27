// The LAYOUT MENU — the "manage layouts" panel TradingView opens from the layout NAME in
// its top toolbar, sitting here beside undo/redo.
//
// Research (TradingView's layout guide, and the community write-ups that photograph the
// menu) fixes its vocabulary: Save (Ctrl/Cmd+S), Autosave, Make a copy, Rename, Share
// (copy link), Export chart data, and Open layout — plus the name itself acting as the
// status display, because TV paints a "Save" sign under the name the moment the chart
// drifts from its snapshot. Two details from that reading matter more than the item list:
//
//   • the panel is a STATUS surface first and a menu second — the trader opens it to ask
//     "is my work saved?", so the answer is the heading, not a tooltip on a dot;
//   • Autosave is a switch INSIDE the panel, and while it is on the manual save stops
//     being the headline (TradingView's screener hides its Save button entirely in that
//     state; we keep the button and say what it will do instead of hiding a verb).
//
// Saving is a naming question the first time (an untitled document has nothing to
// overwrite), so Save / Save as / Make a copy / Rename all funnel through ONE small dialog
// with one field — the panel never grows a second page.
import { Dialog } from '../ui/components/dialog';
import { Popover } from '../ui/components/popover';
import { downloadText } from '../ui/download';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { floatingLayerHost } from '../ui/tokens';

export const LAYOUT_MENU_STYLE_ID = 'vela-layout-menu';

export const LAYOUT_MENU_CSS = `
.vela-lm {
    width: 316px;
    max-height: min(78vh, 620px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    box-sizing: border-box;
    color: var(--vela-fg);
    font-size: 13px;
    /* The kit's popover shell is a transparent positioner: the surface, its edge and its
       lift belong to the panel, or the chart reads straight through the menu. */
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border-strong);
    border-radius: 12px;
    box-shadow: var(--vela-shadow-dialog);
}
.vela-lm-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 6px; }
.vela-lm-mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent);
    font-size: 16px;
}
.vela-lm-id { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-lm-title {
    font-size: 14px;
    font-weight: 650;
    color: var(--vela-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-lm-title[data-untitled='1'] { color: var(--vela-fg-muted); font-weight: 550; font-style: italic; }
.vela-lm-meta {
    font-size: 11.5px;
    color: var(--vela-fg-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* The status line: the whole reason the panel exists sits under the name, where TV puts
   its blue "Save" sign. */
.vela-lm-state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 8px;
    min-height: 16px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
}
.vela-lm-state .vela-lm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vela-accent); flex: none; }
.vela-lm-state[data-dirty='1'] { color: var(--vela-accent); font-weight: 550; }
.vela-lm-state[data-tone='ok'] { color: var(--vela-up); }
.vela-lm-state .vela-icon { font-size: 12px; }

.vela-lm-primary {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.vela-lm-primary:hover { filter: brightness(1.07); }
.vela-lm-primary:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: 2px; }
.vela-lm-primary[disabled] { background: var(--vela-hover); color: var(--vela-fg-muted); cursor: default; filter: none; }
.vela-lm-primary .vela-lm-kbd {
    margin-left: auto;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.18);
}
.vela-lm-primary[disabled] .vela-lm-kbd { background: var(--vela-border); color: var(--vela-fg-faint); }
.vela-lm-primary .vela-icon { font-size: 14px; }

.vela-lm-rows { display: flex; flex-direction: column; padding: 2px 0; }
.vela-lm-row {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--vela-fg);
    cursor: pointer;
}
.vela-lm-row:hover, .vela-lm-row:focus-visible { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-lm-row:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-lm-row[disabled] { color: var(--vela-fg-faint); cursor: default; background: none; }
.vela-lm-row .vela-icon { font-size: 14px; color: var(--vela-fg-muted); flex: none; }
.vela-lm-row:hover .vela-icon { color: var(--vela-fg-bright); }
.vela-lm-row .vela-lm-kbd {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--vela-fg-faint);
    letter-spacing: 0.02em;
}
.vela-lm-sep { height: 1px; background: var(--vela-border); margin: 6px 6px; }
.vela-lm-sect {
    padding: 4px 8px 4px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
}
.vela-lm-filter {
    box-sizing: border-box;
    width: calc(100% - 12px);
    height: 30px;
    margin: 0 6px 4px;
    padding: 0 9px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 7px;
    background: var(--vela-surface);
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 12px;
}
.vela-lm-filter:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }

/* Autosave: a real switch row, with the sentence TV keeps in its settings behind it. */
.vela-lm-switch {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
}
.vela-lm-switch:hover { background: var(--vela-hover); }
.vela-lm-switch:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-lm-switch .vela-lm-swtext { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vela-lm-switch b { font-size: 13px; font-weight: 550; color: var(--vela-fg-bright); }
.vela-lm-switch small { font-size: 11.5px; color: var(--vela-fg-muted); }
.vela-lm-pill {
    flex: none;
    margin-left: auto;
    position: relative;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--vela-border-strong);
    transition: background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lm-pill::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--vela-fg-bright);
    transition: transform var(--vela-dur-fast) var(--vela-ease);
}
.vela-lm-switch[aria-checked='true'] .vela-lm-pill { background: var(--vela-accent); }
.vela-lm-switch[aria-checked='true'] .vela-lm-pill::after { transform: translateX(14px); background: var(--vela-fg-on-fill); }

/* Saved layouts: one row each, the open one carrying a check. */
.vela-lm-srow { display: flex; align-items: center; gap: 4px; border-radius: 7px; }
.vela-lm-srow[data-active='1'] { background: var(--vela-hover-strong); }
.vela-lm-srow:hover { background: var(--vela-hover); }
.vela-lm-srow[data-active='1']:hover { background: var(--vela-hover-strong); }
.vela-lm-smain {
    all: unset;
    box-sizing: border-box;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 4px 0 8px;
    cursor: pointer;
    border-radius: 7px;
}
.vela-lm-smain:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-lm-sname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-bright);
    font-weight: 550;
}
.vela-lm-srow[data-active='1'] .vela-lm-sname { font-weight: 650; }
.vela-lm-smeta { margin-left: auto; flex: none; font-size: 11px; color: var(--vela-fg-muted); font-variant-numeric: tabular-nums; }
.vela-lm-check { flex: none; font-size: 13px; color: var(--vela-accent); }
.vela-lm-srow .vela-lm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vela-accent); flex: none; }
.vela-lm-kebab {
    all: unset;
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-right: 2px;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-lm-kebab:hover, .vela-lm-kebab[data-open='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lm-kebab:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-lm-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 8px 8px 8px;
}
.vela-lm-act {
    all: unset;
    padding: 4px 9px;
    border-radius: 6px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-fg);
    font-size: 12px;
    cursor: pointer;
}
.vela-lm-act:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lm-act:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: 1px; }
.vela-lm-act[data-danger='1'] { color: var(--vela-danger); border-color: var(--vela-danger); }
.vela-lm-empty { padding: 2px 8px 8px; color: var(--vela-fg-muted); font-size: 12px; line-height: 1.45; }

/* The naming dialog: one field, one sentence of help, and the two verbs. */
.vela-lm-form { display: flex; flex-direction: column; gap: 8px; min-width: 300px; }
.vela-lm-form label { font-size: 12px; color: var(--vela-fg-muted); }
.vela-lm-input {
    box-sizing: border-box;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--vela-border-strong);
    background: var(--vela-surface-sunken);
    color: var(--vela-fg-bright);
    font-size: 13.5px;
    font-weight: 500;
    outline: none;
}
.vela-lm-input:focus { border-color: var(--vela-accent); box-shadow: 0 0 0 2px var(--vela-selected-bg); }
.vela-lm-err { min-height: 15px; font-size: 12px; color: var(--vela-danger); }
.vela-lm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.vela-lm-btn {
    all: unset;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg);
    font-size: 12.5px;
    font-weight: 550;
    cursor: pointer;
}
.vela-lm-btn:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-lm-btn:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: 1px; }
.vela-lm-btn[data-primary='1'] { background: var(--vela-accent); border-color: var(--vela-accent); color: var(--vela-fg-on-fill); }
.vela-lm-btn[data-primary='1']:hover { filter: brightness(1.07); background: var(--vela-accent); color: #fff; }
.vela-lm-btn[disabled] { opacity: 0.5; cursor: default; }
@media (prefers-reduced-motion: reduce) {
    .vela-lm-pill, .vela-lm-pill::after { transition: none; }
}
`;

/** One saved snapshot, as the panel lists it (the topbar's `layout.savedLayouts()`). */
export interface LayoutMenuRow {
    name: string;
    active: boolean;
    dirty?: boolean;
    charts?: number;
    indicators?: number;
    savedAt?: number | null;
}

/** The layout surface the top bar was handed — state read live, verbs acted on. */
export interface LayoutMenuModel {
    activeLayout?: () => string | null;
    savedLayouts?: () => LayoutMenuRow[];
    autosave?: () => boolean;
    onToggleAutosave?: (on: boolean) => void;
    onSaveChanges?: () => void;
    onSaveLayout?: (name: string) => void;
    onSaveLayoutWithThumb?: (name: string) => boolean;
    onDuplicateLayout?: (name: string) => string | null;
    onRenameLayout?: (from: string, to: string) => boolean;
    onOpenLayout?: (name: string) => void;
    onDeleteLayout?: (name: string) => void;
    onShareLayout?: (name: string) => Promise<string | null>;
    onExportLayout?: (name: string) => string | null;
    onExportData?: (scope: 'visible' | 'all', timeFormat: 'iso' | 'unix') => { rows: number; filename: string } | null;
    /** Restore a saved-layout JSON file — the grid setup panel no longer owns file verbs. */
    onImportLayout?: (json: string) => string | null;
    onCopyLink?: () => Promise<string | null>;
}

export interface LayoutMenuOptions {
    layout: LayoutMenuModel;
    /** Portal target for the panel (defaults to the trigger's UI host). */
    host?: HTMLElement;
    /** Called after every verb — the chip repaints from live state. */
    onChange?: () => void;
    /** The panel opened or closed (the chip mirrors it into aria-expanded). */
    onOpenChange?: (open: boolean) => void;
}

/** Relative "saved … ago" — TradingView never shows a clock here, it shows freshness. */
function ago(ms: number | null | undefined, now = Date.now()): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * The panel. One instance per top bar: it opens anchored to the name chip, renders from the
 * host's live state every time, and never keeps a copy of anything (a cached name is how a
 * save panel starts lying after a rename).
 */
export class LayoutMenu {
    private readonly opts: LayoutMenuOptions;
    private readonly doc: Document;
    /** The themed host both the panel and its dialog portal into (a `.vela-ui` element):
     *  token custom-properties are set on the widget root, so a dialog on <body> would
     *  paint without a surface at all. */
    private hostEl: HTMLElement | null = null;
    private popover: Popover | null = null;
    private panel: HTMLElement | null = null;
    private dialog: Dialog | null = null;
    private trigger: HTMLElement | null = null;
    /** Row whose kebab strip is unfolded (one at a time). */
    private openRow: string | null = null;
    /** Delete armed for this row (the sheet's two-tap convention). */
    private armedRow: string | null = null;
    /** A verb is in flight (the share link is async). */
    private busy = false;
    /** Inline feedback on the status line ("Link copied"), cleared on the next render. */
    private flash: { text: string; tone?: 'ok' } | null = null;

    constructor(opts: LayoutMenuOptions) {
        this.opts = opts;
        this.doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(LAYOUT_MENU_STYLE_ID, LAYOUT_MENU_CSS, this.doc);
    }

    get isOpen(): boolean {
        return this.popover?.open === true;
    }

    /** Open anchored under the chip (or toggle it shut). */
    open(trigger: HTMLElement): void {
        if (this.popover?.open) {
            this.popover.hide();
            return;
        }
        this.trigger = trigger;
        this.hostEl = this.opts.host ?? floatingLayerHost(trigger, this.doc.body);
        this.flash = null;
        this.openRow = null;
        this.armedRow = null;
        const popover = new Popover({
            trigger,
            className: 'vela-lm-pop',
            host: this.hostEl,
            gap: 6,
            align: 'start',
            content: (body) => {
                this.panel = body;
                body.setAttribute('role', 'dialog');
                body.setAttribute('aria-label', 'Layout');
                this.render();
            },
            onClose: () => {
                this.popover = null;
                this.panel = null;
                this.openRow = null;
                this.armedRow = null;
                this.opts.onOpenChange?.(false);
                this.trigger?.focus({ preventScroll: true });
            },
        });
        this.popover = popover;
        popover.show();
        this.opts.onOpenChange?.(true);
        // Focus the panel's first control: a keyboard user who opened this expects the
        // save verb under their hands, not another Tab from the chip.
        setTimeout(() => {
            if (!this.panel) return;
            const first = this.panel.querySelector<HTMLElement>('.vela-lm-primary:not([disabled]), .vela-lm-row:not([disabled])');
            first?.focus({ preventScroll: true });
        }, 0);
    }

    close(): void {
        this.popover?.hide();
    }

    /** Repaint from live state (a save/open/rename elsewhere, or a dirty flip). */
    refresh(): void {
        if (this.popover?.open) this.render();
    }

    destroy(): void {
        this.dialog?.destroy();
        this.dialog = null;
        this.popover?.destroy();
        this.popover = null;
        this.panel = null;
    }

    // ── rendering ───────────────────────────────────────────────────────────────

    private state(): { name: string | null; rows: LayoutMenuRow[]; dirty: boolean; autosave: boolean; active: LayoutMenuRow | null } {
        const l = this.opts.layout;
        const rows = l.savedLayouts?.() ?? [];
        const name = l.activeLayout?.() ?? null;
        const active = rows.find((r) => r.active) ?? null;
        return { name, rows, dirty: active?.dirty === true, autosave: l.autosave?.() === true, active };
    }

    private render(): void {
        const panel = this.panel;
        if (!panel) return;
        const { name, rows, dirty, autosave, active } = this.state();

        const card = this.doc.createElement('div');
        card.className = 'vela-lm';

        // ── head: what this is, and how big it is ──
        const head = this.doc.createElement('div');
        head.className = 'vela-lm-head';
        const mark = this.doc.createElement('span');
        mark.className = 'vela-lm-mark';
        mark.appendChild(iconEl('layout', this.doc));
        const id = this.doc.createElement('div');
        id.className = 'vela-lm-id';
        id.setAttribute('data-kicker', 'Workspace'); // R87 premium eyebrow (see ui/premium.ts)
        const title = this.doc.createElement('b');
        title.className = 'vela-lm-title';
        title.textContent = name ?? 'Untitled layout';
        if (!name) title.dataset.untitled = '1';
        title.title = name ?? 'Untitled layout';
        const meta = this.doc.createElement('span');
        meta.className = 'vela-lm-meta';
        if (active) {
            const parts = [`${active.charts ?? 1} ${(active.charts ?? 1) === 1 ? 'chart' : 'charts'}`];
            parts.push(`${active.indicators ?? 0} ind`);
            const when = ago(active.savedAt);
            if (when) parts.push(`saved ${when}`);
            meta.textContent = parts.join(' · ');
        } else {
            meta.textContent = 'Not saved yet — name it to keep this workspace';
        }
        id.append(title, meta);
        head.append(mark, id);
        card.appendChild(head);

        // ── the status line — the panel's first answer ──
        const state = this.doc.createElement('div');
        state.className = 'vela-lm-state';
        if (this.flash) {
            state.dataset.tone = this.flash.tone ?? '';
            state.appendChild(iconEl(this.flash.tone === 'ok' ? 'check' : 'info', this.doc));
            state.appendChild(this.doc.createTextNode(this.flash.text));
        } else if (dirty && autosave) {
            state.appendChild(iconEl('clock', this.doc));
            state.appendChild(this.doc.createTextNode('Autosave is writing this change…'));
        } else if (dirty) {
            const dot = this.doc.createElement('span');
            dot.className = 'vela-lm-dot';
            state.dataset.dirty = '1';
            state.append(dot, this.doc.createTextNode('Unsaved changes'));
        } else if (autosave) {
            state.appendChild(iconEl('check', this.doc));
            state.appendChild(this.doc.createTextNode('Autosave is on — every change is written'));
        } else {
            state.appendChild(iconEl('check', this.doc));
            state.appendChild(this.doc.createTextNode(name ? 'All changes saved' : 'Nothing to save yet'));
        }
        card.appendChild(state);

        // ── primary verb ──
        const canSaveInPlace = !!name && !!this.opts.layout.onSaveChanges;
        const primary = this.doc.createElement('button');
        primary.type = 'button';
        primary.className = 'vela-lm-primary';
        primary.appendChild(iconEl('save', this.doc));
        primary.appendChild(this.doc.createTextNode(name ? 'Save layout' : 'Name and save…'));
        const kbd = this.doc.createElement('span');
        kbd.className = 'vela-lm-kbd';
        kbd.textContent = 'Ctrl S';
        primary.appendChild(kbd);
        primary.disabled = this.busy || (canSaveInPlace && !dirty);
        primary.title = primary.disabled && canSaveInPlace ? 'Nothing to save — the layout matches the chart' : 'Save this layout';
        primary.addEventListener('click', () => {
            if (canSaveInPlace) {
                this.run(() => this.opts.layout.onSaveChanges?.());
                this.close();
                return;
            }
            this.askName('Save layout', 'Name this layout', 'Untitled layout', (value) => {
                this.run(() => {
                    if (this.opts.layout.onSaveLayoutWithThumb) this.opts.layout.onSaveLayoutWithThumb(value);
                    else this.opts.layout.onSaveLayout?.(value);
                });
            });
        });
        card.appendChild(primary);

        const actions = this.doc.createElement('div');
        actions.className = 'vela-lm-rows';
        const row = (icon: string, label: string, hint: string, run: () => void, disabled = false): HTMLButtonElement => {
            const b = this.doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-lm-row';
            b.appendChild(iconEl(icon, this.doc));
            b.appendChild(this.doc.createTextNode(label));
            if (hint) {
                const k = this.doc.createElement('span');
                k.className = 'vela-lm-kbd';
                k.textContent = hint;
                b.appendChild(k);
            }
            if (disabled) b.disabled = true;
            else b.addEventListener('click', run);
            return b;
        };
        // Save as — a NEW name, the original left alone (TradingView's "Save as" is the
        // habit its own community advice builds: Save As before you experiment).
        actions.appendChild(
            row('plus', 'Save as…', '', () =>
                this.askName('Save as', 'Save a copy under a new name', name ? `${name} copy` : 'Untitled layout', (value) => {
                    this.run(() => {
                        if (this.opts.layout.onSaveLayoutWithThumb) this.opts.layout.onSaveLayoutWithThumb(value);
                        else this.opts.layout.onSaveLayout?.(value);
                    });
                }),
            ),
        );
        actions.appendChild(row('clone', 'Make a copy…', '', () => this.copyFlow(name)));
        actions.appendChild(
            row(
                'pen',
                'Rename…',
                '',
                () => {
                    if (!name) return;
                    this.askName('Rename layout', 'Layout name', name, (value) => {
                        const ok = this.opts.layout.onRenameLayout?.(name, value) === true;
                        if (!ok) return 'A layout with that name already exists';
                        this.opts.onChange?.();
                        return undefined;
                    });
                },
                !name,
            ),
        );
        actions.appendChild(
            row('link', 'Share link', '', () => {
                const target = name;
                this.runAsync(async () => {
                    const url = target
                        ? await (this.opts.layout.onShareLayout?.(target) ?? Promise.resolve(null))
                        : await (this.opts.layout.onCopyLink?.() ?? Promise.resolve(null));
                    return url ? 'Link copied to the clipboard' : 'The browser refused the clipboard';
                });
            }),
        );
        actions.appendChild(
            row('download', 'Export chart data (CSV)', '', () => {
                const out = this.opts.layout.onExportData?.('all', 'iso') ?? null;
                this.flash = {
                    text: out ? `Exported ${out.rows.toLocaleString()} bars to ${out.filename}` : 'No bar data to export yet',
                    ...(out ? { tone: 'ok' as const } : {}),
                };
                this.render();
            }),
        );
        if (this.opts.layout.onImportLayout) {
            actions.appendChild(row('upload', 'Import layout file…', '', () => this.pickImportFile()));
        }
        card.appendChild(actions);

        // ── autosave ──
        if (this.opts.layout.onToggleAutosave) {
            card.appendChild(this.sep());
            const sw = this.doc.createElement('button');
            sw.type = 'button';
            sw.className = 'vela-lm-switch';
            sw.setAttribute('role', 'switch');
            sw.setAttribute('aria-checked', String(autosave));
            const text = this.doc.createElement('span');
            text.className = 'vela-lm-swtext';
            const b = this.doc.createElement('b');
            b.textContent = 'Autosave';
            const small = this.doc.createElement('small');
            small.textContent = autosave ? 'Writing every change to this layout' : 'Save when you are ready';
            text.append(b, small);
            const pill = this.doc.createElement('span');
            pill.className = 'vela-lm-pill';
            pill.setAttribute('aria-hidden', 'true');
            sw.append(text, pill);
            sw.addEventListener('click', () => {
                this.run(() => this.opts.layout.onToggleAutosave?.(!autosave));
            });
            card.appendChild(sw);
        }

        // ── open layout ──
        card.appendChild(this.sep());
        const sect = this.doc.createElement('div');
        sect.className = 'vela-lm-sect';
        sect.textContent = rows.length === 0 ? 'Open layout' : `Open layout · ${rows.length}`;
        card.appendChild(sect);

        if (rows.length === 0) {
            const empty = this.doc.createElement('div');
            empty.className = 'vela-lm-empty';
            empty.textContent = 'No saved layouts yet. Save this one and it waits here — charts, indicators and drawings together.';
            card.appendChild(empty);
        } else {
            // The grid panel used to carry the saved-layout list. Keep its long-list
            // search here so moving the list did not lose a control.
            if (rows.length >= 8) {
                const filter = this.doc.createElement('input');
                filter.type = 'text';
                filter.className = 'vela-lm-filter';
                filter.placeholder = `Filter ${rows.length} layouts…`;
                filter.setAttribute('aria-label', 'Filter saved layouts');
                filter.addEventListener('input', () => {
                    const q = filter.value.trim().toLowerCase();
                    for (const el of card.querySelectorAll<HTMLElement>('.vela-lm-srow')) {
                        el.hidden = q !== '' && !(el.dataset.name ?? '').toLowerCase().includes(q);
                    }
                });
                filter.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                        filter.value = '';
                        filter.dispatchEvent(new Event('input'));
                    }
                });
                card.appendChild(filter);
            }
            for (const r of rows) card.appendChild(this.savedRow(r));
        }

        panel.replaceChildren(card);
        // The panel is rebuilt on every verb, so the tab order must land where the trader
        // was: keep focus inside instead of dropping it to the document.
        panel.setAttribute('aria-busy', this.busy ? 'true' : 'false');
    }

    /** One saved layout: open on click, verbs behind the row's kebab. */
    private savedRow(r: LayoutMenuRow): HTMLElement {
        const wrap = this.doc.createElement('div');
        wrap.className = 'vela-lm-srow';
        wrap.dataset.name = r.name;
        if (r.active) wrap.dataset.active = '1';

        const main = this.doc.createElement('button');
        main.type = 'button';
        main.className = 'vela-lm-smain';
        main.setAttribute('aria-label', `Open layout ${r.name}`);
        const name = this.doc.createElement('span');
        name.className = 'vela-lm-sname';
        name.textContent = r.name;
        main.appendChild(name);
        if (r.dirty) {
            const dot = this.doc.createElement('span');
            dot.className = 'vela-lm-dot';
            dot.setAttribute('aria-hidden', 'true');
            main.appendChild(dot);
        }
        const meta = this.doc.createElement('span');
        meta.className = 'vela-lm-smeta';
        const parts = [`${r.charts ?? 1}`, `${r.indicators ?? 0} ind`];
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        if (r.active) {
            const check = iconEl('check', this.doc);
            check.classList.add('vela-lm-check');
            main.appendChild(check);
        }
        main.addEventListener('click', () => {
            // Even the OPEN layout is a snapshot: clicking its name must restore it after
            // the live chart drifted (the old grid picker did exactly that). A no-op here
            // silently dropped "open this layout" for the active row.
            this.opts.layout.onOpenLayout?.(r.name);
            this.opts.onChange?.();
            this.close();
        });
        wrap.appendChild(main);

        const kebab = this.doc.createElement('button');
        kebab.type = 'button';
        kebab.className = 'vela-lm-kebab';
        kebab.setAttribute('aria-label', `Actions for ${r.name}`);
        kebab.setAttribute('aria-expanded', String(this.openRow === r.name));
        if (this.openRow === r.name) kebab.dataset.open = '1';
        kebab.appendChild(iconEl('more', this.doc));
        kebab.addEventListener('click', () => {
            this.openRow = this.openRow === r.name ? null : r.name;
            this.armedRow = null;
            this.render();
            // Focus the kebab that was just pressed — rebuilds replace the node, and a
            // dropped focus makes the next arrow key scroll the page instead.
            const rows = [...(this.panel?.querySelectorAll<HTMLElement>('.vela-lm-srow') ?? [])];
            rows.find((el) => el.dataset.name === r.name)?.querySelector<HTMLElement>('.vela-lm-kebab')?.focus({ preventScroll: true });
        });
        wrap.appendChild(kebab);

        const holder = this.doc.createElement('div');
        holder.appendChild(wrap);
        if (this.openRow === r.name) holder.appendChild(this.rowStrip(r));
        return holder;
    }

    /** The kebab's unfolded verbs — text buttons, not four more icons. */
    private rowStrip(r: LayoutMenuRow): HTMLElement {
        const strip = this.doc.createElement('div');
        strip.className = 'vela-lm-strip';
        const act = (label: string, run: () => void, danger = false): void => {
            const b = this.doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-lm-act';
            if (danger) b.dataset.danger = '1';
            b.textContent = label;
            b.addEventListener('click', run);
            strip.appendChild(b);
        };
        act('Open', () => {
            this.opts.layout.onOpenLayout?.(r.name);
            this.opts.onChange?.();
            this.close();
        });
        act('Rename…', () =>
            this.askName('Rename layout', 'Layout name', r.name, (value) => {
                const ok = this.opts.layout.onRenameLayout?.(r.name, value) === true;
                if (!ok) return 'A layout with that name already exists';
                this.opts.onChange?.();
                return undefined;
            }),
        );
        act('Copy…', () => this.copyFlow(r.name));
        act('Share', () => {
            this.runAsync(async () => {
                const url = await (this.opts.layout.onShareLayout?.(r.name) ?? Promise.resolve(null));
                return url ? 'Link copied to the clipboard' : 'The browser refused the clipboard';
            });
        });
        act('Export', () => {
            const json = this.opts.layout.onExportLayout?.(r.name) ?? null;
            if (!json) {
                this.flash = { text: 'Could not read that layout' };
                this.render();
                return;
            }
            // The download itself lives beside the sidebar's export: same helper, so a
            // host that forbids object URLs degrades instead of throwing out of a click.
            downloadText(this.doc, `${r.name}.vela-layout.json`, json);
            this.flash = { text: `Exported ${r.name}`, tone: 'ok' };
            this.render();
        });
        if (this.opts.layout.onDeleteLayout) {
            const armed = this.armedRow === r.name;
            act(armed ? `Delete — tap to confirm` : 'Delete', () => {
                if (!armed) {
                    this.armedRow = r.name;
                    this.render();
                    return;
                }
                this.opts.layout.onDeleteLayout?.(r.name);
                this.armedRow = null;
                this.openRow = null;
                this.opts.onChange?.();
                this.render();
            }, true);
        }
        return strip;
    }

    private sep(): HTMLElement {
        const el = this.doc.createElement('div');
        el.className = 'vela-lm-sep';
        return el;
    }

    /** Run a synchronous verb, then repaint from live state. */
    private run(fn: () => void): void {
        fn();
        this.opts.onChange?.();
        this.render();
    }

    /** Run an async verb; the status line reports the outcome and the panel stays open. */
    private runAsync(fn: () => Promise<string>): void {
        if (this.busy) return;
        this.busy = true;
        this.render();
        void fn()
            .then((text) => {
                this.flash = /refused/i.test(text) ? { text } : { text, tone: 'ok' };
            })
            .catch(() => {
                this.flash = { text: 'The browser refused the clipboard' };
            })
            .finally(() => {
                this.busy = false;
                this.opts.onChange?.();
                this.render();
            });
    }

    /** Open the OS file chooser for a saved-layout JSON file. */
    private pickImportFile(): void {
        const input = this.doc.createElement('input');
        input.type = 'file';
        input.className = 'vela-lm-file';
        input.accept = 'application/json,.json,.vela';
        input.style.display = 'none';
        input.setAttribute('aria-label', 'Import layout file');
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
                const name = this.opts.layout.onImportLayout?.(text) ?? null;
                this.flash = name
                    ? { text: `Imported ${name}`, tone: 'ok' }
                    : { text: 'That file is not a layout snapshot' };
                this.opts.onChange?.();
                this.render();
                input.remove();
            });
        });
        this.doc.body.appendChild(input);
        input.click();
    }

    /**
     * TradingView's "Make a copy" asks for a name. The workspace's duplicate names the copy
     * itself ("X copy", "X copy 2"…) because an archive action must never collide with a
     * name the trader already owns — so the typed name is applied as a RENAME afterwards.
     * When that name is taken, the copy keeps its generated one and the panel says so
     * instead of deleting work to make the label fit.
     */
    private copyFlow(base: string | null): void {
        const layout = this.opts.layout;
        const source = base ?? layout.activeLayout?.() ?? null;
        this.askName('Make a copy', 'Name the copy', source ? `${source} copy` : 'Untitled copy', (value) => {
            if (!source) {
                // Nothing saved yet: a "copy" of an unsaved workspace is just Save as.
                this.run(() => {
                    if (layout.onSaveLayoutWithThumb) layout.onSaveLayoutWithThumb(value);
                    else layout.onSaveLayout?.(value);
                });
                return undefined;
            }
            const copy = layout.onDuplicateLayout?.(source) ?? null;
            if (!copy) return 'Could not copy that layout';
            if (copy !== value && layout.onRenameLayout?.(copy, value) !== true) {
                this.flash = { text: `“${value}” is taken — saved as “${copy}”` };
            }
            this.opts.onChange?.();
            return undefined;
        });
    }

    // ── the naming dialog ────────────────────────────────────────────────────────

    /**
     * One field, one verb. `commit` returns an ERROR STRING to keep the dialog open (a
     * duplicate name is the only thing that can reject), or nothing on success.
     */
    private askName(title: string, label: string, value: string, commit: (name: string) => string | void): void {
        // The panel must not stay up behind a modal: its outside-dismiss would fight the
        // dialog's backdrop.
        this.close();
        this.dialog?.destroy();
        const dialog = new Dialog({
            title,
            ...(this.hostEl ? { host: this.hostEl } : {}),
            className: 'vela-lm-dialog',
            content: (body) => {
                const form = this.doc.createElement('div');
                form.className = 'vela-lm-form';
                const lab = this.doc.createElement('label');
                lab.textContent = label;
                const input = this.doc.createElement('input');
                input.className = 'vela-lm-input';
                input.type = 'text';
                input.value = value;
                input.setAttribute('aria-label', label);
                input.spellcheck = false;
                input.maxLength = 80;
                const err = this.doc.createElement('div');
                err.className = 'vela-lm-err';
                err.setAttribute('role', 'alert');
                const act = this.doc.createElement('div');
                act.className = 'vela-lm-actions';
                const cancel = this.doc.createElement('button');
                cancel.type = 'button';
                cancel.className = 'vela-lm-btn';
                cancel.textContent = 'Cancel';
                const ok = this.doc.createElement('button');
                ok.type = 'button';
                ok.className = 'vela-lm-btn';
                ok.dataset.primary = '1';
                ok.textContent = 'Save';
                const submit = (): void => {
                    const name = input.value.trim();
                    if (!name) {
                        err.textContent = 'A layout needs a name';
                        input.focus();
                        return;
                    }
                    const problem = commit(name);
                    if (problem) {
                        err.textContent = problem;
                        input.focus();
                        input.select();
                        return;
                    }
                    dialog.hide();
                };
                ok.addEventListener('click', submit);
                cancel.addEventListener('click', () => dialog.hide());
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    }
                });
                // Live feedback: `Save` greys out on an empty field, so the dialog says
                // what it needs before the click instead of after.
                const paint = (): void => {
                    ok.disabled = input.value.trim().length === 0;
                };
                input.addEventListener('input', () => {
                    paint();
                    err.textContent = '';
                });
                act.append(cancel, ok);
                form.append(lab, input, err, act);
                body.appendChild(form);
                paint();
                setTimeout(() => {
                    input.focus();
                    input.select();
                }, 0);
            },
            onOpenChange: (open) => {
                if (!open) this.trigger?.focus({ preventScroll: true });
            },
        });
        this.dialog = dialog;
        dialog.show();
    }
}
