// @vitest-environment jsdom
// The shell's landmarks.
//
// A probe on the playground found ZERO `<main>` regions, zero `<nav>`, zero headings and
// no way past the chrome: `document.querySelectorAll('main, [role=main]')` returned 0.
// A screen reader therefore announced a flat pile of buttons with no structure, and a
// keyboard user walked the whole topbar (~10 stops) before reaching the first chart —
// WCAG 1.3.1 (info and relationships) and 2.4.1 (bypass blocks).
//
// Two additions, both invisible until they are used:
//   • `role="main"` + a label on the charts row, focusable as a TARGET only (tabindex -1);
//   • a "Skip to charts" link as the FIRST tabbable in the document, out of flow
//     (top: -60px) until it takes focus, then slid into view on the workspace surface.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

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

const BARS: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({
    time: Date.UTC(2024, 0, 2) + i * 3_600_000,
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

function mount(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout: '4',
        symbol: 'AAA',
        timeframe: '60',
        bars: 60,
        live: false,
        data: BARS,
    } as never);
    live.push(ws);
    return ws;
}

/** Everything the browser would stop on, in document order. */
function tabbables(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('a[href], button, [tabindex]')].filter((el) => el.tabIndex >= 0);
}

describe('the shell exposes landmarks and a way past the chrome', () => {
    it('the FIRST tab stop is a skip link, and it points at a real main region', () => {
        const ws = mount();
        const first = tabbables()[0];
        expect(first?.className).toBe('vela-ws-skip');
        const href = first!.getAttribute('href')!;
        expect(href.startsWith('#')).toBe(true);
        const target = document.getElementById(href.slice(1));
        expect(target).toBeTruthy();
        expect(target!.getAttribute('role')).toBe('main');
        expect(ws.root.contains(target!)).toBe(true);
    });

    it('the charts row is the main landmark, labelled, and is a target — not a tab stop', () => {
        const ws = mount();
        const main = ws.root.querySelector<HTMLElement>('[role="main"]')!;
        expect(main.getAttribute('aria-label')).toBe('Chart workspace');
        expect(main.tabIndex).toBe(-1);
        // The grid lives INSIDE the landmark, so the skip lands on the charts themselves.
        expect(main.querySelector('.vela-ws-grid')).toBeTruthy();
        expect(tabbables().includes(main)).toBe(false);
    });

    it('two workspaces in one document get distinct ids, and each link hits its own main', () => {
        const a = mount();
        const b = mount();
        const links = [...document.querySelectorAll<HTMLAnchorElement>('.vela-ws-skip')];
        expect(links).toHaveLength(2);
        const ids = links.map((l) => l.getAttribute('href')!.slice(1));
        expect(new Set(ids).size).toBe(2);
        expect(a.root.querySelector('[role="main"]')!.id).toBe(ids[0]);
        expect(b.root.querySelector('[role="main"]')!.id).toBe(ids[1]);
    });

    it('the link costs no pixels: it sits off-screen until focus brings it in', () => {
        mount();
        const css = document.getElementById('vela-workspace')!.textContent ?? '';
        expect(css).toContain('.vela-ws-skip');
        // Out of the way at rest, at the top-left corner when focused.
        expect(css).toMatch(/\.vela-ws-skip\s*\{[^}]*top:\s*-60px/);
        expect(css).toMatch(/\.vela-ws-skip:focus\s*\{[^}]*top:\s*10px/);
        // Absolutely positioned, so it never contributes to the flex column's height.
        expect(css).toMatch(/\.vela-ws-skip\s*\{[^}]*position:\s*absolute/);
    });
});
