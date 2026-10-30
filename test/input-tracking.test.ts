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
        drawingsClaim: vi.fn(() => false),
        drawingsPointerDown: vi.fn(),
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
        deps.onPointerMove.mockClear();
        ev('pointerdown', 300, 90, 900);
        expect(deps.onPointerMove).not.toHaveBeenCalled(); // touching elsewhere must not jump
        ev('pointermove', 360, 120, 940);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(460, 130); // previous position + contact delta
        ev('pointerup', 360, 120, 980);
        expect(ctl.isTracking).toBe(true);
        expect(deps.apply).not.toHaveBeenCalled();
    });

    it('leaves an armed drawing gesture in control instead of starting inspection', () => {
        const { deps, ctl, hold } = harness();
        deps.drawingsClaim.mockReturnValue(true);
        hold(400, 100);
        expect(deps.drawingsPointerDown).toHaveBeenCalled();
        expect(ctl.isTracking).toBe(false);
        expect(deps.onTrackingChange).not.toHaveBeenCalled();
    });

    it('does not let disabled drawing hit-tests steal an established tracking drag', () => {
        const { deps, ctl, ev, hold, lift } = harness();
        ctl.drawings = false;
        deps.drawingsClaim.mockReturnValue(true);
        hold(400, 100);
        lift(400, 100);
        ev('pointerdown', 420, 100, 900);
        ev('pointermove', 450, 120, 950);
        ev('pointerup', 450, 120, 1000);
        expect(deps.drawingsClaim).not.toHaveBeenCalled();
        expect(ctl.isTracking).toBe(true);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(430, 120);
    });

    it('re-grabs the actually applied crosshair (including a magnet snap)', () => {
        const { deps, ctl, ev, hold, lift } = harness();
        hold(400, 100);
        lift(400, 100);
        // A renderer may snap or reposition the displayed crosshair between contacts.
        Object.assign(deps, { getAppliedCrosshair: () => ({ x: 410, y: 75 }) });
        ev('pointerdown', 100, 80, 900);
        ev('pointermove', 130, 95, 940);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(440, 90);
        expect(ctl.isTracking).toBe(true);
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

    it('endTracking() releases an active contact and cannot resurrect the cleared crosshair', () => {
        const { deps, ctl, ev, hold } = harness();
        hold(400, 100);
        ctl.endTracking();
        expect(ctl.isTracking).toBe(false);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(null, null);
        deps.onPointerMove.mockClear();
        ev('pointermove', 450, 120, 500); // the old finger is still physically down
        ev('pointerup', 450, 120, 550);
        expect(deps.onPointerMove).not.toHaveBeenCalled();
    });

    it('a small wobble before the hold neither pans nor selects the stale touchdown point', () => {
        const { deps, ctl, ev } = harness();
        ev('pointerdown', 400, 100, 0);
        deps.apply.mockClear(); // the initial press freezes an existing animation
        ev('pointermove', 406, 104, 100);
        expect(deps.apply).not.toHaveBeenCalled();
        vi.advanceTimersByTime(400);
        expect(ctl.isTracking).toBe(true);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(406, 104);
    });

    it('keeps the crosshair on the plot when a captured finger travels onto an axis or outside', () => {
        const { deps, ev, hold } = harness();
        hold(400, 100);
        ev('pointermove', 850, 250, 450);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(800, 200);
        ev('pointermove', -20, -30, 500);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(0, 0);
    });

    it('notifies the host when a pinch ends tracking', () => {
        const { deps, ev, hold } = harness();
        hold(400, 100);
        ev('pointerdown', 500, 120, 600, 2);
        expect(deps.onTrackingChange).toHaveBeenLastCalledWith(false);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(null, null);
    });

    it('a cancelled tracking pointer does not keep dragging or respond to stale moves', () => {
        const { deps, ctl, ev, hold } = harness();
        hold(400, 100);
        ev('pointercancel', 400, 100, 420);
        expect(ctl.isTracking).toBe(true); // keep the last inspection point, like a lift
        deps.onPointerMove.mockClear();
        ev('pointermove', 500, 150, 460); // the cancelled pointer no longer exists
        expect(deps.onPointerMove).not.toHaveBeenCalled();
        ev('pointerdown', 450, 100, 700, 2);
        ev('pointermove', 480, 120, 740, 2);
        expect(deps.onPointerMove).toHaveBeenLastCalledWith(430, 120);
    });

    it('an ignored third finger cannot end an active two-finger pinch', () => {
        const { deps, ev, hold } = harness();
        hold(400, 100);
        ev('pointerdown', 500, 120, 600, 2);
        ev('pointerdown', 600, 140, 620, 3); // extra contact is ignored
        ev('pointerup', 600, 140, 640, 3);
        deps.apply.mockClear();
        ev('pointermove', 530, 120, 680, 2);
        expect(deps.apply).toHaveBeenCalled(); // the original pinch still owns its contacts
    });
});
