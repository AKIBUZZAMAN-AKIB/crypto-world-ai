// @vitest-environment jsdom
// The HIDDEN CHARTS list (R54): a smaller layout parks the charts it no longer shows —
// and the phone's More sheet now lists them BY NAME and brings one back with a tap. The
// bar's More stop carries the count, so "where did my ETH chart go" has an answer that
// is a ticker, not a number.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

const FOUR = { layout: '4' };
/** Give the four slots four markets — through the CELL API, not `opts.cells`, so the boot
 *  seed has no per-slot fallback: a chart that came back from the pool must carry its own
 *  symbol, not the workspace default (the browser check caught exactly that once). */
const MARKETS: Array<[string, string]> = [
    ['BTCUSDT', '60'],
    ['ETHUSDT', '15'],
    ['SOLUSDT', '240'],
    ['ADAUSDT', 'D'],
];
function fourMarkets(): VelaWorkspace {
    const ws = mount(FOUR);
    ws.cells().forEach((cell, i) => {
        cell.setSymbol(MARKETS[i]![0]);
        cell.setTimeframe(MARKETS[i]![1]);
    });
    return ws;
}

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { live: false, ...opts } as never);
    live.push(ws);
    return ws;
}

describe('hidden charts have names', () => {
    it('a 4 → 1 shrink parks three charts, and the list names each one', () => {
        const ws = fourMarkets();
        expect(ws.cells()).toHaveLength(4);
        ws.setLayout('1');
        expect(ws.cells()).toHaveLength(1);
        expect(ws.hiddenChartCount).toBe(3);
        const list = ws.hiddenChartList();
        expect(list).toHaveLength(3);
        expect(list.map((h) => h.symbol).sort()).toEqual(['ADAUSDT', 'ETHUSDT', 'SOLUSDT']);
        // The interval travels with the name — the list is a chart's identity, not a slot.
        expect(list.find((h) => h.symbol === 'ETHUSDT')?.timeframe).toBe('15m');
        expect(list.find((h) => h.symbol === 'ADAUSDT')?.timeframe).toBe('1D');
    });

    it('bringing one back trades it with the active pane — the grid keeps its shape', () => {
        const ws = fourMarkets();
        ws.setLayout('1');
        const leaving = ws.active.symbol;
        const target = ws.hiddenChartList().find((h) => h.symbol === 'ETHUSDT')!;
        expect(ws.showHiddenChart(target.id)).toBe(true);
        expect(ws.cells()).toHaveLength(1); // no layout change
        expect(ws.active.symbol).toContain('ETHUSDT');
        expect(ws.active.timeframe).toBe('15');
        // …and the chart that WAS active took its place in the list.
        expect(ws.hiddenChartCount).toBe(3);
        expect(ws.hiddenChartList().map((h) => h.symbol)).toContain(leaving);
        expect(ws.hiddenChartList().map((h) => h.symbol)).not.toContain('ETHUSDT');
    });

    it('showing a chart that is already on the grid just activates it', () => {
        const ws = fourMarkets();
        const first = ws.cells()[0]!;
        expect(ws.showHiddenChart(first.id)).toBe(true);
        expect(ws.active.id).toBe(first.id);
        expect(ws.hiddenChartCount).toBe(0);
    });

    it('an unknown id is refused, not guessed at', () => {
        const ws = fourMarkets();
        ws.setLayout('1');
        expect(ws.showHiddenChart('nope')).toBe(false);
        expect(ws.cells()).toHaveLength(1);
        expect(ws.hiddenChartCount).toBe(3);
    });

    it('the phone bar’s More stop is told the count', () => {
        const ws = fourMarkets();
        ws.setLayout('1');
        const badge = ws.root.querySelector<HTMLElement>('.vela-mb-more .vela-mb-badge')!;
        expect(badge).not.toBeNull();
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBe('3');
        // …and the count follows the pool back down when the charts return.
        ws.setLayout('4');
        const after = ws.root.querySelector<HTMLElement>('.vela-mb-more .vela-mb-badge')!;
        expect(after.hidden).toBe(true);
    });

    it('removing the hidden charts clears the badge, and Undo puts the list back', () => {
        const ws = fourMarkets();
        ws.setLayout('1');
        expect(ws.clearPooled()).toBe(3);
        expect(ws.hiddenChartList()).toEqual([]);
        expect(ws.root.querySelector<HTMLElement>('.vela-mb-more .vela-mb-badge')!.hidden).toBe(true);
        expect(ws.restorePooled()).toBe(3);
        expect(ws.hiddenChartList()).toHaveLength(3);
    });
});
