import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    getDrawingType,
    CyclicLines,
    TimeCycles,
    SineLine,
    Sector,
    BarsPattern,
    GhostFeed,
    TableDrawing,
    PositionForecast,
    AnchoredVolumeProfile,
    type Projector,
    type FrvpBar,
} from '../src/core/drawings';

const HR = 3600_000;

/** x = time/HR, y = 1000 − price; a 500×1000 plot. */
function fakeProjector(data: FrvpBar[] = []): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price) => 1000 - price,
        pxToPoint: (x, y) => ({ time: x * HR, price: 1000 - y }),
        paneIdAtY: () => 'price',
        barsInRange: (from, to) => data.filter((b) => b.time >= Math.min(from, to) && b.time <= Math.max(from, to)),
        width: 500,
        height: 1000,
    };
}

function mk<T>(type: string, anchors: Array<{ time: number; price: number }>, extra: Record<string, unknown> = {}): T {
    const d = createDrawing(type as never, { paneId: 'price', anchors, ...extra });
    expect(d).toBeTruthy();
    return d as T;
}

describe('drawings/round33 — cyclic + time cycles', () => {
    it('lays cyclic lines one step apart across the whole plot, forwards and backwards', () => {
        const d = mk<CyclicLines>('cycliclines', [{ time: 5 * HR, price: 0 }, { time: 7 * HR, price: 0 }]);
        const g = d.geometry(fakeProjector())!;
        // step 2px from x=5 → x = 5 + 2n covering [0, 500] ⇒ n ∈ [−3, 248] ⇒ 252 lines.
        expect(g.segments.length).toBe(252);
        const xs = g.segments.map((s) => s[0]);
        expect(Math.min(...xs)).toBeCloseTo(-1, 6); // n = −3 → 5 − 6
        expect(Math.max(...xs)).toBeLessThanOrEqual(500 + 2);
        // Evenly spaced, full-height.
        for (const s of g.segments) {
            expect(s[1]).toBe(0);
            expect(s[3]).toBe(1000);
        }
        expect(xs[1]! - xs[0]!).toBeCloseTo(2, 6);
        expect(d.priceRange()).toBeNull(); // never constrains the price axis
    });

    it('draws `rings` concentric circles whose radii are 1×,2×,… the anchor distance', () => {
        const d = mk<TimeCycles>('timecycles', [{ time: 100 * HR, price: 500 }, { time: 103 * HR, price: 500 }]);
        d.rings = 3;
        const g = d.geometry(fakeProjector())!;
        expect(g.segments.length).toBe(3 * 72); // 72 samples × 3 rings
        // Every point sits exactly k·r px from the centre (100, 500).
        const r = 3; // |103 − 100| px horizontally
        const radii = g.segments.flatMap((s) => {
            const x1 = s[0];
            const y1 = s[1];
            return [Math.hypot(x1 - 100, y1 - 500)];
        });
        for (const rr of radii) {
            const k = Math.round(rr / r);
            expect(k).toBeGreaterThanOrEqual(1);
            expect(k).toBeLessThanOrEqual(3);
            expect(rr).toBeCloseTo(k * r, 6);
        }
    });

    it('clamps the ring count to 1..12 and round-trips it through props', () => {
        const d = mk<TimeCycles>('timecycles', [{ time: 0, price: 500 }, { time: HR, price: 500 }]);
        d.rings = 40;
        expect(d.geometry(fakeProjector())!.segments.length).toBe(12 * 72);
        d.rings = 0;
        expect(d.geometry(fakeProjector())!.segments.length).toBe(1 * 72);
        d.rings = 4;
        const round = deserializeDrawing(d.serialize()) as TimeCycles;
        expect(round.rings).toBe(4);
    });
});

describe('drawings/round33 — sine line', () => {
    it('makes the second anchor the first crest, with a period of four horizontal steps', () => {
        // start (0, 500) → crest one step of 40px right and 100px up.
        const d = mk<SineLine>('sineline', [{ time: 0, price: 500 }, { time: 40 * HR, price: 600 }]);
        const g = d.geometry(fakeProjector())!;
        const yAt = (x: number): number => {
            for (const [x1, y1, x2, y2] of g.segments) {
                if (x >= x1 - 1e-9 && x <= x2 + 1e-9 && Math.abs(x2 - x1) > 0) {
                    const t = (x - x1) / (x2 - x1);
                    return y1 + (y2 - y1) * t;
                }
            }
            throw new Error(`no segment covers x=${x}`);
        };
        expect(yAt(0)).toBeCloseTo(500, 6); // wave start on its own baseline
        expect(yAt(40)).toBeCloseTo(400, 4); // crest: 100px above
        expect(yAt(80)).toBeCloseTo(500, 3); // back through the midline
        expect(yAt(120)).toBeCloseTo(600, 3); // trough
        expect(yAt(160)).toBeCloseTo(500, 3); // one full period later
        // The wave projects to the right edge of the plot.
        const last = g.segments[g.segments.length - 1]!;
        expect(last[2]).toBeGreaterThan(496);
    });

    it('mirrors the wave when the crest is placed to the left of the start', () => {
        const d = mk<SineLine>('sineline', [{ time: 100 * HR, price: 500 }, { time: 60 * HR, price: 600 }]);
        const g = d.geometry(fakeProjector())!;
        // The wave always runs forward IN TIME (to the right) from its start; a crest marker on
        // the left only flips the phase, so the first quarter drops instead of climbing.
        const at = (x: number): number => {
            for (const [x1, y1, x2, y2] of g.segments) {
                if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2)) {
                    const t = (x - x1) / (x2 - x1);
                    return y1 + (y2 - y1) * t;
                }
            }
            throw new Error(`uncovered x=${x}`);
        };
        expect(at(100)).toBeCloseTo(500, 6); // still starts on the anchor
        expect(at(140)).toBeCloseTo(600, 4); // mirrored trough
        expect(at(180)).toBeCloseTo(500, 3); // crossing
        // Nothing is drawn behind the start point.
        expect(Math.min(...g.segments.map((s) => Math.min(s[0], s[2])))).toBeCloseTo(100, 6);
    });
});

describe('drawings/round33 — sector', () => {
    it('fills a swept polygon between the two radii and clamps the sweep to ±180°', () => {
        const d = mk<Sector>('sector', [
            { time: 100 * HR, price: 500 },
            { time: 140 * HR, price: 500 },
            { time: 100 * HR, price: 460 },
        ]);
        const g = d.geometry(fakeProjector())!;
        expect(g.fill!.length).toBe(2 + 48 + 1); // centre + arc samples + centre
        // First and last points are the centre.
        expect(g.fill![0]).toEqual([100, 500]);
        expect(g.fill![g.fill!.length - 1]).toEqual([100, 500]);
        // Every arc point is on the radius-40 circle.
        for (const [x, y] of g.fill!.slice(1, -1)) {
            expect(Math.hypot(x - 100, y - 500)).toBeCloseTo(40, 5);
        }
        const priceR = d.priceRange()!;
        expect(priceR.min).toBe(460);
        expect(priceR.max).toBe(500);
    });

    it('sweeps the short way round (60° stays 60°, never 300°)', () => {
        // Start at 0° (to the right), end 60° down-right: the sweep must be +60°, not −300°.
        const d = mk<Sector>('sector', [
            { time: 100 * HR, price: 500 },
            { time: 140 * HR, price: 500 },
            { time: 120 * HR, price: 465.36 }, // 60° below the horizontal on a 40px radius
        ]);
        const g = d.geometry(fakeProjector())!;
        const arc = g.fill!.slice(1, -1);
        const angles = arc.map(([x, y]) => Math.atan2(y - 500, x - 100));
        for (const a of angles) {
            expect(a).toBeGreaterThanOrEqual(-1e-6);
            expect(a).toBeLessThanOrEqual(Math.PI / 3 + 1e-6);
        }
    });
});

const bars = (n: number, start = 0): FrvpBar[] =>
    Array.from({ length: n }, (_, i) => ({
        time: (start + i) * HR,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 10,
    }));

describe('drawings/round33 — bar projections', () => {
    it('re-draws the source bars shifted to the destination time, same width and OHLC', () => {
        const data = bars(4);
        const proj = fakeProjector(data);
        // Source = bars 0..2 (3 bars), destination = bar 10.
        const d = mk<BarsPattern>('barspattern', [
            { time: 0, price: 100 },
            { time: 2 * HR, price: 100 },
            { time: 10 * HR, price: 100 },
        ], { paneId: 'price' });
        const cols = d.columns(proj);
        expect(cols).toHaveLength(3);
        // Source spans 2px for 3 bars ⇒ step 1px; width = 0.7px → floored at 1.
        expect(Math.round(cols[0]!.w)).toBe(1);
        // First copy lands on the destination time (x = 10) and the rest follow by one step.
        expect(cols[0]!.x).toBeCloseTo(10, 6);
        expect(cols[1]!.x).toBeCloseTo(11, 6);
        expect(cols[2]!.x).toBeCloseTo(12, 6);
        // The copy carries the same pixel geometry as the source bar.
        expect(cols[0]!.wickTop).toBeCloseTo(proj.yOf(102, 'price')!, 6);
        expect(cols[0]!.wickBottom).toBeCloseTo(proj.yOf(99, 'price')!, 6);
        expect(cols[0]!.up).toBe(true); // close 101 > open 100
    });

    it('ghost feed projects onto its own source end and never paints opaque', () => {
        const data = bars(6);
        const d = mk<GhostFeed>('ghostfeed', [{ time: 0, price: 100 }, { time: 2 * HR, price: 100 }]);
        const cols = d.columns(fakeProjector(data));
        expect(cols).toHaveLength(3);
        // The source is bars 0..2; the feed continues one step past the window, at bar 3.
        expect(cols[0]!.x).toBeCloseTo(3, 6);
        expect(d.projection.opacity).toBeLessThanOrEqual(0.6); // a ghost, not a copy
    });

    it('paints nothing until the destination anchor exists', () => {
        const d = mk<BarsPattern>('barspattern', [{ time: 0, price: 100 }, { time: 2 * HR, price: 100 }]);
        expect(d.columns(fakeProjector(bars(4)))).toHaveLength(0);
    });
});

describe('drawings/round33 — table', () => {
    it('turns lines into rows and pipes into columns, header bold on row 0', () => {
        const d = mk<TableDrawing>('table', [{ time: 0, price: 500 }]);
        d.text = { ...(d.text ?? {}), value: 'Symbol | BTC\nEntry | 64,200\nTarget | 68,000' } as never;
        const L = d.layout(fakeProjector())!;
        expect(L.rows).toBe(3);
        expect(L.cols).toBe(2);
        expect(L.cells).toHaveLength(6);
        expect(L.cells[0]!.text).toBe('Symbol');
        expect(L.cells[0]!.header).toBe(true);
        expect(L.cells[2]!.header).toBe(false); // row 1 is body
        // Column widths are shared by every row (a real grid, not ragged text).
        expect(L.cells[0]!.w).toBeCloseTo(L.cells[2]!.w, 6); // one width per column, shared down the rows
    });

    it('sizes each column to its widest cell and pads the box', () => {
        const d = mk<TableDrawing>('table', [{ time: 0, price: 500 }]);
        d.text = { ...(d.text ?? {}), value: 'A | BBBBBBBBBB\nLongerHeader | B' } as never;
        const L = d.layout(fakeProjector())!;
        const colW = [L.cells[0]!.w, L.cells[1]!.w];
        expect(colW[0]).toBeGreaterThan(colW[1]!); // column 0 holds the longer word
        expect(L.box.w).toBeCloseTo(colW[0]! + colW[1]!, 6);
        expect(L.lines.filter((l) => l[1] === l[3])).toHaveLength(1); // one horizontal separator
        expect(L.lines.filter((l) => l[0] === l[2])).toHaveLength(2); // a rule after each column
    });

    it('hits anywhere in the box', () => {
        const d = mk<TableDrawing>('table', [{ time: 0, price: 500 }]);
        d.text = { ...(d.text ?? {}), value: 'A | B' } as never;
        const proj = fakeProjector();
        const L = d.layout(proj)!;
        expect(d.hitTest(L.box.x + 2, L.box.y + 2, proj, 0)).toBe(true);
        expect(d.hitTest(L.box.x + L.box.w + 40, L.box.y + L.box.h + 40, proj, 0)).toBe(false);
    });
});

describe('drawings/round33 — position forecast', () => {
    const run = (data: FrvpBar[], a: { time: number; price: number }, b: { time: number; price: number }) => {
        const d = mk<PositionForecast>('positionforecast', [a, b]);
        return d.outcome(fakeProjector(data));
    };

    it('reports success when price tags the target inside the window', () => {
        // Window bars 0..3; bar 2 trades up to 106 ≥ target 105.
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { time: HR, open: 100, high: 103, low: 99, close: 102, volume: 1 },
            { time: 2 * HR, open: 102, high: 106, low: 101, close: 105, volume: 1 },
            { time: 3 * HR, open: 105, high: 108, low: 104, close: 107, volume: 1 },
            { time: 4 * HR, open: 107, high: 109, low: 106, close: 108, volume: 1 },
        ];
        expect(run(data, { time: 0, price: 100 }, { time: 3 * HR, price: 105 })).toEqual({ outcome: 'success', elapsed: 1 });
    });

    it('reports failure when the window closes short of the target', () => {
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { time: HR, open: 100, high: 102, low: 99, close: 101, volume: 1 },
            { time: 2 * HR, open: 101, high: 103, low: 100, close: 102, volume: 1 },
            { time: 3 * HR, open: 102, high: 104, low: 101, close: 103, volume: 1 },
            { time: 4 * HR, open: 103, high: 120, low: 102, close: 119, volume: 1 },
        ];
        // The target is only reached AFTER the window's last bar (index 3).
        expect(run(data, { time: 0, price: 100 }, { time: 3 * HR, price: 110 }).outcome).toBe('failure');
    });

    it('stays open until the window has actually elapsed', () => {
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { time: HR, open: 100, high: 101, low: 99, close: 100, volume: 1 },
        ];
        expect(run(data, { time: 0, price: 100 }, { time: 10 * HR, price: 120 }).outcome).toBe('open');
    });

    it('reads a short forecast the other way round (price must fall to the target)', () => {
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { time: HR, open: 100, high: 101, low: 94, close: 95, volume: 1 },
        ];
        const up = run(data, { time: 0, price: 100 }, { time: HR, price: 95 });
        expect(up.outcome).toBe('success');
        // A long from the same bars must NOT hit the higher target.
        const down = run(data, { time: 0, price: 100 }, { time: HR, price: 130 });
        expect(down.outcome).toBe('failure');
    });
});

describe('drawings/round33 — anchored volume profile', () => {
    it('runs from the anchor bar to the live edge and conserves volume', () => {
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
            { time: HR, open: 100, high: 111, low: 100, close: 110, volume: 2000 },
            { time: 2 * HR, open: 110, high: 112, low: 108, close: 109, volume: 500 },
        ];
        const d = mk<AnchoredVolumeProfile>('anchoredvp', [{ time: HR, price: 100 }]);
        const L = d.layout(fakeProjector(data))!;
        const total = L.profile.rows.reduce((s, r) => s + r.up + r.down, 0);
        expect(total).toBeCloseTo(2500, 4); // only bars 1..2 are inside the window
        expect(L.profile.rows.length).toBeGreaterThan(1);
        expect(L.pocY).not.toBeNull();
        // The range the autoscaler must keep on screen covers every row of the profile.
        expect(L.yEdges).toHaveLength(L.profile.rows.length + 1);
    });
});

describe('drawings/round33 — registry wiring', () => {
    const NEW: Array<[string, string]> = [
        ['cycliclines', 'patterns'],
        ['timecycles', 'patterns'],
        ['sineline', 'patterns'],
        ['sector', 'shapes'],
        ['barspattern', 'measure'],
        ['ghostfeed', 'measure'],
        ['positionforecast', 'measure'],
        ['anchoredvp', 'measure'],
        ['table', 'annotations'],
        ['arrowmarkleft', 'stamps'],
        ['arrowmarkright', 'stamps'],
    ];

    it.each(NEW)('registers %s in the %s group with an icon + default style', (type, group) => {
        const meta = getDrawingType(type as never);
        expect(meta).toBeTruthy();
        expect(meta!.group).toBe(group);
        expect(meta!.label.length).toBeGreaterThan(2);
        expect(meta!.icon).toContain('<svg');
        expect(meta!.defaultStyle.lineColor).toBeTruthy();
        expect(meta!.defaultStyle.lineWidth).toBeGreaterThan(0);
        expect(meta!.defaultStyle.lineStyle).toBeTruthy();
        expect(meta!.create({ paneId: 'price', anchors: [] } as never)).toBeTruthy();
    });
});
