// @vitest-environment jsdom
// R86 Task 3 — the active indicator list shows a SCREEN-MEASURED number of rows; the rest
// scrolls instead of folding every row away, and the down/up control stays minimal.
import { describe, it, expect, afterEach } from 'vitest';
import { InputsUI } from '../src/renderers/shared/InputsUI';
import { DARK_THEME } from '../src/core/theme';

let ui: InputsUI | null = null;
afterEach(() => {
    ui?.destroy();
    ui = null;
    document.body.replaceChildren();
});

function setup(height: number) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pane = { height };
    ui = new InputsUI(container, DARK_THEME, () => ({ top: 0, height: pane.height, rightAxis: 0 }));
    for (let i = 1; i <= 5; i += 1) ui!.upsert(`ind-${i}`, `Study ${i}`, [], {});
    const legend = container.querySelector<HTMLElement>('[data-vela-pane="price"]')!;
    const rows = [...legend.children].filter((el) => !(el as HTMLElement).classList.contains('vela-ind-fold')) as HTMLElement[];
    // jsdom has no layout: give every row the measured height a real browser would report.
    for (const row of rows) Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 28 });
    ui!.reposition();
    return { pane, legend, rows };
}

describe('indicator legend · measured rows', () => {
    it('shows the number of whole rows the pane can hold and scrolls the overflow', () => {
        const { legend, rows } = setup(100);
        expect(ui!.visibleRowCount('price')).toBe(2);
        expect(legend.dataset.visibleRows).toBe('2');
        expect(legend.dataset.scrolls).toBe('1');
        expect(legend.style.maxHeight).toBe('56px');
        expect(legend.style.overflowY).toBe('auto');
        expect(rows).toHaveLength(5);
        expect(rows.every((r) => r.style.display !== 'none')).toBe(true);
        const fold = legend.querySelector<HTMLElement>('.vela-ind-fold')!;
        expect(fold.style.border).toBe('0px');
        expect(fold.style.minHeight).toBe('22px');
        expect(fold.style.position).toBe('sticky');
    });

    it('re-measures when the pane grows, without hiding rows', () => {
        const { pane, legend } = setup(100);
        pane.height = 130;
        ui!.reposition();
        expect(ui!.visibleRowCount('price')).toBe(3);
        expect(legend.dataset.visibleRows).toBe('3');
        expect(legend.style.maxHeight).toBe('84px');
        expect(legend.dataset.scrolls).toBe('1');
    });

    it('keeps every row visible when the pane grows tall enough', () => {
        const { pane, legend } = setup(100);
        pane.height = 400;
        ui!.reposition();
        expect(ui!.visibleRowCount('price')).toBe(5);
        expect(legend.dataset.scrolls).toBe('0');
        expect(legend.style.overflowY).toBe('');
    });
});
