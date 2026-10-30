// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { LayoutModeController } from '../src/widget/layout-mode';

describe('layout orientation controller', () => {
    it('responds to rotation and unregisters viewport listeners without ResizeObserver', () => {
        const oldMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
        const oldResize = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
        });
        Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: undefined });
        const root = document.createElement('div');
        document.body.append(root);
        let width = 390;
        let height = 780;
        vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect);
        const modes: string[] = [];
        const controller = new LayoutModeController(root);
        controller.onChange((mode) => modes.push(mode));
        expect(controller.current).toBe('mobile');
        width = 780; height = 390;
        window.dispatchEvent(new Event('orientationchange'));
        expect(controller.current).toBe('desktop');
        window.dispatchEvent(new Event('resize'));
        expect(modes).toEqual(['desktop']); // duplicate measurements do not re-fire
        width = 390; height = 780;
        window.dispatchEvent(new Event('resize'));
        expect(controller.current).toBe('mobile');
        expect(modes).toEqual(['desktop', 'mobile']);
        controller.destroy();
        width = 780; height = 390;
        window.dispatchEvent(new Event('resize'));
        expect(controller.current).toBe('mobile');
        root.remove();
        if (oldMedia) Object.defineProperty(window, 'matchMedia', oldMedia);
        else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
        if (oldResize) Object.defineProperty(window, 'ResizeObserver', oldResize);
        else delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    });
});
