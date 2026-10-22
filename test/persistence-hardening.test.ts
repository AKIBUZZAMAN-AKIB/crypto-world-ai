// @vitest-environment jsdom
// Persistence under pressure: a full quota, a document from a NEWER build, and a second
// tab writing the same key. Each used to fail silently — the layout simply was not there
// next time — so each now has a defined, observable behaviour.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { decodeStateDetailed, encodeState } from '../src/state/document';
import { localStorageAdapter, storageFailureKind, type StorageFailure, type VelaStorage } from '../src/widget/persist';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const BARS: OHLCV[] = Array.from({ length: 120 }, (_, i) => ({
    time: Date.UTC(2024, 0, 2) + i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
}));

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
    localStorage.clear();
});

function mount(storage?: VelaStorage): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout: '4',
        symbol: 'AAA',
        timeframe: '60',
        bars: 120,
        live: false,
        data: BARS,
        persist: 'hardening-test',
        ...(storage ? { storage } : {}),
    } as never);
    live.push(ws);
    return ws;
}

describe('storageFailureKind', () => {
    it('classifies quota, blocked, and everything else', () => {
        const quota = new DOMException('full', 'QuotaExceededError');
        const blocked = new DOMException('nope', 'SecurityError');
        expect(storageFailureKind(quota)).toBe('quota');
        expect(storageFailureKind(blocked)).toBe('blocked');
        expect(storageFailureKind(new Error('weird'))).toBe('unknown');
        // Legacy Safari / old Firefox expose a code, not a name.
        expect(storageFailureKind({ code: 22 })).toBe('quota');
        expect(storageFailureKind({ code: 1014 })).toBe('quota');
        expect(storageFailureKind({ code: 18 })).toBe('blocked');
    });

    it('reports through the adapter without throwing', () => {
        // A store with something in it: the MDN availability probe treats QuotaExceeded
        // against an EMPTY store as "unavailable", not "full".
        localStorage.setItem('filler', 'x');
        const failures: StorageFailure[] = [];
        const adapter = localStorageAdapter({ onError: (f) => failures.push(f) });
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(() => adapter.set('k', 'v')).not.toThrow();
        expect(failures).toHaveLength(1);
        expect(failures[0]?.kind).toBe('quota');
        spy.mockRestore();
    });
});

describe('a full quota', () => {
    it('drops the previews, keeps saving, and says what happened', async () => {
        const ws = mount();
        ws.saveLayoutWithThumbnail('Desk');
        // jsdom has no canvas, so plant a preview the way the capture would.
        const anyWs = ws as unknown as { layoutMeta: Map<string, { thumb?: string; savedAt?: number }> };
        anyWs.layoutMeta.set('Desk', { thumb: 'data:image/jpeg;base64,AAAA', savedAt: 1 });

        // The quota refuses any payload carrying a preview JPEG. Everything else lands.
        localStorage.setItem('filler', 'x');
        const writes: string[] = [];
        const original = localStorage.setItem.bind(localStorage);
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
            if (v.includes('data:image/')) throw new DOMException('full', 'QuotaExceededError');
            writes.push(v);
            original(k, v);
        });
        (ws as unknown as { persistNow: () => void }).persistNow();
        spy.mockRestore();

        expect((ws as unknown as { slimOnQuota: boolean }).slimOnQuota).toBe(true);
        // The retry happened automatically, and what reached storage has no previews …
        expect(writes.length).toBeGreaterThan(0);
        expect(writes.every((w) => !w.includes('data:image/'))).toBe(true);
        // … while the layout itself is still there, name, cells and all.
        const stored = JSON.parse(writes[writes.length - 1]!) as { layoutMeta?: Record<string, { thumb?: string }> };
        expect(stored.layoutMeta?.Desk).toBeDefined();
        expect(stored.layoutMeta?.Desk?.thumb).toBeUndefined();
    });
});

describe('version handling', () => {
    const doc = (over: Record<string, unknown>): string =>
        JSON.stringify({ version: 1, layout: '4', charts: [{ id: 'c1', symbol: 'AAA', timeframe: '60' }], ...over });

    it('refuses a document from the future and says why', () => {
        const result = decodeStateDetailed(doc({ version: 9 }));
        expect(result.state).toBeNull();
        expect(result.reason).toBe('future');
        expect(result.version).toBe(9);
    });

    it('accepts a document with no version field (pre-versioned fixtures)', () => {
        const raw = JSON.stringify({ layout: '4', charts: [{ id: 'c1', symbol: 'AAA', timeframe: '60' }] });
        expect(decodeStateDetailed(raw).state?.layout).toBe('4');
    });

    it('reports garbage as not-json rather than corrupting anything', () => {
        expect(decodeStateDetailed('{nope').reason).toBe('not-json');
    });

    it('copies an unreadable payload aside instead of overwriting it', () => {
        const raw = doc({ version: 9, layout: '16' });
        localStorage.setItem('hardening-test', raw);
        const ws = mount();
        // The background wrote the rescue copy before the first save.
        expect(localStorage.getItem('hardening-test:unreadable')).toBe(raw);
        // …and the workspace still came up on defaults.
        expect(ws.cells().length).toBe(4);
    });
});

describe('another tab', () => {
    it('announces a foreign write and leaves this tab\u2019s document alone', () => {
        const ws = mount();
        const seen: string[] = [];
        ws.on('state:external', (e) => seen.push(e.key));
        const other = encodeState({ version: 1, layout: '1', charts: [{ id: 'c1', symbol: 'ZZZ', timeframe: '60' }] });
        window.dispatchEvent(new StorageEvent('storage', { key: 'hardening-test', newValue: other }));
        expect(seen).toEqual(['hardening-test']);
        // NOT adopted: the local grid is still the four-chart one.
        expect(ws.cells().length).toBe(4);
    });

    it('ignores writes to other keys and clears', () => {
        const ws = mount();
        const seen: string[] = [];
        ws.on('state:external', (e) => seen.push(e.key));
        window.dispatchEvent(new StorageEvent('storage', { key: 'someone-else', newValue: '{}' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'hardening-test', newValue: null }));
        expect(seen).toEqual([]);
    });
});
