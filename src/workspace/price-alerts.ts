// Price alerts — the client-side engine behind the Alert sheet.
//
// TradingView's model, reduced to what a chart can honestly do without a server: an alert
// is a LEVEL on a symbol plus a CONDITION, evaluated on every price the chart prints. The
// five price operators are the reference's own price set (Crossing, Crossing up, Crossing
// down, Greater than, Less than); "technical" alerts (indicator/strategy) are the scripting
// engine's job and arrive through `chart.on('alert')`.
//
// This module is PURE: no DOM, no timers, no storage. The workspace feeds it prices and
// turns a `fired` result into the bell row / toast / chart line. That split is what makes
// the crossing arithmetic testable — an off-by-one bar is a silently missed trade alert,
// so the truth table here is covered by its own spec.

/** The five price conditions a chart alert can carry. */
export type AlertCondition = 'cross' | 'cross-up' | 'cross-down' | 'gt' | 'lt';

/** How often the alert may fire. `once` is the reference default for a price alert. */
export type AlertFrequency = 'once' | 'each';

export type AlertState = 'active' | 'fired' | 'paused';

export interface PriceAlert {
    id: string;
    /** The cell it watches — an alert belongs to a chart, exactly as the bell lists it. */
    cellId: string;
    symbol: string;
    condition: AlertCondition;
    /** The level being watched. */
    value: number;
    frequency: AlertFrequency;
    state: AlertState;
    createdAt: number;
    /** The price the watch started from — a `crossing` needs a side to come FROM. */
    anchorPrice: number | null;
    /** When it last fired (0 = never). */
    firedAt: number;
    /** How many times it has fired (a repeat alert counts up). */
    fires: number;
    /** The id of the horizontal line drawn at the level ('' = none drawn). */
    lineId: string;
}

export interface AlertTick {
    /** The previous price this alert saw, or null on the first tick after creation. */
    prev: number | null;
    /** The price now. */
    now: number;
}

export const CONDITION_LABELS: Readonly<Record<AlertCondition, string>> = {
    cross: 'Crossing',
    'cross-up': 'Crossing up',
    'cross-down': 'Crossing down',
    gt: 'Greater than',
    lt: 'Less than',
};

export const FREQUENCY_LABELS: Readonly<Record<AlertFrequency, string>> = {
    once: 'Once only',
    each: 'Every time',
};

/** The condition's phrasing with its level, e.g. "Crossing up 143.50". */
export function describeAlert(alert: Pick<PriceAlert, 'condition' | 'value'>): string {
    return `${CONDITION_LABELS[alert.condition]} ${formatLevel(alert.value)}`;
}

/** Prices print with at most two decimals unless the level needs more (a 0.00001 alt). */
export function formatLevel(value: number): string {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toFixed(2);
    if (abs >= 1) return value.toFixed(2);
    if (abs >= 0.01) return value.toFixed(4);
    return value.toPrecision(4);
}

/**
 * Does this tick fire the alert? The reference's rules:
 *  - Crossing: reaches the level from EITHER side (down→up or up→down).
 *  - Crossing up / down: only the matching direction.
 *  - Greater than / Less than: fires once the value is PAST the level, not on touch.
 *
 * A `cross` needs a previous price: on the very first tick there is no side to come from,
 * so the alert adopts the anchor instead of firing immediately (an alert created at the
 * current price must not fire on the next tick for no reason).
 */
export function alertFires(alert: Pick<PriceAlert, 'condition' | 'value'>, tick: AlertTick): boolean {
    const { prev, now } = tick;
    if (!Number.isFinite(now)) return false;
    const v = alert.value;
    if (!Number.isFinite(v)) return false;
    // Sitting exactly ON the level is not a crossing until a later tick moves through it.
    if (now === v) return false;
    if (prev === null || !Number.isFinite(prev)) {
        // No side yet: a CROSSING cannot have happened (an alert created at the current
        // price must not fire for no reason), but Greater/Less-than is a STATE — a level
        // the market is already past is true the moment the alert exists, which is exactly
        // how the reference behaves when you arm "greater than" below the last print.
        return alert.condition === 'gt' ? now > v : alert.condition === 'lt' ? now < v : false;
    }
    const wasBelow = prev < v;
    const wasAbove = prev > v;
    const isAbove = now > v;
    const isBelow = now < v;
    switch (alert.condition) {
        case 'cross':
            return (wasBelow && isAbove) || (wasAbove && isBelow);
        case 'cross-up':
            return wasBelow && isAbove;
        case 'cross-down':
            return wasAbove && isBelow;
        case 'gt':
            // "by at least one tick": the previous print must not already satisfy it, so a
            // repeated tick above the level does not re-fire an `each` alert every bar.
            return isAbove && !(prev > v);
        case 'lt':
            return isBelow && !(prev < v);
    }
}

/** Fold one tick into an alert. Returns the alert (updated) and whether it fired. */
export function advanceAlert(alert: PriceAlert, tick: AlertTick): { alert: PriceAlert; fired: boolean } {
    if (alert.state !== 'active') return { alert, fired: false };
    const fired = alertFires(alert, tick);
    if (!fired) return { alert: { ...alert, anchorPrice: alert.anchorPrice ?? tick.now }, fired: false };
    return {
        alert: {
            ...alert,
            state: alert.frequency === 'once' ? 'fired' : 'active',
            anchorPrice: tick.now,
            firedAt: tick.now,
            fires: alert.fires + 1,
        },
        fired: true,
    };
}

/** A short id for a new alert (`a1`, `a2`, …) — unique within the workspace's own list. */
export function nextAlertId(existing: readonly Pick<PriceAlert, 'id'>[]): string {
    let n = existing.length + 1;
    const taken = new Set(existing.map((a) => a.id));
    while (taken.has(`a${n}`)) n += 1;
    return `a${n}`;
}

/** The one-line row the bell shows for a price alert: "AAA · Crossing up 143.50". */
export function alertRowLabel(alert: Pick<PriceAlert, 'symbol' | 'condition' | 'value' | 'state'>): string {
    const ticker = alert.symbol.split(':').pop() ?? alert.symbol;
    const state = alert.state === 'paused' ? ' (paused)' : '';
    return `${ticker} · ${describeAlert(alert)}${state}`;
}
