import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VelaTheme } from '../src/core/options';
import { splitColor, combineColor, buildColorPicker, rememberRecentColor } from '../src/ui/components/color-picker';

// A minimal element stub (this suite runs in the node env — no jsdom). It models just
// enough of the tree for `buildColorPicker`: parent links so `isConnected` can be
// answered, child mutation, and per-element listeners.
interface FakeEl {
    tag: string;
    type: string;
    value: string;
    textContent: string;
    style: { cssText: string } & Record<string, string>;
    dataset: Record<string, string>;
    attributes: Record<string, string>;
    setAttribute: (name: string, value: string) => void;
    getAttribute: (name: string) => string | null;
    children: FakeEl[];
    parentNode: FakeEl | null;
    attached: boolean;
    readonly isConnected: boolean;
    addEventListener: (t: string, fn: (e: unknown) => void) => void;
    dispatchEvent: (e: { type: string; stopPropagation?: () => void }) => boolean;
    focus: (options?: { preventScroll?: boolean }) => void;
    appendChild: (c: FakeEl) => FakeEl;
    append: (...cs: FakeEl[]) => void;
    replaceChildren: (...cs: FakeEl[]) => void;
}

function fakeEl(tag: string): FakeEl {
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const el: FakeEl = {
        tag,
        type: '',
        value: '',
        textContent: '',
        style: { cssText: '' },
        dataset: {},
        attributes: {},
        setAttribute: (name, value) => { el.attributes[name] = value; },
        getAttribute: (name) => el.attributes[name] ?? null,
        children: [],
        parentNode: null,
        attached: false,
        get isConnected(): boolean {
            let n: FakeEl | null = el;
            while (n.parentNode) n = n.parentNode;
            return n.attached;
        },
        addEventListener: (t, fn) => { const a = listeners.get(t) ?? []; a.push(fn); listeners.set(t, a); },
        dispatchEvent: (e) => { for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
        focus: () => { (document as unknown as { activeElement: FakeEl }).activeElement = el; },
        appendChild: (c) => { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = el; el.children.push(c); return c; },
        append: (...cs) => { for (const c of cs) el.appendChild(c); },
        replaceChildren: (...cs) => { for (const c of el.children) c.parentNode = null; el.children = []; el.append(...cs); },
    };
    return el;
}

describe('color picker current-color custom input', () => {
    const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    let savedDocument: unknown;

    beforeEach(() => {
        savedDocument = (globalThis as { document?: unknown }).document;
        (globalThis as { document: unknown }).document = { createElement: (tag: string) => fakeEl(tag) };
    });
    afterEach(() => {
        (globalThis as { document?: unknown }).document = savedDocument;
    });

    function mount(): { input: FakeEl; recentSwatches: FakeEl; picked: string[] } {
        const picked: string[] = [];
        const body = fakeEl('body');
        body.attached = true;
        const root = buildColorPicker('#089981', theme, (v) => picked.push(v)) as unknown as FakeEl;
        body.appendChild(root);
        // root → [grid, recentRow, …]; recentRow → [swatches, current-color well].
        const recentRow = root.children[1]!;
        const recentSwatches = recentRow.children[0]!;
        const well = recentRow.children[1]!;
        const input = well.children.find((child) => child.type === 'color')!;
        expect(well.textContent).not.toContain('+');
        expect(input.getAttribute('aria-label')).toBe('Custom color');
        return { input, recentSwatches, picked };
    }

    it('keeps the same native color input in the DOM while the chooser streams values', () => {
        const { input, recentSwatches, picked } = mount();
        const recentsBefore = recentSwatches.children.length;
        for (const v of ['#aa0000', '#bb1111', '#cc2222']) {
            input.value = v;
            input.dispatchEvent(new Event('input'));
            // The browser closes its chooser if the owning input is detached — it must stay put.
            expect(input.isConnected).toBe(true);
        }
        expect(picked).toEqual(['#aa0000', '#bb1111', '#cc2222']);
        expect(recentSwatches.children.length).toBe(recentsBefore);
    });

    it('adds the committed color to the recents only on change, keeping the input attached', () => {
        const { input, recentSwatches } = mount();
        const recentsBefore = recentSwatches.children.length;
        input.value = '#cc2222';
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
        expect(input.isConnected).toBe(true);
        expect(recentSwatches.children.length).toBe(recentsBefore + 1);
        expect(recentSwatches.children[0]!.style.cssText).toContain('background:#cc2222');
    });

    it('shows each palette choice in recents immediately without reopening', () => {
        const picked: string[] = [];
        const root = buildColorPicker('#089981', theme, (v) => picked.push(v)) as unknown as FakeEl;
        const grid = root.children[0]!;
        const recentSwatches = root.children[1]!.children[0]!;
        const target = grid.children.find((sw) => sw.dataset.c === '#33adeb')!;
        target.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        expect(picked[picked.length - 1]).toBe('#33adeb');
        expect(recentSwatches.children[0]!.getAttribute('aria-label')).toBe('Recent color #33adeb');
    });

    it('keeps ten most recent unique choices, shared with new picker instances', () => {
        const root = buildColorPicker('#089981', theme, () => {}) as unknown as FakeEl;
        const palette = root.children[0]!.children.slice(0, 12);
        for (const sw of palette) sw.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        const recentSwatches = root.children[1]!.children[0]!;
        const expected = palette.slice(-10).reverse().map((sw) => sw.dataset.c);
        expect(recentSwatches.children.map((sw) => sw.dataset.recentColor)).toEqual(expected);
        // Choosing an existing recent moves it to the front rather than duplicating it.
        const old = recentSwatches.children[4]!;
        const chosen = old.dataset.recentColor;
        old.focus();
        old.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        expect(recentSwatches.children).toHaveLength(10);
        expect(recentSwatches.children[0]!.dataset.recentColor).toBe(chosen);
        expect((document as unknown as { activeElement: FakeEl }).activeElement).toBe(recentSwatches.children[0]);
        const another = buildColorPicker('#ffffff', theme, () => {}) as unknown as FakeEl;
        expect(another.children[1]!.children[0]!.children[0]!.dataset.recentColor).toBe(chosen);
    });

    it('remembers a mixed drawing color by hue even when it has alpha', () => {
        rememberRecentColor('#34567880');
        const root = buildColorPicker('#ffffff', theme, () => {}) as unknown as FakeEl;
        expect(root.children[1]!.children[0]!.children[0]!.dataset.recentColor).toBe('#345678');
    });

    it('syncs the native input to a swatch pick so the chooser opens on the current color', () => {
        const { input, recentSwatches } = mount();
        // Second recent: not the color the picker was opened with.
        const swatch = recentSwatches.children[1]!;
        const expected = /background:(#[0-9a-f]{6})/.exec(swatch.style.cssText)![1]!;
        expect(input.value).not.toBe(expected);
        swatch.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        expect(input.value).toBe(expected);
    });
});

describe('color picker opacity slider', () => {
    const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    let savedDocument: unknown;

    beforeEach(() => {
        savedDocument = (globalThis as { document?: unknown }).document;
        (globalThis as { document: unknown }).document = { createElement: (tag: string) => fakeEl(tag) };
    });
    afterEach(() => {
        (globalThis as { document?: unknown }).document = savedDocument;
    });

    type Track = FakeEl & { getBoundingClientRect(): { left: number; width: number }; setPointerCapture(id: number): void; captured: number[] };

    function mount(commit?: 'live' | 'release'): { track: Track; pct: FakeEl; emitted: string[] } {
        const emitted: string[] = [];
        const root = buildColorPicker('#089981', theme, (v) => emitted.push(v), commit ? { commit } : {}) as unknown as FakeEl;
        // root → [grid, recentRow, opacity row]; opacity row → [label, track, "%" box].
        const opRow = root.children[2]!;
        const track = opRow.children[1]! as Track;
        track.captured = [];
        track.getBoundingClientRect = () => ({ left: 100, width: 200 });
        track.setPointerCapture = (id) => track.captured.push(id);
        return { track, pct: opRow.children[2]!, emitted };
    }
    const pointer = (type: string, clientX: number): { type: string; clientX: number; pointerId: number; stopPropagation(): void } => ({
        type,
        clientX,
        pointerId: 1,
        stopPropagation: () => {},
    });

    it('can hide the opacity editor while retaining alpha on hue picks', () => {
        const emitted: string[] = [];
        const root = buildColorPicker('#ff000080', theme, (v) => emitted.push(v), { showOpacity: false }) as unknown as FakeEl;
        expect(root.children).toHaveLength(2);
        const swatch = root.children[0]!.children.find((el) => el.dataset.c === '#33adeb');
        expect(swatch).toBeDefined();
        swatch!.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        expect(emitted).toEqual(['#33adeb80']);
    });

    it('exposes an accessible keyboard-adjustable opacity slider', () => {
        const { track, pct, emitted } = mount();
        expect(track.getAttribute('role')).toBe('slider');
        expect(track.getAttribute('aria-valuenow')).toBe('100');
        const key = (value: string, shiftKey = false): void => {
            track.dispatchEvent({ type: 'keydown', key: value, shiftKey, preventDefault: () => {}, stopPropagation: () => {} } as never);
        };
        key('Home');
        key('ArrowRight');
        key('ArrowUp', true);
        expect(pct.value).toBe('11%');
        expect(track.getAttribute('aria-valuenow')).toBe('11');
        expect(emitted[emitted.length - 1]).toBe(combineColor('#089981', 0.11));
        key('End');
        expect(pct.value).toBe('100%');
    });

    it('keeps the opacity handle independent of the selected accent', () => {
        const { track } = mount();
        expect(track.children[1]!.style.cssText).toContain('background:var(--vela-fg-bright)');
        expect(track.children[1]!.style.cssText).toContain('0 0 0 1px var(--vela-bg)');
        expect(track.children[1]!.style.cssText).not.toContain('--vela-selected-bg');
    });

    it("defaults to 'live': every move commits, so a cheap consumer previews the drag on the chart", () => {
        const { track, pct, emitted } = mount();
        track.dispatchEvent(pointer('pointerdown', 120)); // 10 %
        track.dispatchEvent(pointer('pointermove', 200)); // 50 %
        track.dispatchEvent(pointer('pointermove', 260)); // 80 %
        expect(pct.value).toBe('80%');
        expect(emitted).toEqual([combineColor('#089981', 0.1), combineColor('#089981', 0.5), combineColor('#089981', 0.8)]);
        // Release adds nothing: the last move already committed the final value.
        track.dispatchEvent(pointer('pointerup', 260));
        expect(emitted).toHaveLength(3);
    });

    it("'release': previews the opacity while dragging and commits ONCE on release", () => {
        const { track, pct, emitted } = mount('release');

        track.dispatchEvent(pointer('pointerdown', 120)); // 10 %
        track.dispatchEvent(pointer('pointermove', 160)); // 30 %
        track.dispatchEvent(pointer('pointermove', 200)); // 50 %
        track.dispatchEvent(pointer('pointermove', 260)); // 80 %
        // The readout follows the pointer; nothing has been committed yet — a commit
        // re-executes the script over its whole history, and a drag fires a move per frame.
        expect(pct.value).toBe('80%');
        expect(emitted).toEqual([]);

        track.dispatchEvent(pointer('pointerup', 260));
        expect(emitted).toEqual([combineColor('#089981', 0.8)]);

        // Moves after release are not a drag.
        track.dispatchEvent(pointer('pointermove', 300));
        expect(pct.value).toBe('80%');
        expect(emitted).toHaveLength(1);
    });

    it('a plain click on the track commits once at the clicked opacity, under either policy', () => {
        for (const commit of ['live', 'release'] as const) {
            const { track, emitted } = mount(commit);
            track.dispatchEvent(pointer('pointerdown', 150)); // 25 %
            track.dispatchEvent(pointer('pointerup', 150));
            expect(emitted).toEqual([combineColor('#089981', 0.25)]);
        }
    });

    it('the percentage readout is a text input that sets the opacity when a value is typed', () => {
        for (const commit of ['live', 'release'] as const) {
            const { pct, emitted } = mount(commit);
            expect(pct.tag).toBe('input');
            expect(pct.value).toBe('100%');
            pct.value = '35';
            pct.dispatchEvent({ type: 'change' });
            expect(emitted).toEqual([combineColor('#089981', 0.35)]);
            expect(pct.value).toBe('35%');
            // "%" suffix accepted; out-of-range values clamp.
            pct.value = '250%';
            pct.dispatchEvent({ type: 'change' });
            expect(emitted).toHaveLength(2);
            expect(emitted[1]).toBe('#089981');
            expect(pct.value).toBe('100%');
        }
    });

    it('typed garbage or an unchanged value restores the readout without committing', () => {
        const { pct, emitted } = mount();
        pct.value = 'abc';
        pct.dispatchEvent({ type: 'change' });
        expect(pct.value).toBe('100%');
        pct.value = '100';
        pct.dispatchEvent({ type: 'change' });
        expect(emitted).toEqual([]);
    });

    it('Enter commits the typed value and keeps the keystroke away from outer shortcuts', () => {
        const { pct, emitted } = mount();
        let stopped = 0;
        let blurred = 0;
        (pct as unknown as { blur(): void }).blur = () => { blurred++; };
        pct.value = '20';
        pct.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {}, stopPropagation: () => { stopped++; } } as never);
        expect(emitted).toEqual([combineColor('#089981', 0.2)]);
        expect(stopped).toBe(1);
        expect(blurred).toBe(1);
    });

    it("'release': a cancelled drag still commits where the pointer was", () => {
        const { track, emitted } = mount('release');
        track.dispatchEvent(pointer('pointerdown', 120));
        track.dispatchEvent(pointer('pointermove', 200)); // 50 %
        track.dispatchEvent(pointer('pointercancel', 200));
        expect(emitted).toEqual([combineColor('#089981', 0.5)]);
    });
});

describe('color picker color math', () => {
    it('splitColor parses #RRGGBB, #RRGGBBAA, #RGB and rgba()', () => {
        expect(splitColor('#38c0fd')).toEqual({ hex6: '#38c0fd', alpha: 1 });
        const a = splitColor('#38c0fd80');
        expect(a.hex6).toBe('#38c0fd');
        expect(a.alpha).toBeCloseTo(128 / 255, 3);
        expect(splitColor('#0af')).toEqual({ hex6: '#00aaff', alpha: 1 });
        expect(splitColor('#0af8')).toEqual({ hex6: '#00aaff', alpha: 136 / 255 });
        expect(splitColor('rgb(100% 0% 50% / 25%)')).toEqual({ hex6: '#ff0080', alpha: 0.25 });
        const r = splitColor('rgba(56, 192, 253, 0.5)');
        expect(r.hex6).toBe('#38c0fd');
        expect(r.alpha).toBeCloseTo(0.5, 3);
    });

    it('combineColor → #RRGGBB when opaque, #RRGGBBAA otherwise', () => {
        expect(combineColor('#38c0fd', 1)).toBe('#38c0fd');
        expect(combineColor('#38c0fd', 0.5)).toBe('#38c0fd80'); // 0.5·255 = 128 = 0x80
        expect(combineColor('#38c0fd', 0.35)).toBe('#38c0fd59'); // 0.35·255 ≈ 89 = 0x59
        expect(combineColor('#38c0fd', 0)).toBe('#38c0fd00');
    });
});
