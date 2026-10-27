// @vitest-environment jsdom
// Round 20: the seven cursor types (the Cursors stop), and drawing TEMPLATES as a first-class,
// reachable thing — on the floating drawing bar, on a phone's drawing pill, and in the More
// sheet's Drawings stop. The pointer is a view preference; a template is a saved LOOK that the
// next drawing of its tool starts from.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { MoreDrawer } from '../src/widget/more-drawer';
import { DrawingPill } from '../src/widget/drawing-pill';
import { CURSOR_SPECS, CURSOR_STYLES, cursorSpec, normalizeCursorStyle } from '../src/core/cursor';
import { iconMarkup } from '../src/ui/icons';
import type { Vela } from '../src/Vela';
import type { DrawingToolDefaults, DrawingToolTemplate, SnapMode } from '../src/core/drawings';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

const PINK = { style: { lineColor: '#e35ac4', lineWidth: 3, lineStyle: 'dashed' as const } };

describe('the seven cursor types', () => {
    it('is exactly the reference set plus None, in the documented order', () => {
        expect(CURSOR_STYLES).toEqual(['cross', 'dot', 'arrow', 'demo', 'magic', 'eraser', 'none']);
        expect(CURSOR_SPECS.map((s) => s.label)).toEqual(['Cross', 'Dot', 'Arrow', 'Demonstration', 'Magic', 'Eraser', 'None']);
    });

    it('paints crosshair LINES for Cross and Dot only — Arrow is the reference’s "no crosshair" rule', () => {
        expect(CURSOR_SPECS.filter((s) => s.lines).map((s) => s.id)).toEqual(['cross', 'dot']);
    });

    it('every style has its own registered glyph and a one-line hint', () => {
        const icons = CURSOR_SPECS.map((s) => s.icon);
        expect(new Set(icons).size).toBe(icons.length);
        for (const spec of CURSOR_SPECS) {
            expect(iconMarkup(spec.icon), spec.icon).toContain('<svg');
            expect(spec.hint.length).toBeGreaterThan(3);
            expect(spec.hint.length).toBeLessThan(40);
        }
    });

    it('narrows untrusted values back to Cross', () => {
        expect(normalizeCursorStyle('dot')).toBe('dot');
        expect(normalizeCursorStyle('banana')).toBe('cross');
        expect(normalizeCursorStyle(undefined)).toBe('cross');
        expect(cursorSpec('magic').label).toBe('Magic');
    });
});

/** A Vela stand-in carrying just the drawings facade the pill touches. */
function fakeChart(over: { templates?: DrawingToolTemplate[]; defaults?: DrawingToolDefaults } = {}) {
    const listeners = new Map<string, Array<() => void>>();
    let tool: string | null = 'trendline';
    let mode: 'measure' | 'eraser' | null = null;
    let snap: SnapMode = 'off';
    let stay = false;
    let hidden = false;
    let defaults: Record<string, DrawingToolDefaults> = { ...(over.defaults ? { trendline: over.defaults } : {}) };
    let templates: Record<string, DrawingToolTemplate[]> = over.templates ? { trendline: over.templates } : {};
    const emit = (name: string): void => {
        for (const cb of listeners.get(name) ?? []) cb();
    };
    const drawings = {
        supported: true,
        getTool: () => tool,
        setTool: (t: string | null) => {
            tool = t;
            emit('drawing:tool');
        },
        getMode: () => mode,
        setMode: (m: 'measure' | 'eraser' | null) => {
            mode = m;
            emit('drawing:mode');
        },
        getSnapMode: () => snap,
        setSnapMode: (m: SnapMode) => {
            snap = m;
            emit('drawing:snap');
        },
        getStayMode: () => stay,
        setStayMode: (v: boolean) => {
            stay = v;
            emit('drawing:stay');
        },
        setHiddenAll: (v: boolean) => {
            hidden = v;
            emit('drawing:hidden-all');
        },
        isHiddenAll: () => hidden,
        canUndo: () => true,
        canRedo: () => false,
        undo: () => {},
        redo: () => {},
        toolDefaults: () => defaults,
        setToolDefaults: (map: Record<string, DrawingToolDefaults>) => {
            defaults = map;
        },
        toolTemplates: () => templates,
        setToolTemplates: (map: Record<string, DrawingToolTemplate[]>) => {
            templates = map;
        },
    };
    const chart = {
        drawings,
        on: (name: string, cb: () => void) => {
            const list = listeners.get(name) ?? [];
            list.push(cb);
            listeners.set(name, list);
            return () => {
                listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== cb));
            };
        },
    } as unknown as Vela;
    return { chart, drawings };
}

/**
 * Round 25 moved templates and hide-all off the strip's face and into its ⋯ menu: the
 * face only has room for the verbs you press WHILE drawing (tool, undo, redo, magnet,
 * eraser, more, exit). These helpers drive the menu the way a thumb does.
 */
function openMore(host: HTMLElement): void {
    host.querySelector<HTMLButtonElement>('.vela-drawpill button[aria-label="More drawing tools"]')!.click();
}

function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => (el.textContent ?? '').includes(label));
    if (!item) throw new Error(`menu item "${label}" not found`);
    return item;
}

describe('the phone’s drawing strip carries the templates', () => {
    it('lists the armed tool’s saved looks with the live one checked, and applies one', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const { chart, drawings } = fakeChart({ templates: [{ name: 'Ichimoku pink', settings: PINK }], defaults: PINK });
        const pill = new DrawingPill(host);
        pill.onChart(chart);

        const more = host.querySelector<HTMLButtonElement>('.vela-drawpill button[aria-label="More drawing tools"]')!;
        expect(more).toBeTruthy();
        // The ⋯ menu is the door now: it lists the three session verbs…
        openMore(host);
        expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
            'Stay in drawing mode',
            'Templates…',
            'Hide all drawings',
        ]);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        // …and the verb behind it opens the sheet (the menu's own selection is driven by the
        // menu machine, which jsdom cannot press; the behaviour under test is the sheet).
        pill.toggleTemplates();
        const rows = [...host.querySelectorAll<HTMLElement>('.vela-dptpl-row')];
        expect(rows.map((r) => r.querySelector('.vela-dptpl-name')?.textContent)).toEqual(['Default', 'Ichimoku pink']);
        expect(rows[1]!.getAttribute('aria-checked')).toBe('true');
        expect(rows[0]!.getAttribute('aria-checked')).toBe('false');
        // The swatch is the saved line colour, so the list is scannable by eye.
        expect((rows[1]!.querySelector('.vela-dptpl-sw') as HTMLElement).style.background).toBe('rgb(227, 90, 196)');

        rows[0]!.click();
        expect(host.querySelector('.vela-dptpl')).toBeNull();
        // "Default" hands back the tool's built-in look, so the pink template no longer wins.
        expect(drawings.toolDefaults().trendline).not.toEqual(PINK);
        expect(host.querySelector('.vela-dptpl')).toBeNull();
        pill.destroy();
    });

    it('says where a first template comes from when none is saved', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const { chart } = fakeChart();
        const pill = new DrawingPill(host);
        pill.onChart(chart);
        pill.toggleTemplates();
        expect(host.querySelectorAll('.vela-dptpl-row')).toHaveLength(1);
        expect(host.querySelector('.vela-dptpl-empty')?.textContent).toContain('Templates button');
        pill.destroy();
    });

    it('closes the sheet on Escape and when the armed tool changes', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const { chart } = fakeChart();
        const pill = new DrawingPill(host);
        pill.onChart(chart);
        pill.toggleTemplates();
        await new Promise((r) => setTimeout(r, 0)); // the outside/Escape listeners attach on a tick
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(host.querySelector('.vela-dptpl')).toBeNull();
        pill.toggleTemplates();
        chart.drawings.setTool('rectangle' as never);
        expect(host.querySelector('.vela-dptpl')).toBeNull();
        pill.destroy();
    });
});

describe('the phone’s Hide button', () => {
    it('toggles every drawing and swaps its own glyph', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const { chart } = fakeChart();
        const pill = new DrawingPill(host);
        pill.onChart(chart);
        // The ⋯ menu lists the toggle…
        openMore(host);
        expect(menuItem('Hide all drawings')).toBeTruthy();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        // …and the verb toggles every drawing.
        pill.toggleHiddenAll();
        expect(chart.drawings.isHiddenAll()).toBe(true);
        // the ⋯ stop carries the session state: a hidden chart is a mutated session
        const more = host.querySelector<HTMLButtonElement>('.vela-drawpill button[aria-label="More drawing tools"]')!;
        expect(more.dataset.on).toBe('1');
        pill.toggleHiddenAll();
        expect(chart.drawings.isHiddenAll()).toBe(false);
        pill.destroy();
    });
});

describe('the More sheet', () => {
    const base = (host: HTMLElement, extra: Record<string, unknown>) =>
        ({
            host,
            canUndo: () => false,
            canRedo: () => false,
            actions: () => [],
            priceStyles: () => [{ id: 'candles', label: 'Candles' }],
            priceStyle: () => 'candles',
            onPriceStyle: () => {},
            panels: () => [],
            onTogglePanel: () => {},
            ...extra,
        }) as ConstructorParameters<typeof MoreDrawer>[0];

    it('offers Cursors beside Chart type and writes the choice back', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const picked: string[] = [];
        const md = new MoreDrawer(base(host, { cursorStyle: () => 'cross', onCursorStyle: (s: string) => picked.push(s) }));
        md.open('main');
        const row = [...host.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.startsWith('Cursor'))!;
        expect(row.textContent).toContain('Cross');
        (row as HTMLButtonElement).click();
        const rows = [...host.querySelectorAll<HTMLElement>('.vela-md-cursorrow')];
        expect(rows.map((r) => r.dataset.cursor)).toEqual(['cross', 'dot', 'arrow', 'demo', 'magic', 'eraser', 'none']);
        expect(rows.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
        (rows[3] as HTMLButtonElement).click();
        expect(picked).toEqual(['demo']);
    });

    it('shows the library’s third stop only when drawing templates exist, and deletes from its kebab', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const removed: string[] = [];
        const md = new MoreDrawer(
            base(host, {
                layout: {
                    savedLayouts: () => [],
                    presets: () => [],
                    shape: () => ({ cols: 1, rows: 1 }),
                    onSaveLayout: () => {},
                    templates: () => [],
                    onSaveTemplate: () => {},
                },
                drawingTemplates: () => [{ tool: 'trendline', toolLabel: 'Trend Line', name: 'Ichimoku pink', color: '#e35ac4', settings: PINK }],
                onDeleteDrawingTemplate: (tool: string, name: string) => removed.push(`${tool}:${name}`),
            }),
        );
        // The library no longer lives on the first screen: it has its own TAB
        // (TradingView's Manage layouts), which is where the Drawings stop lives.
        md.open('layout', { focus: 'manage' });
        const tabs = [...host.querySelectorAll<HTMLButtonElement>('.vela-md-segbtn')].map((b) => b.textContent);
        expect(tabs).toEqual(['Layouts', 'Templates', 'Drawings']);
        host.querySelector<HTMLButtonElement>('.vela-md-segbtn[data-tab="drawings"]')!.click();
        const row = host.querySelector<HTMLElement>('[data-drawing-template]')!;
        expect(row.textContent).toContain('Ichimoku pink');
        expect(row.textContent).toContain('Trend Line');
        expect((row.querySelector('.vela-md-lswatch') as HTMLElement).style.background).toBe('rgb(227, 90, 196)');
        row.querySelector<HTMLButtonElement>('[aria-label^="Actions for"]')!.click();
        const del = [...host.querySelectorAll<HTMLButtonElement>('.vela-md-lact')].find((b) => b.textContent === 'Delete')!;
        del.click();
        expect(removed).toEqual(['trendline:Ichimoku pink']);
    });
});
