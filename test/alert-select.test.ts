// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertSelect } from '../src/widget/alert-select';

function setup() {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    const label = document.createElement('label');
    label.htmlFor = 'condition'; label.textContent = 'Condition';
    const select = document.createElement('select'); select.id = 'condition';
    for (const [value, text, disabled] of [['cross', 'Crossing', false], ['move', 'Moving', true], ['above', 'Above', false]] as const) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; option.disabled = disabled; select.appendChild(option);
    }
    host.append(label, select); document.body.appendChild(host);
    return { host, select, control: new AlertSelect(select) };
}
beforeEach(() => document.body.replaceChildren());

describe('AlertSelect', () => {
    it('retains a labeled native value source while keyboard skips disabled choices and commits events', () => {
        const { host, select, control } = setup();
        const input = vi.fn(), change = vi.fn(); select.addEventListener('input', input); select.addEventListener('change', change);
        expect(host.querySelector('label')?.htmlFor).toBe(control.trigger.id);
        expect(control.trigger.getAttribute('role')).toBe('combobox');
        expect(control.trigger.textContent).toContain('Crossing');
        control.trigger.focus(); control.open();
        expect(control.trigger.getAttribute('aria-expanded')).toBe('true');
        expect(host.querySelector('[role="option"][data-value="move"]')?.hasAttribute('disabled')).toBe(true);
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        const active = host.querySelector(`#${control.trigger.getAttribute('aria-activedescendant')}`);
        expect(active?.getAttribute('data-value')).toBe('above');
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(select.value).toBe('above'); expect(input).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1);
        expect(control.trigger.textContent).toContain('Above'); expect(control.trigger.getAttribute('aria-expanded')).toBe('false');
        control.destroy();
    });

    it('reflects programmatic changes, restores focus after Escape, and removes the child on teardown', () => {
        const { host, select, control } = setup();
        select.value = 'above'; select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(control.trigger.textContent).toContain('Above');
        control.trigger.focus(); control.open();
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(control.trigger.getAttribute('aria-expanded')).toBe('false');
        expect(host.querySelector('.vela-alert-select-pop')).toBeNull();
        expect(document.activeElement).toBe(control.trigger);
        control.open(); control.destroy();
        expect(host.querySelector('.vela-alert-select-pop')).toBeNull();
    });
});
