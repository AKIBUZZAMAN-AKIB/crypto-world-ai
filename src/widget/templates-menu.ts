// The TEMPLATES MENU — TradingView's "Indicator templates" dropdown, sitting beside the
// Indicators button in the top toolbar, which is exactly where TV puts it.
//
// Research that fixes the shape (TradingView's own "What are indicator templates" guide,
// the charting-library docs, and the walkthroughs):
//   • a template is a SET OF INDICATORS with their exact settings — not a layout: no
//     drawings, and the symbol/timeframe only when the trader asks for them ("Remember
//     interval" is TV's opt-in checkbox, the one the guides keep circling back to);
//   • clicking a template APPLIES it and replaces the chart's current indicator set —
//     templates never stack;
//   • the menu also carries "Save indicator template…", per-row management (rename,
//     export, delete) and, on a multi-chart layout, "Apply to all charts";
//   • "Set as default" makes the template the set a NEW chart opens with (TV hangs that
//     off the template name; here it is the row's star, the same control the mobile
//     drawer and the layout picker already use).
//
// Vela already owned the store and every verb (VelaWorkspace.saveTemplate / applyTemplate /
// renameTemplate / deleteTemplate / setDefaultTemplate / export·importTemplate). What was
// missing was the DOOR: the picker's template pane and the phone drawer's row were the only
// ways in, so this menu is chrome over the same contract, not a second implementation.
import { Dialog } from '../ui/components/dialog';
import { Popover } from '../ui/components/popover';
import { downloadText } from '../ui/download';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { panelResizeGrip } from '../ui/panel-drag';
import type { WorkspaceToolPanel } from './workspace-tool-panel';
import {
    favoriteKeyForBuiltin,
    favoriteKeyForTemplate,
    INDICATOR_TEMPLATE_TABS,
    templatesForTab,
    type IndicatorTemplateBuiltin,
    type IndicatorTemplateTab,
} from './indicator-templates';

let templatesMenuSequence = 0;
export const TEMPLATES_MENU_STYLE_ID = 'vela-templates-menu';

export const TEMPLATES_MENU_CSS = `
.vela-tm {
    width: min(344px, calc(100vw - 24px));
    max-height: min(72vh, 560px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    box-sizing: border-box;
    color: var(--vela-fg);
    font-size: 13px;
    /* The popover shell is a transparent positioner: the panel owns its surface, edge
       and lift, or the chart reads straight through the menu. */
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border-strong);
    border-radius: 12px;
    box-shadow: var(--vela-shadow-dialog);
}
.vela-tm-tabs {
    display: flex;
    gap: 3px;
    margin: 2px 6px 6px;
    padding: 3px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    background: var(--vela-surface);
    overflow-x: auto;
    scrollbar-width: none;
}
.vela-tm-tabs::-webkit-scrollbar { display: none; }
.vela-tm-tab {
    all: unset;
    box-sizing: border-box;
    flex: 0 0 auto;
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
}
.vela-tm-tab:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-tm-tab[data-active='1'] { color: var(--vela-fg-on-fill); background: var(--vela-accent); }
.vela-tm-tab:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-tm-fav[data-on='1'] { color: var(--vela-accent-ink, var(--vela-accent)); }
.vela-tm-head { position: sticky; top: -6px; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: var(--vela-surface-elev); }
.vela-tm-mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent-ink, var(--vela-accent));
    font-size: 16px;
}
.vela-tm-headid { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-tm-title {
    font-size: 14px;
    font-weight: 650;
    color: var(--vela-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-sub {
    font-size: 11.5px;
    color: var(--vela-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-sub[data-house='1'] { color: var(--vela-accent-ink, var(--vela-accent)); font-weight: 550; }
/* The list is one focusable group: rows are buttons, so a keyboard user tabs the set. */
.vela-tm-list { display: flex; flex-direction: column; gap: 1px; }
.vela-tm-row {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
}
.vela-tm-row:hover { background: var(--vela-hover); }
.vela-tm-row:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
@media (pointer: coarse) {
    .vela-tm-dialog .vela-tm-row { min-height: 44px; padding-block: 8px; }
    .vela-tm-dialog .vela-tm-ico { min-height: 44px; }
}
.vela-tm-row[data-current='1'] { background: var(--vela-hover-strong); }
.vela-tm-glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent-ink, var(--vela-accent));
    font-size: 13px;
}
.vela-tm-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-tm-name {
    font-size: 13px;
    font-weight: 550;
    color: var(--vela-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-meta {
    font-size: 11px;
    color: var(--vela-fg-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-badge {
    flex: none;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent-ink, var(--vela-accent));
}
.vela-tm-ico {
    all: unset;
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    font-size: 14px;
}
.vela-tm-ico:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-tm-ico[data-on='1'] { color: var(--vela-star, var(--vela-accent)); }
.vela-tm-ico:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
/* The kebab strip: TV hides per-template verbs behind the row's context menu; a second
   tap on the same row is the same information with a visible target. */
.vela-tm-strip { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 8px 8px 40px; }
.vela-tm-chip {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--vela-border);
    background: var(--vela-surface);
    color: var(--vela-fg);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
}
.vela-tm-chip:hover { background: var(--vela-hover); }
.vela-tm-chip:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: 1px; }
.vela-tm-chip[data-danger='1'] { color: var(--vela-down, #e5484d); border-color: var(--vela-down, #e5484d); } /* palette-exempt: var() fallback for a menu portalled outside the token scope */
.vela-tm-sep { height: 1px; margin: 5px 6px; background: var(--vela-border); }
.vela-tm-group {
    margin: 8px 0 2px;
    padding: 0 8px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-tm-glyph--builtin { background: transparent; border: 1px solid var(--vela-border-strong); color: var(--vela-fg-muted); }
.vela-tm-empty {
    padding: 4px 10px 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--vela-fg-muted);
}
.vela-tm-form { display: flex; flex-direction: column; gap: 6px; padding: 4px 8px 8px; }
.vela-tm-input {
    box-sizing: border-box;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 7px;
    background: var(--vela-surface);
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 12.5px;
}
.vela-tm-input:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }
.vela-tm-check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-tm-check input { margin: 0; accent-color: var(--vela-accent); }
.vela-tm-formrow { display: flex; gap: 6px; }
.vela-tm-formrow .vela-tm-input { flex: 1 1 auto; min-width: 0; }
.vela-tm-primary {
    all: unset;
    box-sizing: border-box;
    flex: none;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 12.5px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
}
.vela-tm-primary:hover { background: color-mix(in srgb, var(--vela-accent) 92%, #000); }
.vela-tm-primary:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: 2px; }
.vela-tm-act {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--vela-fg);
    font-size: 12.5px;
    cursor: pointer;
}
.vela-tm-act:hover { background: var(--vela-hover); }
.vela-tm-act:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-tm-act .vela-icon { font-size: 14px; color: var(--vela-fg-muted); }
.vela-tm-flash {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 16px;
    margin: 2px 8px 4px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
}
.vela-tm-flash[data-tone='ok'] { color: var(--vela-up); }
.vela-tm-flash[data-tone='bad'] { color: var(--vela-down, #e5484d); } /* palette-exempt: var() fallback for a menu portalled outside the token scope */
/* The phone's More-drawer door opens the SAME surface as a compact centred card. */
.vela-tm-dialog { width: min(360px, calc(100vw - 24px)) !important; max-width: calc(100vw - 24px) !important; }
.vela-tm-dialog .vela-dialog-body { padding: 0; max-height: none; overflow: auto; }
.vela-tm-dialog .vela-tm { width: 100%; border: 0; box-shadow: none; max-height: none; }
/* A workspace pane already has a shell. The premium popover skin must not add a
   second card, inset track or raised tiles inside it. Scope these rules to the pane so
   the standalone popover and dialog keep their own surface and behavior. */
.vela-panel.vela-templates-panel .vela-panel-body {
    display: flex; flex-direction: column; overflow: hidden; padding: 0; container-type: inline-size;
}
.vela-panel.vela-templates-panel .vela-tm {
    display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0;
    width: 100%; height: 100%; max-height: none; overflow: hidden; padding: 0;
    border: 0; border-radius: 0; background: transparent; box-shadow: none;
}
/* A short pane must let the entire save form scroll into view, including its checkbox. */
.vela-panel.vela-templates-panel .vela-tm[data-saving='1'] { overflow-x: hidden; overflow-y: auto; }
.vela-panel.vela-templates-panel .vela-tm-tabs {
    flex: none; gap: 0; min-width: 0; margin: 0; padding: 0 8px;
    border: 0; border-bottom: 1px solid var(--vela-border); border-radius: 0;
    background: transparent; box-shadow: none; scrollbar-width: none;
}
.vela-panel.vela-templates-panel .vela-tm-tab {
    display: inline-flex; align-items: center; justify-content: center;
    box-sizing: border-box; height: 40px; min-height: 40px; padding: 0 10px;
    border: 0; border-bottom: 2px solid transparent; border-radius: 0;
    background: transparent; box-shadow: none; color: var(--vela-fg-muted);
    font-size: 12px; font-weight: 600; letter-spacing: 0;
}
.vela-panel.vela-templates-panel .vela-tm-tab:hover {
    background: var(--vela-hover); color: var(--vela-fg-bright); box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-tab[data-active='1'] {
    background: transparent; color: var(--vela-accent-ink, var(--vela-accent));
    border-bottom-color: var(--vela-accent-ink, var(--vela-accent)); box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-tab:active { transform: none; }
.vela-panel.vela-templates-panel .vela-tm-toolbar {
    display: flex; flex: none; align-items: center; gap: 2px; min-width: 0;
    min-height: 42px; padding: 3px 8px; border-bottom: 1px solid var(--vela-border);
}
.vela-panel.vela-templates-panel .vela-tm-pane-summary {
    flex: 1 1 auto; min-width: 0; padding: 0 4px; overflow: hidden;
    color: var(--vela-fg-muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap;
}
.vela-panel.vela-templates-panel .vela-tm-pane-summary[data-house='1'] { color: var(--vela-accent-ink, var(--vela-accent)); }
.vela-panel.vela-templates-panel .vela-tm-toolbar .vela-tm-act {
    display: inline-flex; flex: none; align-items: center; gap: 5px; width: auto;
    height: 34px; min-height: 34px; padding: 0 7px; border: 0; border-radius: 3px;
    background: transparent; box-shadow: none; font-size: 12px; white-space: nowrap;
}
.vela-panel.vela-templates-panel .vela-tm-toolbar .vela-tm-save { color: var(--vela-accent-ink, var(--vela-accent)); }
.vela-panel.vela-templates-panel .vela-tm-toolbar .vela-tm-act:hover { background: var(--vela-hover); }
.vela-panel.vela-templates-panel .vela-tm-list {
    display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0;
    overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 4px 8px 8px;
    scrollbar-width: thin; scrollbar-color: var(--vela-scroll) transparent;
}
.vela-panel.vela-templates-panel .vela-tm-list::-webkit-scrollbar { width: 8px; }
.vela-panel.vela-templates-panel .vela-tm-list::-webkit-scrollbar-thumb {
    background: var(--vela-scroll); border: 2px solid transparent; background-clip: padding-box;
}
.vela-panel.vela-templates-panel .vela-tm-item,
.vela-panel.vela-templates-panel .vela-tm-item > div { min-width: 0; }
.vela-panel.vela-templates-panel .vela-tm-row {
    min-width: 0; min-height: 44px; padding: 6px; border: 0; border-radius: 0;
    background: transparent; box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-row:hover { background: var(--vela-hover); border: 0; }
.vela-panel.vela-templates-panel .vela-tm-row[data-current='1'] { background: var(--vela-hover); }
.vela-panel.vela-templates-panel .vela-tm-row:active { transform: none; }
.vela-panel.vela-templates-panel .vela-tm-glyph {
    width: 22px; height: 22px; border: 0; border-radius: 0;
    background: transparent; box-shadow: none; color: var(--vela-fg-muted);
}
.vela-panel.vela-templates-panel .vela-tm-glyph .vela-icon { width: 16px; height: 16px; }
.vela-panel.vela-templates-panel .vela-tm-badge { padding: 0 3px; border-radius: 0; background: transparent; }
.vela-panel.vela-templates-panel .vela-tm-ico {
    box-sizing: border-box; width: 32px; height: 32px; border: 0; border-radius: 3px; box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-strip { gap: 2px; padding: 1px 6px 7px 34px; }
.vela-panel.vela-templates-panel .vela-tm-chip {
    max-width: 100%; height: auto; min-height: 30px; padding: 5px 7px; border: 0; border-radius: 3px;
    background: transparent; box-shadow: none; font-size: 11.5px; font-weight: 500; white-space: normal;
}
.vela-panel.vela-templates-panel .vela-tm-chip span { min-width: 0; overflow-wrap: anywhere; }
.vela-panel.vela-templates-panel .vela-tm-chip:hover { background: var(--vela-hover); box-shadow: none; }
.vela-panel.vela-templates-panel .vela-tm-chip[data-danger='1'] { color: var(--vela-down, #e5484d); } /* palette-exempt: var() fallback */
.vela-panel.vela-templates-panel .vela-tm-group { padding: 6px; margin: 0; }
.vela-panel.vela-templates-panel .vela-tm-empty { padding: 12px 6px; }
.vela-panel.vela-templates-panel .vela-tm-form { flex: none; padding: 8px 12px; border-bottom: 1px solid var(--vela-border); }
.vela-panel.vela-templates-panel .vela-tm .vela-tm-input {
    min-width: 0; border-radius: 3px; background: var(--vela-surface); box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm .vela-tm-input:focus { box-shadow: none; }
.vela-panel.vela-templates-panel .vela-tm .vela-tm-check input { box-shadow: none; }
.vela-panel.vela-templates-panel .vela-tm-primary {
    border-radius: 3px; border: 0; background: var(--vela-accent); color: var(--vela-fg-on-fill); box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-primary:hover { background: color-mix(in srgb, var(--vela-accent) 92%, #000); }
.vela-panel.vela-templates-panel :is(.vela-tm-tab, .vela-tm-row, .vela-tm-ico, .vela-tm-act, .vela-tm-chip, .vela-tm-input, .vela-tm-primary):focus-visible {
    outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; box-shadow: none;
}
.vela-panel.vela-templates-panel .vela-tm-flash {
    flex: none; min-height: 0; margin: 0; padding: 7px 12px; border-top: 1px solid var(--vela-border);
}
.vela-panel.vela-templates-panel .vela-tm-flash:empty { display: none; }
/* In narrow or embedded hosts, keep full-size row actions without squeezing a template
   name down to a few characters. The name may wrap to two lines; its accessible label
   still carries the full text. */
@container (max-width: 260px) {
    .vela-panel.vela-templates-panel .vela-tm-glyph { display: none; }
    .vela-panel.vela-templates-panel .vela-tm-name {
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
        white-space: normal; overflow-wrap: anywhere; line-height: 1.3;
    }
    .vela-panel.vela-templates-panel .vela-tm-strip { padding-left: 6px; }
}
/* At the minimum floating height the entire body scrolls instead of trapping a
   zero-height list beneath fixed tabs and controls. */
.vela-panel.vela-templates-panel[data-compact-height] .vela-panel-body { overflow: auto; }
.vela-panel.vela-templates-panel[data-compact-height] .vela-tm { flex: none; height: auto; overflow: visible; }
.vela-panel.vela-templates-panel[data-compact-height] .vela-tm-list { flex: none; min-height: 120px; overflow: visible; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-row { min-height: 44px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-ico { width: 40px; height: 40px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-tab { height: 44px; min-height: 44px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-chip { min-height: 40px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-toolbar .vela-tm-act,
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-primary { height: 40px; min-height: 40px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-input { height: 40px; font-size: 16px; }
[data-layout='mobile'] .vela-panel.vela-templates-panel .vela-tm-check { min-height: 40px; }

`;

/** One saved template, as the menu lists it. */
export interface TemplatesMenuRow {
    name: string;
    count: number;
    /** Present only when the template was saved with "remember the market". */
    symbol?: string;
    timeframe?: string;
}

export interface TemplatesMenuOptions {
    /** The saved templates, read fresh on every open (and after every verb). */
    templates: () => TemplatesMenuRow[];
    /** Apply: `'all'` is TV's "Apply to all charts". Returns how many charts changed. */
    onApply?: (name: string, target: 'active' | 'all') => number;
    onSave?: (name: string, includeMarket: boolean) => boolean;
    onDelete?: (name: string) => void;
    onRename?: (from: string, to: string) => boolean;
    onExport?: (name: string) => string | null;
    onImport?: (json: string) => string | null;
    /** The template new charts start from (the row star). */
    defaultTemplate?: () => string | null;
    onSetDefault?: (name: string | null) => void;
    /** How many charts the layout has — gates "Apply to all charts". */
    chartCount?: () => number;
    /** TradingView's six read-only built-ins, split across Technical and Financial. Applying
     *  one always REPLACES the chart's indicators — the same contract as a saved one. */
    builtins?: () => IndicatorTemplateBuiltin[];
    onApplyBuiltin?: (id: string) => void;
    /** `template:<name>` / `builtin:<id>` keys shown on the Favorites tab. */
    favorites?: () => string[];
    onToggleFavorite?: (key: string, on: boolean) => void;
    onOpenChange?: (open: boolean) => void;
}

export class TemplatesMenu {
    private readonly opts: TemplatesMenuOptions;
    private readonly tabBase = `vela-template-tabs-${++templatesMenuSequence}`;
    private doc: Document;
    private popover: Popover | null = null;
    private dialog: Dialog | null = null;
    private pane: WorkspaceToolPanel | null = null;
    private panel: HTMLElement | null = null;
    private trigger: HTMLElement | null = null;
    /** The active Favorites / My templates / Technical / Financial category. */
    private tab: IndicatorTemplateTab = 'my';
    /** Row whose verb strip is unfolded (one at a time). */
    private openRow: string | null = null;
    /** Delete armed for this row — the two-tap convention the rest of the chrome uses. */
    private armed: string | null = null;
    /** Row being renamed in place, and the text in its field (kept after a refusal). */
    private renaming: string | null = null;
    private renameDraft: string | null = null;
    /** The save form is unfolded. */
    private saving = false;
    /** Inline feedback, cleared on the next render. */
    private flash: { text: string; tone?: 'ok' | 'bad' } | null = null;

    constructor(opts: TemplatesMenuOptions) {
        this.opts = opts;
        this.doc = document;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
    }

    get isOpen(): boolean {
        return this.pane?.open === true || this.popover?.open === true || this.dialog?.open === true;
    }

    /** Attach the same template actions to a workspace pane instead of a popup. */
    attachPanel(pane: WorkspaceToolPanel): void {
        this.pane = pane;
        this.doc = pane.el.ownerDocument;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
        this.panel = pane.content;
        this.panel.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented || (!this.openRow && !this.saving && !this.renaming)) return;
            const rowName = this.renaming ?? this.openRow;
            this.openRow = null;
            this.armed = null;
            this.renaming = null;
            this.renameDraft = null;
            this.saving = false;
            event.preventDefault();
            event.stopPropagation();
            this.render();
            const row = rowName ? [...(this.panel?.querySelectorAll<HTMLElement>('.vela-tm-item') ?? [])]
                .find((el) => el.dataset.name === rowName) : null;
            (row?.querySelector<HTMLElement>('.vela-tm-kebab') ?? this.panel?.querySelector<HTMLElement>('.vela-tm-save'))
                ?.focus({ preventScroll: true });
        });
        pane.onVisibilityChange = (open, userOpening) => {
            if (open) {
                this.beginOpen();
                this.render();
                if (userOpening && !pane.el.closest('[data-layout="mobile"]')) {
                    setTimeout(() => { if (pane.open) this.panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }); }, 0);
                }
            } else {
                this.openRow = null;
                this.armed = null;
                this.renaming = null;
                this.renameDraft = null;
                this.saving = false;
            }
            this.opts.onOpenChange?.(open);
        };
    }

    /** Reset transient row state when the panel is opened from a new door. */
    private beginOpen(): void {
        this.tab = 'my';
        this.openRow = null;
        this.armed = null;
        this.renaming = null;
        this.renameDraft = null;
        this.saving = false;
        this.flash = null;
    }

    /** Switch categories the same way for pointer and keyboard navigation. */
    private selectTab(tab: IndicatorTemplateTab): void {
        this.tab = tab;
        this.openRow = null;
        this.armed = null;
        this.renaming = null;
        this.renameDraft = null;
        this.saving = false;
        this.flash = null;
        this.render();
    }

    /** Open under the button (or toggle it shut). */
    open(trigger: HTMLElement): void {
        if (this.pane) {
            if (this.pane.open) this.pane.toggle(false);
            else this.pane.showFrom(trigger);
            return;
        }
        if (this.popover?.open) {
            this.popover.hide();
            return;
        }
        this.dialog?.hide();
        this.trigger = trigger;
        this.doc = trigger.ownerDocument;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
        this.beginOpen();
        const popover = new Popover({
            trigger,
            className: 'vela-tm-pop',
            gap: 6,
            align: 'start',
            content: (body) => {
                this.panel = body;
                body.setAttribute('role', 'dialog');
                body.setAttribute('aria-label', 'Indicator templates');
                this.render();
            },
            onClose: () => {
                this.popover = null;
                this.panel = null;
                this.openRow = null;
                this.armed = null;
                this.renaming = null;
                this.renameDraft = null;
                this.saving = false;
                this.opts.onOpenChange?.(false);
                this.trigger?.focus({ preventScroll: true });
            },
        });
        this.popover = popover;
        popover.show();
        this.opts.onOpenChange?.(true);
        setTimeout(() => {
            this.panel?.querySelector<HTMLElement>('.vela-tm-row, .vela-tm-primary')?.focus({ preventScroll: true });
        }, 0);
    }

    /** Open the SAME panel as a centred non-modal dialog — the phone's More-drawer door. */
    openDialog(host: HTMLElement): void {
        if (this.pane) { this.pane.showFrom(); return; }
        if (this.dialog?.open) {
            this.dialog.hide();
            return;
        }
        this.popover?.hide();
        this.doc = host.ownerDocument;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
        this.beginOpen();
        const dialog = new Dialog({
            title: 'Indicator templates',
            headerIcon: 'templates',
            host,
            className: 'vela-tm-dialog',
            modal: false,
            align: 'center',
            closeOnInteractOutside: true,
            content: (body) => {
                this.panel = body;
                body.setAttribute('role', 'dialog');
                body.setAttribute('aria-label', 'Indicator templates');
                this.render();
            },
            onOpenChange: (open) => {
                if (open) return;
                this.dialog = null;
                this.panel = null;
                this.openRow = null;
                this.armed = null;
                this.renaming = null;
                this.renameDraft = null;
                this.saving = false;
                this.opts.onOpenChange?.(false);
            },
        });
        this.dialog = dialog;
        dialog.show();
        this.opts.onOpenChange?.(true);
    }

    close(): void {
        this.pane?.toggle(false);
        this.popover?.hide();
        this.dialog?.hide();
    }

    /** Repaint from live state (a template saved, favorited or applied elsewhere). */
    refresh(): void {
        if (this.isOpen) this.render();
    }

    destroy(): void {
        this.popover?.destroy();
        this.dialog?.destroy();
        this.pane?.destroy();
        this.pane = null;
        this.popover = null;
        this.dialog = null;
        this.panel = null;
    }

    // ── rendering ───────────────────────────────────────────────────────────────

    private render(): void {
        const panel = this.panel;
        if (!panel) return;
        const d = this.doc;
        const active = d.activeElement as HTMLElement | null;
        const focusKey = active && panel.contains(active) ? active.dataset.tmFocus : undefined;
        const focusRow = active?.closest<HTMLElement>('.vela-tm-item')?.dataset.name;
        const activeSaveInput = focusKey === 'form:name' ? active as HTMLInputElement : null;
        const selection = activeSaveInput ? { start: activeSaveInput.selectionStart, end: activeSaveInput.selectionEnd,
            direction: activeSaveInput.selectionDirection } : null;
        const saveDraft = this.saving ? panel.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-input')?.value ?? '' : '';
        const saveMarket = this.saving && (panel.querySelector<HTMLInputElement>('.vela-tm-form .vela-tm-check input')?.checked ?? false);
        const previousList = panel.querySelector<HTMLElement>('.vela-tm-list');
        const listScroll = previousList?.dataset.tab === this.tab ? previousList.scrollTop : 0;
        const tabsScroll = panel.querySelector<HTMLElement>('.vela-tm-tabs')?.scrollLeft ?? 0;
        const formScroll = this.saving ? panel.querySelector<HTMLElement>('.vela-tm')?.scrollTop ?? 0 : 0;
        const bodyScroll = panel.scrollTop;
        const rows = this.opts.templates();
        const builtins = this.opts.builtins?.() ?? [];
        const favorites = this.opts.favorites?.() ?? [];
        const fav = new Set(favorites);
        const house = this.opts.defaultTemplate?.() ?? null;
        const charts = this.opts.chartCount?.() ?? 1;
        const view = templatesForTab(this.tab, rows, builtins, favorites);

        const card = d.createElement('div');
        card.className = 'vela-tm';
        if (this.saving) card.dataset.saving = '1';

        // ── head: what this is, how many, and what new charts start from ──
        const head = d.createElement('div');
        head.className = 'vela-tm-head';
        head.tabIndex = 0;
        head.setAttribute('aria-label', 'Move indicator templates panel');
        const mark = d.createElement('span');
        mark.className = 'vela-tm-mark';
        mark.appendChild(iconEl('templates', d));
        const headId = d.createElement('div');
        headId.className = 'vela-tm-headid';
        const title = d.createElement('b');
        title.className = 'vela-tm-title';
        title.textContent = 'Indicator templates';
        const sub = d.createElement('span');
        sub.className = 'vela-tm-sub';
        if (house) {
            sub.textContent = `New charts start with “${house}”`;
            sub.dataset.house = '1';
        } else {
            sub.textContent = rows.length === 0 ? 'No saved templates' : `${rows.length} saved`;
        }
        headId.append(title, sub);
        let summary: HTMLDivElement | null = null;
        if (this.pane) {
            summary = d.createElement('div');
            summary.className = 'vela-tm-pane-summary';
            if (this.tab === 'favorites') {
                const count = view.rows.length + view.builtins.length;
                summary.textContent = count === 0 ? 'No favorites' : `${count} favorite${count === 1 ? '' : 's'}`;
            } else {
                summary.textContent = sub.textContent;
                if (house) summary.dataset.house = '1';
            }
            summary.title = summary.textContent ?? '';
        } else {
            head.append(mark, headId, panelResizeGrip(d, 'indicator templates panel'));
            card.appendChild(head);
        }

        // ── the four required categories ──
        const tabs = d.createElement('div');
        tabs.className = 'vela-tm-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Indicator template categories');
        for (const t of INDICATOR_TEMPLATE_TABS) {
            const b = d.createElement('button');
            b.type = 'button';
            b.className = 'vela-tm-tab';
            b.dataset.tab = t.id;
            b.dataset.tmFocus = `tab:${t.id}`;
            b.textContent = t.label;
            b.id = `${this.tabBase}-tab-${t.id}`;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-controls', `${this.tabBase}-view`);
            b.setAttribute('aria-selected', String(this.tab === t.id));
            if (this.tab === t.id) b.dataset.active = '1';
            b.tabIndex = this.tab === t.id ? 0 : -1;
            b.addEventListener('click', () => this.selectTab(t.id));
            b.addEventListener('keydown', (e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                const at = INDICATOR_TEMPLATE_TABS.findIndex((x) => x.id === this.tab);
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? INDICATOR_TEMPLATE_TABS.length - 1
                    : (at + (e.key === 'ArrowRight' ? 1 : -1) + INDICATOR_TEMPLATE_TABS.length) % INDICATOR_TEMPLATE_TABS.length;
                this.selectTab(INDICATOR_TEMPLATE_TABS[next]!.id);
                this.panel?.querySelector<HTMLElement>(`.vela-tm-tab[data-tab="${this.tab}"]`)?.focus();
            });
            tabs.appendChild(b);
        }
        card.appendChild(tabs);

        // Library controls stay above the list in the workspace pane, even when the
        // saved collection is long. The compact standalone menu keeps its old order.
        const library = this.tab === 'my' || this.tab === 'favorites';
        if (this.pane && library) {
            const toolbar = d.createElement('div');
            toolbar.className = 'vela-tm-toolbar';
            if (summary) toolbar.appendChild(summary);
            if (this.opts.onSave) {
                const save = this.action(this.saving ? 'close' : 'plus', this.saving ? 'Cancel' : 'Save', () => {
                    this.saving = !this.saving;
                    this.openRow = null;
                    this.flash = null;
                    this.render();
                    if (this.saving) this.panel?.querySelector<HTMLInputElement>('.vela-tm-input')?.focus();
                });
                save.classList.add('vela-tm-save');
                save.dataset.tmFocus = 'library:save';
                save.title = this.saving ? 'Cancel saving a template' : 'Save indicator template';
                save.setAttribute('aria-label', save.title);
                save.setAttribute('aria-expanded', String(this.saving));
                toolbar.appendChild(save);
            }
            if (this.opts.onImport) {
                const importBtn = this.action('upload', 'Import', () => this.pickFile());
                importBtn.classList.add('vela-tm-import');
                importBtn.dataset.tmFocus = 'library:import';
                importBtn.title = 'Import template file';
                importBtn.setAttribute('aria-label', importBtn.title);
                toolbar.appendChild(importBtn);
            }
            card.appendChild(toolbar);
            if (this.saving) card.appendChild(this.saveForm(saveDraft, saveMarket));
        }

        // ── the filtered list ──
        const list = d.createElement('div');
        list.className = 'vela-tm-list';
        list.dataset.tab = this.tab;
        list.id = `${this.tabBase}-view`;
        list.setAttribute('role', 'tabpanel');
        list.setAttribute('aria-labelledby', `${this.tabBase}-tab-${this.tab}`);
        if (view.rows.length === 0 && view.builtins.length === 0) {
            const empty = d.createElement('div');
            empty.className = 'vela-tm-empty';
            empty.textContent = view.empty;
            list.appendChild(empty);
        }
        for (const row of view.rows) list.appendChild(this.renderRow(row, house, charts, fav));
        if (view.builtins.length > 0) {
            if (!this.pane || (this.tab === 'favorites' && view.rows.length > 0)) {
                const group = d.createElement('div');
                group.className = 'vela-tm-group';
                group.textContent = this.tab === 'favorites' ? 'Favorite built-ins' : this.tab === 'financial' ? 'Financial' : 'Technical';
                list.appendChild(group);
            }
            for (const built of view.builtins) list.appendChild(this.renderBuiltin(built, fav));
        }
        card.appendChild(list);

        // Save/import belong to the user's own template library.
        if (!this.pane && library) {
            const sep = d.createElement('div');
            sep.className = 'vela-tm-sep';
            card.appendChild(sep);
            if (this.saving) card.appendChild(this.saveForm(saveDraft, saveMarket));
            else if (this.opts.onSave) {
                const save = this.action('plus', 'Save indicator template…', () => {
                    this.saving = true;
                    this.openRow = null;
                    this.flash = null;
                    this.render();
                    this.panel?.querySelector<HTMLInputElement>('.vela-tm-input')?.focus();
                });
                save.classList.add('vela-tm-save');
                card.appendChild(save);
            }
            if (this.opts.onImport) {
                const importBtn = this.action('upload', 'Import template file…', () => this.pickFile());
                importBtn.classList.add('vela-tm-import');
                card.appendChild(importBtn);
            }
        }

        // ── status line ──
        const flash = d.createElement('div');
        flash.className = 'vela-tm-flash';
        flash.setAttribute('role', 'status');
        flash.setAttribute('aria-live', 'polite');
        if (this.flash) {
            flash.textContent = this.flash.text;
            if (this.flash.tone) flash.dataset.tone = this.flash.tone;
        }
        card.appendChild(flash);

        panel.replaceChildren(card);
        if (listScroll > 0) list.scrollTop = listScroll;
        if (tabsScroll !== 0) tabs.scrollLeft = tabsScroll;
        if (formScroll > 0) card.scrollTop = formScroll;
        if (bodyScroll > 0) panel.scrollTop = bodyScroll;
        if (focusKey) {
            const target = [...panel.querySelectorAll<HTMLElement>('[data-tm-focus]')].find((el) => el.dataset.tmFocus === focusKey);
            if (target) {
                target.focus({ preventScroll: true });
                if (selection && selection.start !== null && selection.end !== null && focusKey === 'form:name') {
                    (target as HTMLInputElement).setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
                }
            } else if (focusKey.startsWith('action:') && focusRow) {
                const row = [...panel.querySelectorAll<HTMLElement>('.vela-tm-item')].find((el) => el.dataset.name === focusRow);
                (row?.querySelector<HTMLElement>('.vela-tm-kebab') ?? panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))
                    ?.focus({ preventScroll: true });
            } else if (focusKey.startsWith('favorite:')) {
                panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
            } else if (focusKey === 'form:save') panel.querySelector<HTMLElement>('.vela-tm-save')?.focus({ preventScroll: true });
        }
    }

    /** The pin that puts a saved/built-in template on the Favorites tab. */
    private favoriteButton(key: string, fav: ReadonlySet<string>): HTMLButtonElement | null {
        if (!this.opts.onToggleFavorite) return null;
        const d = this.doc;
        const on = fav.has(key);
        const b = d.createElement('button');
        b.type = 'button';
        b.className = 'vela-tm-ico vela-tm-fav';
        b.dataset.tmFocus = `favorite:${key}`;
        b.dataset.on = on ? '1' : '0';
        b.title = on ? 'Remove from Favorites' : 'Add to Favorites';
        b.setAttribute('aria-label', b.title);
        b.setAttribute('aria-pressed', String(on));
        b.appendChild(iconEl(on ? 'pin-filled' : 'pin', d));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            this.opts.onToggleFavorite?.(key, !on);
            this.render();
        });
        return b;
    }

    /** A read-only built-in: apply only — no default star, no kebab, no rename field. */
    private renderBuiltin(built: IndicatorTemplateBuiltin, fav: ReadonlySet<string>): HTMLElement {
        const d = this.doc;
        const wrap = d.createElement('div');
        wrap.className = 'vela-tm-item vela-tm-builtin';
        wrap.dataset.builtin = built.id;
        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-tm-row';
        btn.dataset.builtin = built.id;
        btn.setAttribute('aria-label', `Apply the built-in template ${built.name} to this chart`);
        const glyph = d.createElement('span');
        glyph.className = 'vela-tm-glyph vela-tm-glyph--builtin';
        glyph.appendChild(iconEl('style-line', d));
        const id = d.createElement('span');
        id.className = 'vela-tm-id';
        const name = d.createElement('span');
        name.className = 'vela-tm-name';
        name.textContent = built.name;
        const meta = d.createElement('span');
        meta.className = 'vela-tm-meta';
        meta.textContent = `${built.description} · ${built.count} indicator${built.count === 1 ? '' : 's'}`;
        id.append(name, meta);
        btn.append(glyph, id);
        btn.addEventListener('click', () => {
            this.opts.onApplyBuiltin?.(built.id);
            this.close();
        });
        const head = d.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:2px;';
        btn.style.flex = '1 1 auto';
        head.appendChild(btn);
        const pin = this.favoriteButton(favoriteKeyForBuiltin(built.id), fav);
        if (pin) head.appendChild(pin);
        wrap.appendChild(head);
        return wrap;
    }

    private renderRow(row: TemplatesMenuRow, house: string | null, charts: number, fav: ReadonlySet<string>): HTMLElement {
        const d = this.doc;
        const wrap = d.createElement('div');
        wrap.className = 'vela-tm-item';
        wrap.dataset.name = row.name;

        // A rename input cannot be nested inside the apply button.
        const renaming = this.renaming === row.name;
        const btn = d.createElement(renaming ? 'div' : 'button');
        if (!renaming) (btn as HTMLButtonElement).type = 'button';
        btn.className = 'vela-tm-row';
        btn.dataset.name = row.name;
        if (!renaming) btn.setAttribute('aria-label', `Apply the template ${row.name} to this chart`);
        if (house === row.name) btn.dataset.current = '1';

        const glyph = d.createElement('span');
        glyph.className = 'vela-tm-glyph';
        glyph.appendChild(iconEl('templates', d));

        const id = d.createElement('span');
        id.className = 'vela-tm-id';
        if (this.renaming === row.name) {
            const input = d.createElement('input');
            input.type = 'text';
            input.className = 'vela-tm-input';
            input.dataset.tmFocus = `rename:${row.name}`;
            input.value = this.renameDraft ?? row.name;
            input.maxLength = 40;
            input.setAttribute('aria-label', `Rename ${row.name}`);
            const commit = (): void => {
                const next = input.value.trim();
                if (!next || next === row.name) {
                    this.renaming = null;
                    this.renameDraft = null;
                    this.render();
                    return;
                }
                const ok = this.opts.onRename?.(row.name, next) ?? false;
                this.flash = ok
                    ? { text: `Renamed to “${next}”`, tone: 'ok' }
                    : { text: `A template named “${next}” already exists`, tone: 'bad' };
                // A refusal keeps the field open with what was typed: the fix is one word,
                // not one more trip through the kebab.
                this.renaming = ok ? null : row.name;
                this.renameDraft = ok ? null : next;
                this.render();
                if (!ok) {
                    const again = this.panel?.querySelector<HTMLInputElement>('.vela-tm-input');
                    again?.focus();
                    again?.select();
                }
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') commit();
            });
            input.addEventListener('blur', () => {
                if (this.renaming === row.name) commit();
            });
            id.appendChild(input);
        } else {
            const name = d.createElement('span');
            name.className = 'vela-tm-name';
            name.textContent = row.name;
            const meta = d.createElement('span');
            meta.className = 'vela-tm-meta';
            const bits = [`${row.count} indicator${row.count === 1 ? '' : 's'}`];
            if (row.symbol) bits.push(row.timeframe ? `${row.symbol} · ${row.timeframe}` : row.symbol);
            meta.textContent = bits.join(' · ');
            id.append(name, meta);
        }
        btn.append(glyph, id);

        if (house === row.name) {
            const badge = d.createElement('span');
            badge.className = 'vela-tm-badge';
            badge.textContent = 'default';
            btn.appendChild(badge);
        }

        btn.addEventListener('click', () => {
            if (this.renaming === row.name) return;
            const n = this.opts.onApply?.(row.name, 'active') ?? 0;
            if (n > 0) {
                this.close();
                return;
            }
            this.flash = { text: 'That template could not be applied', tone: 'bad' };
            this.render();
        });

        // The kebab is a sibling, not a child: a button inside a button is invalid HTML
        // and swallows its own clicks in WebKit.
        const kebab = d.createElement('button');
        kebab.type = 'button';
        kebab.className = 'vela-tm-ico vela-tm-kebab';
        kebab.dataset.tmFocus = `actions:${row.name}`;
        kebab.appendChild(iconEl('kebab', d));
        kebab.title = `Actions for ${row.name}`;
        kebab.setAttribute('aria-label', `Actions for ${row.name}`);
        kebab.setAttribute('aria-expanded', String(this.openRow === row.name));
        kebab.addEventListener('click', () => {
            this.openRow = this.openRow === row.name ? null : row.name;
            this.renaming = null;
            this.renameDraft = null;
            this.saving = false;
            this.armed = null;
            this.flash = null;
            this.render();
        });

        // The star is TV's "Set as default", on the row: filled while this template seeds
        // new charts. The kebab carries the same verb for a keyboard-first reader.
        const star = d.createElement('button');
        star.type = 'button';
        star.className = 'vela-tm-ico vela-tm-star';
        star.dataset.tmFocus = `default:${row.name}`;
        star.dataset.on = house === row.name ? '1' : '0';
        const starLabel = house === row.name
            ? `${row.name} seeds new charts — turn off`
            : `Start new charts with ${row.name}`;
        star.title = starLabel;
        star.setAttribute('aria-label', starLabel);
        star.setAttribute('aria-pressed', String(house === row.name));
        star.appendChild(iconEl(house === row.name ? 'star-filled' : 'star', d));
        star.addEventListener('click', () => {
            if (this.opts.onSetDefault) {
                this.opts.onSetDefault(house === row.name ? null : row.name);
                this.flash = house === row.name
                    ? { text: `New charts no longer start with “${row.name}”`, tone: 'ok' }
                    : { text: `New charts will start with “${row.name}”`, tone: 'ok' };
            }
            this.render();
        });

        const head = d.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:2px;';
        const pin = this.favoriteButton(favoriteKeyForTemplate(row.name), fav);
        if (pin) head.appendChild(pin);
        if (this.opts.onSetDefault) head.appendChild(star);
        if (this.hasRowActions()) head.appendChild(kebab);
        head.style.paddingRight = '2px';
        btn.style.flex = '1 1 auto';
        head.insertBefore(btn, head.firstChild);
        wrap.appendChild(head);

        if (this.openRow === row.name) wrap.appendChild(this.actionStrip(row, charts));
        return wrap;
    }

    private hasRowActions(): boolean {
        return !!(this.opts.onRename || this.opts.onDelete || this.opts.onExport || this.opts.onApply);
    }

    private actionStrip(row: TemplatesMenuRow, charts: number): HTMLElement {
        const d = this.doc;
        const strip = d.createElement('div');
        strip.className = 'vela-tm-strip';
        const chip = (label: string, run: () => void, opts: { danger?: boolean; icon?: string; key?: string } = {}): HTMLElement => {
            const b = d.createElement('button');
            b.type = 'button';
            b.className = 'vela-tm-chip';
            b.dataset.tmFocus = `action:${row.name}:${opts.key ?? label}`;
            if (opts.danger) b.dataset.danger = '1';
            if (opts.icon) b.appendChild(iconEl(opts.icon, d));
            const t = d.createElement('span');
            t.textContent = label;
            b.appendChild(t);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                run();
            });
            return b;
        };
        if (this.opts.onApply && charts > 1) {
            strip.appendChild(chip('Apply to all charts', () => {
                const n = this.opts.onApply?.(row.name, 'all') ?? 0;
                this.openRow = null;
                this.flash = n > 0
                    ? { text: `“${row.name}” applied to ${n} charts`, tone: 'ok' }
                    : { text: 'Nothing to apply it to', tone: 'bad' };
                this.render();
            }, { icon: 'group' }));
        }
        if (this.opts.onRename) {
            strip.appendChild(chip('Rename…', () => {
                this.renaming = row.name;
                this.renameDraft = null;
                this.openRow = null;
                this.armed = null;
                this.render();
                const input = this.panel?.querySelector<HTMLInputElement>('.vela-tm-input');
                input?.focus();
                input?.select();
            }, { icon: 'pen' }));
        }
        if (this.opts.onExport) {
            strip.appendChild(chip('Export', () => {
                const json = this.opts.onExport?.(row.name) ?? null;
                if (!json) {
                    this.flash = { text: 'That template could not be exported', tone: 'bad' };
                    this.render();
                    return;
                }
                downloadText(this.doc, `${row.name}.vela-template.json`, json, 'application/json');
                this.flash = { text: `“${row.name}” exported`, tone: 'ok' };
                this.render();
            }, { icon: 'download' }));
        }
        if (this.opts.onDelete) {
            const armedRow = this.armed === row.name;
            strip.appendChild(chip(armedRow ? 'Tap again to delete' : 'Delete', () => {
                if (this.armed !== row.name) {
                    this.armed = row.name;
                    this.render();
                    return;
                }
                this.opts.onDelete?.(row.name);
                this.armed = null;
                this.openRow = null;
                this.flash = { text: `“${row.name}” deleted`, tone: 'ok' };
                this.render();
            }, { danger: true, icon: 'trash', key: 'delete' }));
        }
        return strip;
    }

    private saveForm(draft: string, rememberMarket: boolean): HTMLElement {
        const d = this.doc;
        const form = d.createElement('div');
        form.className = 'vela-tm-form';
        const row = d.createElement('div');
        row.className = 'vela-tm-formrow';
        const input = d.createElement('input');
        input.type = 'text';
        input.className = 'vela-tm-input';
        input.dataset.tmFocus = 'form:name';
        input.placeholder = 'Template name';
        input.value = draft;
        input.maxLength = 40;
        input.setAttribute('aria-label', 'Save chart template as');
        const ok = d.createElement('button');
        ok.type = 'button';
        ok.className = 'vela-tm-primary';
        ok.dataset.tmFocus = 'form:save';
        ok.textContent = 'Save';

        // TV's "Remember interval" checkbox, widened to what this build stores: the market
        // (symbol + timeframe) — off by default, because a template is meant to travel.
        const check = d.createElement('label');
        check.className = 'vela-tm-check';
        const box = d.createElement('input');
        box.type = 'checkbox';
        box.checked = rememberMarket;
        box.dataset.tmFocus = 'form:market';
        const checkText = d.createElement('span');
        checkText.textContent = 'Remember symbol & timeframe';
        check.title = 'Off by default: a template works on any market';
        check.append(box, checkText);

        const commit = (): void => {
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            const saved = this.opts.onSave?.(name, box.checked) ?? false;
            this.saving = false;
            this.flash = saved
                ? { text: `Template “${name}” saved`, tone: 'ok' }
                : { text: 'That template could not be saved', tone: 'bad' };
            this.render();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
        });
        ok.addEventListener('click', commit);
        row.append(input, ok);
        form.append(row, check);
        return form;
    }

    private action(icon: string, label: string, run: () => void): HTMLElement {
        const d = this.doc;
        const b = d.createElement('button');
        b.type = 'button';
        b.className = 'vela-tm-act';
        b.appendChild(iconEl(icon, d));
        const t = d.createElement('span');
        t.textContent = label;
        b.appendChild(t);
        b.addEventListener('click', run);
        return b;
    }

    /** A template file is JSON with the same envelope `exportTemplate` writes. */
    private pickFile(): void {
        const d = this.doc;
        const input = d.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        d.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return;
            void file.text().then((text) => {
                const name = this.opts.onImport?.(text) ?? null;
                this.flash = name
                    ? { text: `Imported “${name}”`, tone: 'ok' }
                    : { text: 'That file is not a Vela template', tone: 'bad' };
                this.render();
            }).catch(() => {
                this.flash = { text: 'That file could not be read', tone: 'bad' };
                this.render();
            });
        });
        input.click();
    }
}
