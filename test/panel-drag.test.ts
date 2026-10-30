// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { focusViewportDelta, makePanelDraggable } from '../src/ui/panel-drag';

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}
function pointer(target: Element, type: string, x: number, y: number): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'isPrimary', { value: true });
    target.dispatchEvent(event);
}
function fixture() {
    const panel = document.createElement('div');
    const header = document.createElement('div');
    const title = document.createElement('span');
    const button = document.createElement('button');
    header.className = 'header';
    header.tabIndex = 0;
    header.append(title, button);
    panel.append(header);
    document.body.append(panel);
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 120));
    const drag = makePanelDraggable(panel, { handle: '.header', boundary: () => rect(0, 0, 500, 400) });
    return { panel, header, title, button, drag };
}

describe('floating panel header movement', () => {
    it('moves by the header, preserves size and clamps to the host', () => {
        const { panel, title, drag } = fixture();
        pointer(title, 'pointerdown', 110, 110);
        pointer(title, 'pointermove', 210, 170);
        pointer(title, 'pointerup', 210, 170);
        expect(panel.style.getPropertyValue('translate')).toBe('100px 60px');
        expect(panel.style.width).toBe('');
        expect(panel.style.height).toBe('');
        pointer(title, 'pointerdown', 110, 110);
        pointer(title, 'pointermove', 2000, 2000);
        pointer(title, 'pointerup', 2000, 2000);
        expect(panel.style.getPropertyValue('translate')).not.toBe('1900px 1890px');
        drag.destroy(); panel.remove();
    });

    it('can keep the whole resized surface inside its viewport instead of only the header', () => {
        const panel = document.createElement('div');
        const header = document.createElement('div');
        const title = document.createElement('span');
        header.className = 'header'; panel.append(header); header.append(title); document.body.append(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 120));
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 40));
        const drag = makePanelDraggable(panel, { handle: '.header', keepWithinBounds: true, boundary: () => rect(0, 0, 500, 400) });
        pointer(title, 'pointerdown', 110, 110); pointer(title, 'pointermove', 2000, 2000); pointer(title, 'pointerup', 2000, 2000);
        expect(panel.style.getPropertyValue('translate')).toBe('196px 176px');
        drag.destroy(); panel.remove();
    });

    it('does not start a drag on an interactive header control', () => {
        const { panel, button, drag } = fixture();
        pointer(button, 'pointerdown', 110, 110);
        pointer(button, 'pointermove', 210, 210);
        pointer(button, 'pointerup', 210, 210);
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy(); panel.remove();
    });

    it('supports arrow keys, reset and listener cleanup', () => {
        const { panel, header, title, drag } = fixture();
        header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(panel.style.getPropertyValue('translate')).toBe('0px 16px');
        drag.reset();
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy();
        pointer(title, 'pointerdown', 110, 110);
        pointer(title, 'pointermove', 210, 210);
        expect(panel.style.getPropertyValue('translate')).toBe('');
        panel.remove();
    });
});

describe('viewport-safe keyboard focus', () => {
    it('computes the visual-viewport delta without scrolling', () => {
        const target = document.createElement('button');
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(5, 360, 30, 25));
        const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
        Object.defineProperty(window, 'visualViewport', {
            configurable: true, value: { offsetLeft: 20, offsetTop: 30, width: 400, height: 300 },
        });
        try {
            expect(focusViewportDelta(target)).toEqual({ x: 19, y: -59 });
        } finally {
            if (original) Object.defineProperty(window, 'visualViewport', original);
            else delete (window as unknown as { visualViewport?: unknown }).visualViewport;
        }
    });

    it('temporarily shifts a draggable desktop panel to reveal a focused off-screen control', () => {
        const panel = document.createElement('div');
        const header = document.createElement('div');
        const control = document.createElement('button');
        header.className = 'header'; panel.append(header, control); document.body.append(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(100, 500, 200, 300));
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(100, 500, 200, 40));
        vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(rect(120, 820, 30, 30));
        const onResize = vi.fn();
        const drag = makePanelDraggable(panel, { handle: '.header', boundary: () => rect(0, 0, 1024, 768),
            revealFocus: () => true, onResize });
        control.focus();
        expect(document.activeElement).toBe(control);
        expect(panel.style.getPropertyValue('translate')).toBe('0px -86px');
        expect(onResize).not.toHaveBeenCalled();
        expect(panel.style.height).toBe('');
        drag.reset();
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy(); panel.remove();
    });

    it('does not move surfaces that do not opt into focus revelation', () => {
        const panel = document.createElement('div');
        const header = document.createElement('div');
        const control = document.createElement('button');
        header.className = 'header'; panel.append(header, control); document.body.append(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(100, 500, 200, 300));
        vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(rect(120, 820, 30, 30));
        const drag = makePanelDraggable(panel, { handle: '.header', boundary: () => rect(0, 0, 1024, 768) });
        control.focus();
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy(); panel.remove();
    });
});

describe('continuous panel resizing', () => {
    function sizedFixture() {
        const panel = document.createElement('div');
        const header = document.createElement('div');
        header.className = 'header';
        const grip = document.createElement('div');
        grip.className = 'resize';
        grip.tabIndex = 0;
        header.append(grip);
        panel.append(header);
        document.body.append(panel);
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 40));
        vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
            const height = parseFloat(panel.style.height) || 200;
            const y = Number(panel.style.getPropertyValue('translate').split(' ')[1]?.replace('px', '') || 0);
            // A centred dialog grows in both directions until translation compensates it.
            return rect(100, 100 - (height - 200) / 2 + y, 200, height);
        });
        const drag = makePanelDraggable(panel, { handle: '.header', resizeHandle: '.resize', boundary: () => rect(0, 0, 500, 500) });
        return { panel, grip, drag };
    }

    it('changes height continuously while keeping the bottom edge fixed, and supports arrows', () => {
        const { panel, grip, drag } = sizedFixture();
        pointer(grip, 'pointerdown', 120, 110);
        pointer(grip, 'pointermove', 120, 50);
        expect(panel.style.height).toBe('260px');
        expect(panel.getBoundingClientRect().bottom).toBeCloseTo(300);
        pointer(grip, 'pointerup', 120, 50);
        grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(panel.style.height).toBe('228px');
        expect(panel.getBoundingClientRect().bottom).toBeCloseTo(300);
        expect(grip.getAttribute('aria-valuetext')).toBe('228 pixels high');
        expect(grip.getAttribute('aria-controls')).toBe(panel.id);
        drag.destroy(); panel.remove();
    });

    it('counts a separate top strip in minimum size and keeps it visible when moving', () => {
        const panel = document.createElement('div');
        const grip = document.createElement('div');
        const header = document.createElement('div');
        grip.className = 'resize';
        grip.tabIndex = 0;
        header.className = 'header';
        panel.append(grip, header);
        document.body.append(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 200));
        vi.spyOn(grip, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 200, 24));
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(100, 124, 200, 50));
        const drag = makePanelDraggable(panel, { handle: '.header', resizeHandle: '.resize', anchoredBottom: true,
            boundary: () => rect(0, 0, 500, 500) });
        grip.focus();
        expect(grip.getAttribute('aria-valuemin')).toBe('122'); // 24 grip + 50 header + 48 content
        pointer(header, 'pointerdown', 150, 140);
        pointer(header, 'pointermove', 150, -300);
        pointer(header, 'pointerup', 150, -300);
        expect(panel.style.getPropertyValue('translate')).toBe('0px -96px'); // strip top = 4px
        drag.destroy(); panel.remove();
    });

    it('keeps a bottom-anchored pane attached and reports height changes', () => {
        const panel = document.createElement('div');
        const grip = document.createElement('div');
        grip.className = 'resize';
        grip.tabIndex = 0;
        panel.appendChild(grip);
        document.body.appendChild(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
            const height = parseFloat(panel.style.height) || 200;
            return rect(0, 500 - height, 300, height);
        });
        const onResize = vi.fn();
        const drag = makePanelDraggable(panel, { handle: '.resize', resizeHandle: '.resize', anchoredBottom: true,
            boundary: () => rect(0, 0, 300, 500), onResize });
        pointer(grip, 'pointerdown', 100, 300);
        pointer(grip, 'pointermove', 100, 180);
        pointer(grip, 'pointerup', 100, 180);
        expect(panel.style.height).toBe('320px');
        expect(panel.getBoundingClientRect().bottom).toBe(500);
        expect(panel.style.getPropertyValue('translate')).toBe('');
        expect(onResize).toHaveBeenLastCalledWith(320);
        grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
        expect(panel.style.height).toBe('500px');
        expect(panel.getBoundingClientRect().top).toBe(0);
        expect(onResize).toHaveBeenLastCalledWith(500);
        window.dispatchEvent(new Event('resize'));
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy();
        panel.remove();
    });

    it('can disable header movement without disabling the separate resize grip', () => {
        const panel = document.createElement('div');
        const header = document.createElement('div');
        const grip = document.createElement('div');
        header.className = 'header'; header.tabIndex = 0;
        grip.className = 'resize'; grip.tabIndex = 0;
        panel.append(grip, header); document.body.append(panel);
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(0, 324, 300, 40));
        vi.spyOn(grip, 'getBoundingClientRect').mockReturnValue(rect(0, 300, 300, 24));
        vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
            const height = parseFloat(panel.style.height) || 200;
            return rect(0, 500 - height, 300, height);
        });
        const drag = makePanelDraggable(panel, { handle: '.header', resizeHandle: '.resize',
            anchoredBottom: true, allowMove: false, boundary: () => rect(0, 0, 300, 500) });
        pointer(header, 'pointerdown', 100, 340);
        pointer(header, 'pointermove', 100, 250);
        pointer(header, 'pointerup', 100, 250);
        header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
        expect(panel.style.getPropertyValue('translate')).toBe('');
        expect(panel.style.height).toBe('');
        pointer(grip, 'pointerdown', 100, 310);
        pointer(grip, 'pointermove', 100, 230);
        pointer(grip, 'pointerup', 100, 230);
        expect(panel.style.height).toBe('280px');
        expect(panel.getBoundingClientRect().bottom).toBe(500);
        expect(panel.style.getPropertyValue('translate')).toBe('');
        drag.destroy(); panel.remove();
    });

    it('rolls back a cancelled grip resize and its remembered height', () => {
        const panel = document.createElement('div');
        const grip = document.createElement('div');
        grip.className = 'resize'; panel.appendChild(grip); document.body.appendChild(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
            const height = parseFloat(panel.style.height) || 200;
            return rect(0, 500 - height, 300, height);
        });
        const onResize = vi.fn();
        const drag = makePanelDraggable(panel, { handle: '.resize', resizeHandle: '.resize', anchoredBottom: true,
            boundary: () => rect(0, 0, 300, 500), onResize });
        pointer(grip, 'pointerdown', 100, 300);
        pointer(grip, 'pointermove', 100, 180);
        expect(panel.style.height).toBe('320px');
        pointer(grip, 'pointercancel', 100, 180);
        expect(panel.style.height).toBe('');
        expect(onResize).toHaveBeenLastCalledWith(200);
        drag.destroy(); panel.remove();
    });

    it('refreshes the accessible height after the surface opening animation', () => {
        const { panel, grip, drag } = sizedFixture();
        panel.dispatchEvent(new Event('animationend', { bubbles: true }));
        expect(grip.getAttribute('aria-valuenow')).toBe('200');
        expect(grip.getAttribute('aria-valuetext')).toBe('200 pixels high');
        drag.destroy();
        panel.remove();
    });

    it('honors an explicit CSS minimum in the height and accessible range', () => {
        const panel = document.createElement('div');
        const grip = document.createElement('div');
        grip.className = 'resize';
        grip.tabIndex = 0;
        panel.appendChild(grip);
        document.body.appendChild(panel);
        vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
            const height = parseFloat(panel.style.height) || 300;
            return rect(0, 500 - height, 300, height);
        });
        const drag = makePanelDraggable(panel, { handle: '.resize', resizeHandle: '.resize', anchoredBottom: true,
            minHeight: 200, boundary: () => rect(0, 0, 300, 500) });
        grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
        expect(panel.style.height).toBe('200px');
        expect(grip.getAttribute('aria-valuemin')).toBe('200');
        expect(grip.getAttribute('aria-valuenow')).toBe('200');
        grip.click();
        expect(panel.querySelector('.vela-panel-height-control')).toBeNull();
        drag.destroy();
        panel.remove();
    });

    it('does not create a size popup on click or Enter; arrows resize directly', () => {
        const { panel, grip, drag } = sizedFixture();
        grip.click();
        grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        expect(panel.querySelector('.vela-panel-height-control')).toBeNull();
        expect(panel.querySelector('input[type="range"], input[type="number"]')).toBeNull();
        grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
        expect(panel.style.height).toBe('232px');
        drag.destroy(); panel.remove();
    });
});
