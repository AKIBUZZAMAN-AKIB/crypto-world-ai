// Timezone drawer (mobile) — opened by a long-press on the time axis, or from the More
// drawer's Time zone row. Lists the same rows as the desktop bottom-bar picker (exchange
// rule + every IANA zone), with a search field: fifty-odd zones is a scroll on a phone,
// and a thumb can type "dha" faster than it can flick to (UTC+6) Dhaka.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { timezoneMenuRows } from './timezones';

const STYLE_ID = 'vela-widget-timezone-drawer';
const CSS = `
.vela-tzd-head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 2px 0 8px;
    background: var(--vela-surface);
}
.vela-tzd-search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid var(--vela-border);
    border-radius: 10px;
    background: var(--vela-surface-elev, var(--vela-hover));
    color: var(--vela-fg-muted);
}
.vela-tzd-search:focus-within { border-color: var(--vela-border-strong); }
.vela-tzd-search .vela-icon { flex: none; }
.vela-tzd-search input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--vela-fg-bright);
    font: inherit;
    /* 16px exactly: below that, iOS zooms the whole page on focus and leaves the sheet
       half off-screen. */
    font-size: 16px;
}
.vela-tzd-search input::placeholder { color: var(--vela-fg-muted); }
.vela-tzd-list { padding: 2px 0 4px; }
.vela-tzd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tzd-row[hidden] { display: none; }
.vela-tzd-row:active { background: var(--vela-hover); }
.vela-tzd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-tzd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
.vela-tzd-empty { padding: 14px 2px; font-size: 13.5px; color: var(--vela-fg-muted); }
.vela-tzd-empty[hidden] { display: none; }
`;

export interface TimezoneDrawerOptions {
    host: HTMLElement;
    /** The stored choice — a zone or the exchange rule. */
    timezone: () => string;
    onTimezone: (zone: string) => void;
    onOpenChange?: (open: boolean) => void;
}

/** Case- and accent-insensitive fold: "bogota" finds "Bogotá", "utc-4" finds "(UTC-4) …". */
function fold(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export class TimezoneDrawer {
    private readonly drawer: Drawer;

    constructor(private readonly opts: TimezoneDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, title: 'Time zone', onOpenChange: opts.onOpenChange });
    }

    open(): void {
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();

        const head = doc.createElement('div');
        head.className = 'vela-tzd-head';
        const search = doc.createElement('label');
        search.className = 'vela-tzd-search';
        search.appendChild(iconEl('search', doc));
        const input = doc.createElement('input');
        input.type = 'text';
        input.placeholder = 'Search time zone';
        input.setAttribute('enterkeyhint', 'search');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('aria-label', 'Search time zone');
        input.autocomplete = 'off';
        input.spellcheck = false;
        search.appendChild(input);
        head.appendChild(search);
        this.drawer.body.appendChild(head);

        const list = doc.createElement('div');
        list.className = 'vela-tzd-list';
        const empty = doc.createElement('div');
        empty.className = 'vela-tzd-empty';
        empty.hidden = true;

        const rows: Array<{ el: HTMLElement; haystack: string }> = [];
        for (const tz of timezoneMenuRows(this.opts.timezone())) {
            const row = doc.createElement('div');
            row.className = 'vela-tzd-row';
            row.setAttribute('role', 'button');
            row.setAttribute('aria-label', tz.label);
            if (tz.checked) row.setAttribute('aria-pressed', 'true');
            const label = doc.createElement('span');
            label.className = 'vela-tzd-row-label';
            label.textContent = tz.label;
            row.appendChild(label);
            if (tz.checked) row.appendChild(iconEl('check', doc));
            row.addEventListener('click', () => {
                this.opts.onTimezone(tz.value);
                this.drawer.hide();
            });
            rows.push({ el: row, haystack: fold(tz.label) });
            list.appendChild(row);
        }
        list.appendChild(empty);
        this.drawer.body.appendChild(list);

        // Filter as the user types. The sheet is rebuilt on every open, so the query never
        // survives a pick — the next open reads as a fresh list, not as the last search.
        const apply = (): void => {
            const q = fold(input.value.trim());
            let shown = 0;
            for (const { el, haystack } of rows) {
                const hit = q === '' || haystack.includes(q);
                el.hidden = !hit;
                if (hit) shown += 1;
            }
            empty.hidden = shown > 0;
            empty.textContent = `No time zone matches “${input.value.trim()}”`;
        };
        input.addEventListener('input', apply);
        // Enter picks the first match — a keyboard user types three letters and commits
        // without lifting a hand to the list.
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            rows.find((r) => !r.el.hidden)?.el.click();
        });
    }
}
