// @vitest-environment jsdom
// TradingView's six built-in indicator templates: the list itself (ids, names, order) and
// the promise that every type a built-in names is a registered native, so applying one is
// never a dangling reference.
import { describe, it, expect, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { BUILTIN_TEMPLATES, builtinTemplate } from '../src/state/builtin-templates';
import { registerClassicIndicators } from '../src/core/native-indicators/classics';
import { getNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { registerNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { volumeDescriptor } from '../src/core/native-indicators/volume/VolumeIndicator';

const typeOf = (entry: unknown): string => (typeof entry === 'string' ? entry : (entry as { type: string }).type);

beforeAll(() => {
    registerClassicIndicators();
    registerNativeIndicator(volumeDescriptor);
});

describe('the built-in templates', () => {
    it('are TradingView’s six, in its order', () => {
        expect(BUILTIN_TEMPLATES.map((t) => t.name)).toEqual([
            "Bill Williams' 3 Lines",
            'Displaced EMA',
            'MA Exp Ribbon',
            'Oscillators',
            'Swing Trading',
            'Volume Based',
        ]);
    });

    it('every entry has a unique id and at least one indicator', () => {
        const ids = BUILTIN_TEMPLATES.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const t of BUILTIN_TEMPLATES) {
            expect(t.indicators.length, t.name).toBeGreaterThan(0);
            expect(t.description.length, t.name).toBeGreaterThan(0);
        }
    });

    it('names only registered native types', () => {
        for (const t of BUILTIN_TEMPLATES) {
            for (const entry of t.indicators) expect(getNativeIndicator(typeOf(entry)), `${t.name} → ${typeOf(entry)}`).toBeTruthy();
        }
    });

    it('carries the settings that make each one what it is', () => {
        const ribbon = BUILTIN_TEMPLATES.find((t) => t.id === 'ma-exp-ribbon')!;
        const lengths = ribbon.indicators.map((e) => (e as { inputs?: Record<string, unknown> }).inputs?.length);
        expect(lengths).toEqual([8, 13, 21, 34, 55]);
        const displaced = BUILTIN_TEMPLATES.find((t) => t.id === 'displaced-ema')!;
        expect((displaced.indicators[0] as { inputs?: Record<string, unknown> }).inputs).toMatchObject({ offset: 5 });
    });

    it('and nothing else is a built-in', () => {
        expect(builtinTemplate('nope')).toBeNull();
        expect(builtinTemplate('oscillators')?.name).toBe('Oscillators');
    });
});
