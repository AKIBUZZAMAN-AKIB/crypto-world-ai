// NESTED groups in the object tree (src/widget/object-tree-model.ts) — TradingView parity:
// a group can hold groups, any depth; the tree renders the branch in place; deleting or
// emptying a parent takes the branch with it; a group only ever lives under one parent.
import { describe, it, expect } from 'vitest';
import {
    childGroups,
    drawingUnits,
    groupById,
    groupDepth,
    groupDrawingIds,
    groupOf,
    groupWithin,
    liftGroup,
    pruneGroups,
    setGroupParent,
    subtreeGroupIds,
    assignToGroup,
    type DrawGroup,
} from '../src/widget/object-tree-model';
import type { SerializedDrawing } from '../src/core/drawings/Drawing';

function draw(id: string, zIndex: number): SerializedDrawing {
    return { id, type: 'trend-line', paneId: 'price', zIndex, visible: true, locked: false, points: [] } as unknown as SerializedDrawing;
}

const g = (id: string, ids: string[], parent?: string): DrawGroup => ({ id, name: id, ids, ...(parent === undefined ? {} : { parent }) });

describe('group nesting (model)', () => {
    it('reads children, depth and the whole branch', () => {
        const groups = [g('a', ['d1']), g('b', ['d2'], 'a'), g('c', ['d3'], 'b')];
        expect(childGroups(groups, 'a').map((x) => x.id)).toEqual(['b']);
        expect(childGroups(groups, undefined).map((x) => x.id)).toEqual(['a']);
        expect(groupDepth(groups, 'c')).toBe(2);
        expect(subtreeGroupIds(groups, 'a')).toEqual(['a', 'b', 'c']);
        expect(groupDrawingIds(groups, 'a')).toEqual(['d1', 'd2', 'd3']);
        expect(groupDrawingIds(groups, 'b')).toEqual(['d2', 'd3']);
    });

    it('refuses to nest a group inside itself or its own subtree', () => {
        const groups = [g('a', ['d1']), g('b', ['d2'], 'a')];
        expect(groupWithin(groups, 'b', 'a')).toBe(true);
        expect(groupWithin(groups, 'a', 'b')).toBe(false);
        expect(setGroupParent(groups, 'a', 'b')).toEqual(groups); // a → its own child: no-op
        expect(setGroupParent(groups, 'a', 'a')).toEqual(groups);
    });

    it('moves a group under another one, and back out', () => {
        const groups = [g('a', ['d1']), g('b', ['d2'])];
        const nested = setGroupParent(groups, 'b', 'a');
        expect(groupById(nested, 'b')?.parent).toBe('a');
        expect(childGroups(nested, 'a').map((x) => x.id)).toEqual(['b']);
        const out = setGroupParent(nested, 'b', null);
        expect(groupById(out, 'b')?.parent).toBeUndefined();
    });

    it('lifting a parent moves its children up a level, keeping them whole', () => {
        const groups = [g('root', ['d1']), g('mid', ['d2'], 'root'), g('leaf', ['d3'], 'mid')];
        const lifted = liftGroup(groups, 'mid');
        expect(lifted.map((x) => x.id)).toEqual(['root', 'leaf']);
        expect(groupById(lifted, 'leaf')?.parent).toBe('root');
        expect(groupById(lifted, 'root')?.ids).toEqual(['d1']);
    });

    it('a parent left with nothing disappears, and a dangling parent reads as top level', () => {
        const groups = [g('a', ['d1']), g('b', [], 'a')];
        expect(pruneGroups(groups, new Set(['d1'])).map((x) => x.id)).toEqual(['a']);
        const orphan = [g('a', ['d1'], 'gone')];
        expect(groupById(pruneGroups(orphan, new Set(['d1'])), 'a')?.parent).toBeUndefined();
    });

    it('keeps a group that only holds a nested group', () => {
        const groups = [g('outer', []), g('inner', ['d1'], 'outer')];
        expect(pruneGroups(groups, new Set(['d1'])).map((x) => x.id)).toEqual(['outer', 'inner']);
    });
});

describe('drawingUnits with nesting', () => {
    it('emits one branch at the outermost group, nested children inside it', () => {
        const draws = [draw('d1', 1), draw('d2', 2), draw('d3', 3), draw('loose', 4)];
        const groups = [g('outer', []), g('inner', ['d1', 'd2'], 'outer'), g('other', ['d3'])];
        const units = drawingUnits(draws.slice().reverse(), groups); // front-first
        expect(units.map((u) => (u.kind === 'group' ? u.group.id : u.drawing.id))).toEqual(['loose', 'other', 'outer']);
        const outer = units.find((u) => u.kind === 'group' && u.group.id === 'outer');
        if (outer?.kind !== 'group') throw new Error('missing outer');
        expect(outer.members).toEqual([]);
        expect(outer.children.map((c) => (c.kind === 'group' ? c.group.id : ''))).toEqual(['inner']);
        const inner = outer.children[0];
        if (inner?.kind !== 'group') throw new Error('missing inner');
        expect(inner.members.map((m) => m.id)).toEqual(['d2', 'd1']);
    });

    it('a group whose members live in another pane leaves no empty block', () => {
        const draws = [draw('d1', 1)];
        const groups = [g('a', ['elsewhere'])];
        const units = drawingUnits(draws, groups);
        expect(units.map((u) => u.kind)).toEqual(['draw']);
    });
});

describe('group membership stays exclusive', () => {
    it('assignToGroup moves a drawing out of its old group, nested or not', () => {
        const groups = [g('a', ['d1']), g('b', [], 'a')];
        const moved = assignToGroup(groups, 'b', ['d1']);
        expect(groupOf(moved, 'd1')?.id).toBe('b');
        expect(groupById(moved, 'a')).toBeNull();
    });
});
