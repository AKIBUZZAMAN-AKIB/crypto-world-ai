// Shell state persistence — pluggable storage. localStorage by default; hosts inject
// any `VelaStorage` (sync like localStorage, or async like a REST/IndexedDB backend).
// The persisted FORMAT is the unified state document (`src/state/document.ts`) — one
// codec for every shell.
//
// FAILURE IS A FEATURE, NOT A SECRET. The default adapter used to swallow every write
// error, so a full quota or a locked-down browser (Safari private mode throws
// `SecurityError` on the FIRST setItem) looked exactly like a save that worked: the
// trader closes the tab and the layout is gone. The adapter now CLASSIFIES the failure
// and hands it to the shell, which degrades honestly (drop previews, then say so) —
// `localStorage` still never throws out of the adapter, because a storage hiccup must
// not break a running chart.
//
// The classification follows the platform: `QuotaExceededError` (Chrome/Firefox/Safari,
// code 22; Firefox legacy 1014), `SecurityError` (blocked storage, code 18), anything
// else is `unknown` and reported as-is.

/** The storage contract BOTH shells persist through (the widget wrapper and the
 *  workspace — one name, one shape). Methods may be synchronous or return promises. */
export interface VelaStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}

/** @deprecated Use {@link VelaStorage} — same contract, shell-neutral name. */
export type WidgetStorage = VelaStorage;

export type StorageFailureKind = 'quota' | 'blocked' | 'unknown';

export interface StorageFailure {
    kind: StorageFailureKind;
    /** The logical key the shell asked for (not the pinned physical one). */
    key: string;
    error: unknown;
}

/** Classify a write failure. Exported because hosts implementing their own adapter
 *  want the same three buckets (and the same copy) as the built-in one. */
export function storageFailureKind(error: unknown): StorageFailureKind {
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
        if (
            error.name === 'QuotaExceededError' ||
            error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            error.code === 22 ||
            error.code === 1014
        ) {
            return 'quota';
        }
        if (error.name === 'SecurityError' || error.code === 18) return 'blocked';
        return 'unknown';
    }
    const legacy = error as { name?: unknown; code?: unknown } | null;
    if (legacy && (legacy.name === 'QuotaExceededError' || legacy.code === 22 || legacy.code === 1014)) return 'quota';
    if (legacy && (legacy.name === 'SecurityError' || legacy.code === 18)) return 'blocked';
    return 'unknown';
}

export interface LocalStorageOptions {
    /** Pin the PHYSICAL localStorage entry (see {@link localStorageAdapter}). */
    storageKey?: string;
    /** Called once per failed write — the shell decides what to do about it. */
    onError?: (failure: StorageFailure) => void;
}

/**
 * The default adapter — window.localStorage, silent on quota/privacy failures.
 *
 * `storageKey` pins the PHYSICAL localStorage entry: every read/write lands on that
 * one name, whatever logical key the shell passes — the way to choose where the state
 * lives without touching the `persist` option (one shell instance per adapter then;
 * two shells sharing a pinned adapter would overwrite each other). Omitted, the
 * shell's own key is used as-is (the historical behavior).
 *
 * A string argument keeps the old signature; the options form adds `onError`.
 */
export function localStorageAdapter(target?: string | LocalStorageOptions): WidgetStorage {
    const opts: LocalStorageOptions = typeof target === 'string' ? { storageKey: target } : (target ?? {});
    const physical = opts.storageKey;
    const report = (key: string, error: unknown, size: number): void => {
        try {
            let kind = storageFailureKind(error);
            // Safari (and Firefox's private mode) give the page an EMPTY storage with a
            // quota of zero: the FIRST write throws QuotaExceededError although nothing
            // is stored. Reporting that as "storage full" would tell the user to delete
            // layouts they do not have — MDN's own availability probe makes the same
            // distinction (`QuotaExceededError` counts as "available" only when the
            // storage is not empty), so an empty store means "unavailable".
            // …but only for a payload a zero-quota store would reject anyway. A big
            // document failing against an EMPTY store is a document that is genuinely
            // too big, not a locked browser, and it deserves the slim-and-retry path.
            if (
                kind === 'quota' &&
                !physical &&
                size < 65_536 &&
                typeof localStorage !== 'undefined' &&
                localStorage.length === 0
            ) {
                kind = 'blocked';
            }
            opts.onError?.({ kind, key, error });
        } catch {
            /* a broken reporter must not break the write path */
        }
    };
    return {
        get(key) {
            try {
                return localStorage.getItem(physical ?? key);
            } catch {
                return null;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(physical ?? key, value);
            } catch (error) {
                report(key, error, value.length);
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(physical ?? key);
            } catch {
                /* best-effort */
            }
        },
    };
}
