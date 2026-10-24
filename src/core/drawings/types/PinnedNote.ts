import type { SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { FILL_FIELDS, LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { PinnedLabel } from './PinnedLabel';

/** Default resting place, as fractions of the pane: upper-left, clear of the last price. */
const DEFAULT_AT = { x: 0.04, y: 0.06 };

/**
 * A note that stays put on the SCREEN instead of travelling with the bars: its position is a
 * fraction of the pane (0..1 on each axis), so panning, zooming and scrolling leave it exactly
 * where the user parked it — the reference's "anchored note" idea, for a thought that belongs
 * to the chart as a whole rather than to one candle.
 *
 * Everything else is the ordinary note's: the same plate, the same text block, the same
 * settings. It is drawn inside the pane it was dropped on, and it never contributes to the
 * price scale (a pinned annotation must not move the candles).
 */
export class PinnedNote extends PinnedLabel {
    readonly type = 'pinnednote' as const;

    /** @see DEFAULT_AT */
    at!: { x: number; y: number };

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.text) this.text = { value: 'Note', size: 'normal', hAlign: 'left', vAlign: 'top' };
        if (!this.at) this.at = { ...DEFAULT_AT };
    }

    protected override defaultLabel(): string {
        return 'Note';
    }

    /** Fractions of the pane, clamped so the plate can never be parked off-screen. */
    position(): { x: number; y: number } {
        const at = this.at ?? DEFAULT_AT;
        return { x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) };
    }

    /** Move the note to a fraction of the pane (what a drag on its plate does). */
    moveTo(x: number, y: number): void {
        this.at = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }

    /** The pixel point the plate hangs from — resolved against the LIVE pane, so a resize or a
     *  pane split keeps the note where the user put it (proportionally). */
    override handlePoints(proj: Projector): Array<[number, number]> {
        const rect = proj.paneRect?.(this.paneId) ?? null;
        const top = rect?.top ?? 0;
        const height = Math.max(1, rect?.height ?? proj.height);
        const width = Math.max(1, proj.width);
        const at = this.position();
        return [[at.x * width, top + at.y * height]];
    }

    /** A pinned note follows the SCREEN, so a whole-body drag must not carry it with the data;
     *  its own plate drag calls {@link moveTo} instead. */
    override translateBody(): typeof this.anchors {
        return this.anchors;
    }

    /** A freshly clicked note belongs where the click was: turn the placed anchor into the
     *  plate's fraction of the pane (the anchor itself is kept only so the drawing has a
     *  coordinate the core can drag/serialize). */
    override onPlaced(proj: Projector): void {
        const a = this.anchors[0];
        if (!a) return;
        const rect = proj.paneRect?.(this.paneId) ?? null;
        const top = rect?.top ?? 0;
        const height = Math.max(1, rect?.height ?? proj.height);
        const width = Math.max(1, proj.width);
        const y = proj.yOf(a.price, this.paneId);
        this.moveTo(proj.xOf(a.time) / width, ((y ?? top) - top) / height);
    }

    /** Never part of the price scale. */
    override priceRange(): { min: number; max: number } | null {
        return null;
    }

    override schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS], textIsContent: true };
    }

    protected override writeProps(): Record<string, unknown> {
        return { at: { ...this.position() } };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const raw = props.at as { x?: unknown; y?: unknown } | undefined;
        if (!raw || typeof raw !== 'object') return;
        const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : DEFAULT_AT.x;
        const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : DEFAULT_AT.y;
        this.at = { x, y };
    }
}
