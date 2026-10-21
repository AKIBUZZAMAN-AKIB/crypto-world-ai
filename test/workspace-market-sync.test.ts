// @vitest-environment jsdom
// The market links (symbol / timeframe) on a live workspace: who follows whom, what a
// layout change does to a linked grid, and what flipping the dropdown switch does (and
// does NOT do) to the pairs already on screen.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
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
});

/** The playground page's shape: four NAMED cells, each with its own market. */
const PAGE = {
    layout: '4',
    symbol: 'BTCUSDT',
    timeframe: '60',
    cells: {
        btc: { symbol: 'BTCUSDT', timeframe: '60' },
        eth: { symbol: 'ETHUSDT', timeframe: '15' },
        sol: { symbol: 'SOLUSDT', timeframe: '240' },
        bnb: { symbol: 'BNBUSDT', timeframe: 'D' },
    },
} as const;

function mountWorkspace(opts: Record<string, unknown>): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, opts as never);
    live.push(ws);
    return ws;
}

/** `id:symbol/timeframe` per live cell, in slot order. */
function pairs(ws: VelaWorkspace): string[] {
    return ws.getState().charts.map((c) => `${c.id}:${c.symbol}/${c.timeframe}`);
}

describe('market links', () => {
    it('symbol and interval follow INDEPENDENTLY: a symbol change leaves every interval alone', () => {
        const ws = mountWorkspace({ ...PAGE, sync: { symbol: true } });
        ws.cell('btc')!.setSymbol('XRPUSDT');
        expect(pairs(ws)).toEqual(['btc:XRPUSDT/60', 'eth:XRPUSDT/15', 'sol:XRPUSDT/240', 'bnb:XRPUSDT/D']);
    });

    it('no link: one cell moves, the rest keep their own market', () => {
        const ws = mountWorkspace({ ...PAGE });
        ws.cell('btc')!.setSymbol('XRPUSDT');
        ws.cell('sol')!.setTimeframe('W');
        expect(pairs(ws)).toEqual(['btc:XRPUSDT/60', 'eth:ETHUSDT/15', 'sol:SOLUSDT/W', 'bnb:BNBUSDT/D']);
    });

    it('a layout change brings NEW cells into an all-cells link instead of the workspace defaults', () => {
        const ws = mountWorkspace({ ...PAGE, sync: { symbol: true, timeframe: true } });
        ws.cell('btc')!.setSymbol('XRPUSDT');
        ws.cell('btc')!.setTimeframe('5');
        ws.setLayout('8');
        // The four minted slots inherit the link's market (from a pre-existing peer),
        // not the workspace default BTCUSDT/60 they used to boot on.
        expect(pairs(ws)).toEqual([
            'btc:XRPUSDT/5',
            'eth:XRPUSDT/5',
            'sol:XRPUSDT/5',
            'bnb:XRPUSDT/5',
            'c1:XRPUSDT/5',
            'c2:XRPUSDT/5',
            'c3:XRPUSDT/5',
            'c4:XRPUSDT/5',
        ]);
    });

    it('without a link the same layout change keeps the workspace defaults on the new slots', () => {
        const ws = mountWorkspace({ ...PAGE });
        ws.cell('btc')!.setSymbol('XRPUSDT');
        ws.setLayout('8');
        expect(pairs(ws).slice(4)).toEqual(['c1:BTCUSDT/60', 'c2:BTCUSDT/60', 'c3:BTCUSDT/60', 'c4:BTCUSDT/60']);
    });

    it('group records leave a newborn unlinked — it has no entry in the record yet', () => {
        const ws = mountWorkspace({ ...PAGE, sync: { symbol: { btc: 'a', eth: 'a', sol: 'b', bnb: 'b' } } });
        ws.cell('btc')!.setSymbol('XRPUSDT');
        expect(pairs(ws)).toEqual(['btc:XRPUSDT/60', 'eth:XRPUSDT/15', 'sol:SOLUSDT/240', 'bnb:BNBUSDT/D']);
        ws.setLayout('8');
        expect(pairs(ws).slice(4)).toEqual(['c1:BTCUSDT/60', 'c2:BTCUSDT/60', 'c3:BTCUSDT/60', 'c4:BTCUSDT/60']);
    });

    it('enabling through the API aligns the group once; enabling as a LINK does not', () => {
        const ws = mountWorkspace({ ...PAGE });
        ws.setActiveCell('eth');

        // A LINK (the dropdown's switch path): nothing on screen moves — only the next
        // change will fan out.
        ws.sync.set('symbol', true, false);
        expect(pairs(ws)).toEqual(['btc:BTCUSDT/60', 'eth:ETHUSDT/15', 'sol:SOLUSDT/240', 'bnb:BNBUSDT/D']);
        ws.cell('sol')!.setSymbol('ADAUSDT');
        expect(pairs(ws)).toEqual(['btc:ADAUSDT/60', 'eth:ADAUSDT/15', 'sol:ADAUSDT/240', 'bnb:ADAUSDT/D']);

        // The API default (`align = true`) keeps its documented "starts coherent" rule:
        // an API enable snaps the whole group onto the active cell's symbol.
        ws.sync.set('symbol', false, false); // unlink…
        ws.cell('btc')!.setSymbol('XRPUSDT'); // …give the cells their own markets back…
        ws.cell('eth')!.setSymbol('ETHUSDT');
        ws.cell('sol')!.setSymbol('ADAUSDT');
        ws.cell('bnb')!.setSymbol('BNBUSDT');
        expect(pairs(ws)).toEqual(['btc:XRPUSDT/60', 'eth:ETHUSDT/15', 'sol:ADAUSDT/240', 'bnb:BNBUSDT/D']);

        ws.sync.set('symbol', true); // …then enable through the API (align defaults to true)
        expect(pairs(ws).map((p) => p.split(':')[1]!.split('/')[0])).toEqual(['ETHUSDT', 'ETHUSDT', 'ETHUSDT', 'ETHUSDT']);
        // Alignment moves the SYMBOL only — the intervals stay each cell's own.
        expect(pairs(ws).map((p) => p.split('/')[1])).toEqual(['60', '15', '240', 'D']);
    });

    it('the layout dropdown’s Symbol switch links without rewriting the pairs on screen', () => {
        const ws = mountWorkspace({ ...PAGE });
        const root = document.querySelector('.vela-workspace')!;
        const layoutButton = root.querySelector<HTMLElement>('button[aria-label^="Layout"]');
        expect(layoutButton).not.toBeNull();
        layoutButton!.click();
        const rows = [...root.querySelectorAll<HTMLElement>('.vela-lp-sync-row')];
        const symbolRow = rows.find((r) => r.textContent?.includes('Symbol'));
        expect(symbolRow).toBeTruthy();
        expect(symbolRow!.getAttribute('aria-checked')).toBe('false');

        symbolRow!.click();

        // Linked…
        expect(ws.sync.get('symbol')).toBe(true);
        // …and every cell still shows its own pair.
        expect(pairs(ws)).toEqual(['btc:BTCUSDT/60', 'eth:ETHUSDT/15', 'sol:SOLUSDT/240', 'bnb:BNBUSDT/D']);
    });
});
