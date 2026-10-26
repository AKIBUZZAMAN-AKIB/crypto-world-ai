// The TEMPLATES MENU — TradingView's "Indicator templates" dropdown, sitting beside the
// Indicators button in the top toolbar, which is exactly where TV puts it.
//
// Research that fixes the shape (TradingView's own "What are indicator templates" guide,
// the charting-library docs, and the walkthroughs):
//   • a template is a SET OF INDICATORS with their exact settings — not a layout: no
//     drawings, and the symbol/timeframe only when the trader asks for them ("Remember
//     interval" is TV's opt-in checkbox, the one the guides keep circling back to);
//   • clicking a template APPLIES it and replaces the chart's current indicator set —
//     templates never stack;
//   • the menu also carries "Save indicator template…", per-row management (rename,
//     export, delete) and, on a multi-chart layout, "Apply to all charts";
//   • "Set as default" makes the template the set a NEW chart opens with (TV hangs that
//     off the template name; here it is the row's star, the same control the mobile
//     drawer and the layout picker already use).
//
// Vela already owned the store and every verb (VelaWorkspace.saveTemplate / applyTemplate /
// renameTemplate / deleteTemplate / setDefaultTemplate / export·importTemplate). What was
// missing was the DOOR: the picker's template pane and the phone drawer's row were the only
// ways in, so this menu is chrome over the same contract, not a second implementation.
import { Popover } from '../ui/components/popover';
import { downloadText } from '../ui/download';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';

export const TEMPLATES_MENU_STYLE_ID = 'vela-templates-menu';

export const TEMPLATES_MENU_CSS = `
.vela-tm {
    width: 304px;
    max-height: min(72vh, 560px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    box-sizing: border-box;
    color: var(--vela-fg);
    font-size: 13px;
    /* The popover shell is a transparent positioner: the panel owns its surface, edge
       and lift, or the chart reads straight through the menu. */
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border-strong);
    border-radius: 12px;
    box-shadow: var(--vela-shadow-dialog);
}
.vela-tm-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 6px; }
.vela-tm-mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent);
    font-size: 16px;
}
.vela-tm-headid { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-tm-title {
    font-size: 14px;
    font-weight: 650;
    color: var(--vela-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-sub {
    font-size: 11.5px;
    color: var(--vela-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-sub[data-house='1'] { color: var(--vela-accent); font-weight: 550; }
/* The list is one focusable group: rows are buttons, so a keyboard user tabs the set. */
.vela-tm-list { display: flex; flex-direction: column; gap: 1px; }
.vela-tm-row {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
}
.vela-tm-row:hover { background: var(--vela-hover); }
.vela-tm-row:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-tm-row[data-current='1'] { background: var(--vela-hover-strong); }
.vela-tm-glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent);
    font-size: 13px;
}
.vela-tm-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-tm-name {
    font-size: 13px;
    font-weight: 550;
    color: var(--vela-fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-meta {
    font-size: 11px;
    color: var(--vela-fg-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vela-tm-badge {
    flex: none;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--vela-hover-strong);
    color: var(--vela-accent);
}
.vela-tm-ico {
    all: unset;
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    font-size: 14px;
}
.vela-tm-ico:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-tm-ico[data-on='1'] { color: var(--vela-star, var(--vela-accent)); }
.vela-tm-ico:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
/* The kebab strip: TV hides per-template verbs behind the row's context menu; a second
   tap on the same row is the same information with a visible target. */
.vela-tm-strip { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 8px 8px 40px; }
.vela-tm-chip {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--vela-border);
    background: var(--vela-surface);
    color: var(--vela-fg);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
}
.vela-tm-chip:hover { background: var(--vela-hover); }
.vela-tm-chip:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: 1px; }
.vela-tm-chip[data-danger='1'] { color: var(--vela-down, #e5484d); border-color: var(--vela-down, #e5484d); } /* palette-exempt: var() fallback for a menu portalled outside the token scope */
.vela-tm-sep { height: 1px; margin: 5px 6px; background: var(--vela-border); }
.vela-tm-group {
    margin: 8px 0 2px;
    padding: 0 8px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-tm-glyph--builtin { background: transparent; border: 1px solid var(--vela-border-strong); color: var(--vela-fg-muted); }
.vela-tm-empty {
    padding: 4px 10px 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--vela-fg-muted);
}
.vela-tm-form { display: flex; flex-direction: column; gap: 6px; padding: 4px 8px 8px; }
.vela-tm-input {
    box-sizing: border-box;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 7px;
    background: var(--vela-surface);
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 12.5px;
}
.vela-tm-input:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -1px; }
.vela-tm-check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-tm-check input { margin: 0; accent-color: var(--vela-accent); }
.vela-tm-formrow { display: flex; gap: 6px; }
.vela-tm-formrow .vela-tm-input { flex: 1 1 auto; min-width: 0; }
.vela-tm-primary {
    all: unset;
    box-sizing: border-box;
    flex: none;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 12.5px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
}
.vela-tm-primary:hover { filter: brightness(1.07); }
.vela-tm-primary:focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: 2px; }
.vela-tm-act {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--vela-fg);
    font-size: 12.5px;
    cursor: pointer;
}
.vela-tm-act:hover { background: var(--vela-hover); }
.vela-tm-act:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-tm-act .vela-icon { font-size: 14px; color: var(--vela-fg-muted); }
.vela-tm-flash {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 16px;
    margin: 2px 8px 4px;
    font-size: 11.5px;
    color: var(--vela-fg-muted);
}
.vela-tm-flash[data-tone='ok'] { color: var(--vela-up); }
.vela-tm-flash[data-tone='bad'] { color: var(--vela-down, #e5484d); } /* palette-exempt: var() fallback for a menu portalled outside the token scope */
`;

/** One saved template, as the menu lists it. */
export interface TemplatesMenuRow {
    name: string;
    count: number;
    /** Present only when the template was saved with "remember the market". */
    symbol?: string;
    timeframe?: string;
}

export interface TemplatesMenuOptions {
    /** The saved templates, read fresh on every open (and after every verb). */
    templates: () => TemplatesMenuRow[];
    /** Apply: `'all'` is TV's "Apply to all charts". Returns how many charts changed. */
    onApply?: (name: string, target: 'active' | 'all') => number;
    onSave?: (name: string, includeMarket: boolean) => boolean;
    onDelete?: (name: string) => void;
    onRename?: (from: string, to: string) => boolean;
    onExport?: (name: string) => string | null;
    onImport?: (json: string) => string | null;
    /** The template new charts start from (the row star). */
    defaultTemplate?: () => string | null;
    onSetDefault?: (name: string | null) => void;
    /** How many charts the layout has — gates "Apply to all charts". */
    chartCount?: () => number;
    /** TradingView's six read-only built-ins, listed under the saved templates. Applying
     *  one always REPLACES the chart's indicators — the same contract as a saved one. */
    builtins?: () => Array<{ id: string; name: string; description: string; count: number }>;
    onApplyBuiltin?: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export class TemplatesMenu {
    private readonly opts: TemplatesMenuOptions;
    private doc: Document;
    private popover: Popover | null = null;
    private panel: HTMLElement | null = null;
    private trigger: HTMLElement | null = null;
    /** Row whose verb strip is unfolded (one at a time). */
    private openRow: string | null = null;
    /** Delete armed for this row — the two-tap convention the rest of the chrome uses. */
    private armed: string | null = null;
    /** Row being renamed in place, and the text in its field (kept after a refusal). */
    private renaming: string | null = null;
    private renameDraft: string | null = null;
    /** The save form is unfolded. */
    private saving = false;
    /** Inline feedback, cleared on the next render. */
    private flash: { text: string; tone?: 'ok' | 'bad' } | null = null;

    constructor(opts: TemplatesMenuOptions) {
        this.opts = opts;
        this.doc = document;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
    }

    get isOpen(): boolean {
        return this.popover?.open === true;
    }

    /** Open under the button (or toggle it shut). */
    open(trigger: HTMLElement): void {
        if (this.popover?.open) {
            this.popover.hide();
            return;
        }
        this.trigger = trigger;
        this.doc = trigger.ownerDocument;
        injectStyles(TEMPLATES_MENU_STYLE_ID, TEMPLATES_MENU_CSS, this.doc);
        this.openRow = null;
        this.armed = null;
        this.renaming = null;
        this.saving = false;
        this.flash = null;
        const popover = new Popover({
            trigger,
            className: 'vela-tm-pop',
            gap: 6,
            align: 'start',
            content: (body) => {
                this.panel = body;
                body.setAttribute('role', 'dialog');
                body.setAttribute('aria-label', 'Chart templates');
                this.render();
            },
            onClose: () => {
                this.popover = null;
                this.panel = null;
                this.openRow = null;
                this.armed = null;
                this.renaming = null;
                this.saving = false;
                this.opts.onOpenChange?.(false);
                this.trigger?.focus({ preventScroll: true });
            },
        });
        this.popover = popover;
        popover.show();
        this.opts.onOpenChange?.(true);
        setTimeout(() => {
            this.panel?.querySelector<HTMLElement>('.vela-tm-row, .vela-tm-primary')?.focus({ preventScroll: true });
        }, 0);
    }

    close(): void {
        this.popover?.hide();
    }

    /** Repaint from live state (a template saved or applied elsewhere). */
    refresh(): void {
        if (this.popover?.open) this.render();
    }

    destroy(): void {
        this.popover?.destroy();
        this.popover = null;
        this.panel = null;
    }

    // ── rendering ───────────────────────────────────────────────────────────────

    private render(): void {
        const panel = this.panel;
        if (!panel) return;
        const d = this.doc;
        const rows = this.opts.templates();
        const house = this.opts.defaultTemplate?.() ?? null;
        const charts = this.opts.chartCount?.() ?? 1;

        const card = d.createElement('div');
        card.className = 'vela-tm';

        // ── head: what this is, how many, and what new charts start from ──
        const head = d.createElement('div');
        head.className = 'vela-tm-head';
        const mark = d.createElement('span');
        mark.className = 'vela-tm-mark';
        mark.appendChild(iconEl('templates', d));
        const headId = d.createElement('div');
        headId.className = 'vela-tm-headid';
        const title = d.createElement('b');
        title.className = 'vela-tm-title';
        title.textContent = 'Chart templates';
        const sub = d.createElement('span');
        sub.className = 'vela-tm-sub';
        if (house) {
            sub.textContent = `New charts start with “${house}”`;
            sub.dataset.house = '1';
        } else {
            sub.textContent = rows.length === 0
                ? 'A template is a chart’s indicators, settings included'
                : `${rows.length} saved · clicking one applies it here`;
        }
        headId.append(title, sub);
        head.append(mark, headId);
        card.appendChild(head);

        // ── the list ──
        const list = d.createElement('div');
        list.className = 'vela-tm-list';
        const builtins = this.opts.builtins?.() ?? [];
        if (rows.length === 0) {
            const empty = d.createElement('div');
            empty.className = 'vela-tm-empty';
            empty.textContent = builtins.length > 0
                ? 'No templates of your own yet — start from a built-in below, or set the chart up and save it.'
                : 'No templates yet. Set the chart up the way you trade it, then save its indicators below.';
            list.appendChild(empty);
        }
        for (const row of rows) list.appendChild(this.renderRow(row, house, charts));
        if (builtins.length > 0) {
            const group = d.createElement('div');
            group.className = 'vela-tm-group';
            group.textContent = 'Built-in';
            list.appendChild(group);
            for (const built of builtins) list.appendChild(this.renderBuiltin(built));
        }
        card.appendChild(list);

        // ── save / import ──
        const sep = d.createElement('div');
        sep.className = 'vela-tm-sep';
        card.appendChild(sep);
        if (this.saving) card.appendChild(this.saveForm());
        else if (this.opts.onSave) {
            const save = this.action('plus', 'Save template…', () => {
                this.saving = true;
                this.openRow = null;
                this.flash = null;
                this.render();
                this.panel?.querySelector<HTMLInputElement>('.vela-tm-input')?.focus();
            });
            save.classList.add('vela-tm-save');
            card.appendChild(save);
        }
        if (this.opts.onImport) {
            const importBtn = this.action('upload', 'Import template file…', () => this.pickFile());
            importBtn.classList.add('vela-tm-import');
            card.appendChild(importBtn);
        }

        // ── status line ──
        const flash = d.createElement('div');
        flash.className = 'vela-tm-flash';
        flash.setAttribute('role', 'status');
        flash.setAttribute('aria-live', 'polite');
        if (this.flash) {
            flash.textContent = this.flash.text;
            if (this.flash.tone) flash.dataset.tone = this.flash.tone;
        }
        card.appendChild(flash);

        panel.replaceChildren(card);
    }

    /** A read-only built-in: apply only — no star, no kebab, no rename field. */
    private renderBuiltin(built: { id: string; name: string; description: string; count: number }): HTMLElement {
        const d = this.doc;
        const wrap = d.createElement('div');
        wrap.className = 'vela-tm-item vela-tm-builtin';
        wrap.dataset.builtin = built.id;
        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-tm-row';
        btn.dataset.builtin = built.id;
        btn.setAttribute('aria-label', `Apply the built-in template ${built.name} to this chart`);
        const glyph = d.createElement('span');
        glyph.className = 'vela-tm-glyph vela-tm-glyph--builtin';
        glyph.appendChild(iconEl('style-line', d));
        const id = d.createElement('span');
        id.className = 'vela-tm-id';
        const name = d.createElement('span');
        name.className = 'vela-tm-name';
        name.textContent = built.name;
        const meta = d.createElement('span');
        meta.className = 'vela-tm-meta';
        meta.textContent = `${built.description} · ${built.count} indicator${built.count === 1 ? '' : 's'}`;
        id.append(name, meta);
        btn.append(glyph, id);
        btn.addEventListener('click', () => {
            this.opts.onApplyBuiltin?.(built.id);
            this.popover?.hide();
        });
        wrap.appendChild(btn);
        return wrap;
    }

    private renderRow(row: TemplatesMenuRow, house: string | null, charts: number): HTMLElement {
        const d = this.doc;
        const wrap = d.createElement('div');
        wrap.className = 'vela-tm-item';
        wrap.dataset.name = row.name;

        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-tm-row';
        btn.dataset.name = row.name;
        btn.setAttribute('aria-label', `Apply the template ${row.name} to this chart`);
        if (house === row.name) btn.dataset.current = '1';

        const glyph = d.createElement('span');
        glyph.className = 'vela-tm-glyph';
        glyph.appendChild(iconEl('templates', d));

        const id = d.createElement('span');
        id.className = 'vela-tm-id';
        if (this.renaming === row.name) {
            const input = d.createElement('input');
            input.type = 'text';
            input.className = 'vela-tm-input';
            input.value = this.renameDraft ?? row.name;
            input.maxLength = 40;
            input.setAttribute('aria-label', `Rename ${row.name}`);
            const commit = (): void => {
                const next = input.value.trim();
                if (!next || next === row.name) {
                    this.renaming = null;
                    this.renameDraft = null;
                    this.render();
                    return;
                }
                const ok = this.opts.onRename?.(row.name, next) ?? false;
                this.flash = ok
                    ? { text: `Renamed to “${next}”`, tone: 'ok' }
                    : { text: `A template named “${next}” already exists`, tone: 'bad' };
                // A refusal keeps the field open with what was typed: the fix is one word,
                // not one more trip through the kebab.
                this.renaming = ok ? null : row.name;
                this.renameDraft = ok ? null : next;
                this.render();
                if (!ok) {
                    const again = this.panel?.querySelector<HTMLInputElement>('.vela-tm-input');
                    again?.focus();
                    again?.select();
                }
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') commit();
            });
            input.addEventListener('blur', () => {
                if (this.renaming === row.name) commit();
            });
            id.appendChild(input);
        } else {
            const name = d.createElement('span');
            name.className = 'vela-tm-name';
            name.textContent = row.name;
            const meta = d.createElement('span');
            meta.className = 'vela-tm-meta';
            const bits = [`${row.count} indicator${row.count === 1 ? '' : 's'}`];
            if (row.symbol) bits.push(row.timeframe ? `${row.symbol} · ${row.timeframe}` : row.symbol);
            meta.textContent = bits.join(' · ');
            id.append(name, meta);
        }
        btn.append(glyph, id);

        if (house === row.name) {
            const badge = d.createElement('span');
            badge.className = 'vela-tm-badge';
            badge.textContent = 'default';
            btn.appendChild(badge);
        }

        btn.addEventListener('click', () => {
            if (this.renaming === row.name) return;
            const n = this.opts.onApply?.(row.name, 'active') ?? 0;
            if (n > 0) {
                this.close();
                return;
            }
            this.flash = { text: 'That template could not be applied', tone: 'bad' };
            this.render();
        });

        // The kebab is a sibling, not a child: a button inside a button is invalid HTML
        // and swallows its own clicks in WebKit.
        const kebab = d.createElement('button');
        kebab.type = 'button';
        kebab.className = 'vela-tm-ico vela-tm-kebab';
        kebab.appendChild(iconEl('kebab', d));
        kebab.title = `Actions for ${row.name}`;
        kebab.setAttribute('aria-label', `Actions for ${row.name}`);
        kebab.setAttribute('aria-expanded', String(this.openRow === row.name));
        kebab.addEventListener('click', () => {
            this.openRow = this.openRow === row.name ? null : row.name;
            this.renaming = null;
            this.saving = false;
            this.armed = null;
            this.flash = null;
            this.render();
        });

        // The star is TV's "Set as default", on the row: filled while this template seeds
        // new charts. The kebab carries the same verb for a keyboard-first reader.
        const star = d.createElement('button');
        star.type = 'button';
        star.className = 'vela-tm-ico vela-tm-star';
        star.dataset.on = house === row.name ? '1' : '0';
        const starLabel = house === row.name
            ? `${row.name} seeds new charts — turn off`
            : `Start new charts with ${row.name}`;
        star.title = starLabel;
        star.setAttribute('aria-label', starLabel);
        star.setAttribute('aria-pressed', String(house === row.name));
        star.appendChild(iconEl(house === row.name ? 'star-filled' : 'star', d));
        star.addEventListener('click', () => {
            if (this.opts.onSetDefault) {
                this.opts.onSetDefault(house === row.name ? null : row.name);
                this.flash = house === row.name
                    ? { text: `New charts no longer start with “${row.name}”`, tone: 'ok' }
                    : { text: `New charts will start with “${row.name}”`, tone: 'ok' };
            }
            this.render();
        });

        const head = d.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:2px;';
        if (this.opts.onSetDefault) head.appendChild(star);
        if (this.hasRowActions()) head.appendChild(kebab);
        head.style.paddingRight = '2px';
        btn.style.flex = '1 1 auto';
        head.insertBefore(btn, head.firstChild);
        wrap.appendChild(head);

        if (this.openRow === row.name) wrap.appendChild(this.actionStrip(row, charts));
        return wrap;
    }

    private hasRowActions(): boolean {
        return !!(this.opts.onRename || this.opts.onDelete || this.opts.onExport || this.opts.onApply);
    }

    private actionStrip(row: TemplatesMenuRow, charts: number): HTMLElement {
        const d = this.doc;
        const strip = d.createElement('div');
        strip.className = 'vela-tm-strip';
        const chip = (label: string, run: () => void, opts: { danger?: boolean; icon?: string } = {}): HTMLElement => {
            const b = d.createElement('button');
            b.type = 'button';
            b.className = 'vela-tm-chip';
            if (opts.danger) b.dataset.danger = '1';
            if (opts.icon) b.appendChild(iconEl(opts.icon, d));
            const t = d.createElement('span');
            t.textContent = label;
            b.appendChild(t);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                run();
            });
            return b;
        };
        if (this.opts.onApply && charts > 1) {
            strip.appendChild(chip('Apply to all charts', () => {
                const n = this.opts.onApply?.(row.name, 'all') ?? 0;
                this.openRow = null;
                this.flash = n > 0
                    ? { text: `“${row.name}” applied to ${n} charts`, tone: 'ok' }
                    : { text: 'Nothing to apply it to', tone: 'bad' };
                this.render();
            }, { icon: 'group' }));
        }
        if (this.opts.onRename) {
            strip.appendChild(chip('Rename…', () => {
                this.renaming = row.name;
                this.openRow = null;
                this.armed = null;
                this.render();
                const input = this.panel?.querySelector<HTMLInputElement>('.vela-tm-input');
                input?.focus();
                input?.select();
            }, { icon: 'pen' }));
        }
        if (this.opts.onExport) {
            strip.appendChild(chip('Export', () => {
                const json = this.opts.onExport?.(row.name) ?? null;
                if (!json) {
                    this.flash = { text: 'That template could not be exported', tone: 'bad' };
                    this.render();
                    return;
                }
                downloadText(this.doc, `${row.name}.vela-template.json`, json, 'application/json');
                this.flash = { text: `“${row.name}” exported`, tone: 'ok' };
                this.render();
            }, { icon: 'download' }));
        }
        if (this.opts.onDelete) {
            const armedRow = this.armed === row.name;
            strip.appendChild(chip(armedRow ? 'Tap again to delete' : 'Delete', () => {
                if (this.armed !== row.name) {
                    this.armed = row.name;
                    this.render();
                    return;
                }
                this.opts.onDelete?.(row.name);
                this.armed = null;
                this.openRow = null;
                this.flash = { text: `“${row.name}” deleted`, tone: 'ok' };
                this.render();
            }, { danger: true, icon: 'trash' }));
        }
        return strip;
    }

    private saveForm(): HTMLElement {
        const d = this.doc;
        const form = d.createElement('div');
        form.className = 'vela-tm-form';
        const row = d.createElement('div');
        row.className = 'vela-tm-formrow';
        const input = d.createElement('input');
        input.type = 'text';
        input.className = 'vela-tm-input';
        input.placeholder = 'Template name';
        input.maxLength = 40;
        input.setAttribute('aria-label', 'Save chart template as');
        const ok = d.createElement('button');
        ok.type = 'button';
        ok.className = 'vela-tm-primary';
        ok.textContent = 'Save';

        // TV's "Remember interval" checkbox, widened to what this build stores: the market
        // (symbol + timeframe) — off by default, because a template is meant to travel.
        const check = d.createElement('label');
        check.className = 'vela-tm-check';
        const box = d.createElement('input');
        box.type = 'checkbox';
        const checkText = d.createElement('span');
        checkText.textContent = 'Remember symbol & timeframe';
        check.title = 'Off by default: a template works on any market';
        check.append(box, checkText);

        const commit = (): void => {
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            const saved = this.opts.onSave?.(name, box.checked) ?? false;
            this.saving = false;
            this.flash = saved
                ? { text: `Template “${name}” saved`, tone: 'ok' }
                : { text: 'That template could not be saved', tone: 'bad' };
            this.render();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
        });
        ok.addEventListener('click', commit);
        row.append(input, ok);
        form.append(row, check);
        return form;
    }

    private action(icon: string, label: string, run: () => void): HTMLElement {
        const d = this.doc;
        const b = d.createElement('button');
        b.type = 'button';
        b.className = 'vela-tm-act';
        b.appendChild(iconEl(icon, d));
        const t = d.createElement('span');
        t.textContent = label;
        b.appendChild(t);
        b.addEventListener('click', run);
        return b;
    }

    /** A template file is JSON with the same envelope `exportTemplate` writes. */
    private pickFile(): void {
        const d = this.doc;
        const input = d.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        d.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return;
            void file.text().then((text) => {
                const name = this.opts.onImport?.(text) ?? null;
                this.flash = name
                    ? { text: `Imported “${name}”`, tone: 'ok' }
                    : { text: 'That file is not a Vela template', tone: 'bad' };
                this.render();
            }).catch(() => {
                this.flash = { text: 'That file could not be read', tone: 'bad' };
                this.render();
            });
        });
        input.click();
    }
}
