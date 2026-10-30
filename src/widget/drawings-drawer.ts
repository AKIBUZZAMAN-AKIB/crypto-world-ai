// Drawings drawer (mobile) — the bottom-sheet counterpart of the docked drawing
// toolbar: a search bar, the tool groups as horizontally scrollable tabs, and the
// active group's tools as a touch-sized list with favorite stars. Searching flattens
// every group into one filtered list. Data comes from the same DOM-free toolbar model
// the docked bar paints (`ToolbarDefinition`), so custom `options.drawings` sets and
// plugin-registered types appear here automatically.
//
// FAVOURITES: the star on a row was decoration without a door. A lead tab (★) now lists
// every starred tool across all groups — TradingView's favourites tab — so a trader who
// has pinned four tools never pages through five categories to reach them.
// RECENTS: the same door for the tools you have not committed to yet. A second lead tab
// (a clock) lists the last few tools you drew with, newest first — the star is a promise,
// a habit is not, and the tool you used five minutes ago is the one you want back.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { installSmoothScrolling } from '../ui/scrolling';
import type { ToolbarDefinition, ToolDefinition } from '../core/drawings/toolbar';
import type { DrawingTypeKey } from '../core/drawings/Drawing';

const STYLE_ID = 'vela-widget-drawings-drawer';
const CSS = `
/* Search + tabs stay pinned while the tool list scrolls underneath. */
.vela-drawer.vela-drawings-panel {
    box-sizing:border-box;
    width:100%; height:clamp(min(216px,100%),44%,100%); max-height:100%; margin:0;
    border:0; border-top:1px solid var(--vela-border-strong); border-radius:0; box-shadow:none;
}
@media (min-width:720px) {
    .vela-drawer.vela-drawings-panel { width:100%; max-height:100%; margin:0; border-radius:0; }
}
html.vela-premium .vela-drawer.vela-drawings-panel,
html.vela-premium .vela-drawer.vela-drawings-panel[data-grip-row] {
    border-radius:0; border:0; border-top:1px solid var(--vela-border-strong); box-shadow:none;
}
.vela-drawer.vela-drawings-panel[data-maximized='1'] { height:100% !important; max-height:100% !important; }
.vela-drawings-panel .vela-drawer-top { min-height:40px; padding:0 8px 0 12px; gap:8px; border-bottom:1px solid var(--vela-border); }
.vela-drawings-panel .vela-drawer-title { font-size:14px; font-weight:650; letter-spacing:0; }
.vela-dd-head-action {
    all:unset; box-sizing:border-box; flex:none; width:36px; height:36px; display:inline-flex;
    align-items:center; justify-content:center; border-radius:4px; color:var(--vela-fg-muted); cursor:pointer;
}
.vela-dd-head-action .vela-icon { width:16px; height:16px; }
.vela-dd-head-action:hover { background:var(--vela-hover); color:var(--vela-fg-bright); }
.vela-dd-head-action:focus-visible { outline:2px solid var(--vela-fg-bright); outline-offset:-2px; }
.vela-dd-sticky {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vela-surface);
    padding-top: 2px;
}
.vela-dd-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 0 2px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    color: var(--vela-fg-muted);
    background: var(--vela-surface);
}
.vela-dd-search input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    color: var(--vela-fg-bright);
}
.vela-dd-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    /* The strip scrolls sideways itself — its touches are native scroll, not tab swipes
       (the drawer body is pan-y so everywhere ELSE a sideways move swipes the tabs). */
    touch-action: pan-x;
    padding: 0 2px 8px;
    border-bottom: 1px solid var(--vela-border);
    background: var(--vela-surface);
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
}
.vela-dd-tabs::-webkit-scrollbar { display: none; }
.vela-dd-tab {
    all: unset;
    flex: none;
    min-height: 36px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-tab[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); }
/* The favourites tab is a glyph, not a word: it is a MODE over the same list. */
.vela-dd-tab[data-fav='1'] { padding: 0 10px; }
.vela-dd-tab[data-fav='1'] .vela-icon { font-size: 15px; width: 15px; height: 15px; }
.vela-dd-tab[data-fav='1'][data-active='1'] { color: var(--vela-star, var(--vela-highlight)); }
.vela-dd-list { padding: 6px 0 4px; }
.vela-dd-section {
    padding: 10px 2px 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-dd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-row:active { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] .vela-dd-label { color: var(--vela-accent-ink, var(--vela-accent)); }
.vela-dd-glyph { flex: none; width: 24px; height: 24px; color: var(--vela-fg); }
.vela-dd-glyph svg { width: 24px; height: 24px; }
.vela-dd-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dd-star {
    all: unset;
    flex: none;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-star[data-on='1'] { color: var(--vela-star, var(--vela-highlight)); }
.vela-dd-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
`;

/** The favourites tab's sentinel id — never a real group id. */
const FAV_TAB = '__fav';
/** The recents tab's sentinel id — same trick, a mode over the same list. */
const RECENT_TAB = '__recent';

export interface DrawingsDrawerOptions {
    host: HTMLElement;
    /** Read live at open — the toolbar model (custom sets / late-registered types apply). */
    toolbar: () => ToolbarDefinition;
    currentTool: () => DrawingTypeKey | null;
    isFavorite: (type: DrawingTypeKey) => boolean;
    onFavorite: (type: DrawingTypeKey, on: boolean) => void;
    onSelect: (type: DrawingTypeKey) => void;
    /** Recently used tools, newest first (see `favorites.ts#recentOf`). */
    recent?: () => readonly string[];
    onOpenChange?: (open: boolean) => void;
}

export class DrawingsDrawer {
    private readonly drawer: Drawer;
    private readonly input: HTMLInputElement;
    private readonly tabs: HTMLElement;
    private readonly list: HTMLElement;
    private definition: ToolbarDefinition = { groups: [] };
    private activeGroup = '';

    constructor(private readonly opts: DrawingsDrawerOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        installSmoothScrolling(doc);
        this.drawer = new Drawer({
            host: opts.host,
            title: 'Drawings',
            onOpenChange: opts.onOpenChange,
            // Swiping across the tool list pages through the group tabs.
            onSwipe: (dir) => this.stepGroup(dir === 'left' ? 1 : -1),
        });
        const panel = this.drawer.body.closest<HTMLElement>('.vela-drawer');
        const header = panel?.querySelector<HTMLElement>('.vela-drawer-top');
        if (panel && header) {
            panel.classList.add('vela-drawings-panel');
            const max = doc.createElement('button');
            max.type = 'button';
            max.className = 'vela-dd-head-action vela-dd-max';
            max.setAttribute('aria-label', 'Maximize Drawings panel');
            max.setAttribute('aria-pressed', 'false');
            max.title = 'Maximize';
            max.appendChild(iconEl('maximize', doc));
            let savedHeight = '';
            max.addEventListener('click', (event) => {
                event.stopPropagation();
                const expanded = panel.getAttribute('data-maximized') !== '1';
                if (expanded) savedHeight = panel.style.height;
                panel.dataset.maximized = expanded ? '1' : '0';
                if (!expanded) panel.removeAttribute('data-maximized');
                panel.style.height = expanded ? '100%' : savedHeight;
                panel.style.maxHeight = expanded ? '100%' : '';
                max.setAttribute('aria-pressed', String(expanded));
                max.setAttribute('aria-label', expanded ? 'Restore Drawings panel' : 'Maximize Drawings panel');
                max.title = expanded ? 'Restore' : 'Maximize';
                max.replaceChildren(iconEl(expanded ? 'restore' : 'maximize', doc));
            });
            const close = doc.createElement('button');
            close.type = 'button';
            close.className = 'vela-dd-head-action vela-dd-close';
            close.setAttribute('aria-label', 'Close Drawings panel');
            close.title = 'Close';
            close.appendChild(iconEl('close', doc));
            close.addEventListener('click', (event) => { event.stopPropagation(); this.drawer.hide(); });
            header.append(max, close);
        }

        const sticky = doc.createElement('div');
        sticky.className = 'vela-dd-sticky';

        const search = doc.createElement('div');
        search.className = 'vela-dd-search';
        search.appendChild(iconEl('search', doc));
        this.input = doc.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = 'Search tools…';
        this.input.addEventListener('input', () => this.renderList());
        search.appendChild(this.input);

        this.tabs = doc.createElement('div');
        this.tabs.className = 'vela-dd-tabs';
        sticky.append(search, this.tabs);

        this.list = doc.createElement('div');
        this.list.className = 'vela-dd-list';

        this.drawer.body.append(sticky, this.list);
    }

    open(): void {
        this.definition = this.opts.toolbar();
        if (this.activeGroup !== FAV_TAB && this.activeGroup !== RECENT_TAB && !this.definition.groups.some((g) => g.id === this.activeGroup)) {
            this.activeGroup = this.definition.groups[0]?.id ?? '';
        }
        this.input.value = '';
        this.renderTabs();
        this.renderList();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    /** Move the active group tab by `step` (a horizontal swipe on the list). Search mode
     *  shows the flattened results — no tabs to page through, so the swipe is inert. */
    private stepGroup(step: number): void {
        if (this.input.value.trim()) return;
        const ids = [FAV_TAB, RECENT_TAB, ...this.definition.groups.map((g) => g.id)];
        const next = ids[ids.indexOf(this.activeGroup) + step];
        if (next === undefined) return;
        this.activeGroup = next;
        this.renderTabs();
        this.renderList();
        this.tabs.querySelector('[data-active="1"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    private renderTabs(): void {
        const doc = this.tabs.ownerDocument;
        this.tabs.replaceChildren();
        const fav = doc.createElement('button');
        fav.className = 'vela-dd-tab';
        fav.dataset.fav = '1';
        fav.setAttribute('aria-label', 'Favourites');
        fav.appendChild(iconEl('star', doc));
        if (this.activeGroup === FAV_TAB) {
            fav.dataset.active = '1';
            fav.setAttribute('aria-label', 'Favourites');
            fav.replaceChildren(iconEl('star-filled', doc));
        }
        fav.addEventListener('click', () => {
            this.activeGroup = FAV_TAB;
            this.input.value = '';
            this.renderTabs();
            this.renderList();
        });
        this.tabs.appendChild(fav);

        const recent = doc.createElement('button');
        recent.className = 'vela-dd-tab';
        recent.dataset.fav = '1'; // same glyph-only treatment as the star tab
        recent.setAttribute('aria-label', 'Recent tools');
        recent.appendChild(iconEl('clock', doc));
        if (this.activeGroup === RECENT_TAB) recent.dataset.active = '1';
        recent.addEventListener('click', () => {
            this.activeGroup = RECENT_TAB;
            this.input.value = '';
            this.renderTabs();
            this.renderList();
        });
        this.tabs.appendChild(recent);

        for (const group of this.definition.groups) {
            const tab = doc.createElement('button');
            tab.className = 'vela-dd-tab';
            tab.textContent = group.label;
            if (group.id === this.activeGroup) tab.dataset.active = '1';
            tab.addEventListener('click', () => {
                this.activeGroup = group.id;
                this.input.value = ''; // picking a tab leaves search mode
                this.renderTabs();
                this.renderList();
            });
            this.tabs.appendChild(tab);
        }
    }

    private renderList(): void {
        const doc = this.list.ownerDocument;
        this.list.replaceChildren();
        const query = this.input.value.trim().toLowerCase();
        const active = this.opts.currentTool();

        const section = (label: string): void => {
            const el = doc.createElement('div');
            el.className = 'vela-dd-section';
            el.textContent = label;
            this.list.appendChild(el);
        };
        const row = (tool: ToolDefinition): void => {
            const el = doc.createElement('div');
            el.className = 'vela-dd-row';
            if (tool.type === active) el.dataset.active = '1';
            const glyph = doc.createElement('span');
            glyph.className = 'vela-dd-glyph';
            glyph.innerHTML = tool.icon;
            const label = doc.createElement('span');
            label.className = 'vela-dd-label';
            label.textContent = tool.label;
            const star = doc.createElement('button');
            star.className = 'vela-dd-star';
            const paintStar = (on: boolean): void => {
                star.replaceChildren(iconEl(on ? 'star-filled' : 'star', doc));
                if (on) star.dataset.on = '1';
                else delete star.dataset.on;
            };
            paintStar(this.opts.isFavorite(tool.type));
            star.setAttribute('aria-label', `Favorite ${tool.label}`);
            star.addEventListener('click', (e) => {
                e.stopPropagation(); // the row underneath arms the tool — a star tap must not
                const on = !this.opts.isFavorite(tool.type);
                this.opts.onFavorite(tool.type, on);
                paintStar(on);
                // Unstarring INSIDE the favourites tab removes the row it sits on.
                if (this.activeGroup === FAV_TAB) this.renderList();
            });
            el.append(glyph, label, star);
            el.addEventListener('click', () => {
                this.opts.onSelect(tool.type);
                this.drawer.hide();
            });
            this.list.appendChild(el);
        };

        if (query) {
            // Search flattens every group; group labels become the section headers.
            let any = false;
            for (const group of this.definition.groups) {
                const hits = group.tools.filter((t) => t.label.toLowerCase().includes(query));
                if (hits.length === 0) continue;
                any = true;
                section(group.label);
                for (const tool of hits) row(tool);
            }
            if (!any) {
                const empty = doc.createElement('div');
                empty.className = 'vela-dd-empty';
                empty.textContent = 'No tools match.';
                this.list.appendChild(empty);
            }
            return;
        }

        if (this.activeGroup === FAV_TAB) {
            // Every starred tool, across every group, under its own group's heading —
            // the short list TradingView's favourites tab gives you.
            let any = false;
            for (const g of this.definition.groups) {
                const pinned = g.tools.filter((t) => this.opts.isFavorite(t.type));
                if (pinned.length === 0) continue;
                any = true;
                section(g.label);
                for (const tool of pinned) row(tool);
            }
            if (!any) {
                const empty = doc.createElement('div');
                empty.className = 'vela-dd-empty';
                empty.textContent = 'No favourites yet — tap the star on any tool to pin it here.';
                this.list.appendChild(empty);
            }
            return;
        }

        if (this.activeGroup === RECENT_TAB) {
            // Newest first, resolved through the toolbar model so an id whose plugin type
            // went away simply drops out (and a group heading says where it came from).
            const byType = new Map<string, { tool: ToolDefinition; group: string }>();
            for (const g of this.definition.groups) for (const t of g.tools) byType.set(t.type, { tool: t, group: g.label });
            const used = (this.opts.recent?.() ?? []).map((id) => byType.get(id)).filter((v): v is { tool: ToolDefinition; group: string } => !!v);
            if (used.length === 0) {
                const empty = doc.createElement('div');
                empty.className = 'vela-dd-empty';
                empty.textContent = 'Tools you draw with appear here, newest first.';
                this.list.appendChild(empty);
                return;
            }
            for (const { tool } of used) row(tool);
            return;
        }

        const group = this.definition.groups.find((g) => g.id === this.activeGroup);
        if (!group) return;
        if (group.sections && group.sections.length > 0) {
            for (const s of group.sections) {
                section(s.label);
                for (const tool of s.tools) row(tool);
            }
        } else {
            for (const tool of group.tools) row(tool);
        }
    }
}
