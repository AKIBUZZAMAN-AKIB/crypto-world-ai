// @vitest-environment jsdom
// The workspace's bar-replay CHROME: the topbar slot, the entry menu, the armed
// "select bar" state, and the floating transport bar following `ws.replay`.
//
// The transport is a view over the PUBLIC replay API — so this test drives sessions
// through `ws.replay` (the same thing code, a contribution or a shortcut would do) and
// checks the chrome catches up, plus the reverse: every press lands in `ws.replay`.
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
const BARS: OHLCV[] = Array.from({ length: 200 }, (_, i) => ({
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

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function mountWorkspace(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', symbol: 'AAA', timeframe: '60', bars: 200, live: false, data: BARS, ...opts } as never);
    live.push(ws);
    return ws;
}

const replayButton = (ws: VelaWorkspace): HTMLButtonElement | null =>
    ws.root.querySelector<HTMLButtonElement>('button.vela-widget-replay');
const transport = (ws: VelaWorkspace): HTMLElement | null => ws.root.querySelector<HTMLElement>('.vela-replay');
const bar = (ws: VelaWorkspace): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-replay-bar')!;
const hint = (ws: VelaWorkspace): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-replay-hint')!;
const grid = (ws: VelaWorkspace): HTMLElement => ws.root.querySelector<HTMLElement>('.vela-ws-grid')!;
const clock = (ws: VelaWorkspace): string => ws.root.querySelector('.vela-replay-clock')!.textContent ?? '';
const left = (ws: VelaWorkspace): string => ws.root.querySelector('.vela-replay-left')!.textContent ?? '';
const playBtn = (ws: VelaWorkspace): HTMLButtonElement => ws.root.querySelector<HTMLButtonElement>('.vela-replay-play')!;
const stepBtn = (ws: VelaWorkspace): HTMLButtonElement => ws.root.querySelector<HTMLButtonElement>('.vela-replay-step')!;
const speedBtn = (ws: VelaWorkspace): HTMLButtonElement => ws.root.querySelector<HTMLButtonElement>('.vela-replay-speed')!;

/** The entry menu's list — the one anchored in the shell root (the toolbar's speed menu
 *  lives inside the grid, so it is never the one this returns). */
function entryList(ws: VelaWorkspace): Element | null {
    const lists = [...ws.root.querySelectorAll('.vela-menu')].filter((el) => !el.closest('.vela-ws-grid'));
    return lists[lists.length - 1] ?? null;
}

/** The list whose FIRST row reads `firstLabel` — the toolbar's speed menu and the entry
 *  menu share one floating layer host, so rows are found by their own content. */
function listStartingWith(ws: VelaWorkspace, firstLabel: string): HTMLElement {
    const lists = [...ws.root.querySelectorAll<HTMLElement>('.vela-menu')];
    const hit = lists.find((l) => l.querySelector('.vela-menu-item')?.textContent?.trim() === firstLabel);
    if (!hit) throw new Error(`no menu starting with "${firstLabel}" (have: ${lists.map((l) => l.textContent?.slice(0, 24)).join(' | ')})`);
    return hit;
}

/** The row labels of the entry menu. */
function menuRows(ws: VelaWorkspace): string[] {
    const list = entryList(ws);
    if (!list) return [];
    return [...list.querySelectorAll(':scope > .vela-menu-item')].map((li) => li.textContent?.trim() ?? '');
}

/** Zag selects through the HIGHLIGHTED row: a bare `click()` on a row that was never
 *  pointed at is a no-op (its `invokeOnSelect` reads `highlightedValue`). So hover it
 *  first, exactly as a pointer would, then click. jsdom has no PointerEvent — a
 *  MouseEvent carrying `pointerType` is what Zag's guard reads. */
function selectRow(row: HTMLElement): void {
    const hover = new MouseEvent('pointermove', { bubbles: true, clientX: 4, clientY: 4 });
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
    row.dispatchEvent(hover);
    row.click();
}

/** Open the entry menu the way a user does: click the topbar slot. The anchored menu
 *  builds its list synchronously (it is created on demand, then positioned). */
function openEntryMenu(ws: VelaWorkspace): void {
    replayButton(ws)!.click();
}

describe('the topbar replay slot', () => {
    it('renders replay and the reachable bell without lighting replay before a session', async () => {
        const ws = mountWorkspace();
        await flush();
        const btn = replayButton(ws);
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Bar replay');
        expect(btn!.hasAttribute('data-active')).toBe(false);
        // The default bell leads the scrolling strip so it remains reachable in
        // landscape; replay remains in its original right-hand cluster.
        const bell = ws.root.querySelector('.vela-widget-alerts')!;
        expect(bell).not.toBeNull();
        expect(ws.root.querySelector('.vela-widget-topbar')!.contains(bell)).toBe(true);
        expect(btn!.parentElement!.contains(bell)).toBe(false);
    });

    it('the composition can place it (or hide it) like any other built-in entry', async () => {
        const ws = mountWorkspace({ topbar: { left: ['symbol', 'replay'], right: [] } });
        await flush();
        const btn = replayButton(ws)!;
        expect(btn.closest('.vela-topbar-left, .vela-widget-topbar')).not.toBeNull();
        expect(ws.root.querySelector('.vela-topbar-right')!.contains(btn)).toBe(false);
    });

    it('`replay: false` removes the whole chrome and leaves the API alone', async () => {
        const ws = mountWorkspace({ replay: false });
        await flush();
        expect(replayButton(ws)).toBeNull();
        expect(transport(ws)).toBeNull();
        expect(typeof ws.replay.start).toBe('function');
    });
});

describe('the entry menu', () => {
    it('offers the three ways in, plus the way out (disabled outside a session)', async () => {
        const ws = mountWorkspace();
        await flush();
        openEntryMenu(ws);
        await flush();
        expect(menuRows(ws)).toEqual(['Select bar', 'Select date', 'Random bar', 'Jump to real time']);
        const rows = [...entryList(ws)!.querySelectorAll(':scope > .vela-menu-item')];
        expect(rows[3]!.hasAttribute('data-disabled')).toBe(true);
        expect(rows[0]!.hasAttribute('data-disabled')).toBe(false);
    });

    it('"Select bar" arms the picker: the hint replaces the transport and Esc cancels it', async () => {
        const ws = mountWorkspace();
        await flush();
        openEntryMenu(ws);
        await flush();
        selectRow(entryList(ws)!.querySelectorAll<HTMLElement>(':scope > .vela-menu-item')[0]!);
        await flush();
        expect(grid(ws).dataset.replayArm).toBe('1');
        expect(transport(ws)!.hidden).toBe(false);
        expect(hint(ws).hidden).toBe(false);
        expect(bar(ws).hidden).toBe(true);
        expect(hint(ws).textContent).toContain('Click a bar to start the replay');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
        expect(grid(ws).dataset.replayArm).toBeUndefined();
        expect(transport(ws)!.hidden).toBe(true);
    });

    it('"Random bar" starts a session inside the active cell’s history', async () => {
        const ws = mountWorkspace();
        await flush();
        openEntryMenu(ws);
        await flush();
        selectRow(entryList(ws)!.querySelectorAll<HTMLElement>(':scope > .vela-menu-item')[2]!);
        await flush();
        const s = ws.replay.state;
        expect(s.active).toBe(true);
        expect(s.cursorTime).not.toBeNull();
        // A random spot in a 200-bar series is never the very first or last bar.
        expect(s.cursorTime!).toBeGreaterThan(T0);
        expect(s.cursorTime!).toBeLessThan(T0 + 199 * HOUR);
    });
});

describe('the transport bar', () => {
    it('appears with the session, reads the clock and the remaining bars, and lights the slot', async () => {
        const ws = mountWorkspace();
        await flush();
        // Mounted BY the session: a workspace that never replays carries none of its nodes.
        expect(transport(ws)).toBeNull();

        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();

        expect(transport(ws)!.hidden).toBe(false);
        expect(bar(ws).hidden).toBe(false);
        expect(hint(ws).hidden).toBe(true);
        expect(clock(ws)).toBe('2024-01-06 04:00'); // T0 + 100h, local-formatted the same way
        expect(left(ws)).toBe('99 bars left');
        expect(replayButton(ws)!.dataset.active).toBe('1');
    });

    it('plays and pauses through `ws.replay`, and the button flips its meaning', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();
        expect(playBtn(ws).getAttribute('aria-label')).toBe('Play');

        playBtn(ws).click();
        await flush();
        expect(ws.replay.state.playing).toBe(true);
        expect(playBtn(ws).getAttribute('aria-label')).toBe('Pause');

        playBtn(ws).click();
        await flush();
        expect(ws.replay.state.playing).toBe(false);
        expect(playBtn(ws).getAttribute('aria-label')).toBe('Play');
    });

    it('steps one bar forward, pausing a running session first', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();
        const before = ws.replay.state.cursorTime!;
        ws.replay.play(30_000);
        stepBtn(ws).click();
        await flush();
        expect(ws.replay.state.playing).toBe(false);
        expect(ws.replay.state.cursorTime).toBe(before + HOUR);
        expect(clock(ws)).toBe('2024-01-06 05:00');
    });

    it('the speed menu carries the nine paces and re-paces a running session', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 150 * HOUR });
        await flush();
        expect(speedBtn(ws).textContent).toBe('1s');
        ws.replay.play(1_000);

        // The menu belongs to the speed button (and is mounted over the grid).
        speedBtn(ws).click();
        await flush();
        const rows = [...listStartingWith(ws, '0.1s').querySelectorAll<HTMLElement>(':scope > .vela-menu-item')];
        expect(rows.map((li) => li.textContent?.trim())).toEqual(['0.1s', '0.25s', '0.5s', '1s', '2s', '3s', '5s', '10s', '30s']);

        selectRow(rows[6]!);
        await flush();
        expect(ws.replay.state.intervalMs).toBe(5_000);
        expect(speedBtn(ws).textContent).toBe('5s');
    });

    it('a speed picked while PAUSED is kept for the next play (it never starts playback)', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 150 * HOUR });
        await flush();
        speedBtn(ws).click();
        await flush();
        selectRow(listStartingWith(ws, '0.1s').querySelectorAll<HTMLElement>(':scope > .vela-menu-item')[4]!);
        await flush();
        expect(ws.replay.state.playing).toBe(false);
        expect(speedBtn(ws).textContent).toBe('2s');

        playBtn(ws).click();
        await flush();
        expect(ws.replay.state.playing).toBe(true);
        expect(ws.replay.state.intervalMs).toBe(2_000);
    });

    it('"jump to real time" ends the session and blasts the view back to the newest bars', async () => {
        const ws = mountWorkspace();
        await flush();
        const pan = vi.spyOn(ws.cell('c1')!.chart, 'panBy');
        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();
        (ws.root.querySelector('.vela-replay-live') as HTMLButtonElement).click();
        await flush();
        expect(ws.replay.state.active).toBe(false);
        expect(transport(ws)!.hidden).toBe(true);
        expect(replayButton(ws)!.hasAttribute('data-active')).toBe(false);
        expect(pan).toHaveBeenCalledWith(8);
    });

    it('the exit button ends the session and restores the history', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();
        (ws.root.querySelector('.vela-replay-exit') as HTMLButtonElement).click();
        await flush();
        expect(ws.replay.state.active).toBe(false);
        expect(transport(ws)!.hidden).toBe(true);
    });

    it('a replay ended by the API (the last bar) takes the chrome with it', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 197 * HOUR });
        await flush();
        expect(transport(ws)!.hidden).toBe(false);
        ws.replay.step();
        ws.replay.step();
        await flush();
        expect(ws.replay.state.active).toBe(false);
        expect(transport(ws)!.hidden).toBe(true);
    });
});

describe('the replay chords', () => {
    const key = (ws: VelaWorkspace, k: string): void => {
        // The keymap listens on the shell root — a key typed into the chart bubbles there.
        grid(ws).dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: true, bubbles: true }));
    };

    it('Shift+↓ plays and pauses, Shift+→ steps', async () => {
        const ws = mountWorkspace();
        await flush();
        await ws.replay.start({ from: T0 + 100 * HOUR });
        await flush();

        key(ws, 'ArrowDown');
        await flush();
        expect(ws.replay.state.playing).toBe(true);
        key(ws, 'ArrowDown');
        await flush();
        expect(ws.replay.state.playing).toBe(false);

        const before = ws.replay.state.cursorTime!;
        key(ws, 'ArrowRight');
        await flush();
        expect(ws.replay.state.cursorTime).toBe(before + HOUR);
    });

    it('outside a session both chords are no-ops', async () => {
        const ws = mountWorkspace();
        await flush();
        key(ws, 'ArrowDown');
        key(ws, 'ArrowRight');
        await flush();
        expect(ws.replay.state.active).toBe(false);
        expect(transport(ws)).toBeNull(); // still nothing mounted: no session ever started
    });
});
