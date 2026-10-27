// Unified undo/redo timeline — app-level ops (indicator add/remove) and core drawing
// edits share ONE stack, so Ctrl+Z / Ctrl+Y step through both in the order they happened
// (the reference behavior). The workspace adds a second, global snapshot stack for
// edits that have no per-object inverse; a composite picks the newest entry.
import type { Vela } from '../Vela';

export interface HistoryAction {
    undo(): void;
    redo(): void;
}

interface HistoryEntry {
    action: HistoryAction;
    /** Global arrival order — lets several WidgetHistory stacks be merged chronologically. */
    seq: number;
}

/** Monotonic counters shared by every stack in the page (never reset). */
let actionClock = 0;
let mutationClock = 0;

export class WidgetHistory {
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];
    private readonly listeners = new Set<() => void>();
    private unsubs: Array<() => void> = [];
    private muted = false;

    /** `getChart` late-resolves the CURRENT chart: drawing steps recorded before a chart
     *  rebuild must undo on the chart that exists when the user presses Ctrl+Z, not on a
     *  destroyed instance captured at record time. */
    constructor(private readonly getChart: () => Vela | null = () => null, private readonly cap = 100) {}

    /** Any push/undo/redo bumps this clock. A snapshot recorder uses it to avoid
     *  duplicating an action another history stack already owns. */
    static clockNow(): number {
        return mutationClock;
    }

    /** Record a reversible action (a fresh edit forks history: redo branch clears). */
    push(action: HistoryAction): void {
        if (this.muted) return;
        mutationClock += 1;
        this.undoStack.push({ action, seq: ++actionClock });
        if (this.undoStack.length > this.cap) this.undoStack.shift();
        this.redoStack.length = 0;
        this.notify();
    }

    undo(): void {
        const e = this.undoStack.pop();
        if (!e) return;
        mutationClock += 1;
        this.mutedRun(() => e.action.undo());
        this.redoStack.push(e);
        this.notify();
    }

    redo(): void {
        const e = this.redoStack.pop();
        if (!e) return;
        mutationClock += 1;
        this.mutedRun(() => e.action.redo());
        this.undoStack.push(e);
        this.notify();
    }

    /** Run `fn` without recording — for programmatic state application (setState,
     *  ledger restore), whose indicator/drawing events are not user edits. */
    silently(fn: () => void): void {
        this.mutedRun(fn);
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Arrival seq of the next undo / redo candidate (0 when that stack is empty). */
    get nextUndoSeq(): number {
        return this.undoStack[this.undoStack.length - 1]?.seq ?? 0;
    }

    get nextRedoSeq(): number {
        return this.redoStack[this.redoStack.length - 1]?.seq ?? 0;
    }

    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /** (Re)bind to a chart: drawing edits enter the unified stack as delegate steps. */
    onChart(chart: Vela): void {
        for (const u of this.unsubs) u();
        this.unsubs = [chart.on('drawing:history', () => this.pushDrawingStep())];
    }

    destroy(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.listeners.clear();
    }

    private pushDrawingStep(): void {
        this.push({ undo: () => this.getChart()?.drawings.undo(), redo: () => this.getChart()?.drawings.redo() });
    }

    /** Replaying an action must not re-record the drawing events it triggers. */
    private mutedRun(fn: () => void): void {
        this.muted = true;
        try {
            fn();
        } finally {
            this.muted = false;
        }
    }

    private notify(): void {
        for (const cb of this.listeners) cb();
    }
}
