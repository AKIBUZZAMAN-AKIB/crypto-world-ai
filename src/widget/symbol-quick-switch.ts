// Quick symbol switching — TradingView's watchlist wheel, without opening the picker.
//
// Desktop: wheel over the symbol button (or ArrowDown / ArrowUp / Space / Shift+Space when
// it has focus) walks the watchlist. Mobile: press the ticker and drag up/down like the iOS
// rolodex. A tap still opens the full symbol search; only the wheel/drag gesture is swallowed.
// The chart never leaves the screen, so a quick scan stays a quick scan.

/** A physical wheel notch is coarse; a finger drag is finer. */
const WHEEL_STEP_PX = 60;
const DRAG_STEP_PX = 28;

function canonicalTicker(symbol: string): string {
    // `BINANCE:BTCUSDT`, `btcusdt` and `BTCUSDT` all name the same quick-switch stop.
    const raw = String(symbol || '').trim();
    const bare = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
    return bare.toUpperCase();
}

export interface SymbolQuickSwitchHandle {
    /** Remove the listeners (widgets live as long as their shell, but tests use this). */
    destroy(): void;
    /** Announce the gesture in the button's own label/title. */
    label(text: string): void;
}

/**
 * Install the gesture on a symbol button. `step(+1)` is the next symbol, `step(-1)` the
 * previous. The caller owns the actual list and the chart mutation.
 */
export function installSymbolQuickSwitch(el: HTMLElement, step: (delta: number) => void): SymbolQuickSwitchHandle {
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    el.dataset.quickSymbol = '1';
    el.style.touchAction = 'none';
    el.setAttribute('aria-keyshortcuts', 'ArrowDown ArrowUp Space Shift+Space');

    let wheelAcc = 0;
    let dragStart: number | null = null;
    let dragLast = 0;
    let dragAcc = 0;
    let dragging = false;
    let suppressClick = false;
    let suppressTimer: ReturnType<typeof setTimeout> | null = null;

    const markSuppress = () => {
        suppressClick = true;
        el.dataset.quickActive = '1';
        if (suppressTimer !== null && win) win.clearTimeout(suppressTimer);
        suppressTimer = win ? win.setTimeout(() => {
            suppressClick = false;
            suppressTimer = null;
            delete el.dataset.quickActive;
        }, 260) : null;
    };

    const onWheel = (e: WheelEvent) => {
        if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
        e.preventDefault();
        wheelAcc += e.deltaY;
        while (Math.abs(wheelAcc) >= WHEEL_STEP_PX) {
            const delta = wheelAcc > 0 ? 1 : -1;
            wheelAcc -= delta * WHEEL_STEP_PX;
            step(delta);
            markSuppress();
        }
    };

    const onKeyDown = (e: KeyboardEvent) => {
        let delta = 0;
        if (e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey)) delta = 1;
        else if (e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey)) delta = -1;
        if (delta === 0) return;
        e.preventDefault();
        e.stopPropagation();
        step(delta);
        markSuppress();
    };

    const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!e.isPrimary) return;
        dragStart = e.clientY;
        dragLast = e.clientY;
        dragAcc = 0;
        dragging = false;
        try { el.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    };

    const onPointerMove = (e: PointerEvent) => {
        if (dragStart === null || !e.isPrimary) return;
        const dy = e.clientY - dragLast;
        dragLast = e.clientY;
        if (!dragging && Math.abs(e.clientY - dragStart) < 8) return;
        dragging = true;
        dragAcc += dy;
        while (Math.abs(dragAcc) >= DRAG_STEP_PX) {
            const delta = dragAcc > 0 ? -1 : 1; // drag down = previous; drag up = next
            dragAcc -= (delta > 0 ? -1 : 1) * DRAG_STEP_PX;
            step(delta);
            markSuppress();
        }
        e.preventDefault();
    };

    const endDrag = (e: PointerEvent) => {
        if (dragStart === null) return;
        try { el.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
        dragStart = null;
        dragAcc = 0;
        dragging = false;
    };

    const onClickCapture = (e: MouseEvent) => {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressClick = false;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('click', onClickCapture, true);

    return {
        destroy() {
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('keydown', onKeyDown);
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', endDrag);
            el.removeEventListener('pointercancel', endDrag);
            el.removeEventListener('click', onClickCapture, true);
            if (suppressTimer !== null && win) win.clearTimeout(suppressTimer);
        },
        label(text: string) {
            el.title = `${text} — scroll, drag up/down or use arrow keys for the next symbol; tap to search`;
        },
    };
}

/** Exported for tests: the stable identity used to place the current symbol in the list. */
export { canonicalTicker };
