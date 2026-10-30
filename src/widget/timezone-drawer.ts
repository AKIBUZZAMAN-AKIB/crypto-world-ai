// The phone's time-axis hold and More row share the desktop's timezone model. This is
// a small anchored menu rather than a second sheet; searchable zones remain available.
import { CompactChoiceMenu } from './compact-choice-menu';
import { timezoneMenuRows } from './timezones';

export interface TimezoneDrawerOptions {
    host: HTMLElement;
    timezone: () => string;
    onTimezone: (zone: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export class TimezoneDrawer {
    private readonly menu: CompactChoiceMenu;
    private point: HTMLElement | null = null;

    constructor(private readonly opts: TimezoneDrawerOptions) {
        this.menu = new CompactChoiceMenu({
            host: opts.host, label: 'Time zone', className: 'vela-tzd-menu', searchLabel: 'Search time zone',
            onSelect: (zone) => opts.onTimezone(zone),
            onOpenChange: (open) => {
                if (!open) { this.point?.remove(); this.point = null; }
                opts.onOpenChange?.(open);
            },
        });
    }

    open(anchor?: HTMLElement): void {
        if (!anchor) {
            const rect = this.opts.host.getBoundingClientRect();
            this.openAt(rect.right - 12, rect.bottom - 12);
            return;
        }
        this.menu.open(anchor, timezoneMenuRows(this.opts.timezone()).map((row) => ({
            id: row.value, label: row.label, checked: row.checked, searchText: row.value,
        })));
    }

    /** A time-axis hold has no DOM trigger, so anchor a 1px inert point to the gesture. */
    openAt(clientX: number, clientY: number): void {
        this.close();
        const doc = this.opts.host.ownerDocument;
        const host = this.opts.host.getBoundingClientRect();
        const point = doc.createElement('span');
        point.className = 'vela-tzd-anchor';
        point.setAttribute('aria-hidden', 'true');
        Object.assign(point.style, { position: 'absolute', left: `${clientX - host.left}px`, top: `${clientY - host.top}px`, width: '1px', height: '1px', pointerEvents: 'none' });
        this.opts.host.appendChild(point);
        this.point = point;
        this.open(point);
    }

    close(): void { this.menu.close(); }
    destroy(): void { this.menu.destroy(); this.point?.remove(); this.point = null; }
}
