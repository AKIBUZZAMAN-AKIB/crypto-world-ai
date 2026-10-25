// The editor's document model — scripts, drafts and VERSION HISTORY. Pure, no DOM: these
// are the rules a trader feels ("Update on chart bumped 26.0 to 26.1 and kept my settings"),
// so they are asserted here rather than inferred from a screenshot.
import { describe, expect, it } from 'vitest';
import {
    commitVersion,
    complete,
    lineStarts,
    loadSettings,
    saveSettings,
    DEFAULT_SETTINGS,
    createScript,
    editCode,
    isDirty,
    loadLibrary,
    renameScript,
    restoreVersion,
    saveLibrary,
    versionLabel,
    versionsNewestFirst,
    TEMPLATES,
    type PineScript,
    type ScriptLibrary,
} from '../src/widget/pine-editor-store';

const script = (): PineScript => createScript('indicator', 'Test', 'id-1');

describe('pine editor store', () => {
    it('starts every script at 1.0 with that version recorded', () => {
        const s = script();
        expect(versionLabel(s)).toBe('1.0');
        expect(s.versions).toHaveLength(1);
        expect(s.versions[0]!.code).toBe(TEMPLATES.indicator.code);
        expect(isDirty(s)).toBe(false);
    });

    it('edits the draft without touching the version list', () => {
        const s = editCode(script(), '// changed');
        expect(s.code).toBe('// changed');
        expect(s.versions).toHaveLength(1);
        expect(isDirty(s)).toBe(true);
    });

    it('Update on chart bumps the MINOR version and keeps the settings-bearing code', () => {
        const s = commitVersion(editCode(script(), '// v1'), 'update');
        expect(versionLabel(s)).toBe('1.1');
        expect(s.versions.map((v) => v.label)).toEqual(['1.0', '1.1']);
        expect(s.versions[1]!.kind).toBe('update');
        expect(isDirty(s)).toBe(false);
    });

    it('Save bumps the MAJOR version and resets the minor', () => {
        let s = commitVersion(editCode(script(), '// v1'), 'update'); // 1.1
        s = commitVersion(editCode(s, '// v2'), 'save'); // 2.0
        expect(versionLabel(s)).toBe('2.0');
        s = commitVersion(editCode(s, '// v3'), 'update'); // 2.1
        expect(versionLabel(s)).toBe('2.1');
    });

    it('never records the same text twice', () => {
        const s = commitVersion(script(), 'save');
        expect(s.versions).toHaveLength(1);
        expect(versionLabel(s)).toBe('1.0');
    });

    it('restores a version into the draft WITHOUT committing it', () => {
        let s = commitVersion(editCode(script(), '// v1'), 'save'); // 2.0
        s = editCode(s, '// v2');
        const restored = restoreVersion(s, '1.0');
        expect(restored.code).toBe(TEMPLATES.indicator.code);
        expect(restored.versions).toHaveLength(2); // no new version
        expect(isDirty(restored)).toBe(true); // the restore is a draft, like TV
        expect(versionLabel(restored)).toBe('2.0');
    });

    it('lists versions newest first', () => {
        let s = commitVersion(editCode(script(), '// v1'), 'update');
        s = commitVersion(editCode(s, '// v2'), 'update');
        expect(versionsNewestFirst(s).map((v) => v.label)).toEqual(['1.2', '1.1', '1.0']);
    });

    it('renames, refusing an empty or unchanged name', () => {
        const s = script();
        expect(renameScript(s, '  ')).toBe(s);
        expect(renameScript(s, 'Test')).toBe(s);
        expect(renameScript(s, ' Renamed ').name).toBe('Renamed');
    });

    it('round-trips a library through storage and drops a corrupt document', () => {
        const store = new Map<string, string>();
        const read = (k: string): string | null => store.get(k) ?? null;
        const write = (k: string, v: string): void => void store.set(k, v);

        const a = script();
        const b = createScript('strategy', 'Strat', 'id-2');
        const library: ScriptLibrary = { scripts: [a, b], activeId: 'id-2' };
        saveLibrary(write, library);
        const back = loadLibrary(read);
        expect(back?.scripts.map((s) => s.name)).toEqual(['Test', 'Strat']);
        expect(back?.activeId).toBe('id-2');

        // An activeId that names no script falls back to the first one, never undefined.
        store.set('vela-pine-library', JSON.stringify({ scripts: [a], activeId: 'gone' }));
        expect(loadLibrary(read)?.activeId).toBe('id-1');

        store.set('vela-pine-library', '{not json');
        expect(loadLibrary(read)).toBeNull();
        store.set('vela-pine-library', JSON.stringify({ scripts: [{ nope: true }] }));
        expect(loadLibrary(read)).toBeNull();
    });

    it('survives a storage that throws (private mode)', () => {
        const throwing = (): string | null => {
            throw new Error('denied');
        };
        expect(loadLibrary(throwing)).toBeNull();
        expect(() => saveLibrary(() => {
            throw new Error('denied');
        }, { scripts: [script()], activeId: 'id-1' })).not.toThrow();
    });

    it('offers completions from Pine\'s vocabulary and the script\'s own variables', () => {
        const items = complete('ta.sm', 'x = ta.sma(close, 20)\nmyOnce = 1\n');
        expect(items.map((i) => i.label)).toContain('ta.sma');
        expect(complete('myOnc', 'myOnce = 1\n').map((i) => i.kind)).toEqual(['variable']);
        // An exact match is not offered back; an empty prefix offers nothing.
        expect(complete('ta.sma', '')).toHaveLength(0);
        expect(complete('', 'plot(close)')).toHaveLength(0);
        expect(complete('zzz', 'plot(close)')).toHaveLength(0);
    });

    it('maps line offsets for the caret maths the editing shortcuts rely on', () => {
        expect(lineStarts('')).toEqual([0]);
        expect(lineStarts('a\nb\nc')).toEqual([0, 2, 4]);
        expect(lineStarts('ab\n\ncd')).toEqual([0, 3, 4]);
    });

    it('reads editor settings defensively and clamps the numbers', () => {
        const store = new Map<string, string>();
        const read = (k: string): string | null => store.get(k) ?? null;
        const write = (k: string, v: string): void => void store.set(k, v);
        expect(loadSettings(read)).toEqual(DEFAULT_SETTINGS);

        saveSettings(write, { suggestions: false, minimap: false, lineGuide: false, fontSize: 16, tabSize: 2 });
        expect(loadSettings(read)).toEqual({ suggestions: false, minimap: false, lineGuide: false, fontSize: 16, tabSize: 2 });

        store.set('vela-pine-editor-settings', JSON.stringify({ fontSize: 99, tabSize: 0, minimap: 'yes' }));
        const clamped = loadSettings(read);
        expect(clamped.fontSize).toBe(20);
        expect(clamped.tabSize).toBe(2);
        expect(clamped.minimap).toBe(DEFAULT_SETTINGS.minimap);

        store.set('vela-pine-editor-settings', 'not json');
        expect(loadSettings(read)).toEqual(DEFAULT_SETTINGS);
    });
});