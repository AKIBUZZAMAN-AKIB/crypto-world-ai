// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SidePanel } from '../src/widget/side-panel';
import { Drawer } from '../src/ui/components/drawer/view';

afterEach(() => { document.body.replaceChildren(); });

function workspace(): HTMLElement {
    const host = document.createElement('div');
    host.dataset.layout = 'mobile';
    document.body.append(host);
    return host;
}

describe('separate phone resize strip', () => {
    it('moves just the side-panel separator above the header and restores desktop placement', () => {
        const host = workspace();
        const panel = new SidePanel(host, 'Data Window', 'phone-test', { standardPane: true });
        panel.toggle(true, true);
        const grip = panel.el.querySelector<HTMLElement>('.vela-panel-grip')!;
        const header = panel.el.querySelector<HTMLElement>('.vela-panel-header')!;
        const body = panel.el.querySelector<HTMLElement>('.vela-panel-body')!;
        const draft = document.createElement('input');
        draft.value = 'keep this draft';
        body.append(draft);
        expect(grip.parentElement).toBe(panel.el);
        expect(grip.nextElementSibling).toBe(header);
        expect(grip.getAttribute('role')).toBe('separator');
        expect(grip.getAttribute('aria-controls')).toBe(panel.el.id);
        expect(header.tabIndex).toBe(-1);
        expect(header.getAttribute('aria-label')).toBeNull();
        const visible = [...header.children].filter((node) => getComputedStyle(node).display !== 'none');
        const close = header.querySelector('.vela-panel-close');
        expect(visible[visible.indexOf(close!) - 1]?.classList.contains('vela-panel-max')).toBe(true);

        host.dataset.layout = 'desktop';
        window.dispatchEvent(new Event('resize'));
        expect(grip.parentElement).toBe(header);
        expect(body.contains(draft)).toBe(true);
        expect(draft.value).toBe('keep this draft');
        host.dataset.layout = 'mobile';
        window.dispatchEvent(new Event('resize'));
        expect(grip.parentElement).toBe(panel.el);
        expect(grip.nextElementSibling).toBe(header);
        expect(body.contains(draft)).toBe(true);
        panel.destroy();
    });

    it('places a titled or untitled drawer grip above the heading only on phones', () => {
        const host = workspace();
        const drawer = new Drawer({ host, title: 'Drawings' });
        const panel = host.querySelector<HTMLElement>('.vela-drawer')!;
        const grip = panel.querySelector<HTMLElement>('.vela-drawer-grab')!;
        const header = panel.querySelector<HTMLElement>('.vela-drawer-top')!;
        expect(grip.parentElement).toBe(panel);
        expect(grip.nextElementSibling).toBe(header);
        expect(grip.getAttribute('role')).toBe('separator');
        expect(header.hasAttribute('data-untitled')).toBe(false);
        expect(header.tabIndex).toBe(-1);
        expect(header.getAttribute('aria-label')).toBeNull();
        drawer.setTitle('');
        expect(header.hasAttribute('data-untitled')).toBe(true);
        drawer.setTitle('Drawings');
        expect(header.hasAttribute('data-untitled')).toBe(false);
        host.dataset.layout = 'desktop';
        window.dispatchEvent(new Event('resize'));
        expect(grip.parentElement).toBe(header);
        expect(header.tabIndex).toBe(0);
        expect(header.getAttribute('aria-label')).toBe('Move Drawings');
        host.dataset.layout = 'mobile';
        window.dispatchEvent(new Event('resize'));
        expect(grip.parentElement).toBe(panel);
        expect(grip.nextElementSibling).toBe(header);
        drawer.destroy();
    });
});
