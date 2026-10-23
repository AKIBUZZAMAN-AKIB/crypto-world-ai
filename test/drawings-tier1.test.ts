import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, getDrawingType, type Projector } from '../src/core/drawings';
import { DoubleCurve } from '../src/core/drawings/types/DoubleCurve';
import { GannSquareFixed } from '../src/core/drawings/types/GannSquareFixed';
import { GannSquare } from '../src/core/drawings/types/GannSquare';
import { FibPitchfan } from '../src/core/drawings/types/FibPitchfan';
import { Pin } from '../src/core/drawings/types/Pin';
import type { SegmentGeometry } from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
  return {
    xOf: (t) => t,
    yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
    pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
    paneIdAtY: () => 'price',
    width: 400,
    height: 200,
  };
}

const proj = fakeProjector();
const P = (time: number, price: number) => ({ time, price });

describe('drawing/DoubleCurve — the reference’s Price 1/2/3/4 rig', () => {
  const make = () =>
    createDrawing('doublecurve', {
      paneId: 'price',
      anchors: [P(0, 0), P(100, 40), P(20, 60), P(80, -20)],
    }) as DoubleCurve;

  it('takes exactly four anchors, all free, in start/end/control1/control2 order', () => {
    const s = make().anchorSchema();
    expect([s.min, s.max]).toEqual([4, 4]);
    expect(s.slots.map((x) => x.role)).toEqual(['p1', 'p2', 'control1', 'control2']);
    expect(s.slots.every((x) => x.free === 'both')).toBe(true);
  });

  it('passes through both anchors and never through a control point', () => {
    const g = make().geometry(proj) as SegmentGeometry;
    const pts = g.segments;
    // Sample endpoints: the first segment starts at P0 (x=0), the last ends at P3 (x=100).
    expect(pts[0]![0]).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1]![2]).toBeCloseTo(100, 5);
    // A cubic that passed through a control would be a polyline; check it does not:
    // at t≈0 the curve must sit well away from control1's pixel y (100−60 = 40).
    const nearStartY = pts[0]![1];
    expect(Math.abs(nearStartY - (100 - 60))).toBeGreaterThan(5);
  });

  it('bends the two ends opposite ways — that is what "double" means', () => {
    const g = make().geometry(proj) as SegmentGeometry;
    // Signed distance from the chord P0→P3: control1 sits above it, control2 below. If the
    // curve really uses both controls, the quarter points fall on opposite sides.
    const [x0, y0] = [0, 100];
    const [x3, y3] = [100, 60];
    const len = Math.hypot(x3 - x0, y3 - y0);
    const nx = -(y3 - y0) / len;
    const ny = (x3 - x0) / len;
    const offset = (pt: [number, number]): number => (pt[0] - x0) * nx + (pt[1] - y0) * ny;
    const seg = g.segments;
    const q1 = seg[Math.floor(seg.length * 0.2)]!;
    const q3 = seg[Math.floor(seg.length * 0.8)]!;
    const a = offset([q1[2], q1[3]]);
    const b = offset([q3[2], q3[3]]);
    expect(Math.sign(a)).toBe(-Math.sign(b));
    expect(Math.abs(a)).toBeGreaterThan(3);
    expect(Math.abs(b)).toBeGreaterThan(3);
  });

  it('draws only a chord while placing (two anchors, no control yet)', () => {
    const d = createDrawing('doublecurve', { paneId: 'price', anchors: [P(0, 0), P(50, 50)] }) as DoubleCurve;
    const g = d.geometry(proj) as SegmentGeometry;
    expect(g.segments).toEqual([[0, 100, 50, 50]]);
  });

  it('falls back to one control when the fourth anchor is missing', () => {
    const d = createDrawing('doublecurve', { paneId: 'price', anchors: [P(0, 0), P(100, 40), P(20, 60)] }) as DoubleCurve;
    const g = d.geometry(proj) as SegmentGeometry;
    expect(g.segments.length).toBeGreaterThan(10);
  });

  it('round-trips through the document', () => {
    const doc = make().serialize();
    const back = deserializeDrawing(doc) as DoubleCurve;
    expect(back.anchors).toHaveLength(4);
    expect(back.anchors[3]!.price).toBe(-20);
  });

  it('is registered with a label and a glyph', () => {
    expect(getDrawingType('doublecurve')?.label).toBe('Double curve');
    expect(getDrawingType('doublecurve')?.icon).toContain('<svg');
  });
});

describe('drawing/GannSquareFixed — a square in PIXELS, not in chart units', () => {
  it('squares the height to the dragged width', () => {
    // Width 100 px, height 40 px dragged → the fixed variant must render 100 px tall.
    const d = createDrawing('gannsquarefixed', { paneId: 'price', anchors: [P(0, 0), P(100, 60)] }) as GannSquareFixed;
    const g = d.arcGeom(proj)!;
    expect(Math.abs(g.bx)).toBeCloseTo(100, 5);
    expect(Math.abs(g.py)).toBeCloseTo(100, 5);
  });

  it('keeps the drag’s direction — squared upward when dragged upward', () => {
    const up = createDrawing('gannsquarefixed', { paneId: 'price', anchors: [P(0, 40), P(100, 60)] }) as GannSquareFixed;
    expect(up.arcGeom(proj)!.py).toBeLessThan(0); // price rises ⇒ y falls
  });

  it('squares downward on a dead-horizontal drag instead of rendering nothing', () => {
    const flat = createDrawing('gannsquarefixed', { paneId: 'price', anchors: [P(0, 10), P(80, 10)] }) as GannSquareFixed;
    const g = flat.arcGeom(proj)!;
    expect(g.py).toBeCloseTo(80, 5);
  });

  it('the plain Gann Square is untouched — it keeps the dragged height', () => {
    const plain = createDrawing('gannsquare', { paneId: 'price', anchors: [P(0, 0), P(100, 60)] }) as GannSquare;
    expect(Math.abs(plain.arcGeom(proj)!.py)).toBeCloseTo(60, 5); // y: 100 → 40
  });

  it('divides the SQUARED BOX with its grid, since price no longer matches the box', () => {
    const d = createDrawing('gannsquarefixed', { paneId: 'price', anchors: [P(0, 0), P(100, 60)] }) as GannSquareFixed;
    const g = d.arcGeom(proj)!;
    const lines = d.entryLines(proj)!;
    // the 0.5 price line must land on the box's vertical middle, not on a 20px-old span
    const half = lines.find((l) => l.numberText === '0.5' && l.x2 > l.x1)!; // horizontal lines run left→right
    const midY = g.oy + g.py / 2;
    expect(Math.abs(half.y1 - midY)).toBeLessThan(0.51);
  });

  it('inherits the grid, the angle fan and the arcs from Gann Square', () => {
    const d = createDrawing('gannsquarefixed', { paneId: 'price', anchors: [P(0, 0), P(100, 60)] }) as GannSquareFixed;
    expect(d).toBeInstanceOf(GannSquare);
    const lines = d.entryLines(proj)!;
    // The fan's five 3x1…1x3 legs carry labels; the grid lines are vertical/horizontal.
    expect(lines.some((l) => l.numberText === '1x1')).toBe(true);
    expect(lines.length).toBeGreaterThan(10);
  });
});

describe('drawing/FibPitchfan — rays through the fib divisions of the first correction', () => {
  // Trend origin (0, 0) → extreme (100, 100) → correction end (150, 60).
  const make = () =>
    createDrawing('fibpitchfan', { paneId: 'price', anchors: [P(0, 0), P(100, 100), P(150, 60)] }) as FibPitchfan;

  it('takes three anchors: origin, trend extreme, correction extreme', () => {
    const s = make().anchorSchema();
    expect([s.min, s.max]).toEqual([3, 3]);
    expect(s.slots.map((x) => x.role)).toEqual(['p1', 'p2', 'p3']);
  });

  it('starts every ray at the trend origin', () => {
    const lines = make().entryLines(proj)!;
    const rays = lines.filter((l) => l.numberText !== '');
    expect(rays.length).toBeGreaterThanOrEqual(6);
    for (const r of rays) {
      expect(r.x1).toBeCloseTo(0, 5);
      expect(r.y1).toBeCloseTo(100, 5); // price 0 ⇒ y 100
    }
  });

  it('ratio 0 passes through the trend extreme and ratio 1 through the correction extreme', () => {
    const lines = make().entryLines(proj)!;
    const at = (ratio: string) => lines.find((l) => l.numberText === ratio)!;
    // Extend to the right edge: the ray's slope is what we can check — at the anchor's x.
    const slope = (l: { x1: number; y1: number; x2: number; y2: number }) => (l.y2 - l.y1) / (l.x2 - l.x1);
    const s0 = slope(at('0')); // through (100, y=0)
    const s1 = slope(at('1')); // through (150, y=40)
    expect(s0).toBeCloseTo((0 - 100) / (100 - 0), 6);
    expect(s1).toBeCloseTo((40 - 100) / (150 - 0), 6);
  });

  it('midpoint ratio 0.5 bisects the correction leg', () => {
    const lines = make().entryLines(proj)!;
    const half = lines.find((l) => l.numberText === '0.5')!;
    // The point at ratio .5 on p2→p3 is (125, price 80 ⇒ y 20).
    expect((half.y2 - half.y1) / (half.x2 - half.x1)).toBeCloseTo((20 - 100) / 125, 6);
  });

  it('draws the correction leg itself, so the ratios have a visible measuring stick', () => {
    const lines = make().entryLines(proj)!;
    const leg = lines[lines.length - 1]!;
    expect(leg.numberText).toBe('');
    expect([leg.x1, leg.y1, leg.x2, leg.y2]).toEqual([100, 0, 150, 40]);
  });

  it('draws just the trend leg while the third point is still being placed', () => {
    const d = createDrawing('fibpitchfan', { paneId: 'price', anchors: [P(0, 0), P(100, 100)] }) as FibPitchfan;
    const lines = d.entryLines(proj)!;
    expect(lines).toHaveLength(1);
    expect([lines[0]!.x1, lines[0]!.y1, lines[0]!.x2]).toEqual([0, 100, 100]);
  });

  it('honours a disabled level (the settings gear)', () => {
    const d = make();
    const half = d.levels.find((l) => l.ratio === 0.5)!;
    half.enabled = false;
    expect(d.entryLines(proj)!.some((l) => l.numberText === '0.5')).toBe(false);
  });
});

describe('drawing/Pin — a marker on the level, with the note hanging off it', () => {
  const make = () => createDrawing('pin', { paneId: 'price', anchors: [P(40, 50), P(40, 80)] }) as Pin;

  it('is a two-anchor annotation: the target and the note’s centre', () => {
    const s = make().anchorSchema();
    expect([s.min, s.max]).toEqual([2, 2]);
    expect(s.slots.map((x) => x.role)).toEqual(['target', 'box']);
  });

  it('seeds the placeholder text the painter shows before the trader types', () => {
    const d = make();
    expect(d.text?.value).toBe('Pin');
  });

  it('keeps the target pixel exactly where the magnet snapped it', () => {
    const d = make();
    const [target] = d.points(proj)!;
    expect(target).toEqual([40, 50]); // time 40, price 50 ⇒ y 50
  });

  it('is hit-testable anywhere on the plate, so it can be dragged by its body', () => {
    const d = make();
    expect(d.hitTest(40, 20, proj, 2)).toBe(true); // inside the plate near the note anchor
    expect(d.hitTest(300, 180, proj, 2)).toBe(false);
  });

  it('round-trips through the document', () => {
    const d = make();
    const back = deserializeDrawing(d.serialize()) as Pin;
    expect(back.type).toBe('pin');
    expect(back.anchors).toHaveLength(2);
    expect(back.text?.value).toBe('Pin');
  });

  it('is registered under annotations with a label and a glyph', () => {
    expect(getDrawingType('pin')?.group).toBe('annotations');
    expect(getDrawingType('pin')?.icon).toContain('<svg');
  });
});
