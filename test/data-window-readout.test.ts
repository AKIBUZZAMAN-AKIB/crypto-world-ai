// The data-window seam: the native renderer's readout (which bar it reads, and the shape it
// hands out) and the widget panel's pure layout of that readout into sections.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { RendererControl } from '../src/core/RendererControl';
import { dataWindowSections } from '../src/widget/data-window';
import type { DataWindowReadout, IChartRenderer } from '../src/core/ports/IChartRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

const HOUR = 3_600_000;

function bars(closes: number[], withVolume = false): OHLCV[] {
    return closes.map((close, i) => ({
        time: 1_700_000_000_000 + i * HOUR,
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        ...(withVolume ? { volume: 1234 } : {}),
    }));
}

/** Unmounted but sized — the readout is pure over bars + scales (mirrors the other native tests). */
function makeRenderer(): { r: NativeRenderer; anyR: any } {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1);
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    return { r, anyR };
}

describe('NativeRenderer.getDataWindowReadout', () => {
    it('is empty until there are bars', () => {
        const { r } = makeRenderer();
        expect(r.getDataWindowReadout()).toEqual({ date: '', time: '', ohlc: null, groups: [] });
    });

    it('reads the LATEST bar while the cursor is off the plot', () => {
        const { r } = makeRenderer();
        r.setBars(bars([100, 101, 105]));
        const readout = r.getDataWindowReadout();
        expect(readout.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(readout.time).toMatch(/^\d{2}:\d{2}$/);
        expect(Number(readout.ohlc?.c)).toBeCloseTo(105);
        expect(Number(readout.ohlc?.o)).toBeCloseTo(104);
        expect(Number(readout.ohlc?.h)).toBeCloseTo(107);
        expect(Number(readout.ohlc?.l)).toBeCloseTo(103);
        expect(readout.ohlc?.up).toBe(true); // close 105 ≥ open 104
        expect(readout.source).toBe('latest');
    });

    it('reads the HOVERED bar instead, and reports a down bar as down', () => {
        const { r, anyR } = makeRenderer();
        r.setBars([...bars([100, 101]), { time: 1_700_000_000_000 + 2 * HOUR, open: 110, high: 111, low: 98, close: 99 }]);
        anyR.hoverLogical = 0;
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(100);
        anyR.hoverLogical = 2;
        const hovered = r.getDataWindowReadout();
        expect(Number(hovered.ohlc?.c)).toBeCloseTo(99);
        expect(hovered.ohlc?.up).toBe(false);
        expect(hovered.source).toBe('crosshair');
    });

    it('reads the synced containing bar without re-emitting a local crosshair', () => {
        const { r, anyR } = makeRenderer();
        const data = bars([100, 101, 105]);
        r.setBars(data);
        let crosshairEvents = 0;
        let readoutEvents = 0;
        r.onCrosshairMove(() => crosshairEvents++);
        const unsubscribe = r.onDataWindowChange(() => readoutEvents++);
        r.setExternalCrosshair(data[0]!.time + HOUR / 2);
        expect(r.getDataWindowReadout().source).toBe('synced');
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(100);
        expect(crosshairEvents).toBe(0);
        expect(readoutEvents).toBe(1);
        // The local cursor takes precedence over a ghost.
        anyR.hoverLogical = 1;
        expect(r.getDataWindowReadout().source).toBe('crosshair');
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(101);
        anyR.hoverLogical = null;
        r.setExternalCrosshair(data[2]!.time + 2 * HOUR); // beyond the last bar
        expect(r.getDataWindowReadout().source).toBe('latest');
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(105);
        r.setExternalCrosshair(null);
        unsubscribe();
        r.setExternalCrosshair(data[1]!.time);
        expect(readoutEvents).toBe(3);
        expect(crosshairEvents).toBe(0);
    });

    it('falls back to the latest bar if a trim invalidates the hovered index', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(bars([100, 101]));
        anyR.hoverLogical = 500;
        expect(r.getDataWindowReadout().source).toBe('latest');
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(101);
    });

    it('signals timezone and precision changes independently of config and crosshair events', () => {
        const { r } = makeRenderer();
        r.setBars(bars([100]));
        let count = 0;
        r.onDataWindowChange(() => count++);
        r.applyFeature('timezone', 'Asia/Dhaka');
        r.applyFeature('timezone', 'Asia/Dhaka'); // idempotent
        r.setPricePrecision(0.01);
        expect(count).toBe(2);
    });

    it('keeps prices and price-valued plots un-abbreviated even when a phone axis is compact', () => {
        const { r, anyR } = makeRenderer();
        const data = bars([68427.31]);
        r.setBars(data);
        const pane = anyR.scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 200 };
        pane.scale = { min: 68000, max: 69000 };
        anyR.scene.priceMintick = 0.01;
        anyR.axisLabelsCompact = true;
        anyR.scene.indicators.set('ma', {
            id: 'ma', title: 'Moving Average', paneId: 'price',
            series: [{ id: 'plot', title: 'MA', kind: 'line', paneId: 'price',
                points: [{ time: data[0]!.time, value: 68412.34 }],
                style: { color: '#123456', width: 1, lineStyle: 'solid' } }],
        });
        const readout = r.getDataWindowReadout();
        expect(readout.ohlc?.c).toBe('68427.31');
        expect(readout.groups[0]?.rows[0]?.value).toBe('68412.34');
        let legend = '';
        anyR.inputsUI = { setPlotValues: (values: Map<string, Array<{ value: string }>>) => { legend = values.get('ma')?.[0]?.value ?? ''; } };
        anyR.updateLegendValues();
        expect(legend).toBe('68.41K'); // chart legend remains compact
    });

    it('notifies only when the final formatted frame changes, and stops work after unsubscribe', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(bars([100.1234]));
        const pane = anyR.scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 200 };
        pane.scale = { min: 90, max: 110 };
        anyR.scene.priceMintick = 0.01;
        let changes = 0;
        const off = r.onDataWindowChange(() => changes++);
        anyR.notifyDataWindowFrameChange();
        const first = r.getDataWindowReadout().ohlc?.c;
        anyR.notifyDataWindowFrameChange(); // an unchanged animation frame is silent
        expect(changes).toBe(1);
        anyR.scene.priceMintick = 0.1; // like scale/geometry settling after the event
        expect(r.getDataWindowReadout().ohlc?.c).not.toBe(first);
        anyR.notifyDataWindowFrameChange();
        expect(changes).toBe(2);
        off();
        anyR.scene.priceMintick = 0.001;
        anyR.notifyDataWindowFrameChange();
        expect(changes).toBe(2);
        expect(anyR.dataWindowFrameSignature).toBeNull();
    });

    it('publishes a study value only after the live indicator patch is applied', () => {
        const { r, anyR } = makeRenderer();
        const data = bars([100, 101]);
        r.setBars(data);
        anyR.scene.indicators.set('ma', {
            id: 'ma', title: 'Moving Average', paneId: 'price',
            series: [{ id: 'plot', title: 'MA', kind: 'line', paneId: 'price',
                points: data.map((bar, i) => ({ time: bar.time, value: 99 + i })),
                style: { color: '#123456', width: 1, lineStyle: 'solid' } }],
        });
        const seen: string[] = [];
        r.onDataWindowChange(() => seen.push(r.getDataWindowReadout().groups[0]!.rows[0]!.value));
        r.updateIndicator({ id: 'ma' }, {
            kind: 'value', indicatorId: 'ma', dirty: { from: 0, to: 1 },
            series: [{ kind: 'points', seriesId: 'plot', points: data.map((bar, i) => ({ time: bar.time, value: 120 + i })) }],
        });
        expect(seen).toHaveLength(1);
        expect(Number(seen[0])).toBe(121);
    });

    it('carries volume only when the bar has it', () => {
        const { r } = makeRenderer();
        r.setBars(bars([100, 101]));
        expect(r.getDataWindowReadout().ohlc?.vol).toBeUndefined();
        const withVol = makeRenderer();
        withVol.r.setBars(bars([100, 101], true));
        expect(withVol.r.getDataWindowReadout().ohlc?.vol).toBe('1.23K');
    });

    it('no longer exposes a floating data-window feature — the readout is the only seam', () => {
        expect(new NativeRenderer().features).not.toContain('dataWindow');
    });

    describe('volume indicator readout (series-less native model)', () => {
        /** Mount a volume-shaped model + layer config straight into the scene (the layer draws
         *  outside the model, so the readout must synthesize its row from the bar's volume). */
        function withVolume(withVol = true): { r: NativeRenderer; anyR: any } {
            const { r, anyR } = makeRenderer();
            r.setBars(bars([100, 101, 105], withVol));
            anyR.scene.indicators.set('vol1', { id: 'vol1', title: 'Volume', series: [], native: { type: 'volume' } });
            anyR.scene.volumeLayer = { upColor: '#11aa11', downColor: '#aa1111', heightFrac: 0.2 };
            anyR.volumeActive = true;
            return { r, anyR };
        }

        it('reads the bar volume, abbreviated, tinted with the layer direction color', () => {
            const { r } = withVolume();
            const group = r.getDataWindowReadout().groups.find((g) => g.name === 'Volume');
            expect(group?.rows).toEqual([{ label: 'Volume', value: '1.23K', color: '#11aa11' }]); // latest bar is up
        });

        it('uses the down color on a down bar', () => {
            const { r } = withVolume();
            r.setBars([...bars([100, 101], true), { time: 1_700_000_000_000 + 2 * HOUR, open: 110, high: 111, low: 98, close: 99, volume: 1234 }]);
            const group = r.getDataWindowReadout().groups.find((g) => g.name === 'Volume');
            expect(group?.rows[0]?.color).toBe('#aa1111');
        });

        it('yields no row without bar volume, and none while the indicator is hidden', () => {
            expect(withVolume(false).r.getDataWindowReadout().groups).toEqual([]);
            const hidden = withVolume();
            hidden.anyR.volumeHidden = true; // hiding suppresses the layer but keeps the model
            expect(hidden.r.getDataWindowReadout().groups).toEqual([]);
        });
    });
});

describe('indicatorValues feature (legend plot values)', () => {
    it('is a supported feature, on by default, and round-trips through apply/read', () => {
        const { r } = makeRenderer();
        expect(r.features).toContain('indicatorValues');
        expect(r.readFeature('indicatorValues')).toBe(true);
        r.applyFeature('indicatorValues', false);
        expect(r.readFeature('indicatorValues')).toBe(false);
        r.applyFeature('indicatorValues', true);
        expect(r.readFeature('indicatorValues')).toBe(true);
    });
});

describe('RendererControl.dataWindowReadout', () => {
    const readout: DataWindowReadout = { date: '2023-11-14', time: '22:13', ohlc: null, groups: [] };

    it('delegates to the renderer that provides one', () => {
        const control = new RendererControl({ getDataWindowReadout: () => readout } as unknown as IChartRenderer);
        expect(control.dataWindowReadout()).toBe(readout);
    });

    it('is null on a renderer without the seam', () => {
        const control = new RendererControl({} as unknown as IChartRenderer);
        expect(control.dataWindowReadout()).toBeNull();
    });
});

describe('dataWindowSections', () => {
    it('has no sections when the chart holds no bar', () => {
        expect(dataWindowSections({ date: '', time: '', ohlc: null, groups: [] })).toEqual([]);
    });

    it('lays the readout out as Time, Price, then one section per indicator', () => {
        const sections = dataWindowSections({
            date: '2023-11-14',
            time: '22:13',
            ohlc: { o: '104.00', h: '107.00', l: '103.00', c: '105.00', vol: '1.23K', up: true },
            groups: [
                { name: 'Moving Average', rows: [{ label: 'MA', value: '102.50', color: '#2962ff' }] },
                { name: 'RSI', rows: [{ label: 'RSI', value: '61.20', color: '#7e57c2' }, { label: 'Signal', value: '58.90', color: '#ff9800' }] },
            ],
        });
        expect(sections.map((s) => s.title)).toEqual(['Time', 'Price', 'Moving Average', 'RSI']);
        expect(sections[0]?.lines).toEqual([
            { label: 'Date', value: '2023-11-14', color: '' },
            { label: 'Time', value: '22:13', color: '' },
        ]);
        expect(sections[1]?.lines.map((l) => l.label)).toEqual(['Open', 'High', 'Low', 'Close', 'Volume']);
        expect(sections[1]?.lines.every((l) => l.color === 'var(--vela-up)')).toBe(true);
        expect(sections[3]?.lines).toEqual([
            { label: 'RSI', value: '61.20', color: '#7e57c2' },
            { label: 'Signal', value: '58.90', color: '#ff9800' },
        ]);
    });

    it('tints a down bar with the down color and drops the Volume line without volume', () => {
        const sections = dataWindowSections({
            date: '2023-11-14',
            time: '22:13',
            ohlc: { o: '110.00', h: '111.00', l: '98.00', c: '99.00', up: false },
            groups: [],
        });
        expect(sections[1]?.lines.map((l) => l.label)).toEqual(['Open', 'High', 'Low', 'Close']);
        expect(sections[1]?.lines.every((l) => l.color === 'var(--vela-down)')).toBe(true);
    });

    it('shows a dash for a missing date or time rather than an empty row', () => {
        const sections = dataWindowSections({ date: '2023-11-14', time: '', ohlc: null, groups: [] });
        expect(sections[0]?.lines).toEqual([
            { label: 'Date', value: '2023-11-14', color: '' },
            { label: 'Time', value: '—', color: '' },
        ]);
    });
});
