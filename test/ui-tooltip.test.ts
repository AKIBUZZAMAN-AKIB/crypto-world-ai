// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, enableButtonTooltips } from '../src/ui/components/tooltip';

function pointer(el: Element, type: 'pointerover' | 'pointerout', kind = 'mouse', related: Element | null = null): void {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget: related });
    Object.defineProperty(event, 'pointerType', { value: kind });
    el.dispatchEvent(event);
}

function fixture(): { root: HTMLElement; stop: () => void } {
    const root = document.createElement('div');
    root.className = 'vela-ui';
    document.body.appendChild(root);
    return { root, stop: enableButtonTooltips(root) };
}

function current(): HTMLElement | null {
    return document.querySelector('.vela-tooltip[data-state="open"]');
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('workspace button tooltips', () => {
    it('borrows a native title, preserves descriptions and follows dynamic updates', () => {
        const { root, stop } = fixture();
        const button = document.createElement('button');
        button.title = 'Close';
        button.setAttribute('aria-describedby', 'existing');
        root.appendChild(button);
        pointer(button, 'pointerover');
        expect(current()?.textContent).toBe('Close');
        expect(button.getAttribute('title')).toBeNull();
        expect(button.getAttribute('aria-describedby')).toBe('existing vela-shared-tip');
        // A control may update its state and labels while the pointer is over it.
        button.title = 'Updated';
        button.setAttribute('aria-describedby', 'existing new-description vela-shared-tip');
        pointer(button, 'pointerout');
        vi.advanceTimersByTime(300);
        expect(button.title).toBe('Updated');
        expect(button.getAttribute('aria-describedby')).toBe('existing new-description');
        pointer(button, 'pointerover');
        expect(current()?.textContent).toBe('Updated');
        pointer(button, 'pointerout');
        vi.advanceTimersByTime(300);
        expect(button.title).toBe('Updated');
        stop();
    });

    it('only supplies icon-only or titled buttons, never touch hover or opted-out swatches', () => {
        const { root, stop } = fixture();
        const icon = document.createElement('button');
        icon.setAttribute('aria-label', 'Edit');
        const visible = document.createElement('button');
        visible.setAttribute('aria-label', 'Visible label');
        visible.textContent = 'Save';
        const optOut = document.createElement('div');
        optOut.setAttribute('data-vela-no-tip', '');
        const swatch = document.createElement('button');
        swatch.setAttribute('aria-label', 'Color red');
        optOut.appendChild(swatch);
        root.append(icon, visible, optOut);
        pointer(icon, 'pointerover', 'touch');
        expect(current()).toBeNull();
        pointer(visible, 'pointerover');
        pointer(swatch, 'pointerover');
        expect(current()).toBeNull();
        pointer(icon, 'pointerover');
        expect(current()?.textContent).toBe('Edit');
        pointer(icon, 'pointerout');
        stop();
    });

    it('switches correctly between explicit and fallback tips and updates an open explicit tip', () => {
        const { root, stop } = fixture();
        const explicit = document.createElement('button');
        const automatic = document.createElement('button');
        automatic.title = 'Automatic';
        explicit.setAttribute('aria-describedby', 'existing-info');
        root.append(explicit, automatic);
        const tip = new Tooltip(explicit, { content: 'Indicator templates', host: root });
        pointer(automatic, 'pointerover');
        expect(current()?.textContent).toBe('Automatic');
        pointer(explicit, 'pointerover');
        expect(automatic.title).toBe('Automatic');
        expect(current()?.textContent).toBe('Indicator templates');
        expect(explicit.getAttribute('aria-describedby')).toBe('existing-info vela-shared-tip');
        tip.setContent('Templates updated');
        expect(current()?.textContent).toBe('Templates updated');
        pointer(automatic, 'pointerover');
        expect(current()?.textContent).toBe('Automatic');
        tip.destroy();
        expect(explicit.getAttribute('aria-describedby')).toBe('existing-info');
        stop();
        expect(current()).toBeNull();
        expect(automatic.title).toBe('Automatic');
    });

    it('subtracts a fixed layer’s contained origin when placing its tooltip', () => {
        const { root, stop } = fixture();
        const button = document.createElement('button');
        root.appendChild(button);
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, right: 220, bottom: 120,
            x: 200, y: 100, width: 20, height: 20, toJSON: () => ({}) } as DOMRect);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const left = this.dataset.scope === 'tooltip' && this.dataset.part === 'positioner' ? 150 : 0;
            const top = this.dataset.scope === 'tooltip' && this.dataset.part === 'positioner' ? 39 : 0;
            return { left, top, right: left, bottom: top, x: left, y: top, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
        });
        const tip = new Tooltip(button, { content: 'Contained', host: root });
        pointer(button, 'pointerover');
        expect(current()?.parentElement?.style.transform).toBe('translate3d(60px, 53px, 0)');
        tip.destroy(); stop();
    });

    it('styles titled resize separators without changing their ARIA state', () => {
        const { root, stop } = fixture();
        const grip = document.createElement('div');
        grip.setAttribute('role', 'separator');
        grip.setAttribute('aria-valuenow', '200');
        grip.title = 'Drag to resize · use arrow keys';
        root.appendChild(grip);
        pointer(grip, 'pointerover');
        expect(current()?.textContent).toBe('Drag to resize · use arrow keys');
        expect(grip.getAttribute('aria-describedby')).toBe('vela-shared-tip');
        expect(grip.getAttribute('aria-valuenow')).toBe('200');
        pointer(grip, 'pointerout');
        vi.advanceTimersByTime(300);
        expect(grip.title).toBe('Drag to resize · use arrow keys');
        stop();
    });

    it('stays open over the tooltip and while its trigger retains keyboard focus', () => {
        const { root, stop } = fixture();
        const button = document.createElement('button');
        button.title = 'Readable tip';
        root.appendChild(button);
        pointer(button, 'pointerover');
        const box = current()!;
        pointer(button, 'pointerout'); // crosses the eight-pixel gap
        vi.advanceTimersByTime(150);
        pointer(box, 'pointerover');
        vi.advanceTimersByTime(500);
        expect(current()).toBe(box);
        pointer(box, 'pointerout');
        expect(current()).toBeNull();
        vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible');
        button.focus();
        pointer(button, 'pointerover');
        pointer(button, 'pointerout');
        vi.advanceTimersByTime(500);
        expect(current()?.textContent).toBe('Readable tip');
        button.blur();
        expect(current()).toBeNull();
        stop();
    });

    it('supports keyboard focus, Escape and teardown after a hovered button is removed', () => {
        const { root, stop } = fixture();
        const button = document.createElement('button');
        button.title = 'Keyboard action';
        root.appendChild(button);
        vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible');
        button.focus();
        expect(current()?.textContent).toBe('Keyboard action');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(current()).toBeNull();
        expect(button.title).toBe('Keyboard action');
        pointer(button, 'pointerover');
        button.remove();
        stop();
        expect(button.title).toBe('Keyboard action');
        expect(current()).toBeNull();
    });
});
