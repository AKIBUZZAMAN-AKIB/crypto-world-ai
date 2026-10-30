// Dialog VIEW — backdrop + centered panel with header/body, driven by the Zag dialog
// machine. The body is caller-owned: pass a Node or populate via `body` after creation.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { closeOpenPopovers, eventDismissedPopover, isPopoverOpen } from '../popover';
import { dialogController, type DialogControllerOptions } from './controller';
import { DIALOG_CSS, DIALOG_STYLE_ID } from './styles';
import * as zagDialog from '@zag-js/dialog';
import { announceSurface } from '../../surface-events';
import { holdForExit, type SurfaceExit } from '../../surface-exit';
import { linkPanelResizeGrip, makePanelDraggable, panelResizeGrip, type PanelDrag } from '../../panel-drag';

export interface DialogOptions extends DialogControllerOptions {
    title?: string;
    /** R87 premium header: a small uppercase eyebrow above the title. */
    kicker?: string;
    /** R87 premium header: a registered icon name for the accent tile beside the title. */
    headerIcon?: string;
    content?: Node | ((body: HTMLElement) => void);
    host?: HTMLElement;
    /** Drag by the header. Defaults to true; pass false for a deliberately fixed dialog. */
    draggable?: boolean;
    /** Reveal focused controls in the visual viewport while the card is moved. */
    revealFocus?: boolean;
    /** Keep the full card inside its boundary while dragging or resizing. */
    keepWithinBounds?: boolean;
    /** Show the separate height grip on a draggable dialog (default true). */
    resizable?: boolean;
    /** Add a direct two-axis resize button immediately after Close. */
    cornerResizable?: boolean;
    /** Darken the page behind the dialog (default false — the chart stays readable while
     *  dialogs edit live content). Pass true for a dimming scrim; the backdrop still
     *  catches interact-outside dismissal either way. */
    dimBackdrop?: boolean;
    /** Vertical placement of the card. Default `top` (current 10vh pad). */
    align?: 'top' | 'center';
    /** Pin the overlay to `host` (absolute) instead of the viewport (fixed). */
    contained?: boolean;
    /** Footer pinned below the scrollable body. */
    footer?: Node | ((el: HTMLElement) => void);
    /** Extra nodes before the title (e.g. a mobile section burger). */
    headerStart?: Node;
    /** Skip default body padding — the caller owns the body layout. */
    flush?: boolean;
    /** Extra class on the panel. */
    className?: string;
    /** Close when the backdrop itself is pressed (not when a portaled popover is). */
    closeOnBackdrop?: boolean;
}

export class Dialog {
    /** Caller-owned content area — append your form/panel here. */
    readonly body: HTMLElement;
    readonly panel: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly positioner: HTMLElement;
    readonly backdrop: HTMLElement;
    readonly footer: HTMLElement | null;
    private readonly handle: HandleOf<typeof zagDialog.machine>;
    private readonly ctrl: ReturnType<typeof dialogController>;
    private readonly drag: PanelDrag | null;

    constructor(opts: DialogOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(DIALOG_STYLE_ID, DIALOG_CSS, doc);
        const host = opts.host ?? doc.body;

        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'vela-dialog-backdrop vela-ui-layer';
        if (opts.dimBackdrop !== true) this.backdrop.classList.add('vela-dialog-backdrop--clear');
        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-dialog-positioner vela-ui-layer';
        if (opts.contained) {
            this.backdrop.dataset.contained = '';
            this.positioner.dataset.contained = '';
        }
        this.positioner.dataset.align = opts.align ?? 'top';
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-dialog';
        if (opts.className) {
            for (const cls of opts.className.split(/\s+/)) if (cls) this.panel.classList.add(cls);
        }
        // Programmatically focusable — the mobile chrome routes the machine's initial
        // focus here (see the controller wiring below).
        this.panel.tabIndex = -1;
        this.panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
        });

        const header = doc.createElement('div');
        header.className = 'vela-dialog-header';
        // Movement and resizing are independent; callers can retain header dragging
        // without exposing a height control on a particular dialog.
        const resizeGrip = opts.draggable !== false && opts.resizable !== false ? panelResizeGrip(doc, opts.title ?? 'dialog') : null;
        const cornerResize = opts.draggable !== false && opts.cornerResizable ? doc.createElement('button') : null;
        if (cornerResize) {
            cornerResize.type = 'button';
            cornerResize.className = 'vela-dialog-corner-resize';
            cornerResize.setAttribute('aria-label', `Resize ${opts.title ?? 'dialog'} panel`);
            cornerResize.setAttribute('aria-description', 'Drag to resize; use arrow keys to adjust size.');
            cornerResize.title = 'Drag to resize · use arrow keys';
            cornerResize.appendChild(iconEl('pane-expand', doc));
            linkPanelResizeGrip(cornerResize, this.panel);
        }
        if (opts.draggable !== false) {
            header.style.cursor = 'grab';
            header.style.touchAction = 'none';
            header.tabIndex = 0;
            header.setAttribute('aria-label', `Move ${opts.title ?? 'dialog'}`);
            this.drag = makePanelDraggable(this.panel, {
                handle: '.vela-dialog-header',
                resizeHandle: resizeGrip ? '.vela-size-grip' : undefined,
                cornerResizeHandle: cornerResize ? '.vela-dialog-corner-resize' : undefined,
                boundary: () => this.positioner.getBoundingClientRect(),
                keepWithinBounds: opts.keepWithinBounds,
                revealFocus: () => opts.revealFocus ?? !!this.positioner.closest('[data-layout="desktop"]'),
            });
        } else {
            this.drag = null;
        }
        if (opts.headerStart) header.appendChild(opts.headerStart);
        // R87: an accent icon tile + eyebrow + title = one premium header vocabulary
        // shared by every dialog-based panel. Both additions are opt-in and pure chrome.
        if (opts.headerIcon) {
            const mark = doc.createElement('span');
            mark.className = 'vela-prem-tile';
            mark.appendChild(iconEl(opts.headerIcon, doc));
            header.appendChild(mark);
        }
        const titleWrap = doc.createElement('div');
        titleWrap.className = 'vela-dialog-titlewrap';
        if (opts.kicker) {
            const kicker = doc.createElement('span');
            kicker.className = 'vela-dialog-kicker';
            kicker.textContent = opts.kicker;
            titleWrap.appendChild(kicker);
        }
        const title = doc.createElement('div');
        title.className = 'vela-dialog-title';
        title.textContent = opts.title ?? '';
        this.titleEl = title;
        titleWrap.appendChild(title);
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'vela-dialog-close';
        close.setAttribute('aria-label', 'Close');
        close.appendChild(iconEl('close', doc));
        header.append(titleWrap, ...(resizeGrip ? [resizeGrip] : []), close, ...(cornerResize ? [cornerResize] : []));

        this.body = doc.createElement('div');
        this.body.className = 'vela-dialog-body';
        if (opts.flush) this.body.dataset.flush = '';
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        this.panel.append(header, this.body);
        if (opts.footer) {
            const foot = doc.createElement('div');
            foot.className = 'vela-dialog-footer';
            if (opts.footer instanceof Node) foot.appendChild(opts.footer);
            else opts.footer(foot);
            this.panel.appendChild(foot);
            this.footer = foot;
        } else {
            this.footer = null;
        }
        this.positioner.appendChild(this.panel);
        // NOT attached here: a dialog that has never been opened must cost the page
        // nothing. `show()` mounts the pair (see `mounted`).
        this.hostEl = host;
        if (opts.closeOnBackdrop) {
            const closeOn = (e: Event): void => {
                if (e.target !== this.backdrop && e.target !== this.positioner) return;
                // A portaled popover (color picker, select list) is logically INSIDE the
                // dialog: the first outside click dismisses it, not the dialog itself.
                if (isPopoverOpen() || eventDismissedPopover(e)) {
                    closeOpenPopovers();
                    return;
                }
                this.hide();
            };
            this.backdrop.addEventListener('pointerdown', closeOn);
            this.positioner.addEventListener('pointerdown', closeOn);
        }

        this.ctrl = dialogController({
            ...opts,
            // Mobile chrome (fullscreen presentation): opening must never land focus on
            // an input — that pops the on-screen keyboard over the just-opened dialog.
            // Focus goes to the panel; a caller that WANTS the keyboard focuses its
            // input explicitly. Desktop keeps the caller's pick, else the machine's
            // first-tabbable default.
            initialFocusEl: () => {
                if (this.positioner.closest('[data-layout="mobile"]')) return this.panel;
                return opts.initialFocusEl?.() ?? null;
            },
        });
        const mid = String(this.ctrl.props.id);
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            // Close announces while the panel still shows (before the close props land), open once it does.
            const closing = this.wasOpen && !api.open;
            if (closing) {
                this.announce(false);
            }
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            if (cornerResize) linkPanelResizeGrip(cornerResize, this.panel);
            spreadProps(title, api.getTitleProps(), mid);
            spreadProps(close, api.getCloseTriggerProps(), mid);
            // Zag's close-trigger props do not name the icon-only button.
            close.setAttribute('aria-label', 'Close');
            // Zag dialogs expect CONDITIONAL rendering (their `hidden` reaches the panel and
            // backdrop only, and the panel's authored display beats it) — the view toggles
            // visibility from `api.open` itself, once the exit animation of a close has run.
            if (api.open) {
                this.exit?.cancel();
                this.exit = null;
                this.setShown(true);
            } else if (closing) {
                this.holdExit();
            } else if (!this.exit) {
                this.setShown(false);
            }
            if (api.open && !this.wasOpen) this.announce(true);
            if (this.wasOpen && !api.open) this.restoreOpener();
            this.wasOpen = api.open;
        });
    }

    /** The layer the scrim + panel mount into, remembered until the first open. */
    private readonly hostEl!: HTMLElement;
    /** Mounted into the document? A closed, never-opened dialog is a detached tree. */
    private mounted = false;
    private opener: HTMLElement | null = null;
    private wasOpen = false;
    /** The panel and scrim's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private destroyed = false;

    private setShown(shown: boolean): void {
        this.backdrop.style.display = shown ? '' : 'none';
        this.positioner.style.display = shown ? '' : 'none';
    }

    /** Keep the just-closed dialog up through its exit animation, then hide it — or
     *  remove it, when it was destroyed meanwhile. `spreadProps` re-applies the close
     *  props' `hidden` only when its value changes, so lifting it keeps the panel and
     *  scrim up until the exit ends. The positioner spans the viewport: inert, it lets
     *  clicks through to the page while the panel animates out. */
    private holdExit(): void {
        const held = [this.panel, this.backdrop];
        for (const el of held) el.hidden = false;
        this.exit = holdForExit(
            held,
            () => {
                this.exit = null;
                if (this.destroyed) {
                    this.detach();
                } else if (!this.open) {
                    for (const el of held) el.hidden = true;
                    this.setShown(false);
                }
            },
            { inert: [this.positioner] },
        );
    }

    private detach(): void {
        this.backdrop.remove();
        this.positioner.remove();
    }

    /** Closing hands focus back to whatever opened it (Escape, the ✕, hide(), or a
     *  teardown that outruns the machine's close notification). */
    private restoreOpener(): void {
        const opener = this.opener;
        this.opener = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    private announce(open: boolean): void {
        const opener = this.opener === this.panel.ownerDocument.body ? null : this.opener;
        announceSurface(this.panel, open, 'dialog', opener);
    }

    get open(): boolean {
        return this.ctrl.connect(this.handle.service).open;
    }

    show(): void {
        if (!this.open) this.drag?.reset();
        if (!this.mounted) {
            this.mounted = true;
            this.hostEl.append(this.backdrop, this.positioner);
        }
        this.opener = this.panel.ownerDocument.activeElement as HTMLElement | null;
        this.ctrl.connect(this.handle.service).setOpen(true);
    }

    hide(): void {
        this.ctrl.connect(this.handle.service).setOpen(false);
    }

    /** Re-clamp a moved dialog after a caller changes its viewport constraints. */
    reflow(): void { this.drag?.reflow(); }

    contains(node: Node | null): boolean {
        if (node == null) return false;
        if (this.panel.contains(node) || this.backdrop.contains(node) || this.positioner.contains(node)) return true;
        const el = node instanceof Element ? node : node.parentElement;
        // Portaled select lists / color chips / menus live on the document, not in the panel.
        return el?.closest('.vela-popover, .vela-menu') != null;
    }

    destroy(): void {
        this.drag?.destroy();
        // Closed but not projected yet — an owner disposing of the dialog as it reports
        // closing: project the close now, so it animates out like any other close and
        // leaves the DOM when its exit ends. A teardown while open leaves at once.
        if (this.wasOpen && !this.open) this.handle.flush();
        // Exit the open state before stopping so the machine unwinds its open-time
        // effects (focus restore, and the body pointer-events lock of modal dialogs)
        // instead of leaving them behind.
        if (this.open) this.hide();
        this.handle.stop();
        this.destroyed = true;
        // Torn down while open: the stopped machine never projects the close.
        if (this.wasOpen) {
            this.wasOpen = false;
            this.announce(false);
        }
        this.restoreOpener();
        if (!this.exit) this.detach();
    }
}
