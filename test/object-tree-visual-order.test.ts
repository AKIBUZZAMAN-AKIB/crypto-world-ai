// Visual Order is one shared front-first stack. The menu commands must move candles,
// indicators, drawings and whole groups through that stack — not merely mutate a z number
// that the object tree fails to repaint.
import { describe, expect, it } from 'vitest';
import { reorderTokens, stackWrites, type StackToken, type VisualOrderMove } from '../src/widget/object-tree-model';

const price: StackToken = { kind: 'price' };
const ind = (id: string): StackToken => ({ kind: 'indicator', id });
const dw = (id: string): StackToken => ({ kind: 'drawing', id });
const names = (tokens: readonly StackToken[]): string[] => tokens.map((t) => (t.kind === 'price' ? 'price' : t.id));
const move = (tokens: readonly StackToken[], dragged: readonly StackToken[], op: VisualOrderMove): string[] =>
    names(reorderTokens(tokens, dragged, op));

describe('Visual Order commands', () => {
    // Front-most first: price, SMA, red rectangle, blue rectangle.
    const stack: StackToken[] = [price, ind('sma'), dw('red'), dw('blue')];

    it('brings a candle or indicator to the front and repaints its row at the top', () => {
        expect(move(stack, [price], 'front')).toEqual(['price', 'sma', 'red', 'blue']);
        expect(move(stack, [ind('sma')], 'front')).toEqual(['sma', 'price', 'red', 'blue']);
    });

    it('sends a candle or indicator to the back and repaints its row at the bottom', () => {
        expect(move(stack, [price], 'back')).toEqual(['sma', 'red', 'blue', 'price']);
        expect(move(stack, [ind('sma')], 'back')).toEqual(['price', 'red', 'blue', 'sma']);
    });

    it('moves a drawing one level forward or backward', () => {
        expect(move(stack, [dw('blue')], 'forward')).toEqual(['price', 'sma', 'blue', 'red']);
        expect(move(stack, [dw('red')], 'backward')).toEqual(['price', 'sma', 'blue', 'red']);
    });

    it('moves a group as one contiguous run with its internal order intact', () => {
        const group = [dw('red'), dw('blue')];
        expect(move(stack, group, 'front')).toEqual(['red', 'blue', 'price', 'sma']);
        expect(move(stack, group, 'back')).toEqual(['price', 'sma', 'red', 'blue']);
        // One level means swapping the run with the adjacent SMA, not jumping to an edge.
        expect(move(stack, group, 'forward')).toEqual(['price', 'red', 'blue', 'sma']);
        // The run already occupies the back edge, so backward is a no-op.
        expect(move(stack, group, 'backward')).toEqual(['price', 'sma', 'red', 'blue']);
    });

    it('ignores duplicate and foreign-pane picks instead of creating ghost layers', () => {
        expect(move(stack, [dw('blue'), dw('blue'), dw('other')], 'front')).toEqual(['blue', 'price', 'sma', 'red']);
        expect(move(stack, [dw('other')], 'front')).toEqual(names(stack));
    });
});

describe('stackWrites after a reorder', () => {
    it('writes one tie-free shared z space on an interleaving renderer', () => {
        const writes = stackWrites([dw('blue'), ind('sma'), price, dw('red')], true);
        expect(writes.candleZ).toBe(2);
        expect(writes.series).toEqual([{ id: 'sma', z: 3 }]);
        expect(writes.drawings).toEqual([
            { id: 'blue', z: 4 },
            { id: 'red', z: 1 },
        ]);
    });

    it('keeps drawings and series independently ordered on a renderer without shared depth', () => {
        const writes = stackWrites([dw('blue'), dw('red'), price, ind('sma')], false);
        expect(writes.drawings).toEqual([
            { id: 'blue', z: 2 },
            { id: 'red', z: 1 },
        ]);
        expect(writes.candleZ).toBe(2);
        expect(writes.series).toEqual([{ id: 'sma', z: 1 }]);
    });
});
