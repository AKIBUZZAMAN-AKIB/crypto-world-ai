// Position forecast: the verdict maths (which bar inside the window decides it) and the two
// color pairs the reference exposes — Source/Target labels and the Success/Failure result box.
import { describe, it, expect } from 'vitest';
import {
    BULLISH,
    BEARISH,
} from '../src/core/palette';
import {
    createDrawing,
    defaultForecastStyle,
    deserializeDrawing,
    openVerdictStyle,
    PositionForecast,
    type Projector,
} from '../src/core/drawings';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import type { VelaTheme } from '../src/core/options';

const HR = 3600_000;

interface Bar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

function projWith(bars: Bar[]): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 200 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 200 - y }),
        paneIdAtY: () => 'price',
        barsInRange: (from, to) => bars.filter((b) => b.time >= from && b.time <= to),
        width: 400,
        height: 300,
    };
}

const bar = (i: number, high: number, low: number): Bar => ({ time: i * HR, open: 100, high, low, close: 100 });

function forecast(): PositionForecast {
    return createDrawing('positionforecast', {
        id: 'f',
        paneId: 'price',
        anchors: [{ time: 0, price: 100 }, { time: 4 * HR, price: 110 }],
    }) as PositionForecast;
}

describe('position forecast — verdict', () => {
    it('is success when the target is touched inside the window', () => {
        const bars = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 111, 100), bar(3, 104, 99), bar(4, 103, 99)];
        expect(forecast().outcome(projWith(bars)).outcome).toBe('success');
    });

    it('is failure when the window closes without touching it', () => {
        const bars = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 108, 100), bar(3, 104, 99), bar(4, 103, 99)];
        expect(forecast().outcome(projWith(bars)).outcome).toBe('failure');
    });

    it('stays open until the window’s own bar has closed', () => {
        const bars = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 111, 100)]; // window ends at bar 4
        expect(forecast().outcome(projWith(bars)).outcome).toBe('open');
    });

    it('a target touched after the window does not count', () => {
        const bars = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 108, 100), bar(3, 104, 99), bar(4, 103, 99), bar(5, 120, 99)];
        expect(forecast().outcome(projWith(bars)).outcome).toBe('failure');
    });

    it('a short idea is judged on the low side', () => {
        const short = createDrawing('positionforecast', {
            id: 's',
            paneId: 'price',
            anchors: [{ time: 0, price: 100 }, { time: 4 * HR, price: 90 }],
        }) as PositionForecast;
        const hitLow = [bar(0, 101, 99), bar(1, 101, 95), bar(2, 100, 89), bar(3, 101, 99), bar(4, 101, 99)];
        expect(short.outcome(projWith(hitLow)).outcome).toBe('success');
        const missedLow = [bar(0, 101, 99), bar(1, 101, 95), bar(2, 100, 91), bar(3, 101, 99), bar(4, 101, 99)];
        expect(short.outcome(projWith(missedLow)).outcome).toBe('failure');
    });
});

describe('position forecast — palette', () => {
    it('defaults on first use, without needing props', () => {
        const f = forecast();
        expect(f.palette()).toEqual(defaultForecastStyle());
        expect(f.palette().successBg).toBe(BULLISH);
        expect(f.palette().failureBg).toBe(BEARISH);
        expect(openVerdictStyle().bg).not.toBe(BULLISH);
    });

    it('keeps the saved colors, ignores junk, and fills the gaps from the defaults', () => {
        const f = createDrawing('positionforecast', {
            id: 'f2',
            paneId: 'price',
            anchors: [{ time: 0, price: 100 }, { time: HR, price: 110 }],
            props: { forecast: { successBg: '#00ff00', failureBg: 42, labelText: '' } },
        }) as PositionForecast;
        const pal = f.palette();
        expect(pal.successBg).toBe('#00ff00');
        expect(pal.failureBg).toBe(BEARISH); // junk → default, never "42"
        expect(pal.labelText).toBe(defaultForecastStyle().labelText); // blank → default
    });

    it('round-trips through save/load', () => {
        const f = forecast();
        f.forecast = { ...f.palette(), successBg: '#123456', labelBg: 'rgba(0,0,0,0.4)' };
        const back = deserializeDrawing(f.serialize()) as PositionForecast;
        expect(back.palette().successBg).toBe('#123456');
        expect(back.palette().labelBg).toBe('rgba(0,0,0,0.4)');
    });
});

describe('position forecast — the result box wears the verdict color', () => {
    function recordingFills() {
        const fills: string[] = [];
        const ctx = {
            globalAlpha: 1,
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            font: '',
            textAlign: 'left',
            textBaseline: 'alphabetic',
            setTransform() {},
            clearRect() {},
            beginPath() {},
            closePath() {},
            moveTo() {},
            lineTo() {},
            arcTo() {},
            stroke() {},
            fill() {
                fills.push(String(this.fillStyle));
            },
            setLineDash() {},
            arc() {},
            fillRect() {},
            strokeRect() {},
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            fillText() {},
            strokeText() {},
            measureText: () => ({ width: 20 }),
            rect() {},
            clip() {},
            ellipse() {},
        };
        return { ctx: ctx as unknown as CanvasRenderingContext2D, fills: () => fills };
    }

    const theme = { textColor: '#ffffff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    const bars = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 111, 100), bar(3, 104, 99), bar(4, 103, 99)];

    it('paints the success box in the success background', () => {
        const f = forecast();
        f.forecast = { ...f.palette(), successBg: '#00ff00' };
        const { ctx, fills } = recordingFills();
        new DrawingPainter().paintAll(ctx, [f], projWith(bars), theme);
        expect(fills()).toContain('#00ff00');
    });

    it('paints the failure box in the failure background', () => {
        const f = forecast();
        f.forecast = { ...f.palette(), failureBg: '#ff0000' };
        const missed = [bar(0, 101, 99), bar(1, 105, 99), bar(2, 108, 100), bar(3, 104, 99), bar(4, 103, 99)];
        const { ctx, fills } = recordingFills();
        new DrawingPainter().paintAll(ctx, [f], projWith(missed), theme);
        expect(fills()).toContain('#ff0000');
    });

    it('an open forecast takes the neutral plate, not a verdict color', () => {
        const f = forecast();
        f.forecast = { ...f.palette(), successBg: '#00ff00', failureBg: '#ff0000' };
        const { ctx, fills } = recordingFills();
        new DrawingPainter().paintAll(ctx, [f], projWith([bar(0, 101, 99), bar(1, 105, 99)]), theme);
        expect(fills()).not.toContain('#00ff00');
        expect(fills()).not.toContain('#ff0000');
        expect(fills()).toContain(openVerdictStyle().bg);
    });
});
