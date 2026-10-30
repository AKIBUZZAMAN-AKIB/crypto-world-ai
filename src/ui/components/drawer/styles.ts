export const DRAWER_STYLE_ID = 'vela-ui-drawer';

export const DRAWER_CSS = `
.vela-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: var(--vela-backdrop);
    z-index: var(--vela-z-dialog);
}
.vela-drawer-positioner {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: var(--vela-z-dialog);
}
/* Inside a shell that declares a size class, the sheet scopes to the SHELL's bounds
   (the widget root is position:relative) instead of the whole viewport — an embedded
   chart must not curtain the host page. */
[data-layout] .vela-drawer-backdrop, [data-layout] .vela-drawer-positioner { position: absolute; }
.vela-drawer {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow: var(--vela-shadow-dialog);
    font-size: 13px;
    box-sizing: border-box;
    width: 100%;
    max-height: 85%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
}
/* A phone sheet stretched across a 1280 px window is an empty room. Past tablet width
   every drawer keeps a dialog's column and stays centred (the ~420 px TradingView uses)
   — the same component, just not inflated by the viewport. */
@media (min-width: 720px) {
    .vela-drawer {
        width: 420px;
        max-height: 78%;
        margin-bottom: 32px;
        border-bottom: 1px solid var(--vela-border-strong);
        border-radius: 16px;
    }
}
.vela-drawer[data-state='open'] { animation: vela-drawer-in var(--vela-dur-med) var(--vela-ease); }
@keyframes vela-drawer-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
/* Desktop keeps its compact inline rail; phones get a separate resize strip. */
.vela-drawer-top {
    flex: none; min-height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
    cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
}
.vela-drawer-top:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-drawer-grab {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 26px;
    padding: 0;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
}
.vela-drawer[data-grip-row] { width: 100%; margin-bottom: 0; border-bottom: none; border-radius: 14px 14px 0 0; }
.vela-drawer[data-grip-row] > .vela-drawer-grab {
    flex: 0 0 24px; width: 100%; height: 24px; align-self: stretch;
}
.vela-drawer[data-grip-row] .vela-drawer-top,
.vela-drawer[data-grip-row] .vela-drawer-title { cursor: default; }
.vela-drawer[data-grip-row] .vela-drawer-top[data-untitled] { min-height: 24px; }
.vela-drawer-grab::before {
    content: '';
    width: 26px;
    height: 3px;
    border-radius: 2px;
    background: var(--vela-border-strong);
}
.vela-drawer-title {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--vela-fg-bright);
    user-select: none;
    touch-action: none;
    cursor: grab;
}
.vela-drawer-grab:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-drawer-title:empty { display: none; }
.vela-drawer-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    /* Vertical pans stay native scrolling; horizontal moves reach the sheet's gesture
       recognizer as pointer events (tab swipes). Without this the browser claims a
       sideways touch as a scroll attempt and CANCELS the pointer stream, so swipes
       never registered on real touch devices. Sideways-scrolling strips inside the
       body opt back in with their own touch-action: pan-x. */
    touch-action: pan-y;
    padding: 0 var(--vela-space-3) calc(var(--vela-space-3) + env(safe-area-inset-bottom, 0px));
}
.vela-drawer-body::-webkit-scrollbar { width: 8px; }
.vela-drawer-body::-webkit-scrollbar-thumb {
    background: var(--vela-scroll);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
`;
