// PER-LAYOUT SHARE LINK — one saved layout, in a URL (Tier-2 #8).
//
// The workspace already ships a share link: `#s1=` (gzip) / `#s0=` (plain), built by
// `state/share.ts` over the SAME document everything else reads. A layout link must not
// invent a second codec — it is the same bytes with a different PREFIX:
//
//     #s1=…  open this whole workspace
//     #l1=…  import this layout into your saved layouts, then open it
//
// Why a prefix and not a `&layout=1` flag: the prefix is what a reader can decide on
// before it spends a decompression, and it keeps old links working untouched. Why the
// layout is the whole WorkspaceState: a saved layout IS a workspace snapshot (that is how
// `exportLayout` writes it), so the reader's sanitizer is already the right one and a
// layout link can never smuggle in a document shape a file could not.
import { decodeShareHash, encodeShareHash } from '../state/share';
import type { WorkspaceState } from '../state/document';

/** Layout-link prefixes — the `s` of the workspace codec, moved to `l`. */
export const LAYOUT_HASH_GZIP = '#l1=';
export const LAYOUT_HASH_RAW = '#l0=';

/** True for a fragment carrying a LAYOUT (as opposed to a whole workspace). */
export function isLayoutShareHash(hash: string | null | undefined): boolean {
    const h = (hash ?? '').trim();
    return h.startsWith(LAYOUT_HASH_GZIP) || h.startsWith(LAYOUT_HASH_RAW);
}

/** `#l1=…` → `#s1=…` — the workspace codec reads its own prefix, so map before handing over. */
export function toWorkspaceHash(hash: string): string {
    const h = hash.trim();
    if (h.startsWith(LAYOUT_HASH_GZIP)) return `#s1=${h.slice(LAYOUT_HASH_GZIP.length)}`;
    if (h.startsWith(LAYOUT_HASH_RAW)) return `#s0=${h.slice(LAYOUT_HASH_RAW.length)}`;
    return h;
}

/** The inverse: a workspace fragment re-labelled as a layout fragment. */
export function toLayoutHash(hash: string): string {
    const h = hash.trim();
    if (h.startsWith('#s1=')) return LAYOUT_HASH_GZIP + h.slice(4);
    if (h.startsWith('#s0=')) return LAYOUT_HASH_RAW + h.slice(4);
    return h;
}

/** The layout's fragment (`#l1=…`), compressed exactly like a workspace share link. */
export async function encodeLayoutShareHash(state: WorkspaceState): Promise<string> {
    return toLayoutHash(await encodeShareHash(state));
}

/**
 * The layout state inside a fragment — null for anything that is not a layout link, or
 * that this build cannot decode (a truncated paste, a link from a newer schema).
 */
export async function decodeLayoutShareHash(hash: string): Promise<WorkspaceState | null> {
    if (!isLayoutShareHash(hash)) return null;
    return decodeShareHash(toWorkspaceHash(hash));
}

/** A full URL for the layout, keeping the host page's origin + path. */
export async function layoutShareUrl(state: WorkspaceState, base?: string): Promise<string> {
    const href =
        base ??
        (typeof location !== 'undefined' && location.href ? location.href : 'https://vela.local/workspace.html');
    const url = new URL(href);
    url.hash = await encodeLayoutShareHash(state);
    return url.toString();
}
