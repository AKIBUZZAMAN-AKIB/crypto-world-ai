// A non-modal workspace tool hosted by the shared dock. The caller owns its content;
// PanelDock owns the normal SidePanel callbacks and the panel retains its own lifecycle.
import { SidePanel, MIN_FLOAT_PANEL_WIDTH } from './side-panel';

let toolPanelSequence = 0;

export class WorkspaceToolPanel extends SidePanel {
    onVisibilityChange: ((open: boolean, userOpening: boolean) => void) | null = null;
    private userOpening = false;
    private returnFocus: HTMLElement | null = null;

    constructor(host: HTMLElement, title: string, modifier: string, width = 360) {
        super(host, title, modifier, {
            resizable: true, width, minWidth: MIN_FLOAT_PANEL_WIDTH, maxWidth: 720,
            standardPane: true, mobileMinHeight: 216,
        });
        this.el.id = `vela-tool-panel-${++toolPanelSequence}`;
        this.el.setAttribute('role', 'region');
        this.el.setAttribute('aria-label', title);
        this.el.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            this.toggle(false);
        });
    }

    override setTitle(title: string): void {
        super.setTitle(title);
        this.el.setAttribute('aria-label', title);
    }

    /** An explicit door may take focus; a restored panel must not steal it at startup. */
    showFrom(trigger: Element | null = this.el.ownerDocument.activeElement): void {
        if (trigger && !this.el.contains(trigger) && typeof (trigger as HTMLElement).focus === 'function') {
            this.returnFocus = trigger as HTMLElement;
        }
        this.userOpening = true;
        try { this.toggle(true); } finally { this.userOpening = false; }
    }

    override toggle(open = !this.open, instant = false): void {
        const before = this.open;
        const returnFocus = !open && before && this.el.contains(this.el.ownerDocument.activeElement) ? this.returnFocus : null;
        super.toggle(open, instant);
        if (before === this.open) return;
        this.onVisibilityChange?.(this.open, this.userOpening);
        if (!this.open && returnFocus?.isConnected && !returnFocus.closest('[hidden], [inert]')) {
            returnFocus.focus({ preventScroll: true });
        }
    }
}
