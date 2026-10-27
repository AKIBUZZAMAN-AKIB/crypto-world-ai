// Status line MODEL — the segment visibility the parts config implies, plus the item
// descriptors for the status line's right-click menu. Pure functions over plain state,
// so both can be tested without a DOM; `Statusline` projects them onto its elements.
import type { MenuItemDescriptor } from '../ui/components/menu';

/** The status line's toggleable segments — the settings dialog's Status line tab and
 *  the status line's own right-click menu drive these. */
export type StatuslinePart = 'logo' | 'name' | 'market' | 'ohlc' | 'change';

/** Per-segment visibility the parts config implies. The venue/timeframe meta carries no
 *  part of its own: it reads as an extension of the symbol name ("BTCUSDT · BINANCE ·
 *  1h" is one identity readout), so it follows 'name'. A hidden chart (the price series
 *  eye) drops the whole value readout — OHLC and bar change, values of a series that
 *  isn't painted — without touching the parts themselves, so showing the chart brings
 *  them straight back; the eye affordance that re-shows the chart is out only then. */
export function segmentVisibility(parts: Record<StatuslinePart, boolean>, chartHidden = false): { avatar: boolean; symbol: boolean; meta: boolean; market: boolean; ohlc: boolean; change: boolean; eye: boolean } {
    return { avatar: parts.logo, symbol: parts.name, meta: parts.name, market: parts.market, ohlc: parts.ohlc && !chartHidden, change: parts.change && !chartHidden, eye: chartHidden };
}

/** How much of the value readout a width step keeps: every value the price style reads
 *  out ('full'), just the close and the bar change ('compact'), or the close and the
 *  percent delta alone ('minimal'). */
export type StatuslineLevel = 'full' | 'compact' | 'minimal';

/** How much of the bar delta a rung prints: the absolute change and the percent
 *  ('+84.74 (+0.11%)'), or the percent alone ('(+0.11%)') — the figure the phone
 *  layouts read out, where the absolute figure is the wider of the two and says the
 *  least (the price is already on screen). */
export type StatuslineChangeFormat = 'both' | 'pct';

/** Which row the bar delta rides on. 'values' keeps it after the O/H/L/C cells, as on
 *  TradingView's desktop legend; 'identity' moves it to the end of the symbol line, so
 *  a phone keeps all four values AND the delta instead of trading the values away —
 *  measured, never assumed: the ladder only picks it when the symbol line still fits
 *  whole (see `Statusline.fit`'s truncation guard). */
export type StatuslineChangeSlot = 'values' | 'identity';

/** One rung of the width ladder: whether the value readout sits on its own row under
 *  the symbol line, how much of it is kept, and where the bar delta rides. */
export interface StatuslineLayout {
    stacked: boolean;
    level: StatuslineLevel;
    change: StatuslineChangeFormat;
    changeSlot: StatuslineChangeSlot;
}

/** The width ladder the status line walks down until its row fits, widest first.
 *
 *  The values first move under the symbol line; then only the DELTA gives ground —
 *  first its absolute half (§ the phone readout keeps the percent, as TradingView's
 *  does), then the whole delta, which rides up onto the symbol line so the four
 *  O/H/L/C values keep a row of their own. O/H/L only ever leave once the close alone
 *  is what fits, and the last rung drops the label too. A phone at 360 CSS px lands on
 *  the "values stacked, percent on the symbol line" rung, which fits its ~270 px of
 *  plot and reads out O/H/L/C; before this rung existed every phone skipped straight
 *  from "four values + delta" (≈350 px) to "close + delta" and lost O/H/L on the way.
 *
 *  Every status line — single chart, phone, multi-chart cell — walks the same rungs; in
 *  fit mode whatever still overflows after the last one is hidden segment by segment
 *  (see `Statusline.fit`). */
export const STATUSLINE_LADDER: readonly StatuslineLayout[] = [
    { stacked: false, level: 'full', change: 'both', changeSlot: 'values' },
    { stacked: true, level: 'full', change: 'both', changeSlot: 'values' },
    { stacked: true, level: 'full', change: 'pct', changeSlot: 'values' },
    { stacked: true, level: 'full', change: 'both', changeSlot: 'identity' },
    { stacked: true, level: 'full', change: 'pct', changeSlot: 'identity' },
    { stacked: true, level: 'compact', change: 'both', changeSlot: 'values' },
    { stacked: true, level: 'minimal', change: 'pct', changeSlot: 'values' },
];

/** Which of the O/H/L/C cells a level keeps, given the price style's readout shape.
 *  One-line styles ('value') only ever plot the close, so their readout is the single
 *  unlabeled value at every level; bar-shaped styles drop O/H/L below 'full' and keep
 *  the labeled close, whose 'C' the 'minimal' level drops too. */
export function readoutCells(level: StatuslineLevel, readout: 'ohlc' | 'value'): ReadonlyArray<{ key: 'open' | 'high' | 'low' | 'close'; label: string }> {
    if (readout === 'value') return [{ key: 'close', label: '' }];
    if (level === 'full') {
        return [
            { key: 'open', label: 'O' },
            { key: 'high', label: 'H' },
            { key: 'low', label: 'L' },
            { key: 'close', label: 'C' },
        ];
    }
    return [{ key: 'close', label: level === 'compact' ? 'C' : '' }];
}

/** Right-click menu rows: one checkable toggle per part (same labels as the settings
 *  dialog's Status line tab), then the chart itself — the same hide/show of the price
 *  series the object tree's eye drives. */
export function statuslineMenuItems(parts: Record<StatuslinePart, boolean>, chartVisible: boolean): MenuItemDescriptor[] {
    return [
        { id: 'part:logo', label: 'Symbol logo', checked: parts.logo },
        { id: 'part:name', label: 'Symbol name', checked: parts.name },
        { id: 'part:market', label: 'Market status', checked: parts.market },
        { id: 'part:ohlc', label: 'OHLC values', checked: parts.ohlc },
        { id: 'part:change', label: 'Bar change values', checked: parts.change },
        { id: 'chart', label: chartVisible ? 'Hide chart' : 'Show chart', separatorBefore: true },
    ];
}
