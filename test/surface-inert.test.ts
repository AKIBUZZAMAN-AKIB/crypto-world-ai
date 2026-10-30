// @vitest-environment jsdom
// The page behind a modal must be unreachable, not merely dimmed. `inert` is the
// platform's answer; these specs pin the three rules the manager promises: isolate the
// siblings of the surface's isolation root, restore exactly what it added, and never
// touch non-modal surfaces (a menu owns no isolation).
import { describe, it, expect, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { announceSurface } from '../src/ui/surface-events';
import { isolationPath, releaseSurfaceInert } from '../src/ui/surface-inert';

afterEach(() => {
    releaseSurfaceInert(document);
    document.body.replaceChildren();
});

/** A page: <main> the chart lives in, plus the sheet host beside it. */
function page(): { main: HTMLElement; host: HTMLElement; panel: HTMLElement } {
    const main = document.createElement('main');
    main.id = 'page';
    const host = document.createElement('div');
    host.className = 'vela-ui';
    const panel = document.createElement('div');
    panel.className = 'vela-drawer';
    host.appendChild(panel);
    document.body.append(main, host);
    return { main, host, panel };
}

describe('surface inert', () => {
    it('a drawer makes the page behind it inert, and closing restores it', () => {
        const { main, panel } = page();
        announceSurface(panel, true, 'drawer');
        expect(main.hasAttribute('inert')).toBe(true);
        // the surface’s own host is NOT inert — it holds the sheet
        expect(panel.hasAttribute('inert')).toBe(false);
        announceSurface(panel, false, 'drawer');
        expect(main.hasAttribute('inert')).toBe(false);
    });

    it('the whole page around the surface’s ancestor path is isolated', () => {
        const { host, panel } = page();
        // The path climbs host → panel; the isolated set is every element outside it, at
        // every level — so a sheet nested in a wrapper still takes the page away.
        expect(isolationPath(panel)).toEqual([host, panel]);
        announceSurface(panel, true, 'dialog');
        expect(document.querySelector('#page')!.hasAttribute('inert')).toBe(true);
    });

    it('stacked surfaces re-isolate the one beneath when the top closes', () => {
        const { main, host } = page();
        const sheet = document.createElement('div');
        const dialog = document.createElement('div');
        host.append(sheet);
        document.body.append(dialog);
        announceSurface(sheet, true, 'drawer');
        expect(main.hasAttribute('inert')).toBe(true);
        announceSurface(dialog, true, 'dialog');
        // the sheet's host is now behind the dialog, so it is isolated too
        expect(host.hasAttribute('inert')).toBe(true);
        announceSurface(dialog, false, 'dialog');
        expect(host.hasAttribute('inert')).toBe(false);
        expect(main.hasAttribute('inert')).toBe(true);
        announceSurface(sheet, false, 'drawer');
        expect(main.hasAttribute('inert')).toBe(false);
    });

    it('never touches an `inert` the host set itself', () => {
        const { main, host, panel } = page();
        main.setAttribute('inert', '');
        announceSurface(panel, true, 'drawer');
        announceSurface(panel, false, 'drawer');
        expect(main.getAttribute('inert')).toBe(''); // still the host's, still inert
    });

    it('an explicitly non-modal dialog leaves the chart interactive', () => {
        const { main, panel } = page();
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        announceSurface(panel, true, 'dialog');
        expect(main.hasAttribute('inert')).toBe(false);
        announceSurface(panel, false, 'dialog');
        expect(main.hasAttribute('inert')).toBe(false);
    });

    it('a menu owns no isolation (it is non-modal by design)', () => {
        const { main, host } = page();
        const menu = document.createElement('div');
        host.appendChild(menu);
        announceSurface(menu, true, 'menu');
        expect(main.hasAttribute('inert')).toBe(false);
    });
});
