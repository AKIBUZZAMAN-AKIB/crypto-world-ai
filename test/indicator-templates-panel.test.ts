// @vitest-environment jsdom
// R86 T11 — indicator templates live in their OWN panel with four categories, not in
// Manage layouts. The same surface opens as a topbar dropdown or a phone dialog.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v.replace(/([^\w-])/g, '\\$1') };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];

import { TemplatesMenu } from '../src/widget/templates-menu';
import { INDICATOR_TEMPLATE_TABS, favoriteKeyForBuiltin, favoriteKeyForTemplate } from '../src/widget/indicator-templates';

let menu: TemplatesMenu | null = null;

const opts = () => {
    let favorites: string[] = [];
    const builtins = [
        { id: 'oscillators', name: 'Oscillators', description: 'RSI, Stochastic', count: 3, category: 'Technical' as const },
        { id: 'volume-based', name: 'Volume Based', description: 'Volume, OBV, VWAP', count: 3, category: 'Financial' as const },
    ];
    return {
        templates: () => [{ name: 'Scalp', count: 2 }],
        builtins: () => builtins,
        favorites: () => [...favorites],
        onToggleFavorite: (key: string, on: boolean) => {
            favorites = favorites.filter((x) => x !== key);
            if (on) favorites.push(key);
        },
        onApply: () => 1,
        onApplyBuiltin: () => undefined,
        onSave: () => true,
    };
};

const panel = (): HTMLElement | null => document.querySelector('.vela-tm');
const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.vela-tm-tab')];
const tab = (id: string): HTMLElement => document.querySelector(`.vela-tm-tab[data-tab="${id}"]`)!;
const names = (): string[] => [...document.querySelectorAll<HTMLElement>('.vela-tm-name')].map((x) => x.textContent ?? '');

beforeEach(() => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.className = 'vela-ui';
    const trigger = document.createElement('button');
    host.append(trigger);
    document.body.append(host);
    menu = new TemplatesMenu(opts());
    menu.open(trigger);
});
afterEach(() => {
    menu?.destroy();
    menu = null;
    document.body.replaceChildren();
});

describe('indicator templates panel', () => {
    it('is titled Indicator templates and exposes the four required tabs', () => {
        expect(panel()?.querySelector('.vela-tm-title')?.textContent).toBe('Indicator templates');
        expect(tabs().map((t) => t.textContent)).toEqual(INDICATOR_TEMPLATE_TABS.map((t) => t.label));
        expect(tab('my').getAttribute('aria-selected')).toBe('true');
    });

    it('My templates shows saved stacks, Technical/Financial filter built-ins', () => {
        expect(names()).toEqual(['Scalp']);
        tab('technical').click();
        expect(names()).toEqual(['Oscillators']);
        tab('financial').click();
        expect(names()).toEqual(['Volume Based']);
        tab('my').click();
        expect(names()).toEqual(['Scalp']);
    });

    it('pins saved and built-in templates onto Favorites', () => {
        document.querySelector<HTMLElement>('.vela-tm-item[data-name="Scalp"] .vela-tm-fav')!.click();
        tab('technical').click();
        document.querySelector<HTMLElement>('.vela-tm-builtin .vela-tm-fav')!.click();
        tab('favorites').click();
        expect(names().sort()).toEqual(['Oscillators', 'Scalp'].sort());
        expect(favoriteKeyForTemplate('Scalp')).toBe('template:Scalp');
        expect(favoriteKeyForBuiltin('oscillators')).toBe('builtin:oscillators');
    });

    it('opens the same surface as a compact dialog from a phone door', () => {
        menu?.close();
        const host = document.querySelector<HTMLElement>('.vela-ui')!;
        const dialogMenu = new TemplatesMenu(opts());
        dialogMenu.openDialog(host);
        expect(document.querySelector('.vela-tm-dialog')).not.toBeNull();
        expect(panel()?.querySelector('.vela-tm-title')?.textContent).toBe('Indicator templates');
        expect(tabs().map((t) => t.textContent)).toEqual(['Favorites', 'My templates', 'Technical', 'Financial']);
        dialogMenu.destroy();
    });
});
