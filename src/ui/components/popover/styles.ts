export const POPOVER_STYLE_ID = 'vela-ui-popover-2';

export const POPOVER_CSS = `
/* A draggable popover may extend outside a transformed embedding host. Keep its
   overflow out of the page's scrollable area without clipping or blocking the chart. */
.vela-popover-layout-root {
    position: fixed; inset: 0; contain: layout; pointer-events: none;
    z-index: var(--vela-z-popover);
}
.vela-popover-layout-root > .vela-popover { pointer-events: auto; }
.vela-popover {
    position: fixed;
    z-index: var(--vela-z-popover);
    box-sizing: border-box;
    /* Never serve as a scroll anchor: the shell is portaled and re-placed between
       gestures, and anchoring against it jumps the scroller underneath. */
    overflow-anchor: none;
}
.vela-popover[data-position='absolute'] { position: absolute; }
/* A resized panel popover delegates its scrolling to the card, not the page. */
.vela-popover[data-panel-resized='1'] > :is(.vela-lm, .vela-tm) { box-sizing: border-box; height: 100%; max-height: 100%; overflow-y: auto; }
.vela-popover[hidden] { display: none !important; }
`;
