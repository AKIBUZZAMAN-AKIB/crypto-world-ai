// @vitest-environment jsdom
// Rendered Alerts pane contracts: safe target binding, accessible tabs and real callbacks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertPanel } from '../src/widget/alert-panel';
import type { AlertRequest, AlertTarget } from '../src/widget/alert-create';
import type { AlertEntry, ArmedAlertRow } from '../src/widget/alert-list';

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];

const live: AlertPanel[] = [];
afterEach(() => { for (const panel of live.splice(0)) panel.destroy(); document.body.replaceChildren(); });
function setup() {
    const host = document.createElement('div');
    host.dataset.layout = 'desktop';
    document.body.appendChild(host);
    let target: AlertTarget | null = { cellId: 'a', symbol: 'AAA', timeframe: '60', chartLabel: 'Chart 1', price: 100.12345678901234 };
    let level: number | null = 112.5;
    let entries: AlertEntry[] = [];
    let armed: ArmedAlertRow[] = [];
    let charts = [{ id: 'a', label: '1', symbol: 'AAA' }, { id: 'b', label: '2', symbol: 'BBB' }];
    const create = vi.fn((_request: AlertRequest, _target: AlertTarget) => true);
    const beginEdit = vi.fn((_id: string) => target ? ({ target: { ...target }, request: { condition: 'cross-up' as const, value: 125, frequency: 'once' as const, bars: 5 } }) : null);
    const saveEdit = vi.fn((_id: string, _request: AlertRequest, _target: AlertTarget) => true);
    const toggleAlert = vi.fn((id: string) => {
        armed = armed.map((row) => row.id === id ? { ...row, state: row.state === 'active' ? 'paused' : 'active' } : row);
        return true;
    });
    const go = vi.fn();
    const panel = new AlertPanel(host, {
        target: () => target,
        drawingLevel: () => level,
        onCreate: create,
        getAlerts: () => entries,
        getCharts: () => charts,
        getArmed: () => armed,
        onBeginEdit: beginEdit,
        onSaveEdit: saveEdit,
        onToggleAlert: toggleAlert,
        onGo: go,
        onClearChart: (id) => { entries = entries.filter((entry) => entry.cellId !== id); },
        onClearAll: () => { entries = []; },
    });
    live.push(panel);
    panel.toggle(true);
    const el = panel.el;
    const value = (): HTMLInputElement => el.querySelector('.vela-ac-input')!;
    const select = (): HTMLSelectElement => el.querySelector('.vela-ac-select')!;
    const createButton = (): HTMLButtonElement => el.querySelector('.vela-ac-create')!;
    const input = (text: string): void => { value().value = text; value().dispatchEvent(new Event('input', { bubbles: true })); };
    const condition = (name: string): void => { select().value = name; select().dispatchEvent(new Event('change', { bubbles: true })); };
    return { panel, el, value, select, createButton, input, condition, create, go, beginEdit, saveEdit, toggleAlert,
        setTarget: (t: AlertTarget | null) => { target = t; panel.refresh(); },
        setLevel: (n: number | null) => { level = n; panel.refreshTarget(); },
        setEntries: (e: AlertEntry[]) => { entries = e; panel.refresh(); },
        setArmed: (a: ArmedAlertRow[]) => { armed = a; panel.refresh(); },
        setCharts: (c: typeof charts) => { charts = c; panel.refresh(); },
    };
}

describe('Alerts pane', () => {
    it('uses Create, Alerts and Log as accessible, wrapping keyboard tabs in a standard pane', () => {
        const { el } = setup();
        const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        expect(tabs.map((tab) => tab.getAttribute('aria-label') || tab.textContent?.trim())).toEqual(['Create', 'Alerts', 'Log']);
        expect(el.dataset.standardPane).toBe('1');
        const max = el.querySelector<HTMLButtonElement>('.vela-panel-max')!;
        expect(max.getAttribute('aria-label')).toBe('Maximize');
        expect(max.getAttribute('aria-pressed')).toBe('false');
        expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
        tabs[0]!.focus();
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs[1]!.tabIndex).toBe(0);
        expect(tabs[0]!.tabIndex).toBe(-1);
        tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
        tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
        tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
        tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
    });

    it('edits independently of the Create draft, validates chart identity, and saves the original alert', () => {
        const { el, input, value, setArmed, setTarget, beginEdit, saveEdit } = setup();
        input('123.45');
        setArmed([{ id: 'a1', cellId: 'a', label: 'AAA · Crossing up 125', state: 'active', fires: 0, onDelete: () => {} }]);
        el.querySelector<HTMLButtonElement>('[data-tab="alerts"]')!.click();
        el.querySelector<HTMLButtonElement>('[aria-label="Edit alert AAA · Crossing up 125"]')!.click();
        expect(beginEdit).toHaveBeenCalledWith('a1');
        const editor = el.querySelector<HTMLElement>('.vela-ap-editor')!;
        expect(editor.hidden).toBe(false);
        const field = editor.querySelector<HTMLInputElement>('[aria-label="Alert level"]')!;
        const save = editor.querySelector<HTMLButtonElement>('.vela-ac-create')!;
        expect(field.value).toBe('125');
        field.value = '140'; field.dispatchEvent(new Event('input', { bubbles: true }));
        setTarget({ cellId: 'b', symbol: 'BBB', timeframe: '60', chartLabel: 'Chart 2', price: 44 });
        expect(save.disabled).toBe(true);
        expect(editor.querySelector<HTMLButtonElement>('.vela-ac-rebind')!.hidden).toBe(true);
        expect(editor.textContent).toContain('Return to the original chart and market');
        setTarget({ cellId: 'a', symbol: 'AAA', timeframe: '60', chartLabel: 'Chart 1', price: 100 });
        expect(save.disabled).toBe(false);
        save.click();
        expect(saveEdit).toHaveBeenCalledWith('a1', expect.objectContaining({ condition: 'cross-up', value: 140 }), expect.objectContaining({ cellId: 'a' }));
        expect(editor.hidden).toBe(true);
        expect(value().value).toBe('123.45');
    });

    it('pauses, resumes, re-arms, filters and confirms deletion without changing the log', () => {
        const { el, setArmed, setEntries, toggleAlert } = setup();
        const remove = vi.fn();
        setArmed([
            { id: 'a1', cellId: 'a', label: 'AAA · Crossing 100', state: 'active', fires: 0, onDelete: remove },
            { id: 'a2', cellId: 'a', label: 'AAA · Crossing 120', state: 'fired', fires: 1, onDelete: remove },
        ]);
        setEntries([{ cellId: 'a', source: 'AAA', title: 'Price alert', message: 'triggered', time: Date.now() }]);
        el.querySelector<HTMLButtonElement>('[data-tab="alerts"]')!.click();
        expect(el.querySelector('[data-tab="alerts"]')!.getAttribute('aria-label')).toBe('Alerts, 2 price alerts');
        el.querySelector<HTMLButtonElement>('[aria-label="Pause alert AAA · Crossing 100"]')!.click();
        expect(toggleAlert).toHaveBeenCalledWith('a1');
        expect(el.querySelector('[aria-label="Resume alert AAA · Crossing 100"]')).not.toBeNull();
        const filter = el.querySelector<HTMLSelectElement>('.vela-ap-filter')!;
        filter.value = 'paused'; filter.dispatchEvent(new Event('change'));
        expect(el.querySelectorAll('.vela-ap-armed-row')).toHaveLength(1);
        el.querySelector<HTMLButtonElement>('[aria-label="Resume alert AAA · Crossing 100"]')!.click();
        expect(el.querySelector('.vela-ap-section')!.textContent).toContain('No paused alerts.');
        filter.value = 'fired'; filter.dispatchEvent(new Event('change'));
        el.querySelector<HTMLButtonElement>('[aria-label="Re-arm alert AAA · Crossing 120"]')!.click();
        expect(toggleAlert).toHaveBeenCalledWith('a2');
        filter.value = 'all'; filter.dispatchEvent(new Event('change'));
        const deleteButton = el.querySelector<HTMLButtonElement>('[aria-label="Delete alert AAA · Crossing 100"]')!;
        deleteButton.focus(); deleteButton.click();
        expect(remove).not.toHaveBeenCalled();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Confirm delete alert AAA · Crossing 100');
        const cancel = el.querySelector<HTMLButtonElement>('[aria-label="Cancel delete alert AAA · Crossing 100"]')!;
        cancel.focus(); cancel.click();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Delete alert AAA · Crossing 100');
        expect(remove).not.toHaveBeenCalled();
        el.querySelector<HTMLButtonElement>('[aria-label="Delete alert AAA · Crossing 100"]')!.click();
        el.querySelector<HTMLButtonElement>('[aria-label="Confirm delete alert AAA · Crossing 100"]')!.click();
        expect(remove).toHaveBeenCalledOnce();
        expect(el.querySelector('[data-tab="log"]')!.getAttribute('aria-label')).toBe('Log, 1 entry');
    });

    it('keeps exact price, validates empty/moving values, and never loses a level on an operator change', () => {
        const { value, createButton, input, condition, el } = setup();
        expect(value().value).toBe('100.12345678901234');
        input('98.5');
        condition('gt');
        expect(value().value).toBe('98.5');
        input('');
        expect(createButton().disabled).toBe(true); // empty is not zero
        input('0');
        expect(createButton().disabled).toBe(false);
        condition('move-up-pct');
        expect(value().value).toBe('');
        expect(createButton().disabled).toBe(true);
        input('2.5');
        const bars = el.querySelector<HTMLInputElement>('.vela-ac-bars input')!;
        bars.value = '0'; bars.dispatchEvent(new Event('input'));
        expect(createButton().disabled).toBe(true);
        bars.value = '3'; bars.dispatchEvent(new Event('input'));
        expect(createButton().disabled).toBe(false);
    });

    it('blocks a changed chart or market until explicitly rebound, and preserves the draft', () => {
        const { el, input, value, createButton, create, setTarget } = setup();
        input('123');
        setTarget({ cellId: 'b', symbol: 'BBB', timeframe: '60', chartLabel: 'Chart 2', price: 44 });
        expect(value().value).toBe('123');
        expect(createButton().disabled).toBe(true);
        expect(el.querySelector('.vela-ac-warning')!.textContent).toContain('BBB');
        createButton().click();
        expect(create).not.toHaveBeenCalled();
        el.querySelector<HTMLButtonElement>('.vela-ac-rebind')!.click();
        expect(value().value).toBe('44');
        createButton().click();
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0]![1]).toMatchObject({ cellId: 'b', symbol: 'BBB' });
        setTarget({ cellId: 'b', symbol: 'BBB', timeframe: '60', chartLabel: 'Chart 1', price: 44 });
        expect(el.querySelector('.vela-ac-target-detail')!.textContent).toContain('Chart 1');
        setTarget({ cellId: 'b', symbol: 'BBB', timeframe: '5', chartLabel: 'Chart 2', price: 44 });
        expect(createButton().disabled).toBe(true);
    });

    it('re-seeds only an untouched replay draft, and treats a trading-session switch as a new target', () => {
        const { panel, el, value, input, setTarget, createButton } = setup();
        setTarget({ cellId: 'a', symbol: 'AAA', timeframe: '60', chartLabel: 'Chart 1', price: 50 });
        panel.refreshReplay();
        expect(value().value).toBe('50');
        input('75');
        setTarget({ cellId: 'a', symbol: 'AAA', timeframe: '60', chartLabel: 'Chart 1', price: 42 });
        panel.refreshReplay();
        expect(value().value).toBe('75');
        setTarget({ cellId: 'a', symbol: 'AAA', timeframe: '60', session: 'extended', chartLabel: 'Chart 1', price: 42 });
        expect(createButton().disabled).toBe(true);
        expect(el.querySelector('.vela-ac-warning')!.textContent).toContain('Extended session');
    });

    it('follows a drawing and blocks a deleted source until the user chooses chart price', () => {
        const { panel, el, value, createButton, create, setLevel, select } = setup();
        panel.createOnActive({ drawingId: 'line-1', value: 112.5, label: 'Horizontal line' });
        expect(value().readOnly).toBe(true);
        expect(select().querySelector<HTMLOptionElement>('option[value="move-up"]')!.disabled).toBe(true);
        setLevel(115);
        expect(value().value).toBe('115');
        createButton().click();
        expect(create.mock.calls[0]![0]).toMatchObject({ value: 115, source: { drawingId: 'line-1' } });
        setLevel(null);
        expect(createButton().disabled).toBe(true);
        el.querySelector<HTMLButtonElement>('.vela-ac-rebind')!.click();
        expect(value().readOnly).toBe(false);
        expect(value().value).toBe('100.12345678901234');
    });

    it('keeps armed status, deletion, grouped provenance, unknown-chart entries, Go and Clear', () => {
        const { el, panel, setEntries, setArmed, go } = setup();
        const remove = vi.fn();
        setArmed([{ id: 'a1', cellId: 'a', label: 'AAA · Crossing 100', state: 'active', fires: 2, offChart: 'AAA', onDelete: remove }]);
        expect(el.querySelector('.vela-ap-section')!.textContent).toContain('Waiting for AAA');
        el.querySelector<HTMLButtonElement>('[data-tab="alerts"]')!.click();
        el.querySelector<HTMLButtonElement>('[aria-label="Delete alert AAA · Crossing 100"]')!.click();
        expect(remove).not.toHaveBeenCalled();
        el.querySelector<HTMLButtonElement>('[aria-label="Confirm delete alert AAA · Crossing 100"]')!.click();
        expect(remove).toHaveBeenCalledOnce();
        setEntries([
            { cellId: 'b', source: 'BBB 1h RSI', title: 'Signal', message: 'overbought', time: 1700000000000 },
            { cellId: 'lost', source: 'OLD 1d', title: 'Price alert', message: 'crossed', time: 1700000010000 },
        ]);
        el.querySelector<HTMLButtonElement>('[data-tab="log"]')!.click();
        expect(el.querySelectorAll('.vela-ap-group')).toHaveLength(2);
        expect(el.querySelector('.vela-ap-log')!.textContent).toContain('BBB 1h RSI');
        expect(el.querySelector('.vela-ap-log')!.textContent).toContain('Chart lost · not in layout');
        el.querySelector<HTMLButtonElement>('[aria-label="Go to chart 2"]')!.click();
        expect(go).toHaveBeenCalledWith('b');
        expect(panel.open).toBe(true);
        el.querySelector<HTMLButtonElement>('[aria-label="Clear alerts for chart 2"]')!.click();
        expect(el.querySelectorAll('.vela-ap-group')).toHaveLength(1);
        el.querySelector<HTMLButtonElement>('[aria-label="Clear every alert log entry"]')!.click();
        expect(el.querySelector('.vela-ap-log')!.textContent).toContain('Nothing has triggered');
    });

    it('distinguishes a pooled chart from an unavailable drawing source', () => {
        const { el, setArmed } = setup();
        const row: ArmedAlertRow = { id: 'a1', cellId: 'a', label: 'AAA · Crossing 100', state: 'active', fires: 0, offChart: null, waitingChart: true, waitingDrawing: true, onDelete: () => {} };
        setArmed([row]);
        expect(el.querySelector('.vela-ap-meta')!.textContent).toContain('Waiting for chart');
        setArmed([{ ...row, waitingChart: false }]);
        expect(el.querySelector('.vela-ap-meta')!.textContent).toContain('Waiting for drawing');
    });

    it('updates an armed row when chart numbering changes without an alert change', () => {
        const { el, setArmed, setCharts } = setup();
        setArmed([{ id: 'a1', cellId: 'a', label: 'AAA · Crossing 100', state: 'active', fires: 0, offChart: null, onDelete: () => {} }]);
        expect(el.querySelector('.vela-ap-meta')!.textContent).toContain('Chart 1');
        setCharts([{ id: 'b', label: '1', symbol: 'BBB' }, { id: 'a', label: '2', symbol: 'AAA' }]);
        expect(el.querySelector('.vela-ap-meta')!.textContent).toContain('Chart 2');
    });

    it('does not replace a focused form field during unrelated live log refreshes', () => {
        const { el, value, input, setEntries } = setup();
        input('121.25');
        const field = value(); field.focus();
        setEntries([{ cellId: 'a', source: 'AAA 1h RSI', title: 'Signal', message: 'live', time: Date.now() }]);
        expect(value()).toBe(field);
        expect(document.activeElement).toBe(field);
        expect(value().value).toBe('121.25');
        expect(el.querySelector('[data-tab="log"]')!.getAttribute('aria-label')).toBe('Log, 1 entry');
    });
});
