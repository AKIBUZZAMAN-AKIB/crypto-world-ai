// CHART-TYPE SHEET (mobile) — the phone's answer to "what kind of chart is this?".
//
// The mobile bar used to spend its widest fixed stop on the layout COUNT ("2×2"), which is
// a number a trader reads once and then never touches again, while the chart TYPE — the
// thing you switch while reading — was three taps away inside More. This sheet is the
// replacement's other half: the bar shows the current style's glyph and this panel opens
// above the bar with every registered style, as a grid of tiles.
//
// Why a grid and not a list: a style is recognised by its SHAPE (candles vs line vs Renko
// bricks), so the glyph has to be the target. A list of 19 rows is a scroll; a 4-up grid is
// two screens of thumb-reach per row and a single tap.
//
// It is a popover-class surface, not a modal: no scrim, no focus trap, outside-tap and
// Escape close it, and it announces itself through the kit's surface events so a host can
// close whatever else was open.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { announceSurface } from '../ui/surface-events';
import { holdForExit, type SurfaceExit } from '../ui/surface-exit';

const STYLE_ID = 'vela-widget-chart-type-sheet';

const CSS = `
.vela-cts {
    position: fixed;
    left: 50%;
    bottom: calc(58px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: var(--vela-z-popover);
    width: min(384px, calc(100vw - 12px));
    max-height: min(62vh, 460px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px) * 0);
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 14px;
    box-shadow: var(--vela-shadow-dialog), inset 0 1px 0 rgb(255 255 255 / 6%);
    transform-origin: bottom center;
    animation: vela-cts-in 160ms var(--vela-ease);
}
.vela-cts[data-closing] { animation: vela-cts-out 120ms var(--vela-ease) forwards; pointer-events: none; }
@keyframes vela-cts-in { from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.98); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
@keyframes vela-cts-out { from { opacity: 1; } to { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.985); } }
@media (prefers-reduced-motion: reduce) {
    .vela-cts, .vela-cts[data-closing] { animation: none; }
}
.vela-cts-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 2px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-cts-head b { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vela-fg-bright); letter-spacing: 0; text-transform: none; font-size: 12px; font-weight: 600; }
.vela-cts-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scroll-padding-block: 4px; }
.vela-cts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
}
.vela-cts-tile {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 58px;
    padding: 7px 3px 6px;
    border-radius: 9px;
    border: 1px solid transparent;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 120ms var(--vela-ease), color 120ms var(--vela-ease), border-color 120ms var(--vela-ease);
}
.vela-cts-tile svg { width: 20px; height: 20px; }
.vela-cts-tile:active { background: var(--vela-hover-strong); }
.vela-cts-tile[data-on='1'] {
    color: var(--vela-fg-bright);
    background: var(--vela-hover);
    border-color: var(--vela-border-strong);
}
.vela-cts-tile[data-on='1'] svg { color: var(--vela-accent, var(--vela-fg-bright)); }
.vela-cts-tile:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }
.vela-cts-name {
    font-size: 9.5px;
    line-height: 1.1;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* The layout door the bar gave up: one quiet row, only on multi-chart shells. */
.vela-cts-layout {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 8px;
    margin-top: 2px;
    border-top: 1px solid var(--vela-border-faint);
    border-radius: 8px;
    color: var(--vela-fg-muted);
    font-size: 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cts-layout:active { background: var(--vela-hover); }
.vela-cts-layout .vela-cts-lglyph { display: inline-flex; width: 18px; height: 18px; }
.vela-cts-layout .vela-cts-lglyph svg { width: 18px; height: 18px; }
.vela-cts-layout b { color: var(--vela-fg-bright); font-weight: 600; }
.vela-cts-layout .vela-cts-chev { margin-left: auto; display: inline-flex; opacity: 0.7; }
`;

export interface ChartTypeOption {
    id: string;
    label: string;
    /** Raw `<svg>` markup (registered by `priceStyleIcon`). */
    icon?: string;
}

export interface ChartTypeSheetOptions {
    /** Where the panel portals to (the workspace root — same host as the bar). */
    host: HTMLElement;
    /** The bar stop that opens it (kept for `aria-expanded` + surface announcements). */
    trigger: HTMLElement;
    /** Every selectable style, in picker order. Read on every open. */
    styles: () => ChartTypeOption[];
    /** The style in effect now. Read on every open. */
    current: () => string;
    onSelect: (id: string) => void;
    /** Multi-chart shells only: the layout door the bar stop gave up. */
    layout?: { label: () => string; glyph: () => string; onOpen: () => void };
}

const COLS = 4;

export class ChartTypeSheet {
    private readonly doc: Document;
    private readonly opts: ChartTypeSheetOptions;
    private el: HTMLElement | null = null;
    private exit: SurfaceExit | null = null;
    private isOpen = false;
    /** Roving focus: the tile index the arrow keys move from. */
    private cursor = 0;
    /** Live refs for in-place updates while the sheet is open (a style change from the
     *  API or the desktop chrome must repaint the sheet, not silently leave it stale). */
    private tiles = new Map<string, HTMLButtonElement>();
    private nowEl: HTMLElement | null = null;
    private layoutValue: HTMLElement | null = null;
    private layoutRow: HTMLButtonElement | null = null;

    constructor(opts: ChartTypeSheetOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
    }

    get visible(): boolean {
        return this.isOpen;
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        if (this.isOpen) return;
        const doc = this.doc;
        injectStyles(STYLE_ID, CSS, doc);
        this.isOpen = true;
        this.exit?.finish();
        this.exit = null;
        this.el?.remove();
        const styles = this.opts.styles();
        const current = this.opts.current();

        const el = doc.createElement('div');
        el.className = 'vela-cts';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Chart type');

        const head = doc.createElement('div');
        head.className = 'vela-cts-head';
        const kicker = doc.createElement('span');
        kicker.textContent = 'Chart type';
        const now = doc.createElement('b');
        now.textContent = styles.find((s) => s.id === current)?.label ?? current;
        head.append(kicker, now);
        this.nowEl = now;

        const scroll = doc.createElement('div');
        scroll.className = 'vela-cts-scroll';
        const grid = doc.createElement('div');
        grid.className = 'vela-cts-grid';
        grid.setAttribute('role', 'group');

        const tiles: HTMLButtonElement[] = [];
        for (const [i, s] of styles.entries()) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-cts-tile';
            b.dataset.id = s.id;
            if (s.id === current) b.dataset.on = '1';
            b.setAttribute('aria-pressed', s.id === current ? 'true' : 'false');
            b.setAttribute('aria-label', s.label);
            if (s.icon) b.innerHTML = s.icon;
            else b.appendChild(iconEl('style-candles', doc));
            const name = doc.createElement('span');
            name.className = 'vela-cts-name';
            name.textContent = s.label;
            b.appendChild(name);
            b.addEventListener('click', () => {
                if (s.id !== this.opts.current()) this.opts.onSelect(s.id);
                this.close();
                this.focusTrigger(); // the tile is gone — focus must not fall to <body>
            });
            b.addEventListener('focus', () => {
                this.cursor = i;
            });
            tiles.push(b);
            this.tiles.set(s.id, b);
            grid.appendChild(b);
        }
        scroll.appendChild(grid);
        el.append(head, scroll);

        if (this.opts.layout) {
            const layout = this.opts.layout;
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'vela-cts-layout';
            const glyph = doc.createElement('span');
            glyph.className = 'vela-cts-lglyph';
            glyph.innerHTML = layout.glyph();
            const text = doc.createElement('span');
            text.textContent = 'Layout · ';
            const value = doc.createElement('b');
            value.textContent = layout.label();
            text.appendChild(value);
            const chev = doc.createElement('span');
            chev.className = 'vela-cts-chev';
            chev.appendChild(iconEl('chevron-right', doc));
            row.append(glyph, text, chev);
            row.setAttribute('aria-label', `Layout ${layout.label()}. Open the layout sheet`);
            row.addEventListener('click', () => {
                this.close();
                layout.onOpen();
            });
            el.appendChild(row);
            this.layoutRow = row;
            this.layoutValue = value;
        }

        doc.body.appendChild(el);
        this.el = el;
        const idx = Math.max(0, styles.findIndex((s) => s.id === current));
        this.cursor = idx;

        this.opts.trigger.setAttribute('aria-expanded', 'true');
        doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        doc.addEventListener('keydown', this.onDocKeydown, true);
        announceSurface(el, true, 'popover', this.opts.trigger);
        // Land on the CURRENT tile: the sheet opens where the user already is, so a
        // thumb reach to change style is one tap on a neighbour, not a scroll hunt.
        try {
            tiles[idx]?.focus({ preventScroll: true });
        } catch {
            /* detached */
        }
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        const doc = this.doc;
        doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.opts.trigger.setAttribute('aria-expanded', 'false');
        const el = this.el;
        this.el = null;
        if (!el) return;
        announceSurface(el, false, 'popover', this.opts.trigger);
        this.tiles.clear();
        this.nowEl = null;
        this.layoutValue = null;
        this.layoutRow = null;
        this.exit?.cancel();
        this.exit = holdForExit(el, () => el.remove());
    }

    // ── live updates while open ─────────────────────────────────────────────────
    /** Repaint the selected tile (the style changed under an open sheet). */
    setCurrent(id: string): void {
        if (!this.isOpen || this.tiles.size === 0) return;
        for (const [tid, tile] of this.tiles) {
            const on = tid === id;
            if (on) tile.dataset.on = '1';
            else delete tile.dataset.on;
            tile.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        const label = this.tiles.get(id)?.getAttribute('aria-label') ?? id;
        if (this.nowEl) this.nowEl.textContent = label;
        const idx = [...this.tiles.keys()].indexOf(id);
        if (idx >= 0) this.cursor = idx;
    }

    /** Repaint the layout row's caption (the grid changed while the sheet is open). */
    setLayoutLabel(label: string): void {
        if (!this.layoutValue || !this.layoutRow) return;
        this.layoutValue.textContent = label;
        this.layoutRow.setAttribute('aria-label', `Layout ${label}. Open the layout sheet`);
    }

    destroy(): void {
        const el = this.el;
        this.close();
        this.exit?.finish();
        this.exit = null;
        el?.remove();
        this.el = null;
    }

    private focusTrigger(): void {
        try {
            this.opts.trigger.focus({ preventScroll: true });
        } catch {
            /* detached */
        }
    }

    private readonly onDocPointerDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (this.el && t && this.el.contains(t)) return;
        if (t && this.opts.trigger.contains(t)) return;
        this.close();
    };

    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (!this.isOpen || !this.el) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
            this.focusTrigger();
            return;
        }
        const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
        const step = move[e.key];
        if (step === undefined) return;
        const tiles = [...this.el.querySelectorAll<HTMLButtonElement>('.vela-cts-tile')];
        if (tiles.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.cursor = Math.max(0, Math.min(tiles.length - 1, this.cursor + step));
        tiles[this.cursor]?.focus({ preventScroll: false });
    };
}
