// Compact layout-management panel — R86 Task 5 / Task 9.
//
// TradingView keeps "Layout setup" (the chart grid) and "Manage layouts" (saving, naming,
// copying and sharing the workspace) apart. This panel holds ONLY the management verbs in a
// small non-modal card, so the chart stays visible and the grid sheet stays about the grid.

import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { BEARISH } from '../core/palette';

const STYLE_ID = 'vela-layout-manager-styles';
const CSS = `
.vela-lm-dialog { width: min(340px, calc(100vw - 24px)) !important; max-width: calc(100vw - 24px) !important; }
.vela-lm { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-height: min(68vh, 520px); overflow-y: auto; overscroll-behavior: contain; }
.vela-lm-name { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vela-fg-muted); padding: 2px 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lm-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; padding: 3px 0; border-bottom: 1px solid var(--vela-border); }
.vela-lm-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.vela-lm-hint { font-size: 11px; color: var(--vela-fg-muted); }
.vela-lm-btn { all: unset; box-sizing: border-box; flex: none; min-height: 30px; max-width: 100%; padding: 0 10px; border: 1px solid var(--vela-border-strong); border-radius: 999px; color: var(--vela-fg); font: inherit; font-size: 12px; font-weight: 600; text-align: center; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vela-lm-btn:hover { border-color: var(--vela-accent); color: var(--vela-accent); }
.vela-lm-btn[disabled] { opacity: 0.45; cursor: default; }
.vela-lm-switch { all: unset; box-sizing: border-box; flex: none; width: 38px; height: 22px; padding: 2px; border: 1px solid var(--vela-border-strong); border-radius: 999px; cursor: pointer; }
.vela-lm-switch::before { content: ''; display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--vela-fg-muted); transition: transform var(--vela-dur-fast, 120ms) ease, background var(--vela-dur-fast, 120ms) ease; }
.vela-lm-switch[aria-checked='true'] { border-color: var(--vela-accent); }
.vela-lm-switch[aria-checked='true']::before { transform: translateX(16px); background: var(--vela-accent); }
.vela-lm-inputrow { display: flex; gap: 6px; align-items: center; min-width: 0; padding: 4px 0; }
.vela-lm-input { flex: 1; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--vela-border-strong); border-radius: var(--vela-radius-sm, 6px); background: var(--vela-surface); color: var(--vela-fg-bright); font: inherit; font-size: 12px; text-overflow: ellipsis; }
.vela-lm-status { min-height: 16px; padding: 2px 0 0; font-size: 11px; color: var(--vela-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lm-status[data-tone='ok'] { color: var(--vela-up, var(--vela-accent)); }
.vela-lm-status[data-tone='bad'] { color: var(--vela-down, ${BEARISH}); }
.vela-lm-section { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--vela-border-strong); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vela-fg-muted); }
/* The kit's mobile rule makes EVERY dialog fullscreen. This panel is deliberately the
   exception: a small centred card, with the chart still visible around it. */
[data-layout='mobile'] .vela-dialog.vela-lm-dialog {
  position: absolute;
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  width: min(340px, calc(100vw - 24px)) !important;
  min-width: 0 !important;
  max-width: calc(100vw - 24px) !important;
  max-height: min(70vh, 520px) !important;
  flex: 0 0 auto;
  border: 1px solid var(--vela-border-strong) !important;
  border-radius: 10px !important;
  transform: translate(-50%, -50%) !important;
}
[data-layout='mobile'] .vela-lm-dialog .vela-dialog-body { padding-bottom: var(--vela-space-4); }
@media (max-width: 360px) {
  .vela-lm-dialog,
  [data-layout='mobile'] .vela-dialog.vela-lm-dialog { width: calc(100vw - 16px) !important; max-width: calc(100vw - 16px) !important; }
  .vela-lm-row { flex-wrap: wrap; gap: 4px 8px; }
  .vela-lm-btn { max-width: 100%; }
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
    /** The current workspace URL, shown only while sharing is on. */
    shareUrl: () => Promise<string>;
    /** Copy the link to the clipboard; null means the browser refused. */
    onCopyLink: () => Promise<string | null>;
    /** Adopt a pasted/shared workspace or layout URL. */
    onOpenLink: (url: string) => Promise<boolean>;
}

export class LayoutManagerPanel {
    private dialog: Dialog | null = null;
    private body: HTMLElement | null = null;
    private status = '';
    private tone: 'ok' | 'bad' | '' = '';

    constructor(private readonly opts: LayoutManagerPanelOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
    }

    open(): void {
        if (!this.dialog) {
            this.dialog = new Dialog({
                title: 'Manage layouts',
                kicker: 'Workspace',
                headerIcon: 'layout',
                host: this.opts.host,
                className: 'vela-lm-dialog',
                modal: false,
                align: 'center',
                closeOnInteractOutside: true,
                content: (body) => {
                    body.classList.add('vela-lm');
                    this.body = body;
                },
            });
        }
        this.status = '';
        this.tone = '';
        this.render();
        this.dialog.show();
    }

    hide(): void {
        this.dialog?.hide();
    }

    private note(text: string, tone: 'ok' | 'bad' | '' = ''): void {
        this.status = text;
        this.tone = tone;
        this.render();
    }

    private render(): void {
        const body = this.body;
        if (!body) return;
        const doc = body.ownerDocument;
        const name = this.opts.activeName();
        const sharing = this.opts.sharing();
        body.replaceChildren();

        const title = doc.createElement('div');
        title.className = 'vela-lm-name';
        title.textContent = name ? `Open layout — ${name}` : 'Unsaved layout';
        body.appendChild(title);

        const row = (label: string, control: HTMLElement): HTMLElement => {
            const r = doc.createElement('div');
            r.className = 'vela-lm-row';
            const l = doc.createElement('span');
            l.className = 'vela-lm-label';
            l.textContent = label;
            r.append(l, control);
            return r;
        };
        const button = (label: string, run: () => void, disabled = false): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-lm-btn';
            b.textContent = label;
            b.disabled = disabled;
            b.addEventListener('click', run);
            return b;
        };
        const toggle = (on: boolean, run: (next: boolean) => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-lm-switch';
            b.setAttribute('role', 'switch');
            b.setAttribute('aria-checked', String(on));
            b.setAttribute('aria-label', on ? 'On' : 'Off');
            b.addEventListener('click', () => run(!on));
            return b;
        };

        body.appendChild(row('Autosave', toggle(this.opts.autosave(), (on) => {
            this.opts.onToggleAutosave(on);
            this.note(on ? 'Autosave on' : 'Autosave off', 'ok');
        })));

        const renameWrap = doc.createElement('div');
        renameWrap.className = 'vela-lm-inputrow';
        const rename = doc.createElement('input');
        rename.className = 'vela-lm-input';
        rename.type = 'text';
        rename.placeholder = 'Layout name';
        rename.value = name ?? '';
        rename.setAttribute('aria-label', 'Layout name');
        renameWrap.append(rename, button('Rename', () => {
            const value = rename.value.trim();
            if (!value) return this.note('Enter a name first', 'bad');
            const ok = this.opts.onRename(value);
            this.note(ok ? `Renamed to ${value}` : 'That name is already used', ok ? 'ok' : 'bad');
        }));
        body.appendChild(renameWrap);

        body.appendChild(row('Duplicate the open layout', button('Make a copy', () => {
            const copy = this.opts.onMakeCopy();
            this.note(copy ? `Copy “${copy}” created` : 'Could not make a copy', copy ? 'ok' : 'bad');
        })));

        const section = doc.createElement('div');
        section.className = 'vela-lm-section';
        section.textContent = 'Sharing link';
        body.appendChild(section);
        body.appendChild(row('Sharing link', toggle(sharing, (on) => {
            this.opts.onToggleSharing(on);
            this.note(on ? 'Sharing link on' : 'Sharing link off', 'ok');
        })));

        const linkWrap = doc.createElement('div');
        linkWrap.className = 'vela-lm-inputrow';
        const link = doc.createElement('input');
        link.className = 'vela-lm-input';
        link.type = 'text';
        link.readOnly = true;
        link.placeholder = sharing ? 'Generating link…' : 'Sharing is off';
        link.setAttribute('aria-label', 'Workspace sharing link');
        if (sharing) {
            void this.opts.shareUrl().then((url) => {
                if (this.body === body && this.opts.sharing()) link.value = url;
            });
        }
        const copy = button('Copy link', () => {
            void this.opts.onCopyLink().then((url) => {
                this.note(url ? 'Link copied to the clipboard' : 'Clipboard refused — select the link instead', url ? 'ok' : 'bad');
            });
        }, !sharing);
        linkWrap.append(link, copy);
        body.appendChild(linkWrap);

        const openWrap = doc.createElement('div');
        openWrap.className = 'vela-lm-inputrow';
        const openInput = doc.createElement('input');
        openInput.className = 'vela-lm-input';
        openInput.type = 'text';
        openInput.placeholder = 'Paste a shared link';
        openInput.setAttribute('aria-label', 'Shared link to open');
        openWrap.append(openInput, button('Open link', () => {
            const value = openInput.value.trim();
            if (!value) return this.note('Paste a link first', 'bad');
            void this.opts.onOpenLink(value).then((ok) => {
                this.note(ok ? 'Link opened' : 'That link could not be opened', ok ? 'ok' : 'bad');
            });
        }));
        body.appendChild(openWrap);

        const status = doc.createElement('div');
        status.className = 'vela-lm-status';
        if (this.tone) status.dataset.tone = this.tone;
        status.textContent = this.status || ' ';
        body.appendChild(status);
    }
}
