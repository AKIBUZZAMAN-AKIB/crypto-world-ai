// The status line's model (src/widget/statusline-model.ts): which segments each part
// gates — 'logo' owns the avatar, 'name' owns the symbol text AND the venue/timeframe
// meta — and the right-click menu's rows. Pure functions over plain objects, node env;
// the real overlay and menu are proven in the browser.
import { describe, it, expect } from 'vitest';
import { segmentVisibility, statuslineMenuItems, readoutCells, STATUSLINE_LADDER, type StatuslinePart } from '../src/widget/statusline-model';
import { fmtChangePct } from '../src/widget/format';

const allOn: Record<StatuslinePart, boolean> = { logo: true, name: true, market: true, ohlc: true, change: true };

describe('segmentVisibility', () => {
    it('everything on shows every segment (and keeps the eye stowed)', () => {
        expect(segmentVisibility(allOn)).toEqual({ avatar: true, symbol: true, meta: true, market: true, ohlc: true, change: true, eye: false });
    });

    it("'logo' gates only the avatar", () => {
        const seg = segmentVisibility({ ...allOn, logo: false });
        expect(seg.avatar).toBe(false);
        expect(seg.symbol).toBe(true);
        expect(seg.meta).toBe(true);
    });

    it("'name' hides the venue/timeframe meta along with the symbol text", () => {
        const seg = segmentVisibility({ ...allOn, name: false });
        expect(seg.symbol).toBe(false);
        expect(seg.meta).toBe(false);
        expect(seg.avatar).toBe(true); // the logo keeps its own toggle
    });

    it('the value parts stay independent', () => {
        const seg = segmentVisibility({ ...allOn, ohlc: false, change: false, market: false });
        expect(seg.ohlc).toBe(false);
        expect(seg.change).toBe(false);
        expect(seg.market).toBe(false);
        expect(seg.symbol).toBe(true);
    });

    it('a hidden chart drops the whole value readout and puts the eye out', () => {
        const seg = segmentVisibility(allOn, true);
        expect(seg.ohlc).toBe(false);
        expect(seg.change).toBe(false);
        expect(seg.eye).toBe(true);
        expect(seg.avatar).toBe(true);
        expect(seg.symbol).toBe(true);
        expect(seg.market).toBe(true);
    });

    it('showing the chart again restores the value parts as configured, and stows the eye', () => {
        const seg = segmentVisibility(allOn, false);
        expect(seg.ohlc).toBe(true);
        expect(seg.change).toBe(true);
        expect(seg.eye).toBe(false);
        expect(segmentVisibility({ ...allOn, ohlc: false }, false).ohlc).toBe(false);
    });
});

describe('STATUSLINE_LADDER', () => {
    it('never trades O/H/L away while the delta still has room to give', () => {
        // The phone bug this ladder answers: every rung below the widest one used to shed
        // the four values straight to the close. Ground is given up in this order — the
        // readout moves under the symbol line, the delta loses its absolute half, the
        // whole delta moves up to the symbol line — and only then do O/H/L go.
        const firstNarrow = STATUSLINE_LADDER.findIndex((r) => r.level !== 'full');
        expect(firstNarrow).toBeGreaterThan(0);
        for (const rung of STATUSLINE_LADDER.slice(0, firstNarrow)) {
            expect(readoutCells(rung.level, 'ohlc').map((c) => c.label)).toEqual(['O', 'H', 'L', 'C']);
        }
        // …and the shed only ever happens after BOTH delta rungs ran out of room.
        expect(STATUSLINE_LADDER.some((r) => r.level === 'full' && r.changeSlot === 'identity')).toBe(true);
        expect(STATUSLINE_LADDER.some((r) => r.level === 'full' && r.change === 'pct')).toBe(true);
    });

    it('starts one-line and ends with the close alone, widest first', () => {
        const first = STATUSLINE_LADDER[0];
        const last = STATUSLINE_LADDER[STATUSLINE_LADDER.length - 1]!;
        expect(first).toEqual({ stacked: false, level: 'full', change: 'both', changeSlot: 'values' });
        expect(last.stacked).toBe(true);
        expect(readoutCells(last.level, 'ohlc')).toEqual([{ key: 'close', label: '' }]);
        // Stacked rungs never come back to the one-line shape.
        const firstStacked = STATUSLINE_LADDER.findIndex((r) => r.stacked);
        expect(STATUSLINE_LADDER.slice(firstStacked).every((r) => r.stacked)).toBe(true);
    });

    it('the delta only ever rides the symbol line once the values row is full', () => {
        for (const rung of STATUSLINE_LADDER) {
            if (rung.changeSlot === 'identity') expect([rung.stacked, rung.level]).toEqual([true, 'full']);
        }
    });
});

describe('readoutCells', () => {
    it('bar-shaped styles read out all four values at the full level', () => {
        expect(readoutCells('full', 'ohlc').map((c) => c.label)).toEqual(['O', 'H', 'L', 'C']);
    });

    it('compact keeps the labeled close; minimal drops the label too', () => {
        expect(readoutCells('compact', 'ohlc')).toEqual([{ key: 'close', label: 'C' }]);
        expect(readoutCells('minimal', 'ohlc')).toEqual([{ key: 'close', label: '' }]);
    });

    it('one-line styles only ever read out the unlabeled close', () => {
        for (const level of ['full', 'compact', 'minimal'] as const) {
            expect(readoutCells(level, 'value')).toEqual([{ key: 'close', label: '' }]);
        }
    });
});

describe('fmtChangePct', () => {
    it('formats the signed percent delta alone', () => {
        expect(fmtChangePct(100, 101.5)).toBe('+1.50%');
        expect(fmtChangePct(100, 98)).toBe('-2.00%');
        expect(fmtChangePct(0, 98)).toBe('');
        expect(fmtChangePct(null, 98)).toBe('');
    });
});

describe('statuslineMenuItems', () => {
    it('offers one checkable toggle per part, checked after the current state', () => {
        const items = statuslineMenuItems({ ...allOn, logo: false, ohlc: false }, true);
        const byId = new Map(items.map((i) => [i.id, i]));
        expect(byId.get('part:logo')?.checked).toBe(false);
        expect(byId.get('part:name')?.checked).toBe(true);
        expect(byId.get('part:market')?.checked).toBe(true);
        expect(byId.get('part:ohlc')?.checked).toBe(false);
        expect(byId.get('part:change')?.checked).toBe(true);
    });

    it('ends with the chart toggle, worded after the current visibility and set apart', () => {
        const shownItems = statuslineMenuItems(allOn, true);
        expect(shownItems[shownItems.length - 1]).toMatchObject({ id: 'chart', label: 'Hide chart', separatorBefore: true });
        const hiddenItems = statuslineMenuItems(allOn, false);
        expect(hiddenItems[hiddenItems.length - 1]).toMatchObject({ id: 'chart', label: 'Show chart' });
    });
});
