// @vitest-environment jsdom
// The replay transport's own bits: the two pills (armed hint / session bar), the pace
// labels and the clock formatting. The workspace test covers how they follow `ws.replay`
// — this one pins the view in isolation.
import { describe, it, expect, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { ReplayToolbar, REPLAY_SPEEDS, replaySpeedLabel, formatReplayClock } from '../src/widget/replay-toolbar';

afterEach(() => {
    document.body.replaceChildren();
});

function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    const cbs = {
        onPlayPause: vi.fn(),
        onStep: vi.fn(),
        onSpeed: vi.fn(),
        onJumpToRealtime: vi.fn(),
        onExit: vi.fn(),
        onCancelArm: vi.fn(),
    };
    const bar = new ReplayToolbar({ host, ...cbs });
    return { host, bar, cbs };
}

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => root.querySelector<T>(sel)!;

describe('labels', () => {
    it('names every pace the way a trader reads it', () => {
        expect(REPLAY_SPEEDS.map(replaySpeedLabel)).toEqual(['0.1s', '0.25s', '0.5s', '1s', '2s', '3s', '5s', '10s', '30s']);
    });

    it('writes the replay clock as a sortable local timestamp', () => {
        const t = new Date(2024, 5, 3, 14, 5).getTime();
        expect(formatReplayClock(t)).toBe('2024-06-03 14:05');
        expect(formatReplayClock(new Date(2024, 0, 1, 0, 0).getTime())).toBe('2024-01-01 00:00');
    });
});

describe('the pills', () => {
    it('shows nothing until a session (or an armed picker) says otherwise', () => {
        const { host, bar } = mount();
        const root = q<HTMLDivElement>(host, '.vela-replay');
        expect(root.hidden).toBe(true);
        expect(q(bar.el, '.vela-replay-bar').hidden).toBe(true);
        expect(q(bar.el, '.vela-replay-hint').hidden).toBe(true);
        bar.destroy();
    });

    it('the armed hint names the gesture, and its ✕ cancels', () => {
        const { bar, cbs } = mount();
        bar.setArmed(true);
        expect(bar.el.hidden).toBe(false);
        expect(q(bar.el, '.vela-replay-hint').hidden).toBe(false);
        expect(q(bar.el, '.vela-replay-bar').hidden).toBe(true);
        q<HTMLButtonElement>(bar.el, '.vela-replay-cancel').click();
        expect(cbs.onCancelArm).toHaveBeenCalledOnce();
        bar.destroy();
    });

    it('a running session wears the bar: clock, bars left, and the play glyph', () => {
        const { bar } = mount();
        const t = new Date(2024, 0, 6, 4, 0).getTime();
        bar.setState({ active: true, playing: false, cursorTime: t, remaining: 99, speedMs: 1_000 });
        expect(bar.el.hidden).toBe(false);
        expect(q(bar.el, '.vela-replay-bar').hidden).toBe(false);
        expect(q(bar.el, '.vela-replay-hint').hidden).toBe(true);
        expect(q(bar.el, '.vela-replay-clock').textContent).toBe('2024-01-06 04:00');
        expect(q(bar.el, '.vela-replay-left').textContent).toBe('99 bars left');
        expect(q(bar.el, '.vela-replay-play').getAttribute('aria-label')).toBe('Play');
        expect(q(bar.el, '.vela-replay-speed').textContent).toBe('1s');
        bar.destroy();
    });

    it('counts a single remaining bar in the singular and swaps to Pause while playing', () => {
        const { bar } = mount();
        bar.setState({ active: true, remaining: 1, cursorTime: 0 });
        expect(q(bar.el, '.vela-replay-left').textContent).toBe('1 bar left');
        bar.setState({ playing: true, speedMs: 5_000 });
        expect(q(bar.el, '.vela-replay-play').getAttribute('aria-label')).toBe('Pause');
        expect(q(bar.el, '.vela-replay-speed').textContent).toBe('5s');
        bar.destroy();
    });

    it('every control reports out', () => {
        const { bar, cbs } = mount();
        bar.setState({ active: true, cursorTime: 0 });
        q<HTMLButtonElement>(bar.el, '.vela-replay-play').click();
        q<HTMLButtonElement>(bar.el, '.vela-replay-step').click();
        q<HTMLButtonElement>(bar.el, '.vela-replay-live').click();
        q<HTMLButtonElement>(bar.el, '.vela-replay-exit').click();
        expect(cbs.onPlayPause).toHaveBeenCalledOnce();
        expect(cbs.onStep).toHaveBeenCalledOnce();
        expect(cbs.onJumpToRealtime).toHaveBeenCalledOnce();
        expect(cbs.onExit).toHaveBeenCalledOnce();
        bar.destroy();
    });

    it('the speed menu lists the nine paces, with the current one checked', () => {
        const { host, bar } = mount();
        // The rows are built when the menu opens, not when the bar is constructed (a closed
        // menu carries nothing) — so the list is opened the way a trader opens it.
        host.querySelector<HTMLButtonElement>('.vela-replay-speed')!.click();
        // The list portals to the floating layer (the document body here, with no
        // `.vela-ui` wrapper), so it is found from the document, not from the mount.
        const rows = [...document.querySelectorAll('.vela-menu .vela-menu-item')];
        expect(rows.map((r) => r.textContent?.trim())).toEqual(['0.1s', '0.25s', '0.5s', '1s', '2s', '3s', '5s', '10s', '30s']);
        expect(rows.filter((r) => r.hasAttribute('data-checked')).map((r) => r.textContent?.trim())).toEqual(['1s']);
        bar.destroy();
    });
});
