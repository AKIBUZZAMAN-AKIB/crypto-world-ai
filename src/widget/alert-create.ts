// Shared price-alert form. The workspace embeds it in the Alerts pane; the legacy
// sheet wrapper below keeps the same create contract for other callers.
import { Drawer } from '../ui/components/drawer';
import { AlertSelect } from './alert-select';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { timeframeLabel } from './timeframe';
import { CONDITION_LABELS, DEFAULT_MOVE_BARS, FREQUENCY_LABELS, isMoveCondition, type AlertCondition, type AlertFrequency } from '../workspace/price-alerts';

const STYLE_ID = 'vela-widget-alert-create';
const CSS = `
.vela-ac { min-width: 0; }
.vela-ac-target { display:flex; align-items:center; gap:9px; min-width:0; padding:10px; border:1px solid var(--vela-border); background:var(--vela-surface-elev,var(--vela-bg)); }
.vela-ac-target .vela-icon { width:18px; height:18px; font-size:18px; color:var(--vela-fg-muted); }
.vela-ac-target-text { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
.vela-ac-target-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vela-fg-bright); font-size:13px; font-weight:700; }
.vela-ac-target-detail { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vela-fg-muted); font-size:11px; }
.vela-ac-label { display:block; margin:14px 0 6px; color:var(--vela-fg-muted); font-size:11px; font-weight:700; letter-spacing:.035em; }
.vela-ac-select, .vela-ac-input { box-sizing:border-box; display:block; width:100%; min-width:0; min-height:38px; padding:0 10px; border:1px solid var(--vela-border); border-radius:4px; background:var(--vela-surface-elev,var(--vela-bg)); color:var(--vela-fg-bright); font:inherit; font-size:13px; }
.vela-ac-select { cursor:pointer; }
.vela-ac-input { font-variant-numeric:tabular-nums; }
.vela-ac-input[readonly] { color:var(--vela-fg-muted); }
.vela-ac-select:focus-visible, .vela-ac-input:focus-visible, .vela-ac-opt:focus-visible, .vela-ac-create:focus-visible, .vela-ac-rebind:focus-visible { outline:2px solid var(--vela-fg-bright); outline-offset:1px; }
.vela-ac-hint { margin-top:5px; color:var(--vela-fg-muted); font-size:11px; line-height:1.4; }
.vela-ac-bars[hidden], .vela-ac-warning[hidden], .vela-ac-rebind[hidden] { display:none !important; }
.vela-ac-frequency { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
.vela-ac-opt { all:unset; box-sizing:border-box; min-height:38px; padding:0 8px; display:flex; align-items:center; justify-content:center; border:1px solid var(--vela-border); border-radius:4px; color:var(--vela-fg-muted); font-size:12px; font-weight:600; text-align:center; cursor:pointer; }
.vela-ac-opt[aria-pressed='true'] { color:var(--vela-fg-bright); border-color:var(--vela-accent-ink,var(--vela-accent)); background:color-mix(in srgb,var(--vela-accent) 10%,transparent); }
.vela-ac-opt:hover { background:var(--vela-hover); }
/* The selected fill and its foreground travel as a pair through both theme variants. */
.vela-ac-create { all:unset; box-sizing:border-box; display:flex; align-items:center; justify-content:center; gap:7px; width:100%; min-height:40px; margin-top:16px; border:1px solid transparent; border-radius:4px; background:var(--vela-selected-bg,var(--vela-accent)); color:var(--vela-selected-fg,var(--vela-fg-on-fill)); font-size:13px; font-weight:700; cursor:pointer; }
.vela-ac-create:hover:not(:disabled) { background:color-mix(in srgb,var(--vela-selected-bg,var(--vela-accent)) 92%,#000); }
.vela-ac-create:disabled { background:var(--vela-surface-elev,var(--vela-bg)); color:var(--vela-mono-muted,var(--vela-fg-muted)); border-color:var(--vela-border-strong,var(--vela-border)); cursor:not-allowed; }
/* Premium's generic disabled rule fades the entire button to 40%; keep this particular
   validation state legible and distinguish it with its outlined, muted styling instead. */
html.vela-premium .vela-ac .vela-ac-create:disabled { opacity:1; cursor:not-allowed; }
.vela-ac-create .vela-icon { width:15px; height:15px; }
.vela-ac-warning { margin-top:10px; padding:9px; border:1px solid var(--vela-border-strong,var(--vela-border)); background:var(--vela-hover); color:var(--vela-fg); font-size:12px; line-height:1.4; }
.vela-ac-rebind { all:unset; display:inline-flex; box-sizing:border-box; min-height:32px; align-items:center; margin-top:5px; padding:0 9px; border:1px solid var(--vela-border-strong,var(--vela-border)); border-radius:4px; color:var(--vela-fg-bright); font-size:12px; font-weight:700; cursor:pointer; }
.vela-ac-note { margin:10px 0 2px; color:var(--vela-fg-muted); font-size:11px; line-height:1.45; }
.vela-ac-feedback { color:var(--vela-fg-muted); font-size:11px; min-height:0; line-height:1.4; }
.vela-ac-feedback:not(:empty) { margin-top:8px; }
@media (pointer:coarse) { .vela-ac-select, .vela-ac-input { min-height:44px; font-size:16px; } .vela-ac-opt, .vela-ac-create, .vela-ac-rebind { min-height:44px; } }
`;

const CONDITIONS: readonly AlertCondition[] = ['cross', 'cross-up', 'cross-down', 'gt', 'lt', 'move-up', 'move-down', 'move-up-pct', 'move-down-pct'];
let formSequence = 0;

export interface AlertRequest {
    condition: AlertCondition;
    value: number;
    frequency: AlertFrequency;
    bars: number;
    source?: { drawingId: string };
}

/** Snapshot identity excludes price: ticks do not invalidate an in-progress draft. */
export interface AlertTarget {
    cellId: string;
    symbol: string;
    timeframe: string;
    /** Trading-session identity; absent means the provider's regular default. */
    session?: 'regular' | 'extended';
    chartLabel: string;
    price: number | null;
    loading?: boolean;
}
export interface AlertDrawingPrefill { value: number; label: string; drawingId: string }
export interface AlertFormOptions {
    host: HTMLElement;
    target: () => AlertTarget | null;
    /** Current drawing level, or null when it no longer exists/has no level here. */
    drawingLevel?: (target: AlertTarget, drawingId: string) => number | null;
    /** An editor cannot rebind an existing alert to a different chart or drawing. */
    mode?: 'create' | 'edit';
    onCreate: (request: AlertRequest, target: AlertTarget) => boolean;
}

function sameTarget(a: AlertTarget | null, b: AlertTarget | null): boolean {
    return !!a && !!b && a.cellId === b.cellId && a.symbol === b.symbol && a.timeframe === b.timeframe
        && (a.session ?? 'regular') === (b.session ?? 'regular');
}
function numberFrom(text: string): number | null {
    const value = text.trim();
    if (!value) return null;
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}
function initialValue(value: number): string {
    // Preserve the exact printed number, including small-priced symbols and precision.
    return String(value);
}

export class AlertCreateForm {
    readonly el: HTMLElement;
    private readonly opts: AlertFormOptions;
    private readonly targetTitle: HTMLElement;
    private readonly targetDetail: HTMLElement;
    private readonly warning: HTMLElement;
    private readonly warningText: HTMLElement;
    private readonly rebind: HTMLButtonElement;
    private readonly select: HTMLSelectElement;
    private readonly conditionControl: AlertSelect;
    private readonly valueLabel: HTMLLabelElement;
    private readonly input: HTMLInputElement;
    private readonly hint: HTMLElement;
    private readonly barsWrap: HTMLElement;
    private readonly barsInput: HTMLInputElement;
    private readonly freq = new Map<AlertFrequency, HTMLButtonElement>();
    private readonly create: HTMLButtonElement;
    private readonly feedback: HTMLElement;
    private bound: AlertTarget | null = null;
    private source: AlertDrawingPrefill | null = null;
    private frequency: AlertFrequency = 'once';
    private condition: AlertCondition = 'cross';
    private valueTouched = false;
    private seeded = false;

    constructor(opts: AlertFormOptions) {
        this.opts = opts;
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        const id = ++formSequence;
        this.el = doc.createElement('div');
        this.el.className = 'vela-ac';
        const target = doc.createElement('div');
        target.className = 'vela-ac-target';
        const targetText = doc.createElement('div');
        targetText.className = 'vela-ac-target-text';
        this.targetTitle = doc.createElement('span');
        this.targetTitle.className = 'vela-ac-target-title';
        this.targetDetail = doc.createElement('span');
        this.targetDetail.className = 'vela-ac-target-detail';
        targetText.append(this.targetTitle, this.targetDetail);
        target.append(iconEl('bell', doc), targetText);

        this.warning = doc.createElement('div');
        this.warning.className = 'vela-ac-warning';
        this.warning.setAttribute('role', 'status');
        this.warningText = doc.createElement('div');
        this.rebind = doc.createElement('button');
        this.rebind.type = 'button';
        this.rebind.className = 'vela-ac-rebind';
        this.rebind.textContent = 'Use active chart';
        this.rebind.addEventListener('click', () => this.bind());
        this.warning.append(this.warningText, this.rebind);

        const conditionLabel = doc.createElement('label');
        conditionLabel.className = 'vela-ac-label';
        conditionLabel.htmlFor = `vela-ac-${id}-condition`;
        conditionLabel.textContent = 'Condition';
        this.select = doc.createElement('select');
        this.select.id = conditionLabel.htmlFor;
        this.select.className = 'vela-ac-select';
        for (const condition of CONDITIONS) {
            const option = doc.createElement('option');
            option.value = condition;
            option.textContent = CONDITION_LABELS[condition];
            this.select.appendChild(option);
        }
        this.select.addEventListener('change', () => {
            const next = this.select.value as AlertCondition;
            // A price and a move distance are different kinds of number. Switching
            // within one family, however, must never discard a carefully typed level.
            if (isMoveCondition(this.condition) !== isMoveCondition(next)) {
                this.valueTouched = false;
                this.seeded = false;
                this.input.value = '';
            }
            this.condition = next;
            this.feedback.textContent = '';
            this.refresh();
        });
        this.valueLabel = doc.createElement('label');
        this.valueLabel.className = 'vela-ac-label';
        this.valueLabel.htmlFor = `vela-ac-${id}-value`;
        this.input = doc.createElement('input');
        this.input.id = this.valueLabel.htmlFor;
        this.input.className = 'vela-ac-input';
        this.input.type = 'text';
        this.input.inputMode = 'decimal';
        this.input.autocomplete = 'off';
        this.input.spellcheck = false;
        this.input.addEventListener('input', () => { this.valueTouched = true; this.feedback.textContent = ''; this.refresh(); });
        this.hint = doc.createElement('div');
        this.hint.id = `vela-ac-${id}-hint`;
        this.hint.className = 'vela-ac-hint';
        this.input.setAttribute('aria-describedby', this.hint.id);

        this.barsWrap = doc.createElement('div');
        this.barsWrap.className = 'vela-ac-bars';
        const barsLabel = doc.createElement('label');
        barsLabel.className = 'vela-ac-label';
        barsLabel.htmlFor = `vela-ac-${id}-bars`;
        barsLabel.textContent = 'Within number of bars';
        this.barsInput = doc.createElement('input');
        this.barsInput.id = barsLabel.htmlFor;
        this.barsInput.className = 'vela-ac-input';
        this.barsInput.type = 'text';
        this.barsInput.inputMode = 'numeric';
        this.barsInput.value = String(DEFAULT_MOVE_BARS);
        this.barsInput.addEventListener('input', () => this.refresh());
        this.barsWrap.append(barsLabel, this.barsInput);

        const frequencyLabel = doc.createElement('div');
        frequencyLabel.className = 'vela-ac-label';
        frequencyLabel.id = `vela-ac-${id}-frequency`;
        frequencyLabel.textContent = 'Trigger';
        const frequency = doc.createElement('div');
        frequency.className = 'vela-ac-frequency';
        frequency.setAttribute('role', 'group');
        frequency.setAttribute('aria-labelledby', frequencyLabel.id);
        for (const value of ['once', 'each'] as const) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-ac-opt';
            b.textContent = FREQUENCY_LABELS[value];
            b.addEventListener('click', () => { this.frequency = value; this.refresh(); });
            this.freq.set(value, b);
            frequency.appendChild(b);
        }
        this.create = doc.createElement('button');
        this.create.type = 'button';
        this.create.className = 'vela-ac-create';
        this.create.append(iconEl(opts.mode === 'edit' ? 'save' : 'bell', doc), doc.createTextNode(opts.mode === 'edit' ? 'Save changes' : 'Create alert'));
        this.create.addEventListener('click', () => this.submit());
        this.feedback = doc.createElement('div');
        this.feedback.className = 'vela-ac-feedback';
        this.feedback.setAttribute('role', 'status');
        const note = doc.createElement('div');
        note.className = 'vela-ac-note';
        note.textContent = opts.mode === 'edit'
            ? 'Saving keeps the current status and trigger history. Resume or re-arm separately.'
            : 'Price alerts are checked while this chart receives data. Alerts are saved with the layout.';
        this.el.append(target, this.warning, conditionLabel, this.select, this.valueLabel, this.input, this.hint, this.barsWrap, frequencyLabel, frequency, this.create, this.feedback, note);
        opts.host.appendChild(this.el);
        this.conditionControl = new AlertSelect(this.select);
        this.refresh();
    }

    closeMenus(): void { this.conditionControl.close(); }
    destroy(): void { this.conditionControl.destroy(); }

    /** Start a fresh draft on the active identity, optionally from a drawing. */
    bind(prefill?: AlertDrawingPrefill): void {
        this.bound = this.opts.target();
        this.source = prefill ?? null;
        this.select.value = 'cross';
        this.condition = 'cross';
        this.frequency = 'once';
        this.barsInput.value = String(DEFAULT_MOVE_BARS);
        this.input.value = prefill ? initialValue(prefill.value) : '';
        this.valueTouched = false;
        this.seeded = !!prefill;
        this.feedback.textContent = '';
        this.refresh();
    }

    /** Edit the original chart-bound request, without overwriting the Create draft. */
    bindEdit(request: AlertRequest, target: AlertTarget, sourceLabel = 'Drawing'): void {
        this.bound = { ...target };
        this.source = request.source ? { ...request.source, value: request.value, label: sourceLabel } : null;
        this.select.value = request.condition;
        this.condition = request.condition;
        this.frequency = request.frequency;
        this.barsInput.value = String(request.bars);
        this.input.value = initialValue(request.value);
        this.valueTouched = true;
        this.seeded = true;
        this.feedback.textContent = '';
        this.refresh();
    }

    /** Rebase only a pristine auto-filled level when replay jumps in time. */
    reseedUntouchedPrice(): void {
        if (!this.valueTouched && !this.source && !isMoveCondition(this.condition)) this.seeded = false;
        this.refresh();
    }

    /** Refresh metadata/validation without replacing an input or disrupting a draft. */
    refresh(): void {
        const current = this.opts.target();
        if (!this.bound && current) this.bound = { ...current };
        const bound = this.bound;
        const match = sameTarget(bound, current);
        const moving = isMoveCondition(this.select.value as AlertCondition);
        const sourceLevel = bound && match && this.source
            ? (this.opts.drawingLevel?.(bound, this.source.drawingId) ?? (this.opts.drawingLevel ? null : this.source.value))
            : null;
        const sourceMissing = !!this.source && match && sourceLevel == null;
        this.targetTitle.textContent = bound ? `${bound.symbol}${bound.timeframe ? ` · ${timeframeLabel(bound.timeframe)}` : ''}` : 'No active chart';
        this.targetTitle.title = this.targetTitle.textContent;
        this.targetDetail.textContent = bound ? `${match ? current!.chartLabel : bound.chartLabel}${this.source ? ` · ${this.source.label}` : ' · Price'}` : 'Select a chart to create an alert';
        this.targetDetail.title = this.targetDetail.textContent;
        this.warning.hidden = !!bound && match && !sourceMissing && !current?.loading;
        this.rebind.hidden = this.opts.mode === 'edit' || !bound || (match && !sourceMissing);
        this.warningText.textContent = !bound || !current ? 'Select an active chart to continue.'
            : !match ? `The active chart changed to ${current.symbol}${current.timeframe ? ` · ${timeframeLabel(current.timeframe)}` : ''}${(current.session ?? 'regular') !== (bound?.session ?? 'regular') ? ` · ${current.session === 'extended' ? 'Extended' : 'Regular'} session` : ''}. ${this.opts.mode === 'edit' ? 'Return to the original chart and market to save.' : 'Review the new target before creating.'}`
                : sourceMissing ? 'The drawing is no longer available at this bar.'
                    : current.loading ? 'Waiting for the active chart to load.' : '';
        this.rebind.textContent = sourceMissing && match ? 'Use chart price instead' : 'Use active chart';
        for (const option of Array.from(this.select.options)) option.disabled = !!this.source && isMoveCondition(option.value as AlertCondition);
        this.conditionControl.sync();
        this.input.readOnly = !!this.source;
        this.valueLabel.textContent = moving ? 'Move amount' : 'Level';
        this.input.setAttribute('aria-label', moving ? 'Move amount' : 'Alert level');
        this.input.placeholder = moving ? (this.select.value.endsWith('-pct') ? 'e.g. 1.5' : 'e.g. 2.00') : '';
        this.barsWrap.hidden = !moving;
        if (this.source && sourceLevel != null) {
            this.input.value = initialValue(sourceLevel);
            this.seeded = true;
        } else if (!this.source && !moving && !this.seeded && !this.valueTouched && match && !current?.loading && current?.price != null && Number.isFinite(current.price)) {
            this.input.value = initialValue(current.price);
            this.seeded = true;
        }
        const value = numberFrom(this.input.value);
        const bars = numberFrom(this.barsInput.value);
        const barsValid = bars != null && Number.isInteger(bars) && bars >= 1 && bars <= 500;
        if (this.source) this.hint.textContent = 'The level follows this drawing.';
        else if (moving) this.hint.textContent = !barsValid ? 'Enter a whole number of bars from 1 to 500.' : this.select.value.endsWith('-pct') ? 'Enter a percentage greater than zero.' : 'Enter a price move greater than zero.';
        else if (match && current?.price != null && current.price !== 0 && value != null) {
            const pct = (value - current.price) / current.price * 100;
            this.hint.textContent = Math.abs(pct) < .0001 ? 'At current price' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}% from current price`;
        } else this.hint.textContent = 'Enter the price level to watch.';
        for (const [freq, button] of this.freq) button.setAttribute('aria-pressed', String(freq === this.frequency));
        this.create.disabled = !bound || !current || !match || !!current.loading || sourceMissing || value == null || (moving && (value <= 0 || !barsValid));
    }

    private submit(): void {
        // Recheck the live identity and drawing even when a click follows an async market
        // switch before the next paint. Never arm the draft on a different chart silently.
        this.refresh();
        const target = this.opts.target();
        const value = numberFrom(this.input.value);
        const bars = numberFrom(this.barsInput.value);
        if (this.create.disabled || !sameTarget(this.bound, target) || !this.bound || value == null) return;
        const request: AlertRequest = {
            condition: this.select.value as AlertCondition,
            value,
            frequency: this.frequency,
            bars: bars != null && Number.isInteger(bars) && bars >= 1 && bars <= 500 ? bars : DEFAULT_MOVE_BARS,
            ...(this.source ? { source: { drawingId: this.source.drawingId } } : {}),
        };
        if (this.opts.onCreate(request, this.bound)) this.feedback.textContent = this.opts.mode === 'edit' ? 'Alert updated.' : 'Alert created. Manage it in Alerts.';
        else { this.feedback.textContent = `Alert could not be ${this.opts.mode === 'edit' ? 'saved' : 'created'}. Review the active chart and try again.`; this.refresh(); }
    }
}

/** Backwards-compatible standalone sheet for integrations that still use it directly. */
export interface AlertCreateOptions {
    host: HTMLElement;
    symbol: () => string;
    currentPrice: () => number | null;
    onCreate: (request: AlertRequest) => boolean;
    onOpenChange?: (open: boolean) => void;
}
export class AlertCreateSheet {
    private readonly drawer: Drawer;
    private readonly form: AlertCreateForm;
    constructor(opts: AlertCreateOptions) {
        this.drawer = new Drawer({ host: opts.host, title: 'Create alert', onOpenChange: (open) => {
            if (!open) this.form?.closeMenus();
            opts.onOpenChange?.(open);
        } });
        this.form = new AlertCreateForm({
            host: this.drawer.body,
            target: () => ({ cellId: 'sheet', symbol: opts.symbol(), timeframe: '', chartLabel: 'Active chart', price: opts.currentPrice() }),
            onCreate: (request) => { const ok = opts.onCreate(request); if (ok) this.drawer.hide(); return ok; },
        });
    }
    open(prefill?: AlertDrawingPrefill): void { this.form.bind(prefill); this.drawer.show(); }
    close(): void { this.drawer.hide(); }
    destroy(): void { this.form.destroy(); this.drawer.destroy(); }
}
