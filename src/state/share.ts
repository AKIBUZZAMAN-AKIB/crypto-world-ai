// Share links: a whole workspace in a URL fragment.
//
// Why this is cheap here and not a new serialization format: the app already has ONE
// document — `encodeState` — and one reader, `decodeStateDetailed`, that is paranoid
// about input (it was written for localStorage that a user can hand-edit). A share link
// is that same document, compressed and put in the hash. The measured document for a
// 4-chart workspace is 8,238 bytes of JSON; gzip takes it to 992 and base64url to 1,323
// characters, so the whole URL is ~1.4 KB — short enough to paste into a chat.
//
// Two prefixes, because compression is not guaranteed everywhere:
//   #s1=  gzip + base64url (CompressionStream; every current browser)
//   #s0=  plain base64url of UTF-8 JSON (jsdom, old WebViews, tests)
// Decoding accepts either, and anything it cannot read returns null — a broken link
// must fail visibly, never half-apply.
import { encodeState, decodeStateDetailed, type WorkspaceState } from './document';

export const SHARE_HASH_GZIP = '#s1=';
export const SHARE_HASH_RAW = '#s0=';

/** base64url with no padding — the URL-safe alphabet, so a link never needs escaping. */
function toBase64Url(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000; // btoa takes a string; 32k keeps the spread off the stack
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
}

function hasStreams(): boolean {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function gzip(text: string): Promise<Uint8Array | null> {
    if (!hasStreams()) return null;
    try {
        const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

async function gunzip(bytes: Uint8Array): Promise<string | null> {
    if (!hasStreams()) return null;
    try {
        const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).text();
    } catch {
        return null;
    }
}

/**
 * The document as a URL fragment (`#s1=…` or `#s0=…`).
 *
 * Async on purpose: compression is async, and a share link is not a per-frame path. The
 * caller is a click handler, so the await costs one microtask plus a few hundred
 * microseconds of gzip on an 8 KB payload.
 */
export async function encodeShareHash(state: WorkspaceState): Promise<string> {
    const json = encodeState(state);
    const gz = await gzip(json);
    if (gz) return SHARE_HASH_GZIP + toBase64Url(gz);
    return SHARE_HASH_RAW + toBase64Url(new TextEncoder().encode(json));
}

/** A full URL for `state`, with the current `origin` + `pathname` as the base. */
export async function encodeShareUrl(state: WorkspaceState, base?: string): Promise<string> {
    const href =
        base ??
        (typeof location !== 'undefined' && location.href ? location.href : 'https://vela.local/workspace.html');
    const url = new URL(href);
    url.hash = await encodeShareHash(state);
    return url.toString();
}

/**
 * Read a shared document back. Anything that is not a share fragment, or does not decode
 * to a document this build understands, returns null (and the caller keeps the session it
 * has instead of blanking the screen).
 */
export async function decodeShareHash(hash: string): Promise<WorkspaceState | null> {
    const fragment = (hash ?? '').trim();
    if (fragment.startsWith(SHARE_HASH_GZIP)) {
        const bytes = fromBase64UrlSafe(fragment.slice(SHARE_HASH_GZIP.length));
        if (!bytes) return null;
        const text = await gunzip(bytes);
        return text ? readDocument(text) : null;
    }
    if (fragment.startsWith(SHARE_HASH_RAW)) {
        const bytes = fromBase64UrlSafe(fragment.slice(SHARE_HASH_RAW.length));
        if (!bytes) return null;
        try {
            return readDocument(new TextDecoder().decode(bytes));
        } catch {
            return null;
        }
    }
    return null;
}

function fromBase64UrlSafe(text: string): Uint8Array | null {
    const clean = text.trim();
    if (!/^[A-Za-z0-9\-_]+$/.test(clean)) return null;
    try {
        return fromBase64Url(clean);
    } catch {
        return null;
    }
}

function readDocument(json: string): WorkspaceState | null {
    const decoded = decodeStateDetailed(json);
    return decoded.state ?? null;
}
