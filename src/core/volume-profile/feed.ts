// VOLUME AT PRICE — the FEED (Tier-3 #13).
//
// The gap report was explicit: footprint / SVP / TPO / anchored-VP are "data-provider work
// before rendering work". This module is that work, and it is deliberately renderer-free:
// it turns bars (or trades, when a provider has them) into price buckets plus the three
// numbers every volume-profile renderer needs — POC, VAH, VAL — so a drawing or a native
// indicator is a consumer, not an owner, of the maths.
//
// DISTRIBUTION. A provider bar gives high/low and a total volume, not a price histogram.
// The only honest reconstruction is to spread that volume across the bar's range; the
// choice below is UNIFORM across [low, high] into buckets, with buy/sell split by the
// bar's own direction (close ≥ open ⇒ buy). That is the same approximation the reference's
// own bar-based profiles make, and it is documented here so nobody mistakes it for tick
// data: `buildTradeProfile` is the exact path when trades exist.
export interface ProfileBucket {
    /** Bucket's lower price edge. */
    price: number;
    /** Total volume in the bucket. */
    volume: number;
    /** The buy-side share of `volume` (0 when it came from a bar with no direction). */
    buy: number;
    /** The sell-side share. */
    sell: number;
}

export interface VolumeProfile {
    buckets: ProfileBucket[];
    /** Point of control: the mid-price of the heaviest bucket. */
    poc: number;
    /** Value-area high / low — the band holding `valueAreaPct` of the volume, grown from the POC. */
    vah: number;
    val: number;
    /** Total volume placed. */
    total: number;
    /** The bucket size actually used (after 'auto' resolution). */
    bucketSize: number;
    /** The price span covered. */
    low: number;
    high: number;
}

export interface ProfileOptions {
    /** Bucket height in price units, or `'auto'` for ~80 buckets across the range. */
    bucket?: number | 'auto';
    /** Value area share (the reference's default is 70%). */
    valueAreaPct?: number;
}

export interface ProfileBar {
    high: number;
    low: number;
    close: number;
    open: number;
    volume?: number;
}

export interface Trade {
    price: number;
    /** Signed size: > 0 bought (at the ask), < 0 sold (at the bid). */
    size: number;
}

const AUTO_BUCKETS = 80;

function chooseBucket(low: number, high: number, bucket: number | 'auto' | undefined): number {
    if (typeof bucket === 'number' && Number.isFinite(bucket) && bucket > 0) return bucket;
    const span = Math.max(high - low, Math.abs(high) * 1e-6, 1e-9);
    return span / AUTO_BUCKETS;
}

/** Grow the value area out from the POC, always taking the heavier neighbour. */
function valueArea(buckets: ProfileBucket[], bucketSize: number, pct: number): { vah: number; val: number } {
    if (buckets.length === 0) return { vah: 0, val: 0 };
    let pocIdx = 0;
    for (let i = 1; i < buckets.length; i += 1) if (buckets[i]!.volume > buckets[pocIdx]!.volume) pocIdx = i;
    const target = buckets.reduce((s, b) => s + b.volume, 0) * Math.min(1, Math.max(0.01, pct / 100));
    let covered = buckets[pocIdx]!.volume;
    let lo = pocIdx;
    let hi = pocIdx;
    while (covered < target && (lo > 0 || hi < buckets.length - 1)) {
        const below = lo > 0 ? buckets[lo - 1]!.volume : -1;
        const above = hi < buckets.length - 1 ? buckets[hi + 1]!.volume : -1;
        if (above >= below) {
            hi += 1;
            covered += buckets[hi]!.volume;
        } else {
            lo -= 1;
            covered += buckets[lo]!.volume;
        }
    }
    return { vah: buckets[hi]!.price + bucketSize, val: buckets[lo]!.price };
}

/**
 * Profile from BARS — the provider-backed path. `volume` missing or non-positive bars are
 * skipped (a synthetic Renko brick carries none), so a rebucketed series simply yields an
 * empty profile instead of a misleading one.
 */
export function buildVolumeProfile(bars: readonly ProfileBar[], opts: ProfileOptions = {}): VolumeProfile | null {
    const usable = bars.filter((b) => (b.volume ?? 0) > 0 && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= b.low);
    if (usable.length === 0) return null;
    let low = Infinity;
    let high = -Infinity;
    for (const b of usable) {
        low = Math.min(low, b.low);
        high = Math.max(high, b.high);
    }
    const bucketSize = chooseBucket(low, high, opts.bucket);
    const base = Math.floor(low / bucketSize) * bucketSize;
    const count = Math.max(1, Math.floor((high - base) / bucketSize) + 1);
    const buckets: ProfileBucket[] = Array.from({ length: count }, (_, i) => ({
        price: base + i * bucketSize,
        volume: 0,
        buy: 0,
        sell: 0,
    }));
    const indexOf = (price: number): number =>
        Math.min(count - 1, Math.max(0, Math.floor((price - base) / bucketSize)));

    for (const b of usable) {
        const vol = b.volume ?? 0;
        const span = b.high - b.low;
        const buyShare = b.close >= b.open ? 1 : 0;
        if (span <= 0) {
            const i = indexOf(b.low);
            const bucket = buckets[i]!;
            bucket.volume += vol;
            bucket.buy += vol * buyShare;
            bucket.sell += vol * (1 - buyShare);
            continue;
        }
        // Uniform spread across the buckets the bar actually touches, weighted by the
        // fraction of the bar's range that falls inside each bucket.
        const first = indexOf(b.low);
        const last = indexOf(b.high);
        for (let i = first; i <= last; i += 1) {
            const bLo = base + i * bucketSize;
            const bHi = bLo + bucketSize;
            const overlap = Math.min(bHi, b.high) - Math.max(bLo, b.low);
            if (overlap <= 0) continue;
            const share = overlap / span;
            const bucket = buckets[i]!;
            bucket.volume += vol * share;
            bucket.buy += vol * share * buyShare;
            bucket.sell += vol * share * (1 - buyShare);
        }
    }

    let pocIdx = 0;
    for (let i = 1; i < buckets.length; i += 1) if (buckets[i]!.volume > buckets[pocIdx]!.volume) pocIdx = i;
    const { vah, val } = valueArea(buckets, bucketSize, opts.valueAreaPct ?? 70);
    return {
        buckets,
        poc: buckets[pocIdx]!.price + bucketSize / 2,
        vah,
        val,
        total: buckets.reduce((s, b) => s + b.volume, 0),
        bucketSize,
        low: base,
        high: base + count * bucketSize,
    };
}

/**
 * Profile from TRADES — the exact path, when a provider streams them. Each trade lands
 * whole in its bucket (a print is a print), and the sign splits buy from sell.
 */
export function buildTradeProfile(trades: readonly Trade[], opts: ProfileOptions = {}): VolumeProfile | null {
    const usable = trades.filter((t) => Number.isFinite(t.price) && t.price > 0 && Number.isFinite(t.size) && t.size !== 0);
    if (usable.length === 0) return null;
    let low = Infinity;
    let high = -Infinity;
    for (const t of usable) {
        low = Math.min(low, t.price);
        high = Math.max(high, t.price);
    }
    const bucketSize = chooseBucket(low, high, opts.bucket);
    const base = Math.floor(low / bucketSize) * bucketSize;
    const count = Math.max(1, Math.floor((high - base) / bucketSize) + 1);
    const buckets: ProfileBucket[] = Array.from({ length: count }, (_, i) => ({
        price: base + i * bucketSize,
        volume: 0,
        buy: 0,
        sell: 0,
    }));
    for (const t of usable) {
        const i = Math.min(count - 1, Math.max(0, Math.floor((t.price - base) / bucketSize)));
        const bucket = buckets[i]!;
        const size = Math.abs(t.size);
        bucket.volume += size;
        if (t.size > 0) bucket.buy += size;
        else bucket.sell += size;
    }
    let pocIdx = 0;
    for (let i = 1; i < buckets.length; i += 1) if (buckets[i]!.volume > buckets[pocIdx]!.volume) pocIdx = i;
    const { vah, val } = valueArea(buckets, bucketSize, opts.valueAreaPct ?? 70);
    return {
        buckets,
        poc: buckets[pocIdx]!.price + bucketSize / 2,
        vah,
        val,
        total: buckets.reduce((s, b) => s + b.volume, 0),
        bucketSize,
        low: base,
        high: base + count * bucketSize,
    };
}

/** The bucket carrying `price` (for a crosshair read-out), or null outside the profile. */
export function bucketAt(profile: VolumeProfile, price: number): ProfileBucket | null {
    const i = Math.floor((price - profile.low) / profile.bucketSize);
    return profile.buckets[i] ?? null;
}

/** The profile's delta (buy − sell) — the one number a footprint reader looks for first. */
export function profileDelta(profile: VolumeProfile): number {
    return profile.buckets.reduce((s, b) => s + (b.buy - b.sell), 0);
}
