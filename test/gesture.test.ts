// @vitest-environment jsdom
// The two primitives the round-9 interaction work stands on: a long press that yields
// to a scroll, and the reading direction a grid must obey.
//
// The numbers are the platform's, not ours: Android's `ViewConfiguration` long-press
// timeout is 500 ms and its touch slop 8 dp; iOS's `UILongPressGestureRecognizer` fires
// at 0.5 s by default. Ten CSS pixels is the middle of that band, and the mouse slop is
// much tighter because a mouse does not wobble.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachLongPress, isRtl, LONG_PRESS_MS, MOUSE_SLOP_PX, TOUCH_SLOP_PX, slopFor } from '../src/ui/gesture';

function pointerDown(el: Element, type: string, x: number, y: number, pointerType = 'touch'): void {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    el.dispatchEvent(e);
}

afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('attachLongPress', () => {
    it('fires once after the platform timeout, then swallows the click that ends it', () => {
        vi.useFakeTimers();
        const el = document.createElement('button');
        document.body.append(el);
        const fire = vi.fn();
        attachLongPress(el, { onFire: fire });
        pointerDown(el, 'pointerdown', 10, 10);
        vi.advanceTimersByTime(LONG_PRESS_MS - 10);
        expect(fire).not.toHaveBeenCalled();
        vi.advanceTimersByTime(20);
        expect(fire).toHaveBeenCalledTimes(1);
        // The tap that lifted the finger must not ALSO run the short action.
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        el.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        pointerDown(el, 'pointerup', 10, 10);
    });

    it('cancels when the finger travels past the slop (the gesture belongs to the scroll)', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        document.body.append(el);
        const fire = vi.fn();
        attachLongPress(el, { onFire: fire });
        pointerDown(el, 'pointerdown', 10, 10);
        pointerDown(el, 'pointermove', 10 + TOUCH_SLOP_PX + 2, 10);
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(fire).not.toHaveBeenCalled();
    });

    it('tolerates a small wobble inside the slop', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        document.body.append(el);
        const fire = vi.fn();
        attachLongPress(el, { onFire: fire });
        pointerDown(el, 'pointerdown', 10, 10);
        pointerDown(el, 'pointermove', 10 + TOUCH_SLOP_PX - 2, 12);
        vi.advanceTimersByTime(LONG_PRESS_MS + 5);
        expect(fire).toHaveBeenCalledTimes(1);
    });

    it('ignores the mouse by default, and arms for it on request', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        document.body.append(el);
        const fire = vi.fn();
        attachLongPress(el, { onFire: fire });
        pointerDown(el, 'pointerdown', 0, 0, 'mouse');
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(fire).not.toHaveBeenCalled();

        const off = attachLongPress(el, { onFire: fire, touchOnly: false });
        pointerDown(el, 'pointerdown', 0, 0, 'mouse');
        pointerDown(el, 'pointermove', MOUSE_SLOP_PX - 1, 0, 'mouse');
        vi.advanceTimersByTime(LONG_PRESS_MS + 5);
        expect(fire).toHaveBeenCalledTimes(1);
        off();
    });

    it('disposer stops everything', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        document.body.append(el);
        const fire = vi.fn();
        const off = attachLongPress(el, { onFire: fire });
        pointerDown(el, 'pointerdown', 0, 0);
        off();
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(fire).not.toHaveBeenCalled();
    });
});

describe('slopFor', () => {
    it('gives touch a wider band than a mouse', () => {
        expect(slopFor('touch')).toBe(TOUCH_SLOP_PX);
        expect(slopFor('pen')).toBe(TOUCH_SLOP_PX);
        expect(slopFor('mouse')).toBe(MOUSE_SLOP_PX);
        expect(TOUCH_SLOP_PX).toBeGreaterThan(MOUSE_SLOP_PX);
    });
});

describe('isRtl', () => {
    it('follows the nearest dir attribute', () => {
        document.body.innerHTML = '<div dir="rtl"><section id="a"><button id="b"></button></section></div>';
        expect(isRtl(document.getElementById('b'))).toBe(true);
        document.body.innerHTML = '<div id="a"></div>';
        expect(isRtl(document.getElementById('a'))).toBe(false);
    });

    it('is false for a detached or null node instead of throwing', () => {
        expect(isRtl(null)).toBe(false);
        expect(isRtl(document.createElement('div'))).toBe(false);
    });
});
