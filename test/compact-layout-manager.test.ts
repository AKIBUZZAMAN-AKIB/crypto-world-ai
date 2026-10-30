// @vitest-environment jsdom
// Manage layouts is an anchored action menu, with forms in the same floating surface.
// It retains autosave, copy, rename and sharing without rendering the chart-grid setup.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { LayoutManagerPanel } from '../src/widget/layout-manager-panel';
import { sanitizeState } from '../src/state/document';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
const managers: LayoutManagerPanel[] = [];
afterEach(() => {
    for (const manager of managers.splice(0)) manager.destroy();
    for (const ws of live.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function mount(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1' } as never);
    live.push(ws);
    return ws;
}

describe('floating Manage layouts menu', () => {
    it('uses a menu rather than a dialog and retains its actions in the same surface', async () => {
        const host = document.createElement('div');
        const trigger = document.createElement('button');
        host.append(trigger);
        document.body.append(host);
        let autosave = false, sharing = false;
        const panel = new LayoutManagerPanel({
            host,
            activeName: () => 'Scalp ETH',
            autosave: () => autosave,
            onToggleAutosave: (on) => { autosave = on; },
            onMakeCopy: () => 'Scalp ETH copy',
            onRename: () => true,
            sharing: () => sharing,
            onToggleSharing: (on) => { sharing = on; },
            shareUrl: async () => 'https://example.test/#s1=abc',
            onCopyLink: async () => null,
            onOpenLink: async () => false,
        });
        managers.push(panel);
        panel.open(trigger);
        const menu = document.querySelector<HTMLElement>('.vela-lmp')!;
        expect(menu.closest('.vela-popover')).not.toBeNull();
        expect(menu.getAttribute('role')).toBe('menu');
        expect(document.querySelector('.vela-lmp-dialog')).toBeNull();
        expect(menu.textContent).toContain('Scalp ETH');
        expect(menu.textContent).toContain('Autosave');
        expect(menu.textContent).toContain('Make a copy');
        expect(menu.textContent).toContain('Rename');
        expect(menu.textContent).not.toContain('Layout setup');
        expect(menu.querySelectorAll('input')).toHaveLength(0);
        menu.querySelector<HTMLButtonElement>('[data-action="autosave"]')!.click();
        expect(autosave).toBe(true);
        expect(menu.querySelector('[data-action="autosave"]')?.getAttribute('aria-checked')).toBe('true');
        menu.querySelector<HTMLButtonElement>('[data-action="sharing"]')!.click();
        menu.querySelector<HTMLButtonElement>('[data-action="sharing-toggle"]')!.click();
        expect(sharing).toBe(true);
        menu.querySelector<HTMLButtonElement>('[data-action="share-copy"]')!.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(menu.dataset.page).toBe('show-link');
        expect(menu.querySelector<HTMLInputElement>('[aria-label="Workspace sharing link"]')?.value).toBe('https://example.test/#s1=abc');
        expect(menu.querySelector('[role="status"]')?.textContent).toContain('Clipboard refused');
        menu.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
        menu.querySelector<HTMLButtonElement>('[data-action="open-link"]')!.click();
        const input = menu.querySelector<HTMLInputElement>('[aria-label="Shared link to open"]')!;
        input.value = 'bad-link';
        input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        expect(menu.querySelector('[role="status"]')?.textContent).toContain('could not be opened');
    });

    it('keeps sharing state in the workspace document, separate from layout setup', () => {
        const ws = mount();
        expect(ws.layoutSharingEnabled()).toBe(false);
        ws.setLayoutSharing(true);
        expect(ws.layoutSharingEnabled()).toBe(true);
        const state = ws.getState();
        expect(state.layoutPrefs?.sharing).toBe(true);
        expect(sanitizeState(state)?.layoutPrefs?.sharing).toBe(true);
        const restored = mount();
        restored.applyState(state);
        expect(restored.layoutSharingEnabled()).toBe(true);
    });

    it('makes a copy and renames the open layout without touching the grid', () => {
        const ws = mount();
        expect(ws.makeLayoutCopy()).toBe('Layout copy');
        expect(ws.activeLayoutName()).toBe('Layout copy');
        expect(ws.renameActiveLayout('London session')).toBe(true);
        expect(ws.activeLayoutName()).toBe('London session');
        expect(ws.getState().charts?.length ?? 1).toBe(1);
    });
});
