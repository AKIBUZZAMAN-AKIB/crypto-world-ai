/**
 * Cursor types — what the pointer DOES over the plot, and what it draws while doing it.
 *
 * This is the `Cursors` stop of the drawing toolbar, the way TradingView presents it:
 * the same seven choices for everyone (cross, dot, arrow, demonstration, magic, eraser,
 * none), one at a time, and they are a VIEW preference — never part of a saved layout's
 * market data, never a drawing.
 *
 * The reference platform's list is Cross / Dot / Arrow / Demonstration / Magic / Eraser;
 * Vela adds **None** (no crosshair, no axis chips) because a phone owner taking a clean
 * screenshot, or reading a chart through a finger, asks for exactly that and there is no
 * other door to it.
 *
 * Behavior contract (rendered by the native renderer's crosshair layer):
 *  - `cross`  — the classic crosshair, axis chips included.
 *  - `dot`    — the same lines plus a filled dot at the intersection, no OS cursor.
 *  - `arrow`  — an ordinary arrow pointer; NO crosshair lines (the reference's rule).
 *  - `demo`   — press-and-hold paints translucent ink that fades after a few seconds.
 *  - `magic`  — a sparkle trail follows the pointer and fades.
 *  - `eraser` — a ring cursor; a click or drag deletes the drawing under it.
 *  - `none`   — nothing drawn at all (a clean chart to screenshot or present).
 * Phone long-press inspection temporarily displays the configured crosshair even for
 * non-line choices when no drawing tool owns the gesture, without changing the selected
 * cursor or its normal hover behavior.
 */
import { registerIcon, svg24, svg24Solid } from './icons';

/** The seven cursor types, in toolbar order. */
export type CursorStyle = 'cross' | 'dot' | 'arrow' | 'demo' | 'magic' | 'eraser' | 'none';

export interface CursorSpec {
    id: CursorStyle;
    /** The row label, sentence case like the rest of the chrome. */
    label: string;
    /** One line under the label — what changes about the pointer, in plain words. */
    hint: string;
    /** Icon id in the core registry. */
    icon: string;
    /** true = the crosshair lines are painted (and the axis chips with them). */
    lines: boolean;
}

export const CURSOR_STYLES: readonly CursorStyle[] = ['cross', 'dot', 'arrow', 'demo', 'magic', 'eraser', 'none'];

export const CURSOR_SPECS: readonly CursorSpec[] = [
    { id: 'cross', label: 'Cross', hint: 'Price and time labels', icon: 'cursor-cross', lines: true },
    { id: 'dot', label: 'Dot', hint: 'Crosshair with a centre dot', icon: 'cursor-dot', lines: true },
    { id: 'arrow', label: 'Arrow', hint: 'Plain arrow, no crosshair', icon: 'cursor-arrow', lines: false },
    { id: 'demo', label: 'Demonstration', hint: 'Hold to draw fading ink', icon: 'cursor-demo', lines: false },
    { id: 'magic', label: 'Magic', hint: 'Sparks trail the pointer', icon: 'cursor-magic', lines: false },
    { id: 'eraser', label: 'Eraser', hint: 'Tap a drawing to delete it', icon: 'cursor-eraser', lines: false },
    { id: 'none', label: 'None', hint: 'Clean chart, no crosshair', icon: 'cursor-none', lines: false },
];

/** The spec for a (possibly untrusted) value, falling back to the default cross. */
export function cursorSpec(style: CursorStyle): CursorSpec {
    return CURSOR_SPECS.find((s) => s.id === style) ?? CURSOR_SPECS[0]!;
}

/** Narrow an untrusted value (persisted state, a script call) to a {@link CursorStyle}. */
export function normalizeCursorStyle(value: unknown): CursorStyle {
    return typeof value === 'string' && (CURSOR_STYLES as readonly string[]).includes(value) ? (value as CursorStyle) : 'cross';
}

// ── glyphs ────────────────────────────────────────────────────────────────────────
// One 24×24 family: a faint "chart" plate (so the glyph reads at 18 px in a row), and the
// pointer drawn on top of it in the accent — the same picture the cursors menu shows.

// Each glyph is the POINTER itself, not a framed icon: at 17 px in a list the silhouette
// has to say "crosshair" / "arrow" / "eraser" instantly. (A faint plate behind each one
// turned the set into seven identical little cards — tried, and it read as clip-art.)

registerIcon('cursor-cross', svg24('<path d="M12 2.8v5.4M12 15.8v5.4M2.8 12h5.4M15.8 12h5.4"/><circle cx="12" cy="12" r="2.1"/>'));
registerIcon('cursor-dot', svg24('<path d="M12 2.8v5.6M12 15.6v5.6M2.8 12h5.6M15.6 12h5.6" opacity="0.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>'));
registerIcon('cursor-arrow', svg24('<path d="m6.5 3.4 12.2 8.1-5.4 1.2 2.6 5.6-2.7 1.3-2.7-5.7-4 3.5z" fill="currentColor" fill-opacity="0.16"/>'));
registerIcon('cursor-demo', svg24('<path d="M3.2 17.4c3-6.4 6-6.4 9 0s6 6.4 9 0" opacity="0.85"/><circle cx="3.4" cy="17.2" r="1.5" fill="currentColor" stroke="none"/>'));
registerIcon('cursor-magic', svg24('<path d="M4.2 19.8 15.4 8.6"/><path d="m16.9 3.2.9 2.1 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="currentColor" stroke="none"/><circle cx="4.6" cy="9.4" r="1" fill="currentColor" stroke="none"/><circle cx="9.2" cy="4.8" r="0.8" fill="currentColor" stroke="none"/>'));
registerIcon('cursor-eraser', svg24('<path d="m9.8 18.8-4.6-4.6a1.6 1.6 0 0 1 0-2.3l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.6 3.6a1.6 1.6 0 0 1 0 2.3l-8.2 8.2z"/><path d="M10.2 6.4 17 13.2M10.6 19h9.4"/>'));
registerIcon('cursor-none', svg24('<path d="M12 2.8v5.4M12 15.8v5.4M2.8 12h5.4M15.8 12h5.4" opacity="0.45"/><path d="m4.4 4.4 15.2 15.2" stroke-width="2"/>'));
// A solid selection dot for the More drawer's cursor rows (a radio, not a checkbox).
registerIcon('cursor-check', svg24Solid('<circle cx="12" cy="12" r="5"/>'));
