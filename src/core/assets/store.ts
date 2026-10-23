// THE ASSET STORE (Tier-3 #14, first half).
//
// An Image object has to answer two questions a drawing never had to: where do the bytes
// live, and how big may a document get? A drawing is a handful of numbers; a pasted
// screenshot is 200 KB per copy, and a layout that stacks ten of them is a document no
// share link can carry.
//
// So the store is deliberately small and strict:
//   * content-addressed — the same image pasted twice lands once (an id derived from the
//     bytes), so duplicates cost nothing;
//   * bounded — a per-asset cap and a per-document cap, both refused at `put` rather than
//     discovered at save time;
//   * serializable — `toJSON`/`fromJSON` round-trip a plain, versioned record, so an asset
//     rides the same document pipeline (and the same sanitizer) as everything else;
//   * DOM-free — it takes a data URL string, not a Blob or a File, so the model can live in
//     a worker or a test.
//
// What it is NOT: a cache of remote URLs, and not a renderer. Decoding is the renderer's
// job (`<img src=dataUrl>`); this decides WHAT may be kept.

/** Every asset the store accepts must be an image. A layout is not a file browser. */
export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;
export type AssetMime = (typeof ALLOWED_MIME)[number];

/** One stored image. `bytes` is the decoded size, so the budget never has to re-decode. */
export interface StoredAsset {
    id: string;
    mime: AssetMime;
    /** The original data URL (what `<img>` consumes). */
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
}

export interface AssetStoreLimits {
    /** Largest single asset (default 2 MB decoded). */
    maxAssetBytes?: number;
    /** Largest total across the document (default 8 MB). */
    maxTotalBytes?: number;
    /** Largest pixel edge (default 4096) — keeps a sheet's memory sane on a phone. */
    maxEdge?: number;
}

export const DEFAULT_ASSET_LIMITS: Required<AssetStoreLimits> = {
    maxAssetBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    maxEdge: 4096,
};

export type AssetPutResult =
    | { ok: true; asset: StoredAsset; deduped: boolean }
    | { ok: false; reason: 'mime' | 'size' | 'budget' | 'shape' | 'malformed' };

/** FNV-1a over the payload — a stable id without a crypto dependency. */
function hashId(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `img_${h.toString(36)}`;
}

/** Rough decoded size of a base64 payload (4 chars → 3 bytes, minus padding). */
function base64Bytes(b64: string): number {
    const clean = b64.replace(/\s+/g, '');
    const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
}

function parseDataUrl(dataUrl: string): { mime: string; b64: string } | null {
    const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[a-z0-9=.-]+)*;base64,(.*)$/is.exec(dataUrl.trim());
    if (!m) return null;
    return { mime: m[1]!.toLowerCase(), b64: m[2]! };
}

export class AssetStore {
    private readonly byId = new Map<string, StoredAsset>();
    private readonly limits: Required<AssetStoreLimits>;

    constructor(limits: AssetStoreLimits = {}) {
        this.limits = { ...DEFAULT_ASSET_LIMITS, ...limits };
    }

    /** Total decoded bytes held (the number the budget is measured against). */
    totalBytes(): number {
        let n = 0;
        for (const a of this.byId.values()) n += a.bytes;
        return n;
    }

    list(): StoredAsset[] {
        return [...this.byId.values()];
    }

    get(id: string): StoredAsset | null {
        return this.byId.get(id) ?? null;
    }

    /**
     * Keep an image. `width`/`height` are the DECODED pixel size (the caller has already
     * measured it — the store never decodes), and are what the edge cap is checked on.
     */
    put(dataUrl: string, size: { width: number; height: number }): AssetPutResult {
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) return { ok: false, reason: 'malformed' };
        const mime = parsed.mime as AssetMime;
        if (!(ALLOWED_MIME as readonly string[]).includes(mime)) return { ok: false, reason: 'mime' };
        const bytes = base64Bytes(parsed.b64);
        if (bytes <= 0 || bytes > this.limits.maxAssetBytes) return { ok: false, reason: 'size' };
        const { width, height } = size;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ok: false, reason: 'shape' };
        if (width > this.limits.maxEdge || height > this.limits.maxEdge) return { ok: false, reason: 'shape' };

        const id = hashId(`${mime}:${width}x${height}:${parsed.b64.length}:${parsed.b64.slice(0, 64)}`);
        const existing = this.byId.get(id);
        if (existing) return { ok: true, asset: existing, deduped: true };
        if (this.totalBytes() + bytes > this.limits.maxTotalBytes) return { ok: false, reason: 'budget' };

        const asset: StoredAsset = { id, mime, dataUrl, width, height, bytes };
        this.byId.set(id, asset);
        return { ok: true, asset, deduped: false };
    }

    remove(id: string): boolean {
        return this.byId.delete(id);
    }

    clear(): void {
        this.byId.clear();
    }

    /** Plain, versioned record — what a document persists. */
    toJSON(): { version: 1; assets: StoredAsset[] } {
        return { version: 1, assets: this.list() };
    }

    /**
     * Read a record back. Untrusted input: every field is re-validated through the SAME
     * caps as `put`, so a hand-edited document cannot talk the store past its budget.
     */
    static fromJSON(raw: unknown, limits: AssetStoreLimits = {}): AssetStore {
        const store = new AssetStore(limits);
        if (!raw || typeof raw !== 'object') return store;
        const assets = (raw as { assets?: unknown }).assets;
        if (!Array.isArray(assets)) return store;
        for (const entry of assets) {
            if (!entry || typeof entry !== 'object') continue;
            const a = entry as Partial<StoredAsset>;
            if (typeof a.dataUrl !== 'string') continue;
            const w = typeof a.width === 'number' ? a.width : 0;
            const h = typeof a.height === 'number' ? a.height : 0;
            store.put(a.dataUrl, { width: w, height: h });
        }
        return store;
    }
}
