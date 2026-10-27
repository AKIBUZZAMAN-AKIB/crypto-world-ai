// @vitest-environment jsdom
// The layout menu — TradingView's "manage layouts" panel, on the name chip that sits after
// undo/redo. These tests pin the CONTRACT the panel has with the workspace: the five verbs,
// the one naming dialog, the two-step delete, and the rule that every verb repaints the
// model instead of the panel caching a name.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];

import { LayoutMenu, type LayoutMenuModel, type LayoutMenuRow } from '../src/widget/layout-menu';
import { Topbar } from '../src/widget/topbar';

// jsdom ships no `CSS.escape`; the style injector needs it for its id lookup.
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

interface Stub {
    layout: LayoutMenuModel;
    rows: LayoutMenuRow[];
    calls: string[];
    active: () => string | null;
    dirty: (on: boolean) => void;
    autosaveOn: () => boolean;
}

/** A live model: the panel reads it on every render, exactly like the workspace's. */
function stub(initial: Array<{ name: string; charts?: number; indicators?: number }> = [], activeName: string | null = null): Stub {
    const rows: LayoutMenuRow[] = initial.map((r) => ({ name: r.name, active: false, charts: r.charts ?? 4, indicators: r.indicators ?? 2, savedAt: Date.now() }));
    const calls: string[] = [];
    let current = activeName;
    let dirty = false;
    let autosave = false;
    const save = (name: string): void => {
        if (!rows.some((r) => r.name === name)) rows.push({ name, active: false, charts: 4, indicators: 2, savedAt: Date.now() });
        current = name;
        dirty = false;
        calls.push(`saveAs:${name}`);
    };
    const layout: LayoutMenuModel = {
        activeLayout: () => current,
        savedLayouts: () => rows.map((r) => ({ ...r, active: r.name === current, dirty: r.name === current && dirty })),
        autosave: () => autosave,
        onToggleAutosave: (on) => {
            autosave = on;
            calls.push(`autosave:${on}`);
        },
        onSaveChanges: () => {
            dirty = false;
            calls.push('save');
        },
        onSaveLayout: save,
        onSaveLayoutWithThumb: (name) => {
            save(name);
            return true;
        },
        onDuplicateLayout: (name) => {
            const copy = `${name} copy`;
            rows.push({ name: copy, active: false, charts: 4, indicators: 2, savedAt: Date.now() });
            calls.push(`copy:${name}`);
            return copy;
        },
        onRenameLayout: (from, to) => {
            if (to === 'Taken') return false;
            const row = rows.find((r) => r.name === from);
            if (!row) return false;
            row.name = to;
            if (current === from) current = to;
            calls.push(`rename:${from}->${to}`);
            return true;
        },
        onOpenLayout: (name) => {
            current = name;
            dirty = false;
            calls.push(`open:${name}`);
        },
        onDeleteLayout: (name) => {
            const at = rows.findIndex((r) => r.name === name);
            if (at >= 0) rows.splice(at, 1);
            if (current === name) current = null;
            calls.push(`delete:${name}`);
        },
        onShareLayout: async (name) => {
            calls.push(`share:${name}`);
            return 'https://vela.test/#s1=abc';
        },
        onExportLayout: (name) => JSON.stringify({ name }),
        onExportData: () => ({ rows: 1234, filename: 'BTCUSDT_60.csv' }),
        onImportLayout: (json) => {
            calls.push(`import:${json}`);
            return 'Imported';
        },
        onCopyLink: async () => 'https://vela.test/#s1=whole',
    };
    return {
        layout,
        rows,
        calls,
        active: () => current,
        dirty: (on) => {
            dirty = on;
        },
        autosaveOn: () => autosave,
    };
}

function mount(s: Stub): { menu: LayoutMenu; trigger: HTMLButtonElement } {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.appendChild(host);
    const trigger = document.createElement('button');
    trigger.textContent = 'Layout name';
    host.appendChild(trigger);
    const menu = new LayoutMenu({ layout: s.layout, host });
    return { menu, trigger };
}

const panel = (): HTMLElement | null => document.querySelector('.vela-lm');
const rowLabels = (): string[] => [...document.querySelectorAll('.vela-lm-row')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const click = (el: Element | null | undefined): void => {
    expect(el).toBeTruthy();
    (el as HTMLElement).click();
};

describe('the layout menu', () => {
    let menus: LayoutMenu[] = [];
    beforeEach(() => {
        document.body.replaceChildren();
        menus = [];
    });
    afterEach(() => {
        for (const m of menus) m.destroy();
        document.body.replaceChildren();
    });
    const open = (s: Stub): { menu: LayoutMenu; trigger: HTMLButtonElement } => {
        const lot = mount(s);
        menus.push(lot.menu);
        lot.menu.open(lot.trigger);
        return lot;
    };

    it('opens on the name chip and lists TradingView’s verbs in their order', () => {
        const s = stub([{ name: 'Morning setup' }], 'Morning setup');
        const { menu, trigger } = open(s);
        expect(menu.isOpen).toBe(true);
        expect(trigger).toBeTruthy();
        expect(panel()).not.toBeNull();
        expect(rowLabels()).toEqual(['Save as…', 'Make a copy…', 'Rename…', 'Share link', 'Export chart data (CSV)', 'Import layout file…']);
        // The name is the heading, and the meta line answers "how big is this?".
        expect(panel()?.querySelector('.vela-lm-title')?.textContent).toBe('Morning setup');
        expect(panel()?.querySelector('.vela-lm-meta')?.textContent).toContain('4 charts');
    });

    it('an untitled document says so, and saving asks for a name first', () => {
        const s = stub();
        open(s);
        expect(panel()?.querySelector('.vela-lm-title')?.textContent).toBe('Untitled layout');
        const primary = panel()?.querySelector<HTMLButtonElement>('.vela-lm-primary');
        expect(primary?.textContent).toContain('Name and save…');
        expect(primary?.disabled).toBe(false);
        click(primary);
        const input = document.querySelector<HTMLInputElement>('.vela-lm-input');
        expect(input).not.toBeNull();
        expect(input?.value).toBe('Untitled layout');
        // The confirm verb is greyed out until the field has a name.
        const ok = document.querySelector<HTMLButtonElement>('.vela-lm-btn[data-primary]');
        input!.value = '   ';
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        expect(ok?.disabled).toBe(true);
        input!.value = 'Desk A';
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        expect(ok?.disabled).toBe(false);
        click(ok);
        expect(s.calls).toContain('saveAs:Desk A');
    });

    it('Save is a no-op while the layout matches the chart, and writes when it drifts', () => {
        const s = stub([{ name: 'A' }], 'A');
        open(s);
        const primary = (): HTMLButtonElement | null => panel()?.querySelector<HTMLButtonElement>('.vela-lm-primary') ?? null;
        expect(primary()?.disabled).toBe(true);
        expect(panel()?.querySelector('.vela-lm-state')?.textContent).toContain('All changes saved');
        s.dirty(true);
        const { menu } = { menu: menus[0]! };
        menu.refresh();
        expect(primary()?.disabled).toBe(false);
        expect(panel()?.querySelector('.vela-lm-state')?.textContent).toContain('Unsaved changes');
        click(primary());
        expect(s.calls).toContain('save');
        expect(menus[0]!.isOpen).toBe(false);
    });

    it('Rename keeps the panel open on a refused name and applies a free one', () => {
        const s = stub([{ name: 'A' }, { name: 'B' }], 'A');
        open(s);
        click([...document.querySelectorAll('.vela-lm-row')].find((el) => el.textContent?.startsWith('Rename')));
        const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.vela-lm-input')!;
        expect(input().value).toBe('A');
        input().value = 'Taken';
        click(document.querySelector('.vela-lm-btn[data-primary]'));
        expect(document.querySelector('.vela-lm-err')?.textContent).toContain('already exists');
        expect(input()).not.toBeNull(); // still open
        input().value = 'Renamed';
        click(document.querySelector('.vela-lm-btn[data-primary]'));
        expect(s.calls).toContain('rename:A->Renamed');
    });

    it('Make a copy asks for a name and renames the copy the workspace minted', () => {
        const s = stub([{ name: 'A' }], 'A');
        open(s);
        click([...document.querySelectorAll('.vela-lm-row')].find((el) => el.textContent?.startsWith('Make a copy')));
        const input = document.querySelector<HTMLInputElement>('.vela-lm-input')!;
        expect(input.value).toBe('A copy');
        input.value = 'B';
        click(document.querySelector('.vela-lm-btn[data-primary]'));
        expect(s.calls).toContain('copy:A');
        expect(s.calls).toContain('rename:A copy->B');
        expect(s.rows.map((r) => r.name)).toContain('B');
    });

    it('Autosave is a switch that repaints from the model', () => {
        const s = stub([{ name: 'A' }], 'A');
        open(s);
        const sw = (): HTMLElement | null => panel()?.querySelector('.vela-lm-switch') ?? null;
        expect(sw()?.getAttribute('aria-checked')).toBe('false');
        click(sw());
        expect(s.calls).toContain('autosave:true');
        expect(s.autosaveOn()).toBe(true);
        expect(sw()?.getAttribute('aria-checked')).toBe('true');
        expect(panel()?.querySelector('.vela-lm-state')?.textContent).toContain('Autosave is on');
    });

    it('a saved row opens that layout; the active one wears a check', () => {
        const s = stub([{ name: 'A' }, { name: 'B' }], 'A');
        open(s);
        const rows = [...document.querySelectorAll<HTMLElement>('.vela-lm-srow')];
        expect(rows).toHaveLength(2);
        expect(rows[0]?.hasAttribute('data-active')).toBe(true);
        expect(rows[0]?.querySelector('.vela-lm-check')).not.toBeNull();
        click(rows[1]?.querySelector('.vela-lm-smain'));
        expect(s.calls).toContain('open:B');
        expect(menus[0]!.isOpen).toBe(false);
    });

    it('the row kebab unfolds the verbs, and Delete takes two taps', () => {
        const s = stub([{ name: 'A' }, { name: 'B' }], 'A');
        open(s);
        click(document.querySelectorAll('.vela-lm-kebab')[1]);
        const strip = [...document.querySelectorAll<HTMLElement>('.vela-lm-act')].map((el) => el.textContent);
        expect(strip).toEqual(['Open', 'Rename…', 'Copy…', 'Share', 'Export', 'Delete']);
        const del = (): HTMLElement | null => [...document.querySelectorAll<HTMLElement>('.vela-lm-act')].find((el) => el.textContent?.startsWith('Delete')) ?? null;
        click(del());
        expect(s.calls).not.toContain('delete:B');
        expect(del()?.textContent).toContain('tap to confirm');
        click(del());
        expect(s.calls).toContain('delete:B');
        expect(s.rows.map((r) => r.name)).toEqual(['A']);
    });

    it('Share reports the clipboard outcome on the status line', async () => {
        const s = stub([{ name: 'A' }], 'A');
        open(s);
        click([...document.querySelectorAll('.vela-lm-row')].find((el) => el.textContent?.startsWith('Share')));
        await vi.waitFor(() => {
            expect(panel()?.querySelector('.vela-lm-state')?.textContent).toContain('Link copied');
        });
        expect(s.calls).toContain('share:A');
    });

    it('Export reports the receipt, not a silent click', () => {
        const s = stub([{ name: 'A' }], 'A');
        open(s);
        click([...document.querySelectorAll('.vela-lm-row')].find((el) => el.textContent?.startsWith('Export')));
        expect(panel()?.querySelector('.vela-lm-state')?.textContent).toContain('1,234 bars');
    });

    it('Escape closes the panel and the chip gets focus back', async () => {
        const s = stub([{ name: 'A' }], 'A');
        const { menu, trigger } = open(s);
        trigger.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await vi.waitFor(() => expect(menu.isOpen).toBe(false));
        expect(document.activeElement).toBe(trigger);
    });
});


// ── the chip in the top bar ──────────────────────────────────────────────────────
describe('the layout name chip', () => {
    beforeEach(() => document.body.replaceChildren());
    afterEach(() => document.body.replaceChildren());

    const mountBar = (s: Stub, composition?: { left?: string[]; right?: string[] }) => {
        const host = document.createElement('div');
        host.className = 'vela-ui';
        document.body.appendChild(host);
        const bar = new Topbar(host, {
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '60',
            timeframes: ['1', '5', '60', '240', 'D'],
            priceStyle: 'candles',
            onTimeframe: () => {},
            onPriceStyle: () => {},
            layout: {
                current: '1x1',
                shape: () => null,
                presets: () => [],
                onSelectGrid: () => {},
                onSelectPreset: () => {},
                syncs: () => [],
                onToggleSync: () => {},
                ...s.layout,
            },
            ...(composition ? { composition } : {}),
        } as never);
        return { bar, host };
    };

    it('sits right after undo/redo in the default composition', () => {
        const s = stub([{ name: 'Morning setup' }], 'Morning setup');
        mountBar(s);
        const order = [...document.querySelectorAll('.vela-widget-topbar .vela-widget-undo, .vela-widget-topbar .vela-widget-redo, .vela-widget-topbar .vela-widget-layoutname')].map((el) =>
            el.classList.contains('vela-widget-undo') ? 'undo' : el.classList.contains('vela-widget-redo') ? 'redo' : 'chip',
        );
        expect(order).toEqual(['undo', 'redo', 'chip']);
        expect(document.querySelector('.vela-widget-layoutname-text')?.textContent).toBe('Morning setup');
        // The name is the status a screen reader hears too.
        expect(document.querySelector('.vela-widget-layoutname')?.getAttribute('aria-label')).toBe('Morning setup. Open the layout menu');
    });

    it('paints the unsaved dot and the save button from live state', () => {
        const s = stub([{ name: 'A' }], 'A');
        const { bar } = mountBar(s);
        const dot = (): HTMLElement => document.querySelector<HTMLElement>('.vela-layout-dot')!;
        const save = (): HTMLElement => document.querySelector<HTMLElement>('.vela-widget-layoutsave')!;
        expect(dot().hidden).toBe(true);
        expect(save().dataset.dirty).toBeUndefined();
        s.dirty(true);
        bar.setLayoutState();
        expect(dot().hidden).toBe(false);
        expect(save().dataset.dirty).toBe('1');
        expect(document.querySelector('.vela-widget-layoutname')?.getAttribute('aria-label')).toBe('A, unsaved changes. Open the layout menu');
        // …and clearing it again (a save) puts the chip back to rest.
        s.dirty(false);
        bar.setLayoutState();
        expect(dot().hidden).toBe(true);
        bar.destroy();
    });

    it('an untitled document reads as Untitled, and its save button opens the panel', () => {
        const s = stub();
        const { bar } = mountBar(s);
        expect(document.querySelector('.vela-widget-layoutname-text')?.textContent).toBe('Untitled layout');
        expect(document.querySelector<HTMLElement>('.vela-widget-layoutname')!.dataset.untitled).toBe('1');
        (document.querySelector('.vela-widget-layoutsave') as HTMLButtonElement).click();
        expect(document.querySelector('.vela-lm')).not.toBeNull();
        expect(s.calls).not.toContain('save');
        bar.destroy();
    });

    it('saving in place from the chip calls the one verb the top bar owns', () => {
        const s = stub([{ name: 'A' }], 'A');
        const { bar } = mountBar(s);
        (document.querySelector('.vela-widget-layoutsave') as HTMLButtonElement).click();
        expect(s.calls).toContain('save');
        bar.destroy();
    });

    it('a composition without the entry renders no chip', () => {
        const s = stub([{ name: 'A' }], 'A');
        mountBar(s, { left: ['symbol', 'undo-redo'] });
        expect(document.querySelector('.vela-widget-layoutname')).toBeNull();
    });
});
