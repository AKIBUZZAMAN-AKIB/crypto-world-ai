// @vitest-environment jsdom
// The shared workspace panes retain the standalone pickers' actions and dock lifecycle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndicatorPicker } from '../src/widget/indicator-picker';
import { SymbolPicker } from '../src/widget/symbol-picker';
import { TemplatesMenu } from '../src/widget/templates-menu';
import { CompareSheet } from '../src/widget/compare-sheet';
import { WorkspaceToolPanel } from '../src/widget/workspace-tool-panel';
import { PanelDock } from '../src/widget/panel-dock';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v.replace(/([^\w-])/g, '\\$1') };
Element.prototype.scrollIntoView ??= vi.fn();

let host: HTMLElement;
const disposers: Array<() => void> = [];
beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    host.dataset.layout = 'desktop';
    document.body.append(host);
});
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    document.body.replaceChildren();
});

describe('workspace discovery panels', () => {
    it('keeps indicator actions, a keyboard tablist and the dock lifecycle separate', () => {
        const added: number[] = [], opens: boolean[] = [];
        let favorite = false;
        const picker = new IndicatorPicker({
            host, library: () => [{ name: 'Average', category: 'Trend' }], onChart: () => [],
            onAdd: index => added.push(index), onRemove: () => {}, favorites: () => favorite ? ['Average'] : [],
            onFavorite: (_key, on) => { favorite = on; }, onOpenChange: on => opens.push(on),
        });
        const pane = new WorkspaceToolPanel(host, 'Indicators', 'vela-indicator-panel');
        picker.attachPanel(pane);
        const dock = new PanelDock(host, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => null as never });
        dock.addBuiltIn({ id: 'indicators', title: 'Indicators', icon: 'indicators', order: 1, panel: pane, showInChrome: false });
        disposers.push(() => { dock.destroy(); picker.destroy(); });
        picker.open();
        expect(pane.open).toBe(true);
        expect(dock.openId).toBe('indicators');
        expect(opens).toEqual([true]);
        const tab = pane.el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
        const view = pane.el.querySelector<HTMLElement>('[role="tabpanel"]')!;
        expect(tab.getAttribute('aria-controls')).toBe(view.id);
        expect(view.getAttribute('aria-labelledby')).toBe(tab.id);
        pane.el.querySelector<HTMLButtonElement>('.vela-ip-star')!.click();
        expect(favorite).toBe(true);
        expect(added).toEqual([]);
        pane.el.querySelector<HTMLButtonElement>('.vela-ip-pick')!.click();
        expect(added).toEqual([0]);
        pane.toggle(false);
        expect(opens).toEqual([true, false]);
        expect(dock.openId).toBeNull();
    });

    it('does not skip or mis-highlight the first search result when a watchlist exists', () => {
        const picks: string[] = [];
        const picker = new SymbolPicker({ host, onSelect: symbol => picks.push(symbol), watchlist: () => ['venue:CCC'] });
        picker.setSource(() => [
            { ticker: 'AAA', provider: 'venue' }, { ticker: 'BBB', provider: 'venue' }, { ticker: 'CCC', provider: 'venue' },
        ]);
        const pane = new WorkspaceToolPanel(host, 'Symbol Search', 'vela-symbol-panel');
        picker.attachPanel(pane);
        disposers.push(() => picker.destroy());
        picker.open();
        const list = pane.el.querySelector<HTMLElement>('.vela-sp-list')!;
        expect(list.querySelector('.vela-sp-watch')).not.toBeNull();
        expect(list.querySelector<HTMLElement>('.vela-sp-row[data-i="0"]')?.dataset.ticker).toBe('AAA');
        expect(list.querySelector<HTMLElement>('.vela-sp-row[data-highlighted]')?.dataset.i).toBe('0');
        const input = pane.el.querySelector<HTMLInputElement>('.vela-sp-input')!;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(list.querySelector<HTMLElement>('.vela-sp-row[data-highlighted]')?.dataset.i).toBe('1');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(picks).toEqual(['venue:BBB']);
        expect(pane.open).toBe(false);
    });

    it('updates an open search when the symbol index arrives and explains empty filters', () => {
        const symbols: Array<{ ticker: string; type: string }> = [];
        const picker = new SymbolPicker({ host, onSelect: () => {} });
        picker.setSource(() => symbols);
        const pane = new WorkspaceToolPanel(host, 'Symbol Search', 'vela-symbol-panel');
        picker.attachPanel(pane);
        disposers.push(() => picker.destroy());
        picker.open();
        expect(pane.el.querySelector('.vela-sp-empty')?.textContent).toContain('provider still loading');
        symbols.push({ ticker: 'LATE', type: 'crypto' });
        picker.sync();
        expect(pane.el.querySelector('.vela-sp-row[data-i="0"]')?.getAttribute('data-ticker')).toBe('LATE');
        const stocks = [...pane.el.querySelectorAll<HTMLButtonElement>('.vela-sp-tab')].find(el => el.textContent === 'Stocks')!;
        stocks.click();
        expect(stocks.getAttribute('aria-pressed')).toBe('true');
        expect(pane.el.querySelector('.vela-sp-empty')?.textContent).toContain('Try All');
    });

    it('preserves a typed seed in the standalone phone drawer', async () => {
        const picker = new SymbolPicker({ host, sheet: () => true, onSelect: () => {} });
        picker.setSource(() => [{ ticker: 'BTCUSD' }, { ticker: 'ETHUSD' }]);
        disposers.push(() => picker.destroy());
        picker.open('bt');
        picker.type('c'); // a fast second key must not be erased by the drawer opening later
        await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('.vela-sp-input')?.value).toBe('BTC'));
        expect(host.querySelector('.vela-sp-row[data-i="0"]')?.getAttribute('data-ticker')).toBe('BTCUSD');
    });

    it('guards bulk watchlist actions in compare contexts without hiding the watchlist', () => {
        let bulkAllowed = true;
        const picker = new SymbolPicker({ host, onSelect: () => {}, watchlist: () => ['venue:AAA'],
            onApplyAll: () => {}, canApplyAll: () => bulkAllowed });
        picker.setSource(() => [{ ticker: 'AAA', provider: 'venue' }]);
        const pane = new WorkspaceToolPanel(host, 'Symbol Search', 'vela-symbol-panel');
        picker.attachPanel(pane);
        disposers.push(() => picker.destroy());
        picker.open();
        expect(pane.el.querySelector('.vela-sp-watchall')).not.toBeNull();
        bulkAllowed = false;
        picker.sync();
        expect(pane.el.querySelector('.vela-sp-watch')).not.toBeNull();
        expect(pane.el.querySelector('.vela-sp-watchall')).toBeNull();
    });

    it('keeps a distinct workspace Templates door rather than a merged tab', () => {
        const picker = new IndicatorPicker({ host, library: () => [], onChart: () => [], onAdd: () => {}, onRemove: () => {},
            templates: { rows: () => [], onApply: () => 0 } });
        const indicators = new WorkspaceToolPanel(host, 'Indicators', 'vela-indicator-panel');
        const templates = new WorkspaceToolPanel(host, 'Indicator templates', 'vela-templates-panel');
        picker.attachPanel(indicators);
        picker.useSeparateTemplates(templates);
        disposers.push(() => { picker.destroy(); templates.destroy(); });
        picker.open();
        expect(indicators.el.querySelector('[role="tab"][data-templates]')).toBeNull();
        const door = indicators.el.querySelector<HTMLButtonElement>('.vela-ip-templates-door')!;
        expect(door.getAttribute('aria-controls')).toBe(templates.el.id);
        door.click();
        expect(templates.open).toBe(true);
        expect(indicators.open).toBe(true);
    });

    it('keeps template actions in the pane and associates tabs with their view', () => {
        let renamed = '';
        const menu = new TemplatesMenu({
            templates: () => [{ name: 'Desk', count: 2 }], onRename: (_from, to) => { renamed = to; return true; },
        });
        const pane = new WorkspaceToolPanel(host, 'Indicator templates', 'vela-templates-panel');
        menu.attachPanel(pane);
        disposers.push(() => menu.destroy());
        pane.showFrom();
        const tab = pane.el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
        const view = pane.el.querySelector<HTMLElement>('[role="tabpanel"]')!;
        expect(tab.getAttribute('aria-controls')).toBe(view.id);
        expect(view.getAttribute('aria-labelledby')).toBe(tab.id);
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-kebab')!.click();
        expect(pane.open).toBe(true);
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-chip')!.click();
        const input = pane.el.querySelector<HTMLInputElement>('.vela-tm-input')!;
        expect(input.closest('button')).toBeNull();
        input.value = 'Renamed';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(renamed).toBe('Renamed');
        expect(pane.open).toBe(true);
    });

    it('keeps keyboard focus and cancels nested template actions without closing the pane', () => {
        let favorite = false;
        const rename = vi.fn(() => true), save = vi.fn(() => true);
        const menu = new TemplatesMenu({
            templates: () => [{ name: 'Desk', count: 2 }], onRename: rename, onSave: save,
            favorites: () => favorite ? ['template:Desk'] : [], onToggleFavorite: (_key, on) => { favorite = on; },
        });
        const pane = new WorkspaceToolPanel(host, 'Indicator templates', 'vela-templates-panel');
        menu.attachPanel(pane);
        disposers.push(() => menu.destroy());
        pane.showFrom();
        const pin = pane.el.querySelector<HTMLButtonElement>('.vela-tm-fav')!;
        pin.focus(); pin.click();
        const nextPin = pane.el.querySelector<HTMLButtonElement>('.vela-tm-fav')!;
        expect(nextPin.getAttribute('aria-pressed')).toBe('true');
        expect(document.activeElement).toBe(nextPin);
        const kebab = pane.el.querySelector<HTMLButtonElement>('.vela-tm-kebab')!;
        kebab.focus(); kebab.click();
        expect(document.activeElement).toBe(pane.el.querySelector('.vela-tm-kebab'));
        const renameAction = pane.el.querySelector<HTMLButtonElement>('.vela-tm-chip')!;
        renameAction.click();
        const name = pane.el.querySelector<HTMLInputElement>('.vela-tm-input')!;
        name.value = 'Not committed';
        name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(rename).not.toHaveBeenCalled();
        expect(pane.open).toBe(true);
        expect(pane.el.querySelector('.vela-tm-input')).toBeNull();
        expect(document.activeElement).toBe(pane.el.querySelector('.vela-tm-kebab'));
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-kebab')!.click();
        const tab = pane.el.querySelector<HTMLButtonElement>('.vela-tm-tab[data-tab="my"]')!;
        tab.focus();
        tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-tab[data-tab="technical"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(pane.el.querySelector('.vela-tm-chip')).toBeNull();
        expect(document.activeElement).toBe(pane.el.querySelector('.vela-tm-tab[data-tab="my"]'));
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-save')!.click();
        const input = pane.el.querySelector<HTMLInputElement>('.vela-tm-input')!;
        input.value = 'Discarded';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(save).not.toHaveBeenCalled();
        expect(pane.open).toBe(true);
        expect(pane.el.querySelector('.vela-tm-input')).toBeNull();
        expect(document.activeElement).toBe(pane.el.querySelector('.vela-tm-save'));
    });

    it('keeps an unfinished save name and market choice through pane refreshes', () => {
        let favorite = false;
        const save = vi.fn(() => true);
        const menu = new TemplatesMenu({
            templates: () => [{ name: 'Desk', count: 2 }], onSave: save,
            favorites: () => favorite ? ['template:Desk'] : [], onToggleFavorite: (_key, on) => { favorite = on; },
        });
        const pane = new WorkspaceToolPanel(host, 'Indicator templates', 'vela-templates-panel');
        menu.attachPanel(pane);
        disposers.push(() => menu.destroy());
        pane.showFrom();
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-save')!.click();
        pane.el.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')!.value = 'Draft setup';
        pane.el.querySelector<HTMLInputElement>('.vela-tm-check input')!.checked = true;
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-fav')!.click();
        expect(pane.el.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')!.value).toBe('Draft setup');
        expect(pane.el.querySelector<HTMLInputElement>('.vela-tm-check input')!.checked).toBe(true);
        const field = pane.el.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')!;
        field.focus(); field.setSelectionRange(2, 5);
        menu.refresh();
        const restored = pane.el.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')!;
        expect(document.activeElement).toBe(restored);
        expect([restored.selectionStart, restored.selectionEnd]).toEqual([2, 5]);
        expect(restored.value).toBe('Draft setup');
        expect(pane.el.querySelector<HTMLInputElement>('.vela-tm-check input')!.checked).toBe(true);
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-primary')!.click();
        expect(save).toHaveBeenCalledWith('Draft setup', true);
        pane.el.querySelector<HTMLButtonElement>('.vela-tm-save')!.click();
        expect(pane.el.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')!.value).toBe('');
        expect(pane.el.querySelector<HTMLInputElement>('.vela-tm-check input')!.checked).toBe(false);
    });

    it('shows compare controls in the pane, updates modes, and keeps the fallback separate', () => {
        let mode: 'same-percent' | 'own-scale' | 'new-pane' = 'same-percent';
        const sheet = new CompareSheet({ host, getSymbol: () => 'VENUE:AAA', getDisplay: () => mode,
            onPickSymbol: () => {}, onDisplay: next => { mode = next; }, onRemove: () => {} });
        const pane = new WorkspaceToolPanel(host, 'Compare', 'vela-compare-panel');
        sheet.attachPanel(pane);
        disposers.push(() => sheet.destroy());
        sheet.open();
        pane.el.querySelector<HTMLButtonElement>('[data-display="own-scale"]')!.click();
        expect(mode).toBe('own-scale');
        expect(pane.el.querySelector('[data-display="own-scale"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelector('.vela-drawer[data-state="open"]')).toBeNull();
        sheet.close();
        expect(sheet.isOpen).toBe(false);
    });
});
