// COMMAND PALETTE — one field over everything the shell can do.
//
// The keymap already knows every shortcut, but a shortcut nobody can DISCOVER is a
// feature nobody has. The palette lists them by name, ranks them fuzzy, and runs them —
// plus the things that have no chord at all (open a saved layout, apply a template, put
// a watchlist symbol on every chart). VS Code's ⇧⌘P and Linear's ⌘K are the reference;
// `Mod+K` is the chord both use, and it must work while typing, so it is registered with
// `allowInInput` (the palette's own field holds focus for the whole interaction).
//
// ACCESSIBILITY — the APG combobox + listbox pattern, not a menu:
//   • the INPUT keeps DOM focus; the highlight is virtual (`aria-activedescendant`)
//   • `role="listbox"` with `role="option"` rows, `aria-selected` on the active one
//   • ↑/↓ move, PageUp/PageDown page, Home/End jump, ↵ runs, Esc closes
//   • a polite live region announces the result count
//   • opening remembers the focused element and closing restores it
// A menu would move real focus into the list and steal the caret from the field; that is
// exactly the bug this pattern exists to avoid.
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-command-palette';
const CSS = `
.vela-cp-scrim {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 12px 12px;
    background: color-mix(in srgb, var(--vela-bg) 55%, transparent);
    backdrop-filter: blur(1.5px);
}
/* [hidden] must actually hide it: an author display beats the UA sheet's
   [hidden] { display: none }, which left the closed scrim covering the shell and
   eating every click on the chart. */
.vela-cp-scrim[hidden] { display: none !important; }
.vela-cp-panel {
    width: min(560px, 100%);
    max-height: min(520px, 72vh);
    display: flex;
    flex-direction: column;
    background: var(--vela-surface-elev, var(--vela-bg));
    border: 1px solid var(--vela-border-strong, var(--vela-border));
    border-radius: 10px;
    box-shadow: 0 18px 48px -18px rgba(0, 0, 0, 0.6);
    overflow: hidden;
}
.vela-cp-field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vela-border-soft, var(--vela-border));
}
.vela-cp-input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    font-size: 14px;
    color: var(--vela-fg-bright);
    caret-color: var(--vela-accent, var(--vela-selected-bg));
}
.vela-cp-input::placeholder { color: var(--vela-fg-faint, var(--vela-fg-muted)); }
.vela-cp-count { flex: none; font-size: 10.5px; color: var(--vela-fg-faint, var(--vela-fg-muted)); font-variant-numeric: tabular-nums; }
.vela-cp-list { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 4px 4px 6px; scrollbar-width: thin; }
.vela-cp-group { font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vela-fg-faint, var(--vela-fg-muted)); padding: 8px 8px 3px; }
.vela-cp-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--vela-fg);
    font-size: 12.5px;
    min-height: 32px;
}
.vela-cp-opt[data-active='1'] { background: var(--vela-selected-bg, var(--vela-hover)); color: var(--vela-selected-fg, var(--vela-fg-bright)); }
.vela-cp-opt[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.vela-cp-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-cp-label mark { background: transparent; color: var(--vela-accent); font-weight: 700; }
.vela-cp-opt[data-active='1'] .vela-cp-label mark { color: inherit; text-decoration: underline; }
.vela-cp-keys { flex: none; display: inline-flex; gap: 3px; }
.vela-cp-key {
    font-size: 10px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 4px;
    border: 1px solid var(--vela-border-soft, var(--vela-border));
    color: var(--vela-fg-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.vela-cp-empty { padding: 22px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12.5px; }
.vela-cp-foot {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px 12px;
    border-top: 1px solid var(--vela-border-soft, var(--vela-border));
    font-size: 10.5px;
    color: var(--vela-fg-faint, var(--vela-fg-muted));
}
.vela-cp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export interface PaletteCommand {
    /** Stable id — recents survive a rename because this is what gets remembered. */
    id: string;
    label: string;
    /** Group heading ("Layout", "Chart", …). */
    category?: string;
    /** Chords as the keymap displays them ("⌘K"). */
    keys?: readonly string[];
    /** Extra words the search should match ("grid", "multi chart"). */
    keywords?: string;
    /** Right-aligned state text ("2×2", "3 indicators"). */
    hint?: string;
    disabled?: boolean;
    run: () => void;
}

export interface CommandPaletteOptions {
    doc: Document;
    /** Mount point (the shell root). Defaults to the document body. */
    host?: HTMLElement;
    /** Re-read on every open — commands are live. */
    commands: () => readonly PaletteCommand[];
    /** Recently run ids, newest first (the shell persists them). */
    recents?: () => readonly string[];
    /** Called after a command runs (so the shell can remember it). */
    onRun?: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export interface FuzzyHit {
    score: number;
    /** Indices of matched characters in `text` — the highlight. */
    indices: number[];
}

/**
 * Subsequence match with word-start and contiguity bonuses. Returns null when the query
 * is not a subsequence at all. PURE — the ranking is the part worth testing.
 */
export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
    const q = query.trim().toLowerCase();
    if (!q) return { score: 0, indices: [] };
    const t = text.toLowerCase();
    const indices: number[] = [];
    let score = 0;
    let ti = 0;
    let lastHit = -2;
    for (const ch of q) {
        if (ch === ' ') continue; // spaces are separators, not characters to find
        let found = -1;
        for (let i = ti; i < t.length; i += 1) {
            if (t[i] === ch) {
                found = i;
                break;
            }
        }
        if (found < 0) return null;
        const wordStart = found === 0 || /[\s\-–—/(·:.]/.test(t[found - 1] ?? '');
        score += wordStart ? 6 : 1;
        if (found === lastHit + 1) score += 4; // contiguous run
        else if (lastHit >= 0) score -= Math.min(4, found - lastHit - 1); // gap penalty
        indices.push(found);
        lastHit = found;
        ti = found + 1;
    }
    // Shorter labels win a tie: "Undo" beats "Undo the last drawing edit".
    score -= Math.min(6, Math.floor(t.length / 18));
    if (t.startsWith(q)) score += 8;
    return { score, indices };
}

interface Row {
    cmd: PaletteCommand;
    group: string;
    active: boolean;
}

export class CommandPalette {
    private readonly doc: Document;
    private readonly host: HTMLElement;
    private readonly opts: CommandPaletteOptions;
    private readonly scrim: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly countEl: HTMLElement;
    private readonly live: HTMLElement;
    private filtered: PaletteCommand[] = [];
    private active = 0;
    private open_ = false;
    private restoreFocus: HTMLElement | null = null;
    private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);

    constructor(opts: CommandPaletteOptions) {
        this.opts = opts;
        this.doc = opts.doc;
        injectStyles(STYLE_ID, CSS, this.doc);
        this.host = opts.host ?? this.doc.body;

        this.scrim = this.doc.createElement('div');
        this.scrim.className = 'vela-cp-scrim';
        this.scrim.hidden = true;
        this.scrim.addEventListener('pointerdown', (e) => {
            if (e.target === this.scrim) this.close();
        });

        const panel = this.doc.createElement('div');
        panel.className = 'vela-cp-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Command palette');

        const field = this.doc.createElement('div');
        field.className = 'vela-cp-field';
        this.input = this.doc.createElement('input');
        this.input.type = 'text';
        this.input.className = 'vela-cp-input';
        this.input.placeholder = 'Type a command, layout, template, symbol…';
        this.input.setAttribute('role', 'combobox');
        this.input.setAttribute('aria-expanded', 'true');
        this.input.setAttribute('aria-autocomplete', 'list');
        this.input.setAttribute('aria-controls', 'vela-cp-listbox');
        this.input.setAttribute('aria-label', 'Search commands');
        this.input.autocomplete = 'off';
        this.input.spellcheck = false;
        this.input.addEventListener('input', () => this.refilter());
        this.input.addEventListener('keydown', this.onKeyDown);
        this.countEl = this.doc.createElement('span');
        this.countEl.className = 'vela-cp-count';
        field.append(this.input, this.countEl);

        this.list = this.doc.createElement('div');
        this.list.className = 'vela-cp-list';
        this.list.id = 'vela-cp-listbox';
        this.list.setAttribute('role', 'listbox');
        this.list.setAttribute('aria-label', 'Commands');
        this.list.addEventListener('pointerdown', (e) => {
            const opt = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vela-cp-opt');
            if (!opt) return;
            e.preventDefault(); // keep the field's focus (the combobox contract)
            const index = Number(opt.dataset.index);
            if (Number.isFinite(index)) this.runAt(index);
        });
        this.list.addEventListener('pointermove', (e) => {
            const opt = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vela-cp-opt');
            if (!opt) return;
            const index = Number(opt.dataset.index);
            if (Number.isFinite(index) && index !== this.active) this.setActive(index, false);
        });

        const foot = this.doc.createElement('div');
        foot.className = 'vela-cp-foot';
        foot.innerHTML =
            '<span>↑↓ move</span><span>↵ run</span><span>esc close</span><span style="margin-left:auto">Commands run on the active chart</span>';

        this.live = this.doc.createElement('span');
        this.live.className = 'vela-cp-sr';
        this.live.setAttribute('aria-live', 'polite');
        this.live.setAttribute('aria-atomic', 'true');

        panel.append(field, this.list, foot, this.live);
        this.scrim.appendChild(panel);
        this.host.appendChild(this.scrim);
    }

    get isOpen(): boolean {
        return this.open_;
    }

    open(): void {
        if (this.open_) return;
        this.open_ = true;
        this.restoreFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
        this.scrim.hidden = false;
        this.input.value = '';
        this.refilter();
        this.input.focus();
        this.opts.onOpenChange?.(true);
    }

    close(): void {
        if (!this.open_) return;
        this.open_ = false;
        this.scrim.hidden = true;
        this.opts.onOpenChange?.(false);
        try {
            this.restoreFocus?.focus({ preventScroll: true });
        } catch {
            /* the trigger may be gone — focus simply stays where it is */
        }
    }

    toggle(): void {
        if (this.open_) this.close();
        else this.open();
    }

    destroy(): void {
        this.close();
        this.scrim.remove();
    }

    /** Rank + render. Recents float to the top while the field is empty. */
    private refilter(): void {
        const query = this.input.value;
        const all = this.opts.commands();
        const recents = new Set(this.opts.recents?.() ?? []);
        const hits: Array<{ cmd: PaletteCommand; score: number; indices: number[]; recent: number }> = [];
        for (const cmd of all) {
            const hit = fuzzyMatch(query, `${cmd.label} ${cmd.category ?? ''} ${cmd.keywords ?? ''}`);
            if (!hit) continue;
            const recentIndex = [...recents].indexOf(cmd.id);
            hits.push({
                cmd,
                score: hit.score + (query.trim() ? 0 : recentIndex >= 0 ? 20 - Math.min(10, recentIndex) : 0),
                indices: hit.indices,
                recent: recentIndex,
            });
        }
        hits.sort((a, b) => b.score - a.score || a.cmd.label.localeCompare(b.cmd.label));
        this.filtered = hits.map((h) => h.cmd);
        this.active = 0;
        this.renderList(hits);
    }

    private renderList(hits: ReadonlyArray<{ cmd: PaletteCommand; indices: number[] }>): void {
        const doc = this.doc;
        this.list.replaceChildren();
        this.countEl.textContent = this.filtered.length === 0 ? '' : `${this.filtered.length}`;
        this.live.textContent =
            this.filtered.length === 0 ? 'No matching commands' : `${this.filtered.length} command${this.filtered.length === 1 ? '' : 's'}`;
        if (this.filtered.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-cp-empty';
            empty.textContent = 'No matching commands';
            this.list.appendChild(empty);
            this.input.removeAttribute('aria-activedescendant');
            return;
        }
        let group = '';
        for (const [i, hit] of hits.entries()) {
            const cat = hit.cmd.category ?? 'Commands';
            if (cat !== group) {
                group = cat;
                const head = doc.createElement('div');
                head.className = 'vela-cp-group';
                head.setAttribute('role', 'presentation');
                head.textContent = cat;
                this.list.appendChild(head);
            }
            const row = doc.createElement('div');
            row.className = 'vela-cp-opt';
            row.id = `vela-cp-opt-${i}`;
            row.dataset.index = String(i);
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', 'false');
            if (hit.cmd.disabled) row.setAttribute('aria-disabled', 'true');
            const label = doc.createElement('span');
            label.className = 'vela-cp-label';
            label.appendChild(this.highlight(hit.cmd.label, hit.indices));
            if (hit.cmd.hint) {
                const hint = doc.createElement('span');
                hint.className = 'vela-cp-keys';
                const chip = doc.createElement('span');
                chip.className = 'vela-cp-key';
                chip.textContent = hit.cmd.hint;
                hint.appendChild(chip);
                label.appendChild(hint);
            }
            row.appendChild(label);
            if (hit.cmd.keys && hit.cmd.keys.length > 0) {
                const keys = doc.createElement('span');
                keys.className = 'vela-cp-keys';
                for (const k of hit.cmd.keys) {
                    const chip = doc.createElement('span');
                    chip.className = 'vela-cp-key';
                    chip.textContent = k;
                    keys.appendChild(chip);
                }
                row.appendChild(keys);
            }
            this.list.appendChild(row);
        }
        this.setActive(0, false);
    }

    /** The label with the matched characters wrapped in `<mark>`. */
    private highlight(text: string, indices: ReadonlyArray<number>): DocumentFragment {
        const frag = this.doc.createDocumentFragment();
        if (indices.length === 0) {
            frag.appendChild(this.doc.createTextNode(text));
            return frag;
        }
        const set = new Set(indices);
        let buf = '';
        let marked = false;
        const flush = (): void => {
            if (!buf) return;
            if (marked) {
                const m = this.doc.createElement('mark');
                m.textContent = buf;
                frag.appendChild(m);
            } else frag.appendChild(this.doc.createTextNode(buf));
            buf = '';
        };
        for (let i = 0; i < text.length; i += 1) {
            const want = set.has(i);
            if (want !== marked) {
                flush();
                marked = want;
            }
            buf += text[i];
        }
        flush();
        return frag;
    }

    private setActive(index: number, scroll = true): void {
        const opts = this.list.querySelectorAll<HTMLElement>('.vela-cp-opt');
        if (opts.length === 0) return;
        const next = Math.max(0, Math.min(opts.length - 1, index));
        for (const [i, el] of [...opts].entries()) {
            el.dataset.active = i === next ? '1' : '';
            el.setAttribute('aria-selected', String(i === next));
        }
        this.active = next;
        this.input.setAttribute('aria-activedescendant', `vela-cp-opt-${next}`);
        if (scroll) opts[next]?.scrollIntoView?.({ block: 'nearest' });
    }

    private runAt(index: number): void {
        const cmd = this.filtered[index];
        if (!cmd || cmd.disabled) return;
        this.close();
        // Run OUTSIDE the palette's own event path so a command that opens another
        // dialog (shortcuts, layout) is not closed by the same Escape/Enter.
        this.doc.defaultView?.setTimeout(() => {
            cmd.run();
            this.opts.onRun?.(cmd.id);
        }, 0);
    }

    private handleKey(e: KeyboardEvent): void {
        if (!this.open_) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.setActive(this.active + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.setActive(this.active - 1);
        } else if (e.key === 'PageDown') {
            e.preventDefault();
            this.setActive(this.active + 8);
        } else if (e.key === 'PageUp') {
            e.preventDefault();
            this.setActive(this.active - 8);
        } else if (e.key === 'Home') {
            e.preventDefault();
            this.setActive(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            this.setActive(this.filtered.length - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.runAt(this.active);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }
    }
}
