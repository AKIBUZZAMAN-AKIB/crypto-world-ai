// Tier 2 #9 — pattern breadth. The reference's chart-pattern family, checked against the
// public drawing contract: anchor COUNT and roles, the labelled vertices, the polyline the
// renderer will draw, hit-testing, and a serialize round-trip.
import { describe, expect, it } from 'vitest';
import { createDrawing, defaultToolbar, deserializeDrawing, getDrawingType, type Projector } from '../src/core/drawings';
import type { PatternDrawing } from '../src/core/drawings/types/PatternDrawing';

/** x = time, y = 100 − price, one pane. */
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

interface Case {
    type: string;
    labels: string[];
    points: Array<[number, number]>;
    label: string;
}

const CASES: Case[] = [
    {
        type: 'trianglepattern',
        labels: ['A', 'B', 'C', 'D', 'E'],
        points: [[0, 20], [30, 0], [60, 16], [90, 2], [120, 12]],
        label: 'Triangle Pattern',
    },
    {
        type: 'threedrives',
        labels: ['1', 'A', '2', 'C', '3'],
        points: [[0, 0], [20, 12], [50, 4], [75, 18], [110, 10]],
        label: 'Three Drives Pattern',
    },
    {
        type: 'elliotttriangle',
        labels: ['A', 'B', 'C', 'D', 'E'],
        points: [[0, 10], [25, 0], [50, 8], [75, 2], [100, 6]],
        label: 'Elliott Triangle Wave (ABCDE)',
    },
    {
        type: 'elliottdoublecombo',
        labels: ['W', 'X', 'Y'],
        points: [[0, 0], [40, 20], [80, 4]],
        label: 'Elliott Double Combo Wave (WXY)',
    },
    {
        type: 'elliottriplecombo',
        labels: ['W', 'X', 'Y', 'X', 'Z'],
        points: [[0, 0], [25, 14], [50, 2], [75, 16], [100, 4]],
        label: 'Elliott Triple Combo Wave (WXYXZ)',
    },
];

describe.each(CASES)('pattern/$type', ({ type, labels, points, label }) => {
    const make = () =>
        createDrawing(type as never, { paneId: 'price', anchors: points.map(([t, p]) => P(t, p)) }) as PatternDrawing;

    it('is registered with the reference’s label', () => {
        expect(getDrawingType(type as never)?.label).toBe(label);
    });

    it(`takes exactly ${labels.length} free anchors`, () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(labels.length);
        expect(s.max).toBe(labels.length);
        expect(s.slots.every((x) => x.free === 'both')).toBe(true);
    });

    it('labels its vertices exactly like the reference', () => {
        expect(make().vertexLabels()).toEqual(labels);
    });

    it('passes through every anchor, in order', () => {
        const pts = make().handlePoints(proj);
        expect(pts).toEqual(points.map(([t, p]) => [t, 100 - p]));
    });

    it('hit-tests on the polyline, not the bounding box', () => {
        const d = make();
        const [x0, y0] = [points[0]![0], 100 - points[0]![1]];
        const [x1, y1] = [points[1]![0], 100 - points[1]![1]];
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        expect(d.hitTest(mx, my, proj, 2)).toBe(true);
        // the empty triangle of the bounding box, well off the path
        expect(d.hitTest(x1 - 1, y0 + 1, proj, 1)).toBe(false);
    });

    it('round-trips through serialize/deserialize with all anchors intact', () => {
        const back = deserializeDrawing(JSON.parse(JSON.stringify(make().serialize())));
        expect(back?.type).toBe(type);
        expect(back?.anchors.map((a) => [a.time, a.price])).toEqual(points);
    });

    it('declares a pane and an id, so it can be stored and restored', () => {
        const doc = make().serialize();
        expect(doc.paneId).toBe('price');
        expect(typeof doc.id).toBe('string');
        expect(doc.anchors).toHaveLength(labels.length);
    });
});

describe('pattern/ThreeDrives ratios', () => {
    it('annotates its legs — the 127.2–161.8% extension is the tool’s point', () => {
        const d = createDrawing('threedrives', {
            paneId: 'price',
            anchors: [P(0, 0), P(20, 12), P(50, 4), P(75, 18), P(110, 10)],
        }) as PatternDrawing;
        expect(d.legRatios()).toBe(true);
    });
});

describe('pattern/TrianglePattern convergence', () => {
    it('keeps the drawn path a single polyline of its five pivots', () => {
        const d = createDrawing('trianglepattern', {
            paneId: 'price',
            anchors: [P(0, 20), P(30, 0), P(60, 16), P(90, 2), P(120, 12)],
        });
        const pts = d!.handlePoints(proj);
        expect(pts).toHaveLength(5);
        // converging: the last leg is shorter than the first
        const first = Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
        const last = Math.hypot(pts[4]![0] - pts[3]![0], pts[4]![1] - pts[3]![1]);
        expect(last).toBeLessThan(first);
    });
});

describe('pattern/toolbar reachability', () => {
    it('every new pattern is in a toolbar flyout (a tool nobody can reach is not shipped)', () => {
        const def = defaultToolbar();
        const reachable = def.groups.flatMap((g) => [
            ...g.tools.map((t) => t.type as string),
            ...(g.sections ?? []).flatMap((s) => s.tools.map((t) => t.type as string)),
        ]);
        for (const c of CASES) expect(reachable).toContain(c.type);
    });
});
