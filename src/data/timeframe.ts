/** Named non-minute resolutions → ms. `M` is treated as a 30-day month (bucketing only). */
const NAMED_TF_MS: Record<string, number> = { D: 86_400_000, W: 604_800_000, M: 2_592_000_000, Y: 31_536_000_000 };

/**
 * Bar duration in ms for a Vela timeframe: a bare number is **minutes** (Pine
 * resolution — `60` = 1h, `240` = 4h), the `15m`/`4h`/`1d`/`1w` aliases are accepted,
 * `NS` is N SECONDS (`1S`, `15S`), and `M`/`mo` is MONTHS (`3M`) — the unit's case is
 * load-bearing there: `3m` is three minutes.
 *
 * Anything unparsed falls back to 1h (documented, because this runs on the render hot
 * path), but no longer silently: the first time a given string is seen it is reported
 * once, so a host passing an unsupported resolution finds out instead of watching the
 * chart quietly treat it as an hour.
 */
export function timeframeToMs(timeframe: string): number {
    const tf = timeframe.trim();
    if (NAMED_TF_MS[tf]) return NAMED_TF_MS[tf];
    const m = /^(\d+)\s*(mo|[smhdwySMHDWY])?$/.exec(tf);
    if (m) {
        const n = parseInt(m[1]!, 10);
        const unit = m[2];
        if (unit === undefined || unit === 'm') return n * 60_000;
        switch (unit) {
            case 'S':
            case 's':
                return n * 1_000;
            case 'H':
            case 'h':
                return n * 3_600_000;
            case 'D':
            case 'd':
                return n * 86_400_000;
            case 'W':
            case 'w':
                return n * 604_800_000;
            case 'M': // month — NOT minutes (`m` is minutes)
            case 'mo':
                return n * NAMED_TF_MS.M!;
            case 'Y':
            case 'y':
                return n * NAMED_TF_MS.Y!;
        }
    }
    warnUnparsed(tf);
    return 3_600_000;
}

/** One report per distinct unrecognised resolution — enough to be found, quiet enough
 *  for a value that is read on every resize. */
const WARNED = new Set<string>();
function warnUnparsed(tf: string): void {
    if (WARNED.has(tf) || typeof console === 'undefined') return;
    WARNED.add(tf);
    console.warn(`[vela] unknown timeframe "${tf}" — treating it as 1 hour. Use minutes ("15"), "4h", "1D", "1S" or "3M".`);
}
