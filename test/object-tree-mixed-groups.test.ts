import { describe, expect, it } from 'vitest';
import {
    assignIndicatorsToGroup, assignToGroup, groupDrawingIds, groupIndicatorIds,
    indicatorGroupOf, pruneGroups, removeFromGroups, removeIndicatorsFromGroups,
    setGroupParent, liftGroup, paneTokens, type DrawGroup, type TreePane,
} from '../src/widget/object-tree-model';

const group = (id: string, members: string[] = [], indicatorIds: string[] = [], parentId?: string): DrawGroup => ({
    id, name: id, ids: members, indicators: indicatorIds, ...(parentId ? { parent: parentId } : {}),
});

describe('indicator and drawing groups', () => {
    it('preserves live indicator members through drawing-only prune and movement helpers', () => {
        let groups = [group('parent'), group('mixed', ['drawing'], ['rsi'], 'parent'), group('other', ['other'])];
        groups = pruneGroups(groups, new Set(['drawing', 'other']));
        expect(groupIndicatorIds(groups, 'parent')).toEqual(['rsi']);
        groups = assignToGroup(groups, 'other', ['drawing']);
        expect(groupIndicatorIds(groups, 'parent')).toEqual(['rsi']);
        expect(groupDrawingIds(groups, 'other').sort()).toEqual(['drawing', 'other']);
        groups = removeFromGroups(groups, ['other']);
        expect(groupIndicatorIds(groups, 'parent')).toEqual(['rsi']);
    });

    it('only removes a study when the caller explicitly reports it missing', () => {
        const initial = [group('one', ['drawing'], ['rsi', 'sma'])];
        expect(pruneGroups(initial, new Set(['drawing']))[0]!.indicators).toEqual(['rsi', 'sma']);
        expect(pruneGroups(initial, new Set(['drawing']), new Set(['sma']))[0]!.indicators).toEqual(['sma']);
    });

    it('moves indicator membership without disturbing drawings, and dissolves empty ancestors', () => {
        let groups = [group('parent'), group('child', ['d'], ['a', 'b'], 'parent'), group('target', ['x'])];
        groups = assignIndicatorsToGroup(groups, 'target', ['a']);
        expect(indicatorGroupOf(groups, 'a')?.id).toBe('target');
        expect(groupDrawingIds(groups, 'parent')).toEqual(['d']);
        expect(groupIndicatorIds(groups, 'parent')).toEqual(['b']);
        groups = removeFromGroups(groups, ['d']);
        groups = removeIndicatorsFromGroups(groups, ['b']);
        expect(groups.map((g) => g.id)).toEqual(['target']);
    });

    it('includes every nested drawing in the physical z-stack', () => {
        const drawing = (id: string, zIndex: number) => ({ id, zIndex }) as never;
        const root = group('root', ['a']);
        const child = group('child', ['b'], [], 'root');
        const pane = { items: [{ kind: 'unit', unit: { kind: 'group', group: root, members: [drawing('a', 2)], children: [
            { kind: 'group', group: child, members: [drawing('b', 4)], children: [] },
        ] } }] } as unknown as TreePane;
        expect(paneTokens(pane)).toEqual([{ kind: 'drawing', id: 'b' }, { kind: 'drawing', id: 'a' }]);
    });

    it('ungroups nested mixed folders without losing either kind or their parent', () => {
        let groups = [group('parent', ['p']), group('child', ['d'], ['rsi'], 'parent'), group('nested', ['n'], ['sma'], 'child')];
        groups = liftGroup(groups, 'child');
        expect(groups.find((g) => g.id === 'nested')?.parent).toBe('parent');
        expect(groupDrawingIds(groups, 'parent').sort()).toEqual(['n', 'p']);
        expect(groupIndicatorIds(groups, 'parent')).toEqual(['sma']); // direct child members become loose
        expect(setGroupParent(groups, 'parent', 'nested')).toEqual(groups); // no cycle
    });
});
