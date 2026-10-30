// Accessible select-only combobox for alert controls. The native select remains the
// value/event source, preserving existing alert logic and programmatic integrations.
import { Popover } from '../ui/components/popover';
import { floatingLayerHost } from '../ui/tokens';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-alert-select';
const CSS = `
/* A legacy alert Drawer is modal, so its popover stays inside the focus trap.
   The body still scrolls; only its outer clipping is lifted while the child is open. */
.vela-drawer[data-alert-select-open] { overflow: visible; }
.vela-alert-select { min-width: 0; width: 100%; }
.vela-alert-select--filter { width: auto; flex: none; }
.vela-alert-select-trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
    min-height: 38px; box-sizing: border-box; padding: 0 9px; border: 1px solid var(--vela-border-strong);
    border-radius: 0; background: var(--vela-surface-elev, var(--vela-bg)); color: var(--vela-fg-bright);
    font: 13px var(--vela-font); text-align: left; cursor: pointer; }
.vela-alert-select--filter .vela-alert-select-trigger { width: auto; min-width: 112px; min-height: 32px; }
.vela-alert-select-trigger:hover { background: var(--vela-hover); }
.vela-alert-select-trigger:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
.vela-alert-select-trigger:disabled { opacity: .45; cursor: default; }
.vela-alert-select-value { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.vela-alert-select-trigger .vela-icon { flex: none; width: 14px; height: 14px; font-size: 14px; color: var(--vela-fg-muted); }
.vela-popover.vela-alert-select-pop { width: max-content; min-width: 175px; max-width: 260px;
    padding: 4px; border: 1px solid var(--vela-border-strong); border-radius: 0; box-sizing: border-box;
    background: var(--vela-surface); color: var(--vela-fg); box-shadow: var(--vela-shadow); font: 13px var(--vela-font); }
.vela-alert-select-options { max-height: min(300px, calc(100vh - 24px)); overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.vela-alert-select-option { display: flex; width: 100%; min-height: 36px; align-items: center; gap: 10px;
    padding: 5px 8px; border: 0; border-radius: 0; background: transparent; color: inherit;
    text-align: left; font: inherit; cursor: pointer; box-sizing: border-box; }
.vela-alert-select-option[data-active] { background: var(--vela-hover); }
.vela-alert-select-option[aria-selected='true'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-alert-select-option:disabled { opacity: .42; cursor: default; }
.vela-alert-select-option span:first-child { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (pointer: coarse) { .vela-alert-select-trigger, .vela-alert-select--filter .vela-alert-select-trigger, .vela-alert-select-option { min-height: 44px; } }
`;
let sequence = 0;

export class AlertSelect {
    readonly el: HTMLElement;
    readonly trigger: HTMLButtonElement;
    private readonly value: HTMLElement;
    private popover: Popover | null = null;
    private observer: MutationObserver | null = null;
    private items: HTMLButtonElement[] = [];
    private active = -1;
    private typed = '';
    private typeTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly onChange = (): void => this.sync();

    constructor(private readonly select: HTMLSelectElement, filter = false) {
        const doc = select.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        const wrap = doc.createElement('div');
        wrap.className = `vela-alert-select${filter ? ' vela-alert-select--filter' : ''}`;
        select.parentNode?.insertBefore(wrap, select);
        wrap.appendChild(select);
        // The label's original `for` now names the interactive trigger, not an invisible
        // duplicate. The backing select keeps its CSS class, values and change events.
        const id = select.id;
        if (id) select.removeAttribute('id');
        select.tabIndex = -1; select.setAttribute('aria-hidden', 'true'); select.style.display = 'none';
        const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = 'vela-alert-select-trigger';
        if (id) trigger.id = id;
        const label = select.getAttribute('aria-label');
        if (label) trigger.setAttribute('aria-label', label);
        trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const text = doc.createElement('span'); text.className = 'vela-alert-select-value';
        trigger.append(text, iconEl('chevron-down', doc)); wrap.appendChild(trigger);
        this.el = wrap; this.trigger = trigger; this.value = text;
        trigger.addEventListener('click', () => this.popover?.open ? this.close() : this.open());
        trigger.addEventListener('keydown', (event) => this.key(event));
        select.addEventListener('change', this.onChange);
        this.sync();
    }

    /** Reflect programmatic rebinds and disabled options without replacing the control. */
    sync(): void {
        const option = this.select.selectedOptions[0];
        this.value.textContent = option?.textContent ?? '';
        this.trigger.disabled = this.select.disabled;
        if (this.popover?.open) {
            for (const [index, button] of this.items.entries()) {
                const source = this.select.options[index];
                if (!source) continue;
                button.disabled = source.disabled;
                button.setAttribute('aria-selected', String(source.selected));
                const mark = button.querySelector<HTMLElement>('.vela-alert-select-mark');
                if (mark) mark.textContent = source.selected ? '✓' : '';
            }
            if (this.active < 0 || this.items[this.active]?.disabled) this.setActive(this.selectedIndex());
        }
    }

    private selectedIndex(): number {
        const selected = this.select.selectedIndex;
        if (selected >= 0 && !this.select.options[selected]?.disabled) return selected;
        return [...this.select.options].findIndex((option) => !option.disabled);
    }

    open(): void {
        if (this.select.disabled || !this.trigger.isConnected || this.popover?.open) return;
        const doc = this.select.ownerDocument;
        const list = doc.createElement('div'); list.className = 'vela-alert-select-options'; list.id = `vela-alert-options-${++sequence}`;
        list.setAttribute('role', 'listbox');
        const label = this.trigger.id ? [...doc.querySelectorAll('label[for]')].find((el) => el.getAttribute('for') === this.trigger.id)?.textContent?.trim() : undefined;
        list.setAttribute('aria-label', this.trigger.getAttribute('aria-label') ?? label ?? 'Options');
        this.items = [...this.select.options].map((option, index) => {
            const item = doc.createElement('button'); item.type = 'button'; item.tabIndex = -1;
            item.className = 'vela-alert-select-option'; item.id = `${list.id}-${index}`; item.dataset.value = option.value;
            item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected)); item.disabled = option.disabled;
            const text = doc.createElement('span'); text.textContent = option.textContent;
            const mark = doc.createElement('span'); mark.className = 'vela-alert-select-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = option.selected ? '✓' : '';
            item.append(text, mark);
            // Pointer selection doesn't move focus away from the combobox before commit.
            item.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse') event.preventDefault(); });
            item.addEventListener('click', () => this.commit(index));
            list.appendChild(item); return item;
        });
        const modal = this.trigger.closest<HTMLElement>('.vela-drawer');
        const host = modal ?? floatingLayerHost(this.trigger, doc.body);
        const popover = new Popover({
            trigger: this.trigger, host, content: list, className: 'vela-alert-select-pop',
            position: 'fixed', boundary: 'viewport', viewportInset: 6, fitWithinBoundary: true,
            restoreFocusOnEscape: true, align: 'start',
            onClose: () => {
                this.observer?.disconnect(); this.observer = null;
                modal?.removeAttribute('data-alert-select-open');
                if (this.typeTimer) clearTimeout(this.typeTimer);
                this.typeTimer = null; this.typed = '';
                this.trigger.setAttribute('aria-expanded', 'false');
                this.trigger.removeAttribute('aria-controls'); this.trigger.removeAttribute('aria-activedescendant');
                if (this.popover === popover) this.popover = null;
                this.items = []; this.active = -1;
            },
        });
        this.popover = popover;
        this.trigger.setAttribute('aria-expanded', 'true'); this.trigger.setAttribute('aria-controls', list.id);
        popover.show();
        modal?.setAttribute('data-alert-select-open', '');
        this.setActive(this.selectedIndex());
        this.observer = new MutationObserver(() => {
            if (popover.open && (!this.trigger.isConnected || !this.trigger.getClientRects().length)) popover.hide();
        });
        for (let node: HTMLElement | null = this.trigger; node; node = node.parentElement) {
            this.observer.observe(node, { childList: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'data-layout'] });
            if (node === host) break;
        }
    }

    private setActive(index: number): void {
        if (index < 0 || !this.items[index] || this.items[index]?.disabled) return;
        this.items[this.active]?.removeAttribute('data-active');
        this.active = index;
        const item = this.items[index]!;
        item.setAttribute('data-active', '');
        this.trigger.setAttribute('aria-activedescendant', item.id);
        const list = item.parentElement;
        if (list) {
            const top = item.offsetTop - list.offsetTop;
            if (top < list.scrollTop) list.scrollTop = top;
            else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
        }
    }

    private step(delta: number): void {
        if (!this.items.length) return;
        let index = this.active;
        for (let i = 0; i < this.items.length; i++) {
            index = (index + delta + this.items.length) % this.items.length;
            if (!this.items[index]?.disabled) { this.setActive(index); return; }
        }
    }

    private key(event: KeyboardEvent): void {
        if (event.key === 'Tab') { this.close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!this.popover?.open) this.open(); else this.step(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            if (!this.popover?.open) return;
            event.preventDefault();
            const index = event.key === 'Home' ? this.items.findIndex((item) => !item.disabled)
                : this.items.length - 1 - [...this.items].reverse().findIndex((item) => !item.disabled);
            this.setActive(index); return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!this.popover?.open) this.open(); else this.commit(this.active);
            return;
        }
        if (this.popover?.open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.typed += event.key.toLowerCase();
            if (this.typeTimer) clearTimeout(this.typeTimer);
            this.typeTimer = setTimeout(() => { this.typed = ''; this.typeTimer = null; }, 700);
            const index = [...this.select.options].findIndex((option) => !option.disabled && (option.textContent ?? '').toLowerCase().startsWith(this.typed));
            if (index >= 0) this.setActive(index);
        }
    }

    private commit(index: number): void {
        const option = this.select.options[index];
        if (!option || option.disabled) return;
        const changed = this.select.value !== option.value;
        this.select.value = option.value;
        this.close();
        this.sync();
        if (changed) {
            const EventCtor = this.select.ownerDocument.defaultView?.Event ?? Event;
            this.select.dispatchEvent(new EventCtor('input', { bubbles: true }));
            this.select.dispatchEvent(new EventCtor('change', { bubbles: true }));
        }
        if (this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
    }

    close(): void { this.popover?.hide(); }
    focus(): void { this.trigger.focus({ preventScroll: true }); }
    destroy(): void {
        this.popover?.destroy(); this.observer?.disconnect();
        if (this.typeTimer) clearTimeout(this.typeTimer);
        this.select.removeEventListener('change', this.onChange);
    }
}
