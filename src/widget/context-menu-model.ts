// Chart context-menu MODEL — the item descriptors for each right-click zone, how
// contributed rows sort in among them, and the renderer writes a selection implies.
// Pure functions over plain state, so the menus can be tested without a DOM;
// `ChartContextMenu` reads the renderer, calls these and shows the result.
import type { MenuItemDescriptor } from '../ui/components/menu';
import { timezoneMenuRows } from './timezones';

/** Zone a right-click landed in — the chart body, the right price scale, the bottom time axis. */
export type Zone = 'body' | 'price-axis' | 'time-axis';

/** One pane's scale state, as reported by the renderer's `paneScales` feature. */
export interface PaneScaleInfo {
    id: string;
    kind: 'price' | 'study';
    /** The pane's pixel band inside the plot, so a click y maps to a pane. */
    top: number;
    height: number;
    mode: string;
    log: boolean;
    invert: boolean;
}

/** The settings-dialog tab each zone's settings item opens — the one holding the settings
 *  that zone is about, so the menu lands where the eye already is. */
export const SETTINGS_SECTION: Record<Zone, string> = {
    body: 'Canvas',
    'price-axis': 'Scales and lines',
    'time-axis': 'Scales and lines',
};

/** Menu id for the settings item of a zone, carrying the tab to open. */
function settingsItem(zone: Zone, label: string, icon?: string): MenuItemDescriptor {
    return { id: `settings:${SETTINGS_SECTION[zone]}`, label, ...(icon ? { icon } : {}), separatorBefore: true };
}

/** The section a `settings:*` item asks for, or undefined for a bare `settings` id. */
export function settingsSectionOf(id: string): string | undefined {
    return id.slice('settings:'.length) || undefined;
}

/** The four mutually exclusive price-scale choices (log is part of the same group). */
export type ScaleChoice = 'regular' | 'percent' | 'indexed' | 'log';

const SCALE_CHOICES: ReadonlyArray<readonly [ScaleChoice, string]> = [
    ['regular', 'Regular'],
    ['percent', 'Percent'],
    ['indexed', 'Indexed to 100'],
    ['log', 'Logarithmic'],
];

/** Which pane's scale a right-click at plot-local `y` targets, or null without per-pane scales. */
export function paneScaleAt(panes: readonly PaneScaleInfo[], y: number): PaneScaleInfo | null {
    return panes.find((p) => y >= p.top && y < p.top + p.height) ?? panes[0] ?? null;
}

/** A pane's active choice. Log wins over the mode: the two live in one exclusive group. */
export function scaleChoiceOf(scale: { mode?: string; log?: boolean }): ScaleChoice {
    if (scale.log) return 'log';
    if (scale.mode === 'percent') return 'percent';
    if (scale.mode === 'indexed') return 'indexed';
    return 'regular';
}

/** The main (price-pane) scale is the chart-level setting keyboard shortcuts and the
 *  persisted config also drive; a study pane carries its own, so panes stay independent. */
function mainScale(pane: PaneScaleInfo | null): boolean {
    return pane === null || pane.kind === 'price';
}

/** Renderer writes that selecting a scale choice implies — picking one clears the others. */
export function scaleWrites(choice: ScaleChoice, pane: PaneScaleInfo | null): Array<[string, unknown]> {
    const mode = choice === 'percent' ? 'percent' : choice === 'indexed' ? 'indexed' : 'price';
    const log = choice === 'log';
    if (mainScale(pane)) {
        return [
            ['scaleMode', mode],
            ['logScale', log],
        ];
    }
    return [
        ['scaleMode', { pane: pane!.id, mode }],
        ['logScale', { pane: pane!.id, value: log }],
    ];
}

/** Renderer write inverting one pane's axis (high at the bottom). */
export function invertWrite(next: boolean, pane: PaneScaleInfo | null): [string, unknown] {
    return mainScale(pane) ? ['invertScale', next] : ['invertScale', { pane: pane!.id, value: next }];
}

export interface PriceAxisState {
    /** Autoscale on — the axis fits the visible data instead of a frozen window. */
    auto: boolean;
    invert: boolean;
    choice: ScaleChoice;
    axisLabels: boolean;
    priceLabel: boolean;
    countdown: boolean;
    priceLine: boolean;
}

export function priceAxisItems(s: PriceAxisState): MenuItemDescriptor[] {
    return [
        { id: 'auto', label: 'Auto (fits data to screen)', checked: s.auto },
        { id: 'invert', label: 'Invert scale', checked: s.invert },
        ...SCALE_CHOICES.map(([choice, label], i) => ({
            id: `scale:${choice}`,
            label,
            checked: s.choice === choice,
            separatorBefore: i === 0,
        })),
        {
            id: 'labels',
            label: 'Labels',
            separatorBefore: true,
            submenu: [
                { id: 'toggle:axisLabels', label: 'Price axis labels', checked: s.axisLabels },
                { id: 'toggle:priceLabel', label: 'Last price label', checked: s.priceLabel },
                { id: 'toggle:countdown', label: 'Countdown to bar close', checked: s.countdown },
            ],
        },
        {
            id: 'levels',
            label: 'Levels',
            submenu: [{ id: 'toggle:currentPriceLine', label: 'Last Price Line', checked: s.priceLine }],
        },
        settingsItem('price-axis', 'More settings…'),
    ];
}

/** `timezone` is the host's STORED choice — an IANA zone, or the exchange rule. */
export function timeAxisItems(timezone: string, scope?: { scope: 'cell' | 'all'; scoped: boolean }): MenuItemDescriptor[] {
    const rows: MenuItemDescriptor[] = [];
    // TradingView's model: the zone belongs to the CHART. The scope row makes the
    // workspace-wide write an explicit choice instead of the only behaviour.
    if (scope?.scoped) {
        rows.push(
            { id: 'tzscope:cell', label: 'This chart only', checked: scope.scope === 'cell' },
            { id: 'tzscope:all', label: 'All charts', checked: scope.scope === 'all' },
        );
    }
    rows.push(...timezoneMenuRows(timezone).map((r) => ({ id: `tz:${r.value}`, label: r.label, checked: r.checked, separatorBefore: rows.length === 0 && r === timezoneMenuRows(timezone)[0] })));
    return [
        { id: 'timezone', label: 'Time zone', submenu: rows },
        settingsItem('time-axis', 'More settings…'),
    ];
}

/** Chart-body items. The two removals stay VISIBLE with nothing to remove — disabled, so
 *  the menu keeps its shape. */
export function bodyItems(counts: { drawings: number; indicators: number; multi?: boolean; syncing?: boolean }): MenuItemDescriptor[] {
    return [
        { id: 'reset-view', label: 'Reset chart view', icon: 'reset' },
        // TradingView's other door into chart syncing: Series context menu → Chart
        // Syncing. The status-line badge opens the same surface.
        ...(counts.syncing ? [{ id: 'chart-syncing', label: 'Chart syncing…', icon: 'layout' } as MenuItemDescriptor] : []),
        // TradingView's "Apply to all": one press carries THIS chart's settings (the
        // whole style slice) onto every other chart in the layout.
        ...(counts.multi ? [{ id: 'apply-settings-all', label: 'Apply settings to all charts', icon: 'layout' } as MenuItemDescriptor] : []),
        { id: 'remove-drawings', label: 'Remove drawings', icon: 'eraser', disabled: counts.drawings === 0, separatorBefore: true },
        { id: 'remove-indicators', label: 'Remove indicators', icon: 'indicators', disabled: counts.indicators === 0 },
        settingsItem('body', 'Settings…', 'gear'),
    ];
}

/**
 * The rank of every built-in context-menu row, by zone and row id (`settings` is each
 * zone's settings row). Contributed `context:*` actions sort TOGETHER with these rows by
 * their `order` (default 0), ascending; on a tie the built-in row comes first, then the
 * actions in registration order. The built-in actions rank below 0 and the settings row at
 * 1000, so an action without `order` lands after the built-in actions and before the
 * settings row, and `order: -100` leads the menu.
 */
export const CONTEXT_MENU_BUILTIN_ORDER = {
    // `apply-settings-all` carries no rank on purpose: the row only exists on a
    // multi-chart grid, so it takes the default 0 and lands with the other actions.
    body: { 'reset-view': -30, 'chart-syncing': -25, 'remove-drawings': -20, 'remove-indicators': -10, settings: 1000 },
    'price-axis': {
        auto: -80,
        invert: -70,
        'scale:regular': -60,
        'scale:percent': -50,
        'scale:indexed': -40,
        'scale:log': -30,
        labels: -20,
        levels: -10,
        settings: 1000,
    },
    'time-axis': { timezone: -10, settings: 1000 },
} as const satisfies Record<Zone, Record<string, number>>;

/** A contributed row on its way into a context menu, with the action's `order`. */
export interface ContributedRow {
    item: MenuItemDescriptor;
    order?: number;
}

/**
 * One zone's menu: the built-in rows and the contributed ones interleaved by rank (see
 * {@link CONTEXT_MENU_BUILTIN_ORDER}). Separators fall between groups only, never at the
 * ends: each built-in group is a run the builder already separates, and consecutive
 * contributed rows form one group. `contributed` arrives in registration order within
 * equal `order`s (what `widgetActions` returns) and keeps it.
 */
export function composeMenu(zone: Zone, builtin: readonly MenuItemDescriptor[], contributed: readonly ContributedRow[]): MenuItemDescriptor[] {
    const ranks: Readonly<Record<string, number>> = CONTEXT_MENU_BUILTIN_ORDER[zone];
    const rows: Array<{ item: MenuItemDescriptor; rank: number; group: number }> = [];
    let group = 0;
    for (const item of builtin) {
        if (item.separatorBefore) group += 1;
        rows.push({ item, rank: ranks[item.id.startsWith('settings') ? 'settings' : item.id] ?? 0, group });
    }
    for (const { item, order } of contributed) rows.push({ item, rank: order ?? 0, group: -1 });
    rows.sort((a, b) => a.rank - b.rank);
    return rows.map(({ item, group: g }, i) => ({ ...item, separatorBefore: i > 0 && rows[i - 1]!.group !== g }));
}
