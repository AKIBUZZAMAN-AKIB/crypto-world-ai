// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MoreDrawer } from '../src/widget/more-drawer';
import type { CursorStyle } from '../src/core/cursor';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

function mount(extra: { onDrawings?: () => void; onEditor?: () => void } = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let cursor: CursorStyle = 'cross';
    const onTimeZone = vi.fn();
    const onChartMenu = vi.fn();
    const drawer = new MoreDrawer({
        host,
        cursorStyle: () => cursor,
        onCursorStyle: (value) => { cursor = value; },
        canUndo: () => true,
        canRedo: () => false,
        priceStyles: () => [{ id: 'candles', label: 'Candles' }, { id: 'bars', label: 'Bars' }],
        priceStyle: () => 'candles',
        onPriceStyle: () => {},
        panels: () => [{ id: 'objects', title: 'Object tree', icon: 'objects' }, { id: 'data', title: 'Data window', icon: 'datawindow' }],
        onTogglePanel: () => {},
        onResetView: () => {},
        onTimeZone,
        onChartMenu,
        ...extra,
        timezone: () => 'Etc/UTC',
        actions: () => [{ label: 'Keyboard shortcuts', icon: 'kbd', run: () => {} }],
    });
    drawer.open();
    const row = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.vela-md-row')]
        .find((element) => element.querySelector('.vela-md-row-label')?.textContent === label)!;
    return { host, drawer, row, cursor: () => cursor, onTimeZone, onChartMenu };
}

beforeEach(() => document.body.replaceChildren());

describe('More without search', () => {
    it('keeps the full action list and no search control in a legacy Drawer host', () => {
        const { host, drawer, row } = mount();
        expect(host.querySelector('.vela-md-search, input[aria-label="Search settings"]')).toBeNull();
        expect(host.querySelectorAll('.vela-md-row').length).toBeGreaterThan(5);
        for (const label of ['Chart type', 'Cursor', 'Object tree', 'Data window', 'Time zone', 'Chart actions…']) {
            expect(row(label), label).toBeDefined();
        }
        drawer.close(); drawer.open();
        expect(host.querySelector('.vela-md-search')).toBeNull();
        expect(row('Object tree')).toBeDefined();
        expect(row('Drawings')).toBeUndefined();
        drawer.destroy();
    });

    it('opens the Drawings picker from More and keeps the editor door when available', () => {
        const openDrawings = vi.fn();
        const openEditor = vi.fn();
        const { drawer, row } = mount({ onDrawings: openDrawings, onEditor: openEditor });
        expect(row('Drawings')).toBeDefined();
        expect(row('Pine Editor')).toBeDefined();
        row('Drawings').click();
        expect(openDrawings).toHaveBeenCalledOnce();
        drawer.open();
        row('Pine Editor').click();
        expect(openEditor).toHaveBeenCalledOnce();
        drawer.destroy();
    });

    it('passes the actual timezone and chart-action rows to their anchored surfaces without replacing More', async () => {
        const { drawer, row, onTimeZone, onChartMenu } = mount();
        await vi.waitFor(() => expect(row('Cursor').closest('.vela-drawer')?.getAttribute('data-state')).toBe('open'));
        const zone = row('Time zone'); zone.click();
        expect(onTimeZone).toHaveBeenCalledWith(zone);
        const actions = row('Chart actions…'); actions.click();
        expect(onChartMenu).toHaveBeenCalledWith(actions);
        expect(row('Cursor')).toBeDefined();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(row('Cursor').closest('.vela-drawer')?.getAttribute('data-state')).toBe('open');
        drawer.destroy();
    });

    it('keeps legacy non-menu subviews and their back navigation', () => {
        const { host, drawer, row } = mount();
        row('Chart type').click();
        expect(host.querySelector('.vela-md-back')?.textContent).toContain('Chart type');
        expect([...host.querySelectorAll('.vela-md-row')].some((el) => el.textContent?.includes('Bars'))).toBe(true);
        host.querySelector<HTMLButtonElement>('.vela-md-back')!.click();
        expect(row('Cursor')).toBeDefined();
        drawer.destroy();
    });
});

describe('More compact cursor menu', () => {
    it('keeps the parent mounted and navigates choices by keyboard before committing', () => {
        const { host, drawer, row, cursor } = mount();
        const trigger = row('Cursor');
        trigger.click();
        const menu = host.querySelector<HTMLElement>('.vela-cursor-menu')!;
        const choices = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        expect(choices.map((choice) => choice.dataset.value)).toEqual(['cross', 'dot', 'arrow', 'demo', 'magic', 'eraser', 'none']);
        expect(choices.filter((choice) => choice.getAttribute('aria-checked') === 'true')).toHaveLength(1);
        expect(row('Cursor')).toBe(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        choices[0]!.focus();
        choices[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(choices[1]);
        expect(cursor()).toBe('cross');
        // Native button Enter activation is exercised in the browser; click uses the same action here.
        choices[1]!.click();
        expect(cursor()).toBe('dot');
        expect(trigger.textContent).toContain('Dot');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(host.querySelector('.vela-cursor-menu')).toBeNull();
        expect(row('Cursor')).toBe(trigger);
        drawer.destroy();
    });

    it('Escape dismisses only the child; closing or destroying More also cleans it up', () => {
        const { host, drawer, row } = mount();
        const trigger = row('Cursor');
        trigger.click();
        host.querySelector<HTMLButtonElement>('.vela-choice-row')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(host.querySelector('.vela-cursor-menu')).toBeNull();
        expect(row('Cursor')).toBe(trigger);
        trigger.click(); drawer.close();
        expect(host.querySelector('.vela-cursor-menu')).toBeNull();
        drawer.open(); row('Cursor').click(); drawer.destroy();
        expect(host.querySelector('.vela-cursor-menu')).toBeNull();
    });
});
