// @vitest-environment jsdom
// Indicator templates are their OWN tab (TradingView's labelled Templates button has no
// room in a phone topbar). This pins the door's placement, the verbs and the read-only
// built-ins — the same vocabulary the desktop dropdown offers.
import { describe, it, expect, beforeEach } from 'vitest';
import { IndicatorPicker, type IndicatorPickerOptions, type IndicatorTemplateRow } from '../src/widget/indicator-picker';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v.replace(/([^\w-])/g, '\\$1') };

const LIBRARY = [
    { name: 'Simple Moving Average', category: 'Moving averages', native: true, nativeType: 'sma' },
    { name: 'Relative Strength Index', category: 'Oscillators', native: true, nativeType: 'rsi' },
];

interface Harness {
    picker: IndicatorPicker;
    rows: IndicatorTemplateRow[];
    saved: Array<[string, boolean]>;
    applied: Array<[string, 'active' | 'all']>;
    defaults: Array<string | null>;
    builtin: string[];
    deleted: string[];
    renamed: Array<[string, string]>;
}

async function mount(opts: Partial<Harness> = {}): Promise<Harness> {
    const host = document.createElement('div');
    document.body.append(host);
    const h: Harness = {
        picker: null as unknown as IndicatorPicker,
        rows: [{ name: 'Scalp 1h', count: 3, symbol: 'BTCUSDT', timeframe: '60' }],
        saved: [],
        applied: [],
        defaults: [],
        builtin: [],
        deleted: [],
        renamed: [],
        ...opts,
    };
    const templates: NonNullable<IndicatorPickerOptions['templates']> = {
        rows: () => h.rows,
        onApply: (name, target) => {
            h.applied.push([name, target]);
            return target === 'all' ? 4 : 1;
        },
        onSave: (name, includeMarket) => {
            h.saved.push([name, includeMarket]);
            h.rows.push({ name, count: 2 });
            return true;
        },
        onRename: (from, to) => {
            h.renamed.push([from, to]);
            h.rows = h.rows.map((r) => (r.name === from ? { ...r, name: to } : r));
            return true;
        },
        onDelete: (name) => {
            h.deleted.push(name);
            h.rows = h.rows.filter((r) => r.name !== name);
        },
        onExport: () => '{"app":"vela"}',
        onImport: () => 'Imported',
        defaultName: () => null,
        onSetDefault: (name) => h.defaults.push(name),
        chartCount: () => 4,
        builtins: () => [{ id: 'oscillators', name: 'Oscillators', description: 'RSI, Stochastic', count: 3 }],
        onApplyBuiltin: (id) => h.builtin.push(id),
    };
    h.picker = new IndicatorPicker({
        host,
        library: () => LIBRARY,
        onChart: () => [{ name: 'Volume', native: true, nativeType: 'volume' }],
        onAdd: () => {},
        onRemove: () => {},
        favorites: () => [],
        recent: () => [],
        templates,
    });
    h.picker.open();
    await new Promise((r) => setTimeout(r, 0));
    return h;
}

const tabs = () => [...document.querySelectorAll<HTMLElement>('.vela-ip-tab')];
const labels = () => tabs().map((t) => t.textContent || t.getAttribute('aria-label') || '');
const openTemplates = () => tabs().find((t) => t.textContent === 'Templates')!.click();
const verbs = () => [...document.querySelectorAll<HTMLElement>('.vela-ip-verb')].map((b) => b.textContent?.trim() ?? '');

beforeEach(() => document.body.replaceChildren());

describe('indicator picker — Templates tab', () => {
    it('sits BEFORE the family tabs, so a 390 px phone can see it without scrolling', async () => {
        await mount();
        expect(labels().slice(0, 4)).toEqual(['Favourites', 'Recent', 'Templates', 'All']);
        expect(tabs()[2]!.title).toBe('Indicator templates');
    });

    it('hides the study search and lists saved stacks, built-ins, save and import', async () => {
        await mount();
        openTemplates();
        expect(document.querySelector<HTMLElement>('.vela-ip-searchrow')!.hidden).toBe(true);
        expect(document.querySelector('.vela-ip-tpl[data-template]')?.getAttribute('data-template')).toBe('Scalp 1h');
        expect(document.querySelector('.vela-ip-tpl[data-builtin]')?.getAttribute('data-builtin')).toBe('oscillators');
        expect(verbs()).toContain('Save current (1) as template');
        expect(verbs()).toContain('Import');
    });

    it('saves the current stack and shows the new row', async () => {
        const h = await mount();
        openTemplates();
        const save = [...document.querySelectorAll<HTMLElement>('.vela-ip-tplfoot .vela-ip-verb')][0]!;
        save.click();
        const input = document.querySelector<HTMLInputElement>('.vela-ip-saveform input')!;
        input.value = 'Swing daily';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector<HTMLElement>('.vela-ip-saveform .vela-ip-verb')!.click();
        expect(h.saved).toEqual([['Swing daily', false]]);
        expect([...document.querySelectorAll('.vela-ip-tpl[data-template]')].map((r) => r.getAttribute('data-template'))).toEqual(['Scalp 1h', 'Swing daily']);
    });

    it('offers apply to this chart / all charts, rename, export and delete', async () => {
        const h = await mount();
        openTemplates();
        document.querySelector<HTMLElement>('.vela-ip-tplmore')!.click();
        const strip = verbs();
        expect(strip).toEqual(expect.arrayContaining(['Apply to this chart', 'Apply to all charts', 'Rename', 'Export', 'Delete']));
        // Two-tap delete: the first tap arms, the second removes.
        const del = [...document.querySelectorAll<HTMLElement>('.vela-ip-tplacts .vela-ip-verb')].find((b) => b.textContent?.includes('Delete'))!;
        del.click();
        expect(h.deleted).toEqual([]);
        const armed = [...document.querySelectorAll<HTMLElement>('.vela-ip-tplacts .vela-ip-verb')].find((b) => b.dataset.armed === '1')!;
        armed.click();
        expect(h.deleted).toEqual(['Scalp 1h']);
    });

    it('sets the default and applies a built-in through the host', async () => {
        const h = await mount();
        openTemplates();
        document.querySelector<HTMLElement>('.vela-ip-tpl[data-template] .vela-ip-star')!.click();
        expect(h.defaults).toEqual(['Scalp 1h']);
        document.querySelector<HTMLElement>('.vela-ip-tpl[data-builtin]')!.click();
        expect(h.builtin).toEqual(['oscillators']);
    });
});
