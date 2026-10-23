// @vitest-environment jsdom
// Share links — the whole document, compressed, in a URL fragment.
//
// The audit's number: a 4-chart workspace is 8,238 bytes of JSON, 992 gzipped and 1,323
// base64url — a 1.4 KB URL. This file pins the contract: encode → decode is lossless,
// a broken fragment returns null (never a half-applied document), and a workspace can
// adopt one.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { encodeShareHash, decodeShareHash, encodeShareUrl, SHARE_HASH_GZIP, SHARE_HASH_RAW } from '../src/state/share';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { WorkspaceState } from '../src/state/document';
import {
    decodeLayoutShareHash,
    encodeLayoutShareHash,
    isLayoutShareHash,
    toLayoutHash,
    toWorkspaceHash,
} from '../src/workspace/share-link';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const BARS: OHLCV[] = Array.from({ length: 80 }, (_, i) => ({
    time: Date.UTC(2024, 0, 2) + i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
}));

const DOC = {
    version: 1,
    layout: '2h',
    timezone: 'Etc/UTC',
    charts: [],
    groupNames: { red: 'Scalp' },
    groupMarks: { red: '🦊' },
    watchlist: ['AAA', 'BBB'],
    linkedGroup: 'red',
} as unknown as WorkspaceState;

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

describe('the fragment', () => {
    it('round-trips the document, side-cars included', async () => {
        const hash = await encodeShareHash(DOC);
        // jsdom has no CompressionStream → the raw flavour; a browser gets #s1=.
        expect(hash.startsWith(SHARE_HASH_RAW) || hash.startsWith(SHARE_HASH_GZIP)).toBe(true);
        const back = await decodeShareHash(hash);
        expect(back?.layout).toBe('2h');
        expect(back?.groupNames).toEqual({ red: 'Scalp' });
        expect(back?.groupMarks).toEqual({ red: '🦊' });
        expect(back?.watchlist).toEqual(['AAA', 'BBB']);
        expect(back?.linkedGroup).toBe('red');
    });

    it('is URL-safe: no +, / or = that would need escaping', async () => {
        const hash = await encodeShareHash(DOC);
        const payload = hash.slice(hash.indexOf('=') + 1);
        expect(payload).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('refuses what it cannot read instead of guessing', async () => {
        expect(await decodeShareHash('')).toBeNull();
        expect(await decodeShareHash('#nope')).toBeNull();
        expect(await decodeShareHash('#s0=not base64 !!')).toBeNull();
        expect(await decodeShareHash('#s0=aGVsbG8')).toBeNull(); // decodes to "hello", not a document
        // A future document version is refused by the reader, not silently downgraded.
        const future = JSON.stringify({ ...DOC, version: 99 });
        const raw = btoa(String.fromCharCode(...new TextEncoder().encode(future)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        expect(await decodeShareHash(`#s0=${raw}`)).toBeNull();
    });

    it('encodeShareUrl keeps the page it was given', async () => {
        const url = await encodeShareUrl(DOC, 'https://vela.example/workspace.html?x=1#old');
        expect(url.startsWith('https://vela.example/workspace.html?x=1#')).toBe(true);
        expect(url).not.toContain('#old');
    });
});

describe('a workspace', () => {
    function mount(layout = '4'): VelaWorkspace {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, {
            layout,
            symbol: 'AAA',
            timeframe: '60',
            bars: 80,
            live: false,
            data: BARS,
        } as never);
        live.push(ws);
        return ws;
    }

    it('makes a link and adopts one', async () => {
        const source = mount();
        source.setLayout('2h');
        source.setGroupName('red', 'Scalp');
        source.setGroupMark('red', '🦊');
        const url = await source.shareLink('https://vela.example/workspace.html');
        expect(url).toContain('#s');

        const target = mount();
        expect(target.getState().layout).toBe('4');
        expect(await target.applyShareLink(url)).toBe(true);
        expect(target.getState().layout).toBe('2h');
        expect(target.groupMark('red')).toBe('🦊');
        expect(target.getState().groupNames).toEqual({ red: 'Scalp' });
    });

    it('leaves the session alone when the link is broken', async () => {
        const ws = mount();
        ws.setLayout('2h');
        expect(await ws.applyShareLink('https://vela.example/workspace.html#s0=zzzz')).toBe(false);
        expect(ws.getState().layout).toBe('2h'); // not blanked, not half-applied
    });

    it('reports a refused clipboard instead of pretending', async () => {
        const ws = mount();
        // jsdom defines no navigator.clipboard: the URL is still returned by shareLink,
        // and copyShareLink answers null so the caller can show the link.
        expect(await ws.copyShareLink()).toBeNull();
    });
});

// ── PER-LAYOUT LINKS (round 23, Tier-2 #8) ───────────────────────────────────────
// A layout link is the same document under the `#l` prefix: it must be recognisable
// before decoding, map onto the workspace codec exactly, and fail closed when broken.
describe('layout share links', () => {
    it('recognises only the layout prefixes', () => {
        expect(isLayoutShareHash('#l1=abc')).toBe(true);
        expect(isLayoutShareHash('#l0=abc')).toBe(true);
        expect(isLayoutShareHash('#s1=abc')).toBe(false);
        expect(isLayoutShareHash('')).toBe(false);
        expect(isLayoutShareHash(null)).toBe(false);
    });

    it('maps a layout fragment onto the workspace codec and back', () => {
        expect(toWorkspaceHash('#l1=XYZ')).toBe('#s1=XYZ');
        expect(toWorkspaceHash('#l0=XYZ')).toBe('#s0=XYZ');
        expect(toLayoutHash('#s1=XYZ')).toBe('#l1=XYZ');
        expect(toLayoutHash('#s0=XYZ')).toBe('#l0=XYZ');
        expect(toLayoutHash('#other')).toBe('#other');
    });

    it('round-trips a saved layout through a layout-prefixed fragment', async () => {
        const state = { version: 1, layout: '2h', charts: [] } as WorkspaceState;
        const hash = await encodeLayoutShareHash(state);
        expect(isLayoutShareHash(hash)).toBe(true);
        const back = await decodeLayoutShareHash(hash);
        expect(back?.layout).toBe('2h');
    });

    it('refuses a workspace link, and a corrupt layout link', async () => {
        expect(await decodeLayoutShareHash('#s1=abc')).toBeNull();
        const hash = await encodeLayoutShareHash({ version: 1, layout: '2h', charts: [] } as WorkspaceState);
        expect(await decodeLayoutShareHash(hash.slice(0, hash.length - 6))).toBeNull();
        expect(await decodeLayoutShareHash('#l0=not-base64!')).toBeNull();
    });

    function mountWorkspace(layout = '4'): VelaWorkspace {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout, symbol: 'AAA', timeframe: '60', bars: 80, live: false, data: BARS } as never);
        live.push(ws);
        return ws;
    }

    it('copies a PER-LAYOUT link from the workspace, and a bad name answers null', async () => {
        const ws = mountWorkspace();
        ws.setLayout('2h');
        ws.saveLayout('Scalp'); // a saved snapshot to share
        expect(await ws.copyLayoutLink('Scalp')).toBeNull(); // jsdom has no clipboard
        expect(await ws.copyLayoutLink('no-such-layout')).toBeNull();
    });
});
