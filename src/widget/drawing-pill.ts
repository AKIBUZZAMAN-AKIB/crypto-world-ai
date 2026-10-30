// Drawing bar (mobile) — the contextual strip that appears while a tool is armed (or
// the eraser is on), docked BETWEEN the grid and the bottom bar. It used to float over
// the plot at bottom-centre, where it covered the last row's time axis; a strip in the
// flow costs 46px of height while drawing and never hides a pixel.
//
// The strip keeps the daily verbs on its face — the armed tool's glyph, undo/redo (a
// placed drawing is now sticky, so undo is the move you reach for), the magnet cycle,
// the eraser, an overflow menu and ✕. Stay-in-drawing-mode, the saved templates and
// hide-all moved into the ⋯ menu: they are settings of the session, not per-drawing
// actions, and seven 40px targets do not fit a 320px phone.
// Widget chrome over the PUBLIC drawings facade only: it drives `chart.drawings` and
// follows the drawing:* events, so any path that arms/disarms a tool (drawer, keyboard
// shortcut, API) keeps it truthful. Only shown in the mobile size class — desktop keeps
// the docked toolbar.
import type { Vela } from '../Vela';
import { iconEl, iconMarkup } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { Menu } from '../ui/components/menu';
import { builtinToolTemplates, getDrawingType, templateColor, type DrawingToolDefaults, type SnapMode } from '../core/drawings';

const STYLE_ID = 'vela-widget-drawing-pill';
const CSS = `
.vela-drawdock { display: none; }
[data-layout='mobile'] .vela-drawdock {
    /* A zero-height wrapper when the strip is hidden, one row of 40px targets when it
       is not — and the anchor the templates sheet opens above. */
    display: flex;
    flex-direction: column;
    position: relative;
    flex: none;
    z-index: 31;
}
.vela-drawpill { display: none; }
[data-layout='mobile'] .vela-drawpill {
    /* In the flow, between the grid and the bottom bar: never covers the plot (the old
       floating pill sat on the last row's time axis), inherits the theme tokens from the
       kit host, and its border-top reads as the bar's own second row. */
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 3px 6px;
    border-top: 1px solid var(--vela-border);
    background: var(--vela-surface);
    color: var(--vela-fg);
    /* A 320px phone cannot hold eight 40px buttons; the strip scrolls instead of
       shrinking the targets, and the fade on the right says there is more. */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
}
[data-layout='mobile'] .vela-drawpill::-webkit-scrollbar { display: none; }
[data-layout='mobile'] .vela-drawpill[hidden] { display: none !important; }
/* The armed tool's glyph doubles as the "disarm" press (TradingView's own gesture):
   tapping the tool you are holding puts it down. */
.vela-drawpill-tool {
    all: unset;
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--vela-hover);
    color: var(--vela-accent-ink, var(--vela-accent));
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-drawpill-tool:active { background: var(--vela-hover-strong); }
.vela-drawpill-tool svg { width: 22px; height: 22px; }
.vela-drawpill-btn[disabled] { opacity: 0.3; pointer-events: none; }
.vela-drawpill-btn {
    all: unset;
    flex: none;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}
.vela-drawpill-btn:active { background: var(--vela-hover); }
.vela-drawpill-btn[data-on='1'] { color: var(--vela-accent-ink, var(--vela-accent)); background: var(--vela-hover); }
.vela-drawpill-btn .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-drawpill-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 8px;
    font-weight: 700;
    color: var(--vela-accent-ink, var(--vela-accent));
}
/* The templates sheet — the phone's door to a saved look, straight off the pill. */
.vela-dptpl {
    position: absolute;
    left: 0;
    right: 0;
    margin: 0 auto;
    bottom: calc(100% + 4px);
    width: min(280px, calc(100% - 16px));
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--vela-border-strong);
    border-radius: var(--vela-radius-md, 10px);
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    z-index: 32;
    animation: vela-dptpl-in 120ms ease-out;
}
@keyframes vela-dptpl-in { from { opacity: 0; transform: translateY(4px); } }
.vela-dptpl-head {
    padding: 4px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-dptpl-row {
    all: unset;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 8px;
    border-radius: 8px;
    color: var(--vela-fg);
    font-size: 14px;
    cursor: pointer;
}
.vela-dptpl-row:active { background: var(--vela-hover); }
.vela-dptpl-row[data-active='1'] { background: var(--vela-hover); }
.vela-dptpl-sw {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-fg) 18%, transparent);
}
.vela-dptpl-name { flex: 1 1 auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dptpl-check { flex: none; width: 16px; height: 16px; color: var(--vela-accent-ink, var(--vela-accent)); }
.vela-dptpl-sep { height: 1px; margin: 3px 8px; background: var(--vela-border); }
.vela-dptpl-empty { padding: 4px 8px 8px; font-size: 12px; line-height: 1.45; color: var(--vela-fg-muted); }
`;

export class DrawingPill {
    private readonly el: HTMLElement;
    private readonly toolGlyph: HTMLButtonElement;
    private readonly magnetBtn: HTMLButtonElement;
    private readonly magnetBadge: HTMLElement;
    private readonly undoBtn: HTMLButtonElement;
    private readonly redoBtn: HTMLButtonElement;
    private readonly eraserBtn: HTMLButtonElement;
    private readonly moreBtn: HTMLButtonElement;
    /** The ⋯ overflow: stay-mode, templates, hide-all — session switches, not per-drawing verbs. */
    private moreMenu: Menu | null = null;
    /** The bar row this strip lives in (see the constructor). */
    private readonly dock: HTMLElement;
    private sheet: HTMLElement | null = null;
    private chart: Vela | null = null;

    constructor(host: HTMLElement) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        // The host is the bar's own dock row (or, without a bottom bar, the grid — where
        // CSS keeps it absolute). The strip is IN the flow, so a hidden strip leaves no
        // 46px hole and a visible one never covers the plot.
        this.dock = doc.createElement('div');
        this.dock.className = 'vela-drawdock';
        this.el = doc.createElement('div');
        this.el.className = 'vela-drawpill';
        this.el.hidden = true;

        // Tapping the armed tool's own glyph puts it down — the same toggle a desktop
        // toolbar gives you, and the reason the ✕ is no longer the only way out.
        this.toolGlyph = doc.createElement('button');
        this.toolGlyph.type = 'button';
        this.toolGlyph.className = 'vela-drawpill-tool';
        this.toolGlyph.setAttribute('aria-label', 'Put the tool down');
        this.toolGlyph.addEventListener('click', () => {
            this.chart?.drawings.setTool(null);
            this.chart?.drawings.setMode(null);
        });

        const btn = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-drawpill-btn';
            b.setAttribute('aria-label', label);
            b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.magnetBtn = btn('magnet', 'Magnet snap', () => {
            const order: SnapMode[] = ['off', 'weak', 'strong'];
            const cur = this.chart?.drawings.getSnapMode() ?? 'off';
            this.chart?.drawings.setSnapMode(order[(order.indexOf(cur) + 1) % order.length]!);
        });
        this.magnetBadge = doc.createElement('span');
        this.magnetBadge.className = 'vela-drawpill-badge';
        this.magnetBtn.appendChild(this.magnetBadge);
        // Undo/redo belong HERE now: a tool stays armed after a placement, so the
        // mistake you just made is one tap away instead of More → Undo.
        this.undoBtn = btn('undo', 'Undo drawing', () => this.chart?.drawings.undo());
        this.redoBtn = btn('redo', 'Redo drawing', () => this.chart?.drawings.redo());
        this.eraserBtn = btn('eraser', 'Eraser', () => {
            this.chart?.drawings.setMode(this.chart.drawings.getMode() === 'eraser' ? null : 'eraser');
        });
        this.moreBtn = btn('kebab', 'More drawing tools', () => this.toggleMore());
        this.moreBtn.setAttribute('aria-haspopup', 'menu');
        this.moreBtn.setAttribute('aria-expanded', 'false');
        const close = btn('close', 'Exit drawing mode', () => {
            this.chart?.drawings.setTool(null);
            this.chart?.drawings.setMode(null);
        });

        this.el.append(this.toolGlyph, this.undoBtn, this.redoBtn, this.magnetBtn, this.eraserBtn, this.moreBtn, close);
        this.dock.appendChild(this.el);
        host.appendChild(this.dock);
    }

    // ── the templates sheet ─────────────────────────────────────────────────────
    /** Open/close the saved-look sheet for the armed tool. Closes on an outside press and
     *  on Escape — the two ways a phone dismisses a popover. */
    private toggleSheet(): void {
        if (this.sheet) {
            this.closeSheet();
            return;
        }
        const tool = this.chart?.drawings.getTool();
        if (!tool) return;
        const doc = this.el.ownerDocument;
        const sheet = doc.createElement('div');
        sheet.className = 'vela-dptpl';
        sheet.setAttribute('role', 'menu');
        sheet.setAttribute('aria-label', 'Drawing templates');
        const head = doc.createElement('div');
        head.className = 'vela-dptpl-head';
        head.textContent = `Templates · ${getDrawingType(tool)?.label ?? tool}`;
        sheet.appendChild(head);

        const saved = this.chart?.drawings.toolTemplates()?.[tool] ?? [];
        const live = this.chart?.drawings.toolDefaults()?.[tool];
        const looks: Array<{ name: string; settings?: DrawingToolDefaults; color?: string }> = [
            { name: 'Default', ...(builtinToolTemplates(tool)[0] ? { settings: builtinToolTemplates(tool)[0]!.settings } : {}) },
            ...saved.map((t) => ({ name: t.name, settings: t.settings, ...(templateColor(t.settings) ? { color: templateColor(t.settings)! } : {}) })),
        ];
        for (const look of looks) {
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'vela-dptpl-row';
            row.setAttribute('role', 'menuitemradio');
            const active = look.settings && live ? JSON.stringify(look.settings) === JSON.stringify(live) : false;
            row.setAttribute('aria-checked', String(!!active));
            row.toggleAttribute('data-active', !!active);
            const sw = doc.createElement('span');
            sw.className = 'vela-dptpl-sw';
            // "Default" has no colour of its own — a faint hatch says "the tool's built-in
            // look" instead of the empty box, which read as an unticked checkbox.
            sw.style.background = look.color ?? 'repeating-linear-gradient(45deg, var(--vela-fg-muted) 0 1.5px, transparent 1.5px 4px)';
            sw.style.opacity = look.color ? '1' : '0.5';
            const name = doc.createElement('span');
            name.className = 'vela-dptpl-name';
            name.textContent = look.name;
            const check = doc.createElement('span');
            check.className = 'vela-dptpl-check';
            if (active) check.appendChild(iconEl('check', doc));
            row.append(sw, name, check);
            row.addEventListener('click', () => {
                if (look.settings) this.applyLook(tool, look.settings);
                this.closeSheet();
            });
            sheet.appendChild(row);
            if (look.name === 'Default' && saved.length > 0) {
                const sep = doc.createElement('div');
                sep.className = 'vela-dptpl-sep';
                sheet.appendChild(sep);
            }
        }
        if (saved.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-dptpl-empty';
            empty.textContent = 'Save a look from any drawing’s Templates button and it appears here.';
            sheet.appendChild(empty);
        }
        this.dock.appendChild(sheet);
        this.sheet = sheet;
        // Deferred: this very tap's pointerdown is already past, so an outside listener
        // added now cannot swallow the tap that opened the sheet.
        setTimeout(() => {
            doc.addEventListener('pointerdown', this.onSheetOutside);
            doc.addEventListener('keydown', this.onSheetKey);
        }, 0);
    }

    private applyLook(tool: string, settings: DrawingToolDefaults): void {
        const drawings = this.chart?.drawings;
        if (!drawings) return;
        drawings.setToolDefaults({ ...drawings.toolDefaults(), [tool]: settings });
    }

    private readonly onSheetOutside = (e: PointerEvent): void => {
        if (!this.sheet) return;
        const t = e.target as Node;
        if (!this.sheet.contains(t) && !this.moreBtn.contains(t)) this.closeSheet();
    };

    private readonly onSheetKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') this.closeSheet();
    };

    private closeSheet(): void {
        const doc = this.el.ownerDocument;
        doc.removeEventListener('pointerdown', this.onSheetOutside);
        doc.removeEventListener('keydown', this.onSheetKey);
        this.sheet?.remove();
        this.sheet = null;
    }

    // ── the session verbs the ⋯ menu exposes ────────────────────────────────────
    // Public because they are the strip's whole API to the drawing session: a host that
    // wants its own affordance (or a test) reaches the same three switches, and the menu
    // never becomes the only door to them.
    toggleStayMode(): void {
        const d = this.chart?.drawings;
        if (d) d.setStayMode(!d.getStayMode());
    }

    toggleHiddenAll(): void {
        const d = this.chart?.drawings;
        if (d) d.setHiddenAll(!d.isHiddenAll());
    }

    /** Open/close the saved-looks sheet for the armed tool. */
    toggleTemplates(): void {
        this.toggleSheet();
    }

    // ── the ⋯ overflow ──────────────────────────────────────────────────────────
    /** Stay-in-drawing-mode, saved templates and hide-all — the three switches that
     *  govern the whole drawing session. They sit in a menu because the strip only has
     *  room for the verbs you press WHILE drawing (undo, magnet, eraser, exit). */
    private toggleMore(): void {
        if (this.moreMenu) {
            this.closeMore();
            return;
        }
        const d = this.chart?.drawings;
        if (!d) return;
        const stay = d.getStayMode();
        const hidden = d.isHiddenAll();
        const menu = new Menu({
            trigger: this.moreBtn,
            host: this.dock,
            placement: 'top',
            items: [
                { id: 'stay', label: 'Stay in drawing mode', icon: 'pen-lock', toggle: true, checked: stay },
                { id: 'templates', label: 'Templates…', icon: 'templates' },
                { id: 'hide', label: hidden ? 'Show all drawings' : 'Hide all drawings', icon: hidden ? 'eye-off' : 'eye' },
            ],
            onSelect: (id) => {
                this.closeMore();
                if (id === 'stay') this.toggleStayMode();
                else if (id === 'templates') this.toggleTemplates();
                else if (id === 'hide') this.toggleHiddenAll();
            },
            onOpenChange: (open) => {
                this.moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
                this.moreBtn.dataset.on = open ? '1' : '';
                if (!open) this.moreMenu = null;
            },
        });
        this.moreMenu = menu;
        menu.open();
    }

    private closeMore(): void {
        this.moreMenu?.destroy();
        this.moreMenu = null;
        this.moreBtn.dataset.on = '';
        this.moreBtn.setAttribute('aria-expanded', 'false');
    }

    private chartSubs: Array<() => void> = [];

    /** Rebind to another chart (a rebuild, or the workspace's active cell changing) —
     *  the previous chart's subscriptions are dropped so only one chart drives the pill. */
    onChart(chart: Vela): void {
        for (const off of this.chartSubs) off();
        this.chart = chart;
        this.chartSubs = [
            chart.on('drawing:tool', () => this.sync()),
            chart.on('drawing:snap', () => this.sync()),
            chart.on('drawing:stay', () => this.sync()),
            chart.on('drawing:mode', () => this.sync()),
            chart.on('drawing:hidden-all', () => this.sync()),
            // Placement/erase/undo all land here — the only thing that changes is whether
            // undo and redo have something to do, so no full re-sync (the sheet stays put).
            chart.on('drawing:created', () => this.syncHistory()),
            chart.on('drawing:edited', () => this.syncHistory()),
            chart.on('drawing:removed', () => this.syncHistory()),
        ];
        this.sync();
    }

    private sync(): void {
        this.closeSheet(); // the armed tool changed (or the strip hid) — its list is stale
        this.closeMore();
        const drawings = this.chart?.drawings;
        if (!drawings || !drawings.supported) {
            this.el.hidden = true;
            return;
        }
        const tool = drawings.getTool();
        const eraser = drawings.getMode() === 'eraser';
        this.el.hidden = tool === null && !eraser;
        if (this.el.hidden) return;
        this.toolGlyph.innerHTML = tool !== null ? (getDrawingType(tool)?.icon ?? '') : (iconMarkup('eraser') ?? '');
        const snap = drawings.getSnapMode();
        this.magnetBtn.dataset.on = snap !== 'off' ? '1' : '';
        this.magnetBadge.textContent = snap === 'weak' ? 'W' : snap === 'strong' ? 'S' : '';
        this.eraserBtn.dataset.on = eraser ? '1' : '';
        // Undo/redo grey out when the stack is empty — the signal that tells you the
        // gesture landed without having to watch the plot.
        this.syncHistory();
        this.moreBtn.dataset.on = drawings.getStayMode() || drawings.isHiddenAll() ? '1' : '';
    }

    /** Undo/redo afford their availability: an empty stack greys the button out. */
    private syncHistory(): void {
        const d = this.chart?.drawings;
        if (!d) return;
        this.undoBtn.disabled = !d.canUndo();
        this.redoBtn.disabled = !d.canRedo();
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.closeMore();
        this.dock.remove();
    }
}
