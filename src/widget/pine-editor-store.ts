// The Pine editor's document model — scripts and their VERSION HISTORY.
//
// TradingView's editor keeps a script library ("My scripts"), a draft per script, and a
// revision list you can restore from; "Save" creates a version, "Update on chart" bumps
// only the minor one (26.0 → 26.1) and keeps the settings. This module is that model,
// with no DOM: the panel renders it, the shell persists it, and the tests assert on it.
//
// Version numbering is dotted and monotonic: `major` moves on an explicit save, `minor`
// on an update-to-chart, so the label a trader reads always tells them which kind of
// change they are looking at.

export interface ScriptVersion {
    /** Dotted label, e.g. `3.2`. */
    label: string;
    /** When the version was cut (epoch ms). */
    time: number;
    code: string;
    /** What produced it — a save, or an update pushed to the chart. */
    kind: 'save' | 'update';
}

export interface PineScript {
    id: string;
    /** Shown in the editor's selector and on the chart's legend. */
    name: string;
    /** The working copy — what the editor shows and the chart runs. */
    code: string;
    major: number;
    minor: number;
    /** Oldest first; the last entry is the version currently in `code`. */
    versions: ScriptVersion[];
    /** Epoch ms of the last edit, for ordering "My scripts". */
    updatedAt: number;
}

export interface ScriptLibrary {
    scripts: PineScript[];
    /** The script the editor opens with. */
    activeId: string;
}

/** A fresh script from one of the editor's templates. */
export const TEMPLATES = {
    indicator: {
        name: 'Indicator',
        code: `//@version=6
indicator("My indicator", overlay=true)

len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")

basis = ta.sma(src, len)

plot(basis, "Basis", color=color.new(color.blue, 0), linewidth=2)
`,
    },
    strategy: {
        name: 'Strategy',
        code: `//@version=6
strategy("My strategy", overlay=true, initial_capital=100000)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
    strategy.exit("Exit", from_entry="Long", profit=300, loss=150)

if ta.crossunder(fast, slow)
    strategy.close("Long")

plot(fast, "Fast", color=color.orange)
plot(slow, "Slow", color=color.blue)
`,
    },
} as const;

export type TemplateKind = keyof typeof TEMPLATES;

let counter = 0;

/** A stable-enough id for a new script (no crypto dependency, survives a reload). */
export function newScriptId(seed = Date.now()): string {
    counter += 1;
    return `s${seed.toString(36)}${counter.toString(36)}`;
}

export function createScript(template: TemplateKind = 'indicator', name?: string, id = newScriptId()): PineScript {
    const t = TEMPLATES[template];
    const now = Date.now();
    return {
        id,
        name: name ?? t.name,
        code: t.code,
        major: 1,
        minor: 0,
        versions: [{ label: '1.0', time: now, code: t.code, kind: 'save' }],
        updatedAt: now,
    };
}

/** The label of the version the working copy currently corresponds to. */
export function versionLabel(script: PineScript): string {
    return `${script.major}.${script.minor}`;
}

/** True when the working copy differs from the newest recorded version. */
export function isDirty(script: PineScript): boolean {
    const last = script.versions[script.versions.length - 1];
    return last === undefined || last.code !== script.code;
}

/**
 * Record the working copy as a new version. `save` bumps the major part (the trader said
 * "this is a real revision"); `update` bumps the minor one (the tradermerely changed the
 * code that is already on the chart). A no-op when the code is unchanged — re-saving
 * identical text must not fill the history with duplicates.
 */
export function commitVersion(script: PineScript, kind: 'save' | 'update' = 'save', now = Date.now()): PineScript {
    const last = script.versions[script.versions.length - 1];
    if (last && last.code === script.code) return script;
    const major = kind === 'save' ? script.major + 1 : script.major;
    const minor = kind === 'save' ? 0 : script.minor + 1;
    const label = `${major}.${minor}`;
    return {
        ...script,
        major,
        minor,
        updatedAt: now,
        versions: [...script.versions, { label, time: now, code: script.code, kind }],
    };
}

/** Edit the working copy. Does NOT touch the version list — that is what Save is for. */
export function editCode(script: PineScript, code: string, now = Date.now()): PineScript {
    if (script.code === code) return script;
    return { ...script, code, updatedAt: now };
}

export function renameScript(script: PineScript, name: string, now = Date.now()): PineScript {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === script.name) return script;
    return { ...script, name: trimmed, updatedAt: now };
}

/**
 * Restore a version into the working copy. The restored text becomes the draft — it is
 * NOT committed, so "Save" after a restore is what makes it a new revision (the same
 * behaviour, and the same confusion, TradingView's own history has).
 */
export function restoreVersion(script: PineScript, label: string, now = Date.now()): PineScript {
    const v = script.versions.find((entry) => entry.label === label);
    if (!v) return script;
    return { ...script, code: v.code, updatedAt: now };
}

// ── Editor preferences ─────────────────────────────────────────────────────────────

/**
 * The editor's own settings — TradingView's "Editor settings" block in the three-dot
 * menu. Small on purpose: every one of them changes how the CODE SURFACE behaves, and
 * each is persisted per device.
 */
export interface EditorSettings {
    /** Autocomplete while typing (`Ctrl+Space` always offers it, whatever this says). */
    suggestions: boolean;
    /** The code overview strip on the right — click to jump. */
    minimap: boolean;
    /** The vertical 80-character guide. */
    lineGuide: boolean;
    /** Code font size in px (11–20). */
    fontSize: number;
    /** Tab width in spaces. */
    tabSize: number;
}

export const DEFAULT_SETTINGS: EditorSettings = {
    suggestions: true,
    minimap: true,
    lineGuide: true,
    fontSize: 12.5,
    tabSize: 4,
};

export const SETTINGS_KEY = 'vela-pine-editor-settings';

/** Read settings, filling anything missing/corrupt from the defaults. Never throws. */
export function loadSettings(read: (key: string) => string | null): EditorSettings {
    try {
        const raw = read(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<EditorSettings>;
        return {
            suggestions: typeof parsed.suggestions === 'boolean' ? parsed.suggestions : DEFAULT_SETTINGS.suggestions,
            minimap: typeof parsed.minimap === 'boolean' ? parsed.minimap : DEFAULT_SETTINGS.minimap,
            lineGuide: typeof parsed.lineGuide === 'boolean' ? parsed.lineGuide : DEFAULT_SETTINGS.lineGuide,
            fontSize: clampNumber(parsed.fontSize, 11, 20, DEFAULT_SETTINGS.fontSize),
            tabSize: clampNumber(parsed.tabSize, 2, 8, DEFAULT_SETTINGS.tabSize),
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings(write: (key: string, value: string) => void, settings: EditorSettings): void {
    try {
        write(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // storage disabled — the settings still apply for this session
    }
}

function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

// ── Persistence ────────────────────────────────────────────────────────────────────

export const LIBRARY_KEY = 'vela-pine-library';

/** Read the library, or null when there is nothing usable stored. Never throws. */
export function loadLibrary(read: (key: string) => string | null): ScriptLibrary | null {
    try {
        const raw = read(LIBRARY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ScriptLibrary>;
        const scripts = Array.isArray(parsed.scripts) ? parsed.scripts.filter(isScript) : [];
        if (scripts.length === 0) return null;
        const activeId = scripts.some((s) => s.id === parsed.activeId) ? (parsed.activeId as string) : scripts[0]!.id;
        return { scripts, activeId };
    } catch {
        return null;
    }
}

export function saveLibrary(write: (key: string, value: string) => void, library: ScriptLibrary): void {
    try {
        write(LIBRARY_KEY, JSON.stringify(library));
    } catch {
        // Storage full/disabled: the editor keeps working in memory.
    }
}

function isScript(value: unknown): value is PineScript {
    if (typeof value !== 'object' || value === null) return false;
    const s = value as Partial<PineScript>;
    return (
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.code === 'string' &&
        typeof s.major === 'number' &&
        typeof s.minor === 'number' &&
        Array.isArray(s.versions)
    );
}

/** The version list, newest first — how the history panel reads it. */
export function versionsNewestFirst(script: PineScript): ScriptVersion[] {
    return [...script.versions].reverse();
}

/** Every word the editor offers: Pine's namespaces, keywords, common calls, and the
 *  identifiers already in THIS script (so a trader's own variables complete too). */
const COMPLETIONS: ReadonlyArray<{ label: string; kind: string }> = [
    ...['ta', 'math', 'str', 'array', 'matrix', 'map', 'strategy', 'request', 'input', 'color', 'shape',
        'location', 'size', 'plot', 'line', 'label', 'box', 'table', 'linefill', 'chart', 'timeframe',
        'syminfo', 'time', 'session', 'dayofweek', 'alert', 'barstate', 'format', 'display', 'currency',
        'adjustment', 'barmerge', 'position', 'scale', 'extend', 'xloc', 'yloc', 'hline', 'text', 'font',
        'log', 'runtime'].map((label) => ({ label, kind: 'namespace' })),
    ...['if', 'else', 'for', 'to', 'by', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not', 'in',
        'import', 'export', 'type', 'method', 'enum', 'series', 'simple', 'const', 'true', 'false', 'na',
        'break', 'continue', 'return'].map((label) => ({ label, kind: 'keyword' })),
    ...['indicator', 'strategy', 'library', 'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle',
        'plotbar', 'hline', 'fill', 'bgcolor', 'barcolor', 'alertcondition', 'alert', 'input.int',
        'input.float', 'input.bool', 'input.string', 'input.source', 'input.timeframe', 'ta.sma',
        'ta.ema', 'ta.rsi', 'ta.atr', 'ta.crossover', 'ta.crossunder', 'ta.highest', 'ta.lowest',
        'ta.stdev', 'ta.change', 'ta.mom', 'strategy.entry', 'strategy.exit', 'strategy.close',
        'strategy.long', 'strategy.short', 'math.abs', 'math.max', 'math.min', 'math.round',
        'color.new', 'color.red', 'color.green', 'color.blue', 'color.orange', 'color.white',
        'label.new', 'line.new', 'box.new', 'table.new'].map((label) => ({ label, kind: 'function' })),
];

/** Suggestions for `prefix`, drawn from the vocabulary plus this script's own names. */
export function complete(prefix: string, code: string): Array<{ label: string; kind: string }> {
    const needle = prefix.toLowerCase();
    const words = new Map<string, string>();
    for (const item of COMPLETIONS) words.set(item.label, item.kind);
    for (const match of code.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
        const name = match[1]!;
        if (!words.has(name)) words.set(name, 'variable');
    }
    if (needle === '') return [];
    return [...words.entries()]
        .filter(([label]) => label.toLowerCase().startsWith(needle) && label.toLowerCase() !== needle)
        .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([label, kind]) => ({ label, kind }));
}

/** The character offset each line starts at (line 0 starts at 0). */
export function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
}
