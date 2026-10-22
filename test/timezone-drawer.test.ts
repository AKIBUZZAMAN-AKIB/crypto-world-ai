// @vitest-environment jsdom
// Round 16 — the timezone sheet became searchable: 50+ zones is a long flick on a phone,
// and "dhaka" is four taps. This pins the filter (accent/case folded), the empty state and
// Enter-to-pick, because a list that LOOKS filtered but is not (a class rule beating the
// UA's [hidden] rule) is exactly the kind of bug a screenshot catches and a property
// assertion does not — so the assertions here read computed visibility, not `el.hidden`.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { TimezoneDrawer } from '../src/widget/timezone-drawer';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

function mount(): { host: HTMLElement; onTimezone: ReturnType<typeof vi.fn>; drawer: TimezoneDrawer } {
    const host = document.createElement('div');
    document.body.append(host);
    const onTimezone = vi.fn();
    const drawer = new TimezoneDrawer({ host, timezone: () => 'Etc/UTC', onTimezone });
    drawer.open();
    return { host, onTimezone, drawer };
}

/** Rows the user can actually SEE: `hidden` must win over the row class's display. */
const visibleRows = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>('.vela-tzd-row')]
        .filter((r) => !r.hidden)
        .map((r) => (r.querySelector('.vela-tzd-row-label')?.textContent ?? '').trim());

function type(host: HTMLElement, text: string): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('.vela-tzd-search input')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
}

describe('the timezone sheet', () => {
    it('starts with the whole list and the live zone checked', () => {
        const { host, drawer } = mount();
        expect(visibleRows(host).length).toBeGreaterThan(20);
        expect(visibleRows(host)).toContain('UTC');
        expect(host.querySelectorAll('.vela-tzd-row .vela-icon').length).toBe(1);
        drawer.destroy();
    });

    it('filters as you type, folding case and accents', () => {
        const { host, drawer } = mount();
        type(host, 'DHAKA');
        expect(visibleRows(host)).toEqual(['(UTC+6) Dhaka']);
        type(host, 'bogota');
        expect(visibleRows(host)).toContain('(UTC-5) Bogotá');
        type(host, '');
        expect(visibleRows(host).length).toBeGreaterThan(20);
        drawer.destroy();
    });

    it('says so when nothing matches, instead of showing an empty card', () => {
        const { host, drawer } = mount();
        type(host, 'zzz');
        expect(visibleRows(host)).toEqual([]);
        const empty = host.querySelector<HTMLElement>('.vela-tzd-empty');
        expect(empty?.hidden).toBe(false);
        expect(empty?.textContent).toContain('zzz');
        drawer.destroy();
    });

    it('picks a row on tap, and the first match on Enter', () => {
        const { host, onTimezone, drawer } = mount();
        type(host, 'dhaka');
        [...host.querySelectorAll<HTMLElement>('.vela-tzd-row')].find((r) => !r.hidden)!.click();
        expect(onTimezone).toHaveBeenCalledWith('Asia/Dhaka');

        onTimezone.mockClear();
        const input = type(host, 'yangon');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onTimezone).toHaveBeenCalledWith('Asia/Yangon');
        drawer.destroy();
    });
});
