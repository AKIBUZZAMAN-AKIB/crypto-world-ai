import type { IndicatorHandle } from '../core/IndicatorHandle';
import { indicatorReference, resolveIndicatorReference } from '../core/indicator-reference';
import type { WorkspaceState } from '../state/document';

export type IndicatorLinkMode = 'none' | 'layout' | 'charts';
type SavedLink = NonNullable<WorkspaceState['indicatorSyncLinks']>[number];
interface Endpoint {
    id: string;
    handles(): IndicatorHandle[];
    copy(source: IndicatorHandle): IndicatorHandle | null;
    /** True only when this exact inherited source will arrive with an async manifest. */
    deferred?(source: IndicatorHandle): boolean;
}
interface Link {
    mode: 'layout' | 'charts';
    members: Map<string, string>;
    pending: SavedLink['members'];
    values?: SavedLink['values'];
    /** The latest editor supplies defaults that become known after preparation. */
    leader?: { cellId: string; id: string };
}

/** Explicit indicator instance links. Edits on any member propagate to the others, while
 * visibility, pane placement and removal remain local. Unlinking never deletes copies. */
export class IndicatorLiveSync {
    private links: Link[] = [];
    private busy = false;
    constructor(private readonly endpoints: () => Endpoint[], private readonly changed: () => void) {}

    private endpoint(id: string): Endpoint | undefined { return this.endpoints().find((c) => c.id === id); }
    private find(cellId: string, id: string): Link | undefined { return this.links.find((l) => l.members.get(cellId) === id); }

    status(cellId: string, id: string): { mode: IndicatorLinkMode; charts: string[]; pending: string[] } {
        const link = this.find(cellId, id);
        return link
            ? { mode: link.mode, charts: [...link.members.keys()].filter((c) => c !== cellId), pending: link.pending.map((m) => m.cellId).filter((c) => c !== cellId) }
            : { mode: 'none', charts: [], pending: [] };
    }

    set(cellId: string, id: string, mode: IndicatorLinkMode, targets: readonly string[] = []): number {
        const source = this.endpoint(cellId)?.handles().find((h) => h.id === id);
        if (!source) return 0;
        let link = this.find(cellId, id);
        if (mode === 'none') {
            if (link) { this.links = this.links.filter((l) => l !== link); this.changed(); }
            return 0;
        }
        const desired = new Set([cellId, ...(mode === 'layout' ? this.endpoints().map((e) => e.id) : targets)]);
        if (!link) { link = { mode, members: new Map([[cellId, id]]), pending: [] }; this.links.push(link); }
        link.values = { inputs: source.inputValues(), props: source.propValues() };
        link.leader = { cellId, id };
        link.mode = mode;
        // A layout-wide link still owns pooled/hidden members even though they are not
        // currently in the target list. Selected-chart changes keep only chosen targets.
        link.pending = link.pending.filter((m) => desired.has(m.cellId) || (mode === 'layout' && !this.endpoint(m.cellId)));
        for (const key of link.members.keys()) if (!desired.has(key)) link.members.delete(key); // copies stay on their charts
        let added = 0;
        this.busy = true;
        try {
            for (const target of desired) {
                if (link.members.has(target) || link.pending.some((m) => m.cellId === target)) continue;
                const endpoint = this.endpoint(target);
                if (!endpoint) continue;
                const copy = endpoint.copy(source);
                if (!copy) {
                    const ref = endpoint.deferred?.(source) ? indicatorReference(this.endpoint(cellId)?.handles() ?? [], id) : null;
                    if (ref) link.pending.push({ cellId: target, ...ref });
                    continue;
                }
                // A singleton already linked elsewhere cannot be in two live links.
                if (this.find(target, copy.id)) continue;
                link.members.set(target, copy.id);
                this.applyValues(source, copy);
                added += 1;
            }
        } finally { this.busy = false; }
        // A single-chart layout may opt in before it is expanded. A partially failed
        // multi-chart request is a selected-chart link, not a false all-layout claim.
        if (mode === 'layout' && [...desired].some((target) => !link!.members.has(target) && !link!.pending.some((m) => m.cellId === target))) link.mode = 'charts';
        if (link.members.size + link.pending.length < 2 && (mode !== 'layout' || desired.size > 1)) this.links = this.links.filter((l) => l !== link);
        this.changed();
        return added;
    }

    private applyValues(source: IndicatorHandle, target: IndicatorHandle): void {
        this.applySnapshot({ inputs: source.inputValues(), props: source.propValues() }, target);
    }

    private applySnapshot(values: NonNullable<SavedLink['values']>, target: IndicatorHandle): void {
        if (JSON.stringify(values.inputs) !== JSON.stringify(target.inputValues())) target.setInputs(values.inputs);
        // setProps merges overrides. An inherited peer can have an override which the
        // source never set: restore that property to its declared default rather than
        // leaving a stale peer-only style/property behind. Recheck when schemas arrive.
        const current = target.propValues();
        const wanted = { ...values.props };
        for (const prop of target.props ?? []) {
            if (!(prop.key in wanted) && prop.key in current) wanted[prop.key] = prop.defval;
        }
        const patch = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => current[key] !== value));
        if (Object.keys(patch).length > 0) target.setProps(patch);
    }

    /** A linked script may acquire its declaration schema after the initial link. */
    ready(cellId: string, id: string): void {
        if (this.busy) return;
        const link = this.find(cellId, id);
        const handle = this.endpoint(cellId)?.handles().find((h) => h.id === id);
        if (!link?.values || !handle) return;
        this.busy = true;
        try {
            if (link.leader?.cellId === cellId && link.leader.id === id) {
                // The latest editor's newly parsed defaults fill gaps, while edits that
                // arrived before prepare remain authoritative.
                link.values.inputs = { ...handle.inputValues(), ...link.values.inputs };
                for (const [targetCell, targetId] of link.members) {
                    const target = this.endpoint(targetCell)?.handles().find((h) => h.id === targetId);
                    if (target) this.applySnapshot(link.values, target);
                }
            } else this.applySnapshot(link.values, handle);
        } finally { this.busy = false; }
    }

    inputsChanged(cellId: string, id: string): void {
        if (this.busy) return;
        const link = this.find(cellId, id);
        const source = this.endpoint(cellId)?.handles().find((h) => h.id === id);
        if (!link || !source) return;
        // Retain the last edit even when all peers happen to be pooled/hidden.
        link.values = { inputs: source.inputValues(), props: source.propValues() };
        link.leader = { cellId, id };
        this.busy = true;
        try {
            for (const [targetCell, targetId] of link.members) {
                if (targetCell === cellId) continue;
                const target = this.endpoint(targetCell)?.handles().find((h) => h.id === targetId);
                if (target) this.applyValues(source, target);
            }
        } finally { this.busy = false; }
        this.changed();
    }

    removed(cellId: string, id: string): void {
        if (this.busy) return;
        const link = this.find(cellId, id);
        if (!link) return;
        link.members.delete(cellId);
        // Removal is local, not synchronized. Once a chart is explicitly omitted it
        // becomes a selected-chart link, so a later layout change won't resurrect it.
        if (link.mode === 'layout') link.mode = 'charts';
        if (link.members.size + link.pending.length < 2) this.links = this.links.filter((l) => l !== link);
        this.changed();
    }

    /** Re-resolve after asynchronous script loading or a chart rebuild. */
    resolvePending(): void {
        const wasBusy = this.busy;
        this.busy = true;
        try {
            for (const link of this.links) {
                link.pending = link.pending.filter((ref) => {
                    const endpoint = this.endpoint(ref.cellId);
                    const handle = endpoint && resolveIndicatorReference(endpoint.handles(), ref);
                    if (!handle) return true;
                    const other = this.find(ref.cellId, handle.id);
                    if (other && other !== link) return true;
                    // A returning chart may be the only live member: the last editor may
                    // itself just have gone into the pool. The link carries that edit.
                    const source = [...link.members].flatMap(([cell, id]) => this.endpoint(cell)?.handles().filter((h) => h.id === id) ?? [])[0];
                    if (link.values) this.applySnapshot(link.values, handle);
                    else if (source && source !== handle) this.applyValues(source, handle);
                    else if (!source) link.values = { inputs: handle.inputValues(), props: handle.propValues() };
                    link.members.set(ref.cellId, handle.id);
                    if (!link.leader) link.leader = { cellId: ref.cellId, id: handle.id };
                    return false;
                });
            }
        } finally { this.busy = wasBusy; }
    }

    /** Layout-mode links also cover genuinely new charts after a grid expansion. */
    reconcileLayout(inheritedFrom: ReadonlyMap<string, string> = new Map()): void {
        this.resolvePending();
        let changed = false;
        this.busy = true;
        try {
            for (const link of this.links) {
                if (link.mode !== 'layout') continue;
                const lead = [...link.members].flatMap(([cell, id]) => {
                    const endpoint = this.endpoint(cell);
                    const source = endpoint?.handles().find((h) => h.id === id);
                    return endpoint && source ? [{ endpoint, source }] : [];
                })[0];
                if (!lead) continue;
                const { source } = lead;
                for (const endpoint of this.endpoints()) {
                    if (link.members.has(endpoint.id) || link.pending.some((m) => m.cellId === endpoint.id)) continue;
                    // Reuse only when this particular link was inherited from its actual
                    // donor. Matching an established/unrelated same-type study is unsafe.
                    const donorId = inheritedFrom.get(endpoint.id);
                    const donor = donorId ? this.endpoint(donorId) : undefined;
                    const donorMember = donorId ? link.members.get(donorId) : undefined;
                    const ref = donor && donorMember ? indicatorReference(donor.handles(), donorMember) : null;
                    const inherited = ref ? resolveIndicatorReference(endpoint.handles(), ref) : undefined;
                    const copy = inherited ?? endpoint.copy(source);
                    if (!copy || this.find(endpoint.id, copy.id)) continue;
                    link.members.set(endpoint.id, copy.id);
                    this.applyValues(source, copy);
                    changed = true;
                }
            }
        } finally { this.busy = false; }
        if (changed) this.changed();
    }

    snapshot(): SavedLink[] {
        this.resolvePending();
        return this.links.map((link) => ({
            mode: link.mode,
            ...(link.values ? { values: { inputs: { ...link.values.inputs }, props: { ...link.values.props } } } : {}),
            members: [
                ...[...link.members].flatMap(([cellId, id]) => {
                    const endpoint = this.endpoint(cellId);
                    const ref = endpoint && indicatorReference(endpoint.handles(), id);
                    return ref ? [{ cellId, ...ref }] : [];
                }),
                ...link.pending,
            ],
        })).filter((l) => l.members.length > 0);
    }

    restore(saved: readonly SavedLink[] | undefined): void {
        this.links = (saved ?? []).map((l) => ({
            mode: l.mode, members: new Map(), pending: l.members.map((m) => ({ ...m })),
            ...(l.values ? { values: { inputs: { ...l.values.inputs }, props: { ...l.values.props } } } : {}),
        }));
        this.resolvePending();
    }

    clear(): void { this.links = []; }
}
