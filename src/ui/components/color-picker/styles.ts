export const COLOR_STYLE_ID = 'vela-ui-color';

export const COLOR_CSS = `
.vela-color-field{width:24px;height:24px;padding:2px;border:1px solid var(--vela-border);border-radius:0;background:var(--vela-surface-sunken);cursor:pointer;display:inline-flex;flex:none;}
.vela-color-field:hover{border-color:var(--vela-fg-muted);}
.vela-color-field-swatch{display:block;width:100%;height:100%;border-radius:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.25);}
.vela-color-field-circle{width:26px;height:26px;padding:3px;border:1px solid var(--vela-border-strong);border-radius:4px;background:transparent;overflow:hidden;}
.vela-color-field-circle .vela-color-field-swatch{border-radius:2px;box-shadow:none;}
.vela-color-field-pop{background:var(--vela-surface-overlay);border:1px solid var(--vela-border-strong);border-radius:0;box-shadow:var(--vela-shadow);padding:6px;max-height:calc(100vh - 12px);overflow-y:auto;overscroll-behavior:contain;}
.vela-color-picker{container:vela-color / inline-size;}
@container vela-color (max-width:135px){.vela-color-opacity-label{flex-basis:100%!important;}}
.vela-color-recents::-webkit-scrollbar{height:4px;}
.vela-color-recents::-webkit-scrollbar-thumb{background:var(--vela-scroll);}
.vela-color-palette button:focus-visible{outline:2px solid var(--vela-fg-bright)!important;outline-offset:2px;position:relative;z-index:2;}
.vela-color-recents button:focus-visible{outline:2px solid var(--vela-fg-bright);outline-offset:0;}
.vela-color-opacity-track:focus-visible{outline:2px solid var(--vela-fg-bright);outline-offset:3px;}
`;
