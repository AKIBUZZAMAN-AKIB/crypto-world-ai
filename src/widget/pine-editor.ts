// The PINE EDITOR — a docked panel, not a page.
//
// Modelled on TradingView's editor after it moved into the side panel (Aug 2025): a script
// selector with a version label, a draft dot, a primary "Add to chart" that turns into
// "Update on chart" once the script is live, "Save" that cuts a revision, a revision list
// you can restore from, and a console whose messages are colour-coded with a clickable
// line number. On a phone it is a bottom SHEET whose height the user drags — an editor
// that can neither cover the chart nor be swiped away is the wrong shape there.
//
// The chart does the work: "Add to chart" calls `chart.runIndicator`, "Update on chart"
// calls the existing handle's `updateCode`, which re-runs the script in place and keeps
// the trader's input values. Nothing here parses Pine — errors are the engine's own.
import { SidePanel } from './side-panel';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { Tooltip } from '../ui/components/tooltip';
import { isDarkColor } from '../core/color';
import { SYNTAX_DARK, SYNTAX_LIGHT, WARNING } from '../core/palette';
import type { Vela } from '../Vela';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import {
    commitVersion,
    createScript,
    editCode,
    isDirty,
    loadLibrary,
    loadSettings,
    renameScript,
    restoreVersion,
    saveLibrary,
    saveSettings,
    versionLabel,
    versionsNewestFirst,
    complete,
    lineStarts,
    DEFAULT_SETTINGS,
    type EditorSettings,
    type PineScript,
    type ScriptLibrary,
    type TemplateKind,
} from './pine-editor-store';

const STYLE_ID = 'vela-widget-pine-editor';

/** The minimap's fixed density: a source line is ~2.6px of strip, offset 10px from the top. */
const MM_LINE_H = 2.6;
const MM_TOP = 10;

/** Where the editor's y-position/height decisions persist. */
const SHEET_KEY = 'vela-pine-sheet';

const CSS = `
.vela-pe .vela-panel-body { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
/* The script's OWN name is the header's title here (TradingView's shape): a panel
   heading above it would say "Pine editor" twice and cost the name its width. */
.vela-pe .vela-panel-title { display: none; }
.vela-pe .vela-panel-header-slot { margin-left: -4px; gap: 4px; }

/* ── mobile: a draggable bottom sheet over the chart ─────────────────────────── */
.vela-pe-grip { display: none; }
[data-layout='mobile'] .vela-panel.vela-pe {
    inset: auto 0 0 0;
    height: var(--pe-sheet-h, 58%);
    min-height: 180px;
    max-height: 92%;
    border-top: 1px solid var(--vela-border);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -14px 44px rgba(0, 0, 0, 0.45);
    z-index: 40;
    transition: height 120ms ease;
}
[data-layout='mobile'] .vela-panel.vela-pe.vela-pe-dragging { transition: none; }
[data-layout='mobile'] .vela-pe-grip {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    flex: none;
    cursor: grab;
    touch-action: none;
}
[data-layout='mobile'] .vela-pe-grip::after {
    content: '';
    width: 38px;
    height: 4px;
    border-radius: 2px;
    background: var(--vela-border);
}
[data-layout='mobile'] .vela-pe-grip:active::after { background: var(--vela-fg-muted); }
/* A phone has no Ctrl key and no room for the console a desktop gets: drop the key hint
   and cap the log so the code keeps most of the sheet. */
[data-layout='mobile'] .vela-pe-status [data-part='hint'] { display: none; }
/* No minimap on a phone: 56px of a 390px sheet is a seventh of the code, and the sheet is
   already the thing being scrolled. Desktop keeps it (and the setting keeps its choice). */
[data-layout='mobile'] .vela-pe-minimap { display: none; }
[data-layout='mobile'] .vela-pe-console { max-height: 92px; }

/* ── header slot: name · actions ───────────────────────────────────────────────── */
.vela-pe-name {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    padding: 3px 6px;
    border-radius: 5px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
}
.vela-pe-name:hover { background: var(--vela-hover); }
.vela-pe-name:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }
.vela-pe-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-pe-name .vela-icon { font-size: 12px; opacity: 0.6; flex: none; }
.vela-pe-dirty {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vela-accent);
    flex: none;
    margin-right: 2px;
}
.vela-pe-dirty[hidden] { display: none; }
.vela-pe-ver { font-size: 11px; color: var(--vela-fg-muted); font-variant-numeric: tabular-nums; flex: none; }

.vela-pe-act {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    color: var(--vela-fg);
    background: var(--vela-hover);
    white-space: nowrap;
}
.vela-pe-act:hover { filter: brightness(1.12); }
.vela-pe-act.primary { background: var(--vela-accent); color: #fff; }
.vela-pe-act:disabled { opacity: 0.5; cursor: default; }
.vela-pe-split { display: inline-flex; align-items: stretch; }
.vela-pe-split .vela-pe-act { border-radius: 5px 0 0 5px; }
.vela-pe-caret {
    all: unset;
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 26px;
    border-radius: 0 5px 5px 0;
    background: var(--vela-accent);
    color: #fff;
    cursor: pointer;
    border-left: 1px solid rgba(0, 0, 0, 0.25);
}
.vela-pe-caret .vela-icon { font-size: 11px; }
.vela-pe-caret:hover { filter: brightness(1.12); }
.vela-pe-icon {
    all: unset;
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px;
    border-radius: 5px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-pe-icon:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-pe-icon[aria-pressed='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }

/* ── the code surface ──────────────────────────────────────────────────────────── */
.vela-pe-wrap { flex: 1 1 auto; min-height: 0; display: flex; position: relative; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.vela-pe-gutter {
    flex: none;
    width: 44px;
    padding: 10px 8px 10px 0;
    text-align: right;
    color: var(--vela-fg-muted);
    opacity: 0.55;
    user-select: none;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    background: var(--vela-bg);
    border-right: 1px solid var(--vela-border);
}
.vela-pe-gutter-line { display: block; }
.vela-pe-gutter-line.vela-pe-err { color: var(--vela-danger); opacity: 1; font-weight: 700; }
.vela-pe-code { position: relative; flex: 1 1 auto; min-width: 0; }
/* The highlight layer sits UNDER the textarea and paints the colours; the textarea keeps
   the caret, the selection and the input behaviour, with transparent text so both layers
   read as one surface. Both must share every metric or the glyphs drift. */
.vela-pe-hl,
.vela-pe-input {
    margin: 0;
    padding: 10px 14px 10px 10px;
    border: 0;
    font: inherit;
    line-height: inherit;
    letter-spacing: inherit;
    tab-size: 4;
    white-space: pre;
    word-wrap: normal;
    overflow: auto;
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}
.vela-pe-hl { pointer-events: none; color: var(--vela-fg); overflow: hidden; }
.vela-pe-input {
    resize: none;
    outline: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--vela-fg-bright);
}
.vela-pe-input::selection { background: var(--vela-selection, rgba(41, 98, 255, 0.35)); color: transparent; }
.vela-pe-hl .tk-com { color: var(--vela-fg-muted); font-style: italic; }
/* The palette is chosen for the SURFACE the panel sits on (data-surface is set from the
   live --vela-bg), not for a fixed VS Code theme: the same tokens must stay legible on
   the light chart a trader switched to at noon and on the dark one at night. */
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-str { color: ${SYNTAX_DARK.string}; }
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-num { color: ${SYNTAX_DARK.number}; }
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-kw { color: ${SYNTAX_DARK.keyword}; }
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-fn { color: ${SYNTAX_DARK.call}; }
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-ns { color: ${SYNTAX_DARK.namespace}; }
.vela-pe[data-surface='dark'] .vela-pe-hl .tk-const { color: ${SYNTAX_DARK.constant}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-str { color: ${SYNTAX_LIGHT.string}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-num { color: ${SYNTAX_LIGHT.number}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-kw { color: ${SYNTAX_LIGHT.keyword}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-fn { color: ${SYNTAX_LIGHT.call}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-ns { color: ${SYNTAX_LIGHT.namespace}; }
.vela-pe[data-surface='light'] .vela-pe-hl .tk-const { color: ${SYNTAX_LIGHT.constant}; }

/* The 80-character ruler — the same guide TradingView's editor draws (its editor
   settings call it "vertical ruler at the 80-character mark"): a faint line under the
   glyphs so a long line is visible before it wraps nowhere. Pointer-transparent. */
.vela-pe-code::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(10px + 80ch);
    width: 1px;
    background: var(--vela-border);
    opacity: 0.5;
    pointer-events: none;
}
[data-layout='mobile'] .vela-pe-code::after { display: none; }

/* The code OVERVIEW — TradingView's minimap. A condensed canvas of every line; the
   visible window is boxed, and a click jumps there. Off from Editor settings. */
.vela-pe-minimap {
    flex: none;
    width: 56px;
    position: relative;
    overflow: hidden;
    border-left: 1px solid var(--vela-border);
    background: var(--vela-bg);
    cursor: pointer;
}
.vela-pe-minimap[hidden] { display: none; }
.vela-pe-minimap canvas { display: block; width: 100%; height: 100%; }
.vela-pe-mm-view {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--vela-border-strong);
    border-bottom: 1px solid var(--vela-border-strong);
    background: var(--vela-hover);
    pointer-events: none;
}
.vela-pe[data-guide='off'] .vela-pe-code::after { display: none; }

/* Editor settings — the same five switches TradingView puts behind its three dots. */
.vela-pe-set {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--vela-fg);
}
.vela-pe-set > span:first-child { flex: 1 1 auto; min-width: 0; }
.vela-pe-set input[type='checkbox'] { accent-color: var(--vela-accent); margin: 0; cursor: pointer; }
.vela-pe-set select {
    background: var(--vela-surface-sunken);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border);
    border-radius: 4px;
    font: inherit;
    padding: 1px 3px;
    cursor: pointer;
}
.vela-pe-set-hint { padding: 0 8px 6px; font-size: 11px; color: var(--vela-fg-muted); }

/* Autocomplete — the caret-anchored suggestion list (Ctrl+Space, or as you type). */
.vela-pe-ac {
    position: absolute;
    z-index: 6;
    min-width: 150px;
    max-width: 260px;
    max-height: 176px;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--vela-border);
    border-radius: 6px;
    background: var(--vela-surface-overlay);
    box-shadow: var(--vela-shadow);
}
.vela-pe-ac[hidden] { display: none; }
.vela-pe-ac-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 8px;
    border-radius: 4px;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--vela-fg);
    cursor: pointer;
    white-space: nowrap;
}
.vela-pe-ac-row[data-active='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-pe-ac-kind { margin-left: auto; font-size: 10px; opacity: 0.6; }

/* ── console ───────────────────────────────────────────────────────────────────── */
.vela-pe-status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 10px;
    border-top: 1px solid var(--vela-border);
    background: var(--vela-bg);
    font-size: 11px;
    color: var(--vela-fg-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.vela-pe-status .vela-pe-status-push { margin-left: auto; }
.vela-pe-status b { font-weight: 600; color: var(--vela-fg); }
.vela-pe-rename {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    margin: 2px 2px 6px;
    padding: 5px 7px;
    border: 1px solid var(--vela-accent);
    border-radius: 5px;
    background: var(--vela-surface-sunken);
    color: var(--vela-fg-bright);
    font-size: 12px;
}
.vela-pe-console {
    flex: none;
    max-height: 132px;
    overflow: auto;
    border-top: 1px solid var(--vela-border);
    background: var(--vela-bg);
    font-size: 11.5px;
}
.vela-pe-console:empty { display: none; }
.vela-pe-msg {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid transparent;
    color: var(--vela-fg-muted);
}
.vela-pe-msg + .vela-pe-msg { border-top: 1px solid var(--vela-border); }
.vela-pe-msg-time { flex: none; opacity: 0.6; font-variant-numeric: tabular-nums; }
.vela-pe-msg-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.vela-pe-msg-line {
    all: unset;
    flex: none;
    cursor: pointer;
    text-decoration: underline dotted;
    color: var(--vela-accent);
    font-variant-numeric: tabular-nums;
}
.vela-pe-msg[data-level='error'] { color: var(--vela-danger); }
.vela-pe-console-head {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: var(--vela-bg);
    border-bottom: 1px solid var(--vela-border);
    z-index: 1;
}
.vela-pe-filter {
    all: unset;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 10.5px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-pe-filter:hover { background: var(--vela-hover); }
.vela-pe-filter[aria-pressed='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-pe-filter-count { opacity: 0.65; font-variant-numeric: tabular-nums; }
.vela-pe-clear {
    all: unset;
    margin-left: auto;
    font-size: 10.5px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 9px;
}
.vela-pe-clear:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-pe-msg[data-level='warn'] { color: var(--vela-warning, ${WARNING}); }

/* ── history / scripts popover ────────────────────────────────────────────────── */
.vela-pe-pop {
    position: absolute;
    top: 44px;
    right: 8px;
    width: min(290px, calc(100% - 16px));
    max-height: 60%;
    overflow: auto;
    background: var(--vela-surface-overlay, var(--vela-bg));
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    z-index: 3;
    padding: 6px;
}
.vela-pe-pop[hidden] { display: none; }
.vela-pe-pop-title {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--vela-fg-muted);
    padding: 6px 8px 4px;
}
.vela-pe-row {
    all: unset;
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    color: var(--vela-fg);
}
.vela-pe-row:hover { background: var(--vela-hover); }
.vela-pe-row[data-current='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-pe-row-label { font-weight: 600; font-variant-numeric: tabular-nums; flex: none; }
.vela-pe-row-meta { margin-left: auto; font-size: 11px; color: var(--vela-fg-muted); flex: none; }
.vela-pe-row[data-current='true'] .vela-pe-row-meta { color: inherit; opacity: 0.75; }
.vela-pe-row[aria-disabled='true'] { opacity: 0.45; cursor: default; pointer-events: none; }
.vela-pe-row-kind { font-size: 10px; opacity: 0.75; }
.vela-pe-sep { height: 1px; background: var(--vela-border); margin: 5px 2px; }
`;

export interface PineEditorMessages {
    /** What the editor says when it cannot reach storage — never thrown. */
    onStorageError?(error: Error): void;
}

interface ConsoleMessage {
    level: 'info' | 'warn' | 'error';
    text: string;
    time: number;
    line?: number;
}

export class PineEditor extends SidePanel {
    private chart: Vela | null = null;
    private library: ScriptLibrary;
    private active: PineScript;
    private handle: IndicatorHandle | null = null;
    /** Unsubscribes the chart's theme relay. */
    private themeOff: (() => void) | null = null;
    /** Closes the popover on an outside press — removed with the panel. */
    private onDocPointerDown: ((event: Event) => void) | null = null;
    private readonly messages: ConsoleMessage[] = [];

    // Elements
    private readonly grip: HTMLDivElement;
    private readonly nameButton: HTMLButtonElement;
    private readonly nameLabel: HTMLSpanElement;
    private readonly dirtyDot: HTMLSpanElement;
    private readonly versionTag: HTMLSpanElement;
    private readonly primary: HTMLButtonElement;
    private readonly caret: HTMLButtonElement;
    private readonly scriptsButton: HTMLButtonElement;
    private readonly wrap: HTMLDivElement;
    private readonly gutter: HTMLDivElement;
    private readonly highlight: HTMLPreElement;
    private readonly input: HTMLTextAreaElement;
    private readonly consoleEl: HTMLDivElement;
    private readonly statusEl: HTMLDivElement;
    private settings: EditorSettings;
    private readonly minimapEl: HTMLDivElement;
    private readonly minimapView: HTMLDivElement;
    private readonly minimapCanvas: HTMLCanvasElement;
    private readonly autocompleteEl: HTMLDivElement;

    /** Levels the console is showing — TradingView's level filter, in miniature. */
    private readonly hiddenLevels = new Set<ConsoleMessage['level']>();
    /** Console suppressed with Ctrl+` (the shortcut toggles it back). */
    private consoleCollapsed = false;
    /** Pixels per source line in the minimap, from the last paint. */
    private mmRowH = MM_LINE_H;


    private readonly pop: HTMLDivElement;

    constructor(host: HTMLElement) {
        super(host, 'Pine editor', 'vela-pe', {
            resizable: true,
            width: 520,
            minWidth: 340,
            maxWidth: 980,
            // DOCKED (the chart shrinks beside it), never floating over it: an editor is a
            // place you work, not a popover — and TradingView's side panel docks too.
            maximizable: true,
        });
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        this.settings = loadSettings((key) => globalThis.localStorage?.getItem(key) ?? null);
        const stored = loadLibrary((key) => globalThis.localStorage?.getItem(key) ?? null);
        this.library = stored ?? (() => {
            const first = createScript('indicator', 'My script');
            return { scripts: [first], activeId: first.id };
        })();
        this.active = this.library.scripts.find((s) => s.id === this.library.activeId) ?? this.library.scripts[0]!;

        // ── header slot ────────────────────────────────────────────────────────────
        this.nameButton = doc.createElement('button');
        this.nameButton.className = 'vela-pe-name';
        this.nameButton.type = 'button';
        this.nameLabel = doc.createElement('span');
        this.dirtyDot = doc.createElement('span');
        this.dirtyDot.className = 'vela-pe-dirty';
        this.versionTag = doc.createElement('span');
        this.versionTag.className = 'vela-pe-ver';
        this.nameButton.append(this.dirtyDot, this.nameLabel, this.versionTag, iconEl('chevron-down', doc));

        const split = doc.createElement('span');
        split.className = 'vela-pe-split';
        this.primary = doc.createElement('button');
        this.primary.className = 'vela-pe-act primary';
        this.primary.type = 'button';
        this.caret = doc.createElement('button');
        this.caret.className = 'vela-pe-caret';
        this.caret.type = 'button';
        this.caret.setAttribute('aria-label', 'More run options');
        this.caret.append(iconEl('chevron-down', doc));
        split.append(this.primary, this.caret);

        this.scriptsButton = iconButton(doc, 'kebab', 'More actions');

        // Three elements, one row: the script's name (and its library), the ONE primary
        // action with its dropdown, and ⋯ — save/history/rename live in the menu so the
        // header never crowds the name out of its own panel.
        this.headerSlot.append(this.nameButton, split, this.scriptsButton);

        // ── body ───────────────────────────────────────────────────────────────────
        this.grip = doc.createElement('div');
        this.grip.className = 'vela-pe-grip';
        this.grip.setAttribute('aria-label', 'Drag to resize');
        this.grip.setAttribute('role', 'separator');

        this.wrap = doc.createElement('div');
        this.wrap.className = 'vela-pe-wrap';

        this.gutter = doc.createElement('div');
        this.gutter.className = 'vela-pe-gutter';

        // The minimap: a canvas of the whole script plus a viewport box.
        this.minimapEl = doc.createElement('div');
        this.minimapEl.className = 'vela-pe-minimap';
        this.minimapEl.setAttribute('aria-hidden', 'true');
        this.minimapCanvas = doc.createElement('canvas');
        this.minimapView = doc.createElement('div');
        this.minimapView.className = 'vela-pe-mm-view';
        this.minimapEl.append(this.minimapCanvas, this.minimapView);

        this.autocompleteEl = doc.createElement('div');
        this.autocompleteEl.className = 'vela-pe-ac';
        this.autocompleteEl.hidden = true;

        const codeBox = doc.createElement('div');
        codeBox.className = 'vela-pe-code';
        this.highlight = doc.createElement('pre');
        this.highlight.className = 'vela-pe-hl';
        this.highlight.setAttribute('aria-hidden', 'true');
        this.input = doc.createElement('textarea');
        this.input.className = 'vela-pe-input';
        this.input.spellcheck = false;
        this.input.setAttribute('autocapitalize', 'off');
        this.input.setAttribute('autocomplete', 'off');
        this.input.setAttribute('aria-label', 'Pine Script source');
        codeBox.append(this.highlight, this.input);

        this.wrap.append(this.gutter, codeBox, this.minimapEl);

        this.statusEl = doc.createElement('div');
        this.statusEl.className = 'vela-pe-status';

        this.consoleEl = doc.createElement('div');
        this.consoleEl.className = 'vela-pe-console';

        this.pop = doc.createElement('div');
        this.pop.className = 'vela-pe-pop';
        this.pop.hidden = true;

        this.body.append(this.grip, this.wrap, this.autocompleteEl, this.statusEl, this.consoleEl, this.pop);

        this.bind();
        this.syncSurface();
        this.applySettings();
        this.render();
    }

    // ── public API ─────────────────────────────────────────────────────────────────

    /** Tear down the panel AND the subscriptions the base class knows nothing about. */
    override destroy(): void {
        this.themeOff?.();
        this.themeOff = null;
        if (this.onDocPointerDown) this.body.ownerDocument.removeEventListener('pointerdown', this.onDocPointerDown);
        this.onDocPointerDown = null;
        super.destroy();
    }

    /**
     * Open/close, and re-read the surface colour on the way in: a chart theme flipped while
     * the panel was closed must not give the trader dark-theme tokens on a white sheet.
     */
    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (open) this.syncSurface();
    }

    /** Pick the syntax palette from the background actually painted behind the panel. */
    private syncSurface(): void {
        const bg = getComputedStyle(this.el).getPropertyValue('--vela-bg').trim();
        this.el.dataset.surface = isDarkColor(bg || '#000') ? 'dark' : 'light';
    }

    /**
     * Add the live script to every OTHER chart of the layout — TradingView's "Apply to
     * entire layout". Set by a multi-chart shell; returns how many charts took it. The
     * row only exists when a shell sets it, so a single-chart host never shows dead text.
     */
    onApplyToLayout: (() => number) | null = null;

    /** The id of the handle this editor is driving, or null when nothing is live. */
    get liveHandleId(): string | null {
        return this.handle?.id ?? null;
    }

    /** Bind to the chart whose scripts this editor runs. */
    onChart(chart: Vela): void {
        this.chart = chart;
        // A theme flip is a SURFACE change: the syntax palette has to follow it, or a
        // trader who switches to the light chart gets light-grey keywords on white.
        this.themeOff?.();
        this.themeOff = chart.on('theme:changed', () => this.syncSurface());
        this.syncSurface();
        this.syncHandle();
    }

    /**
     * Open the editor on a script that is ALREADY on the chart (the legend's "Source code"
     * action). Reuses the library entry with the same text, or adopts the code as a new
     * script — never edits a different script behind the trader's back.
     */
    openSource(source: string, title?: string): void {
        const existing = this.library.scripts.find((s) => s.code === source);
        this.active = existing ?? (() => {
            const created = createScript('indicator', title || 'Chart script');
            const withCode = { ...created, code: source, versions: [{ ...created.versions[0]!, code: source }] };
            this.library = { ...this.library, scripts: [...this.library.scripts, withCode], activeId: withCode.id };
            return withCode;
        })();
        this.library = { ...this.library, activeId: this.active.id };
        this.syncHandle();
        this.render();
        this.persist();
        this.focus();
    }

    /** Open on the script the shell already knows (a fresh panel with a saved library). */
    focus(): void {
        this.input.focus();
    }

    // ── wiring ─────────────────────────────────────────────────────────────────────

    private bind(): void {
        const doc = this.body.ownerDocument;

        this.input.addEventListener('input', (event) => {
            this.active = editCode(this.active, this.input.value);
            this.commitActive();
            this.paint();
            this.persist();
            const typed = (event as InputEvent).data;
            if (this.settings.suggestions && typed && /[A-Za-z_.]/.test(typed)) this.offerAutocomplete();
            else this.hideAutocomplete();
        });
        this.input.addEventListener('scroll', () => {
            this.syncScroll();
            this.paintMinimapView();
            this.hideAutocomplete();
        });
        this.minimapEl.addEventListener('pointerdown', (event) => {
            const rect = this.minimapEl.getBoundingClientRect();
            this.jumpToFraction((event.clientY - rect.top) / Math.max(1, rect.height));
        });
        this.autocompleteEl.addEventListener('pointerdown', (event) => {
            // Keep the caret where it is: the suggestion list is not a text field.
            event.preventDefault();
        });
        for (const ev of ['keyup', 'click', 'select', 'focus'] as const) {
            this.input.addEventListener(ev, () => this.paintStatus());
        }
        this.input.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent));

        this.primary.addEventListener('click', () => void this.runPrimary());
        this.caret.addEventListener('click', (event) => {
            event.stopPropagation();
            this.openPop('run');
        });
        this.scriptsButton.addEventListener('click', () => this.openPop('more'));
        this.nameButton.addEventListener('click', () => this.openPop('scripts'));

        this.onDocPointerDown = (event: Event): void => {
            if (this.pop.hidden) return;
            const target = event.target as Node;
            if (!this.pop.contains(target) && !this.headerSlot.contains(target)) this.pop.hidden = true;
        };
        doc.addEventListener('pointerdown', this.onDocPointerDown);

        this.bindSheetDrag();
        new Tooltip(this.scriptsButton, { content: 'More actions', host: this.body });
    }

    private onKeyDown(event: KeyboardEvent): void {
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key;
        const lower = key.toLowerCase();

        // The suggestion list owns the arrows/Enter/Esc while it is open.
        if (!this.autocompleteEl.hidden) {
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                this.moveAutocomplete(key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (key === 'Enter' || key === 'Tab') {
                event.preventDefault();
                this.acceptAutocomplete();
                return;
            }
            if (key === 'Escape') {
                event.preventDefault();
                this.hideAutocomplete();
                return;
            }
        }

        if (mod && key === 'Enter') {
            event.preventDefault();
            void this.runPrimary();
            return;
        }
        if (mod && lower === 's') {
            event.preventDefault();
            this.saveVersion();
            return;
        }
        if (mod && lower === 'i') {
            // TV's "new script"
            event.preventDefault();
            this.addScript('indicator');
            return;
        }
        if (mod && lower === 'o') {
            event.preventDefault();
            this.openPop('scripts');
            return;
        }
        if (mod && key === '`') {
            event.preventDefault();
            this.consoleCollapsed = !this.consoleCollapsed;
            this.consoleEl.style.display = this.consoleCollapsed ? 'none' : '';
            return;
        }
        if (mod && (key === '/' || key === '7')) {
            event.preventDefault();
            this.toggleComment();
            return;
        }
        if (mod && lower === 'd') {
            // TV: Ctrl+D removes the current line; Ctrl+Shift+D duplicates it.
            event.preventDefault();
            if (event.shiftKey) this.duplicateLine();
            else this.removeLine();
            return;
        }
        if (mod && key === ' ') {
            event.preventDefault();
            this.offerAutocomplete();
            return;
        }
        if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
            event.preventDefault();
            if (event.shiftKey) this.duplicateLine(key === 'ArrowUp' ? 'up' : 'down');
            else this.moveLine(key === 'ArrowUp' ? 'up' : 'down');
            return;
        }
        if (key === 'Tab') {
            event.preventDefault();
            if (this.hasMultilineSelection()) this.indentSelection(event.shiftKey ? -1 : 1);
            else if (event.shiftKey) this.indentSelection(-1);
            else {
                const before = this.input.value.slice(0, this.input.selectionStart);
                const lineStart = before.lastIndexOf('\n') + 1;
                const indent = before.slice(lineStart).match(/^ */)?.[0].length ?? 0;
                const width = this.settings.tabSize;
                this.input.setRangeText(' '.repeat(width - (indent % width)), this.input.selectionStart, this.input.selectionEnd, 'end');
                this.input.dispatchEvent(new Event('input'));
            }
            return;
        }
        if (key === 'Enter') {
            const { selectionStart: start, selectionEnd: end, value } = this.input;
            const before = value.slice(0, start);
            const lineStart = before.lastIndexOf('\n') + 1;
            const line = before.slice(lineStart);
            const indent = line.match(/^ */)?.[0] ?? '';
            if (/:\s*$/.test(line)) return; // Pine has no block colon; keep the plain newline
            const deeper = /(^|\s)(if|for|while|switch|else|method|type)\b/.test(line) && !line.trim().startsWith('//') ? ' '.repeat(this.settings.tabSize) : '';
            event.preventDefault();
            this.input.setRangeText(`\n${indent}${deeper}`, start, end, 'end');
            this.input.dispatchEvent(new Event('input'));
        }
    }

    // ── settings · minimap · autocomplete ─────────────────────────────────────────

    /** Push the current settings onto the surface (font size, tab width, the two toggles). */
    private applySettings(): void {
        const s = this.settings;
        this.wrap.style.fontSize = `${s.fontSize}px`;
        this.input.style.tabSize = String(s.tabSize);
        this.highlight.style.tabSize = String(s.tabSize);
        this.el.dataset.guide = s.lineGuide ? 'on' : 'off';
        this.minimapEl.hidden = !s.minimap;
        if (s.minimap) this.paintMinimap();
        this.savePreferences();
    }

    private savePreferences(): void {
        saveSettings((key, value) => globalThis.localStorage?.setItem(key, value), this.settings);
    }

    /** The Editor settings popover — the same five switches TradingView puts behind ⋯. */
    private renderSettings(): void {
        const doc = this.body.ownerDocument;
        const toggle = (label: string, key: 'suggestions' | 'minimap' | 'lineGuide'): HTMLElement => {
            const row = doc.createElement('label');
            row.className = 'vela-pe-set';
            const text = doc.createElement('span');
            text.textContent = label;
            const box = doc.createElement('input');
            box.type = 'checkbox';
            box.checked = this.settings[key];
            box.addEventListener('change', () => {
                this.settings = { ...this.settings, [key]: box.checked };
                this.applySettings();
            });
            row.append(text, box);
            return row;
        };
        const number = (label: string, key: 'fontSize' | 'tabSize', values: number[]): HTMLElement => {
            const row = doc.createElement('label');
            row.className = 'vela-pe-set';
            const text = doc.createElement('span');
            text.textContent = label;
            const select = doc.createElement('select');
            for (const value of values) {
                const option = doc.createElement('option');
                option.value = String(value);
                option.textContent = String(value);
                option.selected = this.settings[key] === value;
                select.append(option);
            }
            select.addEventListener('change', () => {
                this.settings = { ...this.settings, [key]: Number(select.value) };
                this.applySettings();
            });
            row.append(text, select);
            return row;
        };
        const hint = doc.createElement('div');
        hint.className = 'vela-pe-set-hint';
        hint.textContent = 'Ctrl+Space always offers suggestions.';
        this.pop.replaceChildren(
            this.popTitle('Editor settings'),
            toggle('Suggestions as you type', 'suggestions'),
            toggle('Minimap', 'minimap'),
            toggle('Line length guide', 'lineGuide'),
            number('Font size', 'fontSize', [11, 12, 12.5, 13, 14, 16, 18]),
            number('Tab size', 'tabSize', [2, 4, 8]),
            hint,
        );
    }

    /** Paint the code overview: one faint bar per line, width by line length. */
    private paintMinimap(): void {
        if (!this.settings.minimap) return;
        const doc = this.body.ownerDocument;
        const dpr = globalThis.devicePixelRatio || 1;
        const width = this.minimapEl.clientWidth || 56;
        const height = this.minimapEl.clientHeight || this.wrap.clientHeight || 300;
        this.minimapCanvas.width = Math.round(width * dpr);
        this.minimapCanvas.height = Math.round(height * dpr);
        const ctx = this.minimapCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const ink = getComputedStyle(this.el).getPropertyValue('--vela-fg-faint').trim() || 'rgba(255,255,255,0.35)';
        const lines = this.input.value.split('\n');
        const top = MM_TOP;
        // A real minimap reads at a FIXED density (a line is worth a few pixels, never
        // thirty): a short script then occupies the top of the strip instead of stretching
        // six fat bars down the panel.
        const usable = Math.max(1, height - top * 2);
        const rowH = Math.max(1.2, Math.min(MM_LINE_H, usable / Math.max(1, lines.length)));
        this.mmRowH = rowH;
        ctx.fillStyle = ink;
        const maxLen = Math.max(20, ...lines.map((l) => l.length));
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed === '') return;
            const w = Math.max(2, (Math.min(line.length, maxLen) / maxLen) * (width - 8));
            ctx.globalAlpha = trimmed.startsWith('//') ? 0.3 : 0.7;
            ctx.fillRect(4, top + i * rowH, w, Math.max(1, rowH - 0.8));
        });
        ctx.globalAlpha = 1;
        this.paintMinimapView();
        void doc;
    }

    /** The viewport box on the minimap — the slice of the script the editor shows. */
    private paintMinimapView(): void {
        if (!this.settings.minimap) return;
        const lines = this.input.value.split('\n').length;
        const lineHeight = parseFloat(getComputedStyle(this.input).lineHeight) || 19;
        const visible = Math.min(lines, Math.max(1, this.input.clientHeight / lineHeight));
        const rowH = this.mmRowH || MM_LINE_H;
        const boxH = Math.max(6, visible * rowH);
        const scrolled = this.input.scrollTop / lineHeight;
        const boxTop = MM_TOP + Math.max(0, Math.min(lines * rowH - boxH, scrolled * rowH));
        this.minimapView.style.top = `${Math.round(boxTop)}px`;
        this.minimapView.style.height = `${Math.round(boxH)}px`;
    }

    /** A click on the minimap scrolls the editor to that fraction of the drawn map. */
    private jumpToFraction(fraction: number): void {
        const lines = this.input.value.split('\n').length;
        const rowH = this.mmRowH || MM_LINE_H;
        const height = this.minimapEl.clientHeight || 1;
        const drawn = lines * rowH;
        const y = Math.max(0, Math.min(drawn, fraction * (height - MM_TOP * 2)));
        const target = Math.min(lines, Math.max(1, Math.round(y / Math.max(0.5, rowH)) + 1));
        this.jumpToLine(target);
    }

    // ── autocomplete ──────────────────────────────────────────────────────────────

    private acItems: Array<{ label: string; kind: string }> = [];
    private acIndex = 0;
    private acFrom = 0;

    /** Offer completions for the word at the caret (as-you-type, or on Ctrl+Space). */
    private offerAutocomplete(): void {
        const text = this.input.value;
        const caret = this.input.selectionStart;
        const before = text.slice(0, caret);
        const prefix = /[A-Za-z_][A-Za-z0-9_.]*$|\.[A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
        const items = complete(prefix, text);
        if (items.length === 0 || (prefix === '' && !this.input.selectionStart)) {
            this.hideAutocomplete();
            return;
        }
        this.acItems = items;
        this.acIndex = 0;
        this.acFrom = caret - prefix.length;
        this.renderAutocomplete();
        this.positionAutocomplete(this.acFrom);
    }

    private renderAutocomplete(): void {
        const doc = this.body.ownerDocument;
        this.autocompleteEl.replaceChildren(
            ...this.acItems.map((item, i) => {
                const row = doc.createElement('div');
                row.className = 'vela-pe-ac-row';
                row.dataset.active = String(i === this.acIndex);
                const label = doc.createElement('span');
                label.textContent = item.label;
                const kind = doc.createElement('span');
                kind.className = 'vela-pe-ac-kind';
                kind.textContent = item.kind;
                row.append(label, kind);
                row.addEventListener('click', () => {
                    this.acIndex = i;
                    this.acceptAutocomplete();
                });
                return row;
            }),
        );
        this.autocompleteEl.hidden = false;
    }

    /** Anchor the list to the CARET, measured in the same monospace grid as the code. */
    private positionAutocomplete(from: number): void {
        const text = this.input.value;
        const starts = lineStarts(text);
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1]! <= from) line++;
        const col = from - starts[line]!;
        const style = getComputedStyle(this.input);
        const lineHeight = parseFloat(style.lineHeight) || 19;
        const charWidth = this.charWidth(style);
        const padLeft = parseFloat(style.paddingLeft) || 10;
        const padTop = parseFloat(style.paddingTop) || 10;
        const wrapRect = this.wrap.getBoundingClientRect();
        const left = Math.min(
            Math.max(4, padLeft + col * charWidth - this.input.scrollLeft + this.gutter.clientWidth),
            Math.max(4, wrapRect.width - 170),
        );
        const top = Math.min(
            Math.max(4, padTop + (line + 1) * lineHeight - this.input.scrollTop),
            Math.max(4, this.wrap.clientHeight - 40),
        );
        this.autocompleteEl.style.left = `${left}px`;
        this.autocompleteEl.style.top = `${top}px`;
    }

    /** Monospace glyph width, measured once per call (the font size can change). */
    private charWidth(style: CSSStyleDeclaration): number {
        const probe = this.body.ownerDocument.createElement('span');
        probe.textContent = 'M'.repeat(25);
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
        this.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width / 25;
        probe.remove();
        return width || 7.5;
    }

    private moveAutocomplete(delta: number): void {
        if (this.acItems.length === 0) return;
        this.acIndex = (this.acIndex + delta + this.acItems.length) % this.acItems.length;
        this.renderAutocomplete();
        const active = this.autocompleteEl.querySelector<HTMLElement>('[data-active="true"]');
        active?.scrollIntoView({ block: 'nearest' });
    }

    private acceptAutocomplete(): void {
        const item = this.acItems[this.acIndex];
        if (!item) {
            this.hideAutocomplete();
            return;
        }
        const caret = this.input.selectionStart;
        this.input.setRangeText(item.label, this.acFrom, caret, 'end');
        this.input.dispatchEvent(new Event('input'));
        this.hideAutocomplete();
    }

    private hideAutocomplete(): void {
        this.autocompleteEl.hidden = true;
        this.acItems = [];
    }

    // ── line operations (TradingView's editing shortcuts) ─────────────────────────
    //
    // Everything below works on the LINES array and then rebuilds the selection from
    // (line, column) rather than from absolute offsets: a comment marker, an indent or a
    // moved line changes the text length, and offset arithmetic is where such edits go
    // wrong. `commitEdit` is the one place that writes.

    private selectionInfo(): {
        lines: string[];
        first: number;
        last: number;
        startCol: number;
        endCol: number;
    } {
        const text = this.input.value;
        const lines = text.split('\n');
        const starts = lineStarts(text);
        const lineOf = (index: number): number => {
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid]! <= index) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        };
        const first = lineOf(this.input.selectionStart);
        const last = lineOf(this.input.selectionEnd);
        return {
            lines,
            first,
            last,
            startCol: this.input.selectionStart - starts[first]!,
            endCol: this.input.selectionEnd - starts[last]!,
        };
    }

    /** Write the lines back and re-place the caret by (line, column). */
    private commitEdit(lines: string[], first: number, last: number, startCol: number, endCol: number): void {
        const text = lines.join('\n');
        const starts = lineStarts(text);
        const from = starts[Math.max(0, Math.min(first, starts.length - 1))]!;
        let to = starts[Math.max(0, Math.min(last, starts.length - 1))]!;
        const lineText = lines[Math.max(0, Math.min(last, lines.length - 1))] ?? '';
        const startLineText = lines[Math.max(0, Math.min(first, lines.length - 1))] ?? '';
        const fromPos = from + Math.min(startCol, startLineText.length);
        const toPos = to + Math.min(endCol, lineText.length);
        this.input.value = text;
        this.input.setSelectionRange(fromPos, toPos);
        this.input.dispatchEvent(new Event('input'));
    }

    private hasMultilineSelection(): boolean {
        return this.input.value.slice(this.input.selectionStart, this.input.selectionEnd).includes('\n');
    }

    /** Ctrl+/ — comment the selected lines, or uncomment them when they all are. */
    private toggleComment(): void {
        const { lines, first, last, startCol, endCol } = this.selectionInfo();
        const body = lines.slice(first, last + 1);
        const filled = body.filter((l) => l.trim() !== '');
        const allCommented = filled.length > 0 && filled.every((l) => /^\s*\/\//.test(l));
        for (let i = first; i <= last; i++) {
            const line = lines[i]!;
            if (line.trim() === '') continue;
            lines[i] = allCommented ? line.replace(/^(\s*)\/\/ ?/, '$1') : line.replace(/^(\s*)/, '$1// ');
        }
        const shift = filled.length > 0 && allCommented ? -3 : 3;
        this.commitEdit(lines, first, last, Math.max(0, startCol + shift), Math.max(0, endCol + shift));
    }

    /** Ctrl+D — remove the line (the caret lands at the start of the next one). */
    private removeLine(): void {
        const { lines, first } = this.selectionInfo();
        if (lines.length === 1) {
            this.commitEdit([''], 0, 0, 0, 0);
            return;
        }
        lines.splice(first, 1);
        const target = Math.min(first, lines.length - 1);
        this.commitEdit(lines, target, target, 0, 0);
    }

    /** Ctrl+Shift+D / Alt+Shift+↑↓ — copy the selected lines below (or above) themselves. */
    private duplicateLine(direction: 'up' | 'down' = 'down'): void {
        const { lines, first, last, startCol, endCol } = this.selectionInfo();
        const block = lines.slice(first, last + 1);
        if (direction === 'down') {
            lines.splice(last + 1, 0, ...block);
            this.commitEdit(lines, first + block.length, last + block.length, startCol, endCol);
        } else {
            lines.splice(first, 0, ...block);
            this.commitEdit(lines, first, last, startCol, endCol);
        }
    }

    /** Alt+↑↓ — move the selected lines one line up or down, selection riding along. */
    private moveLine(direction: 'up' | 'down'): void {
        const { lines, first, last, startCol, endCol } = this.selectionInfo();
        if (direction === 'up') {
            if (first === 0) return;
            const above = lines[first - 1]!;
            lines.splice(first - 1, 1);
            lines.splice(last, 0, above);
            this.commitEdit(lines, first - 1, last - 1, startCol, endCol);
        } else {
            if (last >= lines.length - 1) return;
            const below = lines[last + 1]!;
            lines.splice(last + 1, 1);
            lines.splice(first, 0, below);
            this.commitEdit(lines, first + 1, last + 1, startCol, endCol);
        }
    }

    /** Tab / Shift+Tab over a selection — indent or outdent every touched line. */
    private indentSelection(direction: 1 | -1): void {
        const { lines, first, last, startCol, endCol } = this.selectionInfo();
        const pad = ' '.repeat(this.settings.tabSize);
        let firstDelta = 0;
        let lastDelta = 0;
        for (let i = first; i <= last; i++) {
            const line = lines[i]!;
            const next = direction > 0 ? pad + line : line.replace(new RegExp(`^ {1,${this.settings.tabSize}}`), '');
            const delta = next.length - line.length;
            if (i === first) firstDelta = delta;
            if (i === last) lastDelta = delta;
            lines[i] = next;
        }
        this.commitEdit(lines, first, last, Math.max(0, startCol + firstDelta), Math.max(0, endCol + lastDelta));
    }

    /** The phone sheet: drag the grip to set the panel's height, remembered per device. */
    private bindSheetDrag(): void {
        const saved = Number(globalThis.localStorage?.getItem(SHEET_KEY) ?? '');
        if (Number.isFinite(saved) && saved > 0) this.el.style.setProperty('--pe-sheet-h', `${saved}%`);
        let startY = 0;
        let startPct = 0;
        const move = (event: PointerEvent): void => {
            const parent = this.el.parentElement;
            const full = parent?.getBoundingClientRect().height || window.innerHeight;
            const next = startPct + ((startY - event.clientY) / full) * 100;
            const clamped = Math.min(92, Math.max(22, next));
            this.el.style.setProperty('--pe-sheet-h', `${clamped.toFixed(2)}%`);
        };
        const up = (event: PointerEvent): void => {
            this.el.classList.remove('vela-pe-dragging');
            this.el.ownerDocument.removeEventListener('pointermove', move);
            this.el.ownerDocument.removeEventListener('pointerup', up);
            const pct = parseFloat(this.el.style.getPropertyValue('--pe-sheet-h'));
            if (Number.isFinite(pct)) {
                try {
                    globalThis.localStorage?.setItem(SHEET_KEY, String(Math.round(pct)));
                } catch {
                    // storage disabled — the height still applies for this session
                }
            }
            // A tap (no movement) snaps between the two useful heights.
            if (Math.abs(event.clientY - startY) < 4) {
                const nextPct = parseFloat(this.el.style.getPropertyValue('--pe-sheet-h')) > 60 ? 34 : 72;
                this.el.style.setProperty('--pe-sheet-h', `${nextPct}%`);
            }
        };
        this.grip.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            startY = event.clientY;
            startPct = parseFloat(this.el.style.getPropertyValue('--pe-sheet-h')) || 58;
            this.el.classList.add('vela-pe-dragging');
            this.el.ownerDocument.addEventListener('pointermove', move);
            this.el.ownerDocument.addEventListener('pointerup', up);
        });
    }

    // ── chart actions ──────────────────────────────────────────────────────────────

    private get live(): boolean {
        return this.handle !== null;
    }

    /** Find the chart handle that runs THIS script (matched by id, then by source). */
    private syncHandle(): void {
        const chart = this.chart;
        if (!chart) {
            this.handle = null;
            return;
        }
        const handles = chart.indicators().filter((h) => h.source !== undefined);
        this.handle =
            handles.find((h) => (h.id.startsWith('pe-') && h.id === this.chartIdFor(this.active))) ??
            handles.find((h) => h.source === this.active.code) ??
            null;
        this.paint();
    }

    private chartIdFor(script: PineScript): string {
        return `pe-${script.id}`;
    }

    /** The split button's main action: add the script, or push it to the live copy. */
    private async runPrimary(): Promise<void> {
        await this.run(this.handle ? 'update' : 'add');
    }

    private async run(mode: 'add' | 'update'): Promise<void> {
        const chart = this.chart;
        if (!chart) return;
        const started = performance.now();
        this.pushMessage('info', mode === 'add' ? 'Adding to chart…' : 'Updating on chart…');

        if (mode === 'update' && this.handle) {
            const result = await this.handle.updateCode(this.active.code);
            const ms = Math.round(performance.now() - started);
            if (result.ok) {
                this.active = commitVersion(this.active, 'update');
                this.commitActive();
                this.persist();
                this.pushMessage('info', `${this.active.name} updated on chart (${versionLabel(this.active)}, ${ms} ms)`);
                this.render();
            } else {
                this.pushMessage('error', result.error?.message ?? 'Update failed', errorLine(result.error));
            }
            return;
        }

        // A fresh add: drop the previous instance of THIS script so a re-add never stacks
        // two copies (the editor's own id makes that cheap).
        if (this.handle) {
            this.handle.remove();
            this.handle = null;
        }
        const result = await chart.runIndicator(this.active.code, {
            // The chart's OWN default language: the editor is engine-agnostic, so a host
            // that registered only `demo` (the docs example) gets a working editor too.
            language: chart.defaultLanguage,
            id: this.chartIdFor(this.active),
            title: this.active.name,
        });
        const ms = Math.round(performance.now() - started);
        if (result.ok && result.handle) {
            this.handle = result.handle;
            this.active = commitVersion(this.active, 'update');
            this.commitActive();
            this.persist();
            this.pushMessage('info', `${this.active.name} added to chart (${versionLabel(this.active)}, ${ms} ms)`);
            this.render();
        } else {
            this.pushMessage('error', result.error?.message ?? 'The script did not run', errorLine(result.error));
            this.render();
        }
    }

    private saveVersion(): void {
        this.active = commitVersion(this.active, 'save');
        this.commitActive();
        this.persist();
        this.pushMessage('info', `Saved ${this.active.name} as version ${versionLabel(this.active)}`);
        this.render();
    }

    // ── library helpers ────────────────────────────────────────────────────────────

    private commitActive(): void {
        this.library = {
            ...this.library,
            scripts: this.library.scripts.map((s) => (s.id === this.active.id ? this.active : s)),
            activeId: this.active.id,
        };
    }

    private persist(): void {
        saveLibrary((key, value) => globalThis.localStorage?.setItem(key, value), this.library);
    }

    private switchTo(script: PineScript): void {
        this.active = script;
        this.library = { ...this.library, activeId: script.id };
        this.messages.length = 0;
        this.syncHandle();
        this.render();
        this.persist();
        this.focus();
    }

    private addScript(kind: TemplateKind): void {
        const created = createScript(kind);
        this.library = { ...this.library, scripts: [...this.library.scripts, created], activeId: created.id };
        this.switchTo(created);
    }

    // ── rendering ──────────────────────────────────────────────────────────────────

    private render(): void {
        this.nameLabel.textContent = this.active.name;
        this.versionTag.textContent = versionLabel(this.active);
        this.dirtyDot.hidden = !isDirty(this.active);
        this.primary.textContent = this.live ? 'Update on chart' : 'Add to chart';
        if (this.input.value !== this.active.code) this.input.value = this.active.code;
        this.paint();
        this.paintStatus();
    }

    /** Repaint the highlight layer, the gutter and the console — not the textarea value. */
    private paint(): void {
        const code = this.input.value;
        this.highlight.innerHTML = highlight(code) + '\n';
        const errorLines = new Set(this.messages.filter((m) => m.level === 'error' && m.line).map((m) => m.line as number));
        const lines = code.split('\n').length;
        const row = this.body.ownerDocument.createElement('div');
        for (let i = 1; i <= lines; i++) {
            const span = this.body.ownerDocument.createElement('span');
            span.className = errorLines.has(i) ? 'vela-pe-gutter-line vela-pe-err' : 'vela-pe-gutter-line';
            span.textContent = String(i);
            row.append(span);
        }
        this.gutter.replaceChildren(row);
        this.syncScroll();
        this.paintConsole();
        this.paintMinimap();
    }

    private paintConsole(): void {
        const doc = this.body.ownerDocument;
        if (this.messages.length === 0) {
            this.consoleEl.replaceChildren(); // `:empty` hides it — no lone "Clear" bar
            return;
        }
        const visible = this.messages.filter((m) => !this.hiddenLevels.has(m.level));
        const head = doc.createElement('div');
        head.className = 'vela-pe-console-head';
        for (const level of ['info', 'warn', 'error'] as const) {
            const count = this.messages.filter((m) => m.level === level).length;
            if (count === 0) continue;
            const chip = doc.createElement('button');
            chip.type = 'button';
            chip.className = 'vela-pe-filter';
            chip.dataset.level = level;
            chip.setAttribute('aria-pressed', String(!this.hiddenLevels.has(level)));
            chip.textContent = level === 'info' ? 'Info' : level === 'warn' ? 'Warning' : 'Error';
            const badge = doc.createElement('span');
            badge.className = 'vela-pe-filter-count';
            badge.textContent = ` ${count}`;
            chip.append(badge);
            chip.addEventListener('click', () => {
                if (this.hiddenLevels.has(level)) this.hiddenLevels.delete(level);
                else this.hiddenLevels.add(level);
                this.paintConsole();
            });
            head.append(chip);
        }
        const clear = doc.createElement('button');
        clear.type = 'button';
        clear.className = 'vela-pe-clear';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => {
            this.messages.length = 0;
            this.paintConsole();
        });
        head.append(clear);

        this.consoleEl.replaceChildren(
            head,
            ...visible.slice(-40).map((m) => {
                const row = doc.createElement('div');
                row.className = 'vela-pe-msg';
                row.dataset.level = m.level;
                const time = doc.createElement('span');
                time.className = 'vela-pe-msg-time';
                time.textContent = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const text = doc.createElement('span');
                text.className = 'vela-pe-msg-text';
                text.textContent = m.text;
                row.append(time, text);
                if (m.line) {
                    const line = doc.createElement('button');
                    line.className = 'vela-pe-msg-line';
                    line.type = 'button';
                    line.textContent = `line ${m.line}`;
                    line.addEventListener('click', () => this.jumpToLine(m.line as number));
                    row.append(line);
                }
                return row;
            }),
        );
        this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    }

    private syncScroll(): void {
        this.highlight.scrollTop = this.input.scrollTop;
        this.highlight.scrollLeft = this.input.scrollLeft;
        this.gutter.scrollTop = this.input.scrollTop;
    }

    private jumpToLine(line: number): void {
        const lines = this.input.value.split('\n');
        const before = lines.slice(0, Math.max(0, line - 1)).join('\n');
        const start = before.length + (line > 1 ? 1 : 0);
        const end = start + (lines[line - 1]?.length ?? 0);
        this.input.focus();
        this.input.setSelectionRange(start, end);
        const lineHeight = parseFloat(getComputedStyle(this.input).lineHeight) || 20;
        this.input.scrollTop = Math.max(0, (line - 4) * lineHeight);
        this.syncScroll();
    }

    private pushMessage(level: ConsoleMessage['level'], text: string, line?: number): void {
        this.messages.push({ level, text, time: Date.now(), ...(line ? { line } : {}) });
        if (level === 'error') {
            // An error invalidates the last promise: repaint the gutter so the line is marked.
            this.paint();
        } else {
            this.paintConsole();
        }
    }

    /** Push the live script onto every other chart in the layout (shell-provided). */
    private applyToLayout(): void {
        const apply = this.onApplyToLayout;
        if (!apply) return;
        const n = apply();
        this.pushMessage(n > 0 ? 'info' : 'warn', n > 0 ? `Applied ${this.active.name} to ${n} other chart${n === 1 ? '' : 's'}` : 'No other chart to apply to');
    }

    /** Take THIS script's instance off the chart (the handle, not the library entry). */
    private removeFromChart(): void {
        if (!this.handle) return;
        this.handle.remove();
        this.handle = null;
        this.pushMessage('info', `${this.active.name} removed from chart`);
        this.render();
    }

    /** The slim strip under the code: caret, size, language, and whether it is on chart. */
    private paintStatus(): void {
        const doc = this.body.ownerDocument;
        const text = this.input.value;
        const before = text.slice(0, this.input.selectionStart);
        const line = before.split('\n').length;
        const col = before.length - before.lastIndexOf('\n');
        const lines = text.split('\n').length;
        const make = (key: string, label: string, push = false): HTMLElement => {
            const span = doc.createElement('span');
            span.dataset.part = key;
            span.textContent = label;
            if (push) span.className = 'vela-pe-status-push';
            return span;
        };
        const state = make('state', this.live ? `On chart · v${versionLabel(this.active)}` : 'Not on chart');
        if (this.live) state.style.color = 'var(--vela-accent)';
        this.statusEl.replaceChildren(
            make('caret', `Ln ${line}, Col ${col}`),
            make('size', `${lines} line${lines === 1 ? '' : 's'}`),
            make('lang', 'Pine Script'),
            state,
            make('hint', 'Ctrl+Enter to run', true),
        );
    }

    /** One popover, four contents — a second click on the same trigger closes it. */
    private openPop(kind: 'scripts' | 'history' | 'run' | 'more' | 'settings'): void {
        this.hideAutocomplete();
        if (!this.pop.hidden && this.pop.dataset.kind === kind) {
            this.pop.hidden = true;
            return;
        }
        this.pop.dataset.kind = kind;
        this.pop.hidden = false;
        if (kind === 'scripts') this.renderScripts();
        else if (kind === 'history') this.renderHistory();
        else if (kind === 'run') this.renderRunMenu();
        else if (kind === 'settings') this.renderSettings();
        else this.renderMore();
    }

    private toggleHistory(): void {
        this.openPop('history');
    }

    private popTitle(text: string): HTMLElement {
        const title = this.body.ownerDocument.createElement('div');
        title.className = 'vela-pe-pop-title';
        title.textContent = text;
        return title;
    }

    private popSep(): HTMLElement {
        const sep = this.body.ownerDocument.createElement('div');
        sep.className = 'vela-pe-sep';
        return sep;
    }

    /** A menu row that runs `fn` and closes the popover. */
    private actionRow(label: string, fn: () => void, attrs: { disabled?: boolean; hint?: string } = {}): HTMLButtonElement {
        const doc = this.body.ownerDocument;
        const row = doc.createElement('button');
        row.className = 'vela-pe-row';
        row.type = 'button';
        row.textContent = label;
        if (attrs.disabled) row.setAttribute('aria-disabled', 'true');
        if (attrs.hint) {
            const hint = doc.createElement('span');
            hint.className = 'vela-pe-row-meta';
            hint.textContent = attrs.hint;
            row.append(hint);
        }
        row.addEventListener('click', () => {
            if (attrs.disabled) return;
            this.pop.hidden = true;
            fn();
        });
        return row;
    }

    // ── the ⋯ menu ────────────────────────────────────────────────────────────────

    private renderMore(): void {
        this.pop.replaceChildren(
            this.popTitle('Script'),
            this.actionRow('Save version', () => this.saveVersion(), { hint: '⌘S' }),
            this.actionRow('Editor settings', () => this.openPop('settings')),
            this.actionRow('Version history', () => this.openPop('history'), { hint: versionLabel(this.active) }),
            this.popSep(),
            this.actionRow('Rename…', () => this.openPop('scripts')),
            this.actionRow('New indicator', () => this.addScript('indicator')),
            this.actionRow('New strategy', () => this.addScript('strategy')),
            this.popSep(),
            this.actionRow('Remove from chart', () => this.removeFromChart(), { disabled: !this.live }),
            ...(this.onApplyToLayout
                ? [this.actionRow('Apply to entire layout', () => this.applyToLayout(), { disabled: !this.live })]
                : []),
            this.actionRow('Open in full page', () => window.open('./editor.html', '_blank', 'noopener')),
        );
    }

    // ── the scripts popover (name field + the library) ────────────────────────────

    private renderScripts(): void {
        const doc = this.body.ownerDocument;
        const field = doc.createElement('input');
        field.className = 'vela-pe-rename';
        field.value = this.active.name;
        field.setAttribute('aria-label', 'Script name');
        field.spellcheck = false;
        const commit = (): void => {
            const name = field.value.trim();
            if (name && name !== this.active.name) {
                this.active = renameScript(this.active, name);
                this.commitActive();
                this.persist();
                this.render();
                this.pushMessage('info', `Renamed to “${this.active.name}”`);
            }
        };
        field.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Enter') {
                (e as KeyboardEvent).preventDefault();
                commit();
            }
        });
        field.addEventListener('blur', commit);

        const rows = [...this.library.scripts]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((script) => {
                const row = doc.createElement('button');
                row.className = 'vela-pe-row';
                row.type = 'button';
                row.dataset.current = String(script.id === this.active.id);
                const label = doc.createElement('span');
                label.className = 'vela-pe-row-label';
                label.textContent = script.name;
                const meta = doc.createElement('span');
                meta.className = 'vela-pe-row-meta';
                meta.textContent = versionLabel(script);
                row.append(label, meta);
                row.addEventListener('click', () => {
                    this.pop.hidden = true;
                    this.switchTo(script);
                });
                return row;
            });

        this.pop.replaceChildren(
            this.popTitle('Scripts'),
            field,
            ...rows,
            this.popSep(),
            this.actionRow('New indicator', () => this.addScript('indicator')),
            this.actionRow('New strategy', () => this.addScript('strategy')),
        );
        // Focus without selecting: the caret lands after the name, ready to append.
        requestAnimationFrame(() => field.focus());
    }

    private renderHistory(): void {
        const doc = this.body.ownerDocument;
        const current = versionLabel(this.active);
        const rows: Node[] = versionsNewestFirst(this.active).map((v) => {
            const row = doc.createElement('button');
            row.className = 'vela-pe-row';
            row.type = 'button';
            row.dataset.current = String(v.label === current && !isDirty(this.active));
            const label = doc.createElement('span');
            label.className = 'vela-pe-row-label';
            label.textContent = v.label;
            const kind = doc.createElement('span');
            kind.className = 'vela-pe-row-kind';
            kind.textContent = v.kind === 'save' ? 'saved' : 'chart';
            const meta = doc.createElement('span');
            meta.className = 'vela-pe-row-meta';
            meta.textContent = new Date(v.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            row.append(label, kind, meta);
            row.addEventListener('click', () => {
                this.active = restoreVersion(this.active, v.label);
                this.commitActive();
                this.persist();
                this.render();
                this.pop.hidden = true;
                this.pushMessage('info', `Restored ${v.label} into the editor — press Save to make it a new version`);
            });
            return row;
        });
        if (rows.length === 0) rows.push(doc.createTextNode('No versions yet.'));
        this.pop.replaceChildren(this.popTitle('Version history'), ...rows);
    }

    private renderRunMenu(): void {
        this.pop.replaceChildren(
            this.popTitle('Run'),
            this.actionRow('Add to chart', () => void this.run('add')),
            this.actionRow('Update on chart', () => void this.run('update'), { disabled: !this.live }),
        );
    }
}

// ── helpers ────────────────────────────────────────────────────────────────────────

function iconButton(doc: Document, icon: string, label: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.className = 'vela-pe-icon';
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.append(iconEl(icon, doc));
    return button;
}

/** A line number out of an engine error, when the engine reported one. */
function errorLine(error: Error | null): number | undefined {
    if (!error) return undefined;
    const anyError = error as unknown as { line?: unknown; lineNo?: unknown };
    const raw = typeof anyError.line === 'number' ? anyError.line : typeof anyError.lineNo === 'number' ? anyError.lineNo : undefined;
    if (raw !== undefined) return raw;
    const match = /line\s+(\d+)/i.exec(error.message);
    return match ? Number(match[1]) : undefined;
}

/**
 * Pine syntax colouring for the highlight layer. Deliberately tiny and total: every
 * character is escaped and every non-matching run is emitted as text, so the painted
 * layer can never differ from the textarea's characters — only its colours.
 */
export function highlight(code: string): string {
    const escape = (text: string): string =>
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const NAMESPACES = new Set([
        'ta', 'math', 'str', 'array', 'matrix', 'map', 'strategy', 'request', 'input',
        'color', 'shape', 'location', 'size', 'plot', 'line', 'label', 'box', 'table',
        'linefill', 'chart', 'timeframe', 'syminfo', 'time', 'session', 'dayofweek',
        'alert', 'barstate', 'format', 'display', 'currency', 'adjustment', 'barmerge',
        'position', 'scale', 'extend', 'xloc', 'yloc', 'hline', 'text', 'font',
    ]);
    const KEYWORDS = new Set([
        'if', 'else', 'for', 'to', 'by', 'while', 'switch', 'var', 'varip', 'and', 'or',
        'not', 'in', 'import', 'export', 'type', 'method', 'enum', 'series', 'simple',
        'const', 'input', 'return', 'break', 'continue', 'true', 'false', 'na',
    ]);
    const CALLS = new Set([
        'indicator', 'strategy', 'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle',
        'plotbar', 'hline', 'fill', 'bgcolor', 'barcolor', 'alertcondition', 'alert',
        'indicator', 'max_bars_back', 'study',
    ]);

    const pattern = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}))|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|([A-Za-z_][A-Za-z0-9_]*)/g;

    let out = '';
    let last = 0;
    for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
        out += escape(code.slice(last, match.index));
        last = match.index + match[0].length;
        const [full, comment, string, hex, num, callName, paren, ident] = match;
        if (comment) out += `<span class="tk-com">${escape(comment)}</span>`;
        else if (string) out += `<span class="tk-str">${escape(string)}</span>`;
        else if (hex) out += `<span class="tk-const">${escape(hex)}</span>`;
        else if (num) out += `<span class="tk-num">${escape(num)}</span>`;
        else if (callName) {
            const cls = CALLS.has(callName) ? 'tk-fn' : KEYWORDS.has(callName) ? 'tk-kw' : NAMESPACES.has(callName) ? 'tk-ns' : 'tk-fn';
            out += `<span class="${cls}">${escape(callName)}</span>${escape(paren ?? '')}`;
        } else if (ident) {
            if (KEYWORDS.has(ident)) out += `<span class="tk-kw">${escape(ident)}</span>`;
            else if (NAMESPACES.has(ident)) out += `<span class="tk-ns">${escape(ident)}</span>`;
            else out += escape(ident);
        } else out += escape(full);
    }
    return out + escape(code.slice(last));
}
