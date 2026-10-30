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
import { MIN_FLOAT_PANEL_WIDTH, SidePanel } from './side-panel';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { Tooltip } from '../ui/components/tooltip';
import { isDarkColor } from '../core/color';
import { WARNING } from '../core/palette';
import type { PineCodeSurface } from './pine-code-surface';
import { builtinPineEntries } from '../core/native-indicators/classics/pine-source';
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
    type EditorSettings,
    type PineScript,
    type ScriptLibrary,
    type TemplateKind,
} from './pine-editor-store';

const STYLE_ID = 'vela-widget-pine-editor';

const CSS = `
.vela-pe[data-standard-pane] .vela-panel-body { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
/* Keep a real editor viewport and the status/actions reachable by scrolling a tiny card. */
.vela-pe[data-compact-height='1'] .vela-panel-body { overflow: auto; }
.vela-pe[data-compact-height='1'] .vela-pe-wrap { flex: none; height: 76px; min-height: 76px; }
/* The script's OWN name is the header's title here (TradingView's shape): a panel
   heading above it would say "Pine editor" twice and cost the name its width. */
.vela-pe .vela-panel-title { display: none; }
.vela-pe .vela-panel-header-slot { margin-left: -4px; gap: 4px; }

/* The shared standard-pane shell owns the phone grip and desktop geometry. */
[data-layout='mobile'] .vela-pe-status [data-part='hint'] { display: none; }
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
.vela-pe-act.primary { background: var(--vela-accent); color: var(--vela-fg-on-fill); }
.vela-pe-act[hidden], .vela-pe-caret[hidden] { display: none; }
.vela-pe-act:disabled { opacity: 0.5; cursor: default; }
.vela-pe-split { display: inline-flex; align-items: stretch; }
.vela-pe-split .vela-pe-act { border-radius: 5px 0 0 5px; }
.vela-pe-caret {
    all: unset;
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 26px;
    border-radius: 0 5px 5px 0;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    cursor: pointer;
    border-left: 1px solid rgba(0, 0, 0, 0.25);
}
.vela-pe-caret .vela-icon { font-size: 11px; }
.vela-pe-act.primary:hover, .vela-pe-caret:hover { filter: none; background: color-mix(in srgb, var(--vela-accent) 92%, #000); }
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

/* The surface is Monaco; no translucent textarea or imitation gutter is retained. */
.vela-pe-wrap { flex: 1 1 auto; min-width: 0; min-height: 0; position: relative; overflow: hidden; }
.vela-pe-monaco { position: absolute; inset: 0; }
.vela-pe-loading { padding: 12px; color: var(--vela-fg-muted); font-size: 12px; }
.vela-pe-editor-menu {
    position: absolute; z-index: 20; width: min(218px, calc(100% - 4px));
    max-height: calc(100% - 4px); overflow-y: auto; overscroll-behavior: contain;
    box-sizing: border-box; padding: 4px; border: 1px solid var(--vela-border-strong);
    border-radius: 6px; background: var(--vela-surface-overlay, var(--vela-bg));
    color: var(--vela-fg); box-shadow: var(--vela-shadow);
}
.vela-pe-editor-menu[hidden], .vela-pe-editor-feedback[hidden] { display: none; }
.vela-pe-editor-menu-item {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
    width: 100%; min-height: 29px; padding: 4px 8px; border-radius: 4px;
    color: var(--vela-fg); cursor: pointer; font: 12px/1.3 system-ui, sans-serif;
}
.vela-pe-editor-menu-item:hover, .vela-pe-editor-menu-item:focus-visible { background: var(--vela-selected-bg); color: var(--vela-selected-fg); outline: none; }
.vela-pe-editor-menu-item:disabled { opacity: .45; cursor: default; }
.vela-pe-editor-menu-shortcut { margin-left: auto; font-size: 10px; color: var(--vela-fg-muted); }
.vela-pe-editor-menu-item:focus-visible .vela-pe-editor-menu-shortcut { color: inherit; }
.vela-pe-editor-feedback {
    position: absolute; z-index: 21; left: 8px; right: 8px; bottom: 8px;
    padding: 8px 10px; border: 1px solid var(--vela-border-strong); border-radius: 4px;
    color: var(--vela-fg); background: var(--vela-surface-overlay, var(--vela-bg));
    box-shadow: var(--vela-shadow); font: 12px/1.35 system-ui, sans-serif;
}
[data-layout='mobile'] .vela-pe-editor-menu-item { min-height: 36px; }
.vela-pe-status { overflow-x: auto; scrollbar-width: none; }
.vela-pe-status::-webkit-scrollbar { display: none; }
.vela-pe-status-action {
    all: unset; box-sizing: border-box; flex: none; padding: 2px 6px; border-radius: 3px;
    color: var(--vela-accent-ink, var(--vela-accent)); cursor: pointer; font-weight: 600;
}
.vela-pe-status-action:hover, .vela-pe-status-action:focus-visible { background: var(--vela-selected-bg); color: var(--vela-selected-fg); outline: none; }

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

/* ── console ───────────────────────────────────────────────────────────────────── */
/* Built-in source view (TradingView's read-only { } view): a banner that explains the
   lock and offers the one way out — create a working copy. */
.vela-pe-builtin {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, ${WARNING} 45%, transparent);
    background: color-mix(in srgb, ${WARNING} 14%, transparent);
    color: var(--vela-fg);
    font-size: 11.5px;
    line-height: 1.35;
}
.vela-pe-builtin[hidden] { display: none; }
.vela-pe-builtin b { font-weight: 600; }
.vela-pe-builtin button {
    margin-left: auto;
    flex: none;
    padding: 3px 9px;
    border: 1px solid var(--vela-border);
    border-radius: 4px;
    background: var(--vela-bg);
    color: var(--vela-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}
.vela-pe-builtin button:hover { background: var(--vela-hover); }
.vela-pe-builtin-list { max-height: 260px; overflow-y: auto; }

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
    color: var(--vela-accent-ink, var(--vela-accent));
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
    z-index: 100;
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
    /** Markers belong to the latest engine attempt, not to the whole console history. */
    private readonly engineErrors: { line: number; text: string }[] = [];
    /** Invalidates late diagnostics after a draft, script or chart changes. */
    private diagnosticEpoch = 0;

    // Elements
    private readonly nameButton: HTMLButtonElement;
    private readonly nameLabel: HTMLSpanElement;
    private readonly dirtyDot: HTMLSpanElement;
    private readonly versionTag: HTMLSpanElement;
    private readonly primary: HTMLButtonElement;
    private readonly caret: HTMLButtonElement;
    private readonly scriptsButton: HTMLButtonElement;
    private readonly wrap: HTMLDivElement;
    private surface: PineCodeSurface | null = null;
    private loadingSurface: Promise<void> | null = null;
    private surfaceDestroyed = false;
    private focusAfterLoad = false;
    private readonly consoleEl: HTMLDivElement;
    private readonly statusEl: HTMLDivElement;
    private settings: EditorSettings;

    /** Levels the console is showing — TradingView's level filter, in miniature. */
    private readonly hiddenLevels = new Set<ConsoleMessage['level']>();
    /** Console suppressed with Ctrl+` (the shortcut toggles it back). */
    private consoleCollapsed = false;


    private readonly pop: HTMLDivElement;
    /** The banner shown while a BUILT-IN script is open (read-only, like TradingView). */
    private readonly builtinBar: HTMLDivElement;
    private readonly builtinCopy: HTMLButtonElement;
    /**
     * The built-in script currently on screen, or null when the editor edits a library
     * script. A built-in is READ-ONLY: TradingView opens the study's source in the editor
     * but never lets an edit touch the study — you make a copy first.
     */
    private builtin: { title: string; source: string } | null = null;
    /** The editor's surface, waiting for the first open. See the constructor. */
    private pendingBody: HTMLElement[] | null = null;

    constructor(host: HTMLElement) {
        super(host, 'Pine editor', 'vela-pe', {
            resizable: true,
            width: 520,
            minWidth: MIN_FLOAT_PANEL_WIDTH,
            maxWidth: 980,
            standardPane: true,
            mobileMinHeight: 216,
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
        this.wrap = doc.createElement('div');
        this.wrap.className = 'vela-pe-wrap';
        this.wrap.setAttribute('aria-label', 'Pine Script editor');
        const loading = doc.createElement('div');
        loading.className = 'vela-pe-loading';
        loading.textContent = 'Loading editor…';
        this.wrap.append(loading);

        this.statusEl = doc.createElement('div');
        this.statusEl.className = 'vela-pe-status';

        this.consoleEl = doc.createElement('div');
        this.consoleEl.className = 'vela-pe-console';

        this.pop = doc.createElement('div');
        this.pop.className = 'vela-pe-pop';
        this.pop.hidden = true;

        this.builtinBar = doc.createElement('div');
        this.builtinBar.className = 'vela-pe-builtin';
        this.builtinBar.hidden = true;
        const builtinText = doc.createElement('span');
        builtinText.innerHTML = '<b>Built-in script</b> — read-only. Create a working copy to edit it.';
        this.builtinCopy = doc.createElement('button');
        this.builtinCopy.type = 'button';
        this.builtinCopy.textContent = 'Make a copy';
        this.builtinCopy.addEventListener('click', () => this.makeWorkingCopy());
        this.builtinBar.append(builtinText, this.builtinCopy);

        // Keep the expensive editor unmounted until the panel first opens.
        this.pendingBody = [this.builtinBar, this.wrap, this.statusEl, this.consoleEl, this.pop];

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
        this.surfaceDestroyed = true;
        this.clearEngineErrors();
        this.surface?.destroy();
        this.surface = null;
        super.destroy();
    }

    /**
     * Open/close, and re-read the surface colour on the way in: a chart theme flipped while
     * the panel was closed must not give the trader dark-theme tokens on a white sheet.
     */
    override toggle(open = !this.open, instant = false): void {
        if (open) {
            this.mountBody();
            if (!this.surface && !this.pendingBody) void this.loadSurface();
        }
        super.toggle(open, instant);
        if (open) {
            this.syncSurface();
            requestAnimationFrame(() => this.surface?.layout());
        }
    }

    /** Put the editor's surface into the panel body — once, on its first open. */
    private mountBody(): void {
        const pending = this.pendingBody;
        if (!pending) return;
        this.pendingBody = null;
        this.body.append(...pending);
        void this.loadSurface();
    }

    private async loadSurface(): Promise<void> {
        if (this.loadingSurface || this.surface || this.surfaceDestroyed) return;
        this.loadingSurface = (async () => {
            try {
                const { PineCodeSurface: Surface } = await import('./pine-code-surface');
                if (this.surfaceDestroyed) return;
                this.surface = new Surface(this.wrap, {
                    onChange: (value) => {
                        if (this.builtin) return;
                        this.active = editCode(this.active, value);
                        this.clearEngineErrors();
                        this.commitActive();
                        this.dirtyDot.hidden = !isDirty(this.active);
                        this.persist();
                        this.paintStatus();
                    },
                    onCursor: () => this.paintStatus(),
                    onRun: () => void this.runPrimary(),
                    onSave: () => this.saveVersion(),
                    onNew: () => this.addScript('indicator'),
                    onOpen: () => this.openPop('scripts'),
                    onToggleConsole: () => {
                        this.consoleCollapsed = !this.consoleCollapsed;
                        this.consoleEl.style.display = this.consoleCollapsed ? 'none' : '';
                    },
                }, this.settings);
                this.render();
                this.applySettings();
                this.syncSurface();
                if (this.focusAfterLoad && this.open) this.surface.focus();
                this.focusAfterLoad = false;
                requestAnimationFrame(() => this.surface?.layout());
            } catch (error) {
                if (this.surfaceDestroyed) return;
                const message = this.body.ownerDocument.createElement('div');
                message.className = 'vela-pe-loading';
                message.textContent = 'Editor could not load. Close and reopen this panel to retry.';
                this.wrap.replaceChildren(message);
                console.error('Pine editor failed to load', error);
            } finally {
                this.loadingSurface = null;
            }
        })();
        await this.loadingSurface;
    }

    /** Pick the syntax palette from the background actually painted behind the panel. */
    private syncSurface(): void {
        const bg = getComputedStyle(this.el).getPropertyValue('--vela-bg').trim();
        const dark = isDarkColor(bg || '#000');
        this.el.dataset.surface = dark ? 'dark' : 'light';
        this.surface?.setTheme(dark, bg);
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
        if (this.chart !== chart) this.clearEngineErrors();
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
    openSource(source: string, title?: string, opts: { readOnly?: boolean } = {}): void {
        this.messages.length = 0;
        this.clearEngineErrors();
        if (opts.readOnly) {
            // A built-in study's source: shown, never edited. `render()` reads `builtin`
            // instead of `active`, so the library and its versions are untouched.
            this.builtin = { title: title || 'Built-in script', source };
            this.builtinBar.hidden = false;
            this.render();
            this.focus();
            return;
        }
        this.builtin = null;
        this.builtinBar.hidden = true;
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
        if (this.surface) this.surface.focus();
        else this.focusAfterLoad = true;
    }

    // ── wiring ─────────────────────────────────────────────────────────────────────

    private bind(): void {
        const doc = this.body.ownerDocument;

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

        new Tooltip(this.scriptsButton, { content: 'More actions', host: this.body });
    }

    /** Push the persisted settings onto Monaco. */
    private applySettings(): void {
        this.surface?.applySettings(this.settings);
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
        hint.textContent = 'Use Ctrl+Space or Actions → Suggest. Minimap is hidden in phone portrait.';
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
        if (this.builtin) {
            this.makeWorkingCopy();
            return;
        }
        await this.run(this.handle ? 'update' : 'add');
    }

    private async run(mode: 'add' | 'update'): Promise<void> {
        const chart = this.chart;
        if (!chart) return;
        // The engine runs this exact snapshot even if the user types or switches scripts
        // while it is working. Late errors must not annotate a different draft or chart.
        const script = this.active;
        const code = script.code;
        const handle = this.handle;
        const started = performance.now();
        const epoch = this.clearEngineErrors();
        const current = (): boolean => !this.surfaceDestroyed && this.chart === chart && !this.builtin && this.active.id === script.id;
        const currentAttempt = (): boolean => current() && this.diagnosticEpoch === epoch && this.active.code === code;
        this.pushMessage('info', mode === 'add' ? 'Adding to chart…' : 'Updating on chart…');

        if (mode === 'update' && handle) {
            const result = await handle.updateCode(code);
            const ms = Math.round(performance.now() - started);
            if (result.ok) {
                const version = this.commitExecutedSnapshot(script.id, code);
                if (current() && version) {
                    this.syncHandle();
                    this.pushMessage('info', `${version.name} updated on chart (${versionLabel(version)}, ${ms} ms)`);
                    this.render();
                }
            } else if (currentAttempt()) {
                this.pushMessage('error', result.error?.message ?? 'Update failed', errorLine(result.error));
            }
            return;
        }

        // A fresh add: drop the previous instance of THIS script so a re-add never stacks
        // two copies (the editor's own id makes that cheap).
        if (handle) {
            handle.remove();
            if (this.handle === handle) this.handle = null;
        }
        const result = await chart.runIndicator(code, {
            // The chart's OWN default language: the editor is engine-agnostic, so a host
            // that registered only `demo` (the docs example) gets a working editor too.
            language: chart.defaultLanguage,
            id: this.chartIdFor(script),
            title: script.name,
        });
        const ms = Math.round(performance.now() - started);
        if (result.ok && result.handle) {
            const version = this.commitExecutedSnapshot(script.id, code);
            if (current() && version) {
                this.handle = result.handle;
                this.pushMessage('info', `${version.name} added to chart (${versionLabel(version)}, ${ms} ms)`);
                this.render();
            }
        } else if (currentAttempt()) {
            this.pushMessage('error', result.error?.message ?? 'The script did not run', errorLine(result.error));
            this.render();
        }
    }

    private saveVersion(): void {
        if (this.builtin) {
            this.pushMessage('warn', 'Create a working copy before saving a built-in script.');
            return;
        }
        this.active = commitVersion(this.active, 'save');
        this.commitActive();
        this.persist();
        this.pushMessage('info', `Saved ${this.active.name} as version ${versionLabel(this.active)}`);
        this.render();
    }

    // ── library helpers ────────────────────────────────────────────────────────────

    /** Version what actually ran, while retaining any newer draft and active script. */
    private commitExecutedSnapshot(id: string, code: string): PineScript | null {
        if (this.surfaceDestroyed) return null;
        const current = this.library.scripts.find((script) => script.id === id);
        if (!current) return null;
        const version = commitVersion({ ...current, code }, 'update');
        const next = { ...version, code: current.code, updatedAt: Math.max(version.updatedAt, current.updatedAt) };
        this.library = { ...this.library, scripts: this.library.scripts.map((script) => script.id === id ? next : script) };
        if (this.active.id === id) this.active = next;
        this.persist();
        return next;
    }

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
        this.clearEngineErrors();
        this.builtin = null;
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
        const builtin = this.builtin;
        this.nameLabel.textContent = builtin ? builtin.title : this.active.name;
        this.versionTag.textContent = builtin ? 'built-in' : versionLabel(this.active);
        this.dirtyDot.hidden = builtin ? true : !isDirty(this.active);
        // A built-in has ONE call to action — the banner's "Make a copy", the way
        // TradingView puts it. Two identical buttons in one header just split the eye.
        this.primary.textContent = builtin ? 'Make a copy' : this.live ? 'Update on chart' : 'Add to chart';
        this.primary.hidden = builtin !== null;
        const code = builtin ? builtin.source : this.active.code;
        const key = builtin ? `builtin:${builtin.title}` : `script:${this.active.id}`;
        this.surface?.showDocument(key, code, builtin !== null);
        this.builtinBar.hidden = !builtin;
        this.caret.hidden = builtin !== null;
        this.paint();
        this.paintStatus();
    }

    /**
     * TradingView's "create a working copy": the built-in's text becomes a NEW library
     * script (the built-in itself is never modified), and the editor switches to it.
     */
    makeWorkingCopy(): void {
        const builtin = this.builtin;
        if (!builtin) return;
        this.clearEngineErrors();
        const created = createScript('indicator', `${builtin.title} copy`);
        const copy = { ...created, code: builtin.source, versions: [{ ...created.versions[0]!, code: builtin.source }] };
        this.library = { ...this.library, scripts: [...this.library.scripts, copy], activeId: copy.id };
        this.active = copy;
        this.builtin = null;
        this.builtinBar.hidden = true;
        this.syncHandle();
        this.render();
        this.persist();
        this.pushMessage('info', `Working copy of “${builtin.title}” created — edit and add it to the chart.`);
        this.focus();
    }

    /** Invalidate in-flight diagnostics and remove markers from the current model. */
    private clearEngineErrors(): number {
        this.diagnosticEpoch += 1;
        this.engineErrors.length = 0;
        this.surface?.setErrors([]);
        return this.diagnosticEpoch;
    }

    /** Only engine-reported errors become Monaco markers; no synthetic diagnostics. */
    private paint(): void {
        this.surface?.setErrors(this.engineErrors);
        this.paintConsole();
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
            this.clearEngineErrors();
            this.paint();
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

    private jumpToLine(line: number): void {
        this.surface?.jumpToLine(line);
    }

    private pushMessage(level: ConsoleMessage['level'], text: string, line?: number): void {
        this.messages.push({ level, text, time: Date.now(), ...(line ? { line } : {}) });
        if (level === 'error') {
            if (line) this.engineErrors.push({ line, text });
            // Only the engine's reported line becomes an editor marker.
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
        const position = this.surface?.getPosition() ?? { line: 1, column: 1, lines: (this.builtin?.source ?? this.active.code).split('\n').length };
        const { line, column: col, lines } = position;
        const make = (key: string, label: string, push = false): HTMLElement => {
            const span = doc.createElement('span');
            span.dataset.part = key;
            span.textContent = label;
            if (push) span.className = 'vela-pe-status-push';
            return span;
        };
        const state = make('state', this.live ? `On chart · v${versionLabel(this.active)}` : 'Not on chart');
        if (this.live) state.style.color = 'var(--vela-accent-ink, var(--vela-accent))';
        const language = make('lang', 'Pine Script');
        language.title = 'Pine v6 reference suggestions; execution depends on the configured engine.';
        this.statusEl.replaceChildren(
            make('caret', `Ln ${line}, Col ${col}`),
            make('size', `${lines} line${lines === 1 ? '' : 's'}`),
            language,
            state,
            make('hint', 'Ctrl+Enter to run', true),
        );
        const actions = doc.createElement('button');
        actions.type = 'button';
        actions.className = 'vela-pe-status-action';
        actions.textContent = 'Actions';
        actions.setAttribute('aria-label', 'Editor actions');
        actions.addEventListener('click', () => this.surface?.showActions(actions));
        this.statusEl.append(actions);
    }

    /** One popover, four contents — a second click on the same trigger closes it. */
    private openPop(kind: 'scripts' | 'history' | 'run' | 'more' | 'settings' | 'builtin'): void {
        this.surface?.dismissOverlays();
        if (!this.pop.hidden && this.pop.dataset.kind === kind) {
            this.pop.hidden = true;
            return;
        }
        this.pop.dataset.kind = kind;
        this.pop.hidden = false;
        if (kind === 'scripts') this.renderScripts();
        else if (kind === 'builtin') this.renderBuiltins();
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
            // TradingView's "Open → Built-in script…": browse the studies whose own Pine
            // code we can show, and open one read-only.
            this.actionRow('Open built-in script…', () => this.openPop('builtin'), { hint: String(builtinPineEntries().length) }),
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
            this.actionRow('Built-in scripts…', () => this.openPop('builtin'), { hint: String(builtinPineEntries().length) }),
        );
        // Focus without selecting: the caret lands after the name, ready to append.
        requestAnimationFrame(() => field.focus());
    }

    /**
     * TradingView's "Create new → Built-in…": the catalog of built-in studies that have a
     * Pine implementation. Picking one opens it READ-ONLY (the study itself is never edited).
     */
    private renderBuiltins(): void {
        const doc = this.body.ownerDocument;
        const field = doc.createElement('input');
        field.className = 'vela-pe-rename';
        field.placeholder = 'Search built-ins';
        field.setAttribute('aria-label', 'Search built-in scripts');
        field.spellcheck = false;
        const list = doc.createElement('div');
        list.className = 'vela-pe-builtin-list';
        const entries = builtinPineEntries();
        const paint = (): void => {
            const query = field.value.trim().toLowerCase();
            const rows: Node[] = entries
                .filter((e) => query === '' || e.title.toLowerCase().includes(query))
                .map((entry) => {
                    const row = doc.createElement('button');
                    row.className = 'vela-pe-row';
                    row.type = 'button';
                    const label = doc.createElement('span');
                    label.className = 'vela-pe-row-label';
                    label.textContent = entry.title;
                    const meta = doc.createElement('span');
                    meta.className = 'vela-pe-row-meta';
                    meta.textContent = 'built-in';
                    row.append(label, meta);
                    row.addEventListener('click', () => {
                        this.pop.hidden = true;
                        this.openSource(entry.source, entry.title, { readOnly: true });
                    });
                    return row;
                });
            if (rows.length === 0) rows.push(doc.createTextNode('No built-in matches that name.'));
            list.replaceChildren(...rows);
        };
        field.addEventListener('input', paint);
        paint();
        this.pop.replaceChildren(this.popTitle('Built-in scripts'), field, list);
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
                this.clearEngineErrors();
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
