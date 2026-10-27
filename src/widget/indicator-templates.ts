// Indicator templates are NOT layouts: they are a set of indicators + settings. This
// module owns the four tabs the separate panel shows, so the desktop dropdown, the
// phone dialog and the indicator picker's Templates page all filter one way.
export type IndicatorTemplateTab = 'favorites' | 'my' | 'technical' | 'financial';

export const INDICATOR_TEMPLATE_TABS: ReadonlyArray<{ id: IndicatorTemplateTab; label: string }> = [
    { id: 'favorites', label: 'Favorites' },
    { id: 'my', label: 'My templates' },
    { id: 'technical', label: 'Technical' },
    { id: 'financial', label: 'Financial' },
];

export interface IndicatorTemplateBuiltin {
    id: string;
    name: string;
    description: string;
    count: number;
    /** Explicit category from the host; absent entries are classified by id. */
    category?: 'Technical' | 'Financial';
}

export interface IndicatorTemplateRow {
    name: string;
    count: number;
    symbol?: string;
    timeframe?: string;
}

/** Built-ins that read market participation/flow belong on the Financial tab; the rest
 *  are classic Technical studies. A host can override with `category`. */
export function builtinTemplateCategory(builtin: IndicatorTemplateBuiltin): 'Technical' | 'Financial' {
    if (builtin.category) return builtin.category;
    return /volume|obv|vwap|money-flow|flow/i.test(`${builtin.id} ${builtin.name}`) ? 'Financial' : 'Technical';
}

export const favoriteKeyForTemplate = (name: string): string => `template:${name}`;
export const favoriteKeyForBuiltin = (id: string): string => `builtin:${id}`;

/** Pure tab filter: Favorites can mix saved and built-in templates; My templates shows
 *  only the user's own; Technical/Financial show the two built-in categories. */
export function templatesForTab<T extends IndicatorTemplateRow, B extends IndicatorTemplateBuiltin>(
    tab: IndicatorTemplateTab,
    rows: readonly T[],
    builtins: readonly B[],
    favorites: readonly string[],
): { rows: T[]; builtins: B[]; empty: string } {
    const fav = new Set(favorites);
    if (tab === 'favorites') {
        return {
            rows: rows.filter((r) => fav.has(favoriteKeyForTemplate(r.name))),
            builtins: builtins.filter((b) => fav.has(favoriteKeyForBuiltin(b.id))),
            empty: 'No favorite templates yet — use the pin on any template row.',
        };
    }
    if (tab === 'my') {
        return {
            rows: [...rows],
            builtins: [],
            empty: 'No templates of your own yet — set up the chart and save its indicators.',
        };
    }
    const wanted = tab === 'technical' ? 'Technical' : 'Financial';
    return {
        rows: [],
        builtins: builtins.filter((b) => builtinTemplateCategory(b) === wanted),
        empty: tab === 'technical'
            ? 'No technical templates available.'
            : 'No financial templates available yet.',
    };
}

/** Add/remove a favorite key without duplicates. */
export function withFavorite(list: readonly string[], key: string, on: boolean): string[] {
    const next = list.filter((x) => x !== key);
    if (on) next.push(key);
    return next;
}
