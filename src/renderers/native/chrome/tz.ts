/**
 * Minimal IANA-timezone support for the time axis + stamps. The renderer works in
 * epoch-ms (UTC) everywhere; to render labels in a chosen zone we compute that zone's
 * UTC offset for a given instant and shift the ms before reading `getUTC*`. A single
 * offset (sampled at the visible range's midpoint) is reused across the range — exact
 * away from DST boundaries, with at most a one-hour seam across a transition, which is
 * an acceptable trade for cheap, dependency-free zoning.
 */

// Constructing an Intl formatter for every candle is much more expensive than formatting
// a timestamp. Reuse a small bounded set when the historical table walks many rows.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's offset from UTC at `ms`, in milliseconds (e.g. New York in winter ⇒ -5h).
 *  Returns 0 for UTC / empty / unknown zones so callers degrade to plain UTC. */
export function tzOffsetMs(ms: number, timeZone: string): number {
    if (!timeZone || timeZone === 'UTC') return 0;
    try {
        let dtf = zoneFormatters.get(timeZone);
        if (!dtf) {
            dtf = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            if (zoneFormatters.size >= 32) zoneFormatters.delete(zoneFormatters.keys().next().value!);
            zoneFormatters.set(timeZone, dtf);
        }
        const parts = dtf.formatToParts(new Date(ms));
        const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
        const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
        return asUTC - ms;
    } catch {
        return 0;
    }
}

/** A `Date` whose `getUTC*` accessors read the wall-clock time in `timeZone`. */
export function zonedDate(ms: number, timeZone: string): Date {
    return new Date(ms + tzOffsetMs(ms, timeZone));
}
