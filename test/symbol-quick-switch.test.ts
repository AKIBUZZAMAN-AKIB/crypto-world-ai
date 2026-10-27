// @vitest-environment jsdom
// R86 Task 4 — the coin-pair button walks the watchlist with a wheel / drag / arrow key,
// without opening the symbol picker. The chart stays visible for a quick scan.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { installSymbolQuickSwitch, canonicalTicker } from '../src/widget/symbol-quick-switch';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mount(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1' } as never);
    live.push(ws);
    return ws;
}

function pointer(type: string, y: number): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientY: y, clientX: 20, pointerId: 1, isPrimary: true, pointerType: 'touch' });
    return e;
}

describe('quick symbol switch', () => {
    it('normalizes prefixed and bare tickers for list placement', () => {
        expect(canonicalTicker('BINANCE:BTCUSDT')).toBe('BTCUSDT');
        expect(canonicalTicker('ethusdt')).toBe('ETHUSDT');
    });

    it('a wheel step calls the callback and never triggers a button click', () => {
        const button = document.createElement('button');
        document.body.append(button);
        let clicks = 0;
        const steps: number[] = [];
        button.addEventListener('click', () => { clicks += 1; });
        installSymbolQuickSwitch(button, (d) => steps.push(d));
        button.dispatchEvent(new WheelEvent('wheel', { deltaY: 70, bubbles: true, cancelable: true }));
        button.dispatchEvent(new WheelEvent('wheel', { deltaY: -140, bubbles: true, cancelable: true }));
        expect(steps).toEqual([1, -1, -1]);
        expect(clicks).toBe(0);
        expect(button.dataset.quickSymbol).toBe('1');
        expect(button.style.touchAction).toBe('none');
    });

    it('ArrowDown/ArrowUp on the focused button walk the list', () => {
        const button = document.createElement('button');
        document.body.append(button);
        const steps: number[] = [];
        installSymbolQuickSwitch(button, (d) => steps.push(d));
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, cancelable: true }));
        expect(steps).toEqual([1, -1, -1]);
    });

    it('a vertical drag steps symbols but swallows the tap that would open the picker', () => {
        const button = document.createElement('button');
        document.body.append(button);
        let clicks = 0;
        const steps: number[] = [];
        button.addEventListener('click', () => { clicks += 1; });
        installSymbolQuickSwitch(button, (d) => steps.push(d));
        button.dispatchEvent(pointer('pointerdown', 200));
        button.dispatchEvent(pointer('pointermove', 180));
        button.dispatchEvent(pointer('pointermove', 140));
        button.dispatchEvent(pointer('pointerup', 140));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(steps).toEqual([1, 1]);
        expect(clicks).toBe(0);
    });

    it('workspace walks its watchlist forward and backward without opening a panel', () => {
        const ws = mount();
        ws.addToWatchlist('BTCUSDT');
        ws.addToWatchlist('ETHUSDT');
        ws.addToWatchlist('SOLUSDT');
        expect(ws.quickSymbolList().map(canonicalTicker)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(ws.stepQuickSymbol(1)).toBe('ETHUSDT');
        expect(canonicalTicker(ws.active.symbol)).toBe('ETHUSDT');
        expect(ws.stepQuickSymbol(-1)).toBe('BTCUSDT');
        expect(canonicalTicker(ws.active.symbol)).toBe('BTCUSDT');
        expect(ws.stepQuickSymbol(-1)).toBe('SOLUSDT');
    });
});
