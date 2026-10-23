// Favourites — the star system the chart-type sheet (and, later, any picker) shares.
//
// TradingView's model: a star sits on every entry of a picker, the starred entries are
// pinned to the top of that picker AND readable as a filtered list of their own, and the
// set follows the user rather than the tab. This module is the storage half of that —
// a tiny, dependency-free, localStorage-backed set per KIND, with change notifications
// so an open surface repaints without polling.
//
// Failure is silent on purpose: a locked-down browser (Safari private mode) must not
// break a picker because a star could not be saved. The in-memory copy still works for
// the session, which is exactly what the user sees.
import type { Unsubscribe } from '../core/util/types';

const KEY = 'vela-favorites-v1';

/** The pickers that own a favourites set. New kinds need no schema change. */
export type FavoriteKind = 'chartTypes' | 'drawings' | 'indicators' | 'timeframes';

type Bag = Partial<Record<FavoriteKind, string[]>>;

/** How many recently-used ids one kind remembers. */
export const RECENT_CAP = 6;

const listeners = new Set<() => void>();
/** The session copy: the source of truth when storage is unavailable, and the cache
 *  that keeps every read synchronous (a star press must repaint on the same tick). */
let cache: Bag | null = null;

function storage(): Storage | null {
    try {
        const s = (globalThis as { localStorage?: Storage }).localStorage;
        // Touch it: Safari private mode throws on the access itself in old versions.
        if (!s) return null;
        const probe = `${KEY}-probe`;
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
    } catch {
        return null;
    }
}

function load(): Bag {
    if (cache) return cache;
    const s = storage();
    let parsed: unknown = null;
    try {
        const raw = s?.getItem(KEY) ?? null;
        parsed = raw ? JSON.parse(raw) : null;
    } catch {
        parsed = null;
    }
    const bag: Bag = {};
    if (parsed && typeof parsed === 'object') {
        for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(value)) bag[kind as FavoriteKind] = value.filter((v): v is string => typeof v === 'string');
        }
    }
    cache = bag;
    return bag;
}

function save(bag: Bag): void {
    cache = bag;
    try {
        storage()?.setItem(KEY, JSON.stringify(bag));
    } catch {
        /* the session copy carries on */
    }
    for (const fn of [...listeners]) fn();
}

/** The starred ids of one kind, in the order they were starred. */
export function favoritesOf(kind: FavoriteKind): readonly string[] {
    return load()[kind] ?? [];
}

export function isFavorite(kind: FavoriteKind, id: string): boolean {
    return (load()[kind] ?? []).includes(id);
}

/** Star/unstar one id. Returns the NEW state (true = starred). */
export function toggleFavorite(kind: FavoriteKind, id: string): boolean {
    const bag = load();
    const list = bag[kind] ?? [];
    const had = list.includes(id);
    const next = had ? list.filter((v) => v !== id) : [...list, id];
    save({ ...bag, [kind]: next });
    return !had;
}

/** Drop every id of one kind that the caller no longer recognises (a saved star for a
 *  plugin type that is not registered any more must not leak into a picker). */
export function pruneFavorites(kind: FavoriteKind, known: readonly string[]): void {
    const bag = load();
    const list = bag[kind] ?? [];
    const next = list.filter((id) => known.includes(id));
    if (next.length !== list.length) save({ ...bag, [kind]: next });
}

export function onFavoritesChange(fn: () => void): Unsubscribe {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// ── recents ────────────────────────────────────────────────────────────────────
// TradingView keeps a short "recently used" strip beside the favourites: a trader
// repeats the same three tools all session, and a star is too strong a commitment for
// something they may drop tomorrow. Recents are per KIND, newest first, capped.

function recentsBag(bag: Bag): Record<string, string[]> {
    return ((bag as { recent?: Record<string, string[]> }).recent ?? {}) as Record<string, string[]>;
}

/** The recently used ids of one kind, newest first. */
export function recentOf(kind: FavoriteKind): readonly string[] {
    return recentsBag(load())[kind] ?? [];
}

/** Push an id to the front of a kind's recent list (dedup, capped). */
export function recordRecent(kind: FavoriteKind, id: string): void {
    const bag = load();
    const recent = recentsBag(bag);
    const next = [id, ...(recent[kind] ?? []).filter((v) => v !== id)].slice(0, RECENT_CAP);
    save({ ...bag, recent: { ...recent, [kind]: next } } as Bag);
}

/** Test seam: forget the cache (a fresh read hits storage again). */
export function resetFavoritesCache(): void {
    cache = null;
}
