// @vitest-environment jsdom
// The chart-templates dropdown — TradingView's "Indicator templates", beside Indicators.
//
// These pin the contract the menu has with the workspace store: plain English verbs, one
// row per template, apply-replaces-and-closes, a star that moves the house default, a
// two-tap delete, and a save form whose "remember the market" is OFF by default (a
// template is meant to travel between symbols).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];

import { TemplatesMenu, type TemplatesMenuRow } from '../src/widget/templates-menu';
import { Topbar } from '../src/widget/topbar';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

interface Stub {
    menu: () => TemplatesMenuOptionsStub;
    rows: TemplatesMenuRow[];
    calls: string[];
    house: () => string | null;
    charts: (n: number) => void;
}
type TemplatesMenuOptionsStub = ConstructorParameters<typeof TemplatesMenu>[0];

function stub(initial: TemplatesMenuRow[] = [], house: string | null = null): Stub {
    const rows = [...initial];
    const calls: string[] = [];
    let current = house;
    let charts = 4;
    const opts: TemplatesMenuOptionsStub = {
        templates: () => [...rows],
        onApply: (name, target) => {
            calls.push(`apply:${name}:${target}`);
            return target === 'all' ? charts : 1;
        },
        onSave: (name, includeMarket) => {
            if (rows.some((r) => r.name === name)) return false;
            rows.push({ name, count: 2, ...(includeMarket ? { symbol: 'BTCUSDT', timeframe: '60' } : {}) });
            calls.push(`save:${name}:${includeMarket}`);
            return true;
        },
        onDelete: (name) => {
            const i = rows.findIndex((r) => r.name === name);
            if (i >= 0) rows.splice(i, 1);
            calls.push(`delete:${name}`);
        },
        onRename: (from, to) => {
            if (rows.some((r) => r.name === to)) return false;
            const r = rows.find((x) => x.name === from);
            if (!r) return false;
            r.name = to;
            calls.push(`rename:${from}->${to}`);
            return true;
        },
        onExport: (name) => {
            calls.push(`export:${name}`);
            return JSON.stringify({ app: 'vela', kind: 'template', name });
        },
        defaultTemplate: () => current,
        onSetDefault: (name) => {
            current = name;
            calls.push(`house:${name}`);
        },
        chartCount: () => charts,
    };
    return {
        menu: () => opts,
        rows,
        calls,
        house: () => current,
        charts: (n) => {
            charts = n;
        },
    };
}

const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('.vela-tm');
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.vela-tm-item')];
const row = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`.vela-tm-item[data-name="${name}"]`);
const chips = (): string[] => [...document.querySelectorAll('.vela-tm-chip')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const flash = (): string => document.querySelector('.vela-tm-flash')?.textContent ?? '';
const click = (el: Element | null | undefined): void => {
    expect(el).toBeTruthy();
    (el as HTMLElement).click();
};

describe('the templates menu', () => {
    let menus: TemplatesMenu[] = [];
    let trigger: HTMLButtonElement;

    beforeEach(() => {
        document.body.replaceChildren();
        menus = [];
        trigger = document.createElement('button');
        trigger.textContent = 'Templates';
        document.body.appendChild(trigger);
    });
    afterEach(() => {
        for (const m of menus) m.destroy();
        document.body.replaceChildren();
    });

    const open = (s: Stub): TemplatesMenu => {
        const menu = new TemplatesMenu(s.menu());
        menus.push(menu);
        menu.open(trigger);
        return menu;
    };

    it('lists the saved templates with their count and remembered market', () => {
        const s = stub([
            { name: 'Swing', count: 4, symbol: 'BTCUSDT', timeframe: '60' },
            { name: 'Scalp', count: 2 },
        ]);
        open(s);
        expect(panel()).not.toBeNull();
        expect(rows().map((r) => r.dataset.name)).toEqual(['Swing', 'Scalp']);
        expect(row('Swing')?.querySelector('.vela-tm-meta')?.textContent).toBe('4 indicators · BTCUSDT · 60');
        expect(row('Scalp')?.querySelector('.vela-tm-meta')?.textContent).toBe('2 indicators');
        // The header answers "what is this", not just "here is a list".
        expect(panel()?.querySelector('.vela-tm-title')?.textContent).toBe('Indicator templates');
        expect([...document.querySelectorAll('.vela-tm-tab')].map((t) => t.textContent)).toEqual(['Favorites', 'My templates', 'Technical', 'Financial']);
    });

    it('says what to do when nothing is saved yet', () => {
        open(stub());
        expect(rows()).toHaveLength(0);
        expect(panel()?.querySelector('.vela-tm-empty')?.textContent).toContain('No templates of your own yet');
    });

    it('applies a template to this chart and closes — TV closes on pick', () => {
        const s = stub([{ name: 'Swing', count: 3 }]);
        const menu = open(s);
        click(row('Swing')?.querySelector('.vela-tm-row'));
        expect(s.calls).toContain('apply:Swing:active');
        expect(menu.isOpen).toBe(false);
    });

    it('offers Apply to all charts only on a multi-chart layout', () => {
        const s = stub([{ name: 'Swing', count: 3 }]);
        open(s);
        click(row('Swing')?.querySelector('.vela-tm-kebab'));
        expect(chips()).toEqual(['Apply to all charts', 'Rename…', 'Export', 'Delete']);
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Apply to all')));
        expect(s.calls).toContain('apply:Swing:all');
        expect(flash()).toContain('applied to 4 charts');

        // One chart: the verb would be a lie, so it is not offered.
        s.charts(1);
        menus[menus.length - 1]?.refresh();
        click(row('Swing')?.querySelector('.vela-tm-kebab'));
        expect(chips()).toEqual(['Rename…', 'Export', 'Delete']);
    });

    it('saves under a name, with the market only when the box is ticked', () => {
        const s = stub();
        open(s);
        click(document.querySelector('.vela-tm-save'));
        const input = document.querySelector<HTMLInputElement>('.vela-tm-input');
        expect(input).not.toBeNull();
        const box = document.querySelector<HTMLInputElement>('.vela-tm-check input');
        expect(box?.checked).toBe(false);
        input!.value = 'Desk';
        click(document.querySelector('.vela-tm-primary'));
        expect(s.calls).toContain('save:Desk:false');
        expect(flash()).toContain('saved');
        expect(rows().map((r) => r.dataset.name)).toContain('Desk');

        click(document.querySelector('.vela-tm-save'));
        const input2 = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        input2.value = 'With market';
        const box2 = document.querySelector<HTMLInputElement>('.vela-tm-check input')!;
        box2.checked = true;
        input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(s.calls).toContain('save:With market:true');
    });

    it('refuses an unnamed save without touching the store', () => {
        const s = stub();
        open(s);
        click(document.querySelector('.vela-tm-save'));
        const input = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        input.value = '   ';
        click(document.querySelector('.vela-tm-primary'));
        expect(s.calls.filter((c) => c.startsWith('save:'))).toHaveLength(0);
    });

    it('renames in place, and says why a taken name was refused', () => {
        const s = stub([{ name: 'A', count: 1 }, { name: 'B', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Rename')));
        const input = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        expect(input.value).toBe('A');
        input.value = 'B';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(flash()).toContain('already exists');
        expect(s.rows.map((r) => r.name)).toEqual(['A', 'B']);

        const again = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        again.value = 'C';
        again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(s.calls).toContain('rename:A->C');
        expect(rows().map((r) => r.dataset.name)).toEqual(['C', 'B']);
    });

    it('does not carry a refused rename draft to a different template', () => {
        const s = stub([{ name: 'A', count: 1 }, { name: 'Existing', count: 1 }, { name: 'Third', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Rename')));
        const first = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        first.value = 'Existing';
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(flash()).toContain('already exists');
        click(row('Third')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Rename')));
        expect(document.querySelector<HTMLInputElement>('.vela-tm-input')?.value).toBe('Third');
    });

    it('deletes on the second tap, never the first', () => {
        const s = stub([{ name: 'A', count: 1 }, { name: 'B', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Delete')));
        expect(s.calls).not.toContain('delete:A');
        expect(chips().some((c) => c.startsWith('Tap again'))).toBe(true);
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Tap again')));
        expect(s.calls).toContain('delete:A');
        expect(rows().map((r) => r.dataset.name)).toEqual(['B']);
    });

    it('the row star is "set as default", and the header says so', () => {
        const s = stub([{ name: 'A', count: 1 }, { name: 'B', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-star'));
        expect(s.house()).toBe('A');
        expect(panel()?.querySelector('.vela-tm-sub')?.textContent).toContain('New charts start with “A”');
        expect(row('A')?.querySelector('.vela-tm-badge')?.textContent).toBe('default');
        // Pressing the filled star again clears the house template.
        click(row('A')?.querySelector('.vela-tm-star'));
        expect(s.house()).toBeNull();
        expect(row('A')?.querySelector('.vela-tm-badge')).toBeNull();
    });

    it('exports through the store and reports the file', () => {
        const s = stub([{ name: 'A', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Export')));
        expect(s.calls).toContain('export:A');
        expect(flash()).toContain('exported');
    });

    it('Escape closes and hands focus back to the button', async () => {
        const menu = open(stub([{ name: 'A', count: 1 }]));
        trigger.focus();
        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await vi.waitFor(() => expect(menu.isOpen).toBe(false));
        expect(document.activeElement).toBe(trigger);
    });

    it('a refused rename keeps its field open with the typed name', () => {
        const s = stub([{ name: 'A', count: 1 }, { name: 'B', count: 1 }]);
        open(s);
        click(row('A')?.querySelector('.vela-tm-kebab'));
        click([...document.querySelectorAll('.vela-tm-chip')].find((c) => c.textContent?.startsWith('Rename')));
        const input = document.querySelector<HTMLInputElement>('.vela-tm-input')!;
        input.value = 'B';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const again = document.querySelector<HTMLInputElement>('.vela-tm-input');
        expect(again).not.toBeNull();
        expect(again?.value).toBe('B');
        expect(document.activeElement).toBe(again);
    });
});

describe('the templates button in the top bar', () => {
    beforeEach(() => document.body.replaceChildren());
    afterEach(() => document.body.replaceChildren());

    const mountBar = (templates?: TemplateTopbarOptions) => {
        const host = document.createElement('div');
        host.className = 'vela-ui';
        document.body.appendChild(host);
        const bar = new Topbar(host, {
            symbol: 'BTCUSDT',
            timeframe: '60',
            timeframes: ['1', '5', '60', '240', 'D'],
            priceStyle: 'candles',
            onTimeframe: () => {},
            onPriceStyle: () => {},
            onIndicatorsClick: () => {},
            ...(templates ? { templates } : {}),
        } as never);
        return { bar, host };
    };
    type TemplateTopbarOptions = NonNullable<ConstructorParameters<typeof Topbar>[1]['templates']>;

    it('sits immediately after Indicators', () => {
        mountBar({ templates: () => [] });
        const order = [...document.querySelectorAll('.vela-widget-topbar .vela-widget-indicators, .vela-widget-topbar .vela-widget-templates')].map((el) =>
            el.classList.contains('vela-widget-templates') ? 'templates' : 'indicators',
        );
        expect(order).toEqual(['indicators', 'templates']);
        expect(document.querySelector('.vela-widget-templates')?.getAttribute('aria-label')).toBe('Indicator templates');
    });

    it('opens the menu and mirrors aria-expanded', async () => {
        mountBar({ templates: () => [] });
        const btn = document.querySelector<HTMLButtonElement>('.vela-widget-templates')!;
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        btn.click();
        expect(panel()).not.toBeNull();
        expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('a host without templates renders no button (and no dead entry point)', () => {
        mountBar();
        expect(document.querySelector('.vela-widget-templates')).toBeNull();
    });

    it('a composition without the entry hides the button even when templates exist', () => {
        mountBar({ templates: () => [] });
        const bar = new Topbar(document.body.appendChild(document.createElement('div')), {
            symbol: 'BTCUSDT',
            timeframe: '60',
            timeframes: ['60'],
            priceStyle: 'candles',
            onTimeframe: () => {},
            onPriceStyle: () => {},
            onIndicatorsClick: () => {},
            composition: { left: ['symbol', 'indicators'], right: [] },
            templates: { templates: () => [] },
        } as never);
        expect(document.querySelectorAll('.vela-widget-templates')).toHaveLength(1); // the first bar's
        bar.destroy();
    });
});
