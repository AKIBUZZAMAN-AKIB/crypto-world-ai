// Color-picker VIEW — swatch grid + recents + opacity slider, plus the field trigger.
import type { VelaTheme } from '../../../core/options';
import { ACCENT, BEARISH, BULLISH, NEUTRAL, WARNING } from '../../../core/palette';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { enableCompactHorizontalStrip } from '../../scrolling';
import { Popover, closeOpenPopovers, openPopoverTrigger, openPopoverElement, type PopoverBoundary, type PopoverOptions } from '../popover';
import {
    buildPalette,
    combineColor,
    splitColor,
    transparencyChecker,
    type ColorFieldShape,
} from './controller';
import { COLOR_CSS, COLOR_STYLE_ID } from './styles';

const PALETTE = buildPalette();
const CHECKER = transparencyChecker(10);
const FIELD_CHECKER = transparencyChecker(8);

/** Session-shared recently-picked colors (most-recent first). */
const recents: string[] = [ACCENT, BULLISH, BEARISH, WARNING, NEUTRAL];
let colorPopoverSequence = 0;

/** Remember a user-selected color (without opacity) across picker instances this session. */
export function rememberRecentColor(color: string): void {
    const hex6 = splitColor(color).hex6;
    const i = recents.findIndex((c) => c.toLowerCase() === hex6.toLowerCase());
    if (i >= 0) recents.splice(i, 1);
    recents.unshift(hex6);
    if (recents.length > 10) recents.length = 10;
}

/**
 * When the opacity slider hands its value to `onChange` during a drag: `'live'` on every
 * pointer move (the consumer repaints cheaply, so the chart previews the drag), `'release'`
 * once on pointerup/pointercancel (the consumer recomputes — a script re-runs over its whole
 * history, so a per-move commit would queue seconds of work behind the pointer). The knob,
 * gradient and percentage follow the pointer either way; swatch picks always emit at once.
 */
export type ColorCommit = 'live' | 'release';

export interface ColorPickerOptions {
    commit?: ColorCommit;
    /** Hide the opacity editor while preserving alpha when only hue is editable. */
    showOpacity?: boolean;
}

/**
 * A self-contained color picker: a swatch grid, automatically updated recents, a
 * current-color well for custom colors, and an opacity slider. Emits `#RRGGBB` /
 * `#RRGGBBAA` through `onChange`. The native custom chooser stays mounted while it streams.
 */
export function buildColorPicker(color: string, theme: VelaTheme, onChange: (v: string) => void, options: ColorPickerOptions = {}): HTMLElement {
    // The drawing toolbar also builds this picker without first constructing a ColorField.
    if (typeof Document !== 'undefined' && document instanceof Document) injectStyles(COLOR_STYLE_ID, COLOR_CSS, document);
    const commit: ColorCommit = options.commit ?? 'live';
    const parsed = splitColor(color);
    let curHex = parsed.hex6;
    let curAlpha = parsed.alpha;

    const root = document.createElement('div');
    root.className = 'vela-color-picker';
    root.setAttribute('data-vela-no-tip', '');
    root.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:236px;max-width:100%;min-width:0;box-sizing:border-box;';

    const grid = document.createElement('div');
    grid.className = 'vela-color-palette';
    // Ten columns on normal widths; collapse to eight before targets get too tightly
    // packed on very narrow phones. The 4px gaps keep neighboring hit areas distinct.
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(20px,100%),1fr));gap:4px;';
    const swatches: HTMLButtonElement[] = [];
    for (const row of PALETTE) {
        for (const c of row) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.dataset.c = c;
            sw.setAttribute('aria-label', `Color ${c}`);
            sw.style.cssText = `width:100%;aspect-ratio:1;border-radius:0;border:none;cursor:pointer;background:${c};padding:0;`;
            sw.addEventListener('click', (e) => {
                e.stopPropagation();
                pickHex(c);
            });
            grid.appendChild(sw);
            swatches.push(sw);
        }
    }
    const paintSelection = (): void => {
        for (const sw of swatches) {
            const on = (sw.dataset.c ?? '').toLowerCase() === curHex.toLowerCase();
            sw.setAttribute('aria-pressed', String(on));
            sw.style.outline = on ? `2px solid var(--vela-fg-bright, ${theme.textColor})` : 'none';
            sw.style.outlineOffset = '2px';
            sw.style.zIndex = on ? '1' : '';
            sw.style.position = on ? 'relative' : '';
        }
    };

    const recentRow = document.createElement('div');
    recentRow.style.cssText = 'display:flex;align-items:center;gap:4px;min-width:0;border-top:1px solid var(--vela-border);padding-top:6px;';
    // Keep recent swatches separate from the native input: rebuilding the swatches
    // must never detach the input while its browser color chooser is open.
    const recentSwatches = document.createElement('div');
    recentSwatches.className = 'vela-color-recents';
    recentSwatches.setAttribute('role', 'group');
    recentSwatches.setAttribute('aria-label', 'Recent colors');
    recentSwatches.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;padding:2px;overflow-x:auto;scrollbar-width:thin;overscroll-behavior-x:contain;';
    enableCompactHorizontalStrip(recentSwatches);
    const customWell = document.createElement('label');
    customWell.className = 'vela-color-custom';
    customWell.style.cssText = `box-sizing:border-box;width:24px;max-width:100%;height:24px;flex:none;border-radius:0;border:1px solid var(--vela-border-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;background:${curHex};`;
    const editBadge = document.createElement('span');
    editBadge.style.cssText = 'display:flex;align-items:center;justify-content:center;width:16px;height:16px;box-sizing:border-box;background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.7);pointer-events:none;';
    const editIcon = iconEl('pen');
    editIcon.style.cssText += ';width:11px;height:11px;color:#fff;background-color:currentColor;pointer-events:none;';
    editBadge.appendChild(editIcon);
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.setAttribute('aria-label', 'Custom color');
    customInput.value = curHex;
    customInput.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;';
    customInput.addEventListener('focus', () => { customWell.style.outline = '2px solid var(--vela-fg-bright)'; });
    customInput.addEventListener('blur', () => { customWell.style.outline = 'none'; });
    // `input` streams a live preview; `change` adds only the committed color to recents.
    customInput.addEventListener('input', () => previewHex(customInput.value));
    customInput.addEventListener('change', () => pickHex(customInput.value));
    customWell.append(editBadge, customInput);
    recentRow.append(recentSwatches, customWell);
    const renderRecents = (focusColor?: string): void => {
        recentSwatches.replaceChildren();
        let restore: HTMLButtonElement | null = null;
        for (const c of recents) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.dataset.recentColor = c;
            sw.setAttribute('aria-label', `Recent color ${c}`);
            sw.setAttribute('aria-pressed', String(c.toLowerCase() === curHex.toLowerCase()));
            sw.style.cssText = `width:20px;height:20px;flex:none;border-radius:0;border:1px solid var(--vela-border);cursor:pointer;background:${c};padding:0;`;
            sw.addEventListener('click', (e) => {
                e.stopPropagation();
                pickHex(c, document.activeElement === sw);
            });
            recentSwatches.appendChild(sw);
            if (c === focusColor) restore = sw;
        }
        recentSwatches.scrollLeft = 0;
        restore?.focus({ preventScroll: true });
    };
    const paintRecents = (): void => {
        for (const sw of [...recentSwatches.children] as HTMLButtonElement[]) {
            sw.setAttribute('aria-pressed', String(sw.dataset.recentColor?.toLowerCase() === curHex.toLowerCase()));
        }
    };

    const opLabel = document.createElement('span');
    opLabel.className = 'vela-color-opacity-label';
    opLabel.textContent = 'Opacity';
    opLabel.style.cssText = `flex:none;font:11px ${theme.fontFamily};color:var(--vela-fg-muted);`;
    const opRow = document.createElement('div');
    opRow.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;';
    const track = document.createElement('div');
    track.className = 'vela-color-opacity-track';
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Opacity');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.style.cssText = 'flex:1;min-width:min(24px,100%);position:relative;height:24px;border-radius:0;cursor:pointer;touch-action:none;';
    const rail = document.createElement('div');
    rail.className = 'vela-color-opacity-rail';
    rail.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:13px;transform:translateY(-50%);pointer-events:none;';
    const knob = document.createElement('div');
    knob.className = 'vela-color-opacity-thumb';
    // The handle must not inherit the selected accent: its track can be that same hue.
    knob.style.cssText = 'position:absolute;top:50%;width:15px;height:15px;border-radius:50%;background:var(--vela-fg-bright);box-shadow:0 0 0 1px var(--vela-bg),0 1px 3px rgba(0,0,0,0.55);transform:translate(-50%,-50%);pointer-events:none;';
    track.append(rail, knob);
    const pctBox = document.createElement('input');
    pctBox.type = 'text';
    pctBox.inputMode = 'numeric';
    pctBox.setAttribute('aria-label', 'Opacity percentage');
    pctBox.style.cssText = `width:46px;max-width:100%;min-height:28px;box-sizing:border-box;text-align:center;font:var(--vela-font-size-md) ${theme.fontFamily};color:var(--vela-fg);background:transparent;border:1px solid var(--vela-border);border-radius:0;padding:3px 4px;outline:none;`;
    pctBox.addEventListener('focus', () => {
        pctBox.style.borderColor = 'var(--vela-border-strong)';
        pctBox.select();
    });
    opRow.append(opLabel, track, pctBox);
    const paintOpacity = (): void => {
        rail.style.background = `linear-gradient(to right, ${curHex}00, ${curHex}ff), ${CHECKER}`;
        knob.style.left = `${curAlpha * 100}%`;
        const percent = Math.round(curAlpha * 100);
        pctBox.value = `${percent}%`;
        track.setAttribute('aria-valuenow', String(percent));
        track.setAttribute('aria-valuetext', `${percent}% opacity`);
    };
    // A typed value is one discrete edit, so it commits once under either `commit` policy.
    // Unparseable input snaps back to the current opacity.
    const commitTyped = (): void => {
        pctBox.style.borderColor = 'var(--vela-border)';
        const n = parseFloat(pctBox.value.replace('%', ''));
        if (Number.isFinite(n)) {
            const next = Math.max(0, Math.min(100, n)) / 100;
            if (Math.round(next * 100) !== Math.round(curAlpha * 100)) {
                curAlpha = next;
                paintOpacity();
                emit();
                return;
            }
        }
        paintOpacity();
    };
    pctBox.addEventListener('change', commitTyped);
    pctBox.addEventListener('blur', () => {
        // `change` does not fire when the text is unchanged; still restore the "%" readout.
        pctBox.style.borderColor = 'var(--vela-border)';
        paintOpacity();
    });
    pctBox.addEventListener('keydown', (e) => {
        // Typing must not reach chart/dialog shortcuts; Escape stays with the popover.
        if (e.key === 'Escape') return;
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            commitTyped();
            pctBox.blur();
        }
    });
    // The drag always previews (knob, readout, gradient); whether each move also COMMITS is
    // the `commit` option — see {@link ColorCommit}.
    let dragging = false;
    const onDrag = (clientX: number): void => {
        const r = track.getBoundingClientRect();
        curAlpha = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        paintOpacity();
        if (commit === 'live') emit();
    };
    const endDrag = (): void => {
        if (!dragging) return;
        dragging = false;
        if (commit === 'release') emit();
    };
    track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        dragging = true;
        track.setPointerCapture(e.pointerId);
        onDrag(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (dragging) onDrag(e.clientX);
    });
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('keydown', (e) => {
        const percent = Math.round(curAlpha * 100);
        let next: number;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = 100;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = percent + (e.shiftKey ? 10 : 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = percent - (e.shiftKey ? 10 : 1);
        else return;
        e.preventDefault();
        e.stopPropagation();
        curAlpha = Math.max(0, Math.min(100, next)) / 100;
        paintOpacity();
        emit();
    });

    function emit(): void {
        onChange(combineColor(curHex, curAlpha));
    }
    function previewHex(hex: string): void {
        curHex = splitColor(hex).hex6;
        customWell.style.background = curHex;
        paintSelection();
        paintRecents();
        paintOpacity();
        emit();
    }
    function pickHex(hex: string, restoreFocus = false): void {
        previewHex(hex);
        rememberRecentColor(curHex);
        customInput.value = curHex;
        // Update immediately for palette, recent and committed custom picks alike.
        // A keyboard-activated recent is recreated, so return focus to its new node.
        renderRecents(restoreFocus ? curHex : undefined);
    }

    // A host can refresh the source color while this picker stays open. Preserve text
    // currently being typed, and do not emit another edit in response to synchronization.
    root.addEventListener('vela-color-sync', (event) => {
        const value = (event as CustomEvent<string>).detail;
        if (typeof value !== 'string') return;
        const next = splitColor(value);
        if (next.hex6 === curHex && next.alpha === curAlpha) return;
        curHex = next.hex6;
        curAlpha = next.alpha;
        const typed = document.activeElement === pctBox ? pctBox.value : null;
        customInput.value = curHex;
        customWell.style.background = curHex;
        paintSelection();
        paintRecents();
        paintOpacity();
        if (typed !== null) pctBox.value = typed;
    });
    renderRecents();
    paintSelection();
    paintOpacity();
    root.append(grid, recentRow);
    if (options.showOpacity !== false) root.append(opRow);
    return root;
}

export interface ColorFieldOpts {
    shape?: ColorFieldShape;
    theme: VelaTheme;
    getVal: () => string;
    onVal: (v: string) => void;
    id?: string;
    popover?: Pick<PopoverOptions, 'host' | 'position' | 'boundary' | 'zIndex' | 'gap' | 'align'>;
    /** Opacity-drag commit policy of the popover picker (default `'live'`) — see {@link ColorCommit}. */
    commit?: ColorCommit;
    showOpacity?: boolean;
}

/** Closed-state swatch shape. `circle` is the settings-dialog preview (a square chip
 *  inset from a matching field border); `square` is the compact drawing-chrome swatch. */
export function colorField(
    theme: VelaTheme,
    getVal: () => string,
    onVal: (v: string) => void,
    opts?: { shape?: ColorFieldShape; id?: string; popover?: ColorFieldOpts['popover']; commit?: ColorCommit; showOpacity?: boolean },
): HTMLElement {
    return new ColorField({ theme, getVal, onVal, shape: opts?.shape, id: opts?.id, popover: opts?.popover, commit: opts?.commit, showOpacity: opts?.showOpacity }).el;
}

export class ColorField {
    readonly el: HTMLButtonElement;
    private readonly swatch: HTMLElement;
    private readonly getVal: () => string;
    private readonly onVal: (v: string) => void;
    private readonly theme: VelaTheme;
    private readonly popoverOpts: ColorFieldOpts['popover'];
    private readonly commit: ColorCommit | undefined;
    private readonly showOpacity: boolean | undefined;

    constructor(opts: ColorFieldOpts) {
        injectStyles(COLOR_STYLE_ID, COLOR_CSS, document);
        this.theme = opts.theme;
        this.getVal = opts.getVal;
        this.onVal = opts.onVal;
        this.popoverOpts = opts.popover;
        this.commit = opts.commit;
        this.showOpacity = opts.showOpacity;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.setAttribute('aria-label', 'Choose color');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        if (opts.id) trigger.id = opts.id;
        trigger.className = opts.shape === 'circle' ? 'vela-color-field vela-color-field-circle' : 'vela-color-field';
        const swatch = document.createElement('span');
        swatch.className = 'vela-color-field-swatch';
        trigger.appendChild(swatch);
        this.el = trigger;
        this.swatch = swatch;
        this.paint();
        trigger.addEventListener('vela-sync', () => {
            this.paint();
            if (openPopoverTrigger() === trigger) {
                const picker = openPopoverElement()?.querySelector('.vela-color-picker');
                picker?.dispatchEvent(new CustomEvent('vela-color-sync', { detail: this.getVal() }));
            }
        });
        // Suppress mouse focus scrolling when this press dismisses another popover.
        // Do not cancel touch/pen pointerdown: WebKit otherwise drops the ensuing click.
        trigger.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse') return;
            e.preventDefault();
            trigger.focus({ preventScroll: true });
        });
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(e.detail === 0);
        });
    }

    private paint(): void {
        const v = this.getVal();
        this.swatch.style.background = `linear-gradient(${v}, ${v}), ${FIELD_CHECKER}`;
    }

    private toggle(fromKeyboard = false): void {
        if (openPopoverTrigger() === this.el) {
            closeOpenPopovers();
            return;
        }
        const pop = new Popover({
            trigger: this.el,
            theme: this.theme,
            align: this.popoverOpts?.align ?? 'end',
            gap: this.popoverOpts?.gap ?? 6,
            // Color surfaces must escape both a clipped chart cell and an embedded
            // workspace: position against the visible viewport, but never outside it.
            host: this.popoverOpts?.host ?? this.el.ownerDocument.body,
            position: this.popoverOpts?.position ?? 'fixed',
            boundary: (this.popoverOpts?.boundary ?? 'viewport') as PopoverBoundary,
            fitWithinBoundary: true,
            restoreFocusOnEscape: true,
            onClose: () => {
                this.el.setAttribute('aria-expanded', 'false');
                this.el.removeAttribute('aria-controls');
            },
            zIndex: this.popoverOpts?.zIndex,
            className: 'vela-color-field-pop',
            content: buildColorPicker(
                this.getVal(),
                this.theme,
                (val) => {
                    this.onVal(val);
                    this.paint();
                },
                { commit: this.commit, showOpacity: this.showOpacity },
            ),
        });
        pop.el.id = `vela-color-picker-${++colorPopoverSequence}`;
        pop.el.setAttribute('role', 'dialog');
        pop.el.setAttribute('aria-label', 'Color picker');
        pop.show();
        this.el.setAttribute('aria-expanded', 'true');
        this.el.setAttribute('aria-controls', pop.el.id);
        if (fromKeyboard) {
            const selected = pop.el.querySelector<HTMLButtonElement>('.vela-color-palette button[aria-pressed="true"]')
                ?? pop.el.querySelector<HTMLButtonElement>('.vela-color-palette button');
            selected?.focus({ preventScroll: true });
            pop.reposition();
        }
    }
}

/** Close any open color (or other kit) popover — dialog teardown. */
export function closeColorPopover(): void {
    closeOpenPopovers();
}
