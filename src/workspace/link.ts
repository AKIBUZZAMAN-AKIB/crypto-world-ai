// TAB LINKING — TradingView Desktop's colored tab link, for workspaces that live in
// more than one place (two `VelaWorkspace` instances on a page, two browser tabs, two
// windows). Each workspace joins a TAG; every market change on a linked workspace's
// ACTIVE cell is broadcast to the others carrying the same tag, which apply it to THEIR
// active cell. The three linked dimensions are TradingView's: symbol, interval, and
// (with `timeAndRange`) the visible range.
//
// Transport: a same-page registry (synchronous, no serialization) PLUS a
// `BroadcastChannel` when the platform has one, so separate tabs/windows link too.
// Messages carry a sender id — a workspace never applies its own echo back.

/** One linked change. `range` is present only when the sender links time/date range. */
export interface LinkedMarket {
    symbol?: string;
    timeframe?: string;
    range?: { from: number; to: number };
}

interface Envelope extends LinkedMarket {
    /** Sender identity — a receiver ignores its own broadcasts. */
    from: string;
    tag: string;
}

interface Peer {
    /** This handle's own identity — also the `from` of everything it sends, so the
     *  same-page registry can skip the sender without muting its peers (a page-wide id
     *  would mute every peer on the page: they would all look like self-echoes). */
    id: string;
    tag: string;
    apply: (m: LinkedMarket) => void;
}

const CHANNEL_NAME = 'vela-workspace-link';
const peers = new Map<string, Peer>();
let channel: BroadcastChannel | null = null;
let seq = 0;
const selfId = (): string => {
    const g = globalThis as { __velaLinkId?: string };
    return (g.__velaLinkId ??= `w${Date.now().toString(36)}${(seq += 1).toString(36)}`);
};

function ensureChannel(): BroadcastChannel | null {
    if (channel) return channel;
    const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (typeof Ctor !== 'function') return null;
    try {
        channel = new Ctor(CHANNEL_NAME);
        channel.onmessage = (e: MessageEvent<Envelope>) => deliver(e.data);
    } catch {
        channel = null;
    }
    return channel;
}

function deliver(m: Envelope | null | undefined): void {
    if (!m || typeof m.tag !== 'string') return;
    for (const peer of peers.values()) {
        if (peer.tag !== m.tag || peer.id === m.from) continue;
        const payload: LinkedMarket = {
            ...(typeof m.symbol === 'string' ? { symbol: m.symbol } : {}),
            ...(typeof m.timeframe === 'string' ? { timeframe: m.timeframe } : {}),
            ...(m.range && Number.isFinite(m.range.from) && Number.isFinite(m.range.to) ? { range: { from: m.range.from, to: m.range.to } } : {}),
        };
        if (Object.keys(payload).length === 0) continue;
        try {
            peer.apply(payload);
        } catch (err) {
            console.warn('[vela] linked workspace failed to apply a market:', err);
        }
    }
}

/** A handle a workspace keeps: set/clear its tag, broadcast, and detach on destroy. */
export interface LinkHandle {
    setTag(tag: string | null): void;
    /** Broadcast one change to every other workspace on the same tag. */
    send(market: LinkedMarket): void;
    destroy(): void;
}

/**
 * Join the link registry. `apply` runs for every change a PEER broadcasts on the tag
 * this handle currently holds. Cheap when unused: nothing is registered until `setTag`.
 */
export function joinWorkspaceLink(apply: (m: LinkedMarket) => void): LinkHandle {
    const id = `${selfId()}:${(seq += 1).toString(36)}`;
    const handle: LinkHandle = {
        setTag(tag: string | null): void {
            if (tag) {
                peers.set(id, { id, tag, apply });
                ensureChannel();
            } else {
                peers.delete(id);
            }
        },
        send(market: LinkedMarket): void {
            const peer = peers.get(id);
            if (!peer) return;
            const env: Envelope = { ...market, from: id, tag: peer.tag };
            deliver(env); // same page, synchronously
            channel?.postMessage(env); // other tabs/windows
        },
        destroy(): void {
            peers.delete(id);
        },
    };
    return handle;
}

/** How many workspaces are currently linked under `tag` (diagnostics/tests). */
export function linkedPeerCount(tag: string): number {
    let n = 0;
    for (const p of peers.values()) if (p.tag === tag) n += 1;
    return n;
}
