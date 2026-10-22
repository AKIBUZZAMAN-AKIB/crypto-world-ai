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
.vela-md-preset[data-checked='1'] { border-color: var(--vela-selected-bg); background: var(--vela-hover); }
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
`;

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
        syncs?: () => Array<{ id: string; label: string; checked: boolean; group?: string }>;
        onToggleSync?: (id: string) => void;
        /** Cycle the ACTIVE cell through a link's groups (the row's chip). */
        onCycleGroup?: (id: string) => void;
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

    constructor(private readonly opts: MoreDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
    }

    open(): void {
        this.view = 'main';
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
        this.render();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();

        if (this.view !== 'main') {
            const back = doc.createElement('button');
            back.className = 'vela-md-back';
            back.appendChild(iconEl('chevron-left', doc));
            back.appendChild(doc.createTextNode(this.view === 'style' ? 'Chart type' : this.view === 'layout' ? 'Layout' : 'Alerts'));
            back.addEventListener('click', () => this.show('main'));
            this.drawer.body.appendChild(back);
        }

        if (this.view === 'main') this.renderMain(doc);
        else if (this.view === 'style') this.renderStyle(doc);
        else if (this.view === 'layout') this.renderLayout(doc);
        else this.renderAlerts(doc);
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

    private renderLayout(doc: Document): void {
        const layout = this.opts.layout;
        if (!layout) return;
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        // The desktop dropdown's grid canvas, touch-sized: the current rows×cols
        // rectangle is lit, a tap applies that grid immediately (no hover preview).
        const caption = doc.createElement('div');
        caption.className = 'vela-md-section';
        caption.textContent = 'Custom grid';
        list.appendChild(caption);
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
        wrap.appendChild(grid);
        list.appendChild(wrap);
        // The layouts TradingView calls "asymmetric" are the interesting ones — each gets a
        // GLYPH TILE (the same mini-diagram the desktop dropdown draws) grouped by chart
        // count, so a phone shows the shape of a layout instead of a wall of text rows.
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
            list.appendChild(heading);
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
                const caption = doc.createElement('span');
                caption.className = 'vela-md-preset-label';
                caption.textContent = preset.label;
                tile.append(glyph, caption);
                tile.addEventListener('click', () => {
                    layout.onSelectPreset(preset.id);
                    this.drawer.hide();
                });
                tiles.appendChild(tile);
            }
            list.appendChild(tiles);
        }
        const syncs = layout.syncs?.() ?? [];
        if (syncs.length > 0) {
            const heading = doc.createElement('div');
            heading.className = 'vela-md-section';
            heading.textContent = 'Sync';
            list.appendChild(heading);
            for (const s of syncs) {
                // The label carries the ACTIVE cell's group ("Symbol · A") — the tap
                // cycles it, mirroring the desktop row's chip.
                const label = s.group ? `${s.label} · ${s.group}` : s.label;
                list.appendChild(
                    this.row(doc, label, {
                        checked: s.checked,
                        onClick: () => {
                            layout.onToggleSync?.(s.id);
                            this.render(); // a toggle stays in the drawer — reflect the flip in place
                        },
                    }),
                );
                // Grouping is a second, explicit row: a tap never has to guess between
                // "link on/off" and "which group" on a touch surface.
                if (layout.onCycleGroup) {
                    list.appendChild(
                        this.row(doc, `${s.label} group`, {
                            value: s.group ?? 'none',
                            onClick: () => {
                                layout.onCycleGroup?.(s.id);
                                this.render();
                            },
                        }),
                    );
                }
            }
            if (layout.drawingsScope) {
                list.appendChild(
                    this.row(doc, 'Drawing scope', {
                        value: layout.drawingsScope(),
                        onClick: () => {
                            layout.onToggleDrawingsScope?.();
                            this.render();
                        },
                    }),
                );
            }
            const hidden = layout.hiddenCharts?.() ?? 0;
            if (hidden > 0 && layout.onClearPooled) {
                list.appendChild(
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
        this.renderSavedLayouts(doc, list, layout);
        this.drawer.body.appendChild(list);
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
            list.appendChild(
                this.row(doc, l.name, {
                    ...(l.active ? { checked: true } : {}),
                    onClick: () => {
                        layout.onOpenLayout?.(l.name);
                        this.drawer.hide();
                    },
                }),
            );
        }
        if (layout.onSaveLayout) {
            list.appendChild(
                this.row(doc, 'Save current layout', {
                    value: `#${rows.length + 1}`,
                    onClick: () => {
                        layout.onSaveLayout?.(`Layout ${rows.length + 1}`);
                        this.render();
                    },
                }),
            );
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
