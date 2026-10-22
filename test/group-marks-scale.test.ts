// @vitest-environment jsdom
// Round 10 — the mark palette follows the LAYOUT, and a group's glyph is the user's.
//
// The complaint this test exists for: a 1-chart workspace and a 16-chart workspace both
// offered TEN marks, so on a 2-chart grid eight of the ten groups could never be used, and
// on a 16-chart grid six charts had no group of their own. The rule now is one mark per
// chart (a 1×1 offers one, a 4×4 sixteen), with groups already in use appended so a
// shrink cannot strand an assignment off the end of the list.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
// jsdom has no Web Animations API; the picker animates its panel in.
(Element.prototype as unknown as { animate?: unknown }).animate ??= () => ({
    finished: Promise.resolve(),
    cancel() {},
});

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { LayoutPicker } from '../src/widget/layout-picker';
import {
    SYNC_GROUPS,
    groupsForCount,
    groupMarkOf,
    markOverrides,
    setMarkOverrides,
} from '../src/workspace/sync-marks';
import { sanitizeState } from '../src/state/document';

let host: HTMLElement | null = null;

function mount(): VelaWorkspace {
    host = document.createElement('div');
    document.body.append(host);
    return new VelaWorkspace(host, {
        layout: '4',
        symbol: 'BTCUSDT',
        timeframe: '60',
        bars: 20,
        live: false,
    });
}

beforeEach(() => setMarkOverrides(null));
afterEach(() => {
    host?.remove();
    host = null;
    setMarkOverrides(null);
});

describe('the palette follows the layout', () => {
    it('offers exactly one mark per chart', () => {
        expect(groupsForCount(1).map((g) => g.id)).toEqual(['red']);
        expect(groupsForCount(2).map((g) => g.id)).toEqual(['red', 'orange']);
        expect(groupsForCount(4)).toHaveLength(4);
        expect(groupsForCount(16)).toHaveLength(16);
        // A count that is not a layout (0 / negative / fractional / huge) is still a
        // legal request: never empty, never longer than the palette.
        expect(groupsForCount(0)).toHaveLength(1);
        expect(groupsForCount(-3)).toHaveLength(1);
        expect(groupsForCount(99)).toHaveLength(SYNC_GROUPS.length);
    });

    it('keeps a group that is already in use even when the layout shrinks', () => {
        const slice = groupsForCount(2, ['purple']);
        expect(slice.map((g) => g.id)).toEqual(['red', 'orange', 'purple']);
        // …and does not repeat a group that is already inside the slice.
        expect(groupsForCount(4, ['red', 'green']).map((g) => g.id)).toEqual(['red', 'orange', 'yellow', 'green']);
    });

    it('has sixteen DISTINCT glyphs — colour is not the only channel', () => {
        const marks = SYNC_GROUPS.map((g) => g.mark);
        expect(new Set(marks).size).toBe(SYNC_GROUPS.length);
        // Past the nine colour circles the glyphs are shapes, so a monochrome or
        // colour-blind reading still separates group 10 from group 11.
        const shapes = SYNC_GROUPS.slice(9).map((g) => g.mark);
        expect(shapes.every((m) => !m.includes('\u{25CF}') && !m.includes('\u{26AB}') && !m.includes('\u{26AA}'))).toBe(true);
    });
});

describe('a group glyph is the user’s', () => {
    it('overrides the palette by STABLE id, and legacy marks resolve through it', () => {
        setMarkOverrides({ red: '🦊' });
        expect(groupMarkOf('red')).toBe('🦊');
        // A document written before the ids existed stores the emoji; it must paint the
        // override too, or an old file would keep the old face.
        expect(groupMarkOf('🔴')).toBe('🦊');
        expect(markOverrides()).toEqual({ red: '🦊' });
        setMarkOverrides(null);
        expect(groupMarkOf('red')).toBe('🔴');
    });

    it('repaints the chip, the legend and the saved document together', () => {
        const ws = mount();
        const id = ws.cells()[0]!.id;
        ws.setGroupFor('symbol', id, 'red');
        expect(ws.groupLegend().find((g) => g.id === 'red')?.mark).toBe('🔴');

        ws.setGroupMark('red', '🦊');
        expect(ws.groupMark('red')).toBe('🦊');
        expect(ws.groupLegend().find((g) => g.id === 'red')?.mark).toBe('🦊');
        expect(ws.getState().groupMarks).toEqual({ red: '🦊' });
        // The badge the chart wears reads the same registry.
        const badge = ws.cells().find((c) => c.id === id)?.host.querySelector('.vela-sl-marks');
        expect(badge?.textContent).toContain('🦊');

        // Two graphemes max (a chip is 14px), and `null` restores the palette.
        ws.setGroupMark('red', 'ABCDEF');
        expect(ws.groupMark('red')).toBe('AB');
        ws.setGroupMark('red', null);
        expect(ws.groupMark('red')).toBe('🔴');
        expect(ws.getState().groupMarks).toBeUndefined();
        ws.destroy();
    });

    it('survives the codec: bounds a hostile glyph and keeps the map small', () => {
        const ok = sanitizeState({
            version: 1,
            layout: '4',
            timezone: 'UTC',
            charts: [],
            groupMarks: { red: '🦊🦊🦊🦊🦊', blue: '  🔵 ', '': 'x', [String(Math.random())]: 'y' },
        });
        expect(ok?.groupMarks?.red).toBe('🦊🦊');
        expect(ok?.groupMarks?.blue).toBe('🔵');
        expect(ok?.groupMarks?.['']).toBeUndefined();

        const many = Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`g${i}`, '🔴']));
        const capped = sanitizeState({ version: 1, layout: '4', timezone: 'UTC', charts: [], groupMarks: many });
        expect(Object.keys(capped?.groupMarks ?? {}).length).toBeLessThanOrEqual(32);
    });
});

describe('tab links are not a second colour language', () => {
    it('renders neutral, numbered chips — no identity hues, no inline background', () => {
        const wrap = document.createElement('div');
        document.body.append(wrap);
        let picked: string | null | undefined;
        const picker = new LayoutPicker({
            host: wrap,
            trigger: wrap,
            shape: () => ({ rows: 2, cols: 2 }),
            presets: () => [],
            onSelectGrid: () => {},
            onSelectPreset: () => {},
            syncs: () => [],
            onToggleSync: () => {},
            linkGroup: () => null,
            onLinkGroup: (tag) => {
                picked = tag;
            },
        });
        picker.open();
        const dots = [...wrap.querySelectorAll<HTMLElement>('.vela-lp-linkdot')];
        // Unlink + four sets, and every one of them says what it is in TEXT.
        expect(dots.map((d) => d.textContent)).toEqual(['—', '1', '2', '3', '4']);
        for (const dot of dots) {
            expect(dot.style.background).toBe('');
            // The tag stays on the element (the model is unchanged) — only the PAINT is
            // neutral, so the dot can never be confused with a group's colour.
            expect(dot.dataset.tag).toBeTruthy();
            expect(dot.getAttribute('aria-label')).toBeTruthy();
        }
        dots[2]!.click();
        expect(picked).toBe('green');
        picker.destroy();
        wrap.remove();
    });
});
