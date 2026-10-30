// The actual Monaco editing surface. Script storage and execution remain in PineEditor;
// this module supplies the editor, Pine reference providers, and touch-accessible actions.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/edcore.main.js';
import { MONACO_EDITOR_WORKER } from '../vendor/monaco-editor-worker';
import { SYNTAX_DARK, SYNTAX_LIGHT } from '../core/palette';
import { CODE_EDITOR_DARK, CODE_EDITOR_LIGHT } from '../core/theme';
import type { EditorSettings } from './pine-editor-store';
import {
    pineCompletions,
    pineReferenceAt,
    pineSignatureHelp,
    PINE_REFERENCE_DATE,
    type PineReference,
    type PineSuggestion,
} from './pine-language-data';

const LANGUAGE = 'vela-pine-v6';
let registered = false;
let workerUrl: string | null = null;
let sequence = 0;

/** Respect a host's existing Monaco worker configuration; otherwise use the inline worker. */
function configureWorker(): void {
    const scope = globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment };
    const environment = scope.MonacoEnvironment ?? {};
    if (!environment.getWorker && !environment.getWorkerUrl) {
        environment.getWorker = () => {
            workerUrl ??= URL.createObjectURL(new Blob([MONACO_EDITOR_WORKER], { type: 'text/javascript' }));
            return new Worker(workerUrl, { name: 'vela-monaco-editor' });
        };
        scope.MonacoEnvironment = environment;
    }
}

function referenceLink(record: PineReference): string {
    return `https://www.tradingview.com/pine-script-reference/v6/#${record.kind}_${encodeURIComponent(record.name)}`;
}

function documentation(record: PineReference): monaco.IMarkdownString {
    const signatures = record.signatures?.length ? `\`\`\`pine\n${record.signatures.join('\n')}\n\`\`\`\n\n` : '';
    return { value: `${signatures}[Pine v6 reference](${referenceLink(record)}) · snapshot ${PINE_REFERENCE_DATE}\n\nEditor suggestions do not guarantee runtime support.` };
}

function completionKind(kind: PineSuggestion['kind']): monaco.languages.CompletionItemKind {
    const kinds = monaco.languages.CompletionItemKind;
    if (kind === 'fun' || kind === 'localFunction') return kinds.Function;
    if (kind === 'method') return kinds.Method;
    if (kind === 'parameter' || kind === 'property') return kinds.Field;
    if (kind === 'namespace') return kinds.Module;
    if (kind === 'type') return kinds.Class;
    if (kind === 'kw') return kinds.Keyword;
    if (kind === 'const') return kinds.Constant;
    return kinds.Variable;
}

function insertFor(item: PineSuggestion, hasParen: boolean, hasDot: boolean, hasEquals: boolean): string {
    if (item.kind === 'namespace') return hasDot ? item.label : `${item.label}.`;
    if (item.kind === 'parameter') return hasEquals ? item.label : `${item.label} = `;
    if (item.kind !== 'fun' && item.kind !== 'method' && item.kind !== 'localFunction') return item.label;
    const name = item.label
        .replace('<type,type>', '<${1:string}, ${2:float}>')
        .replace('<type>', '<${1:float}>');
    return hasParen ? name : `${name}($0)`;
}

function registerPine(): void {
    if (registered) return;
    registered = true;
    monaco.languages.register({ id: LANGUAGE, extensions: ['.pine'], aliases: ['Pine Script'] });
    monaco.languages.setLanguageConfiguration(LANGUAGE, {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
            { open: '"', close: '"', notIn: ['string', 'comment'] },
            { open: "'", close: "'", notIn: ['string', 'comment'] },
        ],
        surroundingPairs: [
            { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
            { open: '"', close: '"' }, { open: "'", close: "'" },
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(?:(?:if|else|for|while|switch|type|enum|method)\b.*|.*=>\s*)$/,
            decreaseIndentPattern: /^\s*(?:else\b)/,
        },
        folding: { offSide: true },
    });
    monaco.languages.setMonarchTokensProvider(LANGUAGE, {
        defaultToken: '',
        keywords: ['if', 'else', 'for', 'to', 'by', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not', 'in',
            'import', 'export', 'type', 'method', 'enum', 'series', 'simple', 'const', 'break', 'continue'],
        typeKeywords: ['int', 'float', 'bool', 'string', 'color', 'array', 'matrix', 'map', 'line', 'label', 'box',
            'table', 'linefill', 'polyline', 'footprint', 'volume_row'],
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/"/, 'string', '@stringDouble'],
                [/'/, 'string', '@stringSingle'],
                [/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/, 'constant'],
                [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
                [/[a-zA-Z_]\w*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'function' } }],
                [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', 'true|false|na': 'constant', '@default': 'identifier' } }],
                [/[{}()[\]]/, '@brackets'],
                [/[=><!~?:&|+\-*/%^]+/, 'operator'],
            ],
            comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']],
            stringDouble: [[/[^\\"]+/, 'string'], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
            stringSingle: [[/[^\\']+/, 'string'], [/\\./, 'string.escape'], [/'/, 'string', '@pop']],
        },
    });
    monaco.languages.registerCompletionItemProvider(LANGUAGE, {
        triggerCharacters: ['.'],
        provideCompletionItems(model, position) {
            const offset = model.getOffsetAt(position);
            const completion = pineCompletions(model.getValue(), offset);
            const end = model.getWordAtPosition(position)?.endColumn ?? position.column;
            const range = new monaco.Range(position.lineNumber, position.column - completion.word.length, position.lineNumber, end);
            const afterWord = model.getLineContent(position.lineNumber).slice(end - 1);
            const hasParen = /^\s*\(/.test(afterWord);
            const hasDot = /^\s*\./.test(afterWord);
            const hasEquals = /^\s*=/.test(afterWord);
            return { suggestions: completion.items.map((item): monaco.languages.CompletionItem => {
                const callable = item.kind === 'fun' || item.kind === 'method' || item.kind === 'localFunction';
                return {
                    label: item.label,
                    kind: completionKind(item.kind),
                    insertText: insertFor(item, hasParen, hasDot, hasEquals),
                    insertTextRules: callable ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                    range,
                    detail: item.signature ?? item.reference?.signatures?.[0] ?? (item.kind === 'namespace' ? 'Pine namespace' : item.kind === 'local' ? 'Script symbol' : item.kind),
                    documentation: item.reference ? documentation(item.reference) : undefined,
                    command: item.kind === 'namespace'
                        ? { id: 'editor.action.triggerSuggest', title: 'Suggest namespace members' }
                        : callable && !hasParen ? { id: 'editor.action.triggerParameterHints', title: 'Show parameters' } : undefined,
                    sortText: `${item.kind === 'local' || item.kind === 'localFunction' ? '0' : item.kind === 'namespace' ? '1' : '2'}-${item.label}`,
                };
            }) };
        },
    });
    monaco.languages.registerSignatureHelpProvider(LANGUAGE, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [','],
        provideSignatureHelp(model, position) {
            const result = pineSignatureHelp(model.getValue(), model.getOffsetAt(position));
            if (!result) return null;
            return { value: {
                signatures: result.signatures.map((signature) => ({
                    label: signature.label,
                    parameters: signature.parameters.map((parameter) => ({ label: parameter.label, documentation: parameter.type })),
                })),
                activeSignature: result.activeSignature,
                activeParameter: result.activeParameter,
            }, dispose() { /* no resources */ } };
        },
    });
    monaco.languages.registerHoverProvider(LANGUAGE, {
        provideHover(model, position) {
            const result = pineReferenceAt(model.getValue(), model.getOffsetAt(position));
            if (!result) return null;
            return {
                range: monaco.Range.fromPositions(model.getPositionAt(result.start), model.getPositionAt(result.end)),
                contents: [documentation(result.record)],
            };
        },
    });
}

export interface PineSurfaceCallbacks {
    onChange(value: string): void;
    onCursor(): void;
    onRun(): void;
    onSave(): void;
    onNew(): void;
    onOpen(): void;
    onToggleConsole(): void;
}

interface ActionItem {
    label: string;
    id: string;
    shortcut?: string;
    disabled?: boolean;
}

export class PineCodeSurface {
    private readonly editor: monaco.editor.IStandaloneCodeEditor;
    private readonly mount: HTMLDivElement;
    private readonly menu: HTMLDivElement;
    private readonly feedback: HTMLDivElement;
    private readonly models = new Map<string, monaco.editor.ITextModel>();
    private readonly views = new Map<string, monaco.editor.ICodeEditorViewState | null>();
    private readonly id = ++sequence;
    private currentKey = '';
    private syncing = false;
    private readOnly = false;
    private tabSize: number;
    private minimapPreferred: boolean;
    private minimapShown: boolean;
    private resizeObserver: ResizeObserver | null = null;
    private touchTimer: ReturnType<typeof setTimeout> | null = null;
    private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
    private touchStart: { x: number; y: number; identifier: number } | null = null;
    private suppressNativeUntil = 0;
    private destroyed = false;
    private readonly onOutside: (event: PointerEvent) => void;
    private readonly onTouchStart: (event: TouchEvent) => void;
    private readonly onTouchMove: (event: TouchEvent) => void;
    private readonly onTouchEnd: () => void;
    private readonly onContextMenu: (event: MouseEvent) => void;

    constructor(private readonly host: HTMLElement, private readonly callbacks: PineSurfaceCallbacks, settings: EditorSettings) {
        configureWorker();
        registerPine();
        this.tabSize = settings.tabSize;
        this.minimapPreferred = settings.minimap;
        this.minimapShown = settings.minimap && !this.isCompact();
        const doc = host.ownerDocument;
        this.mount = doc.createElement('div');
        this.mount.className = 'vela-pe-monaco';
        this.menu = doc.createElement('div');
        this.menu.className = 'vela-pe-editor-menu';
        this.menu.setAttribute('role', 'menu');
        this.menu.setAttribute('aria-label', 'Editor actions');
        this.menu.hidden = true;
        this.feedback = doc.createElement('div');
        this.feedback.className = 'vela-pe-editor-feedback';
        this.feedback.setAttribute('role', 'status');
        this.feedback.setAttribute('aria-live', 'polite');
        this.feedback.hidden = true;
        host.replaceChildren(this.mount, this.menu, this.feedback);
        this.editor = monaco.editor.create(this.mount, {
            model: null,
            automaticLayout: true,
            ariaLabel: 'Pine Script source',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: settings.fontSize,
            lineHeight: Math.round(settings.fontSize * 1.55),
            scrollBeyondLastLine: false,
            smoothScrolling: false,
            contextmenu: true,
            glyphMargin: false,
            folding: true,
            lineNumbersMinChars: 3,
            minimap: { enabled: this.minimapShown, scale: 1, maxColumn: 100 },
            rulers: settings.lineGuide ? [80] : [],
            quickSuggestions: { other: settings.suggestions, comments: false, strings: false },
            suggestOnTriggerCharacters: settings.suggestions,
            wordBasedSuggestions: 'off',
            parameterHints: { enabled: true },
            padding: { top: 8, bottom: 8 },
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
            overviewRulerBorder: false,
            renderLineHighlight: 'line',
            fixedOverflowWidgets: true,
            accessibilitySupport: 'auto',
        });
        this.editor.onDidChangeModelContent(() => {
            if (!this.syncing && !this.readOnly) this.callbacks.onChange(this.editor.getValue());
        });
        this.editor.onDidChangeCursorPosition(() => this.callbacks.onCursor());
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.syncMinimap());
            this.resizeObserver.observe(host);
        }
        this.bindCommands();
        this.onOutside = (event) => {
            if (!this.menu.hidden && !this.menu.contains(event.target as Node)) this.closeMenu();
        };
        doc.addEventListener('pointerdown', this.onOutside);
        this.onTouchStart = (event) => {
            if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
            if (event.target.closest('.vela-pe-editor-menu, .scrollbar, .minimap, .suggest-widget, .find-widget')) return;
            const touch = event.touches[0]!;
            this.cancelTouch();
            this.touchStart = { x: touch.clientX, y: touch.clientY, identifier: touch.identifier };
            this.touchTimer = setTimeout(() => {
                const start = this.touchStart;
                if (!start) return;
                this.suppressNativeUntil = Date.now() + 1400;
                this.openMenu(start.x, start.y, true);
                this.touchTimer = null;
            }, 620);
        };
        this.onTouchMove = (event) => {
            if (!this.touchStart) return;
            const touch = [...event.touches].find((item) => item.identifier === this.touchStart?.identifier);
            if (!touch || Math.hypot(touch.clientX - this.touchStart.x, touch.clientY - this.touchStart.y) > 10) this.cancelTouch();
        };
        this.onTouchEnd = () => this.cancelTouch();
        this.onContextMenu = (event) => {
            // A real right click retains Monaco's own full context menu. Only a touch
            // long-press is intercepted so it does not open two competing menus.
            const isTouch = 'pointerType' in event && (event as PointerEvent).pointerType === 'touch';
            if (!isTouch && Date.now() > this.suppressNativeUntil) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (this.menu.hidden) this.openMenu(event.clientX, event.clientY, true);
            this.cancelTouch();
        };
        this.mount.addEventListener('touchstart', this.onTouchStart, { passive: true });
        this.mount.addEventListener('touchmove', this.onTouchMove, { passive: true });
        this.mount.addEventListener('touchend', this.onTouchEnd, { passive: true });
        this.mount.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
        this.mount.addEventListener('contextmenu', this.onContextMenu, true);
        this.menu.addEventListener('keydown', (event) => this.menuKeydown(event));
    }

    private bindCommands(): void {
        const mod = monaco.KeyMod.CtrlCmd;
        this.editor.addCommand(mod | monaco.KeyCode.Enter, () => this.callbacks.onRun());
        this.editor.addCommand(mod | monaco.KeyCode.KeyS, () => this.callbacks.onSave());
        this.editor.addCommand(mod | monaco.KeyCode.KeyI, () => this.callbacks.onNew());
        this.editor.addCommand(mod | monaco.KeyCode.KeyO, () => this.callbacks.onOpen());
        this.editor.addCommand(mod | monaco.KeyCode.Backquote, () => this.callbacks.onToggleConsole());
        this.editor.addCommand(mod | monaco.KeyCode.KeyD, () => this.runEditorAction('editor.action.deleteLines'));
        this.editor.addCommand(mod | monaco.KeyMod.Shift | monaco.KeyCode.KeyD, () => this.runEditorAction('editor.action.copyLinesDownAction'));
    }

    showDocument(key: string, code: string, readOnly: boolean): void {
        if (this.destroyed) return;
        this.syncing = true;
        const old = this.editor.getModel();
        if (old && this.currentKey && this.currentKey !== key) this.views.set(this.currentKey, this.editor.saveViewState());
        let model = this.models.get(key);
        if (!model) {
            model = monaco.editor.createModel(code, LANGUAGE, monaco.Uri.parse(`inmemory://vela-pine/${this.id}/${encodeURIComponent(key)}.pine`));
            model.updateOptions({ tabSize: this.tabSize, insertSpaces: true });
            this.models.set(key, model);
        } else if (model.getValue() !== code) model.setValue(code);
        this.currentKey = key;
        this.readOnly = readOnly;
        this.editor.updateOptions({ readOnly, domReadOnly: readOnly });
        this.mount.dataset.readonly = String(readOnly);
        if (old !== model) {
            this.editor.setModel(model);
            const view = this.views.get(key);
            if (view) this.editor.restoreViewState(view);
        }
        this.syncing = false;
    }

    applySettings(settings: EditorSettings): void {
        this.tabSize = settings.tabSize;
        this.minimapPreferred = settings.minimap;
        this.minimapShown = settings.minimap && !this.isCompact();
        this.editor.updateOptions({
            fontSize: settings.fontSize,
            lineHeight: Math.round(settings.fontSize * 1.55),
            minimap: { enabled: this.minimapShown, scale: 1, maxColumn: 100 },
            rulers: settings.lineGuide ? [80] : [],
            quickSuggestions: { other: settings.suggestions, comments: false, strings: false },
            suggestOnTriggerCharacters: settings.suggestions,
        });
        for (const model of this.models.values()) model.updateOptions({ tabSize: settings.tabSize, insertSpaces: true });
    }

    private isCompact(): boolean {
        return this.host.closest<HTMLElement>('[data-layout]')?.dataset.layout === 'mobile';
    }

    private syncMinimap(): void {
        const enabled = this.minimapPreferred && !this.isCompact();
        if (enabled === this.minimapShown || this.destroyed) return;
        this.minimapShown = enabled;
        this.editor.updateOptions({ minimap: { enabled, scale: 1, maxColumn: 100 } });
    }

    setTheme(dark: boolean, background: string): void {
        const palette = dark ? SYNTAX_DARK : SYNTAX_LIGHT;
        const chrome = dark ? CODE_EDITOR_DARK : CODE_EDITOR_LIGHT;
        const name = dark ? 'vela-pine-dark' : 'vela-pine-light';
        const bg = /^#[0-9a-f]{6}$/i.test(background) ? background : chrome.background;
        monaco.editor.defineTheme(name, {
            base: dark ? 'vs-dark' : 'vs',
            inherit: true,
            rules: [
                { token: 'comment', foreground: dark ? '969ba7' : '656b76', fontStyle: 'italic' },
                { token: 'string', foreground: palette.string.slice(1) },
                { token: 'number', foreground: palette.number.slice(1) },
                { token: 'keyword', foreground: palette.keyword.slice(1) },
                { token: 'type', foreground: palette.namespace.slice(1) },
                { token: 'function', foreground: palette.call.slice(1) },
                { token: 'constant', foreground: palette.constant.slice(1) },
            ],
            colors: {
                'editor.background': bg,
                'editorGutter.background': bg,
                'minimap.background': bg,
                'editor.foreground': chrome.foreground,
                'editorLineNumber.foreground': chrome.lineNumber,
                'editorLineNumber.activeForeground': chrome.activeLineNumber,
                'editor.selectionBackground': chrome.selection,
                'editor.inactiveSelectionBackground': chrome.inactiveSelection,
                'editor.lineHighlightBackground': chrome.lineHighlight,
                'editorWidget.background': chrome.widgetBackground,
                'editorSuggestWidget.background': chrome.widgetBackground,
                'editorSuggestWidget.foreground': chrome.widgetForeground,
                'editorSuggestWidget.selectedBackground': chrome.widgetSelected,
                'editorWidget.border': chrome.widgetBorder,
                'focusBorder': chrome.focusBorder,
            },
        });
        monaco.editor.setTheme(name);
    }

    focus(): void { this.editor.focus(); }
    layout(): void { this.editor.layout(); }
    dismissOverlays(): void {
        this.closeMenu();
        this.editor.trigger('vela', 'hideSuggestWidget', null);
        this.editor.trigger('vela', 'closeParameterHints', null);
    }
    getPosition(): { line: number; column: number; lines: number } {
        const position = this.editor.getPosition();
        return { line: position?.lineNumber ?? 1, column: position?.column ?? 1, lines: this.editor.getModel()?.getLineCount() ?? 1 };
    }

    setErrors(errors: { line: number; text: string }[]): void {
        const model = this.editor.getModel();
        if (!model) return;
        const markers: monaco.editor.IMarkerData[] = errors.filter((error) => error.line >= 1 && error.line <= model.getLineCount()).map((error) => ({
            severity: monaco.MarkerSeverity.Error,
            message: error.text,
            startLineNumber: error.line,
            endLineNumber: error.line,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(error.line),
        }));
        monaco.editor.setModelMarkers(model, 'vela-engine', markers);
    }

    jumpToLine(line: number): void {
        const model = this.editor.getModel();
        if (!model) return;
        const target = Math.max(1, Math.min(model.getLineCount(), line));
        this.editor.setSelection(new monaco.Range(target, 1, target, model.getLineMaxColumn(target)));
        this.editor.revealLineInCenter(target);
        this.editor.focus();
    }

    showActions(anchor?: HTMLElement): void {
        const rect = (anchor ?? this.host).getBoundingClientRect();
        this.openMenu(anchor ? rect.left : rect.left + 12, anchor ? rect.top : rect.top + 12, false);
    }

    private runEditorAction(id: string): void {
        const action = this.editor.getAction(id);
        if (action) void action.run();
        else this.editor.trigger('vela', id, null);
    }

    private actionItems(): ActionItem[] {
        const selection = this.editor.getSelection();
        const selected = !!selection && !selection.isEmpty();
        return [
            { label: 'Undo', id: 'undo', shortcut: 'Ctrl+Z', disabled: this.readOnly },
            { label: 'Redo', id: 'redo', shortcut: 'Ctrl+Shift+Z', disabled: this.readOnly },
            { label: 'Cut', id: 'cut', disabled: this.readOnly || !selected },
            { label: 'Copy', id: 'copy', disabled: !selected },
            { label: 'Paste', id: 'paste', disabled: this.readOnly },
            { label: 'Select all', id: 'editor.action.selectAll', shortcut: 'Ctrl+A' },
            { label: 'Find', id: 'actions.find', shortcut: 'Ctrl+F' },
            { label: 'Replace', id: 'editor.action.startFindReplaceAction', disabled: this.readOnly },
            { label: 'Toggle line comment', id: 'editor.action.commentLine', disabled: this.readOnly },
            { label: 'Suggest', id: 'editor.action.triggerSuggest', shortcut: 'Ctrl+Space', disabled: this.readOnly },
            { label: 'Command palette', id: 'editor.action.quickCommand', shortcut: 'F1' },
        ];
    }

    private openMenu(clientX: number, clientY: number, touch: boolean): void {
        if (this.destroyed) return;
        if (touch) {
            const selection = this.editor.getSelection();
            if (!selection || selection.isEmpty()) {
                const target = this.editor.getTargetAtClientPoint(clientX, clientY);
                if (target?.position) this.editor.setPosition(target.position);
            }
        }
        const doc = this.host.ownerDocument;
        this.menu.replaceChildren(...this.actionItems().map((item) => {
            const button = doc.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.disabled = !!item.disabled;
            button.className = 'vela-pe-editor-menu-item';
            const label = doc.createElement('span');
            label.textContent = item.label;
            button.append(label);
            if (item.shortcut) {
                const shortcut = doc.createElement('span');
                shortcut.className = 'vela-pe-editor-menu-shortcut';
                shortcut.textContent = item.shortcut;
                button.append(shortcut);
            }
            button.addEventListener('click', () => {
                this.closeMenu();
                if (item.id === 'copy' || item.id === 'cut' || item.id === 'paste') void this.clipboard(item.id);
                else {
                    this.editor.focus();
                    this.runEditorAction(item.id);
                }
            });
            return button;
        }));
        this.menu.hidden = false;
        const bounds = this.host.getBoundingClientRect();
        const menuRect = this.menu.getBoundingClientRect();
        const left = Math.max(2, Math.min(clientX - bounds.left, bounds.width - menuRect.width - 2));
        const top = Math.max(2, Math.min(clientY - bounds.top, bounds.height - menuRect.height - 2));
        this.menu.style.left = `${left}px`;
        this.menu.style.top = `${top}px`;
        // Touch keeps the editor's selection and avoids summoning the virtual keyboard.
        // Button / keyboard invocation focuses the first action for menu navigation.
        if (!touch) this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }

    private menuKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); this.closeMenu(); this.editor.focus(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!buttons.length) return;
        const index = buttons.indexOf(this.host.ownerDocument.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
            (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
    }

    private closeMenu(): void { this.menu.hidden = true; }
    private cancelTouch(): void {
        if (this.touchTimer) clearTimeout(this.touchTimer);
        this.touchTimer = null;
        this.touchStart = null;
    }

    private notify(message: string): void {
        this.feedback.textContent = message;
        this.feedback.hidden = false;
        if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
        this.feedbackTimer = setTimeout(() => { this.feedback.hidden = true; }, 5500);
    }

    private async clipboard(action: 'copy' | 'cut' | 'paste'): Promise<void> {
        const model = this.editor.getModel();
        const selection = this.editor.getSelection();
        if (!model || !selection || (this.readOnly && action !== 'copy')) return;
        const version = model.getVersionId();
        const clipboard = this.host.ownerDocument.defaultView?.navigator.clipboard;
        try {
            if (action === 'paste') {
                if (!clipboard?.readText) throw new Error('Clipboard read unavailable');
                const text = await clipboard.readText();
                if (this.editor.getModel() !== model || model.getVersionId() !== version) {
                    this.notify('Document changed before paste completed; please paste again.');
                    return;
                }
                this.editor.focus();
                this.editor.executeEdits('vela-paste', [{ range: selection, text, forceMoveMarkers: true }]);
                return;
            }
            const text = model.getValueInRange(selection);
            if (!text) return;
            if (clipboard?.writeText) await clipboard.writeText(text);
            else {
                this.editor.focus();
                if (!this.host.ownerDocument.execCommand(action)) throw new Error('Clipboard write unavailable');
                return; // The native cut event already edits the model.
            }
            if (action === 'cut') {
                if (this.editor.getModel() !== model || model.getVersionId() !== version) {
                    this.notify('Text copied, but the document changed before it could be cut.');
                    return;
                }
                this.editor.focus();
                this.editor.executeEdits('vela-cut', [{ range: selection, text: '', forceMoveMarkers: true }]);
            } else this.editor.focus();
        } catch {
            this.notify(action === 'paste'
                ? 'Paste is blocked by this browser. Use your keyboard or native Paste option.'
                : `${action === 'cut' ? 'Cut' : 'Copy'} is blocked by this browser. Use your keyboard or native selection menu.`);
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.cancelTouch();
        if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
        const doc = this.host.ownerDocument;
        doc.removeEventListener('pointerdown', this.onOutside);
        this.mount.removeEventListener('touchstart', this.onTouchStart);
        this.mount.removeEventListener('touchmove', this.onTouchMove);
        this.mount.removeEventListener('touchend', this.onTouchEnd);
        this.mount.removeEventListener('touchcancel', this.onTouchEnd);
        this.mount.removeEventListener('contextmenu', this.onContextMenu, true);
        this.editor.dispose();
        for (const model of this.models.values()) model.dispose();
        this.models.clear();
    }
}
