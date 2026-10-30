// The layout-management actions live in one anchored, non-modal floating menu.
// Detailed inputs replace the list in the same surface rather than opening a sheet.
import { Popover } from '../ui/components/popover';
import { MENU_CSS, MENU_STYLE_ID } from '../ui/components/menu/styles';
import { downloadText } from '../ui/download';
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-layout-manager-styles';
const CSS = `
.vela-lmp-pop { width: min(224px, calc(100vw - 16px)); }
.vela-lmp.vela-menu {
  width: 100%; min-width: 0; max-width: 100%; max-height: var(--vela-lmp-max-height, 70vh);
  padding: 5px; box-sizing: border-box; overscroll-behavior: contain;
}
.vela-lmp-name { padding: 3px 9px 5px; font-size: 11px; color: var(--vela-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vela-lmp-item.vela-menu-item {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 32px; padding: 6px 9px; border-radius: 4px;
  color: var(--vela-fg); font: inherit; text-align: left; cursor: pointer;
}
.vela-lmp-item.vela-menu-item:hover, .vela-lmp-item.vela-menu-item:focus-visible { background: var(--vela-hover); color: var(--vela-fg-bright); outline: none; }
.vela-lmp-item:focus-visible { box-shadow: inset 0 0 0 1px var(--vela-fg-muted); }
.vela-lmp-item[disabled] { opacity: .45; cursor: default; background: transparent !important; }
.vela-lmp-item[hidden] { display: none !important; }
.vela-lmp-item[data-danger='1'] { color: var(--vela-fg-bright); }
.vela-lmp-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lmp-arrow { flex: none; margin-left: auto; color: var(--vela-fg-muted); font-size: 15px; line-height: 1; }
.vela-lmp-back { border-bottom: 1px solid var(--vela-border) !important; border-radius: 0 !important; margin-bottom: 3px !important; font-weight: 600 !important; }
.vela-lmp-back .vela-lmp-arrow { margin: 0 1px 0 0; }
.vela-lmp-form { padding: 5px 4px 4px; display: flex; flex-direction: column; gap: 7px; }
.vela-lmp-form label { font-size: 11px; color: var(--vela-fg-muted); }
.vela-lmp-input {
  box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 8px;
  border: 1px solid var(--vela-border-strong); border-radius: 5px; background: var(--vela-surface);
  color: var(--vela-fg-bright); font: inherit; font-size: 12px; text-overflow: ellipsis;
}
.vela-lmp-input:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
.vela-lmp-submit {
  all: unset; box-sizing: border-box; min-height: 32px; padding: 0 10px; border-radius: 5px;
  background: var(--vela-hover-strong); color: var(--vela-fg-bright); font: inherit; text-align: center; cursor: pointer;
}
.vela-lmp-submit:hover, .vela-lmp-submit:focus-visible { background: var(--vela-hover); outline: 1px solid var(--vela-fg-muted); }
.vela-lmp-status { padding: 5px 9px 3px; font-size: 11px; color: var(--vela-fg-muted); overflow-wrap: anywhere; }
.vela-lmp-status[hidden] { display: none; }
.vela-lmp-status[data-tone='ok'], .vela-lmp-status[data-tone='bad'] { color: var(--vela-fg-bright); }
.vela-lmp-filter { width: calc(100% - 8px); margin: 3px 4px 5px; }
@media (pointer: coarse) {
  .vela-lmp-item.vela-menu-item, .vela-lmp-submit { min-height: 40px; }
  .vela-lmp-input { min-height: 40px; font-size: 16px; }
}
`;

export interface LayoutManagerPanelOptions {
    host: HTMLElement;
    activeName: () => string | null;
    autosave: () => boolean;
    onToggleAutosave: (on: boolean) => void;
    onMakeCopy: () => string | null;
    onRename: (name: string) => boolean;
    sharing: () => boolean;
    onToggleSharing: (on: boolean) => void;
    shareUrl: () => Promise<string>;
    onCopyLink: () => Promise<string | null>;
    onOpenLink: (url: string) => Promise<boolean>;
    savedLayouts?: () => Array<{ name: string; active: boolean; dirty?: boolean; charts?: number; indicators?: number }>;
    onSaveChanges?: () => void;
    onSaveAs?: (name: string) => boolean;
    onOpenSaved?: (name: string) => void;
    onRenameSaved?: (from: string, to: string) => boolean;
    onDuplicateSaved?: (name: string) => string | null;
    onShareSaved?: (name: string) => Promise<string | null>;
    onExportSaved?: (name: string) => string | null;
    onDeleteSaved?: (name: string) => void;
    onExportData?: () => { rows: number; filename: string } | null;
    onImportLayout?: (json: string) => string | null;
    onOpenDrawingTemplates?: () => void;
}

type View = 'main' | 'sharing' | 'saved' | 'saved-actions' | 'files' | 'rename' | 'rename-saved' | 'save-as' | 'copy-saved' | 'show-link' | 'open-link' | 'delete-saved';
type Tone = 'ok' | 'bad' | '';
let menuSequence = 0;

/** Small action menu anchored to an existing toolbar control. */
export class LayoutManagerPanel {
    private popover: Popover | null = null;
    private surface: HTMLElement | null = null;
    private trigger: HTMLElement | null = null;
    private view: View = 'main';
    private selected = '';
    private status = '';
    private tone: Tone = '';
    private cleanup: (() => void) | null = null;
    private restoreFocus = false;
    private generation = 0;

    constructor(private readonly opts: LayoutManagerPanelOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(MENU_STYLE_ID, MENU_CSS, doc);
        injectStyles(STYLE_ID, CSS, doc);
    }

    /** Open near the caller; programmatic callers may fall back to the host. */
    open(trigger: HTMLElement = this.opts.host): void {
        if (this.popover?.open) {
            this.hide();
            return;
        }
        this.trigger = trigger;
        this.view = 'main';
        this.selected = '';
        this.status = '';
        this.tone = '';
        this.restoreFocus = false;
        const popover = new Popover({
            trigger,
            host: this.opts.host,
            className: 'vela-lmp-pop',
            align: trigger.classList.contains('vela-mb-more') ? 'end' : 'start',
            gap: 5,
            boundary: () => this.bounds(),
            boundaryInset: 6,
            content: (shell) => {
                const menu = shell.ownerDocument.createElement('div');
                menu.className = 'vela-lmp vela-menu';
                menu.id = `vela-layout-actions-${++menuSequence}`;
                menu.addEventListener('keydown', (e) => this.onKey(e));
                shell.appendChild(menu);
                this.surface = menu;
                this.render();
            },
            onClose: () => {
                this.generation += 1;
                this.cleanup?.();
                this.cleanup = null;
                this.popover = null;
                this.surface = null;
                if (this.trigger && this.trigger !== this.opts.host) {
                    this.trigger.setAttribute('aria-expanded', 'false');
                    this.trigger.removeAttribute('aria-controls');
                }
                if (this.restoreFocus && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
                this.restoreFocus = false;
                this.trigger = null;
            },
        });
        this.popover = popover;
        if (trigger !== this.opts.host && this.surface) {
            trigger.setAttribute('aria-haspopup', 'menu');
            trigger.setAttribute('aria-expanded', 'true');
            trigger.setAttribute('aria-controls', this.surface.id);
        }
        const win = this.opts.host.ownerDocument.defaultView;
        const onEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape') this.restoreFocus = true; };
        const onAnchor = (event: Event): void => {
            if (!this.surface?.contains(event.target as Node)) this.hide();
        };
        const reflow = (): void => {
            if (!this.popover?.open || !this.surface) return;
            // The opener can disappear when the phone rotates to desktop chrome.
            if (!trigger.isConnected || (this.opts.host.getBoundingClientRect().width > 0 && trigger.getClientRects().length === 0)) {
                this.hide();
                return;
            }
            const bounds = this.bounds();
            const anchor = trigger.getBoundingClientRect();
            const above = Math.max(0, Math.min(anchor.top, bounds.bottom) - bounds.top - 11);
            const below = Math.max(0, bounds.bottom - Math.max(anchor.bottom, bounds.top) - 11);
            const room = Math.max(above, below);
            // Prefer an internally scrolling menu to one that covers its opener.
            // A host used as a programmatic anchor can occupy the whole viewport.
            const height = room > 0 ? Math.min(bounds.height - 12, room) : bounds.height - 12;
            this.popover.el.style.maxWidth = `${Math.max(1, bounds.width - 12)}px`;
            this.surface.style.setProperty('--vela-lmp-max-height', `${Math.max(1, height)}px`);
            this.popover.reposition();
        };
        const onScroll = (event: Event): void => {
            if (!this.popover?.open || (event.target instanceof Node && this.popover.el.contains(event.target))) return;
            const strip = trigger.closest<HTMLElement>('.vela-widget-topbar');
            if (strip) {
                const anchor = trigger.getBoundingClientRect(), area = strip.getBoundingClientRect();
                const pair = strip.querySelector<HTMLElement>('.vela-widget-symbol')?.getBoundingClientRect();
                if (anchor.right <= Math.max(area.left, pair?.right ?? area.left) || anchor.left >= area.right) { this.hide(); return; }
            }
            reflow();
        };
        // Register first so Escape can restore the opener after Popover handles dismissal.
        this.opts.host.ownerDocument.addEventListener('scroll', onScroll, true);
        win?.addEventListener('keydown', onEscape, true);
        win?.addEventListener('resize', reflow);
        win?.visualViewport?.addEventListener('resize', reflow);
        win?.visualViewport?.addEventListener('scroll', reflow);
        const modeObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(reflow) : null;
        // More is now a persistent parent pane. If it closes programmatically or its
        // row is replaced, the child must not remain floating without an opener.
        for (let node: HTMLElement | null = trigger; node; node = node.parentElement) {
            modeObserver?.observe(node, { attributes: true, attributeFilter: ['data-layout', 'hidden', 'style', 'class'], childList: true });
            if (node === this.opts.host) break;
        }
        const hostObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reflow) : null;
        hostObserver?.observe(this.opts.host);
        // Defer the anchor listener so the click that opened this menu cannot close it.
        setTimeout(() => { if (this.popover === popover && popover.open) trigger.addEventListener('click', onAnchor); }, 0);
        this.cleanup = () => {
            modeObserver?.disconnect();
            hostObserver?.disconnect();
            this.opts.host.ownerDocument.removeEventListener('scroll', onScroll, true);
            win?.removeEventListener('keydown', onEscape, true);
            win?.removeEventListener('resize', reflow);
            win?.visualViewport?.removeEventListener('resize', reflow);
            win?.visualViewport?.removeEventListener('scroll', reflow);
            trigger.removeEventListener('click', onAnchor);
        };
        popover.show();
        reflow();
        this.focusFirst();
        // A closing mobile drawer can restore focus to More after this menu opens.
        // Re-enter the menu only if that restore won, never over a user's later focus.
        setTimeout(() => {
            const doc = this.opts.host.ownerDocument;
            if (this.popover === popover && popover.open && (doc.activeElement === trigger || doc.activeElement === doc.body)) this.focusFirst();
        }, 220);
    }

    hide(): void { this.popover?.hide(); }
    destroy(): void { this.popover?.destroy(); }

    private bounds(): DOMRect {
        const win = this.opts.host.ownerDocument.defaultView;
        const host = this.opts.host.getBoundingClientRect();
        const vw = win?.innerWidth ?? 0, vh = win?.innerHeight ?? 0;
        const visual = win?.visualViewport;
        const left = Math.max(host.width > 0 ? host.left : 0, visual?.offsetLeft ?? 0);
        const top = Math.max(host.height > 0 ? host.top : 0, visual?.offsetTop ?? 0);
        const right = Math.min(host.width > 0 ? host.right : vw, (visual?.offsetLeft ?? 0) + (visual?.width ?? vw));
        const bottom = Math.min(host.height > 0 ? host.bottom : vh, (visual?.offsetTop ?? 0) + (visual?.height ?? vh));
        return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }

    private focusFirst(): void {
        const surface = this.surface;
        setTimeout(() => {
            if (surface !== this.surface || !this.popover?.open) return;
            const first = surface?.querySelector<HTMLElement>('[data-focus-first], .vela-lmp-item:not([disabled])');
            first?.focus({ preventScroll: true });
        }, 0);
    }

    private onKey(e: KeyboardEvent): void {
        if (!this.surface || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const items = [...this.surface.querySelectorAll<HTMLButtonElement>('.vela-lmp-item:not([disabled])')].filter((el) => !el.hidden);
        if (items.length === 0) return;
        const index = items.indexOf(this.surface.ownerDocument.activeElement as HTMLButtonElement);
        let next = -1;
        if (e.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (e.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'ArrowRight' && index >= 0 && items[index]?.dataset.branch === '1') {
            e.preventDefault(); items[index]?.click(); return;
        } else if (e.key === 'ArrowLeft' && this.view !== 'main') {
            e.preventDefault(); this.back(); return;
        }
        if (next >= 0) { e.preventDefault(); items[next]?.focus({ preventScroll: true }); }
    }

    private back(): void {
        if (this.view === 'saved-actions' || this.view === 'rename-saved' || this.view === 'copy-saved' || this.view === 'delete-saved') {
            this.go(this.view === 'saved-actions' ? 'saved' : 'saved-actions');
        } else if (this.view === 'show-link' || this.view === 'open-link') this.go('sharing');
        else this.go('main');
    }

    private go(view: View): void {
        this.view = view;
        this.status = '';
        this.tone = '';
        this.render();
        this.focusFirst();
    }

    private note(text: string, tone: Tone = ''): void {
        this.status = text;
        this.tone = tone;
        const status = this.surface?.querySelector<HTMLElement>('.vela-lmp-status');
        if (!status) return;
        status.textContent = text;
        status.hidden = !text;
        if (tone) status.dataset.tone = tone;
        else delete status.dataset.tone;
        this.popover?.reposition();
    }

    private render(focusAction?: string): void {
        const surface = this.surface;
        if (!surface) return;
        const doc = surface.ownerDocument;
        const formView = ['rename', 'rename-saved', 'save-as', 'copy-saved', 'show-link', 'open-link'].includes(this.view)
            || (this.view === 'saved' && (this.opts.savedLayouts?.().length ?? 0) >= 8);
        surface.dataset.page = this.view;
        surface.setAttribute('role', formView ? 'group' : 'menu');
        surface.setAttribute('aria-label', 'Manage layouts');
        surface.replaceChildren();
        const row = (id: string, label: string, run: () => void, options: { checked?: boolean; branch?: boolean; disabled?: boolean; danger?: boolean; back?: boolean } = {}): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-lmp-item vela-menu-item' + (options.back ? ' vela-lmp-back' : '');
            b.dataset.action = id;
            if (!formView) b.setAttribute('role', options.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
            if (options.checked !== undefined) b.setAttribute('aria-checked', String(options.checked));
            if (options.branch) { b.dataset.branch = '1'; b.setAttribute('aria-haspopup', 'menu'); }
            if (options.danger) b.dataset.danger = '1';
            b.disabled = options.disabled === true;
            if (options.back) {
                const arrow = doc.createElement('span'); arrow.className = 'vela-lmp-arrow'; arrow.textContent = '‹'; arrow.setAttribute('aria-hidden', 'true'); b.appendChild(arrow);
            }
            const text = doc.createElement('span'); text.className = 'vela-lmp-text'; text.textContent = label; b.appendChild(text);
            if (options.checked !== undefined) {
                const sw = doc.createElement('span'); sw.className = 'vela-menu-switch' + (options.checked ? ' on' : ''); sw.setAttribute('aria-hidden', 'true'); b.appendChild(sw);
            } else if (options.branch) {
                const arrow = doc.createElement('span'); arrow.className = 'vela-lmp-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true'); b.appendChild(arrow);
            }
            b.addEventListener('click', run);
            surface.appendChild(b);
            return b;
        };
        const back = (label: string): void => { row('back', label, () => this.back(), { back: true }); };
        const form = (label: string, value: string, action: string, submit: (value: string) => void, readOnly = false): void => {
            const wrap = doc.createElement('form'); wrap.className = 'vela-lmp-form';
            const text = doc.createElement('label'); text.textContent = label;
            const input = doc.createElement('input'); input.className = 'vela-lmp-input'; input.type = 'text'; input.value = value;
            input.readOnly = readOnly; input.setAttribute('aria-label', label); input.spellcheck = false;
            if (!readOnly) input.dataset.focusFirst = '1';
            const submitButton = doc.createElement('button'); submitButton.type = 'submit'; submitButton.className = 'vela-lmp-submit'; submitButton.textContent = action; submitButton.dataset.action = 'submit';
            text.appendChild(input);
            wrap.append(text, submitButton);
            wrap.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value.trim()); });
            surface.appendChild(wrap);
            if (this.view === 'show-link') {
                input.placeholder = 'Generating link…';
                const generation = this.generation;
                void this.opts.shareUrl().then((url) => {
                    if (generation === this.generation && input.isConnected && this.opts.sharing()) input.value = url;
                }).catch(() => { if (input.isConnected) this.note('Could not generate a link', 'bad'); });
            }
        };

        if (this.view === 'main') {
            const name = doc.createElement('div'); name.className = 'vela-lmp-name'; name.textContent = this.opts.activeName() ?? 'Unsaved layout'; name.title = name.textContent; name.setAttribute('role', 'presentation'); surface.appendChild(name);
            row('save', this.opts.activeName() ? 'Save layout' : 'Name and save…', () => {
                if (this.opts.activeName() && this.opts.onSaveChanges) { this.opts.onSaveChanges(); this.note('Layout saved', 'ok'); }
                else this.go(this.opts.onSaveAs ? 'save-as' : 'rename');
            });
            row('autosave', 'Autosave', () => {
                this.opts.onToggleAutosave(!this.opts.autosave()); this.render('autosave');
            }, { checked: this.opts.autosave() });
            row('copy', 'Make a copy', () => {
                const copy = this.opts.onMakeCopy();
                this.render('copy'); this.note(copy ? `Copy “${copy}” created` : 'Could not make a copy', copy ? 'ok' : 'bad');
            });
            row('rename', 'Rename…', () => this.go('rename'));
            row('sharing', 'Sharing', () => this.go('sharing'), { branch: true });
            if (this.opts.savedLayouts) row('saved', 'Saved layouts', () => this.go('saved'), { branch: true });
            if (this.opts.onSaveAs || this.opts.onExportData || this.opts.onImportLayout || this.opts.onOpenDrawingTemplates) row('files', 'More actions', () => this.go('files'), { branch: true });
        } else if (this.view === 'sharing') {
            back('Sharing');
            row('sharing-toggle', 'Sharing link', () => {
                this.opts.onToggleSharing(!this.opts.sharing()); this.render('sharing-toggle');
            }, { checked: this.opts.sharing() });
            row('share-copy', 'Copy link', () => this.copyLink(), { disabled: !this.opts.sharing() });
            row('share-view', 'View link…', () => this.go('show-link'), { disabled: !this.opts.sharing() });
            row('open-link', 'Open link…', () => this.go('open-link'));
        } else if (this.view === 'saved') {
            back('Saved layouts');
            const layouts = this.opts.savedLayouts?.() ?? [];
            if (layouts.length >= 8) {
                const filter = doc.createElement('input'); filter.type = 'search'; filter.className = 'vela-lmp-input vela-lmp-filter'; filter.placeholder = 'Filter layouts…'; filter.setAttribute('aria-label', 'Filter saved layouts');
                filter.addEventListener('input', () => {
                    const query = filter.value.trim().toLowerCase();
                    for (const item of surface.querySelectorAll<HTMLElement>('[data-saved-name]')) item.hidden = !(item.dataset.savedName ?? '').toLowerCase().includes(query);
                });
                surface.appendChild(filter);
            }
            for (const item of layouts) {
                const b = row('saved-item', `${item.name}${item.active ? ' ✓' : ''}${item.dirty ? ' •' : ''}`, () => { this.selected = item.name; this.go('saved-actions'); }, { branch: true });
                b.dataset.savedName = item.name;
                const details = [item.active ? 'active' : '', item.dirty ? 'unsaved changes' : '', typeof item.charts === 'number' ? `${item.charts} charts` : '', typeof item.indicators === 'number' ? `${item.indicators} indicators` : ''].filter(Boolean);
                b.title = [item.name, ...details].join(' · ');
                b.setAttribute('aria-label', [item.name, ...details, 'saved layout actions'].join(', '));
            }
            if (!layouts.length) { const empty = doc.createElement('div'); empty.className = 'vela-lmp-status'; empty.textContent = 'No saved layouts'; surface.appendChild(empty); }
        } else if (this.view === 'saved-actions') {
            back(this.selected);
            if (this.opts.onOpenSaved) row('saved-open', 'Open', () => { this.opts.onOpenSaved?.(this.selected); this.restoreFocus = true; this.hide(); });
            if (this.opts.onRenameSaved) row('saved-rename', 'Rename…', () => this.go('rename-saved'));
            if (this.opts.onDuplicateSaved) row('saved-copy', 'Make a copy…', () => this.go('copy-saved'));
            if (this.opts.onShareSaved) row('saved-share', 'Share link', () => {
                const generation = this.generation;
                void this.opts.onShareSaved?.(this.selected).then((url) => {
                    if (generation === this.generation && this.view === 'saved-actions') this.note(url ? 'Link copied' : 'Clipboard refused', url ? 'ok' : 'bad');
                }).catch(() => { if (generation === this.generation && this.view === 'saved-actions') this.note('Clipboard refused', 'bad'); });
            });
            if (this.opts.onExportSaved) row('saved-export', 'Export layout', () => {
                const json = this.opts.onExportSaved?.(this.selected);
                if (!json) return this.note('Could not read that layout', 'bad');
                downloadText(doc, `${this.selected}.vela-layout.json`, json); this.note('Layout exported', 'ok');
            });
            if (this.opts.onDeleteSaved) row('saved-delete', 'Delete…', () => this.go('delete-saved'), { danger: true });
        } else if (this.view === 'delete-saved') {
            back('Delete layout');
            row('confirm-delete', `Delete “${this.selected}”`, () => {
                this.opts.onDeleteSaved?.(this.selected); this.go('saved'); this.note('Layout deleted', 'ok');
            }, { danger: true });
            row('cancel-delete', 'Cancel', () => this.go('saved-actions'));
        } else if (this.view === 'files') {
            back('More actions');
            if (this.opts.onSaveAs) row('save-as', 'Save as…', () => this.go('save-as'));
            if (this.opts.onExportData) row('export-data', 'Export chart data (CSV)', () => {
                const out = this.opts.onExportData?.();
                this.note(out ? `Exported ${out.rows.toLocaleString()} bars` : 'No bar data to export yet', out ? 'ok' : 'bad');
            });
            if (this.opts.onImportLayout) row('import-layout', 'Import layout file…', () => this.pickImport());
            if (this.opts.onOpenDrawingTemplates) row('drawing-templates', 'Drawing templates…', () => { this.hide(); this.opts.onOpenDrawingTemplates?.(); });
        } else if (this.view === 'rename') {
            back('Rename');
            form('Layout name', this.opts.activeName() ?? '', 'Rename', (name) => {
                if (!name) return this.note('Enter a name first', 'bad');
                if (name === this.opts.activeName()) { this.go('main'); return; }
                if (!this.opts.onRename(name)) return this.note('That name is already used', 'bad');
                this.go('main'); this.note(`Renamed to ${name}`, 'ok');
            });
        } else if (this.view === 'rename-saved') {
            back('Rename layout');
            form('Layout name', this.selected, 'Rename', (name) => {
                if (!name) return this.note('Enter a name first', 'bad');
                if (name === this.selected) { this.go('saved-actions'); return; }
                if (!this.opts.onRenameSaved?.(this.selected, name)) return this.note('That name is already used', 'bad');
                this.selected = name; this.go('saved-actions'); this.note('Layout renamed', 'ok');
            });
        } else if (this.view === 'save-as') {
            back('Save as');
            form('Layout name', this.opts.activeName() ? `${this.opts.activeName()} copy` : '', 'Save', (name) => {
                if (!name) return this.note('Enter a name first', 'bad');
                if (this.opts.savedLayouts?.().some((item) => item.name === name)) return this.note('That name is already used', 'bad');
                if (!this.opts.onSaveAs?.(name)) return this.note('Could not save layout', 'bad');
                this.go('main'); this.note('Layout saved', 'ok');
            });
        } else if (this.view === 'copy-saved') {
            back('Make a copy');
            form('Name the copy', `${this.selected} copy`, 'Copy', (name) => {
                if (!name) return this.note('Enter a name first', 'bad');
                if (this.opts.savedLayouts?.().some((item) => item.name === name)) return this.note('That name is already used', 'bad');
                const copy = this.opts.onDuplicateSaved?.(this.selected);
                if (!copy) return this.note('Could not make a copy', 'bad');
                if (copy !== name && !this.opts.onRenameSaved?.(copy, name)) { this.go('saved'); this.note(`Saved as “${copy}”`, 'bad'); return; }
                this.go('saved'); this.note(`Copy “${name}” created`, 'ok');
            });
        } else if (this.view === 'show-link') {
            back('Sharing link');
            form('Workspace sharing link', '', 'Copy link', () => this.copyLink(), true);
        } else if (this.view === 'open-link') {
            back('Open link');
            form('Shared link to open', '', 'Open link', (url) => {
                if (!url) return this.note('Paste a link first', 'bad');
                const generation = this.generation;
                void this.opts.onOpenLink(url).then((ok) => {
                    if (generation !== this.generation) return;
                    if (ok) this.hide();
                    else this.note('That link could not be opened', 'bad');
                }).catch(() => { if (generation === this.generation) this.note('That link could not be opened', 'bad'); });
            });
        }
        const status = doc.createElement('div'); status.className = 'vela-lmp-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.textContent = this.status; status.hidden = !this.status;
        if (this.tone) status.dataset.tone = this.tone;
        surface.appendChild(status);
        this.popover?.reposition();
        if (focusAction) surface.querySelector<HTMLElement>(`[data-action="${focusAction}"]`)?.focus({ preventScroll: true });
    }

    private copyLink(): void {
        if (!this.opts.sharing()) return;
        const generation = this.generation;
        const view = this.view;
        void this.opts.onCopyLink().then((url) => {
            if (generation !== this.generation || view !== this.view) return;
            if (url) this.note('Link copied', 'ok');
            else {
                if (this.view !== 'show-link') this.go('show-link');
                this.note('Clipboard refused — select the link instead', 'bad');
            }
        }).catch(() => {
            if (generation !== this.generation || view !== this.view) return;
            if (this.view !== 'show-link') this.go('show-link');
            this.note('Clipboard refused — select the link instead', 'bad');
        });
    }

    private pickImport(): void {
        const doc = this.opts.host.ownerDocument;
        const generation = this.generation;
        const input = doc.createElement('input');
        input.type = 'file'; input.accept = 'application/json,.json,.vela'; input.hidden = true; input.setAttribute('aria-label', 'Import layout file');
        input.addEventListener('cancel', () => input.remove(), { once: true });
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) { input.remove(); return; }
            void file.text().then((text) => {
                const name = this.opts.onImportLayout?.(text) ?? null;
                if (generation === this.generation) this.note(name ? `Imported ${name}` : 'That file is not a layout snapshot', name ? 'ok' : 'bad');
            }).catch(() => { if (generation === this.generation) this.note('Could not read that file', 'bad'); }).finally(() => input.remove());
        });
        doc.body.appendChild(input);
        input.click();
    }
}
