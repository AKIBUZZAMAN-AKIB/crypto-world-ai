// Menu VIEW — projects MenuItemDescriptor[] into a floating list driven by the Zag menu
// machine (keyboard nav, typeahead, dismiss handled by the machine). An item carrying
// `submenu` becomes a trigger row owning a nested machine + list, registered as this
// machine's child: Zag then drives hover intent, arrow-key traversal and the dismiss
// chain across levels instead of the view faking any of it.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { floatingLayerHost } from '../../tokens';
import { iconEl } from '../../icons';
import { announceSurface } from '../../surface-events';
import { warmOnIntent } from '../../warm';
import { holdForExit, type SurfaceExit } from '../../surface-exit';
import { menuController, type MenuControllerOptions, type MenuItemDescriptor } from './controller';
import { MENU_CSS, MENU_STYLE_ID } from './styles';
import * as zagMenu from '@zag-js/menu';

export interface MenuOptions extends MenuControllerOptions {
    /** Element that opens the menu on click (gets the machine's trigger props). */
    trigger?: HTMLElement;
    host?: HTMLElement;
    /** Override the root list's min-width (the stylesheet default suits full-word labels;
     *  compact lists like the timeframe dropdown pass something snug). Submenus keep the
     *  default. */
    minWidth?: string;
    /** Name a programmatically opened menu without claiming another control's trigger. */
    ariaLabel?: string;
    /** Star-toggle reports from items carrying `favorite` (the menu stays open — starring
     *  is a side action on a row, never a selection). */
    onFavorite?: (id: string, on: boolean) => void;
    /** Mark checked items with a leading ✓ instead of the selected-row background wash —
     *  the shape for pointer-anchored action menus (right-click context menus), where a
     *  washed row reads as hover state. A level holding checkable rows reserves the mark
     *  column on all its rows so labels align; an all-action level keeps its natural left
     *  edge. Submenus inherit the mode. Dropdown menus (a trigger button opening a
     *  picker) keep the default wash. */
    checkmarks?: boolean;
    /** Sit each row's icon in a squared badge (a 24px rounded tile with a faint fill and a soft
     *  border) instead of a bare glyph: its glyph brightens on a hovered row, and the tile
     *  inverts on the selected one. A
     *  level where some rows carry an icon reserves the badge column on all its rows so
     *  labels align; a level with no icon keeps its natural left edge. With `checkmarks`,
     *  the mark column leads and the badge follows. Submenus inherit the mode. */
    iconBadges?: boolean;
    /** Optional boundary and appearance for nested lists in a constrained host. */
    submenuPositioning?: Partial<zagMenu.PositioningOptions>;
    submenuClassName?: string;
}

/** Nested lists on a phone cannot rely on a bare right-flip: a 180px branch next to a
 *  180px parent at x=100 has no room on EITHER side, so Floating UI would park the child
 *  at x<0. Fixed strategy + viewport boundary + vertical fallbacks keeps it on screen. */
const SUBMENU_POSITIONING: Partial<zagMenu.PositioningOptions> = {
    strategy: 'fixed',
    flip: ['right-start', 'left-start', 'bottom-start', 'top-start'],
    slide: true,
    overlap: true,
    overflowPadding: 12,
    boundary: () => document.documentElement,
};

interface SurfaceOptions {
    host: HTMLElement;
    placement: MenuControllerOptions['placement'];
    positioning?: Partial<zagMenu.PositioningOptions>;
    onSelect: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
    trigger?: HTMLElement;
    /** A submenu's branch row — announced as its opener (it takes trigger-ITEM props, not `trigger`'s). */
    opener?: HTMLElement;
    triggerId?: string;
    id?: string;
    minWidth?: string;
    ariaLabel?: string;
    onFavorite?: (id: string, on: boolean) => void;
    checkmarks?: boolean;
    iconBadges?: boolean;
    className?: string;
    submenuPositioning?: Partial<zagMenu.PositioningOptions>;
    submenuClassName?: string;
}

/**
 * One menu level: a Zag machine plus the floating list it projects onto. The root menu is a
 * surface and every branch spawns another, so nesting is depth-agnostic. Private — `Menu`
 * is the public face.
 */
class Surface {
    readonly list: HTMLElement;
    readonly handle: HandleOf<typeof zagMenu.machine>;
    /** The floating layer the list rides in — built by the first open (see
     *  {@link ensureMounted}). A closed menu is a machine and a detached list: the twelve a
     *  workspace constructs at boot used to leave twelve positioners in the document. */
    private positioner: HTMLElement | null = null;
    private readonly ctrl: ReturnType<typeof menuController>;
    private readonly mid: string;
    private readonly doc: Document;
    private readonly host: HTMLElement;
    private readonly onSelect: (id: string) => void;
    private readonly onFavorite?: (id: string, on: boolean) => void;
    private readonly checkmarks: boolean;
    private readonly iconBadges: boolean;
    private readonly submenuPositioning: Partial<zagMenu.PositioningOptions>;
    private readonly submenuClassName?: string;
    private items: readonly MenuItemDescriptor[] = [];
    /** Have this level's ROWS been built? A closed menu is a machine and an empty list —
     *  the twelve menus a workspace constructs at boot used to carry 372 rows between
     *  them before anyone had opened one. Rows are built the moment the level opens
     *  (and kept while it is open), so a menu costs its items only when it is used. */
    private built = false;
    /** Is this level open right now? `setItems` must rebuild for an OPEN level even when
     *  nothing has opened it before (a menu whose descriptors arrive with its first open). */
    private openState = false;
    /** Branch item id → the surface it opens. */
    private readonly subs = new Map<string, Surface>();
    /** Trigger rect captured when this level opened — the list stays put if the
     *  trigger then moves (favorite chips shifting the caret). */
    private pinnedAnchor: { x: number; y: number; width: number; height: number } | null = null;
    /** The open state last announced — see {@link announce}. */
    private shown = false;
    /** The list's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private readonly opener: HTMLElement | null;
    /** Detaches the intent warm-up wired to this level's trigger (see {@link armWarm}). */
    private unwarm: (() => void) | null = null;

    constructor(doc: Document, opts: SurfaceOptions) {
        this.doc = doc;
        this.host = opts.host;
        this.onSelect = opts.onSelect;
        this.onFavorite = opts.onFavorite;
        this.checkmarks = opts.checkmarks === true;
        this.iconBadges = opts.iconBadges === true;
        this.submenuPositioning = opts.submenuPositioning ?? SUBMENU_POSITIONING;
        this.submenuClassName = opts.submenuClassName;

        // The list is created here (rows still wait for the first open) but stays DETACHED
        // until a level opens: a menu nobody has opened has no nodes in the page at all.
        this.list = doc.createElement('ul');
        this.list.className = 'vela-menu';
        if (opts.className) this.list.classList.add(opts.className);
        if (opts.minWidth) this.list.style.minWidth = opts.minWidth;

        const trigger = opts.trigger;
        this.opener = trigger ?? opts.opener ?? null;
        this.ctrl = menuController({
            items: [],
            id: opts.id,
            placement: opts.placement,
            positioning: opts.positioning,
            onSelect: (id) => this.onSelect(id),
            getAnchorRect: () => this.pinnedAnchor,
            onOpenChange: (open) => {
                if (open && trigger) {
                    const r = trigger.getBoundingClientRect();
                    this.pinnedAnchor = { x: r.x, y: r.y, width: r.width, height: r.height };
                } else {
                    this.pinnedAnchor = null;
                }
                opts.onOpenChange?.(open);
            },
            triggerId: opts.triggerId,
        });
        this.mid = String(this.ctrl.props.id);
        if (opts.triggerId && trigger) trigger.id = opts.triggerId;
        this.armWarm();
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            // Close announces while the list still shows, open once it does.
            const closing = this.shown && !api.open;
            if (closing) this.announce(false);
            if (api.open && this.exit) {
                this.exit.cancel();
                this.exit = null;
            }
            this.openState = api.open;
            if (trigger) spreadProps(trigger, api.getTriggerProps(), this.mid);
            if (api.open) this.ensureMounted(api);
            if (this.positioner) spreadProps(this.positioner, api.getPositionerProps(), this.mid);
            spreadProps(this.list, api.getContentProps(), this.mid);
            if (opts.ariaLabel) {
                // Without a machine-owned trigger Zag's default labelledby points to an
                // element that does not exist. Keep the menu's explicit name instead.
                this.list.removeAttribute('aria-labelledby');
                this.list.setAttribute('aria-label', opts.ariaLabel);
            }
            // First open builds the rows synchronously, before anything is projected onto
            // them — a closed menu holds no rows at all.
            if (api.open) this.warm();
            this.project(api);
            if (closing) this.holdExit();
            if (api.open && !this.shown) this.announce(true);
        });
    }

    /**
     * Build this level's rows while the pointer is still on its way to the click.
     *
     * Construction used to happen inside `open` — correct for what a page costs at rest
     * (twelve closed menus weighed 372 rows), but it puts the whole list inside the click
     * for a level with a lot of rows. Hovering a trigger for a beat is intent enough: the
     * warm-up builds the SAME rows `open` would have built, just before it needs them, so
     * opening is a projection and nothing else. A pass-through hover builds nothing.
     */
    private armWarm(): void {
        const trigger = this.opener;
        if (!trigger || this.unwarm) return;
        this.unwarm = warmOnIntent(trigger, () => this.warm());
    }

    /** Build this level (and, when `deep`, every branch it owns) without opening it. */
    prewarm(deep = false): void {
        this.warm();
        if (deep) for (const sub of this.subs.values()) sub.prewarm(true);
    }

    /** Build the rows if they are not built yet — idempotent, cheap when already done.
     *  Warming also mounts the layer, so a pre-warmed click opens an element that already
     *  exists (the layer is what `open` positions). */
    private warm(): void {
        this.ensureMounted(this.api);
        if (this.built || this.items.length === 0) return;
        this.built = true;
        this.build();
        this.registerSubs();
    }

    /** Put the layer in the document — once, on the first open (or warm-up). */
    private ensureMounted(api?: zagMenu.Api): void {
        if (this.positioner) return;
        const positioner = this.doc.createElement('div');
        positioner.className = 'vela-ui-layer';
        positioner.appendChild(this.list);
        this.host.appendChild(positioner);
        this.positioner = positioner;
        // The list was projected while detached; the positioner's own props (positioning,
        // hidden) can only land once it exists.
        if (api) spreadProps(positioner, api.getPositionerProps(), this.mid);
    }

    /** Keep the just-closed list up through its exit animation. `spreadProps` re-applies
     *  `hidden` only when the machine's value for it changes, so the list stays shown until
     *  the exit ends — or until a reopen, which projects `hidden: false` itself. */
    private holdExit(): void {
        this.list.hidden = false;
        this.exit = holdForExit(this.list, () => {
            this.exit = null;
            if (!this.shown) this.list.hidden = true;
        });
    }

    get api(): zagMenu.Api {
        return this.ctrl.connect(this.handle.service);
    }

    private announce(open: boolean): void {
        this.shown = open;
        announceSurface(this.list, open, 'menu', this.opener);
    }

    setItems(items: readonly MenuItemDescriptor[]): void {
        this.items = items;
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        if (!this.built && !this.openState) return; // closed and never opened: the descriptors wait for the first open
        this.build();
        this.registerSubs();
    }

    /** Wire the freshly built branch surfaces into the machine (queued sends, then a
     *  re-project once the queue has drained). */
    private registerSubs(): void {
        const api = this.api;
        for (const sub of this.subs.values()) {
            api.setChild(sub.handle.service);
            sub.api.setParent(this.handle.service);
        }
        this.handle.flush();
        // Those two are queued sends: a child only learns it IS a submenu on the next
        // microtask, and a branch row's props (hover intent, the trigger-item part) are
        // derived from that. Re-project once the queue has drained.
        if (this.subs.size > 0) queueMicrotask(() => this.handle.flush());
    }

    destroy(): void {
        this.unwarm?.();
        this.unwarm = null;
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        this.exit?.finish();
        this.handle.stop();
        // Torn down while open: the stopped machine never projects the close.
        if (this.shown) this.announce(false);
        this.positioner?.remove();
        this.positioner = null;
    }

    private byId(id: string): MenuItemDescriptor | undefined {
        return this.items.find((i) => i.id === id);
    }

    /** Push the machine's item props onto the rendered rows. A branch takes the submenu
     *  trigger props, which carry the child's ids and hover handlers; a leaf takes plain ones. */
    private project(api: zagMenu.Api): void {
        for (const li of this.list.children) {
            const id = (li as HTMLElement).dataset.veiId;
            if (!id) continue;
            const sub = this.subs.get(id);
            if (sub) {
                const props = api.getTriggerItemProps(sub.api);
                const pointerDown = props.onPointerDown;
                // Zag's submenu trigger prevents every pointerdown. On iOS/WebKit that
                // suppresses the subsequent touch click, so Labels/Levels never open.
                // Preserve its mouse/pen behavior, but let a touch generate the normal
                // click (and keep native scrolling/drag cancellation) for the machine.
                spreadProps(li as HTMLElement, {
                    ...props,
                    onPointerDown: (event: PointerEvent) => {
                        if (event.pointerType !== 'touch') pointerDown?.(event);
                    },
                }, this.mid);
                continue;
            }
            const item = this.byId(id);
            // Switch rows keep the menu OPEN on selection — flip, see, flip again.
            spreadProps(li as HTMLElement, api.getItemProps({ value: id, disabled: item?.disabled, closeOnSelect: item?.toggle ? false : undefined }), this.mid);
            if (item?.checkRole && item.checked !== undefined) {
                li.setAttribute('role', item.checkRole);
                li.setAttribute('aria-checked', String(item.checked));
            }
        }
    }

    private build(): void {
        const doc = this.doc;
        this.list.replaceChildren();
        // Reserve the leading mark column only when THIS level actually holds checkable
        // rows — an all-action list (e.g. the chart-body context menu) keeps its natural
        // left edge instead of carrying an empty gutter.
        const markable = this.checkmarks
            && this.items.some((i) => !(i.submenu && i.submenu.length > 0) && !i.toggle && i.checked !== undefined);
        // Same for icons: once a row of this level carries one, the others keep an empty
        // icon slot (an empty badge in badge mode) so every label shares one left edge.
        const iconic = this.items.some((i) => !!i.icon);
        const badged = this.iconBadges && iconic;
        if (badged) this.list.dataset.badges = '1';
        else delete this.list.dataset.badges;
        for (const item of this.items) {
            if (item.separatorBefore) {
                const sep = doc.createElement('li');
                sep.className = 'vela-menu-sep';
                sep.setAttribute('role', 'separator');
                this.list.appendChild(sep);
            }
            const branch = item.submenu !== undefined && item.submenu.length > 0;
            const li = doc.createElement('li');
            li.className = 'vela-menu-item';
            li.dataset.veiId = item.id;
            if (item.toggle) {
                // Switch row: the pill carries the state.
                // (Zag owns the item's ARIA props; the pill below is decorative.)
                li.dataset.toggle = '1';
            }
            if (markable) {
                // Mark mode: a leading ✓ slot on every row of this level (empty when
                // unchecked, so labels share a left edge); the row surface stays free
                // for hover.
                const mark = doc.createElement('span');
                mark.className = 'vela-menu-mark';
                if (!branch && !item.toggle && item.checked) {
                    mark.appendChild(iconEl('check', doc));
                    li.dataset.checkmark = '1';
                }
                li.appendChild(mark);
            } else if (!branch && !item.toggle && item.checked) {
                // Selection reads from the row surface: a stronger background wash
                // marks the active entry (hover stays the lighter wash).
                li.dataset.checked = '1';
            }
            if (badged) {
                const badge = doc.createElement('span');
                badge.className = 'vela-menu-badge';
                if (item.icon) badge.appendChild(iconEl(item.icon, doc));
                li.appendChild(badge);
            } else if (item.icon) {
                li.appendChild(iconEl(item.icon, doc));
            } else if (iconic) {
                li.appendChild(iconEl('', doc));
            }
            const label = doc.createElement('span');
            label.className = 'vela-menu-label';
            label.textContent = item.label;
            li.appendChild(label);
            if (item.hint) {
                const hint = doc.createElement('span');
                hint.className = 'vela-menu-hint';
                hint.textContent = item.hint;
                li.appendChild(hint);
            }
            if (item.favorite !== undefined && this.onFavorite) {
                const on = item.favorite;
                const star = iconEl(on ? 'star-filled' : 'star', doc);
                star.classList.add('vela-menu-star');
                if (on) star.classList.add('vela-fav');
                star.removeAttribute('aria-hidden'); // iconEl hides decorative icons; this one is a control
                star.setAttribute('role', 'button');
                star.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
                star.setAttribute('aria-pressed', on ? 'true' : 'false');
                // Swallow the whole pointer sequence: the machine selects rows on click,
                // and a press that starts on the star must never reach the row.
                for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
                    star.addEventListener(ev, (e) => e.stopPropagation());
                }
                star.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.onFavorite?.(item.id, !on);
                });
                li.appendChild(star);
            }
            if (item.toggle) {
                const sw = doc.createElement('span');
                sw.className = 'vela-menu-switch' + (item.checked ? ' on' : '');
                sw.setAttribute('aria-hidden', 'true');
                li.appendChild(sw);
            }
            if (branch) {
                li.dataset.branch = '1';
                const arrow = iconEl('chevron-right', doc);
                arrow.classList.add('vela-menu-arrow');
                li.appendChild(arrow);
                const sub = new Surface(doc, {
                    host: this.host,
                    placement: 'right-start',
                    positioning: this.submenuPositioning,
                    submenuPositioning: this.submenuPositioning,
                    submenuClassName: this.submenuClassName,
                    className: this.submenuClassName,
                    opener: li,
                    onSelect: this.onSelect,
                    onFavorite: this.onFavorite,
                    checkmarks: this.checkmarks,
                    iconBadges: this.iconBadges,
                    id: `${this.mid}--${item.id}`,
                });
                sub.setItems(item.submenu ?? []);
                this.subs.set(item.id, sub);
                // WebKit can suppress click entirely on a touched, non-native <li>
                // submenu trigger (even with role=menuitem). Let the ordinary click win;
                // if none arrives, synthesize one only for a stationary completed touch.
                // A later native click for that same touch is swallowed, but a NEW tap
                // resets the guard, so fast deliberate repeat taps still work.
                type TouchContact = { id: number; x: number; y: number; moved: boolean; clicked: boolean };
                let contact: TouchContact | null = null;
                let pending: TouchContact | null = null;
                let ignoreLateClick = false;
                li.addEventListener('pointerdown', (event) => {
                    if (event.pointerType !== 'touch') return;
                    ignoreLateClick = false;
                    contact = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, clicked: false };
                });
                li.addEventListener('pointermove', (event) => {
                    if (contact?.id === event.pointerId && Math.hypot(event.clientX - contact.x, event.clientY - contact.y) > 10) contact.moved = true;
                });
                li.addEventListener('pointercancel', (event) => { if (contact?.id === event.pointerId) contact = null; });
                li.addEventListener('click', (event) => {
                    if (ignoreLateClick && event.isTrusted) {
                        event.preventDefault(); event.stopImmediatePropagation(); ignoreLateClick = false;
                    } else if (pending) pending.clicked = true;
                }, true);
                li.addEventListener('pointerup', (event) => {
                    if (!contact || contact.id !== event.pointerId) return;
                    const touch = contact;
                    contact = null;
                    if (touch.moved) return;
                    pending = touch;
                    this.doc.defaultView?.setTimeout(() => {
                        if (pending === touch) pending = null;
                        if (touch.clicked || !li.isConnected || !this.openState) return;
                        ignoreLateClick = true;
                        li.click();
                        this.doc.defaultView?.setTimeout(() => { ignoreLateClick = false; }, 500);
                    }, 48);
                });
            }
            this.list.appendChild(li);
        }
    }
}

export class Menu {
    private readonly root: Surface;

    constructor(opts: MenuOptions) {
        const anchor = opts.trigger ?? opts.host ?? document.body;
        const doc = anchor.ownerDocument;
        injectStyles(MENU_STYLE_ID, MENU_CSS, doc);
        const host = floatingLayerHost(opts.host ?? anchor, doc.body);
        this.root = new Surface(doc, {
            host,
            placement: opts.placement,
            positioning: opts.positioning,
            onSelect: (id) => opts.onSelect?.(id),
            onOpenChange: opts.onOpenChange,
            trigger: opts.trigger,
            triggerId: opts.triggerId,
            id: opts.id,
            minWidth: opts.minWidth,
            ariaLabel: opts.ariaLabel,
            onFavorite: opts.onFavorite,
            checkmarks: opts.checkmarks,
            iconBadges: opts.iconBadges,
            submenuPositioning: opts.submenuPositioning,
            submenuClassName: opts.submenuClassName,
        });
        this.root.setItems(opts.items);
    }

    get api(): zagMenu.Api {
        return this.root.api;
    }

    /** The root list, for named or size-constrained menus without a dedicated trigger. */
    get element(): HTMLElement {
        return this.root.list;
    }

    open(): void {
        // Rows first: an open that has to build paints its first frame empty, and code that
        // opens a menu and then reads it (context menus, tests) expects the rows to exist.
        this.root.prewarm();
        this.api.setOpen(true);
    }

    /** Open anchored to a viewport point (context menus). */
    openAt(clientX: number, clientY: number): void {
        this.openAtRect({ x: clientX, y: clientY, width: 0, height: 0 });
    }

    /** Open against an existing control without assigning its click to this menu. */
    openAtRect(rect: { x: number; y: number; width: number; height: number }): void {
        this.root.prewarm();
        const api = this.api;
        api.setOpen(true);
        api.reposition({ getAnchorRect: () => rect });
    }

    close(): void {
        this.api.setOpen(false);
    }

    /**
     * Build the rows now, without opening: what hovering a trigger does after a beat.
     * `deep` also builds the menu's submenus (their rows are usually built when the
     * branch opens — there is a whole hover and a click of lead time).
     */
    prewarm(deep = false): void {
        this.root.prewarm(deep);
    }

    /** Swap the item descriptors (e.g. checked states) and re-project. */
    setItems(items: readonly MenuItemDescriptor[]): void {
        this.root.setItems(items);
    }

    destroy(): void {
        this.root.destroy();
    }
}
