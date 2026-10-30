// The PANEL DOCK — the one owner of the shell's side-panel column. It holds the shell's own
// panels (object tree, data window) and every contributed one (`registerSidePanel`) as equal
// entries, keeps one side column while permitting multiple desktop floating panels,
// projects their toggles into the chrome, and persists their modes and geometry.
//
// Both shells drive the same dock, so the exclusivity rule and the button wiring exist ONCE.
// The chrome is reached through {@link PanelChrome} (the topbar implements it structurally) —
// the dock never imports the topbar, and a different chrome can host the same buttons.
import type { Vela } from '../Vela';
import type { FloatingPanelPosition, PanelsState } from '../state/document';
import type { LayoutMode } from './layout-mode';
import { DEFAULT_PANEL_ORDER, sidePanels, type SidePanelButton, type SidePanelDescriptor, type SidePanelHandle, type SidePanelHeader, type WidgetContext } from './contributions';
import { SidePanel, DEFAULT_PANEL_HEIGHT, clampPanelHeight, clampPanelTop } from './side-panel';

/** What the dock needs from whatever chrome shows its toggles. */
export interface PanelChrome {
    /** Replace the panel toggle group (dock order). `onClick` receives the panel id. */
    setPanelButtons(buttons: readonly SidePanelButton[], onClick: (id: string) => void): void;
    /** Reflect one panel's open state on its button. */
    setPanelActive(id: string, open: boolean): void;
}

export interface PanelDockDeps {
    chrome: PanelChrome;
    /** Live widget context, handed to contributed panels' `mount`. */
    context(): WidgetContext;
    /** The dock's persistable state changed (open panel, or a width). */
    changed?(): void;
}

/** A panel the SHELL owns and destroys — the dock only docks it. */
export interface BuiltInPanel {
    id: string;
    title: string;
    icon: string;
    order: number;
    panel: SidePanel;
    /** False when another dedicated chrome slot already opens this panel. */
    showInChrome?: boolean;
    /** Rebind hook, called by {@link PanelDock.onChart}. */
    onChart?(chart: Vela): void;
}

interface Entry {
    id: string;
    title: string;
    icon: string;
    order: number;
    panel: SidePanel;
    showInChrome?: boolean;
    onChart?: (chart: Vela) => void;
    /** Contributed entries are created (and destroyed) by the dock; built-ins by the shell. */
    contributed: boolean;
    handle?: SidePanelHandle;
    /** The descriptor a contributed entry was built from — a refresh keeps the entry while it is still registered. */
    desc?: SidePanelDescriptor;
}

export class PanelDock {
    private readonly entries: Entry[] = [];
    /** Widths the USER settled, by panel id — the only ones worth persisting. */
    private readonly widths = new Map<string, number>();
    /** Mobile geometry and desktop heights the user settled, by panel id. */
    private readonly tops = new Map<string, number>();
    private readonly heights = new Map<string, number>();
    private readonly desktopHeights = new Map<string, number>();
    /** Floating panels the USER pinned as columns, by id — remembered for late registrations too. */
    private pinned = new Set<string>();
    /** Desktop floating modes and positions survive close/reopen and late registration. */
    private floating = new Set<string>();
    private readonly floatPositions = new Map<string, FloatingPanelPosition>();
    /** Floating cards hidden while phone chrome presents one bottom-attached pane. */
    private readonly suspendedFloating = new Set<string>();
    private readonly pendingFloatingOpen = new Set<string>();
    private layout: LayoutMode;
    private automatic = false;
    private applying = false;
    private frontId: string | null = null;
    /** A restored `open` naming a panel that has not registered yet: honored when it docks. */
    private pendingOpen: string | null = null;
    private chart: Vela | null = null;

    constructor(
        private readonly host: HTMLElement,
        private readonly deps: PanelDockDeps,
    ) {
        this.layout = host.closest?.('[data-layout]')?.getAttribute('data-layout') === 'mobile' ? 'mobile' : 'desktop';
    }

    /** Dock a panel the shell owns (created and destroyed by it). */
    addBuiltIn(entry: BuiltInPanel): void {
        this.add({ ...entry, contributed: false });
    }

    /**
     * (Re)build the CONTRIBUTED panels from the registry — call once after the built-ins, and
     * again on `refreshActions()` so a late registration appears. Contributed panels that are
     * gone from the registry are dropped and a REPLACED descriptor is rebuilt; a panel whose
     * descriptor is unchanged stays mounted as it is, so its content and state survive.
     */
    refresh(): void {
        // A rebuild must not close the column under the user: a contributed panel that is open
        // (and still registered) is reopened once its replacement is docked.
        const openBefore = this.entries.filter((entry) => entry.panel.open).map((entry) => entry.id);
        const registered = sidePanels();
        for (const entry of [...this.entries]) if (entry.contributed && !registered.includes(entry.desc!)) this.drop(entry);
        for (const desc of registered) {
            if (this.entries.some((e) => e.desc === desc)) continue;
            const panel = new SidePanel(this.host, desc.title, `vela-panel-${desc.id}`, {
                width: desc.width,
                resizable: desc.resizable,
                minWidth: desc.minWidth,
                maxWidth: desc.maxWidth,
                overlay: desc.overlay,
                // R86 T10: every docked panel gets the same maximize affordance unless a
                // contribution explicitly opts out. SidePanel also supplies the
                // bottom-attached phone pane and fullscreen/restore control.
                maximizable: desc.maximizable ?? true,
            });
            const entry: Entry = {
                id: desc.id,
                title: desc.title,
                icon: desc.icon,
                order: desc.order ?? DEFAULT_PANEL_ORDER,
                panel,
                contributed: true,
                desc,
            };
            // A contribution that throws on mount must not take the shell down with it: the
            // panel stays docked but empty, and the reason is on the console.
            try {
                const header: SidePanelHeader = {
                    slot: panel.headerSlot,
                    setTitle: (t) => panel.setTitle(t),
                    get maximized() {
                        return panel.maximized;
                    },
                    setMaximized: (on) => panel.setMaximized(on),
                };
                entry.handle = desc.mount(this.deps.context(), panel.content, header) ?? undefined;
                if (this.chart) entry.handle?.onChart?.(this.chart);
            } catch (err) {
                console.warn(`[vela] side panel "${desc.id}" failed to mount`, err);
            }
            this.add(entry);
        }
        // A replaced contribution gets its same open window back; unchanged panels keep
        // their single mounted body and every other floating window remains untouched.
        for (const id of openBefore) {
            const entry = this.entries.find((candidate) => candidate.id === id);
            if (entry && !entry.panel.open) entry.panel.toggle(true, true);
        }
        this.publish();
    }

    /** Bind (or rebind) every docked panel to a chart instance. */
    onChart(chart: Vela): void {
        this.chart = chart;
        for (const entry of this.entries) {
            if (entry.onChart) entry.onChart(chart);
            entry.handle?.onChart?.(chart);
        }
    }

    /** Open/close one panel by id — a bare call flips it. Unknown ids are ignored. */
    toggle(id: string, open?: boolean): void {
        this.entries.find((e) => e.id === id)?.panel.toggle(open);
    }

    /** Phone chrome stays a single pane; suspended desktop cards return on rotation. */
    setLayout(layout: LayoutMode): void {
        if (layout === this.layout) return;
        // Fullscreen is a presentation of the current chrome, not saved geometry.
        // Restore before a rotation so a phone-only toggle cannot disappear while active.
        for (const entry of this.entries) if (entry.panel.maximized) entry.panel.setMaximized(false);
        this.layout = layout;
        if (layout === 'mobile') {
            const open = this.entries.filter((entry) => entry.panel.open);
            const keep = open.find((entry) => !entry.panel.floating)
                ?? open.find((entry) => entry.id === this.frontId) ?? open[0];
            this.automatic = true;
            try {
                for (const entry of open) {
                    if (entry === keep) continue;
                    if (entry.panel.floating) this.suspendedFloating.add(entry.id);
                    entry.panel.toggle(false, true);
                }
            } finally { this.automatic = false; }
        } else {
            const resume = [...this.suspendedFloating];
            this.suspendedFloating.clear();
            this.automatic = true;
            try {
                for (const id of resume) {
                    const entry = this.entries.find((candidate) => candidate.id === id);
                    if (entry) entry.panel.toggle(true, true);
                    else this.pendingFloatingOpen.add(id);
                }
            } finally { this.automatic = false; }
            // On return the visible dock stays actionable even if a card overlaps it.
            const docked = this.entries.find((entry) => entry.panel.open && !entry.panel.floating);
            if (docked) this.raise(docked);
        }
    }

    /** The occupied side column, excluding independent floating cards. */
    get dockedId(): string | null {
        return this.entries.find((e) => e.panel.open && !e.panel.floating)?.id ?? null;
    }

    /** Prefer the side dock; fall back to any open card for legacy callers. */
    get openId(): string | null {
        return this.dockedId ?? this.entries.find((e) => e.panel.open)?.id ?? null;
    }

    /** The docked panels in dock order — what a non-topbar chrome (the mobile
     *  three-dots drawer) lists so every panel stays reachable there too. */
    list(): ReadonlyArray<SidePanelButton> {
        return this.entries.filter((e) => e.showInChrome !== false).map((e) => ({ id: e.id, title: e.title, icon: e.icon }));
    }

    /** The dock's persistable state, or null when there is nothing worth saving. */
    getState(): PanelsState | null {
        const out: PanelsState = {};
        const open = this.openId;
        if (open) out.open = open;
        if (this.widths.size > 0) out.widths = Object.fromEntries(this.widths);
        if (this.tops.size > 0) out.tops = Object.fromEntries(this.tops);
        if (this.heights.size > 0) out.heights = Object.fromEntries(this.heights);
        if (this.desktopHeights.size > 0) out.desktopHeights = Object.fromEntries(this.desktopHeights);
        if (this.pinned.size > 0) out.pinned = [...this.pinned];
        if (this.floating.size > 0) out.floating = [...this.floating];
        const floatingOpen = new Set([
            ...this.entries.filter((entry) => entry.panel.open && entry.panel.floating).map((entry) => entry.id),
            ...this.suspendedFloating,
            ...this.pendingFloatingOpen,
        ]);
        if (floatingOpen.size > 0) out.floatingOpen = [...floatingOpen];
        if (this.floatPositions.size > 0) out.floatPositions = Object.fromEntries(this.floatPositions);
        return out.open || out.widths || out.tops || out.heights || out.desktopHeights || out.pinned
            || out.floating || out.floatingOpen || out.floatPositions ? out : null;
    }

    /**
     * Restore a complete persisted dock snapshot. Missing widths reset to declared defaults;
     * stored widths and modes also apply to panels that register later. `open` names the side
     * dock (or one floating fallback), and `floatingOpen` names all open desktop cards. A
     * document with no panels field leaves the existing dock alone for compatibility. The
     * anchored-overlay `pinned` list remains independent of the new free-floating modes.
     */
    applyState(state: PanelsState | undefined): void {
        if (!state) return;
        // The persisted map is a complete snapshot. Missing entries mean declared
        // defaults, not a stale width from the document (or undo state) being replaced.
        this.widths.clear();
        for (const [id, px] of Object.entries(state.widths ?? {})) this.widths.set(id, px);
        for (const entry of this.entries) {
            const width = this.widths.get(entry.id);
            if (width === undefined) entry.panel.resetWidth();
            else entry.panel.setWidth(width);
        }
        // Geometry converges to the document; absent fields restore defaults on undo.
        this.tops.clear();
        this.heights.clear();
        this.desktopHeights.clear();
        for (const [id, top] of Object.entries(state.tops ?? {})) this.tops.set(id, clampPanelTop(top));
        for (const [id, height] of Object.entries(state.heights ?? {})) this.heights.set(id, clampPanelHeight(height));
        for (const [id, height] of Object.entries(state.desktopHeights ?? {})) this.desktopHeights.set(id, clampPanelHeight(height));
        this.pinned = new Set(state.pinned ?? []);
        this.floating = new Set([...(state.floating ?? []), ...(state.floatingOpen ?? [])]);
        this.floatPositions.clear();
        for (const [id, position] of Object.entries(state.floatPositions ?? {})) this.floatPositions.set(id, { ...position });
        const openFloat = new Set(state.floatingOpen ?? []);
        if (state.open && this.floating.has(state.open)) openFloat.add(state.open);
        const visible = new Set<string>();
        if (state.open) visible.add(state.open);
        if (this.layout === 'desktop') for (const id of openFloat) visible.add(id);
        else if (!visible.size && openFloat.size) visible.add(openFloat.values().next().value!);
        this.suspendedFloating.clear();
        this.pendingFloatingOpen.clear();
        if (this.layout === 'mobile') {
            for (const id of openFloat) if (!visible.has(id)) this.suspendedFloating.add(id);
        } else {
            for (const id of openFloat) if (!this.entries.some((entry) => entry.id === id)) this.pendingFloatingOpen.add(id);
        }
        this.pendingOpen = state.open && !this.entries.some((entry) => entry.id === state.open) ? state.open : null;
        this.applying = true;
        try {
            for (const entry of this.entries) {
                if (entry.panel.open && !visible.has(entry.id)) entry.panel.toggle(false, true);
                entry.panel.setMobileHeight(this.heights.get(entry.id) ?? DEFAULT_PANEL_HEIGHT);
                entry.panel.restoreMobileTop(this.tops.get(entry.id));
                entry.panel.setOverlay(!this.pinned.has(entry.id));
                const position = this.floatPositions.get(entry.id) ?? null;
                entry.panel.setFloatingPosition(position);
                entry.panel.setFloating(this.floating.has(entry.id));
                entry.panel.setDesktopHeight(this.desktopHeights.get(entry.id) ?? null);
                // The old height may temporarily clamp a restored position. Reapply it only
                // after the new height is in place so undo/redo restores both edges exactly.
                if (entry.panel.floating) entry.panel.setFloatingPosition(position);
            }
            for (const entry of this.entries) if (visible.has(entry.id) && !entry.panel.open) entry.panel.toggle(true, true);
        } finally { this.applying = false; }
        // Restoring cards in registry order must not bury a restored dock's controls.
        const docked = this.entries.find((entry) => entry.panel.open && !entry.panel.floating);
        if (docked) this.raise(docked);
    }

    /** Drop the contributed panels (the shell destroys its own). */
    destroy(): void {
        for (const entry of [...this.entries]) if (entry.contributed) this.drop(entry);
        this.entries.length = 0;
    }

    private add(entry: Entry): void {
        this.entries.push(entry);
        this.entries.sort((a, b) => a.order - b.order);
        const stored = this.widths.get(entry.id);
        if (stored !== undefined) entry.panel.setWidth(stored);
        const storedHeight = this.heights.get(entry.id);
        if (storedHeight !== undefined) entry.panel.setMobileHeight(storedHeight);
        const storedTop = this.tops.get(entry.id);
        entry.panel.restoreMobileTop(storedTop);
        if (this.pinned.has(entry.id)) entry.panel.setOverlay(false);
        entry.panel.setFloatingPosition(this.floatPositions.get(entry.id) ?? null);
        entry.panel.setFloating(this.floating.has(entry.id));
        const storedDesktopHeight = this.desktopHeights.get(entry.id);
        if (storedDesktopHeight !== undefined) entry.panel.setDesktopHeight(storedDesktopHeight);
        if (entry.panel.floating) entry.panel.setFloatingPosition(this.floatPositions.get(entry.id) ?? null);
        entry.panel.onOpenChange = (open) => {
            if (open) {
                this.suspendedFloating.delete(entry.id);
                this.pendingFloatingOpen.delete(entry.id);
                if (!this.applying && !this.automatic) this.pendingOpen = null;
                // A phone has one sheet. On desktop, only the side column is exclusive;
                // already-floating windows stay live and retain their mounted contents.
                for (const other of this.entries) {
                    if (other === entry || !other.panel.open) continue;
                    if (this.layout === 'mobile' || (!entry.panel.floating && !other.panel.floating)) {
                        if (this.layout === 'mobile' && other.panel.floating) this.suspendedFloating.add(other.id);
                        const previous = this.automatic;
                        this.automatic = true;
                        try { other.panel.toggle(false, true); } finally { this.automatic = previous; }
                    }
                }
                if (this.layout === 'desktop') this.raise(entry);
            } else if (this.layout === 'mobile' && !this.automatic && !this.applying) {
                this.suspendedFloating.delete(entry.id);
            }
            this.deps.chrome.setPanelActive(entry.id, open);
            if (open) entry.handle?.onOpen?.();
            if (!this.applying && !this.automatic) this.deps.changed?.();
        };
        entry.panel.onWidthChange = (px) => {
            this.widths.set(entry.id, px);
            this.deps.changed?.();
        };
        entry.panel.onTopChange = (top) => {
            this.tops.set(entry.id, top);
            this.deps.changed?.();
        };
        entry.panel.onSheetResize = (top, height) => {
            // Persist both edges together: one resize is one history change.
            this.tops.set(entry.id, top);
            this.heights.set(entry.id, height);
            this.deps.changed?.();
        };
        entry.panel.onDesktopHeightChange = (height) => {
            this.desktopHeights.set(entry.id, height);
            this.deps.changed?.();
        };
        entry.panel.onPlacementChange = (overlay) => {
            if (overlay) this.pinned.delete(entry.id);
            else this.pinned.add(entry.id);
            this.deps.changed?.();
        };
        entry.panel.onFloatingChange = (floating) => {
            if (floating) {
                this.floating.add(entry.id);
                if (entry.panel.open && this.layout === 'desktop') this.raise(entry);
            } else {
                this.floating.delete(entry.id);
                this.suspendedFloating.delete(entry.id);
                this.pendingFloatingOpen.delete(entry.id);
                if (entry.panel.open && this.layout === 'desktop') {
                    for (const other of this.entries) {
                        if (other !== entry && other.panel.open && !other.panel.floating) {
                            const previous = this.automatic;
                            this.automatic = true;
                            try { other.panel.toggle(false, true); } finally { this.automatic = previous; }
                        }
                    }
                }
            }
            if (!this.applying && !this.automatic) this.deps.changed?.();
        };
        entry.panel.onFloatingPositionChange = (position) => {
            this.floatPositions.set(entry.id, { ...position });
            if (!this.applying && !this.automatic) this.deps.changed?.();
        };
        entry.panel.onFloatingResize = (width, height, position) => {
            this.widths.set(entry.id, width);
            if (height !== null) this.desktopHeights.set(entry.id, height);
            if (position) this.floatPositions.set(entry.id, { ...position });
            if (!this.applying && !this.automatic) this.deps.changed?.();
        };
        entry.panel.onActivate = () => this.raise(entry);
        const shouldOpen = this.pendingOpen === entry.id || (this.layout === 'desktop' && this.pendingFloatingOpen.has(entry.id));
        if (shouldOpen) {
            const previous = this.automatic;
            this.automatic = true;
            try { entry.panel.toggle(true); } finally { this.automatic = previous; }
            if (this.pendingOpen === entry.id) this.pendingOpen = null;
        }
        if (!entry.contributed) this.publish();
    }

    /** Raise without moving DOM nodes: focused editors and live widgets stay intact. */
    private raise(entry: Entry): void {
        if (this.layout !== 'desktop' || !entry.panel.open) return;
        this.frontId = entry.id;
        for (const other of this.entries) {
            other.panel.setFloatingFront(other === entry && entry.panel.floating);
            other.panel.setDockFront(other === entry && !entry.panel.floating);
        }
    }

    private drop(entry: Entry): void {
        const i = this.entries.indexOf(entry);
        if (i >= 0) this.entries.splice(i, 1);
        try {
            entry.handle?.destroy?.();
        } catch (err) {
            console.warn(`[vela] side panel "${entry.id}" failed to release`, err);
        }
        entry.panel.destroy();
    }

    /** Push the current toggle group to the chrome, pressed states included. */
    private publish(): void {
        const buttons: SidePanelButton[] = this.entries.filter((e) => e.showInChrome !== false).map((e) => ({ id: e.id, title: e.title, icon: e.icon }));
        this.deps.chrome.setPanelButtons(buttons, (id) => this.toggle(id));
        for (const entry of this.entries) this.deps.chrome.setPanelActive(entry.id, entry.panel.open);
    }
}
