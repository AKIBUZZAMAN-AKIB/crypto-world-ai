// Built-in chart types registered through the SAME public registry a plugin would use.
// (Volume/VPVR go through the native indicator registry instead: they are layers over any
// style, not styles themselves.)
//
// Two seams are represented here:
//   * `barTransform` — 1:1, time-preserving (Heikin Ashi): N raw bars in, N view bars out.
//   * `rebucket`     — bar-count-changing (Renko, Range, Line break): the style re-cuts the
//                      series into its own bars and stamps them with synthetic times.
import { registerChartType } from './registry';
import { heikinAshiFull, heikinAshiNext } from '../core/price-styles/heikin-ashi';
import type { BarTransform } from '../core/price-styles/BarTransform';
import { lineBreak, rangeBars, renko, kagi, pointFigure, lineBreakOptionsFrom, rangeOptionsFrom, renkoOptionsFrom, kagiOptionsFrom, pointFigureOptionsFrom } from '../core/price-styles/rebucket';

/** Singleton so the orchestrator can compare transforms by identity across style flips. */
const HEIKIN_ASHI: BarTransform = { full: heikinAshiFull, next: heikinAshiNext };

/** Singleton rebucket entries — same identity reason: a style flip is a cheap comparison. */
const RENKO = { full: (raw: Parameters<typeof renko>[0], s?: Readonly<Record<string, unknown>>) => renko(raw, renkoOptionsFrom(s)) };
const RANGE = { full: (raw: Parameters<typeof rangeBars>[0], s?: Readonly<Record<string, unknown>>) => rangeBars(raw, rangeOptionsFrom(s)) };
const LINE_BREAK = { full: (raw: Parameters<typeof lineBreak>[0], s?: Readonly<Record<string, unknown>>) => lineBreak(raw, lineBreakOptionsFrom(s)) };
const KAGI = { full: (raw: Parameters<typeof kagi>[0], s?: Readonly<Record<string, unknown>>) => kagi(raw, kagiOptionsFrom(s)) };
const PNF = { full: (raw: Parameters<typeof pointFigure>[0], s?: Readonly<Record<string, unknown>>) => pointFigure(raw, pointFigureOptionsFrom(s)) };

// Picker glyphs. 24×24, 1.5px strokes, no fills — the same weight as the built-in style
// icons, so a row of them reads as one set rather than "the new ones".
const ICON_RENKO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.5" y="13.5" width="6" height="6"/><rect x="10.5" y="7.5" width="6" height="6"/><rect x="16.5" y="2" width="4" height="4"/></svg>';
const ICON_RANGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="12" width="4" height="8"/><rect x="10" y="9" width="4" height="8"/><rect x="16" y="5" width="4" height="8"/></svg>';
const ICON_LINE_BREAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 17v-4M10 15V9M16 11V4M4 15h6M10 11h6"/></svg>';
const ICON_KAGI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 19V9M11 9V4M17 4v9" stroke-width="2.5"/><path d="M5 9h6M11 4h6M17 13h2"/></svg>';
const ICON_PNF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 19l4-4M9 19l-4-4M5 13l4-4M9 13l-4-4"/><circle cx="16" cy="9" r="2.2"/><circle cx="16" cy="16" r="2.2"/></svg>';

/** Register the built-in chart types (idempotent — called by the Vela constructor). */
export function registerBuiltinChartTypes(): void {
    registerChartType({ id: 'heikinashi', label: 'Heikin Ashi', barTransform: HEIKIN_ASHI });

    // ── Renko ── the reference's three sizing methods and its wick rule, exposed as the
    //            four settings that actually change the picture.
    registerChartType({
        id: 'renko',
        label: 'Renko',
        icon: ICON_RENKO,
        rebucket: RENKO,
        settings: {
            title: 'Renko',
            placement: 'after-symbol',
            rows: [
                { kind: 'heading', label: 'Bricks' },
                {
                    kind: 'select',
                    key: 'boxMethod',
                    label: 'Box size method',
                    options: [
                        ['atr', 'ATR'],
                        ['traditional', 'Traditional'],
                    ] as const,
                    defval: 'atr',
                },
                { kind: 'number', key: 'boxSize', label: 'Box size', defval: 0, min: 0, step: 0.01, when: { key: 'boxMethod', equals: 'traditional' } },
                { kind: 'number', key: 'atrLength', label: 'ATR length', defval: 14, min: 1, max: 500, step: 1, when: { key: 'boxMethod', equals: 'atr' } },
                { kind: 'number', key: 'atrFactor', label: 'ATR multiplier', defval: 1, min: 0.1, max: 10, step: 0.1, when: { key: 'boxMethod', equals: 'atr' } },
                { kind: 'heading', label: 'Source' },
                {
                    kind: 'select',
                    key: 'source',
                    label: 'Use values of',
                    options: [
                        ['close', 'Close'],
                        ['ohlc', 'OHLC'],
                    ] as const,
                    defval: 'close',
                },
                { kind: 'toggle', key: 'wicks', label: 'Show wicks', defval: true },
            ],
        },
    });

    // ── Range bars ── equal-height bars, no time axis worth reading.
    registerChartType({
        id: 'rangebars',
        label: 'Range',
        icon: ICON_RANGE,
        rebucket: RANGE,
        settings: {
            title: 'Range bars',
            placement: 'after-symbol',
            rows: [
                {
                    kind: 'select',
                    key: 'method',
                    label: 'Range method',
                    options: [
                        ['atr', 'ATR'],
                        ['traditional', 'Traditional'],
                    ] as const,
                    defval: 'atr',
                },
                { kind: 'number', key: 'range', label: 'Range', defval: 0, min: 0, step: 0.01, when: { key: 'method', equals: 'traditional' } },
                { kind: 'number', key: 'atrLength', label: 'ATR length', defval: 14, min: 1, max: 500, step: 1, when: { key: 'method', equals: 'atr' } },
                { kind: 'number', key: 'atrFactor', label: 'ATR multiplier', defval: 1, min: 0.1, max: 10, step: 0.1, when: { key: 'method', equals: 'atr' } },
                {
                    kind: 'select',
                    key: 'source',
                    label: 'Use values of',
                    options: [
                        ['close', 'Close'],
                        ['ohlc', 'OHLC'],
                    ] as const,
                    defval: 'close',
                },
            ],
        },
    });

    // ── Kagi ── one continuous line; thickness IS the signal (yang breaks an extreme).
    registerChartType({
        id: 'kagi',
        label: 'Kagi',
        icon: ICON_KAGI,
        rebucket: KAGI,
        settings: {
            title: 'Kagi',
            placement: 'after-symbol',
            rows: [
                {
                    kind: 'select',
                    key: 'method',
                    label: 'Reversal method',
                    options: [
                        ['traditional', 'Traditional'],
                        ['atr', 'ATR'],
                    ] as const,
                    defval: 'atr',
                },
                { kind: 'number', key: 'reversalPct', label: 'Reversal %', defval: 4, min: 0.01, max: 100, step: 0.1, when: { key: 'method', equals: 'traditional' } },
                { kind: 'number', key: 'atrLength', label: 'ATR length', defval: 14, min: 1, max: 500, step: 1, when: { key: 'method', equals: 'atr' } },
                { kind: 'number', key: 'atrFactor', label: 'ATR multiplier', defval: 1, min: 0.1, max: 10, step: 0.1, when: { key: 'method', equals: 'atr' } },
                {
                    kind: 'select',
                    key: 'source',
                    label: 'Use values of',
                    options: [
                        ['close', 'Close'],
                        ['ohlc', 'OHLC'],
                    ] as const,
                    defval: 'close',
                },
            ],
        },
    });

    // ── Point & figure ── columns of X/O; a column reverses only after N boxes.
    registerChartType({
        id: 'pnf',
        label: 'Point & figure',
        icon: ICON_PNF,
        rebucket: PNF,
        settings: {
            title: 'Point & figure',
            placement: 'after-symbol',
            rows: [
                {
                    kind: 'select',
                    key: 'boxMethod',
                    label: 'Box size method',
                    options: [
                        ['atr', 'ATR'],
                        ['traditional', 'Traditional'],
                    ] as const,
                    defval: 'atr',
                },
                { kind: 'number', key: 'boxSize', label: 'Box size', defval: 0, min: 0, step: 0.01, when: { key: 'boxMethod', equals: 'traditional' } },
                { kind: 'number', key: 'atrLength', label: 'ATR length', defval: 14, min: 1, max: 500, step: 1, when: { key: 'boxMethod', equals: 'atr' } },
                { kind: 'number', key: 'atrFactor', label: 'ATR multiplier', defval: 1, min: 0.1, max: 10, step: 0.1, when: { key: 'boxMethod', equals: 'atr' } },
                { kind: 'number', key: 'reversal', label: 'Reversal (boxes)', defval: 3, min: 1, max: 20, step: 1 },
                {
                    kind: 'select',
                    key: 'source',
                    label: 'Use values of',
                    options: [
                        ['close', 'Close'],
                        ['ohlc', 'OHLC'],
                    ] as const,
                    defval: 'close',
                },
            ],
        },
    });

    // ── Line break ── prints only when the close breaks the last N lines.
    registerChartType({
        id: 'linebreak',
        label: 'Line break',
        icon: ICON_LINE_BREAK,
        rebucket: LINE_BREAK,
        settings: {
            title: 'Line break',
            placement: 'after-symbol',
            rows: [{ kind: 'number', key: 'lines', label: 'Line count', defval: 3, min: 1, max: 10, step: 1 }],
        },
    });
}
