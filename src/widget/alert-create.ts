// Create-alert sheet — the phone's door to the reference's Alert dialog, flattened to the
// four things a PRICE alert actually needs: the condition (its five operators), the level,
// how often it may fire, and Create.
//
// TradingView's own flow is the model: Condition → value → trigger frequency → Create, with
// the level defaulting to "here" (the last print) so the common case is one tap on a chip
// and one on Create. The sheet is a bottom Drawer for the same reason every other picker is
// one: a popover fights the touch layout on a phone.
import { Drawer } from '../ui/components/drawer';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { CONDITION_LABELS, FREQUENCY_LABELS, formatLevel, type AlertCondition, type AlertFrequency } from '../workspace/price-alerts';

const STYLE_ID = 'vela-widget-alert-create';
const CSS = `
.vela-ac-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 2px 12px;
    color: var(--vela-fg-muted);
}
.vela-ac-symbol {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--vela-border);
    border-radius: 999px;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
}
.vela-ac-label {
    padding: 14px 2px 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-ac-label:first-child { padding-top: 0; }
.vela-ac-seg {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
}
.vela-ac-opt {
    all: unset;
    box-sizing: border-box;
    min-height: 44px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    border: 1px solid var(--vela-border);
    border-radius: 9px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-ac-opt:active { background: var(--vela-hover); }
.vela-ac-opt[data-on='1'] {
    border-color: var(--vela-fg-bright);
    background: var(--vela-hover);
    color: var(--vela-fg-bright);
}
.vela-ac-opt[data-on='1'] .vela-icon { color: var(--vela-accent); }
.vela-ac-value {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 12px;
    border: 1px solid var(--vela-border);
    border-radius: 9px;
    background: var(--vela-surface-elev);
    color: var(--vela-fg-bright);
}
.vela-ac-value:focus-within { border-color: var(--vela-fg-bright); }
.vela-ac-value input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--vela-fg-bright);
}
.vela-ac-hint { font-size: 12px; color: var(--vela-fg-muted); }
.vela-ac-create {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 48px;
    margin-top: 18px;
    border-radius: 10px;
    background: var(--vela-accent);
    color: var(--vela-on-accent, #0b0d12);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-ac-create[disabled] { opacity: 0.4; pointer-events: none; }
.vela-ac-note {
    padding: 10px 2px 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--vela-fg-muted);
}
`;

const CONDITIONS: readonly AlertCondition[] = ['cross', 'cross-up', 'cross-down', 'gt', 'lt'];
const CONDITION_ICONS: Readonly<Record<AlertCondition, string>> = {
    cross: 'wave',
    'cross-up': 'arrow-up',
    'cross-down': 'arrow-down',
    gt: 'chevron-up',
    lt: 'chevron-down',
};

export interface AlertCreateOptions {
    host: HTMLElement;
    /** The symbol the alert will watch, read at open (the active chart's). */
    symbol: () => string;
    /** The last print, used to prefill the level; null while nothing is loaded. */
    currentPrice: () => number | null;
    /** Create the alert. Returns false when the level was rejected (the sheet stays open). */
    onCreate: (request: { condition: AlertCondition; value: number; frequency: AlertFrequency }) => boolean;
    onOpenChange?: (open: boolean) => void;
}

export class AlertCreateSheet {
    private readonly drawer: Drawer;
    private condition: AlertCondition = 'cross';
    private frequency: AlertFrequency = 'once';
    private value = '';
    private opts: AlertCreateOptions;
    private readonly symbolEl: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly hint: HTMLElement;
    private readonly createBtn: HTMLButtonElement;
    private readonly conditionOpts = new Map<AlertCondition, HTMLButtonElement>();
    private readonly freqOpts = new Map<AlertFrequency, HTMLButtonElement>();

    constructor(opts: AlertCreateOptions) {
        this.opts = opts;
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.drawer = new Drawer({ host: opts.host, title: 'Create alert', onOpenChange: opts.onOpenChange });

        // ── symbol ──
        const head = doc.createElement('div');
        head.className = 'vela-ac-head';
        this.symbolEl = doc.createElement('span');
        this.symbolEl.className = 'vela-ac-symbol';
        head.appendChild(this.symbolEl);

        // ── condition ──
        const condLabel = this.label(doc, 'Condition');
        const condWrap = doc.createElement('div');
        condWrap.className = 'vela-ac-seg';
        for (const condition of CONDITIONS) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-ac-opt';
            b.appendChild(iconEl(CONDITION_ICONS[condition], doc));
            b.appendChild(doc.createTextNode(CONDITION_LABELS[condition]));
            b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => {
                this.condition = condition;
                this.paint();
            });
            this.conditionOpts.set(condition, b);
            condWrap.appendChild(b);
        }

        // ── value ──
        const valueLabel = this.label(doc, 'Level');
        const valueRow = doc.createElement('div');
        valueRow.className = 'vela-ac-value';
        this.input = doc.createElement('input');
        this.input.type = 'text';
        this.input.inputMode = 'decimal';
        this.input.autocomplete = 'off';
        this.input.spellcheck = false;
        this.input.setAttribute('aria-label', 'Alert level');
        this.input.addEventListener('input', () => {
            this.value = this.input.value;
            this.paint();
        });
        valueRow.appendChild(this.input);
        this.hint = doc.createElement('span');
        this.hint.className = 'vela-ac-hint';
        valueRow.appendChild(this.hint);

        // ── frequency ──
        const freqLabel = this.label(doc, 'Trigger');
        const freqWrap = doc.createElement('div');
        freqWrap.className = 'vela-ac-seg';
        for (const freq of ['once', 'each'] as const) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-ac-opt';
            b.appendChild(doc.createTextNode(FREQUENCY_LABELS[freq]));
            b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => {
                this.frequency = freq;
                this.paint();
            });
            this.freqOpts.set(freq, b);
            freqWrap.appendChild(b);
        }

        this.createBtn = doc.createElement('button');
        this.createBtn.type = 'button';
        this.createBtn.className = 'vela-ac-create';
        this.createBtn.textContent = 'Create alert';
        this.createBtn.addEventListener('click', () => {
            const value = Number(this.value.replace(',', '.'));
            if (!Number.isFinite(value)) {
                this.input.focus({ preventScroll: true });
                return;
            }
            const ok = this.opts.onCreate({ condition: this.condition, value, frequency: this.frequency });
            if (ok) this.drawer.hide();
        });

        const note = doc.createElement('div');
        note.className = 'vela-ac-note';
        note.textContent = 'The level is drawn on the chart. It is checked against every price your chart prints — closing or reloading the page clears it.';

        this.drawer.body.append(head, condLabel, condWrap, valueLabel, valueRow, freqLabel, freqWrap, this.createBtn, note);
    }

    private label(doc: Document, text: string): HTMLElement {
        const el = doc.createElement('div');
        el.className = 'vela-ac-label';
        el.textContent = text;
        return el;
    }

    private paint(): void {
        for (const [condition, el] of this.conditionOpts) {
            el.dataset.on = condition === this.condition ? '1' : '';
            el.setAttribute('aria-pressed', condition === this.condition ? 'true' : 'false');
        }
        for (const [freq, el] of this.freqOpts) {
            el.dataset.on = freq === this.frequency ? '1' : '';
            el.setAttribute('aria-pressed', freq === this.frequency ? 'true' : 'false');
        }
        const price = this.opts.currentPrice();
        const value = Number(this.value.replace(',', '.'));
        this.hint.textContent = this.distanceHint(price, value);
        this.createBtn.disabled = !Number.isFinite(value);
    }

    /** "at market" / "+0.35% from now" — the one number that tells the user where they
     *  are aiming, which `now 143.52` (the old hint) never did once the field was edited. */
    private distanceHint(price: number | null, value: number): string {
        if (price == null || !Number.isFinite(price) || price === 0 || !Number.isFinite(value)) return '';
        if (Math.abs(value - price) < Math.max(1e-9, Math.abs(price) * 1e-6)) return 'at market';
        const pct = ((value - price) / price) * 100;
        const sign = pct > 0 ? '+' : '';
        return `${sign}${pct.toFixed(2)}% from now`;
    }

    open(): void {
        this.symbolEl.replaceChildren(iconEl('bell', this.symbolEl.ownerDocument), this.symbolEl.ownerDocument.createTextNode(this.opts.symbol()));
        const price = this.opts.currentPrice();
        // Prefill with the live print: "alert me if it crosses HERE" is the common case, and
        // a keyboard-first sheet that opens empty makes the user retype a number the chart
        // already knows.
        // Two decimals is what the price axis prints; more digits make the field look like
        // a raw float and force the user to clear it before typing.
        this.value = price != null ? String(Number(price.toFixed(2))) : '';
        this.input.value = this.value;
        this.condition = 'cross';
        this.frequency = 'once';
        this.paint();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }
}
