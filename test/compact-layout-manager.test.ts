// @vitest-environment jsdom
// R86 Task 5 — a phone-sized, SEPARATE Manage layouts panel: autosave, copy, rename,
// sharing link on/off, link and open link. It never renders the chart-grid setup.
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
afterEach(() => {
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

describe('compact Manage layouts panel', () => {
    it('renders only the management verbs in a narrow overflow-safe card', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const panel = new LayoutManagerPanel({
            host,
            activeName: () => 'Scalp ETH',
            autosave: () => false,
            onToggleAutosave: () => {},
            onMakeCopy: () => 'Scalp ETH copy',
            onRename: () => true,
            sharing: () => false,
            onToggleSharing: () => {},
            shareUrl: async () => 'https://example.test/#s1=abc',
            onCopyLink: async () => null,
            onOpenLink: async () => true,
        });
        panel.open();
        const dialog = document.querySelector('.vela-lm-dialog')!;
        const text = dialog.textContent ?? '';
        expect(dialog).not.toBeNull();
        expect(text).toContain('Manage layouts');
        expect(text).toContain('Scalp ETH');
        for (const label of ['Autosave', 'Make a copy', 'Rename', 'Sharing link', 'Copy link', 'Open link']) {
            expect(text).toContain(label);
        }
        expect(text).not.toContain('Layout setup');
        expect(text).not.toContain('1 × 1');
        expect(document.querySelector('.vela-lm')?.classList.contains('vela-lm')).toBe(true);
        expect(dialog.querySelectorAll('.vela-lm-switch')).toHaveLength(2);
        expect(dialog.querySelectorAll('input')).toHaveLength(3);
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
