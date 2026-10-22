// Bar-replay chrome — the floating transport bar a replay session wears, and the
// "click a bar" hint that arms one. TWO surfaces, one root, exactly one showing at a
// time: the HINT while the entry menu waits for a click, the BAR while a session runs.
//
// The component is a pure VIEW: every press reports out through its callbacks, and
// `setState` paints whatever the caller's replay session says. It never touches a
// chart — the workspace owns `ws.replay`, the entry menu and the date picker, so the
// public replay API stays the single source of truth (and a session started from
// code, a contribution or a shortcut wears the same bar).
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';

/** The nine paces TradingView's replay toolbar offers, in ms per revealed update. */
export const REPLAY_SPEEDS = [100, 250, 500, 1_000, 2_000, 3_000, 5_000, 10_000, 30_000] as const;

/** The default pace a fresh session starts on (1 s per bar). */
export const REPLAY_DEFAULT_SPEED = 1_000;

/** `100` → `'0.1s'`, `1000` → `'1s'`, `30000` → `'30s'` — the label the speed menu shows. */
export function replaySpeedLabel(ms: number): string {
    const seconds = ms / 1_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(2).replace(/0$/, '')}s`;
}

/** `'2024-06-03 14:00'` — the replay clock, in the viewer's local zone (the chart's own
 *  time axis may run another zone; this is the session's wall clock, like TradingView's
 *  replay date readout). Cleanly formatted from parts, never `toLocaleString` (its
 *  output moves with the locale, which would make the label untestable). */
export function formatReplayClock(time: number): string {
    const d = new Date(time);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface ReplayToolbarOptions {
    /** Mount point — the workspace grid (the bar floats over the plot, top-center). */
    host: HTMLElement;
    /** Play/pause pressed (the active control's meaning flips with `state.playing`). */
    onPlayPause: () => void;
    /** Step one update forward. */
    onStep: () => void;
    /** A pace was picked from the speed menu. */
    onSpeed: (intervalMs: number) => void;
    /** Jump back to live data (leaves the replay). */
    onJumpToRealtime: () => void;
    /** ✕ — leave the replay. */
    onExit: () => void;
    /** The armed hint's ✕ / `Esc` — cancel the pending "select bar". */
    onCancelArm?: () => void;
}

/** What the toolbar paints. `speedMs` is the pace the host will play at when paused
 *  (the session's own `intervalMs` only exists while a replay is running). */
export interface ReplayToolbarState {
    active: boolean;
    playing: boolean;
    cursorTime: number | null;
    remaining: number;
    speedMs: number;
}

const STYLE_ID = 'vela-widget-replay-toolbar';
const CSS = `
/* Floats over the PLOT, above the time axis and clear of every cell's top-left chrome
   (the status line, its OHLC rows, the legend) — the row the toasts use, so the two never
   fight for the same strip. z-index 12 sits above the in-cell overlays (status line 10,
   attribution 11) and below the toasts (30). */
.vela-replay { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 12; display: flex; pointer-events: none; }
.vela-replay[hidden] { display: none !important; }
.vela-replay-bar, .vela-replay-hint {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 999px;
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md, 12px);
    line-height: 1;
    white-space: nowrap;
}
.vela-replay-bar[hidden], .vela-replay-hint[hidden] { display: none !important; }
.vela-replay-hint { gap: var(--vela-space-2, 8px); padding: 6px 6px 6px 14px; }
.vela-replay-btn {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-replay-btn svg { display: block; }
.vela-replay-btn:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-replay-btn:focus-visible { outline: 2px solid var(--vela-accent); outline-offset: -2px; }
.vela-replay-btn[data-primary='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-replay-speed {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding: 0 4px 0 8px;
    border-radius: 999px;
    color: var(--vela-fg);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.vela-replay-speed:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-replay-speed svg { font-size: 12px; color: var(--vela-fg-muted); }
.vela-replay-sep { width: 1px; height: 14px; margin: 0 2px; background: var(--vela-border-strong); }
.vela-replay-clock { padding: 0 4px; font-variant-numeric: tabular-nums; color: var(--vela-fg-bright); }
.vela-replay-left { padding-right: 6px; color: var(--vela-fg-muted); font-variant-numeric: tabular-nums; }
.vela-replay-hint-text { color: var(--vela-fg-bright); }
.vela-replay-hint-key { color: var(--vela-fg-muted); }
/* Armed "select bar": every plot in the grid shows the crosshair cursor, whatever the
   renderer painted on its own canvas (hence the !important — the canvas cursor is set
   inline by the renderer's hover logic). */
.vela-ws-grid[data-replay-arm='1'] canvas { cursor: crosshair !important; }
/* "Select date" opens the kit's DatePicker inside a bare Popover shell (the kit lets the
   host own the surface), so the replay chrome supplies it: one card, the same edge the
   transport pill wears. */
.vela-replay-cal {
    padding: 10px 12px;
    border: 1px solid var(--vela-border-strong);
    border-radius: var(--vela-radius-md, 8px);
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    color: var(--vela-fg);
    user-select: none;
}
`;

/** The class the replay date calendar's popover shell wears (styled by the sheet above). */
export const REPLAY_CALENDAR_CLASS = 'vela-replay-cal';

/**
 * The floating replay chrome: an armed HINT pill ("click a bar…") and a transport BAR
 * (play/pause, step, speed, clock, bars left, jump-to-realtime, exit). Both live in one
 * absolutely-positioned root over the grid; `hidden` on the root means neither shows.
 */
export class ReplayToolbar {
    readonly el: HTMLDivElement;
    private readonly bar: HTMLDivElement;
    private readonly hint: HTMLDivElement;
    private readonly playBtn: HTMLButtonElement;
    private readonly stepBtn: HTMLButtonElement;
    private readonly speedBtn: HTMLButtonElement;
    private readonly speedLabelEl: HTMLSpanElement;
    private readonly clockEl: HTMLSpanElement;
    private readonly leftEl: HTMLSpanElement;
    private readonly speedMenu: Menu;
    private readonly tooltips: Tooltip[] = [];
    /** The play button's tooltip — its wording follows the button (Play ⇄ Pause). */
    private playTip: Tooltip | null = null;
    private readonly offMenu: () => void;
    /** The entry menu awaits a click on a bar — the hint pill replaces the transport. */
    private armed = false;
    private speed = REPLAY_DEFAULT_SPEED;
    private state: ReplayToolbarState = { active: false, playing: false, cursorTime: null, remaining: 0, speedMs: REPLAY_DEFAULT_SPEED };

    constructor(private readonly opts: ReplayToolbarOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        const btn = (cls: string, icon: string, tip: string, onClick: () => void, primary = false, keepTip?: (t: Tooltip) => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = `vela-replay-btn ${cls}`;
            if (primary) b.dataset.primary = '1';
            b.setAttribute('aria-label', tip);
            b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            const tooltip = new Tooltip(b, { content: tip, triggerId: `vela-${cls.replace('vela-', '')}`, host: opts.host });
            this.tooltips.push(tooltip);
            keepTip?.(tooltip);
            return b;
        };

        this.playBtn = btn('vela-replay-play', 'play', 'Play', () => opts.onPlayPause(), true, (t) => (this.playTip = t));
        this.stepBtn = btn('vela-replay-step', 'step-forward', 'Step forward', () => opts.onStep());
        this.clockEl = doc.createElement('span');
        this.clockEl.className = 'vela-replay-clock';
        this.leftEl = doc.createElement('span');
        this.leftEl.className = 'vela-replay-left';
        this.speedLabelEl = doc.createElement('span');
        this.speedLabelEl.textContent = replaySpeedLabel(REPLAY_DEFAULT_SPEED);
        this.speedBtn = doc.createElement('button');
        this.speedBtn.type = 'button';
        this.speedBtn.className = 'vela-replay-speed';
        this.speedBtn.setAttribute('aria-label', 'Replay speed');
        this.speedBtn.append(this.speedLabelEl, iconEl('chevron-down', doc));
        this.tooltips.push(new Tooltip(this.speedBtn, { content: 'Replay speed', triggerId: 'vela-replay-speed', host: opts.host }));

        const sep = (): HTMLSpanElement => {
            const s = doc.createElement('span');
            s.className = 'vela-replay-sep';
            return s;
        };
        this.bar = doc.createElement('div');
        this.bar.className = 'vela-replay-bar';
        this.bar.hidden = true;
        this.bar.append(
            this.playBtn,
            this.stepBtn,
            this.speedBtn,
            sep(),
            this.clockEl,
            this.leftEl,
            sep(),
            btn('vela-replay-live', 'jump-realtime', 'Jump to real time', () => opts.onJumpToRealtime()),
            btn('vela-replay-exit', 'close', 'Exit replay', () => opts.onExit()),
        );

        const hintText = doc.createElement('span');
        hintText.className = 'vela-replay-hint-text';
        hintText.textContent = 'Click a bar to start the replay';
        const hintKey = doc.createElement('span');
        hintKey.className = 'vela-replay-hint-key';
        hintKey.textContent = 'Esc to cancel';
        this.hint = doc.createElement('div');
        this.hint.className = 'vela-replay-hint';
        this.hint.hidden = true;
        this.hint.append(hintText, hintKey);
        const cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'vela-replay-btn vela-replay-cancel';
        cancel.setAttribute('aria-label', 'Cancel bar selection');
        cancel.appendChild(iconEl('close', doc));
        cancel.addEventListener('click', () => opts.onCancelArm?.());
        this.hint.appendChild(cancel);

        this.el = doc.createElement('div');
        this.el.className = 'vela-replay';
        this.el.hidden = true;
        this.el.append(this.hint, this.bar);
        opts.host.appendChild(this.el);

        this.speedMenu = new Menu({
            trigger: this.speedBtn,
            triggerId: 'vela-replay-speed',
            host: opts.host,
            placement: 'bottom-start',
            items: this.speedItems(),
            onSelect: (id) => {
                const ms = Number(id);
                if (!Number.isFinite(ms) || ms <= 0) return;
                this.speed = ms;
                this.speedLabelEl.textContent = replaySpeedLabel(ms);
                this.speedMenu.setItems(this.speedItems());
                opts.onSpeed(ms);
            },
        });
        this.offMenu = () => this.speedMenu.destroy();
        this.paint();
    }

    /** Paint the session's state. Idempotent — every replay event funnels through here. */
    setState(next: Partial<ReplayToolbarState>): void {
        const prev = this.state;
        this.state = { ...prev, ...next };
        if (next.speedMs !== undefined && next.speedMs !== this.speed) {
            this.speed = next.speedMs;
            this.speedLabelEl.textContent = replaySpeedLabel(this.speed);
            this.speedMenu.setItems(this.speedItems());
        }
        this.paint();
    }

    /** Show the "click a bar" hint (armed), or hand the pill back to the session state. */
    setArmed(armed: boolean): void {
        this.armed = armed;
        this.paint();
    }

    destroy(): void {
        this.offMenu();
        for (const t of this.tooltips) t.destroy();
        this.el.remove();
    }

    private paint(): void {
        const s = this.state;
        const showBar = s.active && !this.armed;
        this.bar.hidden = !showBar;
        this.hint.hidden = !this.armed;
        this.el.hidden = !showBar && !this.armed;
        if (!showBar) return;
        this.playBtn.replaceChildren(iconEl(s.playing ? 'pause' : 'play', this.el.ownerDocument));
        this.playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
        this.playTip?.setContent(s.playing ? 'Pause' : 'Play');
        this.clockEl.textContent = s.cursorTime == null ? '—' : formatReplayClock(s.cursorTime);
        this.leftEl.textContent = s.remaining === 1 ? '1 bar left' : `${s.remaining} bars left`;
        this.speedLabelEl.textContent = replaySpeedLabel(s.speedMs);
    }

    private speedItems(): MenuItemDescriptor[] {
        return REPLAY_SPEEDS.map((ms) => ({ id: String(ms), label: replaySpeedLabel(ms), checked: ms === this.speed }));
    }
}
