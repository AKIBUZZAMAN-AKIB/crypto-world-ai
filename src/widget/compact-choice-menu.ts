// Small, non-modal choice menus for workspace chrome. The parent remains mounted and
// the menu is placed against the workspace/visual viewport, never against a chart cell.
import { Popover } from '../ui/components/popover';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-compact-choice-menu';
const CSS = `
.vela-popover.vela-choice-pop {
    width: min(240px, calc(100vw - 12px)); padding: 4px; box-sizing: border-box;
    border-radius: 0; background: var(--vela-surface); color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong); box-shadow: var(--vela-shadow);
    font: 13px var(--vela-font); display: flex; flex-direction: column; overflow: hidden;
}
.vela-choice-body { max-height: 310px; }
.vela-choice-search { display: flex; flex: none; align-items: center; gap: 7px; padding: 3px 7px;
    border-bottom: 1px solid var(--vela-border); color: var(--vela-fg-muted); }
.vela-choice-search .vela-icon { width: 16px; height: 16px; font-size: 16px; flex: none; }
.vela-choice-search input { width: 100%; min-width: 0; height: 34px; padding: 0; border: 0; outline: 0;
    background: transparent; color: var(--vela-fg-bright); font: 16px var(--vela-font); }
.vela-choice-list { min-height: 0; overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.vela-choice-row { display: flex; width: 100%; min-height: 38px; align-items: center; gap: 8px;
    padding: 5px 8px; border: 0; border-radius: 0; background: transparent; color: var(--vela-fg);
    font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
.vela-choice-row[hidden] { display: none; }
.vela-choice-row:hover, .vela-choice-row:focus-visible { background: var(--vela-hover); outline: none; }
.vela-choice-row[aria-checked='true'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-choice-row:disabled { opacity: .42; cursor: default; }
.vela-choice-row .vela-icon { width: 16px; height: 16px; font-size: 16px; flex: none; color: var(--vela-fg-muted); }
.vela-choice-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-choice-check { flex: none; width: 16px; text-align: center; color: var(--vela-fg-bright); }
.vela-choice-empty { padding: 12px 8px; color: var(--vela-fg-muted); }
.vela-choice-empty[hidden] { display: none; }
@media (pointer: coarse) { .vela-choice-row { min-height: 44px; } }
`;

export interface CompactChoice {
    id: string;
    label: string;
    checked?: boolean;
    disabled?: boolean;
    icon?: string;
    /** Additional searchable text (for example an IANA identifier). */
    searchText?: string;
}

export interface CompactChoiceMenuOptions {
    host: HTMLElement;
    /** Optional placement boundary when the portal host is an interior modal surface. */
    boundary?: HTMLElement;
    label: string;
    className?: string;
    searchLabel?: string;
    onSelect: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
}

const fold = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let sequence = 0;

/** Native buttons and menuitemradio semantics, with keyboard traversal and Escape focus return. */
export class CompactChoiceMenu {
    private popover: Popover | null = null;
    private observer: MutationObserver | null = null;
    private sizeObserver: ResizeObserver | null = null;
    private anchor: HTMLElement | null = null;

    constructor(private readonly opts: CompactChoiceMenuOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
    }

    open(anchor: HTMLElement, items: readonly CompactChoice[]): void {
        if (this.popover?.open && this.anchor === anchor) { this.close(); return; }
        this.close();
        if (!anchor.isConnected) return;
        const doc = anchor.ownerDocument;
        const body = doc.createElement('div');
        body.className = 'vela-choice-body';
        body.style.cssText = 'min-height:0;display:flex;flex-direction:column;overflow:hidden';
        const list = doc.createElement('div');
        list.className = 'vela-choice-list';
        list.id = `vela-choice-${++sequence}`;
        list.setAttribute('role', 'menu');
        list.setAttribute('aria-label', this.opts.label);
        const rows: Array<{ el: HTMLButtonElement; text: string }> = [];
        const available = (): HTMLButtonElement[] => rows.map((row) => row.el).filter((row) => !row.hidden && !row.disabled);
        for (const item of items) {
            const row = doc.createElement('button');
            row.type = 'button'; row.className = 'vela-choice-row'; row.dataset.value = item.id;
            row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', String(item.checked === true));
            row.disabled = item.disabled === true;
            if (item.icon) row.appendChild(iconEl(item.icon, doc));
            const label = doc.createElement('span'); label.className = 'vela-choice-label'; label.textContent = item.label;
            const check = doc.createElement('span'); check.className = 'vela-choice-check'; check.setAttribute('aria-hidden', 'true');
            check.textContent = item.checked ? '✓' : '';
            row.append(label, check);
            row.addEventListener('click', () => {
                if (row.disabled) return;
                this.close();
                this.opts.onSelect(item.id);
                if (anchor.isConnected) anchor.focus({ preventScroll: true });
            });
            row.addEventListener('keydown', (event) => {
                const choices = available(); const index = choices.indexOf(row);
                const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % choices.length
                    : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + choices.length - 1) % choices.length
                        : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : -1;
                if (next >= 0 && choices.length) { event.preventDefault(); choices[next]?.focus(); }
            });
            rows.push({ el: row, text: fold(`${item.label} ${item.searchText ?? ''}`) });
            list.appendChild(row);
        }
        const empty = doc.createElement('div'); empty.className = 'vela-choice-empty'; empty.hidden = true;
        empty.textContent = 'No matching choices'; list.appendChild(empty);
        if (this.opts.searchLabel) {
            const wrap = doc.createElement('label'); wrap.className = 'vela-choice-search';
            wrap.appendChild(iconEl('search', doc));
            const input = doc.createElement('input'); input.type = 'search'; input.placeholder = this.opts.searchLabel;
            input.setAttribute('aria-label', this.opts.searchLabel); input.setAttribute('enterkeyhint', 'search');
            input.autocomplete = 'off'; input.spellcheck = false;
            input.addEventListener('input', () => {
                const q = fold(input.value.trim());
                for (const row of rows) row.el.hidden = !row.text.includes(q);
                empty.hidden = rows.some((row) => !row.el.hidden);
                list.scrollTop = 0;
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); available()[0]?.focus(); }
                else if (event.key === 'Enter') { event.preventDefault(); available()[0]?.click(); }
            });
            wrap.appendChild(input); body.appendChild(wrap);
        }
        body.appendChild(list);
        this.anchor = anchor;
        anchor.setAttribute('aria-haspopup', 'menu'); anchor.setAttribute('aria-expanded', 'true');
        anchor.setAttribute('aria-controls', list.id);
        const popover = new Popover({
            host: this.opts.host, trigger: anchor, content: body, className: `vela-choice-pop ${this.opts.className ?? ''}`,
            boundary: this.opts.boundary ?? this.opts.host, fitWithinBoundary: true, restoreFocusOnEscape: true,
            position: 'fixed', align: 'end', viewportInset: 6, boundaryInset: 6,
            onClose: () => {
                this.observer?.disconnect(); this.observer = null;
                this.sizeObserver?.disconnect(); this.sizeObserver = null;
                anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-controls');
                if (this.popover === popover) { this.popover = null; this.anchor = null; }
                this.opts.onOpenChange?.(false);
            },
        });
        this.popover = popover;
        popover.show();
        const checkAnchor = (): void => {
            if (!popover.open) return;
            if (!anchor.isConnected || !anchor.getClientRects().length) { popover.hide(); return; }
            popover.reposition();
        };
        this.observer = new MutationObserver(checkAnchor);
        for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
            this.observer.observe(node, { attributes: true, attributeFilter: ['hidden', 'style', 'class', 'data-layout'], childList: true });
            if (node === this.opts.host) break;
        }
        if (typeof ResizeObserver !== 'undefined') {
            this.sizeObserver = new ResizeObserver(checkAnchor);
            this.sizeObserver.observe(anchor);
        }
        this.opts.onOpenChange?.(true);
        // Do not focus the search field automatically: that would raise the phone keyboard.
        const selected = rows.find((row) => row.el.getAttribute('aria-checked') === 'true' && !row.el.disabled)?.el ?? available()[0];
        selected?.focus({ preventScroll: true });
        if (selected) list.scrollTop = Math.max(0, selected.offsetTop - list.offsetTop - list.clientHeight / 2);
    }

    close(): void { this.popover?.hide(); }
    destroy(): void { this.popover?.destroy(); this.observer?.disconnect(); this.sizeObserver?.disconnect(); }
}
