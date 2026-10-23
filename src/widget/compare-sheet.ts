// The Compare sheet — the reference's "Compare symbol" dialog, sized for a phone.
//
// It answers three questions in order: WHICH symbol, HOW it is shown, and how to take it
// off again. The three displays are the reference's own (Same % scale / New price scale /
// New pane) with a one-line consequence under each, because "new price scale" means nothing
// until you read "its own axis beside the price".
import { Drawer } from '../ui/components/drawer';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { COMPARE_DISPLAY_LABELS, type CompareDisplay } from '../core/native-indicators/compare';

const STYLE_ID = 'vela-widget-compare-sheet';
const CSS = `
.vela-cmp-sym {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 52px;
    padding: 0 12px;
    border: 1px solid var(--vela-border);
    border-radius: 10px;
    background: var(--vela-surface-elev);
    color: var(--vela-fg-bright);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cmp-sym:active { background: var(--vela-hover); }
.vela-cmp-sym-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; letter-spacing: 0.01em; }
.vela-cmp-sym-hint { font-size: 12px; color: var(--vela-fg-muted); }
.vela-cmp-label {
    padding: 16px 2px 7px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-cmp-modes { display: flex; flex-direction: column; gap: 6px; }
.vela-cmp-mode {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 18px;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 8px 12px;
    border: 1px solid var(--vela-border);
    border-radius: 10px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cmp-mode:active { background: var(--vela-hover); }
.vela-cmp-mode[data-on='1'] { border-color: var(--vela-accent); background: var(--vela-hover); }
.vela-cmp-mode-glyph { color: var(--vela-fg-muted); }
.vela-cmp-mode[data-on='1'] .vela-cmp-mode-glyph { color: var(--vela-accent); }
.vela-cmp-mode-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vela-cmp-mode-name { font-size: 14px; font-weight: 600; color: var(--vela-fg-bright); }
.vela-cmp-mode-desc { font-size: 12px; line-height: 1.35; color: var(--vela-fg-muted); }
.vela-cmp-tick { color: var(--vela-accent); opacity: 0; }
.vela-cmp-mode[data-on='1'] .vela-cmp-tick { opacity: 1; }
.vela-cmp-remove {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    margin-top: 18px;
    border-radius: 10px;
    border: 1px solid var(--vela-border);
    color: var(--vela-down);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-cmp-remove:active { background: var(--vela-hover); }
.vela-cmp-note { padding: 12px 2px 2px; font-size: 12px; line-height: 1.5; color: var(--vela-fg-muted); }
`;

const MODES: ReadonlyArray<{ id: CompareDisplay; glyph: string; desc: string }> = [
    { id: 'same-percent', glyph: 'wave', desc: 'Both lines in % from the first visible bar — the performance comparison.' },
    { id: 'own-scale', glyph: 'price-delta', desc: 'The symbol keeps its real prices, on its own axis beside the chart.' },
    { id: 'new-pane', glyph: 'layout', desc: 'Its own section below the chart, with its own scale.' },
];

export interface CompareSheetOptions {
    host: HTMLElement;
    /** The symbol compared on the ACTIVE chart, or null when nothing is compared yet. */
    getSymbol: () => string | null;
    getDisplay: () => CompareDisplay;
    /** Raise the symbol search (the host routes the pick back here). */
    onPickSymbol: () => void;
    onDisplay: (mode: CompareDisplay) => void;
    onRemove: () => void;
    onOpenChange?: (open: boolean) => void;
}

export class CompareSheet {
    private readonly drawer: Drawer;
    private readonly symbolBtn: HTMLButtonElement;
    private readonly symbolName: HTMLElement;
    private readonly symbolHint: HTMLElement;
    private readonly modeEls = new Map<CompareDisplay, HTMLButtonElement>();
    private readonly removeBtn: HTMLButtonElement;
    private readonly opts: CompareSheetOptions;

    constructor(opts: CompareSheetOptions) {
        this.opts = opts;
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.drawer = new Drawer({ host: opts.host, title: 'Compare', onOpenChange: opts.onOpenChange });

        this.symbolBtn = doc.createElement('button');
        this.symbolBtn.type = 'button';
        this.symbolBtn.className = 'vela-cmp-sym';
        this.symbolBtn.setAttribute('aria-label', 'Choose the compare symbol');
        this.symbolName = doc.createElement('span');
        this.symbolName.className = 'vela-cmp-sym-name';
        this.symbolHint = doc.createElement('span');
        this.symbolHint.className = 'vela-cmp-sym-hint';
        this.symbolBtn.append(iconEl('search', doc), this.symbolName, this.symbolHint, iconEl('chevron-right', doc));
        this.symbolBtn.addEventListener('click', () => {
            // The sheet stays mounted underneath: the picker closes onto an already-painted
            // sheet instead of two sheets racing each other.
            opts.onPickSymbol();
        });

        const label = doc.createElement('div');
        label.className = 'vela-cmp-label';
        label.textContent = 'Display';

        const modes = doc.createElement('div');
        modes.className = 'vela-cmp-modes';
        for (const mode of MODES) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-cmp-mode';
            b.dataset.display = mode.id;
            const glyph = iconEl(mode.glyph, doc);
            glyph.classList.add('vela-cmp-mode-glyph');
            const text = doc.createElement('span');
            text.className = 'vela-cmp-mode-text';
            const name = doc.createElement('span');
            name.className = 'vela-cmp-mode-name';
            name.textContent = COMPARE_DISPLAY_LABELS[mode.id];
            const desc = doc.createElement('span');
            desc.className = 'vela-cmp-mode-desc';
            desc.textContent = mode.desc;
            text.append(name, desc);
            const tick = iconEl('check', doc);
            tick.classList.add('vela-cmp-tick');
            b.append(glyph, text, tick);
            b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => {
                if (this.opts.getSymbol()) this.opts.onDisplay(mode.id);
                this.paint();
            });
            this.modeEls.set(mode.id, b);
            modes.appendChild(b);
        }

        this.removeBtn = doc.createElement('button');
        this.removeBtn.type = 'button';
        this.removeBtn.className = 'vela-cmp-remove';
        this.removeBtn.append(iconEl('trash', doc), doc.createTextNode('Remove compare'));
        this.removeBtn.addEventListener('click', () => {
            opts.onRemove();
            this.drawer.hide();
        });

        const note = doc.createElement('div');
        note.className = 'vela-cmp-note';
        note.textContent = 'Same % scale re-bases both series at the first visible bar; scrolling or zooming moves that anchor, so the percentages follow the period you are looking at.';

        this.drawer.body.append(this.symbolBtn, label, modes, this.removeBtn, note);
    }

    /** Re-read the chart's own state and paint it (called on open and after every change). */
    refresh(): void {
        this.paint();
    }

    private paint(): void {
        const symbol = this.opts.getSymbol();
        const display = this.opts.getDisplay();
        this.symbolName.textContent = symbol ?? 'Choose symbol…';
        this.symbolHint.textContent = symbol ? '' : 'search';
        for (const [id, el] of this.modeEls) {
            const on = symbol != null && id === display;
            el.dataset.on = on ? '1' : '';
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
            el.disabled = symbol == null;
            el.style.opacity = symbol == null ? '0.45' : '';
        }
        this.removeBtn.hidden = symbol == null;
    }

    open(): void {
        this.paint();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    get isOpen(): boolean {
        return this.drawer.open;
    }

    destroy(): void {
        this.drawer.destroy();
    }
}
