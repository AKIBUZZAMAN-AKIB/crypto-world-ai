// The side-panel column: the width policy (pure), the contribution registry, the dock's
// single-open rule + persistable state, and the resize gesture. The suite runs in the node
// env like the rest, so the DOM is a MINIMAL stub — enough for the panel/dock logic (element
// tree, listeners, dataset, inline style); real painting is proven in the browser.
import { describe, it, expect, vi } from 'vitest';
import { SidePanel, clampPanelWidth, clampPanelTop, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_MAX_WIDTH, DEFAULT_PANEL_TOP, MAX_PANEL_TOP } from '../src/widget/side-panel';
import { PanelDock } from '../src/widget/panel-dock';
import { registerSidePanel, sidePanels, unregisterSidePanel, type SidePanelButton, type WidgetContext } from '../src/widget/contributions';
import { sanitizeState } from '../src/state/document';

interface StubEl {
    tagName: string;
    className: string;
    id: string;
    tabIndex: number;
    attributes: Record<string, string>;
    hidden: boolean;
    dataset: Record<string, string>;
    children: StubEl[];
    style: { setProperty(name: string, value: string): void; removeProperty(name: string): void; props: Record<string, string> };
    ownerDocument: unknown;
    listeners: Map<string, Array<(e: unknown) => void>>;
    append(...nodes: StubEl[]): void;
    appendChild(node: StubEl): StubEl;
    replaceChildren(...nodes: StubEl[]): void;
    setAttribute(name: string, value: string): void;
    addEventListener(type: string, fn: (e: unknown) => void): void;
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
    remove(): void;
    fire(type: string, event?: Record<string, unknown>): void;
    innerHTML: string;
    textContent: string;
    title: string;
}

function stubDoc(): { doc: unknown; root: StubEl } {
    const doc = {
        createElement(tagName: string): StubEl {
            const props: Record<string, string> = {};
            const el: StubEl = {
                tagName,
                className: '',
                id: '',
                tabIndex: -1,
                attributes: {},
                hidden: false,
                dataset: {},
                children: [],
                innerHTML: '',
                textContent: '',
                title: '',
                style: { props, setProperty: (n, v) => void (props[n] = v), removeProperty: (n) => void delete props[n] },
                ownerDocument: doc,
                listeners: new Map(),
                append: (...nodes) => void el.children.push(...nodes),
                appendChild: (node) => (el.children.push(node), node),
                replaceChildren: (...nodes) => void el.children.splice(0, el.children.length, ...nodes),
                setAttribute: (name, value) => void (el.attributes[name] = value),
                addEventListener: (type, fn) => void el.listeners.set(type, [...(el.listeners.get(type) ?? []), fn]),
                setPointerCapture: () => {},
                releasePointerCapture: () => {},
                remove: () => {},
                fire: (type, event = {}) => {
                    for (const fn of el.listeners.get(type) ?? []) fn({ type, button: 0, pointerId: 1, preventDefault: () => {}, ...event });
                },
            };
            return el;
        },
    };
    return { doc, root: doc.createElement('div') };
}

/** The panel's element tree, by class — the stub keeps no query API. */
function find(el: StubEl, className: string): StubEl | undefined {
    if (el.className.includes(className)) return el;
    for (const child of el.children) {
        const hit = find(child, className);
        if (hit) return hit;
    }
    return undefined;
}

const ctx = {} as WidgetContext;

describe('clampPanelWidth', () => {
    it('clamps to the bounds and rounds to whole pixels', () => {
        expect(clampPanelWidth(320.4, 200, 640)).toBe(320);
        expect(clampPanelWidth(50, 200, 640)).toBe(200);
        expect(clampPanelWidth(5000, 200, 640)).toBe(640);
    });

    it('falls back to the defaults on unusable input', () => {
        expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_MIN_WIDTH);
        expect(clampPanelWidth(10_000)).toBe(DEFAULT_PANEL_MAX_WIDTH);
        // A max below the min would otherwise produce an empty range.
        expect(clampPanelWidth(400, 300, 100)).toBe(300);
    });
});

describe('clampPanelTop', () => {
    it('keeps a mobile sheet between fullscreen and its short limit', () => {
        expect(clampPanelTop(-1)).toBe(0);
        expect(clampPanelTop(0.42)).toBe(0.42);
        expect(clampPanelTop(4)).toBe(MAX_PANEL_TOP);
        expect(clampPanelTop(Number.NaN)).toBe(DEFAULT_PANEL_TOP);
    });
});

describe('SidePanel mobile sheet', () => {
    it('resizes only from the grip and keeps the bottom attached', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sheet', 'x-sheet', { maximizable: true });
        const moves: number[] = [];
        const sizes: Array<[number, number]> = [];
        panel.onTopChange = (top) => moves.push(top);
        panel.onSheetResize = (top, height) => sizes.push([top, height]);
        expect(panel.top).toBe(0.6);
        expect(panel.mobileHeight).toBe(0.4);
        const header = find(panel.el as never, 'vela-panel-header')!;
        const grip = find(panel.el as never, 'vela-panel-grip')!;
        expect(header.children.filter((c) => c.className.includes('vela-panel-move'))).toHaveLength(0);
        expect(grip.attributes.role).toBe('separator');
        // This stub is unmounted; phone/desktop placement is verified in a real DOM.
        // 128px on the 640px fallback host = 20% of the host. The bottom is fixed.
        grip.fire('pointerdown', { clientY: 200 });
        grip.fire('pointermove', { clientY: 72 });
        grip.fire('pointerup', { clientY: 72 });
        expect(panel.top).toBeCloseTo(0.4, 3);
        expect(panel.mobileHeight).toBeCloseTo(0.6, 3);
        expect(sizes[sizes.length - 1]).toEqual([0.4, 0.6]);
        grip.fire('keydown', { key: 'ArrowDown' });
        expect(panel.mobileHeight).toBeCloseTo(0.55, 3);
        expect(panel.top + panel.mobileHeight).toBeCloseTo(1, 3);
        grip.fire('dblclick');
        expect(panel.mobileHeight).toBe(0.4);
        expect(panel.top).toBeCloseTo(0.6, 3);
        // The title is not a handle on phones and cannot detach the pane.
        header.fire('pointerdown', { clientY: 228 });
        header.fire('pointermove', { clientY: 100 });
        header.fire('pointerup', { clientY: 100 });
        expect(panel.top).toBeCloseTo(0.6, 3);
        expect(panel.mobileHeight).toBe(0.4);
        expect(moves).toEqual([]);
        panel.setMaximized(true);
        expect((panel.el as unknown as StubEl).dataset.maximized).toBe('1');
        panel.setMaximized(false);
        expect(panel.top).toBeCloseTo(0.6, 3);
        expect(panel.mobileHeight).toBe(0.4);
    });
});

describe('SidePanel cancelled touch', () => {
    it('restores the phone height and position without notifying persistence', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Tree', 'tree', { standardPane: true });
        const grip = find(panel.el as unknown as StubEl, 'vela-panel-grip')!;
        const sizes = vi.fn();
        panel.onSheetResize = sizes;
        const before = { top: panel.top, height: panel.mobileHeight };
        grip.fire('pointerdown', { clientY: 200, pointerType: 'touch' });
        grip.fire('pointermove', { clientY: 100, pointerType: 'touch' });
        expect(panel.mobileHeight).not.toBe(before.height);
        grip.fire('pointercancel', { clientY: 100, pointerType: 'touch' });
        expect(panel.top).toBeCloseTo(before.top);
        expect(panel.mobileHeight).toBeCloseTo(before.height);
        expect(sizes).not.toHaveBeenCalled();
    });
});

describe('SidePanel standard dock', () => {
    it('stays bottom-attached on phone header gestures and restores after maximize', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Standard', 'x-standard', { standardPane: true, maximizable: true, resizable: true });
        const el = panel.el as unknown as StubEl & { closest: (selector: string) => StubEl | null };
        el.closest = (selector) => selector.includes('mobile') ? el : null;
        const grip = find(el, 'vela-panel-grip')!;
        const header = find(el, 'vela-panel-header')!;
        expect(el.dataset.standardPane).toBe('1');
        expect(find(el, 'vela-panel-max')).toBeDefined();
        panel.setDesktopHeight(0.25);
        expect(panel.desktopHeight).toBeNull();
        panel.setTop(0.1);
        expect(panel.top + panel.mobileHeight).toBe(1);
        grip.fire('pointerdown', { clientY: 200 });
        grip.fire('pointermove', { clientY: 72 });
        grip.fire('pointerup', { clientY: 72 });
        expect(panel.mobileHeight).toBeCloseTo(0.6, 3);
        expect(panel.top + panel.mobileHeight).toBeCloseTo(1, 3);
        header.fire('pointerdown', { clientY: 300 });
        header.fire('pointermove', { clientY: 400 });
        header.fire('pointerup', { clientY: 400 });
        expect(panel.top).toBeCloseTo(0.4, 3);
        expect(panel.top + panel.mobileHeight).toBeCloseTo(1, 3);
        const previous = [panel.top, panel.mobileHeight];
        panel.setMaximized(true);
        expect(panel.maximized).toBe(true);
        panel.setMaximized(false);
        expect([panel.top, panel.mobileHeight]).toEqual(previous);
        panel.restoreMobileTop(0.8); // legacy detached position is ignored
        expect(panel.top + panel.mobileHeight).toBeCloseTo(1, 3);
        expect(el.dataset.mobileDetached).toBeUndefined();
    });
});

describe('Desktop floating side panels', () => {
    it('switches a standard panel between the side dock and a floating card with the header button', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Data', 'x-data', { standardPane: true, resizable: true });
        const button = find(panel.el as never, 'vela-panel-dock-toggle');
        expect(button).toBeDefined();
        const changes: boolean[] = [];
        panel.onFloatingChange = (floating) => changes.push(floating);
        button!.fire('click');
        expect(panel.floating).toBe(true);
        expect((panel.el as unknown as StubEl).dataset.freeFloating).toBe('1');
        button!.fire('click');
        expect(panel.floating).toBe(false);
        expect((panel.el as unknown as StubEl).dataset.freeFloating).toBeUndefined();
        expect(changes).toEqual([true, false]);
    });

    it('restores several floating panels and suspends them without stacking phone panes', () => {
        const { root } = stubDoc();
        const dock = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        const a = new SidePanel(root as never, 'A', 'x-a', { standardPane: true });
        const b = new SidePanel(root as never, 'B', 'x-b', { standardPane: true });
        const c = new SidePanel(root as never, 'C', 'x-c', { standardPane: true });
        for (const [id, panel] of [['a', a], ['b', b], ['c', c]] as const) {
            dock.addBuiltIn({ id, title: id, icon: id, order: 1, panel });
        }
        dock.applyState({ open: 'c', floating: ['a', 'b'], floatingOpen: ['a', 'b'], floatPositions: { a: { x: 0.2, y: 0.3 } } });
        expect([a.open, b.open, c.open]).toEqual([true, true, true]);
        expect(a.floatingPosition).toEqual({ x: 0.2, y: 0.3 });
        expect(dock.getState()).toMatchObject({ open: 'c', floating: ['a', 'b'], floatingOpen: ['a', 'b'], floatPositions: { a: { x: 0.2, y: 0.3 } } });
        expect((c.el as unknown as StubEl).dataset.dockFront).toBe('1');
        dock.applyState({ open: 'a', floating: ['b', 'c'], floatingOpen: ['b', 'c'] });
        expect((a.el as unknown as StubEl).dataset.dockFront).toBe('1');
        dock.applyState({ open: 'c', floating: ['a', 'b'], floatingOpen: ['a', 'b'], floatPositions: { a: { x: 0.2, y: 0.3 } } });
        dock.setLayout('mobile');
        expect([a.open, b.open, c.open]).toEqual([false, false, true]);
        expect(dock.getState()?.floatingOpen).toEqual(['a', 'b']);
        dock.setLayout('desktop');
        expect([a.open, b.open, c.open]).toEqual([true, true, true]);
        dock.setLayout('mobile');
        dock.toggle('a', true); // choosing a floating panel on phone still shows only one pane
        expect([a.open, b.open, c.open]).toEqual([true, false, false]);
        dock.toggle('a', false); // an explicit close is not resurrected on desktop
        dock.setLayout('desktop');
        expect([a.open, b.open, c.open]).toEqual([false, true, false]);
    });

    it('sanitizes floating state and remembers a closed panel’s mode and position', () => {
        const state = sanitizeState({ version: 1, layout: '1', charts: [], panels: {
            floating: ['a', '', 3, 'a'], floatingOpen: ['a', null, 'a'],
            floatPositions: { a: { x: 0.25, y: 0.5 }, bad: { x: 2, y: 0.5 }, nan: { x: Number.NaN, y: 0 } },
        } });
        expect(state?.panels).toEqual({ floating: ['a'], floatingOpen: ['a'], floatPositions: { a: { x: 0.25, y: 0.5 } } });
        const { root } = stubDoc();
        const dock = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        const a = new SidePanel(root as never, 'A', 'x-a', { standardPane: true });
        dock.addBuiltIn({ id: 'a', title: 'A', icon: 'a', order: 1, panel: a });
        dock.applyState(state!.panels);
        dock.toggle('a', false);
        expect(dock.getState()).toEqual({ floating: ['a'], floatPositions: { a: { x: 0.25, y: 0.5 } } });
        dock.toggle('a', true);
        expect(a.floating).toBe(true);
        expect(a.floatingPosition).toEqual({ x: 0.25, y: 0.5 });
    });

    it('keeps floating panels open beside one docked panel and replaces the dock on redock', () => {
        const { root } = stubDoc();
        const dock = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        const a = new SidePanel(root as never, 'A', 'x-a', { standardPane: true });
        const b = new SidePanel(root as never, 'B', 'x-b', { standardPane: true });
        dock.addBuiltIn({ id: 'a', title: 'A', icon: 'a', order: 1, panel: a });
        dock.addBuiltIn({ id: 'b', title: 'B', icon: 'b', order: 2, panel: b });
        dock.toggle('a', true);
        a.setFloating(true, true);
        dock.toggle('b', true);
        expect(a.open).toBe(true);
        expect(b.open).toBe(true);
        expect(dock.getState()).toMatchObject({ open: 'b', floating: ['a'], floatingOpen: ['a'] });
        a.setFloating(false, true);
        expect(a.open).toBe(true);
        expect(b.open).toBe(false);
        expect(dock.openId).toBe('a');
    });
});

describe('SidePanel width', () => {
    it('a fixed panel keeps its declared width and takes any programmatic size', () => {
        const { doc, root } = stubDoc();
        const panel = new SidePanel(root as never, 'Fixed', 'x-fixed');
        expect(panel.width).toBe(280);
        expect(find(panel.el as never, 'vela-panel-resizer')).toBeUndefined();
        panel.setWidth(900); // no resize bounds on a fixed panel
        expect(panel.width).toBe(900);
        expect((panel.el as unknown as StubEl).style.props['--vela-panel-w']).toBe('900px');
        expect(doc).toBeTruthy();
    });

    it('a resizable panel drags from its inner edge, clamped, and reports the settled width once', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sized', 'x-sized', { width: 300, resizable: true, minWidth: 240, maxWidth: 500 });
        const seen: number[] = [];
        panel.onWidthChange = (px) => seen.push(px);
        const handle = find(panel.el as never, 'vela-panel-resizer');
        expect(handle).toBeDefined();

        handle!.fire('pointerdown', { clientX: 1000 });
        handle!.fire('pointermove', { clientX: 940 }); // dragging AWAY from the right edge widens
        expect(panel.width).toBe(360);
        handle!.fire('pointermove', { clientX: 200 }); // past the max
        expect(panel.width).toBe(500);
        handle!.fire('pointerup', { clientX: 200 });
        expect(seen).toEqual([500]); // the settled width only, never the intermediate frames

        handle!.fire('dblclick');
        expect(panel.width).toBe(300); // back to the declared width
        expect(seen).toEqual([500, 300]);
    });

    it('names the width separator, follows the title, and resizes from the keyboard', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sized', 'x-sized', { width: 300, resizable: true, minWidth: 240, maxWidth: 500 });
        const element = panel.el as unknown as StubEl & { closest: () => object };
        element.closest = () => ({}); // desktop layout in the minimal DOM
        const handle = find(element, 'vela-panel-resizer')!;
        const changed: number[] = [];
        panel.onWidthChange = (width) => changed.push(width);
        expect(handle.tabIndex).toBe(0);
        expect(handle.attributes).toMatchObject({ role: 'separator', 'aria-orientation': 'vertical',
            'aria-label': 'Resize Sized panel width', 'aria-controls': element.id, 'aria-valuenow': '300' });
        panel.setTitle('Renamed');
        expect(handle.attributes['aria-label']).toBe('Resize Renamed panel width');
        handle.fire('keydown', { key: 'ArrowLeft' });
        expect(panel.width).toBe(316);
        expect(handle.attributes['aria-valuenow']).toBe('316');
        handle.fire('keydown', { key: 'ArrowRight', shiftKey: true });
        expect(panel.width).toBe(268);
        handle.fire('keydown', { key: 'Home' });
        expect(panel.width).toBe(240);
        handle.fire('keydown', { key: 'End' });
        expect(panel.width).toBe(500);
        expect(changed).toEqual([316, 268, 240, 500]);
    });

    it('setWidth is silent — restoring a persisted width is not a user change', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sized', 'x-sized', { resizable: true });
        const onWidthChange = vi.fn();
        panel.onWidthChange = onWidthChange;
        panel.setWidth(420);
        expect(panel.width).toBe(420);
        expect(onWidthChange).not.toHaveBeenCalled();
    });
});

describe('SidePanel placement', () => {
    it('docks by default; `overlay` marks the element so the shell floats it over the chart', () => {
        const { root } = stubDoc();
        const docked = new SidePanel(root as never, 'Docked', 'x-docked', { resizable: true });
        expect((docked.el as unknown as StubEl).dataset.overlay).toBeUndefined();
        expect(docked.overlay).toBe(false);
        expect(find(docked.el as never, 'vela-panel-pin')).toBeUndefined(); // nothing to pin
        const floating = new SidePanel(root as never, 'Floating', 'x-floating', { width: 800, resizable: true, overlay: true });
        expect((floating.el as unknown as StubEl).dataset.overlay).toBe('1');
        expect(floating.overlay).toBe(true);
        // Width policy is independent of placement — an overlay still resizes and clamps.
        expect(floating.width).toBe(640);
        expect(find(floating.el as never, 'vela-panel-resizer')).toBeDefined();
    });

    it('the pin docks a floating panel and reports the user’s choice; setOverlay is silent', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Floating', 'x-floating', { overlay: true });
        const seen: boolean[] = [];
        panel.onPlacementChange = (overlay) => seen.push(overlay);
        const pin = find(panel.el as never, 'vela-panel-pin')!;
        expect(pin).toBeDefined();
        expect(pin.dataset.on).toBe('0');

        pin.fire('click'); // pin → docked column
        expect(panel.overlay).toBe(false);
        expect((panel.el as unknown as StubEl).dataset.overlay).toBeUndefined();
        expect(pin.dataset.on).toBe('1');
        pin.fire('click'); // unpin → floats again
        expect(panel.overlay).toBe(true);
        expect(seen).toEqual([false, true]);

        panel.setOverlay(false); // a restore: applied, not reported
        expect(panel.overlay).toBe(false);
        expect(seen).toEqual([false, true]);
    });

    it('a docked panel cannot be floated from code — only a declared overlay can', () => {
        const { root } = stubDoc();
        const docked = new SidePanel(root as never, 'Docked', 'x-docked');
        docked.setOverlay(true);
        expect(docked.overlay).toBe(false);
        expect((docked.el as unknown as StubEl).dataset.overlay).toBeUndefined();
    });
});

describe('SidePanel maximize', () => {
    it('a maximizable panel carries a header button that maximizes and restores it', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Editor', 'x-ed', { overlay: true, maximizable: true });
        const el = panel.el as unknown as StubEl;
        const button = find(panel.el as never, 'vela-panel-max')!;
        expect(button).toBeDefined();
        expect(button.title).toBe('Maximize');

        panel.toggle(true);
        button.fire('click');
        expect(panel.maximized).toBe(true);
        expect(el.dataset.maximized).toBe('1');
        expect(button.title).toBe('Restore');
        button.fire('click');
        expect(panel.maximized).toBe(false);
        expect(el.dataset.maximized).toBeUndefined();

        // Closing restores it: a panel reopens at its own size.
        panel.setMaximized(true);
        panel.toggle(false);
        expect(panel.maximized).toBe(false);
        expect(el.dataset.maximized).toBeUndefined();
    });

    it('a panel not declared maximizable ignores desktop calls but has a phone toggle', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Tree', 'x-tree');
        expect(find(panel.el as never, 'vela-panel-max')).toBeDefined();
        panel.setMaximized(true);
        expect(panel.maximized).toBe(false);
    });

    it('a contributed panel declares it and drives it through its header', () => {
        const { root } = stubDoc();
        const d = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        let header: Parameters<Parameters<typeof registerSidePanel>[0]['mount']>[2] | null = null;
        const off = registerSidePanel({ id: 'm', title: 'M', icon: 'im', overlay: true, maximizable: true, mount: (_c, _b, h) => void (header = h) });
        d.refresh();
        // A closed panel stays out of the document; its header shows up with the first open.
        expect(find(root, 'vela-panel-max')).toBeUndefined();
        d.toggle('m', true);
        expect(find(root, 'vela-panel-max')).toBeDefined();
        header!.setMaximized(true);
        expect(header!.maximized).toBe(true);
        expect(find(root, 'vela-panel-m')!.dataset.maximized).toBe('1');
        off();
        d.refresh();
    });
});

describe('registerSidePanel', () => {
    it('sorts by order, replaces by id, and unregisters through the disposer', () => {
        const mount = (): void => {};
        const offB = registerSidePanel({ id: 'b', title: 'B', icon: 'i', order: 5, mount });
        const offA = registerSidePanel({ id: 'a', title: 'A', icon: 'i', order: 1, mount });
        const offC = registerSidePanel({ id: 'c', title: 'C', icon: 'i', mount }); // default order, last
        expect(sidePanels().map((p) => p.id)).toEqual(['a', 'b', 'c']);

        registerSidePanel({ id: 'a', title: 'A2', icon: 'i', order: 9, mount });
        expect(sidePanels().map((p) => p.id)).toEqual(['b', 'a', 'c']);
        expect(sidePanels().find((p) => p.id === 'a')?.title).toBe('A2');

        offA(); // a stale disposer must not drop the descriptor that replaced it
        expect(sidePanels().map((p) => p.id)).toEqual(['b', 'a', 'c']);
        unregisterSidePanel('a');
        offB();
        offC();
        expect(sidePanels()).toEqual([]);
    });
});

describe('PanelDock', () => {
    function dock(): {
        dock: PanelDock;
        panels: Record<'a' | 'b', SidePanel>;
        buttons: () => SidePanelButton[];
        active: Map<string, boolean>;
        changed: () => number;
        root: StubEl;
    } {
        const { root } = stubDoc();
        let buttons: SidePanelButton[] = [];
        const active = new Map<string, boolean>();
        let changes = 0;
        const d = new PanelDock(root as never, {
            chrome: {
                setPanelButtons: (list) => void (buttons = [...list]),
                setPanelActive: (id, open) => void active.set(id, open),
            },
            context: () => ctx,
            changed: () => void (changes += 1),
        });
        const a = new SidePanel(root as never, 'A', 'x-a');
        const b = new SidePanel(root as never, 'B', 'x-b', { resizable: true });
        d.addBuiltIn({ id: 'a', title: 'A', icon: 'ia', order: 10, panel: a });
        d.addBuiltIn({ id: 'b', title: 'B', icon: 'ib', order: 20, panel: b });
        return { dock: d, panels: { a, b }, buttons: () => buttons, active, changed: () => changes, root };
    }

    it('projects one button per panel, in dock order', () => {
        const { buttons } = dock();
        expect(buttons()).toEqual([
            { id: 'a', title: 'A', icon: 'ia' },
            { id: 'b', title: 'B', icon: 'ib' },
        ]);
    });

    it('can dock and persist a dedicated-slot panel without publishing a duplicate button', () => {
        const { dock: d, root, buttons, active } = dock();
        const dedicated = new SidePanel(root as never, 'Dedicated', 'x-dedicated');
        d.addBuiltIn({ id: 'dedicated', title: 'Dedicated', icon: 'i', order: 30, panel: dedicated, showInChrome: false });
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b']);
        expect(d.list().map((b) => b.id)).toEqual(['a', 'b']);
        d.toggle('dedicated', true);
        expect(d.openId).toBe('dedicated');
        expect(active.get('dedicated')).toBe(true);
        expect(d.getState()).toEqual({ open: 'dedicated' });
        d.toggle('dedicated', false);
        d.applyState({ open: 'dedicated' });
        expect(d.openId).toBe('dedicated');
        dedicated.destroy();
    });

    it('is exclusive: opening one closes the other, and both pressed states are pushed', () => {
        const { dock: d, panels, active } = dock();
        d.toggle('a');
        expect(panels.a.open).toBe(true);
        expect(active.get('a')).toBe(true);
        d.toggle('b');
        expect(panels.b.open).toBe(true);
        expect(panels.a.open).toBe(false);
        expect(active.get('a')).toBe(false);
        expect(d.openId).toBe('b');
        d.toggle('b', false);
        expect(d.openId).toBeNull();
    });

    it('unknown ids are ignored', () => {
        const { dock: d } = dock();
        expect(() => d.toggle('nope')).not.toThrow();
        expect(d.openId).toBeNull();
    });

    it('persists the open panel and the widths the user dragged — nothing else', () => {
        const { dock: d, panels, changed } = dock();
        expect(d.getState()).toBeNull(); // closed, untouched widths: nothing to save
        d.toggle('a');
        expect(d.getState()).toEqual({ open: 'a' });
        panels.b.setWidth(360); // programmatic: not a user width
        expect(d.getState()).toEqual({ open: 'a' });
        panels.b.onWidthChange?.(360); // what the drag reports
        expect(d.getState()).toEqual({ open: 'a', widths: { b: 360 } });
        expect(changed()).toBeGreaterThan(0);
    });

    it('records a floating corner resize as one atomic size and position change', () => {
        const { dock: d, panels, changed } = dock();
        const before = changed();
        panels.b.onFloatingResize?.(164, 0.21, { x: 0.25, y: 0.4 });
        expect(changed()).toBe(before + 1);
        expect(d.getState()).toMatchObject({ widths: { b: 164 }, desktopHeights: { b: 0.21 },
            floatPositions: { b: { x: 0.25, y: 0.4 } } });
    });

    it('restores the complete width snapshot, including defaults for absent widths', () => {
        const { dock: d, panels } = dock();
        const initial = panels.b.width;
        panels.b.setWidth(420);
        panels.b.onWidthChange?.(420);
        expect(d.getState()?.widths).toEqual({ b: 420 });
        d.applyState({ open: 'b' });
        expect(panels.b.width).toBe(initial);
        expect(d.getState()?.widths).toBeUndefined();
        d.applyState({ open: 'b', widths: { b: 420 } });
        expect(panels.b.width).toBe(420);
        expect(d.getState()?.widths).toEqual({ b: 420 });
    });

    it('persists mobile geometry and desktop height independently, sanitizes and resets', () => {
        const { dock: d, panels } = dock();
        panels.a.setTop(0.42, true);
        panels.a.setMobileHeight(0.55, true);
        panels.a.setDesktopHeight(0.72, true);
        expect(d.getState()).toEqual({ tops: { a: 0.45 }, heights: { a: 0.55 }, desktopHeights: { a: 0.72 } });
        d.applyState({ tops: { a: 0.3 }, heights: { a: 0.6 }, desktopHeights: { a: 0.8 } });
        expect(panels.a.top).toBe(0.4); // old independent top no longer detaches the phone pane
        expect(panels.a.mobileHeight).toBe(0.6);
        expect(panels.a.desktopHeight).toBe(0.8);
        const state = sanitizeState({ version: 1, layout: '1', charts: [], panels: {
            tops: { a: 0.55, bad: 4 }, heights: { a: 0.6, bad: -1, huge: 4 }, desktopHeights: { a: 0.8, nan: Number.NaN },
        } });
        expect(state?.panels?.tops).toEqual({ a: 0.55 });
        expect(state?.panels?.heights).toEqual({ a: 0.6 });
        expect(state?.panels?.desktopHeights).toEqual({ a: 0.8 });
        d.applyState({});
        expect(panels.a.top).toBe(0.6);
        expect(panels.a.mobileHeight).toBe(0.4);
        expect(panels.a.desktopHeight).toBeNull();
    });

    it('persists the floating panels the user pinned, applies them on restore, and remembers them for late panels', () => {
        const { dock: d, root, changed } = dock();
        const off = registerSidePanel({ id: 'x', title: 'X', icon: 'ix', overlay: true, mount: () => {} });
        d.refresh();
        // Its header exists once the column has been opened once (a closed panel stays out of
        // the document); closed again, it keeps its nodes so the pin is still there.
        d.toggle('x', true);
        d.toggle('x', false);
        const pin = find(root, 'vela-panel-x')!.children.find((c) => c.className === 'vela-panel-header')!.children.find((c) => c.className === 'vela-panel-pin')!;
        const before = changed();
        pin.fire('click');
        expect(d.getState()).toEqual({ pinned: ['x'] });
        expect(changed()).toBe(before + 1);
        pin.fire('click');
        expect(d.getState()).toBeNull();

        // A restore applies the list wholesale — and its absence unpins.
        d.applyState({ pinned: ['x'] });
        expect(find(root, 'vela-panel-x')!.dataset.overlay).toBeUndefined();
        d.applyState({ open: 'a' });
        expect(find(root, 'vela-panel-x')!.dataset.overlay).toBe('1');

        // A pinned id naming a panel that registers later applies when it docks.
        off();
        d.refresh();
        d.applyState({ pinned: ['late'] });
        registerSidePanel({ id: 'late', title: 'Late', icon: 'il', overlay: true, mount: () => {} });
        d.refresh();
        d.toggle('late', true);
        expect(find(root, 'vela-panel-late')!.dataset.overlay).toBeUndefined();
        d.toggle('late', false);
        unregisterSidePanel('late');
        d.refresh();
    });

    it('keeps the legacy overlay pin and new floating toggle consistent', () => {
        const { dock: d, root, panels } = dock();
        const off = registerSidePanel({ id: 'overlayProbe', title: 'Overlay', icon: 'i', overlay: true, mount: () => {} });
        d.refresh(); d.toggle('overlayProbe', true);
        const el = find(root, 'vela-panel-overlayProbe')!;
        const pin = find(el, 'vela-panel-pin')!;
        const toggle = find(el, 'vela-panel-dock-toggle')!;
        expect(el.dataset.overlay).toBe('1');
        toggle.fire('click');
        expect(el.dataset.freeFloating).toBe('1');
        expect(d.getState()?.floatingOpen).toEqual(['overlayProbe']);
        d.toggle('a', true);
        expect(panels.a.open).toBe(true);
        pin.fire('click'); // pin a free card directly into the exclusive side column
        expect(el.dataset.freeFloating).toBeUndefined();
        expect(el.dataset.overlay).toBeUndefined();
        expect(panels.a.open).toBe(false);
        expect(d.getState()).toMatchObject({ open: 'overlayProbe', pinned: ['overlayProbe'] });
        expect(d.getState()?.floating).toBeUndefined();
        pin.fire('click'); // old pin still restores the anchored overlay
        expect(el.dataset.overlay).toBe('1');
        expect(d.getState()?.pinned).toBeUndefined();
        toggle.fire('click');
        toggle.fire('click'); // the explicit Dock action pins an anchored overlay too
        expect(el.dataset.overlay).toBeUndefined();
        expect(d.getState()?.pinned).toEqual(['overlayProbe']);
        off(); d.refresh();
    });

    it('reapplies a floating position after the restored height, so temporary clamps do not win', () => {
        const { dock: d, panels } = dock();
        const position = vi.spyOn(panels.b, 'setFloatingPosition');
        const height = vi.spyOn(panels.b, 'setDesktopHeight');
        const saved = { x: 0.2, y: 0.45 };
        d.applyState({ open: 'b', floating: ['b'], floatingOpen: ['b'],
            desktopHeights: { b: 0.4 }, floatPositions: { b: saved } });
        expect(panels.b.floating).toBe(true);
        expect(position.mock.calls[position.mock.calls.length - 1]?.[0]).toEqual(saved);
        expect(position.mock.invocationCallOrder[position.mock.invocationCallOrder.length - 1]!)
            .toBeGreaterThan(height.mock.invocationCallOrder[height.mock.invocationCallOrder.length - 1]!);
    });

    it('restores a document: widths apply, the named panel opens, the others close', () => {
        const { dock: d, panels } = dock();
        d.toggle('a');
        d.applyState({ open: 'b', widths: { b: 400 } });
        expect(panels.a.open).toBe(false);
        expect(panels.b.open).toBe(true);
        expect(panels.b.width).toBe(400);
        d.applyState(undefined); // a document with no panels field leaves the dock alone
        expect(panels.b.open).toBe(true);
    });

    it('a restored panel that registers later opens (and its width applies) when it docks', () => {
        const { dock: d, panels } = dock();
        d.applyState({ open: 'late', widths: { late: 420 } });
        expect(d.openId).toBeNull(); // nothing to open yet
        const off = registerSidePanel({ id: 'late', title: 'Late', icon: 'il', resizable: true, mount: () => {} });
        d.refresh();
        expect(d.openId).toBe('late');
        expect(d.getState()).toEqual({ open: 'late', widths: { late: 420 } });
        off();
        d.refresh();

        // …but a column the user picked in the meantime keeps the dock.
        const off2 = registerSidePanel({ id: 'late2', title: 'Late 2', icon: 'il', mount: () => {} });
        d.applyState({ open: 'late2' });
        d.toggle('a');
        d.refresh();
        expect(d.openId).toBe('a');
        expect(panels.a.open).toBe(true);
        off2();
        d.refresh();
    });

    it('restores late floating contributions alongside a dock and preserves them on descriptor refresh', () => {
        const { dock: d, panels, root } = dock();
        d.applyState({ open: 'a', widths: { lateFloat: 340 }, floating: ['lateFloat', 'secondFloat'],
            floatingOpen: ['lateFloat', 'secondFloat'], floatPositions: { lateFloat: { x: 0.2, y: 0.3 } } });
        expect(panels.a.open).toBe(true);
        const off1 = registerSidePanel({ id: 'lateFloat', title: 'Late', icon: 'i', resizable: true, mount: () => {} });
        const off2 = registerSidePanel({ id: 'secondFloat', title: 'Second', icon: 'i', mount: () => {} });
        d.refresh();
        expect(panels.a.open).toBe(true);
        expect(find(root, 'vela-panel-lateFloat')?.dataset.freeFloating).toBe('1');
        expect(find(root, 'vela-panel-secondFloat')?.dataset.freeFloating).toBe('1');
        expect(d.getState()).toMatchObject({ open: 'a', widths: { lateFloat: 340 },
            floatingOpen: ['lateFloat', 'secondFloat'], floatPositions: { lateFloat: { x: 0.2, y: 0.3 } } });
        const replacement = registerSidePanel({ id: 'lateFloat', title: 'Late replacement', icon: 'i', resizable: true, mount: () => {} });
        d.refresh();
        expect(panels.a.open).toBe(true);
        expect(find(root, 'vela-panel-lateFloat')?.dataset.freeFloating).toBe('1');
        expect(find(root, 'vela-panel-secondFloat')?.hidden).toBe(false);
        expect(d.getState()?.floatingOpen).toHaveLength(2);
        expect(d.getState()?.floatingOpen).toEqual(expect.arrayContaining(['lateFloat', 'secondFloat']));
        replacement(); off1(); off2(); d.refresh();
    });

    it('a closed panel stays out of the document; the first open mounts it, once', () => {
        const { dock: d, root } = dock();
        const mount = vi.fn(() => ({}));
        const off = registerSidePanel({ id: 'lazy', title: 'Lazy', icon: 'il', mount });
        d.refresh();
        // Docked (the button is there) but not in the document — nothing of its chrome is.
        expect(d.list().map((p) => p.id)).toContain('lazy');
        expect(find(root, 'vela-panel-lazy')).toBeUndefined();

        d.toggle('lazy', true);
        expect(find(root, 'vela-panel-lazy')).toBeDefined();
        expect(mount).toHaveBeenCalledTimes(1);

        d.toggle('lazy', false); // closing keeps its nodes, and its state
        expect(find(root, 'vela-panel-lazy')).toBeDefined();
        d.toggle('lazy', true);
        expect(mount).toHaveBeenCalledTimes(1); // one build for the panel's whole life
        off();
        d.refresh();
    });

    it('mounts contributed panels with their body, rebinds them, and keeps them open across a refresh', () => {
        const { dock: d, buttons, root } = dock();
        const onChart = vi.fn();
        const mount = vi.fn((_ctx: WidgetContext, body: HTMLElement) => {
            body.appendChild(body.ownerDocument.createElement('div'));
            return { onChart };
        });
        const off = registerSidePanel({ id: 'x', title: 'X', icon: 'ix', width: 320, resizable: true, overlay: true, mount });
        d.refresh();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b', 'x']); // default order lands last
        expect(mount).toHaveBeenCalledTimes(1);
        // Docked but closed: mounted, not in the document.
        expect(find(root, 'vela-panel-x')).toBeUndefined();

        const chartPlaced = find; // keep the helper name for the read below

        const chart = {} as never;
        d.onChart(chart);
        expect(onChart).toHaveBeenCalledWith(chart);

        d.toggle('x');
        // The descriptor's placement reaches the panel the dock builds.
        expect(chartPlaced(root, 'vela-panel-x')!.dataset.overlay).toBe('1');
        d.refresh(); // a late registration elsewhere must not close the open panel
        expect(d.openId).toBe('x');
        expect(mount).toHaveBeenCalledTimes(1); // an unchanged descriptor stays mounted — its state survives

        // A REPLACED descriptor (same id) is rebuilt, and the open column stays open.
        const mount2 = vi.fn(() => ({ onChart }));
        const off2 = registerSidePanel({ id: 'x', title: 'X2', icon: 'ix', mount: mount2 });
        d.refresh();
        expect(mount2).toHaveBeenCalledTimes(1);
        expect(onChart).toHaveBeenCalledTimes(2); // the rebuilt panel binds to the current chart
        expect(d.openId).toBe('x');
        off2();

        off();
        d.refresh();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b']);
        expect(d.openId).toBeNull();
    });

    it('hands mount the header surface: a slot next to the title, and setTitle', () => {
        const { root } = stubDoc();
        const d = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        let slotChildren = -1;
        const off = registerSidePanel({
            id: 'h',
            title: 'Declared',
            icon: 'ih',
            mount: (_ctx, _body, header) => {
                header.slot.appendChild((header.slot.ownerDocument as Document).createElement('button'));
                header.setTitle('My script');
                slotChildren = (header.slot as unknown as StubEl).children.length;
            },
        });
        d.refresh();
        d.toggle('h', true);
        const panel = find(root, 'vela-panel-h')!;
        expect(find(panel, 'vela-panel-title')!.textContent).toBe('My script'); // setTitle replaced the declared title
        expect(slotChildren).toBe(1); // the control landed in the slot
        // The slot sits between the title and the close button in the header row.
        const header = find(panel, 'vela-panel-header')!;
        expect(header.children.map((c) => c.className)).toEqual([
            'vela-panel-grip',
            'vela-panel-title',
            'vela-panel-header-slot',
            'vela-panel-max',
            'vela-panel-dock-toggle',
            'vela-panel-close',
            'vela-panel-corner-resize',
        ]);
        expect(find(panel, 'vela-panel-grip')).toBeDefined();
        off();
        d.refresh();
    });

    it('a contribution that throws on mount is contained', () => {
        const { dock: d, buttons } = dock();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const off = registerSidePanel({
            id: 'boom',
            title: 'Boom',
            icon: 'ib',
            mount: () => {
                throw new Error('nope');
            },
        });
        expect(() => d.refresh()).not.toThrow();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b', 'boom']); // docked, just empty
        expect(warn).toHaveBeenCalled();
        off();
        d.refresh();
        warn.mockRestore();
    });
});

describe('sanitizeState — panels', () => {
    const base = { version: 1, layout: '1', charts: [] };

    it('keeps a usable dock state', () => {
        const st = sanitizeState({ ...base, panels: { open: 'objects', widths: { objects: 320 }, pinned: ['editor'] } });
        expect(st?.panels).toEqual({ open: 'objects', widths: { objects: 320 }, pinned: ['editor'] });
    });

    it('drops malformed fields rather than throwing', () => {
        expect(sanitizeState({ ...base, panels: { open: 42, widths: { a: 'wide', b: -5, c: 0, d: 260 } } })?.panels).toEqual({ widths: { d: 260 } });
        expect(sanitizeState({ ...base, panels: { pinned: ['x', 7, '', 'x', null] } })?.panels).toEqual({ pinned: ['x'] });
        expect(sanitizeState({ ...base, panels: { pinned: 'x' } })?.panels).toBeUndefined();
        expect(sanitizeState({ ...base, panels: 'nope' })?.panels).toBeUndefined();
        expect(sanitizeState({ ...base, panels: { open: '', widths: {} } })?.panels).toBeUndefined();
    });

    it('a document written before the dock has no panels field', () => {
        expect(sanitizeState(base)?.panels).toBeUndefined();
    });
});
