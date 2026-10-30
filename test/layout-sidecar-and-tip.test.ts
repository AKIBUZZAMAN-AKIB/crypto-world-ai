// @vitest-environment jsdom
// Two round-9 promises that are invisible until they break:
//
//   1. A saved layout is a NAME and its side-car (preview + timestamp) travels with it.
//      Renaming has to move the preview, deleting has to drop it, and a document from
//      another build must not resurrect a preview for a snapshot that no longer exists.
//   2. The ◌ coach mark appears ONCE — after the grid settles, only while the badge is
//      still empty — and any of its three exits records it as seen.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 0, 2);
const BARS: OHLCV[] = Array.from({ length: 240 }, (_, i) => ({
    time: T0 + i * HOUR,
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
});

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '4', symbol: 'AAA', timeframe: '60', bars: 240, live: false, data: BARS, ...opts } as never);
    live.push(ws);
    return ws;
}

describe('saved-layout side-cars', () => {
    it('moves the preview when a layout is renamed, and drops it on delete', () => {
        const ws = mount();
        ws.saveLayout('Desk');
        // No canvas in jsdom, so the preview is written by hand through the same store
        // the capture would use — the point under test is the KEY, not the JPEG.
        const anyWs = ws as unknown as { layoutMeta: Map<string, { thumb?: string; savedAt?: number }> };
        anyWs.layoutMeta.set('Desk', { thumb: 'data:image/jpeg;base64,AAAA', savedAt: 1700000000000 });

        expect(ws.renameLayout('Desk', 'Night desk')).toBe(true);
        expect(ws.layoutThumb('Night desk')).toBe('data:image/jpeg;base64,AAAA');
        expect(ws.layoutSavedAt('Night desk')).toBe(1700000000000);
        expect(ws.layoutThumb('Desk')).toBeNull();

        ws.deleteLayout('Night desk');
        expect(ws.layoutThumb('Night desk')).toBeNull();
        expect(ws.layoutSavedAt('Night desk')).toBeNull();
    });

    it('does not move the preview onto a name another layout already owns', () => {
        const ws = mount();
        ws.saveLayout('A');
        ws.saveLayout('B');
        const anyWs = ws as unknown as { layoutMeta: Map<string, { thumb?: string }> };
        anyWs.layoutMeta.set('A', { thumb: 'data:image/jpeg;base64,AAAA' });
        anyWs.layoutMeta.set('B', { thumb: 'data:image/jpeg;base64,BBBB' });
        // Refused rename (the target exists) — neither preview may be touched.
        expect(ws.renameLayout('A', 'B')).toBe(false);
        expect(ws.layoutThumb('A')).toBe('data:image/jpeg;base64,AAAA');
        expect(ws.layoutThumb('B')).toBe('data:image/jpeg;base64,BBBB');
    });

    it('prunes side-cars that name a snapshot the document does not have', () => {
        const ws = mount();
        ws.saveLayout('Kept');
        const state = ws.getState() as unknown as Record<string, unknown>;
        state.layoutMeta = {
            Kept: { thumb: 'data:image/jpeg;base64,AAAA' },
            Ghost: { thumb: 'data:image/jpeg;base64,BBBB', savedAt: 1 },
        };
        const next = mount();
        next.applyState(state as never);
        expect(next.layoutThumb('Kept')).toBe('data:image/jpeg;base64,AAAA');
        expect(next.layoutThumb('Ghost')).toBeNull();
    });

    it('never writes a side-car for a blank name', () => {
        const ws = mount();
        expect(ws.saveLayoutWithThumbnail('   ')).toBe(false);
        const anyWs = ws as unknown as { layoutMeta: Map<string, unknown> };
        expect(anyWs.layoutMeta.size).toBe(0);
    });
});

describe('minimal sync badge', () => {
    it('keeps the sync badge without showing an unsolicited guide', async () => {
        vi.useFakeTimers();
        const ws = mount({ layout: '4' });
        const badge = ws.cells()[0]?.groupBadgeAnchor();
        expect(badge).not.toBeNull();
        expect(badge!.hasAttribute('data-empty')).toBe(true);
        await vi.advanceTimersByTimeAsync(2000);
        expect(document.querySelector('.vela-tip')).toBeNull();
        ws.setGroupFor('symbol', ws.cells()[0]!.id, 'red');
        expect(document.querySelector('.vela-tip')).toBeNull();
        vi.useRealTimers();
    });

    it('still round-trips seen-tip metadata from existing workspaces', () => {
        const ws = mount({ layout: '4' });
        ws.markTipSeen('group-badge');
        const again = mount({ layout: '4' });
        again.applyState(ws.getState());
        expect(again.hasSeenTip('group-badge')).toBe(true);
    });
});
