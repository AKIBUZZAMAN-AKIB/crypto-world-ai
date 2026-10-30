import { overlayScrollbarCss } from '../../styles';

export const DIALOG_STYLE_ID = 'vela-ui-dialog-6';

export const DIALOG_CSS = `
.vela-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--vela-backdrop);
    z-index: var(--vela-z-dialog);
}
/* Non-dimming variant: still catches outside clicks, but the page stays readable. */
.vela-dialog-backdrop--clear { background: transparent; }
.vela-dialog-positioner {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: var(--vela-z-dialog);
}
.vela-dialog-backdrop[data-contained],
.vela-dialog-positioner[data-contained] { position: absolute; }
/* Keep a dragged card from increasing page overflow, but do not clip its visible body. */
[data-layout='desktop'] .vela-dialog-positioner { contain: layout; }
.vela-dialog-positioner[data-align='center'] {
    align-items: center;
    padding-top: 0;
}
.vela-dialog {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 10px;
    box-shadow: var(--vela-shadow-dialog);
    box-sizing: border-box;
    font-size: 13px;
    min-width: 300px;
    max-width: min(92vw, 560px);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
}
.vela-dialog[data-state='open'] { animation: vela-dialog-in var(--vela-dur-med) var(--vela-ease); }
@keyframes vela-dialog-in {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-dialog-header {
    display: flex;
    align-items: center;
    padding: 4px 8px 4px 10px;
    min-height: 40px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--vela-border);
    user-select: none;
}
.vela-dialog-header:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-dialog[data-dragging='1'] .vela-dialog-header { cursor: grabbing !important; }
.vela-dialog-titlewrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vela-dialog-kicker { font-size: 9.5px; font-weight: 750; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vela-fg-muted); }
.vela-dialog-title { font-size: 14px; font-weight: 600; letter-spacing: 0.1px; color: var(--vela-fg-bright); }
.vela-dialog-close {
    all: unset;
    cursor: pointer;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    line-height: 1;
    font-size: 15px;
}
.vela-dialog-close:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dialog-corner-resize {
    all: unset; box-sizing: border-box; display: inline-flex; flex: none; width: 26px; height: 26px;
    align-items: center; justify-content: center; border-radius: 4px; color: var(--vela-fg-muted);
    cursor: nesw-resize; touch-action: none; user-select: none; -webkit-user-select: none;
}
.vela-dialog-corner-resize .vela-icon { width: 16px; height: 16px; }
.vela-dialog-corner-resize:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dialog-corner-resize:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-dialog-body { padding: var(--vela-space-4); overflow: auto; min-height: 0; flex: 1 1 auto; }
.vela-dialog-body[data-flush] { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.vela-dialog-footer { flex: 0 0 auto; }
.vela-dialog--settings {
    width: fit-content;
    min-width: min(560px, 94vw);
    max-width: min(720px, 94vw);
    max-height: 70vh;
    font-size: 13px;
    cursor: default;
}
.vela-dialog--form {
    width: fit-content;
    min-width: min(380px, 90%);
    max-width: min(640px, 94%);
    max-height: 82%;
    font-size: 14px;
}
/* Form dialogs (indicator inputs, drawing settings): the tab strip / body owns the
   line under the header, and the footer carries its own top delimiter. */
.vela-dialog--form .vela-dialog-header { align-items: center; padding: 4px 10px; border-bottom: 1px solid var(--vela-border); }
.vela-dialog--form .vela-dialog-title { font-size: 14px; line-height: 20px; }
.vela-dialog--form .vela-dialog-footer {
    padding: 16px 20px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    border-top: 1px solid var(--vela-border);
}
.vela-dialog-btn {
    cursor: pointer;
    height: 34px;
    padding: 0 11px;
    border-radius: 6px;
    border: 1px solid var(--vela-border-strong);
    background: transparent;
    color: var(--vela-fg);
    font-weight: 400;
    font-size: 14px;
    font-family: inherit;
    transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease, opacity var(--vela-dur-fast) ease, border-color var(--vela-dur-fast) ease;
}
.vela-dialog-btn:hover { background: var(--vela-hover); color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-dialog-btn-primary { border-color: var(--vela-selected-bg); background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-dialog-btn-primary:hover { background: color-mix(in srgb, var(--vela-selected-bg) 92%, #000); color: var(--vela-selected-fg); opacity: 1; border-color: var(--vela-selected-bg); }
/* Touch: a dialog's footer actions are the last thing a thumb reaches for, and 34px is
   under the 44px every platform's guidance asks for. The chip grows, it does not move. */
@media (pointer: coarse) {
    .vela-dialog-footer .vela-dialog-btn { height: auto; min-height: 44px; padding: 0 14px; }
}
${overlayScrollbarCss('.vela-dialog-body')}
/* Scrollers NESTED in a dialog (a flush body's grid, a tab pane) get the same thin
   overlay bars — the two-class selectors below stay overridable by more specific
   per-dialog sheets. */
${overlayScrollbarCss('.vela-dialog *')}
/* On phones use a bounded card rather than forcing every dialog fullscreen. The
   card can move by its header; the body keeps its own scroll and the chart remains
   visible around it. Percentages are relative to the embedded workspace, not just
   the physical viewport. */
[data-layout='mobile'] .vela-dialog-backdrop { position: absolute; }
[data-layout='mobile'] .vela-dialog-positioner {
    position: absolute;
    padding: 8px;
    align-items: center;
}
[data-layout='mobile'] .vela-dialog {
    width: min(480px, 100%);
    min-width: 0;
    max-width: 100%;
    max-height: calc(100% - 16px);
    flex: 0 1 auto;
    border: 1px solid var(--vela-border-strong);
    border-radius: 12px;
}
[data-layout='mobile'] .vela-dialog-close { width: 40px; height: 40px; }
[data-layout='mobile'] .vela-dialog-body { padding-bottom: calc(var(--vela-space-4) + env(safe-area-inset-bottom, 0px)); }
`;
