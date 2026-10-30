import type { VelaTheme, ThemeName } from './options';
import { BEARISH, BULLISH } from './palette';

// The reference dark palette (the design spec's first-run chart cosmetics: surface,
// axis text, subtle grid, candle green/red).
export const DARK_THEME: VelaTheme = {
    background: '#151619',
    textColor: '#b2b5be',
    gridColor: '#20222c',
    borderColor: '#2a2b30',
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

export const LIGHT_THEME: VelaTheme = {
    background: '#ffffff',
    textColor: '#1e293b',
    // Soft chrome on white: grid is a neutral wash; pane separator / axis border
    // (they inherit `borderColor`) sit a step darker so stacked panes stay distinct.
    gridColor: '#cccccc',
    borderColor: '#d4dae3',
    // Candle hues are shared across themes: switching themes recolors surfaces and
    // text, never the series (a green candle stays the same green on white).
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

/** Monaco's fixed editor-widget contrast colors; the actual editor background still
 *  follows the active panel surface passed by the host. */
export const CODE_EDITOR_DARK = {
    background: '#131722',
    foreground: '#D1D4DC',
    lineNumber: '#858B99',
    activeLineNumber: '#E2E5EB',
    selection: '#264F78',
    inactiveSelection: '#31465A',
    lineHighlight: '#ffffff0a',
    widgetBackground: '#20242D',
    widgetForeground: '#E1E4EB',
    widgetSelected: '#29415F',
    widgetBorder: '#525968',
    focusBorder: '#38C0FD',
} as const;

export const CODE_EDITOR_LIGHT = {
    background: '#ffffff',
    foreground: '#25282E',
    lineNumber: '#707782',
    activeLineNumber: '#343943',
    selection: '#BBD8FF',
    inactiveSelection: '#D6E5F8',
    lineHighlight: '#00000008',
    widgetBackground: '#FFFFFF',
    widgetForeground: '#25282E',
    widgetSelected: '#DCEAFF',
    widgetBorder: '#C4C9D0',
    focusBorder: '#1748BA',
} as const;

export function resolveTheme(theme?: ThemeName | VelaTheme): VelaTheme {
    if (!theme || theme === 'dark') return DARK_THEME;
    if (theme === 'light') return LIGHT_THEME;
    return theme;
}
