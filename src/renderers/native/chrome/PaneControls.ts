import { icon } from '../../../core/icons';
import type { VelaTheme } from '../../../core/options';

/** A pane as seen by the hover controls (a thin projection of the renderer's PaneNode). */
export interface PaneControlView {
    id: string;
    kind: 'price' | 'study';
    collapsed: boolean;
    maximized: boolean;
    top: number;
    height: number;
    /** Position among panes (0 = topmost) + total, to gate move-up/down. */
    index: number;
    count: number;
}

export interface PaneControlsDeps {
    panes(): PaneControlView[];
    /** Right-gutter width in px — the cluster pins just left of the axis columns. */
    rightAxis(): number;
    onMove(paneId: string, dir: 'up' | 'down'): void;
    onToggleCollapse(paneId: string): void;
    onToggleMaximize(paneId: string): void;
}

const ICONS = {
    up: icon('chevron-up'),
    down: icon('chevron-down'),
    collapse: icon('pane-collapse'),
    expand: icon('pane-expand'),
    maximize: icon('maximize'),
    restore: icon('restore'),
};

const STYLE_ID = 'vela-pane-controls';

/** The cluster's glyph size. Icons inherit it from the slot, so it is set once in CSS. */
const ICON_PX = 12;

/** Room the cluster needs before it may stand on a pane, measured — never a mode switch
 *  (R59's rule, R84's second visit): the data area must be at least this wide or the pill
 *  would sit on the candles it controls, and the pane at least this tall. */
const MIN_DATA_W = 150;
/** On a touch screen there is no hover to reveal anything, so the cluster stays up for
 *  as long as the pane can host it — and only then. Short study panes keep the object
 *  tree (every pane verb lives there) and lose the chips, exactly as asked. */
const TOUCH_MIN_PANE_H = 64;
/** Touch: the chips sit BELOW the legend line the pane opens with, so a phone never
 *  loses a symbol/indicator title to a button that floated over it. */
const TOUCH_TOP = 32;
/** …and on the pane at the plot's TOP, below the status line's chip (two rows tall on a
 *  phone) rather than below a single legend line. */
const TOUCH_TOP_TOP = 46;

/** The cluster's scrim pill. It floats over CHART CONTENT (candles of any color), not over a
 *  panel, so it stays a neutral darkening rather than a themed surface. */
const CLUSTER_PILL = 'rgba(0,0,0,0.65)';

/** Hover/active states as CSS, so they can never lag behind a pointer or drift from the
 *  tokens (the buttons only carry their per-instance color/opacity inline). */
function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.vela-pc-btn{display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;line-height:0;font-size:${ICON_PX}px;color:var(--vela-fg-muted);}
.vela-pc-btn svg{display:block;}
.vela-pc-btn:not(:disabled):hover{opacity:1 !important;background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-pc-on,.vela-pc-on:not(:disabled):hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
`;
    document.head.appendChild(st);
}

/**
 * Per-pane hover button cluster, pinned to the top-right of each pane's data area (just
 * left of the axis columns). Shown while the cursor is inside that pane; a collapsed pane
 * additionally keeps a standalone expand chip visible so it can always be re-expanded. Study panes
 * get move-up / move-down / collapse / maximize / remove; the price pane gets maximize only.
 * A DOM overlay in the plot, matching the settings-button + legend pattern.
 */
export class PaneControls {
    private readonly root: HTMLDivElement;
    private readonly clusters = new Map<string, HTMLDivElement>();
    private hoverPaneId: string | null = null;
    /** Touch screen (the phone shell): there is no hover, so a pane's cluster is shown
     *  outright — for as long as the pane measures enough room for it. */
    private touchMode = false;

    constructor(private readonly plot: HTMLElement, private theme: VelaTheme, private readonly deps: PaneControlsDeps) {
        ensureStyles();
        this.root = document.createElement('div');
        Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '6' });
        this.plot.appendChild(this.root);
        // Track hover on the PLOT (not the data canvas) so moving the cursor onto a cluster —
        // a plot child that sits above the canvas — keeps its own pane's cluster revealed,
        // instead of the canvas's pointerleave hiding it before it can be clicked.
        this.plot.addEventListener('pointermove', this.onPlotMove);
        this.plot.addEventListener('pointerleave', this.onPlotLeave);
        this.refresh();
    }

    /** Reveal the cluster for the pane under the cursor, resolved from the pointer's y in the plot. */
    private readonly onPlotMove = (e: PointerEvent): void => {
        if (this.touchMode) return; // no cursor to follow; the touch rule already stands
        const rect = this.plot.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let hit: string | null = null;
        for (const p of this.deps.panes()) {
            if (y >= p.top && y <= p.top + p.height) { hit = p.id; break; }
        }
        this.setHoverPane(hit);
    };

    private readonly onPlotLeave = (): void => this.setHoverPane(null);

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.refresh();
    }

    /** Rebuild the clusters (pane set / kind / collapse-maximize state changed). */
    refresh(): void {
        const panes = this.deps.panes();
        const seen = new Set<string>();
        for (const p of panes) {
            seen.add(p.id);
            let cluster = this.clusters.get(p.id);
            if (!cluster) {
                cluster = document.createElement('div');
                Object.assign(cluster.style, {
                    position: 'absolute',
                    display: 'flex',
                    gap: '2px',
                    padding: '2px',
                    borderRadius: 'var(--vela-radius-md)',
                    background: CLUSTER_PILL,
                    pointerEvents: 'auto',
                });
                this.root.appendChild(cluster);
                this.clusters.set(p.id, cluster);
            }
            this.buildButtons(cluster, p);
        }
        for (const [id, cluster] of this.clusters) {
            if (!seen.has(id)) { cluster.remove(); this.clusters.delete(id); }
        }
        this.reposition();
    }

    private buildButtons(cluster: HTMLDivElement, p: PaneControlView): void {
        cluster.textContent = '';
        if (p.kind === 'study') {
            cluster.appendChild(this.button(ICONS.up, 'Move pane up', p.index <= 1, () => this.deps.onMove(p.id, 'up'), { role: 'up' }));
            cluster.appendChild(this.button(ICONS.down, 'Move pane down', p.index >= p.count - 1, () => this.deps.onMove(p.id, 'down'), { role: 'down' }));
            cluster.appendChild(
                this.button(p.collapsed ? ICONS.expand : ICONS.collapse, p.collapsed ? 'Expand pane' : 'Collapse pane', false, () => this.deps.onToggleCollapse(p.id), {
                    role: 'collapse',
                    // A collapsed pane keeps its expand button permanently visible; the "selected"
                    // white-on-black chip makes it read as an active state the user can always click.
                    selected: p.collapsed,
                }),
            );
        }
        // Maximize only makes sense when there's more than one pane to trade space between —
        // a lone price pane can't be "expanded", so it gets no button (and thus no cluster).
        if (p.count > 1) {
            cluster.appendChild(
                this.button(p.maximized ? ICONS.restore : ICONS.maximize, p.maximized ? 'Restore pane' : 'Maximize pane', false, () => this.deps.onToggleMaximize(p.id), {
                    role: 'maximize',
                    // Same inverse-chip treatment as the collapsed pane's expand toggle: the
                    // maximized state must read as an active state, not just a swapped glyph.
                    selected: p.maximized,
                }),
            );
        }
    }

    private button(
        svg: string,
        title: string,
        disabled: boolean,
        onClick: () => void,
        opts: { role: 'up' | 'down' | 'collapse' | 'maximize'; selected?: boolean },
    ): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = title;
        b.innerHTML = svg;
        b.disabled = disabled;
        b.dataset.role = opts.role;
        const selected = opts.selected === true;
        // Selected (e.g. the expand toggle of a collapsed pane) is an inverse chip, fully
        // opaque — it must read on its own, without the cluster's dark pill behind it.
        // Ink lives in the stylesheet (muted at rest, bright on hover, inverse when selected);
        // only the disabled fade stays inline.
        b.className = selected ? 'vela-pc-btn vela-pc-on' : 'vela-pc-btn';
        Object.assign(b.style, {
            cursor: disabled ? 'default' : 'pointer',
            // 24px — the WCAG 2.5.8 floor; the glyph inside keeps its 14px scale.
            width: '24px',
            height: '24px',
            opacity: disabled ? '0.3' : '1',
        });
        if (!disabled) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    }

    /** Reposition each cluster to the top-right of its pane's data area. */
    reposition(): void {
        const rightPx = this.deps.rightAxis() + 6;
        const byId = new Map(this.deps.panes().map((p) => [p.id, p]));
        const dataW = Math.max(0, (this.plot.clientWidth || this.plot.getBoundingClientRect().width) - this.deps.rightAxis());
        // Measured room, the same rule everywhere: enough data width that the pill does not
        // stand on the plot it controls, and enough pane height to host a row of 24px chips.
        const hasRoom = dataW >= MIN_DATA_W;
        for (const [id, cluster] of this.clusters) {
            const p = byId.get(id);
            if (!p) { cluster.style.display = 'none'; continue; }
            const hovered = id === this.hoverPaneId;
            // An empty cluster (e.g. a lone price pane with no maximize) never shows.
            const hasButtons = cluster.children.length > 0;
            // STATE chips stay visible without hover: a collapsed pane's expand chip (always —
            // it is the only way back up, on every device) and a MAXIMIZED pane's restore chip,
            // so the isolation state reads at a glance instead of only under the cursor.
            const stateChipRole = p.collapsed ? 'collapse' : p.maximized ? 'maximize' : null;
            // Touch reveals nothing by hover, so a pane that MEASURES enough room shows its
            // cluster outright. A cramped one keeps none of it — its verbs are all in the
            // object tree (move up/down, collapse, maximize), which is the promised fallback.
            // The pane at the plot's top carries the status line's chip (two rows on a
            // phone); its own chips drop below that chip instead of fighting it for the
            // same pixels. Every other pane only owes room to its legend line.
            const topPad = this.touchMode ? (p.top <= 2 ? TOUCH_TOP_TOP : TOUCH_TOP) : 4;
            const room = hasRoom && p.height >= (this.touchMode ? topPad + 34 : 8);
            const visible = hasButtons && room && (hovered || stateChipRole != null || this.touchMode);
            cluster.style.right = `${rightPx}px`;
            // Center the cluster inside the collapsed strip (28 = 24px button + 2px cluster padding each side).
            cluster.style.top = p.collapsed
                ? `${p.top + Math.max(1, Math.round((p.height - 28) / 2))}px`
                : `${p.top + topPad}px`;
            cluster.style.display = visible ? 'flex' : 'none';
            if (!visible) continue;
            // Without hover only the state chip shows, standalone: drop the dark pill so the white
            // chip reads on its own. Its siblings stay laid out (visibility:hidden, not display:none)
            // so the chip keeps the exact slot it occupies once the full cluster reveals on hover.
            const soloChip = stateChipRole != null && !hovered && !this.touchMode;
            cluster.style.background = soloChip ? 'transparent' : CLUSTER_PILL;
            for (const child of cluster.children) {
                const btn = child as HTMLElement;
                btn.style.display = 'inline-flex';
                btn.style.visibility = soloChip && btn.dataset.role !== stateChipRole ? 'hidden' : 'visible';
            }
        }
    }

    /** Show the cluster for the pane the cursor is in (null hides all). */
    setHoverPane(paneId: string | null): void {
        if (this.hoverPaneId === paneId) return;
        this.hoverPaneId = paneId;
        this.reposition();
    }

    /**
     * Touch screens (the phone shell): with no cursor to reveal a cluster, every pane that
     * measures room for one keeps its chips up permanently — the same buttons desktop gets
     * on hover, never a stripped-down phone subset. A pane too small to host them shows
     * nothing and is driven from the object tree instead (see {@link reposition}).
     */
    setTouchMode(on: boolean): void {
        if (on === this.touchMode) return;
        this.touchMode = on;
        if (on) this.hoverPaneId = null;
        this.reposition();
    }

    destroy(): void {
        this.plot.removeEventListener('pointermove', this.onPlotMove);
        this.plot.removeEventListener('pointerleave', this.onPlotLeave);
        this.root.remove();
        this.clusters.clear();
    }
}
