// Tier-3 #14 — the two prerequisites an Image / Table object was blocked on: a bounded
// asset store, and a font-free text layout for table cells.
import { describe, expect, it } from 'vitest';
import { AssetStore, DEFAULT_ASSET_LIMITS } from '../src/core/assets/store';
import { DEFAULT_TABLE, measureTable, tableBorders, wrapText, type TableSpec } from '../src/core/model/table';

/** A tiny valid data URL (PNG magic + a few bytes is enough — the store never decodes). */
const png = (filler = 'AAAA') => `data:image/png;base64,iVBORw0KGgo${filler}`;

describe('assets/store', () => {
    it('keeps an image and reports its size', () => {
        const s = new AssetStore();
        const r = s.put(png(), { width: 100, height: 60 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.asset.mime).toBe('image/png');
        expect(r.asset.width).toBe(100);
        expect(s.totalBytes()).toBe(r.asset.bytes);
        expect(s.get(r.asset.id)?.dataUrl).toBe(png());
    });

    it('dedupes the same bytes (content-addressed)', () => {
        const s = new AssetStore();
        const a = s.put(png(), { width: 10, height: 10 });
        const b = s.put(png(), { width: 10, height: 10 });
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(b.deduped).toBe(true);
        expect(b.asset.id).toBe(a.asset.id);
        expect(s.list()).toHaveLength(1);
    });

    it('refuses a non-image, a malformed URL, and an absurd edge', () => {
        const s = new AssetStore();
        expect(s.put('data:text/plain;base64,aGk=', { width: 1, height: 1 })).toEqual({ ok: false, reason: 'mime' });
        expect(s.put('https://example.com/a.png', { width: 1, height: 1 })).toEqual({ ok: false, reason: 'malformed' });
        expect(s.put(png(), { width: DEFAULT_ASSET_LIMITS.maxEdge + 1, height: 10 })).toEqual({ ok: false, reason: 'shape' });
        expect(s.put(png(), { width: 0, height: 0 })).toEqual({ ok: false, reason: 'shape' });
    });

    it('enforces the per-document budget instead of discovering it at save time', () => {
        const s = new AssetStore({ maxAssetBytes: 64, maxTotalBytes: 20 });
        const big = `data:image/png;base64,${'A'.repeat(200)}`;
        expect(s.put(big, { width: 10, height: 10 })).toEqual({ ok: false, reason: 'size' });
        // each payload is 20 base64 chars → 15 decoded bytes; a 20-byte budget holds ONE
        expect(s.put(png('AAAAAAAA'), { width: 10, height: 10 }).ok).toBe(true);
        expect(s.put(png('BBBBBBBB'), { width: 10, height: 10 })).toEqual({ ok: false, reason: 'budget' });
    });

    it('round-trips through JSON and re-applies the caps on read', () => {
        const s = new AssetStore();
        s.put(png(), { width: 20, height: 20 });
        const copy = AssetStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
        expect(copy.list()).toHaveLength(1);
        expect(copy.list()[0]!.width).toBe(20);
    });

    it('ignores a hostile record rather than throwing', () => {
        expect(AssetStore.fromJSON(null).list()).toHaveLength(0);
        expect(AssetStore.fromJSON({ assets: [{ dataUrl: 'nope' }] }).list()).toHaveLength(0);
    });
});

describe('table/wrap', () => {
    it('wraps on words and never exceeds the budget', () => {
        const lines = wrapText('the quick brown fox jumps', 10);
        expect(lines.every((l) => l.length <= 10)).toBe(true);
        expect(lines.join(' ')).toBe('the quick brown fox jumps');
    });

    it('breaks a word that cannot fit', () => {
        expect(wrapText('supercalifragilistic', 6)).toEqual(['superc', 'alifra', 'gilist', 'ic']);
    });

    it('honours an explicit newline and empty text', () => {
        expect(wrapText('a\nb', 10)).toEqual(['a', 'b']);
        expect(wrapText('', 10)).toEqual(['']);
    });
});

describe('table/measure', () => {
    const base: TableSpec = { ...DEFAULT_TABLE, rows: [['Sym', 'Px'], ['BTCUSDT', '81,200.00']], cols: [null, null], maxWidth: 400 };

    it('sizes columns to their content, then the table to the sum', () => {
        const t = measureTable(base);
        expect(t.colWidths).toHaveLength(2);
        expect(t.width).toBe(t.colWidths.reduce((a, b) => a + b, 0));
        expect(t.height).toBe(t.rowHeights.reduce((a, b) => a + b, 0));
    });

    it('a wider cell makes a taller row (wrapping), not a wider table', () => {
        const tall = measureTable({ ...base, maxWidth: 90, cols: [null, null] });
        expect(tall.width).toBeLessThanOrEqual(90 + 8);
        expect(tall.rowHeights[1]!).toBeGreaterThan(measureTable(base).rowHeights[1]!);
    });

    it('declared widths are respected', () => {
        const t = measureTable({ ...base, cols: [60, 100] });
        expect(t.colWidths[0]).toBeGreaterThanOrEqual(60);
        expect(t.colX[1]).toBe(t.colWidths[0]);
    });

    it('offsets tile the table exactly', () => {
        const t = measureTable(base);
        expect(t.colX[0]).toBe(0);
        expect(t.rowY[0]).toBe(0);
        expect(t.colX[1]! + t.colWidths[1]!).toBe(t.width);
        expect(t.rowY[1]! + t.rowHeights[1]!).toBe(t.height);
    });

    it('is deterministic', () => {
        expect(measureTable(base)).toEqual(measureTable(base));
    });

    it('fills in the border defaults', () => {
        expect(tableBorders({ ...base, border: { innerV: false } }).innerV).toBe(false);
        expect(tableBorders(base).top).toBe(true);
    });
});
