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
import { IMPLICIT_GROUP } from '../state/document';
import { groupMarkColor } from '../workspace/sync-marks';

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
    --vela-sx-cell: 34px;
    --vela-sx-cell-max: 64px;
    --vela-sx-label: 78px;
    --vela-sx-all: 44px;
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
/* Only while there IS more table to the right (set from JS after layout). */
.vela-md-matrixwrap[data-more] {
    mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
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
.vela-md-matrix-corner {
    position: sticky;
    left: 0;
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
    /** Which shell mounted it. Both may live in one document (phone sheet + desktop
     *  popover), so the element says which table it is — probes and tests scope by it. */
    shell?: 'phone' | 'desktop';
    /** Tapping a column header makes that chart active (the phone's shortcut). */
    onSelectChart?: (cellId: string) => void;
    /** Tapping a cell cycles that chart through this link's groups (TV's uncheck = leave). */
    onCycleCellGroup?: (kind: string, cellId: string) => void;
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

    constructor(private readonly opts: SyncMatrixOptions) {
        const doc = opts.doc;
        injectStyles(STYLE_ID, SYNC_MATRIX_CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-md-matrixwrap';
        if (opts.shell) this.el.dataset.shell = opts.shell;
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Chart syncing — one row per link, one column per chart');
        this.grid = doc.createElement('div');
        this.grid.className = 'vela-md-matrix';
        this.el.append(this.grid);
        this.grid.addEventListener('scroll', this.onScroll, { passive: true } as EventListenerOptions);
        this.el.addEventListener('scroll', this.onScroll, { passive: true });
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
        this.grid.replaceChildren();
        this.chips.clear();
        this.heads.clear();
        this.dots.clear();
        this.allChips.clear();
        this.grid.style.setProperty('--vela-md-cols', String(Math.max(1, charts.length)));

        const corner = doc.createElement('span');
        corner.className = 'vela-md-matrix-corner';
        corner.textContent = 'Link';
        this.grid.append(corner);

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
            this.grid.append(head);
            this.heads.set(c.id, head);
        }
        if (this.opts.onAllInOneGroup) {
            const allHead = doc.createElement('span');
            allHead.className = 'vela-md-matrix-head vela-md-matrix-allhead';
            allHead.textContent = 'ALL';
            this.grid.append(allHead);
        }

        for (const link of links) {
            const row = doc.createElement('div');
            row.className = 'vela-md-matrix-row';
            const label = doc.createElement('span');
            label.className = 'vela-md-matrix-label';
            label.textContent = link.label;
            row.append(label);
            for (const c of charts) {
                const chip = doc.createElement('button');
                chip.type = 'button';
                chip.className = 'vela-md-chip vela-md-matrix-chip';
                chip.dataset.kind = link.id;
                chip.dataset.cell = c.id;
                chip.addEventListener('click', () => {
                    this.opts.onCycleCellGroup?.(link.id, c.id);
                    this.opts.onChange?.();
                });
                row.append(chip);
                this.chips.set(`${link.id}\u0000${c.id}`, chip);
            }
            if (this.opts.onAllInOneGroup) {
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
                row.append(all);
                this.allChips.set(link.id, all);
            }
            this.grid.append(row);
        }
        this.measure();
    }

    private paint(charts: readonly SyncMatrixChart[], links: readonly SyncMatrixLink[]): void {
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
        this.ro?.disconnect();
        this.ro = null;
    }
}
