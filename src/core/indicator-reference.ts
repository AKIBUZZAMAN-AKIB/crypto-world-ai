import type { IndicatorHandle } from './IndicatorHandle';

/** A chart-local, persisted instance reference. The ordinal distinguishes repeated SMAs
 * or repeated scripts; it is scoped to the same native type / script, not to the chart. */
export interface IndicatorReference { key: string; ordinal: number }

function hash(text: string): string {
    let n = 2166136261;
    for (let i = 0; i < text.length; i += 1) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36);
}

export function indicatorReferenceKey(h: IndicatorHandle): string {
    return h.nativeType ? `native:${h.nativeType}` : h.source ? `script:${hash(`${h.language ?? ''}\0${h.source}`)}` : `title:${h.title}`;
}

export function indicatorReference(handles: readonly IndicatorHandle[], id: string): IndicatorReference | null {
    const target = handles.find((h) => h.id === id);
    if (!target) return null;
    const key = indicatorReferenceKey(target);
    const siblings = handles.filter((h) => indicatorReferenceKey(h) === key);
    const ordinal = siblings.findIndex((h) => h.id === id);
    return ordinal < 0 ? null : { key, ordinal };
}

export function resolveIndicatorReference(handles: readonly IndicatorHandle[], ref: IndicatorReference): IndicatorHandle | undefined {
    return handles.filter((h) => indicatorReferenceKey(h) === ref.key)[ref.ordinal];
}
