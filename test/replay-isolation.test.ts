import { describe, it, expect } from 'vitest';
import { clampRangeToRevealed } from '../src/core/engine/EngineOrchestrator';

// A bar replay reveals history one bar at a time. The PRICE series is cut at the cursor,
// but every SECONDARY series (Compare, request.security, a lower-timeframe drawing feed)
// is fetched through the same gateway — and used to be served right up to "now", which is
// look-ahead for anything that computes over it. `clampRangeToRevealed` is that boundary.
describe('replay isolation · secondary series', () => {
    const CURSOR = 1_700_000_000_000;

    it('pulls an open-ended request back to the cursor', () => {
        expect(clampRangeToRevealed({ limit: 500 }, CURSOR)).toEqual({ limit: 500, to: CURSOR });
    });

    it('never lets a request reach past the cursor', () => {
        const future = CURSOR + 86_400_000;
        expect(clampRangeToRevealed({ from: CURSOR - 3_600_000, to: future }, CURSOR).to).toBe(CURSOR);
    });

    it('leaves a window that already ends before the cursor untouched', () => {
        const range = { from: CURSOR - 7_200_000, to: CURSOR - 3_600_000 };
        expect(clampRangeToRevealed(range, CURSOR)).toEqual(range);
    });

    it('collapses an entirely-future window instead of inverting it', () => {
        const out = clampRangeToRevealed({ from: CURSOR + 60_000, to: CURSOR + 120_000 }, CURSOR);
        expect(out.to).toBe(CURSOR);
        expect(out.from).toBe(CURSOR); // from === to ⇒ an empty window, never from > to
    });

    it('keeps a limit-only request bounded by limit, not by an invented range', () => {
        const out = clampRangeToRevealed<{ from?: number; to?: number; limit?: number }>({ limit: 120 }, CURSOR);
        expect(out.from).toBeUndefined();
        expect(out.limit).toBe(120);
        expect(out.to).toBe(CURSOR);
    });
});
