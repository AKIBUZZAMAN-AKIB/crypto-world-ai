// @vitest-environment jsdom
// The palette's matcher, on its own. It is the only part of the command palette that is
// pure logic (the rest is DOM + focus), and it is the part most likely to regress
// silently — a matcher that ranks "Delete alert" above "Layout 2 × 2" when you typed
// "lay" makes the whole surface feel broken without throwing a single error.
import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../src/widget/command-palette';

const score = (q: string, t: string): number => fuzzyMatch(q, t)?.score ?? Number.NEGATIVE_INFINITY;

describe('fuzzyMatch', () => {
    it('returns every hit in order, and null when a character is missing', () => {
        expect(fuzzyMatch('lay', 'Layout 2×2')?.indices).toEqual([0, 1, 2]);
        expect(fuzzyMatch('x', 'Layout')).toBeNull();
        // Order matters: 'yl' cannot match "Layout" (the y comes after the l's in the
        // match position only if taken in order — the l is index 2, the y index 1).
        expect(fuzzyMatch('yl', 'Layout')).toBeNull();
    });

    it('treats an empty (or whitespace) query as "everything", at score 0', () => {
        expect(fuzzyMatch('', 'Anything')).toEqual({ score: 0, indices: [] });
        expect(fuzzyMatch('   ', 'Anything')).toEqual({ score: 0, indices: [] });
    });

    it('ignores spaces in the query, so "tl" finds "Toggle layout"', () => {
        const hit = fuzzyMatch('t l', 'Toggle layout');
        expect(hit?.indices).toHaveLength(2);
        expect(hit?.indices[0]).toBe(0);
    });

    it('ranks a prefix above a scattered match', () => {
        expect(score('undo', 'Undo')).toBeGreaterThan(score('undo', 'Redo the undo step'));
    });

    it('rewards word starts over mid-word letters', () => {
        // A letter that opens a word outranks the same letter buried inside one.
        expect(score('l', 'Big layout')).toBeGreaterThan(score('l', 'Alpha'));
        // And a contiguous run beats two separated hits of the same length.
        expect(score('al', 'Alert')).toBeGreaterThan(score('al', 'a l'));
    });

    it('prefers the shorter label when everything else is equal', () => {
        expect(score('alert', 'Alerts')).toBeGreaterThan(score('alert', 'Alerts for every chart in the grid'));
    });

    it('is case-insensitive and space-tolerant on the label side', () => {
        expect(fuzzyMatch('ZOOM', 'Zoom out')).not.toBeNull();
        expect(fuzzyMatch('zoom', 'ZOOM OUT')).not.toBeNull();
    });

    it('never returns indices outside the label', () => {
        const hit = fuzzyMatch('screenshot', 'Take a screenshot');
        expect(hit).not.toBeNull();
        for (const i of hit!.indices) expect(i).toBeGreaterThanOrEqual(0);
        for (const i of hit!.indices) expect(i).toBeLessThan('Take a screenshot'.length);
    });
});
