import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';
import { BEARISH, BULLISH, NEUTRAL, ON_PLATE, SLATE, SLATE_DEEP } from '../../palette';

/**
 * The forecast's three blocks, in the reference's own terms: the two endpoint labels
 * (Source / Target) each carry a text, background and border color, and the result box
 * switches between a success and a failure pair. Transparency lives in each color's own
 * alpha (the picker edits it), so a faded border is one setting, not two.
 */
export interface ForecastStyle {
    labelText: string;
    labelBg: string;
    labelBorder: string;
    successText: string;
    successBg: string;
    failureText: string;
    failureBg: string;
}

/** A solid, readable default: dark labels, green/red result boxes with white ink. */
export function defaultForecastStyle(): ForecastStyle {
    return {
        labelText: ON_PLATE,
        labelBg: SLATE_DEEP,
        labelBorder: SLATE,
        successText: ON_PLATE,
        successBg: BULLISH,
        failureText: ON_PLATE,
        failureBg: BEARISH,
    };
}

/** The result box while the window is still open — no verdict yet, so no verdict color. */
export function openVerdictStyle(): { text: string; bg: string } {
    return { text: ON_PLATE, bg: NEUTRAL };
}

/** How a forecast has played out so far. */
export type ForecastOutcome = 'open' | 'success' | 'failure';

/** The forecast resolved to pixels + the numbers its labels print. */
export interface ForecastLayout {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** Direction of the projection (up = long idea). */
    up: boolean;
    /** Percent move from source to target. */
    movePct: number;
    outcome: ForecastOutcome;
    /** Bars elapsed since the forecast window closed (0 while it is still open). */
    elapsed: number;
}

/**
 * Position forecast: place a SOURCE (entry) and a TARGET (exit) — the horizontal distance
 * between them is the forecast's duration, exactly as the reference tool defines it. The
 * line is drawn source → target, each end gets a price chip, and once the window has closed
 * the tool reports whether price actually reached the target in time (success) or the time
 * ran out first (failure). The verdict comes from the bars in the window, so it is
 * deterministic and survives reloads.
 */
export class PositionForecast extends Drawing {
    readonly type = 'positionforecast' as const;
    /** Declared without an initializer: the base constructor reads `props` before subclass
     *  fields initialise, so `= defaultForecastStyle()` here would wipe a saved palette. */
    forecast!: ForecastStyle;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'source', free: 'both' }, { role: 'target', free: 'both' }] };
    }

    /** Did price reach the target before the window's end? */
    outcome(proj: Projector): { outcome: ForecastOutcome; elapsed: number } {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return { outcome: 'open', elapsed: 0 };
        const from = Math.min(a.time, b.time);
        const to = Math.max(a.time, b.time);
        const bars = proj.barsInRange?.(from, Number.MAX_SAFE_INTEGER) ?? [];
        if (bars.length === 0) return { outcome: 'open', elapsed: 0 };
        const up = b.price >= a.price;
        // The verdict only exists once the window is over.
        const last = bars[bars.length - 1]!;
        if (last.time < to) return { outcome: 'open', elapsed: 0 };
        let hit = false;
        for (const bar of bars) {
            if (bar.time < from) continue;
            if (bar.time > to) break;
            if (up ? bar.high >= b.price : bar.low <= b.price) {
                hit = true;
                break;
            }
        }
        const elapsed = Math.max(0, bars.filter((bar) => bar.time > to).length);
        return { outcome: hit ? 'success' : 'failure', elapsed };
    }

    layout(proj: Projector): ForecastLayout | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const y0 = proj.yOf(a.price, this.paneId);
        const y1 = proj.yOf(b.price, this.paneId);
        if (y0 == null || y1 == null) return null;
        const { outcome, elapsed } = this.outcome(proj);
        const base = Math.abs(a.price);
        return {
            x0: proj.xOf(a.time),
            y0,
            x1: proj.xOf(b.time),
            y1,
            up: b.price >= a.price,
            movePct: base > 1e-9 ? ((b.price - a.price) / base) * 100 : 0,
            outcome,
            elapsed,
        };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        if (!L) return false;
        const dx = L.x1 - L.x0;
        const dy = L.y1 - L.y0;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) return Math.hypot(px - L.x0, py - L.y0) <= tol;
        // Distance from the point to the segment.
        const t = Math.max(0, Math.min(1, ((px - L.x0) * dx + (py - L.y0) * dy) / len2));
        return Math.hypot(px - (L.x0 + t * dx), py - (L.y0 + t * dy)) <= tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const out: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y != null) out.push([proj.xOf(a.time), y]);
        }
        return out;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const L = this.layout(proj);
        if (!L) return null;
        const x = Math.min(L.x0, L.x1);
        const y = Math.min(L.y0, L.y1);
        return { x, y, w: Math.abs(L.x1 - L.x0), h: Math.abs(L.y1 - L.y0) };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        return a && b ? { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) } : null;
    }

    /** The resolved palette, defaulting on first use (a drawing made before this existed, or
     *  one whose props never mentioned it). */
    palette(): ForecastStyle {
        return (this.forecast ??= defaultForecastStyle());
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                { path: 'forecast.labelText', label: 'Source/target text', kind: 'color', group: 'text' },
                { path: 'forecast.labelBg', label: 'Source/target background', kind: 'color', group: 'text' },
                { path: 'forecast.labelBorder', label: 'Source/target border', kind: 'color', group: 'text' },
                { path: 'forecast.successText', label: 'Success text', kind: 'color', group: 'text' },
                { path: 'forecast.successBg', label: 'Success background', kind: 'color', group: 'text' },
                { path: 'forecast.failureText', label: 'Failure text', kind: 'color', group: 'text' },
                { path: 'forecast.failureBg', label: 'Failure background', kind: 'color', group: 'text' },
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { forecast: { ...this.palette() } };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const raw = props.forecast as Partial<ForecastStyle> | undefined;
        if (!raw || typeof raw !== 'object') return;
        const base = defaultForecastStyle();
        for (const key of Object.keys(base) as Array<keyof ForecastStyle>) {
            const v = raw[key];
            if (typeof v === 'string' && v.trim() !== '') base[key] = v;
        }
        this.forecast = base;
    }
}
