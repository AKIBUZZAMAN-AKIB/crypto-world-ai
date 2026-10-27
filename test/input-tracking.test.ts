// TOUCH TRACKING — TradingView's mobile crosshair contract, verbatim:
//   "long tap on the bar → tracking mode (crosshair + values); move the pointer;
//    single tap on the chart → exit."
// The old controller lifted the crosshair the instant the finger did, so browsing bars
// meant re-holding for every one (and a lift read as a plain tap). These cases pin the
// three-state behaviour: OFF → (long press) → TRACKING (persists) → (tap / pinch) → OFF.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

function fakeElement() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    return {
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
        },
        removeEventListener(type: string, fn: (e: unknown) => void) {
            listeners.get(type)?.delete(fn);
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        style: { setProperty() {}, touchAction: '', userSelect: '' } as unknown as CSSStyleDeclaration,
        setPointerCapture() {},
        releasePointerCapture() {},
        fire(type: string, e: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
        },
    };
}

function harness() {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1); // data area 800×200; price axis right of x=800, time axis below y=200
    cs.setBars([1000, 2000, 3000, 4000, 5000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 2 });
    const deps = {
        getCoords: () => cs,
        apply: vi.fn(),
        zoomTo: vi.fn(),
        fling: vi.fn(),
        onPointerMove: vi.fn(),
        onTrackingChange: vi.fn(),
        onClick: vi.fn(),
        beginPriceScale: vi.fn(),
        priceScaleBy: vi.fn(),
        beginPricePan: () => false,
        pricePanBy: vi.fn(),
        resetPriceScale: vi.fn(),
        dataDblClick: vi.fn(),
        paneSeparatorAt: () => false,
        beginPaneResize: vi.fn(),
        paneResizeBy: vi.fn(),
        resetPaneSize: vi.fn(),
        resetView: vi.fn(),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    ctl.axisDrag = true;
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const ev = (type: string, x: number, y: number, t: number, id = 1) => {
        el.fire(type, { button: 0, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: t, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    };
    /** Press on the plot and HOLD past the long-press threshold (350 ms). */
    const hold = (x = 400, y = 100, t = 0): void => {
        ev('pointerdown', x, y, t);
        vi.advanceTimersByTime(400);
    };
    const lift = (x = 400, y = 100, t = 500): void => ev('pointerup', x, y, t);
    const tap = (x: number, y: number, t: number): void => {
        ev('pointerdown', x, y, t);
        ev('pointerup', x, y, t + 40);
    };
    return { deps, ctl, el, ev, hold, lift, tap };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('touch tracking (long-press crosshair)', () => {
    it('a long press turns tracking ON at the pressed point', () => {
        const { deps, ctl, hold } = harness();
        hold(400, 100);
        expect(ctl.isTracking).toBe(true);
        expect(deps.onTrackingChange).toHaveBeenLastCalledWith(true);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(400, 100);
    });

    it('…and the crosshair STAYS after the finger lifts (the hold is not a tap-to-exit)', () => {
        const { deps, ctl, hold, lift } = harness();
        hold(400, 100);
        deps.onPointerMove.mockClear();
        lift(400, 100);
        expect(ctl.isTracking).toBe(true);
        expect(deps.onPointerMove).not.toHaveBeenCalledWith(null, null);
        expect(deps.onTrackingChange).not.toHaveBeenLastCalledWith(false);
    });

    it('a drag after the hold moves the crosshair and does NOT pan the chart', () => {
        const { deps, ev, hold } = harness();
        hold(400, 100);
        deps.onPointerMove.mockClear();
        deps.apply.mockClear();
        ev('pointermove', 520, 140, 700);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(520, 140);
        expect(deps.apply).not.toHaveBeenCalled();
    });

    it('a one-finger drag while tracking moves the crosshair, then the lift keeps it', () => {
        const { deps, ctl, ev, hold, lift } = harness();
        hold(400, 100);
        lift(400, 100);
        deps.apply.mockClear();
        ev('pointerdown', 300, 90, 900);
        ev('pointermove', 360, 120, 940);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(360, 120);
        ev('pointerup', 360, 120, 980);
        expect(ctl.isTracking).toBe(true);
        expect(deps.apply).not.toHaveBeenCalled();
    });

    it('a single tap on the chart exits tracking (the documented way out)', () => {
        const { deps, ctl, hold, lift, tap } = harness();
        hold(400, 100);
        lift(400, 100);
        expect(ctl.isTracking).toBe(true);
        tap(420, 110, 1200);
        expect(ctl.isTracking).toBe(false);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(null, null);
        expect(deps.onTrackingChange).toHaveBeenLastCalledWith(false);
    });

    it('a tap on an axis also leaves tracking before the axis gesture starts', () => {
        const { ctl, hold, lift, tap } = harness();
        hold(400, 100);
        lift(400, 100);
        tap(820, 100, 1500); // price axis, right of the data area
        expect(ctl.isTracking).toBe(false);
    });

    it('a pinch exits tracking — two fingers are navigation, not inspection', () => {
        const { ctl, ev, hold } = harness();
        hold(400, 100);
        ev('pointerdown', 500, 120, 600, 2); // second finger
        expect(ctl.isTracking).toBe(false);
    });

    it('endTracking() is the programmatic exit', () => {
        const { deps, ctl, hold } = harness();
        hold(400, 100);
        ctl.endTracking();
        expect(ctl.isTracking).toBe(false);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(null, null);
    });
});
