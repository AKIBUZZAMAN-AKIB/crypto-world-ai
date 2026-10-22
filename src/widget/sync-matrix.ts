// The LINK x CHART table — one component, both shells.
//
// What TradingView calls "Chart syncing" is a per-chart emoji: a chart is marked from its
// status line or the series context menu, every chart wearing the same emoji moves
// together, and unchecking the emoji leaves the group (TV help 43000761094 / 43000629992).
// TV has NO table — and in TV the groups only govern symbol + interval.
//
// This table is our synthesis, not a copy: one row per link the workspace carries, one
// column per chart, so ANY (link, chart) pair is one tap away — no hunting for the chart
// first, no activating it first. The groups still mean exactly what TV means. The
// component is shared by the phone sheet and the desktop popover (which used to offer a
// single chip for the active chart only — the asymmetry the user kept hitting: "desktop
// e table nai to").
//
// It scrolls SIDEWAYS INSIDE ITSELF and never widens the page: the link column is
// pinned, columns are `minmax(38px, 1fr)`, and a mask appears only when there really is
// more table to the right (measured after layout, never guessed).
import { injectStyles } from '../ui/styles';
import { attachLongPress, isRtl } from '../ui/gesture';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { IMPLICIT_GROUP } from '../state/document';
import { groupsForCount, groupIdOf, groupMarkColor, groupMarkOf } from '../workspace/sync-marks';

const STYLE_ID = 'vela-sync-matrix';

/** The chip, the table and the scroller — shared by both shells. */
export const SYNC_MATRIX_CSS = `
/* ── the chip ──────────────────────────────────────────────────────────────── */
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
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease,
        box-shadow 120ms ease, transform 90ms ease;
}
.vela-md-chip[data-on='1'] {
    color: var(--vela-fg-bright);
    border-color: color-mix(in srgb, var(--vela-md-mark, var(--vela-accent, var(--vela-selected-bg))) 72%, transparent);
    background: color-mix(in srgb, var(--vela-md-mark, var(--vela-accent, var(--vela-selected-bg))) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vela-md-mark, transparent) 26%, transparent),
        0 1px 6px -2px color-mix(in srgb, var(--vela-md-mark, transparent) 55%, transparent);
}
.vela-md-chip[data-implicit='1'] { border-style: dashed; }
.vela-md-chip:focus-visible { outline: 2px solid var(--vela-accent, var(--vela-selected-bg)); outline-offset: 2px; }

/* ── the table ─────────────────────────────────────────────────────────────── */
.vela-md-matrixwrap {
    /* A 30px row is a dense table, not a toy: a chip is a STATE ("this chart is in the
       red group"), and a chip twice the glyph's height is a billboard. The desktop cell
       stays comfortably over the WCAG 2.2 AA floor (24px); the coarse-pointer block at
       the bottom of this sheet puts the finger-sized 44px back. */
    --vela-sx-cell: 30px;
    --vela-sx-cell-max: 52px;
    --vela-sx-label: 74px;
    --vela-sx-all: 40px;
    margin: 0 -2px;
    padding: 0 2px 4px;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    container-type: inline-size;
    scrollbar-width: thin;
}
.vela-md-matrixwrap::-webkit-scrollbar { height: 6px; }
.vela-md-matrixwrap::-webkit-scrollbar-thumb {
    background: var(--vela-border-strong, var(--vela-border));
    border-radius: 3px;
}
.vela-md-matrixwrap::-webkit-scrollbar-track { background: transparent; }
/* Only while there IS more table IN THE READING DIRECTION (set from JS after layout). */
.vela-md-matrixwrap[data-more] {
    mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
}
/* RTL: the table flows right-to-left, so the "there is more" fade (and the pinned
   label's shadow side) flip with it. Driven by data-dir, set at build time from
   isRtl() — no dependency on the :dir() selector's browser support. */
.vela-md-matrixwrap[data-dir='rtl'][data-more] {
    mask-image: linear-gradient(to left, #000 calc(100% - 26px), transparent);
    -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 26px), transparent);
}
.vela-md-matrix {
    display: grid;
    grid-template-columns:
        var(--vela-sx-label)
        repeat(var(--vela-md-cols, 4), minmax(var(--vela-sx-cell), 1fr))
        var(--vela-sx-all);
    gap: 2px;
    align-items: stretch;
    min-width: max-content;
}
/* A row is a wrapper with no box of its own — the grid still aligns every cell, but
   hovering a row can highlight the whole link at once. */
.vela-md-matrix-row { display: contents; }
/* The role carriers. A <button> cannot legally take role=gridcell (ARIA in HTML
   restricts a button's roles to button-ish ones), so the CELL is a pass-through span and
   the button lives inside it — the grid keeps valid cells, the control keeps its button
   role, and display:contents keeps the layout pixel-identical. */
.vela-md-matrixcell { display: contents; }
.vela-md-matrix-corner {
    position: sticky;
    inset-inline-start: 0;
    inset-inline-end: auto;
    z-index: 2;
    display: flex;
    align-items: center;
    padding: 0 8px 0 2px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--vela-fg-faint, var(--vela-fg-muted));
    background: var(--vela-surface-elev);
}
.vela-md-matrix-head {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 30px;
    padding: 0 2px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.2px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
/* Which groups this chart sits in, as colour dots — the emoji font may be missing, and a
   glyph that renders as a box would be worse than no glyph at all. */
.vela-md-matrix-dots { display: inline-flex; align-items: center; gap: 2px; }
.vela-md-matrix-dots i { display: block; width: 5px; height: 5px; border-radius: 50%; }
.vela-md-matrix-head:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-md-matrix-head[data-active] {
    color: var(--vela-fg-bright);
    background: var(--vela-hover);
    box-shadow: inset 0 -2px 0 var(--vela-accent, var(--vela-selected-bg));
}
.vela-md-matrix-head[data-focus] { box-shadow: inset 0 0 0 1px var(--vela-accent, var(--vela-selected-bg)); }
.vela-md-matrix-head:active { background: var(--vela-hover-strong); }
.vela-md-matrix-allhead { color: var(--vela-fg-faint); font-size: 9px; letter-spacing: 0.6px; }
.vela-md-matrix-label {
    position: sticky;
    left: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    padding-right: 6px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
    background: var(--vela-surface-elev);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 120ms ease;
}
.vela-md-matrix-row:hover .vela-md-matrix-label { color: var(--vela-fg-bright); }
/* A soft edge on the pinned column once the table is scrolled — the same language the
   sheet's own header uses. */
.vela-md-matrixwrap[data-scrolled] .vela-md-matrix-label,
.vela-md-matrixwrap[data-scrolled] .vela-md-matrix-corner {
    box-shadow: 10px 0 12px -12px rgb(0 0 0 / 90%);
}
.vela-md-matrix-chip {
    width: 100%;
    max-width: var(--vela-sx-cell-max, 64px);
    min-width: 0;
    justify-self: center;
    height: var(--vela-sx-cell);
    border-radius: 10px;
    font-size: 14px;
    color: color-mix(in srgb, var(--vela-fg-faint, var(--vela-fg-muted)) 78%, transparent);
}
/* A table that fills its column must not turn four charts into four billboards. */
.vela-md-matrix-chip[data-on='1'] { color: var(--vela-fg-bright); }
.vela-md-matrix-row:hover .vela-md-matrix-chip { border-color: color-mix(in srgb, var(--vela-fg-muted) 34%, transparent); }
.vela-md-matrix-row:hover .vela-md-matrix-chip:not([data-on]) {
    background: color-mix(in srgb, var(--vela-fg-muted) 8%, transparent);
}
.vela-md-matrix-chip:active { transform: scale(0.94); }
.vela-md-chip-all {
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.4px;
    color: var(--vela-fg-faint);
    border-color: transparent;
    background: transparent;
}
.vela-md-matrix-row:hover .vela-md-chip-all { border-color: var(--vela-border-strong, var(--vela-border)); color: var(--vela-fg-muted); }
.vela-md-chip-all[data-on='1'] {
    color: var(--vela-fg-bright);
    border-style: solid;
    border-color: color-mix(in srgb, var(--vela-md-mark, var(--vela-accent)) 55%, transparent);
}
/* Narrow tables tighten themselves instead of pushing the sheet sideways. */
@container (max-width: 340px) {
    .vela-md-matrix { --vela-sx-cell: 32px; --vela-sx-cell-max: 44px; --vela-sx-label: 68px; --vela-sx-all: 38px; }
    .vela-md-matrix-label { font-size: 11px; }
    .vela-md-chip-all { font-size: 8px; letter-spacing: 0.2px; }
}
@container (max-width: 300px) {
    .vela-md-matrix { --vela-sx-cell: 30px; --vela-sx-label: 60px; --vela-sx-all: 34px; }
    .vela-md-matrix-label { font-size: 10.5px; }
}
/* Visually hidden, but read: the matrix's live region (group changes). */
.vela-md-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
}
/* Touch LAST — the container queries above trade size for fit, and at 320px they shrink a
   chip to 30px. On a finger device the extra pixels win instead and the wrapper scrolls
   (it already does). WCAG 2.2 SC 2.5.8 asks for a 24×24 minimum; 38px sits between that
   and the 44px comfortable target without stealing a column's width. */
@media (pointer: coarse) {
    /* Touch: one thumb-sized cell. 44 px is Apple's HIG minimum and above Android's
       48 dp only by a hair — the AA floor (WCAG 2.5.8) is 24, so this is the generous
       reading, and it is what makes a 500 ms long press land on the chip rather than on
       its neighbour. */
    .vela-md-matrix { --vela-sx-cell: 44px; }
    .vela-md-chip { min-height: 40px; }
    .vela-md-chip { touch-action: manipulation; }
}
`;

export interface SyncMatrixChart {
    id: string;
    /** The SLOT number the user sees (1 = top-left, row-major). Never a symbol: a chart
     *  can change ticker while the table is open, and the header would then lie. */
    label: string;
    /** The ticker it is showing right now — tooltip and screen-reader text only. */
    symbol?: string;
    /** The chart the workspace is showing — its column header is tinted. */
    active?: boolean;
}

export interface SyncMatrixLink {
    id: string;
    label: string;
    /** The mark each chart wears for this link, by cell id. */
    marks?: Record<string, string>;
}

export interface SyncMatrixOptions {
    doc: Document;
    /** The element the picker menu portals into (theme + clipping provenance). */
    host?: HTMLElement;
    /** Which shell mounted it. Both may live in one document (phone sheet + desktop
     *  popover), so the element says which table it is — probes and tests scope by it. */
    shell?: 'phone' | 'desktop';
    /** Tapping a column header makes that chart active (the phone's shortcut). */
    onSelectChart?: (cellId: string) => void;
    /** Tapping a cell cycles that chart through this link's groups (TV's uncheck = leave). */
    onCycleCellGroup?: (kind: string, cellId: string) => void;
    /** Pick one group DIRECTLY. Tapping cycles, which is seven taps to reach the eighth
     *  group; right-click / long-press opens the whole palette instead. */
    onSetCellGroup?: (kind: string, cellId: string, mark: string | null) => void;
    /** The user's name for a group id — shown beside the mark in the picker's palette. */
    groupName?: (id: string) => string | undefined;
    /** Tapping the ALL cell drops every chart into one group for that link. */
    onAllInOneGroup?: (kind: string) => void;
    /** Re-read the owner's markup after a tap (switch rows, hero count, …). */
    onChange?: () => void;
}

/** One chip's worth of state: the mark (or nothing), its text, its hue. */
function paintChip(chip: HTMLElement, mark: string | undefined): void {
    const text = mark ?? '–';
    if (chip.textContent !== text) chip.textContent = text;
    if (mark) chip.dataset.on = '1';
    else delete chip.dataset.on;
    if (mark === IMPLICIT_GROUP) chip.dataset.implicit = '1';
    else delete chip.dataset.implicit;
    const color = groupMarkColor(mark);
    if (color) chip.style.setProperty('--vela-md-mark', color);
    else chip.style.removeProperty('--vela-md-mark');
}

export class SyncMatrix {
    /** The horizontal scroller — what the owner appends. */
    readonly el: HTMLElement;
    private readonly grid: HTMLElement;
    private readonly chips = new Map<string, HTMLButtonElement>();
    private readonly heads = new Map<string, HTMLButtonElement>();
    private readonly dots = new Map<string, HTMLElement>();
    private readonly allChips = new Map<string, HTMLButtonElement>();
    private sig = '';
    private ro: ResizeObserver | null = null;
    /** The direct-pick menu (built on first use — most sessions never ask for it). */
    private palette: Menu | null = null;
    /** What the caret/long-press is currently pointing at. */
    private pick: { kind: string; cellId: string; label: string; current?: string } | null = null;
    /** Disposers for this build's long-press gestures (one per chip). */
    private pressOffs: Array<() => void> = [];
    /** The mark each chip showed last paint — the diff drives the live-region message. */
    private readonly lastMark = new Map<string, string | undefined>();
    /** Polite screen-reader output for group changes (one line, replaced each time). */
    private live: HTMLElement | null = null;

    constructor(private readonly opts: SyncMatrixOptions) {
        const doc = opts.doc;
        injectStyles(STYLE_ID, SYNC_MATRIX_CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-md-matrixwrap';
        if (opts.shell) this.el.dataset.shell = opts.shell;
        // A layout GRID (APG grid pattern): a row of column headers, then one row per
        // link, one cell per chart. The CELLS are pass-through spans carrying
        // `role="gridcell"`; the controls stay real <button>s inside them, because ARIA in
        // HTML does not allow role="gridcell" on a button — overriding it would cost the
        // screen reader the "button" announcement entirely.
        this.el.setAttribute('role', 'grid');
        this.el.setAttribute('aria-label', 'Chart syncing — one row per link, one column per chart');
        this.grid = doc.createElement('div');
        this.grid.className = 'vela-md-matrix';
        this.el.append(this.grid);
        // A polite live region: a group change is a STATE change with no visual focus
        // move, so a screen reader gets one sentence per change ("Symbol · chart 2: 🟡").
        this.live = doc.createElement('span');
        this.live.className = 'vela-md-sr';
        this.live.setAttribute('aria-live', 'polite');
        this.live.setAttribute('aria-atomic', 'true');
        this.el.append(this.live);
        this.grid.addEventListener('scroll', this.onScroll, { passive: true } as EventListenerOptions);
        this.el.addEventListener('scroll', this.onScroll, { passive: true });
        this.el.addEventListener('keydown', this.onKey);
    }

    private readonly onScroll = (): void => {
        const atEnd = this.el.scrollLeft + this.el.clientWidth >= this.el.scrollWidth - 2;
        if (atEnd) delete this.el.dataset.more;
        else this.el.dataset.more = '1';
        // The pinned link column gets an edge only while the table is actually scrolled.
        if (this.el.scrollLeft > 2) this.el.dataset.scrolled = '1';
        else delete this.el.dataset.scrolled;
    };

    /**
     * Rebuild when the set of charts or links changed, then always repaint. Rebuilding on
     * every tap would throw away the scroll position — the one thing the user is fighting
     * with on a phone.
     */
    update(charts: readonly SyncMatrixChart[], links: readonly SyncMatrixLink[]): void {
        const sig = `${charts.map((c) => c.id).join(',')}|${links.map((l) => l.id).join(',')}`;
        if (sig !== this.sig) {
            this.build(charts, links);
            this.sig = sig;
        }
        this.paint(charts, links);
    }

    /**
     * Arrow navigation across the table: ←/→ walk a row, ↑/↓ walk a column, Home/End
     * jump to the row's ends. The table is one tab stop (roving tabindex), so a keyboard
     * user crosses ten charts without ten tab presses — the same contract a spreadsheet
     * grid has, and the reason `role="grid"` is on the scroller.
     */
    private readonly onKey = (e: KeyboardEvent): void => {
        const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vela-md-matrix-chip');
        if (!chip || !this.el.contains(chip)) return;
        const kinds = this.lastLinks.map((l) => l.id);
        const cells = this.lastCharts.map((c) => c.id);
        const kind = chip.dataset.kind ?? '';
        const cellId = chip.dataset.cell ?? '';
        const k = kinds.indexOf(kind);
        const c = cells.indexOf(cellId);
        if (k < 0 || c < 0) return;
        let nextK = k;
        let nextC = c;
        // In RTL the next cell is to the LEFT (the table flows right-to-left), so the
        // horizontal arrows trade places — the APG grid rule read in the page's own
        // direction. Home/End keep their LOGICAL meaning: first and last cell of the row.
        const rtl = isRtl(this.el);
        const next = rtl ? -1 : 1;
        if (e.key === 'ArrowRight') nextC = Math.min(cells.length - 1, Math.max(0, c + next));
        else if (e.key === 'ArrowLeft') nextC = Math.min(cells.length - 1, Math.max(0, c - next));
        else if (e.key === 'ArrowDown') nextK = Math.min(kinds.length - 1, k + 1);
        else if (e.key === 'ArrowUp') nextK = Math.max(0, k - 1);
        else if (e.key === 'Home') nextC = 0;
        else if (e.key === 'End') nextC = cells.length - 1;
        else return;
        e.preventDefault();
        this.focusCell(kinds[nextK]!, cells[nextC]!, chip.dataset.all === '1');
    };

    /** Move the roving focus (and the visible scroll) to one cell of the table. */
    private focusCell(kind: string, cellId: string, all = false): void {
        const chip = all ? this.allChips.get(kind) : this.chips.get(`${kind}\u0000${cellId}`);
        if (!chip) return;
        for (const el of this.el.querySelectorAll<HTMLElement>('.vela-md-matrix-chip')) el.tabIndex = -1;
        chip.tabIndex = 0;
        chip.focus({ preventScroll: true });
        try {
            chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        } catch {
            /* jsdom has no scroller */
        }
    }

    /**
     * The whole palette for one cell, anchored at the pointer. Two doors matter here:
     * picking a group outright (the cycle is seven taps deep by the eighth group), and
     * leaving the group the way TradingView words it ("uncheck the emoji").
     */
    private openPalette(kind: string, cellId: string, label: string, x: number, y: number): void {
        const doc = this.opts.doc;
        const link = this.lastLinks.find((l) => l.id === kind);
        const current = link?.marks?.[cellId];
        this.pick = { kind, cellId, label, ...(current ? { current } : {}) };
        const host = this.opts.host ?? doc.body;
        if (!this.palette) {
            this.palette = new Menu({
                host,
                items: [],
                placement: 'bottom-start',
                checkmarks: true,
                onSelect: (id) => this.runPick(id),
            });
        }
        this.palette.setItems(this.paletteItems());
        this.palette.openAt(x, y);
    }

    private paletteItems(): MenuItemDescriptor[] {
        const cur = this.pick?.current;
        const curId = cur ? (groupIdOf(cur) ?? cur) : undefined;
        // ONE mark per chart in this layout — a 1×1 offers one group, a 4×4 offers sixteen
        // — plus any group already in use, so a group assigned in a bigger layout stays
        // reachable after shrinking. The marks themselves can be repainted by the user,
        // which is why they are read from the registry rather than from the static list.
        const used = new Set<string>();
        for (const link of this.lastLinks) {
            for (const mark of Object.values(link.marks ?? {})) {
                const id = groupIdOf(mark);
                if (id) used.add(id);
            }
        }
        const groups = groupsForCount(Math.max(1, this.lastCharts.length), used);
        const items: MenuItemDescriptor[] = groups.map((def, i) => {
            const mark = groupMarkOf(def.id) ?? def.mark;
            const name = this.opts.groupName?.(def.id);
            return {
                id: `mark:${def.id}`,
                // The number is the stable half: a device without an emoji font still reads
                // "Group 4", and the glyph (palette or the user's own) rides along.
                label: name ? `Group ${i + 1} ${mark} · ${name}` : `Group ${i + 1} ${mark}`,
                ...(def.id === curId ? { checked: true } : {}),
            };
        });
        items.push({ id: 'none', label: 'No group — leave it', separatorBefore: true, ...(cur ? {} : { checked: true }) });
        return items;
    }

    /** One sentence to the live region (polite: it waits for the current utterance). */
    private announce(text: string): void {
        if (this.live) this.live.textContent = text;
    }

    private runPick(id: string): void {
        const pick = this.pick;
        if (!pick) return;
        if (id === 'none') this.opts.onSetCellGroup?.(pick.kind, pick.cellId, null);
        else if (id.startsWith('mark:')) this.opts.onSetCellGroup?.(pick.kind, pick.cellId, id.slice('mark:'.length));
        this.opts.onChange?.();
    }

    /** Bring one chart's column into view (used when the sheet opens on a chart). */
    focus(cellId: string): void {
        const head = this.heads.get(cellId);
        if (!head) return;
        for (const h of this.heads.values()) h.removeAttribute('data-focus');
        head.setAttribute('data-focus', '');
        const view = this.opts.doc.defaultView;
        view?.requestAnimationFrame(() => {
            try {
                head.scrollIntoView?.({ block: 'nearest', inline: 'center' });
            } catch {
                /* jsdom has no scroller */
            }
        });
    }

    private build(charts: readonly SyncMatrixChart[], links: readonly SyncMatrixLink[]): void {
        const doc = this.opts.doc;
        for (const off of this.pressOffs) off();
        this.pressOffs = [];
        this.grid.replaceChildren();
        this.chips.clear();
        this.heads.clear();
        this.dots.clear();
        this.allChips.clear();
        this.grid.style.setProperty('--vela-md-cols', String(Math.max(1, charts.length)));

        const headRow = doc.createElement('span');
        headRow.className = 'vela-md-matrix-row';
        headRow.setAttribute('role', 'row');
        const corner = doc.createElement('span');
        corner.className = 'vela-md-matrix-corner';
        corner.setAttribute('role', 'columnheader');
        corner.textContent = 'Link';
        headRow.append(corner);
        this.grid.append(headRow);

        for (const c of charts) {
            const head = doc.createElement('button');
            head.type = 'button';
            head.className = 'vela-md-matrix-head';
            head.dataset.cell = c.id;
            head.textContent = c.label;
            const dots = doc.createElement('span');
            dots.className = 'vela-md-matrix-dots';
            head.append(dots);
            this.dots.set(c.id, dots);
            const what = `Chart ${c.label}${c.symbol ? ` — ${c.symbol}` : ''}${c.active ? ' (active)' : ''}`;
            head.title = what;
            head.setAttribute('aria-label', `${what} — its group for each link`);
            head.addEventListener('click', () => {
                this.opts.onSelectChart?.(c.id);
                this.opts.onChange?.();
            });
            const headCell = doc.createElement('span');
            headCell.className = 'vela-md-matrixcell';
            headCell.setAttribute('role', 'columnheader');
            headCell.append(head);
            headRow.append(headCell);
            this.heads.set(c.id, head);
        }
        if (this.opts.onAllInOneGroup) {
            const allHead = doc.createElement('span');
            allHead.className = 'vela-md-matrix-head vela-md-matrix-allhead';
            allHead.setAttribute('role', 'columnheader');
            allHead.textContent = 'ALL';
            headRow.append(allHead);
        }

        for (const link of links) {
            const row = doc.createElement('div');
            row.className = 'vela-md-matrix-row';
            row.setAttribute('role', 'row');
            const label = doc.createElement('span');
            label.className = 'vela-md-matrix-label';
            label.setAttribute('role', 'rowheader');
            label.textContent = link.label;
            row.append(label);
            for (const c of charts) {
                const chip = doc.createElement('button');
                chip.type = 'button';
                chip.className = 'vela-md-chip vela-md-matrix-chip';
                chip.dataset.kind = link.id;
                chip.dataset.cell = c.id;
                chip.title = `${link.label} · chart ${c.label} — click to cycle, right-click for all groups`;
                chip.setAttribute('aria-haspopup', 'menu'); // right-click / long-press opens the palette
                chip.addEventListener('click', () => {
                    this.opts.onCycleCellGroup?.(link.id, c.id);
                    this.opts.onChange?.();
                });
                // Direct pick: a right-click (or a long press on touch) offers the whole
                // palette at once. Cycling stays the fast path for "next group please".
                chip.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.openPalette(link.id, c.id, link.label, e.clientX, e.clientY);
                });
                chip.tabIndex = -1; // roving: the table is ONE tab stop (see onKey)
                // Long press = the direct group palette. The gesture module owns the
                // platform numbers (500 ms, 10 px slop) and swallows the click that ends
                // a fired press, so a hold can never ALSO cycle the group — the conflict
                // a 38 px cell makes easy to hit.
                this.pressOffs.push(
                    attachLongPress(chip, {
                        onFire: (down) => this.openPalette(link.id, c.id, link.label, down.clientX, down.clientY),
                    }),
                );
                const cell = doc.createElement('span');
                cell.className = 'vela-md-matrixcell';
                cell.setAttribute('role', 'gridcell');
                cell.append(chip);
                row.append(cell);
                this.chips.set(`${link.id}\u0000${c.id}`, chip);
            }
            if (this.opts.onAllInOneGroup) {
                const allCell = doc.createElement('span');
                allCell.className = 'vela-md-matrixcell';
                allCell.setAttribute('role', 'gridcell');
                const all = doc.createElement('button');
                all.type = 'button';
                all.className = 'vela-md-chip vela-md-matrix-chip vela-md-chip-all';
                all.dataset.all = '1';
                all.dataset.kind = link.id;
                all.textContent = 'ALL';
                all.setAttribute('aria-label', `Put every chart in one ${link.label} group`);
                all.addEventListener('click', () => {
                    this.opts.onAllInOneGroup?.(link.id);
                    this.opts.onChange?.();
                });
                allCell.append(all);
                row.append(allCell);
                this.allChips.set(link.id, all);
            }
            this.grid.append(row);
        }
        // One tab stop for the whole table, seeded on its first cell: a keyboard user
        // tabs INTO the grid and then walks it with the arrow keys.
        const first = this.chips.values().next().value as HTMLButtonElement | undefined;
        if (first) first.tabIndex = 0;
        this.measure();
    }

    private lastLinks: readonly SyncMatrixLink[] = [];
    private lastCharts: readonly SyncMatrixChart[] = [];

    private paint(charts: readonly SyncMatrixChart[], links: readonly SyncMatrixLink[]): void {
        this.lastLinks = links;
        this.lastCharts = charts;
        // The table follows the DOCUMENT's reading direction: under `dir="rtl"` the
        // columns flow right-to-left, the "more to the right" fade moves to the left and
        // the arrow keys trade places. Read HERE, not at build time: a sheet is built
        // before it is inserted, and a detached node has no computed direction yet.
        this.el.dataset.dir = isRtl(this.el) ? 'rtl' : 'ltr';
        // Grid dimensions for AT: the header row + one row per link; the label column,
        // one column per chart, and the ALL column when the host offers it.
        this.el.setAttribute('aria-rowcount', String(links.length + 1));
        this.el.setAttribute('aria-colcount', String(charts.length + 1 + (this.opts.onAllInOneGroup ? 1 : 0)));
        for (const c of charts) {
            const head = this.heads.get(c.id);
            if (!head) continue;
            head.toggleAttribute('data-active', Boolean(c.active));
            // The ticker is LIVE: the chart can switch market while the table is open,
            // and a tooltip that still names the old one is worse than no tooltip.
            const what = `Chart ${c.label}${c.symbol ? ` — ${c.symbol}` : ''}${c.active ? ' (active)' : ''}`;
            if (head.title !== what) head.title = what;
            const aria = `${what} — its group for each link`;
            if (head.getAttribute('aria-label') !== aria) head.setAttribute('aria-label', aria);
            const marks: string[] = [];
            for (const l of links) {
                const m = l.marks?.[c.id];
                if (m && !marks.includes(m)) marks.push(m);
            }
            // At most two dots — a 38-44px header must not widen its own column.
            const dots = this.dots.get(c.id);
            if (dots) {
                const shown = marks.slice(0, 2);
                if (dots.childElementCount !== shown.length) {
                    dots.replaceChildren(...shown.map(() => this.opts.doc.createElement('i')));
                }
                for (const [i, mark] of shown.entries()) {
                    const dotEl = dots.children[i] as HTMLElement | undefined;
                    if (!dotEl) continue;
                    const hue = groupMarkColor(mark) ?? 'var(--vela-accent, var(--vela-selected-bg))';
                    if (dotEl.style.background !== hue) dotEl.style.background = hue;
                    dotEl.title = mark;
                }
            }
            // `data-marks` stays: it is the honest text of the same fact (tests, probes and
            // screen readers read it), even though the header now PAINTS dots instead.
            if (marks.length) head.dataset.marks = marks.slice(0, 2).join('');
            else delete head.dataset.marks;
            head.toggleAttribute('data-linked', marks.length > 0);
        }
        for (const link of links) {
            for (const c of charts) {
                const chip = this.chips.get(`${link.id}\u0000${c.id}`);
                if (!chip) continue;
                const mark = link.marks?.[c.id];
                paintChip(chip, mark);
                chip.setAttribute('aria-label', `${link.label} for chart ${c.label}: ${mark ?? 'not linked'}`);
                // No aria-pressed: this is a cyclying choice, not an on/off switch, and
                // the current value is already spelled out in the label above. `data-on`
                // still drives the paint.
                // Diff instead of re-reading: only a REAL change is announced, and only
                // after the first paint (which is the table arriving, not an edit).
                const key = `${link.id}\u0000${c.id}`;
                if (this.lastMark.has(key) && this.lastMark.get(key) !== mark) {
                    this.announce(`${link.label} · chart ${c.label}: ${mark ?? 'no group'}`);
                }
                this.lastMark.set(key, mark);
            }
            const all = this.allChips.get(link.id);
            if (all) {
                // The ALL cell lights up only when every chart genuinely shares a group.
                const marks = charts.map((c) => link.marks?.[c.id]).filter((m): m is string => Boolean(m));
                const one = marks.length === charts.length && new Set(marks).size === 1;
                if (one) all.dataset.on = '1';
                else delete all.dataset.on;
                const hue = one ? groupMarkColor(marks[0]) : null;
                if (hue) all.style.setProperty('--vela-md-mark', hue);
                else all.style.removeProperty('--vela-md-mark');
            }
        }
        this.measure();
    }

    /** The fade exists only when the table really overflows (never a lie at four charts). */
    private measure(): void {
        const run = (): void => {
            if (this.el.scrollWidth > this.el.clientWidth + 1) this.el.dataset.more = '1';
            else delete this.el.dataset.more;
        };
        this.opts.doc.defaultView?.requestAnimationFrame(run);
        const RO = (this.opts.doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
        if (RO && this.el.isConnected && !this.ro) {
            this.ro = new RO(run);
            this.ro.observe(this.el);
        }
    }

    destroy(): void {
        for (const off of this.pressOffs) off();
        this.pressOffs = [];
        this.ro?.disconnect();
        this.ro = null;
        this.palette?.destroy();
        this.palette = null;
    }
}
