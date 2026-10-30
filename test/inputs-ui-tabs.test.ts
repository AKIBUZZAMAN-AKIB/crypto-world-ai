import { describe, it, expect } from 'vitest';
import { tabInputs, DEFAULT_INPUT_TAB, INPUT_DIALOG_GAP_PX, inputDialogBodyStyle, indicatorStyleInputs, indicatorVisibilityInputs } from '../src/renderers/shared/InputsUI';
import type { InputSchema } from '../src/core/model/inputs';

/** A minimal InputSchema with the fields `tabInputs` reads. */
function input(key: string, tab?: string): InputSchema {
    return { key, title: key, type: 'int', defval: 1, ...(tab !== undefined ? { tab } : {}) };
}

describe('tabInputs — settings-dialog tab partition', () => {
    it('puts every input on the default "Inputs" tab when none declares a tab', () => {
        const tabs = tabInputs([input('a'), input('b')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.name).toBe(DEFAULT_INPUT_TAB);
        expect(tabs[0]!.inputs.map((i) => i.key)).toEqual(['a', 'b']);
    });

    it('leads with the default tab and follows with declared tabs in first-seen order', () => {
        const tabs = tabInputs([
            input('s1', 'Style'),
            input('a'),
            input('v1', 'Visibility'),
            input('s2', 'Style'),
        ]);
        expect(tabs.map((t) => t.name)).toEqual([DEFAULT_INPUT_TAB, 'Style', 'Visibility']);
        expect(tabs[1]!.inputs.map((i) => i.key)).toEqual(['s1', 's2']);
    });

    it('merges an explicit tab="Inputs" with the default tab', () => {
        const tabs = tabInputs([input('a', 'Inputs'), input('b')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.inputs.map((i) => i.key)).toEqual(['a', 'b']);
    });

    it('treats an empty tab name as unset (default tab)', () => {
        const tabs = tabInputs([input('a', '')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.name).toBe(DEFAULT_INPUT_TAB);
    });

    it('omits the default tab entirely when every input declares another tab', () => {
        const tabs = tabInputs([input('s1', 'Style'), input('s2', 'Style')]);
        expect(tabs.map((t) => t.name)).toEqual(['Style']);
    });
});

describe('generated indicator Style and Visibility controls', () => {
    it('provides plot display, color, width and line-style controls, but not a fixed color for dynamic-color plots', () => {
        const schemas = indicatorStyleInputs([
            { id: 'ma', title: 'Moving average', paneId: 'price', kind: 'line', points: [{ time: 1, value: 2 }], style: { color: '#ff0000', width: 2, lineStyle: 'solid' } },
            { id: 'constant', title: 'Constant-color plot', paneId: 'price', kind: 'line', points: [{ time: 1, value: 2, color: '#00ff00' }, { time: 2, value: 3, color: '#00ff00' }], style: { color: '#00ff00', width: 1, lineStyle: 'solid' } },
            { id: 'dynamic', title: 'Dynamic plot', paneId: 'price', kind: 'line', points: [{ time: 1, value: 2, color: '#00ff00' }, { time: 2, value: 3, color: '#ff0000' }], style: { color: '#ff0000', width: 1, lineStyle: 'solid' } },
            { id: 'locked', title: 'Locked plot', paneId: 'price', kind: 'line', points: [{ time: 1, value: 2 }], style: { color: '#ffffff', width: 1, lineStyle: 'solid' }, editable: false },
        ]);
        expect(schemas.map((schema) => schema.key)).toContain('visual:labelsOnScale');
        expect(schemas.map((schema) => schema.key)).toContain('visual:valuesInStatusLine');
        expect(schemas.some((schema) => schema.key === 'plot:ma:color')).toBe(true);
        expect(schemas.some((schema) => schema.key === 'plot:constant:color')).toBe(true);
        expect(schemas.some((schema) => schema.key === 'plot:dynamic:color')).toBe(false);
        expect(schemas.some((schema) => schema.key.startsWith('plot:locked:'))).toBe(false);
        expect(schemas.some((schema) => schema.key === 'plot:ma:width')).toBe(true);
        expect(schemas.find((schema) => schema.key === 'plot:ma:plotStyle')?.options).toEqual(['line', 'step', 'area', 'histogram', 'columns', 'circles', 'cross']);
    });

    it('provides the standard interval-family visibility set and leaves drawing-only plots without fake Style controls', () => {
        expect(indicatorStyleInputs([])).toEqual([]);
        expect(indicatorVisibilityInputs().map((schema) => schema.title)).toEqual(['Ticks', 'Seconds', 'Minutes', 'Hours', 'Days', 'Weeks', 'Months']);
    });
});

describe('inputDialogBodyStyle — settings-dialog row rhythm', () => {
    it('packs rows at the start so a flex-grown mobile body keeps the 16px gap', () => {
        const style = inputDialogBodyStyle(true);
        expect(style).toContain('align-content:start');
        expect(style).toContain(`row-gap:${INPUT_DIALOG_GAP_PX}px`);
        expect(style).toContain('flex:1 1 auto');
        expect(style).toContain('grid-template-columns:minmax(0,1fr) auto');
    });

    it('uses the same packed rhythm on desktop (content-sized card, same 16px gap)', () => {
        const style = inputDialogBodyStyle(false);
        expect(style).toContain('align-content:start');
        expect(style).toContain(`row-gap:${INPUT_DIALOG_GAP_PX}px`);
        expect(style).toContain('grid-template-columns:max-content 1fr');
    });
});
