import { describe, it, expect } from 'vitest';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { sliceKeyFor } from '../src/renderers/native/drawings/UserDrawingController';
import { createDrawing, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

/** A canvas context that counts `arc()` calls (each selection handle is one arc) and `lineTo()`
 *  ones (a painted line body — handles are arcs only). */
function recordingCtx() {
    let arcs = 0;
    let lines = 0;
    let texts = 0;
    const ctx = {
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {
            lines += 1;
        },
        arcTo() {},
        stroke() {},
        fill() {},
        setLineDash() {},
        arc() {
            arcs += 1;
        },
        fillRect() {},
        strokeRect() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        fillText() {
            texts += 1;
        },
        strokeText() {},
        measureText: () => ({ width: 0 }),
        rect() {},
        clip() {},
        ellipse() {},
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs: () => arcs, lines: () => lines, texts: () => texts };
}

const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
const hline = (id: string, price: number) => createDrawing('hline', { id, paneId: 'price', anchors: [{ time: 10, price }] })!;

describe('DrawingPainter.paintAll handle highlighting', () => {
    it('paints handles for every selected id', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, { selected: new Set(['a', 'b']) });
        expect(arcs()).toBe(2); // one handle per selected hline
    });

    it('paints handles for the hovered and dragged drawings too', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, { hovered: 'a', dragged: 'b' });
        expect(arcs()).toBe(2);
    });

    it('paints no handles when nothing is targeted', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme);
        expect(arcs()).toBe(0);
    });

    // Drawings interleaved into the series stack paint their bodies on the backend-composited
    // layers, but their handles have to come back to the top canvas — buried under the candles
    // they'd be unusable.
    it('paintHighlights draws handles alone, for the highlighted ones only', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs, lines } = recordingCtx();
        new DrawingPainter().paintHighlights(ctx, drawings, fakeProjector(), new Set(['b']));
        expect(arcs()).toBe(1); // b's handle …
        expect(lines()).toBe(0); // … and neither body
    });
});

describe('sliceKeyFor — which interleave layer a drawing paints on', () => {
    // Boundaries: an indicator at -2, the candles at 0, a raised indicator at 5.
    const bounds = [-2, 0, 5];

    it('a drawing over every boundary stays on the top canvas', () => {
        expect(sliceKeyFor(6, bounds)).toBeNull();
        expect(sliceKeyFor(9, [])).toBeNull();
    });

    it('slots a drawing under the first series at-or-above its z', () => {
        expect(sliceKeyFor(1, bounds)).toBe(5); // between the candles and the raised indicator
        expect(sliceKeyFor(-1, bounds)).toBe(0); // under the candles, over the back indicator
        expect(sliceKeyFor(-9, bounds)).toBe(-2); // under everything
    });

    it('a tie paints under the series carrying that z', () => {
        expect(sliceKeyFor(0, bounds)).toBe(0);
        expect(sliceKeyFor(5, bounds)).toBe(5);
    });
});

describe('DrawingPainter.paintAll muted label', () => {
    /** A ctx that records the strings passed to `fillText`. */
    function textCountingCtx() {
        const base = recordingCtx();
        const texts: string[] = [];
        (base.ctx as unknown as Record<string, unknown>).fillText = (s: string) => { texts.push(s); };
        return { ctx: base.ctx, texts: () => texts };
    }

    const label = (id: string) => createDrawing('text', { id, paneId: 'price', anchors: [{ time: 10, price: 50 }], text: { value: 'Buy zone', size: 'normal', hAlign: 'left', vAlign: 'top' } })!;

    it('paints a text label normally', () => {
        const { ctx, texts } = textCountingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme);
        expect(texts()).toEqual(['Buy zone']);
    });

    it('leaves the muted label to its inline editor (and only that one)', () => {
        const { ctx, texts } = textCountingCtx();
        new DrawingPainter().paintAll(ctx, [label('a'), label('b')], fakeProjector(), theme, { mutedLabel: 'a' });
        expect(texts()).toEqual(['Buy zone']); // 'b' still painted, 'a' muted
    });

    it('hides the muted label\u2019s drag handle too (typing, not dragging)', () => {
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme, { selected: new Set(['a']), mutedLabel: 'a' });
        expect(arcs()).toBe(0);
    });
});

describe('DrawingPainter.paintAll text label frame', () => {
    /** A ctx that records the stroke color of every `stroke()` (the frame is the only stroke here). */
    function strokeRecordingCtx() {
        const base = recordingCtx();
        const strokes: string[] = [];
        const ctx = base.ctx as unknown as Record<string, unknown>;
        ctx.strokeStyle = '';
        ctx.stroke = () => { strokes.push(String(ctx.strokeStyle)); };
        return { ctx: base.ctx, strokes: () => strokes };
    }

    const label = (id: string) => createDrawing('text', { id, paneId: 'price', anchors: [{ time: 10, price: 50 }], text: { value: 'Buy zone', size: 'normal', hAlign: 'left', vAlign: 'top' } })!;
    const frame = (targets: { selected?: ReadonlySet<string>; hovered?: string | null }): string[] => {
        const { ctx, strokes } = strokeRecordingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme, targets);
        // Targeting also paints the handle (a hex-colored border); the frame is the themed rgba stroke.
        return strokes().filter((s) => s.startsWith('rgba('));
    };

    it('frames a selected text label, and a hovered one more faintly', () => {
        const selected = frame({ selected: new Set(['a']) });
        const hovered = frame({ hovered: 'a' });
        expect(selected).toHaveLength(1);
        expect(hovered).toHaveLength(1);
        expect(selected[0]).toContain('0.3'); // firm once clicked
        expect(hovered[0]).toContain('0.12'); // a hint under the cursor
    });

    it('leaves an untargeted label unframed', () => {
        expect(frame({})).toEqual([]);
        expect(frame({ selected: new Set(['other']), hovered: 'other' })).toEqual([]);
    });
});

describe('DrawingPainter.paintAll pane separation', () => {
    /** fakeProjector + paneRect: 'price' is a live 100px pane; 'hidden' is zero-height. */
    function paneAwareProjector(): Projector {
        return {
            ...fakeProjector(),
            paneRect: (paneId) => (paneId === 'price' ? { top: 0, height: 100 } : paneId === 'hidden' ? { top: 100, height: 0 } : null),
        };
    }

    /** A ctx that additionally counts `clip()` and `stroke()` calls. */
    function clipCountingCtx() {
        const base = recordingCtx();
        let clips = 0;
        let strokes = 0;
        const ctx = base.ctx as unknown as Record<string, unknown>;
        ctx.clip = () => { clips += 1; };
        ctx.rect = () => {};
        const origStroke = ctx.stroke as () => void;
        ctx.stroke = () => { strokes += 1; origStroke(); };
        return { ctx: base.ctx, arcs: base.arcs, clips: () => clips, strokes: () => strokes };
    }

    it('clips each drawing to its pane rect', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, clips } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, drawings, paneAwareProjector(), theme);
        expect(clips()).toBe(2); // one clip per painted drawing
    });

    it('skips drawings on a hidden (zero-height) pane entirely — body and handles', () => {
        const onHidden = createDrawing('hline', { id: 'h', paneId: 'hidden', anchors: [{ time: 10, price: 30 }] })!;
        const { ctx, arcs, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, [onHidden], paneAwareProjector(), theme, { selected: new Set(['h']) });
        expect(strokes()).toBe(0); // nothing painted
        expect(arcs()).toBe(0); // no handles either
    });

    it('paints unclipped when the projector exposes no pane geometry (back-compat)', () => {
        const drawings = [hline('a', 30)];
        const { ctx, clips, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme);
        expect(clips()).toBe(0);
        expect(strokes()).toBeGreaterThan(0);
    });
});

describe('DrawingPainter trendline label follows the line', () => {
    it('rotates the label to the upright segment angle', () => {
        const d = createDrawing('trendline', {
            id: 't',
            paneId: 'price',
            anchors: [
                { time: 0, price: 0 },
                { time: 50, price: 50 },
            ],
            text: { value: 'zone', size: 'normal', hAlign: 'center', vAlign: 'top' },
        })!;
        const { ctx } = recordingCtx();
        const angles: number[] = [];
        (ctx as unknown as Record<string, unknown>).rotate = (a: number) => {
            angles.push(a);
        };
        new DrawingPainter().paintAll(ctx, [d], fakeProjector(), theme);
        expect(angles).toHaveLength(1);
        // projector y = 100 − price: (0,100) → (50,50) is up-right → −π/4
        expect(angles[0]).toBeCloseTo(-Math.PI / 4);
    });

    it("keeps the label readable where a line crosses it with a halo in the chart's background", () => {
        const d = createDrawing('trendline', {
            id: 't',
            paneId: 'price',
            anchors: [
                { time: 0, price: 0 },
                { time: 50, price: 50 },
            ],
            text: { value: 'zone', size: 'normal', hAlign: 'center', vAlign: 'top' },
        })!;
        const { ctx } = recordingCtx();
        const halos: string[] = [];
        (ctx as unknown as Record<string, unknown>).strokeText = function (this: CanvasRenderingContext2D) {
            halos.push(String(this.strokeStyle));
        };
        new DrawingPainter().paintAll(ctx, [d], fakeProjector(), { ...theme, background: '#101010' } as VelaTheme);
        expect(halos).toEqual(['#101010']);
    });

    it('does not rotate a flat text annotation', () => {
        const d = createDrawing('text', {
            id: 'a',
            paneId: 'price',
            anchors: [{ time: 10, price: 50 }],
            text: { value: 'note', size: 'normal', hAlign: 'left', vAlign: 'top' },
        })!;
        const { ctx } = recordingCtx();
        let rotated = 0;
        (ctx as unknown as Record<string, unknown>).rotate = () => {
            rotated += 1;
        };
        new DrawingPainter().paintAll(ctx, [d], fakeProjector(), theme);
        expect(rotated).toBe(0);
    });
});


describe('DrawingPainter ArrowMark label layout', () => {
    function textPositionRecordingCtx() {
        const base = recordingCtx();
        const calls: Array<{
            text: string;
            x: number;
            y: number;
            align: CanvasTextAlign;
        }> = [];
        const ctx = base.ctx as unknown as Record<string, unknown>;

        ctx.fillText = (text: string, x: number, y: number) => {
            calls.push({
                text,
                x,
                y,
                align: ctx.textAlign as CanvasTextAlign,
            });
        };

        return { ctx: base.ctx, calls: () => calls };
    }

    const arrow = (type: 'arrowmarkup' | 'arrowmarkdown', value = '23') =>
        createDrawing(type, {
            id: type,
            paneId: 'price',
            anchors: [{ time: 10, price: 50 }],
            text: { value, size: 'normal', hAlign: 'left', vAlign: 'top' },
        })!;

    it('centers an up-arrow label below the glyph', () => {
        const { ctx, calls } = textPositionRecordingCtx();

        new DrawingPainter().paintAll(ctx, [arrow('arrowmarkup')], fakeProjector(), theme);

        expect(calls()).toEqual([
            { text: '23', x: 10, y: 76, align: 'center' },
        ]);
    });

    it('centers a down-arrow label above the glyph', () => {
        const { ctx, calls } = textPositionRecordingCtx();

        new DrawingPainter().paintAll(ctx, [arrow('arrowmarkdown')], fakeProjector(), theme);

        expect(calls()).toHaveLength(1);

        const label = calls()[0]!;
        expect(label).toMatchObject({
            text: '23',
            x: 10,
            align: 'center',
        });

        expect(label.y).toBeLessThan(24);
    });

    it('keeps multiline down-arrow labels above the glyph', () => {
        const { ctx, calls } = textPositionRecordingCtx();

        new DrawingPainter().paintAll(
            ctx,
            [arrow('arrowmarkdown', 'First line\nSecond line')],
            fakeProjector(),
            theme,
        );

        expect(calls()).toHaveLength(2);
        expect(calls().map(({ text }) => text)).toEqual([
            'First line',
            'Second line',
        ]);

        for (const label of calls()) {
            expect(label.x).toBe(10);
            expect(label.align).toBe('center');
            expect(label.y).toBeLessThan(24);
        }

        expect(calls()[1]!.y).toBeGreaterThan(calls()[0]!.y);
    });
});

describe('DrawingPainter — the round-33 tools paint', () => {
    /** Bars at x = time in px, so a projection can read real columns back. */
    const withBars = (): Projector => ({
        ...fakeProjector(),
        barsInRange: (from: number, to: number) => {
            const rows = [10, 20, 30, 40, 50].map((t, i) => ({
                time: t,
                open: 90 + i,
                high: 92 + i,
                low: 89 + i,
                close: 91 + i,
                volume: 100 + i,
            }));
            return rows.filter((b) => b.time >= Math.min(from, to) && b.time <= Math.max(from, to));
        },
    });
    const at = (time: number, price: number) => ({ time, price });
    const CASES: Array<[string, Array<{ time: number; price: number }>]> = [
        ['cycliclines', [at(40, 90), at(80, 90)]],
        ['timecycles', [at(60, 80), at(100, 80)]],
        ['sineline', [at(20, 90), at(60, 70)]],
        ['sector', [at(60, 80), at(100, 80), at(60, 40)]],
        ['barspattern', [at(10, 90), at(30, 90), at(70, 90)]],
        ['ghostfeed', [at(10, 90), at(30, 90)]],
        ['positionforecast', [at(20, 90), at(60, 70)]],
        ['table', [at(20, 95)]],
        ['anchoredvp', [at(10, 90)]],
        ['arrowmarkleft', [at(60, 80)]],
        ['arrowmarkright', [at(60, 80)]],
    ];

    it.each(CASES)('paints %s without throwing', (type, anchors) => {
        const d = createDrawing(type as never, { id: type, paneId: 'price', anchors })!;
        const { ctx } = recordingCtx();
        expect(() => new DrawingPainter().paintAll(ctx, [d], withBars(), theme, { selected: new Set([type]) })).not.toThrow();
    });

    it('paints the table cell text and the projection columns', () => {
        const table = createDrawing('table', { id: 't', paneId: 'price', anchors: [at(20, 95)] })!;
        const { ctx, texts } = recordingCtx();
        new DrawingPainter().paintAll(ctx, [table], withBars(), theme);
        expect(texts()).toBeGreaterThan(1); // header + value cells

        const pattern = createDrawing('barspattern', {
            id: 'p',
            paneId: 'price',
            anchors: [at(10, 90), at(30, 90), at(70, 90)],
        })!;
        const rec = recordingCtx();
        new DrawingPainter().paintAll(rec.ctx, [pattern], withBars(), theme);
        // The copy's bodies are filled rects: the three source bars become three columns whose
        // wicks each move the pen once.
        expect(rec.lines()).toBeGreaterThanOrEqual(3);
    });
});
