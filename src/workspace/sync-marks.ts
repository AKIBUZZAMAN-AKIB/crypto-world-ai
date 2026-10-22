// The chart-syncing PALETTE — the marks a chart can wear, and the color each one paints
// with. Split from `sync.ts` (the propagation rules) so a widget can colour a chip
// without pulling the renderer-facing half of the sync model into its graph.
/**
 * The group MARKS, in the order the chip cycles them — TradingView's chart-syncing
 * palette: pick an emoji, every chart wearing it moves together. TV documents the
 * MECHANISM ("pick one of the emojis in the list", support 43000629992) but not the
 * list itself, so the size here is ours: TEN distinct marks, one per chart of the
 * biggest layout we support (8) plus headroom, because four colors ran out at the
 * fifth chart — two charts ended up in the same group by accident.
 *
 * A group id is just a string, so these read as "the red link" in the picker, in the
 * status line, and in the shared state document alike — a host that wants its own
 * marks can `setGroup` any other string and everything still works.
 */
export const SYNC_GROUP_MARKS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🔶'] as const;

/**
 * The COLOR each mark paints with — the same hue as the emoji, so a matrix cell says
 * "red group" before the emoji font has even loaded (and stays readable where a color
 * emoji font is missing, which turns every glyph into the same tofu box). PURE.
 */
const GROUP_MARK_COLORS: Readonly<Record<string, string>> = {
    '🔴': 'hsl(2 78% 58%)',
    '🟠': 'hsl(28 90% 56%)',
    '🟡': 'hsl(48 92% 52%)',
    '🟢': 'hsl(142 62% 46%)',
    '🔵': 'hsl(210 85% 58%)',
    '🟣': 'hsl(280 68% 62%)',
    '🟤': 'hsl(26 45% 48%)',
    '⚫': 'hsl(220 8% 30%)',
    '⚪': 'hsl(210 12% 86%)',
    '🔶': 'hsl(34 92% 56%)',
};

/** The CSS color for a group mark (undefined = let the caller fall back to the accent). */
export function groupMarkColor(mark: string | undefined): string | undefined {
    return mark ? GROUP_MARK_COLORS[mark] : undefined;
}

