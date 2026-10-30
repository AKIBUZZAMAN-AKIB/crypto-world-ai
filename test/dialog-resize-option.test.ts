// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../src/ui/components/dialog';

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe('independent dialog movement and height control', () => {
    it('keeps header movement without exposing a resize grip when disabled', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const dialog = new Dialog({ host, title: 'Chart settings', draggable: true, resizable: false });
        vi.spyOn(dialog.panel, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 300, 200));
        vi.spyOn(dialog.positioner, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
        const header = dialog.panel.querySelector<HTMLElement>('.vela-dialog-header')!;
        expect(dialog.panel.querySelector('.vela-size-grip')).toBeNull();
        expect(header.tabIndex).toBe(0);
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(dialog.panel.style.getPropertyValue('translate')).toBe('0px 16px');
        expect(dialog.panel.style.height).toBe('');
        expect(dialog.panel.querySelector('.vela-panel-height-control')).toBeNull();
        dialog.destroy();
        host.remove();
    });

    it('retains the default grip on other draggable dialogs', () => {
        const dialog = new Dialog({ title: 'Indicator settings' });
        expect(dialog.panel.querySelector('.vela-size-grip[role="separator"]')).not.toBeNull();
        dialog.destroy();
    });
});
