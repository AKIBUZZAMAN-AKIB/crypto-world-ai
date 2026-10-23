// Floating drawing pill (mobile) — the on-chart remnant of the hidden drawing toolbar.
// While a tool is armed (or the eraser is on) it floats over the plot with the armed
// tool's glyph, the magnet cycle, stay-in-drawing-mode, the eraser, and a ✕ to disarm.
// Widget chrome over the PUBLIC drawings facade only: it drives `chart.drawings` and
// follows the drawing:* events, so any path that arms/disarms a tool (drawer, keyboard
// shortcut, API) keeps it truthful. Only shown in the mobile size class — desktop keeps
// the docked toolbar.
import type { Vela } from '../Vela';
import { iconEl, iconMarkup } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { builtinToolTemplates, getDrawingType, templateColor, type DrawingToolDefaults, type SnapMode } from '../core/drawings';

const STYLE_ID = 'vela-widget-drawing-pill';
const CSS = `
.vela-drawpill { display: none; }
[data-layout='mobile'] .vela-drawpill {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    /* Above the grid's splitters (z 30): the pill floats over the WHOLE grid, so on a
       split layout it physically crosses a drag gutter and would lose every tap. */
    z-index: 31;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 999px;
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    color: var(--vela-fg);
}
[data-layout='mobile'] .vela-drawpill[hidden] { display: none !important; }
.vela-drawpill-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--vela-hover);
    color: var(--vela-accent);
}
.vela-drawpill-tool svg { width: 22px; height: 22px; }
.vela-drawpill-btn {
    all: unset;
    width: 36px;
    height: 36px;
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
.vela-drawpill-btn[data-on='1'] { color: var(--vela-accent); background: var(--vela-hover); }
.vela-drawpill-btn .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-drawpill-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 8px;
    font-weight: 700;
    color: var(--vela-accent);
}
/* The templates sheet — the phone's door to a saved look, straight off the pill. */
.vela-dptpl {
    position: absolute;
    left: 0;
    right: 0;
    margin: 0 auto;
    bottom: 54px;
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
.vela-dptpl-check { flex: none; width: 16px; height: 16px; color: var(--vela-accent); }
.vela-dptpl-sep { height: 1px; margin: 3px 8px; background: var(--vela-border); }
.vela-dptpl-empty { padding: 4px 8px 8px; font-size: 12px; line-height: 1.45; color: var(--vela-fg-muted); }
`;

export class DrawingPill {
    private readonly el: HTMLElement;
    private readonly toolGlyph: HTMLElement;
    private readonly magnetBtn: HTMLButtonElement;
    private readonly magnetBadge: HTMLElement;
    private readonly stayBtn: HTMLButtonElement;
    private readonly eraserBtn: HTMLButtonElement;
    private readonly templatesBtn: HTMLButtonElement;
    private readonly hideAllBtn: HTMLButtonElement;
    private sheet: HTMLElement | null = null;
    private chart: Vela | null = null;

    constructor(host: HTMLElement) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-drawpill';
        this.el.hidden = true;

        this.toolGlyph = doc.createElement('span');
        this.toolGlyph.className = 'vela-drawpill-tool';

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
        this.stayBtn = btn(iconMarkup('pen-lock') ? 'pen-lock' : 'pen', 'Stay in drawing mode', () => {
            this.chart?.drawings.setStayMode(!this.chart.drawings.getStayMode());
        });
        this.eraserBtn = btn('eraser', 'Eraser', () => {
            this.chart?.drawings.setMode(this.chart.drawings.getMode() === 'eraser' ? null : 'eraser');
        });
        // The look the NEXT drawing gets is a choice made while drawing, not after — so
        // the saved templates belong here, on the pill, not only in a finished drawing's
        // popup (which a phone user would have to draw, then find, then tap).
        this.templatesBtn = btn('templates', 'Drawing templates', () => this.toggleSheet());
        this.templatesBtn.setAttribute('aria-haspopup', 'menu');
        this.templatesBtn.setAttribute('aria-expanded', 'false');
        // Hide/show every drawing — the phone's door to the reference's Hide button,
        // reachable WHILE a tool is armed (the moment you notice clutter).
        this.hideAllBtn = btn('eye', 'Hide all drawings', () => {
            const d = this.chart?.drawings;
            if (!d) return;
            d.setHiddenAll(!d.isHiddenAll());
        });
        const close = btn('close', 'Exit drawing mode', () => {
            this.chart?.drawings.setTool(null);
            this.chart?.drawings.setMode(null);
        });

        this.el.append(this.toolGlyph, this.magnetBtn, this.stayBtn, this.templatesBtn, this.hideAllBtn, this.eraserBtn, close);
        host.appendChild(this.el);
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
        this.el.appendChild(sheet);
        this.sheet = sheet;
        this.templatesBtn.dataset.on = '1';
        this.templatesBtn.setAttribute('aria-expanded', 'true');
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
        if (!this.sheet.contains(t) && !this.templatesBtn.contains(t)) this.closeSheet();
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
        this.templatesBtn.dataset.on = '';
        this.templatesBtn.setAttribute('aria-expanded', 'false');
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
        ];
        this.sync();
    }

    private sync(): void {
        this.closeSheet(); // the armed tool changed (or the pill hid) — its list is stale
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
        this.stayBtn.dataset.on = drawings.getStayMode() ? '1' : '';
        this.eraserBtn.dataset.on = eraser ? '1' : '';
        const hidden = drawings.isHiddenAll();
        this.hideAllBtn.dataset.on = hidden ? '1' : '';
        this.hideAllBtn.setAttribute('aria-label', hidden ? 'Show all drawings' : 'Hide all drawings');
        this.hideAllBtn.replaceChildren(iconEl(hidden ? 'eye-off' : 'eye', this.el.ownerDocument));
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.el.remove();
    }
}
