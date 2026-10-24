// The Pine editor page: a code editor on the left, a live chart on the right.
//
// This is the "input box" the workspace deliberately does not carry — a place to type or
// paste Pine Script v5/v6, run it through `vela-pine-libre` (the MIT engine registered as
// `pine`), and see the plots, drawings and trade markers on real Binance candles. A
// `strategy()` script additionally fills the Strategy tester panel, which opens from the
// topbar's panel group exactly as it does in the workspace.
//
// The page is a thin host: the editor owns text + status, the chart owns everything else.
// No parsing happens here — a failed run is reported from the engine's own error.
import { VelaWorkspace } from '../src/workspace';
import { BinanceProvider } from '../src/data/providers/binance';
import type { IndicatorHandle } from '../src/core/IndicatorHandle';
import { PINE_SCRIPTS } from './pine-scripts';
import { EDITOR_STORAGE_KEY as STORAGE_KEY } from './editor-shared';
import { PineEngine } from './vendor/pine-libre/index.js';

const DEFAULT_SCRIPT = PINE_SCRIPTS[0]?.script ?? '';

const ws = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'BTCUSDT',
    timeframe: '60',
    live: true,
    theme: 'dark',
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineEngine() },
    defaultLanguage: 'pine',
    persist: false, // the editor persists its own text; the shell starts clean each visit
});

const chart = ws.chart;

// ── DOM ────────────────────────────────────────────────────────────────────────
const code = document.querySelector('#code') as HTMLTextAreaElement;
const gutter = document.querySelector('#gutter') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
const message = document.querySelector('#message') as HTMLElement;
const runButton = document.querySelector('#run') as HTMLButtonElement;
const clearButton = document.querySelector('#clear') as HTMLButtonElement;
const examples = document.querySelector('#examples') as HTMLSelectElement;
const side = document.querySelector('#side') as HTMLElement;
const grip = document.querySelector('#grip') as HTMLElement;

// ── line numbers ───────────────────────────────────────────────────────────────
function paintGutter(): void {
    const lines = code.value.split('\n').length;
    if (gutter.childElementCount === lines) return;
    gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n');
    gutter.style.whiteSpace = 'pre';
    syncScroll();
}
function syncScroll(): void {
    gutter.scrollTop = code.scrollTop;
}
paintGutter();
code.addEventListener('scroll', syncScroll);
code.addEventListener('input', () => {
    paintGutter();
    save();
});

// ── editing niceties: Tab inserts spaces, Enter keeps the indent ───────────────
code.addEventListener('keydown', (event) => {
    const { selectionStart: start, selectionEnd: end, value } = code;

    if (event.key === 'Tab') {
        event.preventDefault();
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const indent = before.slice(lineStart).match(/^ */)?.[0].length ?? 0;
        const insert = ' '.repeat(4 - (indent % 4));
        code.setRangeText(insert, start, end, 'end');
        paintGutter();
        save();
        return;
    }

    if (event.key === 'Enter') {
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.slice(lineStart);
        const indent = line.match(/^ */)?.[0] ?? '';
        // Keep the indentation, and add one level after a block opener (`if`, `for`, …).
        const deeper = /:\s*$/.test(line.trimEnd()) ? '' : /(^|\s)(if|for|while|switch|else)\b/.test(line) && !line.trim().startsWith('//') ? '    ' : '';
        event.preventDefault();
        code.setRangeText(`\n${indent}${deeper}`, start, end, 'end');
        paintGutter();
        save();
        return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void run();
    }
});

// ── status ─────────────────────────────────────────────────────────────────────
function setStatus(text: string, kind: 'idle' | 'ok' | 'err' = 'idle'): void {
    message.textContent = text;
    status.classList.toggle('ok', kind === 'ok');
    status.classList.toggle('err', kind === 'err');
}

// ── persistence ────────────────────────────────────────────────────────────────
function save(): void {
    try {
        localStorage.setItem(STORAGE_KEY, code.value);
    } catch {
        // Private mode / storage disabled: the editor still works, it just forgets.
    }
}
function restore(): string {
    try {
        return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

// ── run ────────────────────────────────────────────────────────────────────────
let current: IndicatorHandle | null = null;
let running = false;

async function run(): Promise<void> {
    if (running) return;
    const source = code.value.trim();
    if (source === '') {
        setStatus('Nothing to run — the editor is empty.', 'err');
        return;
    }
    running = true;
    runButton.disabled = true;
    setStatus('Running…');

    // One script at a time: the previous run leaves the chart before the new one mounts,
    // so a syntax error never stacks a second legend row on top of a working script.
    current?.remove();
    current = null;

    const started = performance.now();
    try {
        const result = await chart.runIndicator(source, { language: 'pine' });
        const ms = Math.round(performance.now() - started);
        if (result.ok && result.handle) {
            const handle = result.handle;
            current = handle;
            const inputs = handle.inputs.length;
            const suffix = `${ms} ms${inputs ? `, ${inputs} inputs` : ''}`;
            // The handle is created before the engine's first model, so `handle.title` is
            // still its placeholder at this point. The declared title arrives with the model
            // and is what the legend and the pane list show, so read it from there.
            setStatus(`✓ running (${suffix})`, 'ok');
            const settle = (): void => {
                if (current !== handle) return;
                const panes = chart.panes.list();
                const row = panes.flatMap((pane) => pane.indicators).find((ind) => ind.id === handle.id);
                setStatus(`✓ ${row?.title || handle.title || 'Script'} — running (${suffix})`, 'ok');
            };
            setTimeout(settle, 150);
            setTimeout(settle, 900);
        } else {
            const error = result.error;
            setStatus(`✗ ${error?.message ?? 'The script did not run.'}`, 'err');
        }
    } catch (error) {
        // `runIndicator` resolves failures rather than throwing; this is the belt-and-braces
        // path for anything outside the engine's contract.
        setStatus(`✗ ${(error as Error).message}`, 'err');
    } finally {
        running = false;
        runButton.disabled = false;
    }
}

// ── toolbar ────────────────────────────────────────────────────────────────────
examples.innerHTML = '';
const placeholder = document.createElement('option');
placeholder.textContent = 'Examples…';
placeholder.value = '';
examples.append(placeholder);
for (const [i, entry] of PINE_SCRIPTS.entries()) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = entry.name;
    examples.append(option);
}
examples.addEventListener('change', () => {
    const index = Number(examples.value);
    const entry = PINE_SCRIPTS[index];
    if (!entry?.script) return;
    code.value = entry.script;
    paintGutter();
    save();
    examples.value = '';
    code.focus();
    void run();
});

runButton.addEventListener('click', () => void run());
clearButton.addEventListener('click', () => {
    code.value = '';
    paintGutter();
    save();
    current?.remove();
    current = null;
    setStatus('Cleared.');
    code.focus();
});

// ── resizable split ────────────────────────────────────────────────────────────
grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    grip.classList.add('drag');
    const rect = side.getBoundingClientRect();
    const move = (e: PointerEvent): void => {
        const pct = ((e.clientX - rect.left) / window.innerWidth) * 100;
        side.style.width = `${Math.min(70, Math.max(22, pct))}%`;
    };
    const up = (): void => {
        grip.classList.remove('drag');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
});

// ── boot ───────────────────────────────────────────────────────────────────────
const stored = restore();
code.value = stored !== '' ? stored : DEFAULT_SCRIPT;
paintGutter();

void chart.ready().then(() => {
    // Data is in: run whatever the editor holds so the page opens on something alive.
    void run();
    code.focus();
});
