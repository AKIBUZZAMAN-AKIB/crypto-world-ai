# Scripting engines

**Vela™ ships no scripting engine.** It defines the `ScriptingEngine` port, owns the bars,
and routes whatever an engine produces onto panes — but the language runtime itself is
always something you plug in. A bare chart draws candles, drawings and native indicators;
`addIndicator()` without a matching engine raises an actionable error.

There are two ways to get one:

- **install an addon** — [Pine Script](#pine-script-luxalgovela-pinets) today;
- **write your own** — the port is public and documented in
  [adding an engine](../contributing/adding-an-engine.md).

## Pine Script (`@luxalgo/vela-pinets`)

```bash
npm install @luxalgo/vela-pinets pinets
```

`pinets` is the Pine Script runtime the addon executes; it is a peer dependency, so you
install it alongside.

```ts
import { Vela } from '@luxalgo/vela';
import { PineEngine } from '@luxalgo/vela-pinets';

const chart = new Vela('#chart', { symbol: 'BTCUSDT', timeframe: '60' });
chart.registerEngine('pine', new PineEngine());

chart.addIndicator(`//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`);
```

The addon exports two engines with **identical Pine semantics**:

| Export | Where scripts run | Use it when |
| --- | --- | --- |
| `PineEngine` | the main thread | simplest setup; light scripts |
| `PineWorkerEngine` | a Web Worker | heavy scripts must never block the chart |

`PineWorkerEngine` needs no configuration: the worker source is inlined into the addon's
bundle at build time and spawned from a Blob URL. Under a Content-Security-Policy that
blocks `blob:`, host the worker file yourself and pass
`new PineWorkerEngine({ workerUrl: '/vela-pine-worker.js' })`.

Both engines report `{ streaming: true, visibleRange: true, inputs: true }` — live
incremental re-execution, viewport-dependent scripts, and an inputs schema that drives
the settings dialog. `request.security` (HTF/LTF/cross-symbol, extended-ticker aware)
resolves through Vela™'s own cached data feed: the engine never fetches market data.

### In the widget and the workspace

The shells take engine **factories**, keyed by language — one instance per chart, so a
worker engine gets its own thread and dies with its chart:

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

new VelaWorkspace('#app', {
    layout: false, // one chart; any grid layout takes the same options
    symbol: 'BTCUSDT',
    engines: { pine: () => new PineWorkerEngine() },
    indicators: [{ name: 'EMA 20', enabled: true, script: '…' }], // manifest entries default to `pine`
});
```

The `engines` factories are instantiated once per chart (each workspace cell gets its
own — a worker engine per chart). See [the workspace](./workspace.md).

### The script editor

Configure an engine and the shells grow a **script editor**, docked as a side panel — the
shape TradingView moved to in August 2025. It is a working surface, not a demo: scripts are
created from a template, edited with syntax colouring and an 80-character ruler, versioned,
and rendered **on the chart** they belong to.

```ts
new VelaWorkspace('#app', {
    engines: { pine: () => new PineWorkerEngine() },
    // editor: false,   // ← remove the panel, its entries and the legend chip
});
```

| Where | Entry point |
| --- | --- |
| Desktop | the **`<>` panel toggle** in the topbar (with the other panels), or a script row's **Source code** chip |
| Phone | the **`<>` stop on the bottom bar** — the same panel, as a bottom sheet |
| Code | `ws.openEditor()` / `ws.openEditor(source, title)`, and `ws.hasEditor` |

**The flow** (TradingView's, deliberately):

- **Create new** — the script's name opens the library: every script, an inline rename
  field, and *New indicator* / *New strategy*. Templates compile as they are.
- **Add to chart** — runs the script and, on success, puts it on the chart. A failure
  leaves nothing behind: the error lands in the console (red, with a **clickable line
  number**) and the offending gutter line is marked.
- **Update on chart** — the same button once the script is live. It re-runs the code **in
  place**, keeps the trader's input values, and bumps only the **minor** version
  (`1.0 → 1.1`). Your *Settings* survive an update; that is the point of the split.
- **Save** (or `Ctrl/⌘+S`, or ⋯ → *Save version*) — commits the draft as a new **major**
  version (`1.1 → 2.0`) in the version history.
- **Version history** (⋯ → *Version history*) — every version with its time and whether it
  came from a save or from a chart update. Restoring one loads it as a **draft**; Save
  turns it into a new version, so history is append-only.
- **Source code** — every legend row whose study has Pine code carries the `{ }` chip on
  hover, exactly like TradingView's built-ins; it opens that source in the editor. A *script*
  opens editable. A **built-in** opens **read-only**, with an amber banner and *Make a copy*
  (the copy is a new library script — the built-in itself is never modified); the code chip
  and the banner sit behind `registerLegendAction` with `when: (ind) => ind.source !== undefined`.
- **Open → Built-in script…** (⋯ menu, or *Built-in scripts…* in the script list) — the
  catalog of built-in studies that have a Pine implementation, searchable, each opening
  read-only. Studies whose visuals are not Pine (a volume profile, a compare overlay) have
  no code, so they appear in neither place — TradingView's own rule: no `{ }`, no source.

### Built-ins run their Pine code

A built-in study that has a Pine implementation is **executed** through the registered
engine: `chart.addNativeIndicator('sma')` compiles and runs the SMA script from
`src/core/native-indicators/classics/pine-source.ts`, and the plotted values are that
script's values. The handle still reports `nativeType: 'sma'`, so the legend keeps the
built-in's short title, layout persistence restores it by type, the picker's *present*
state and `inspect()` all behave as before.

- The script declares `shorttitle` from the catalog, so the legend reads **SMA**, not
  *Simple Moving Average* — the same label TradingView shows.
- Inputs come from the script's `input.*` declarations (the settings dialog edits them and
  the chart re-runs), so the defaults are the study's own: `hlc3` for CCI and VWAP, `close`
  for the rest.
- A study with **no** Pine implementation (`volume`, `vpvr`, `compare`, the session
  studies) keeps the core-computed path and shows no `{ }` chip.
- With no engine registered for the chart's default language, every built-in falls back to
  the core compute, so a host with candles only still gets its indicators.

`test/classic-pine.test.ts` is the contract: every script is a real catalog type, compiles,
emits a drawable model, and declares the catalog's `overlay`. `test/pine-parity.test.ts`
(opt-in, `PINE_PARITY=1`) runs a study both ways — native compute and Pine — and prints the
drift, so a script that stops matching its built-in is visible rather than assumed.

**Editor settings** (⋯ → *Editor settings*, the same block TradingView keeps there):
suggestions as you type, the **minimap** (a click jumps), the **line-length guide** at the
80-character mark, font size and tab size. They persist per device, and `Ctrl+Space`
always offers completions whatever the suggestion toggle says.

**Shortcuts**, matching the editor TradingView ships:

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ + Enter` | Add to chart / Update on chart |
| `Ctrl/⌘ + S` | Save version |
| `Ctrl/⌘ + I` · `Ctrl/⌘ + O` | New script · open the script list |
| `Ctrl/⌘ + /` | Comment / uncomment the selected lines |
| `Ctrl/⌘ + D` · `Ctrl/⌘ + Shift + D` | Remove line · duplicate line |
| `Alt + ↑/↓` · `Alt + Shift + ↑/↓` | Move lines · copy lines |
| `Tab` · `Shift + Tab` | Indent / outdent (the selection, or the caret line) |
| Ctrl/⌘ + backtick | Toggle the console |
| `Ctrl/⌘ + Space` | Suggestions |

The console groups its messages by level (info / warning / error chips with counts), and
an error's line number is a link that selects that line in the source.

The panel is docked and resizable (drag the inner edge, double-click to reset), maximizable,
and the open/closed state rides the shell's saved document. The script library itself lives
in `localStorage` under `vela-pine-library` — a script written in the panel is the script
the standalone `editor.html` deep link opens.

### Registering it once, app-wide

`registerDefaultEngine` (from `@luxalgo/vela/plugin`) installs a language for **every**
chart built afterwards — widgets, workspace cells, everything — so feature packages can
wire Pine in once instead of threading an `engines` option through every call site:

```ts
import { registerDefaultEngine } from '@luxalgo/vela/plugin';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

registerDefaultEngine('pine', () => new PineWorkerEngine());
```

An explicit `engines` entry still wins for its language.

### Script tag / CDN

The addon publishes browser globals next to Vela™'s. **Load order is the contract** —
`vela.global.js` first, because the addon resolves `@luxalgo/vela` to the page's
`window.Vela` rather than bundling a second copy of the library:

```html
<script src="vela.global.js"></script>
<script src="vela-pinets.global.js"></script>
<script>
    const chart = new Vela.Vela('#chart', { data: bars, timeframe: '60' });
    chart.registerEngine('pine', new VelaPinets.PineEngine());
</script>
```

### Licensing

`pinets` is **AGPL-3.0**, so `@luxalgo/vela-pinets` is AGPL-3.0 too. That is precisely
why it is a separate package: Vela™ itself stays **Apache-2.0** and contains no Pine code.
Installing the addon brings the AGPL obligations into *your* deployment — decide that
deliberately. If you cannot take them on, write an engine for the language you need
against the port instead.

## Pine Script without the AGPL addon (`vela-pine-libre`)

The playground in this repo registers **`vela-pine-libre`** — an independently written,
MIT-licensed, dependency-free engine that implements this same port. It runs real Pine
v1–v6 (including `strategy()`, so the Strategy tester fills with a live broker ledger),
in-process (`PineEngine`) or in a worker (`PineWorkerEngine`). It is installed here as a
local file dependency (`file:../pine-alpha`).

```ts
import { PineEngine } from 'vela-pine-libre';
chart.registerEngine('pine', new PineEngine());
```

`playground/workspace.ts` registers it as the `pine` engine and passes
`defaultLanguage: 'pine'`; `playground/pine-scripts.ts` is the script **manifest** the
Indicators dialog lists under a `Pine Script` category, and
`test/pine-integration.test.ts` runs those exact strings through the engine so the page
cannot drift from what the engine executes.

Use this instead of `@luxalgo/vela-pinets` when the AGPL-3.0 licence of that addon (and of
the `pinets` runtime it executes) is not acceptable for how you ship. It is a smaller
language surface than PineTS — see the engine's own `docs/known-limitations.md` — and it
is not a drop-in replacement for every script.

## Writing your own engine

The port is small — `prepare()` (parse a script: inputs + declaration metadata, no market
data) and `execute()` (return a session handle; emit models through the handlers). Vela™
owns the bars and passes them in; the engine never fetches candles.

[**Adding an engine**](../contributing/adding-an-engine.md) is the full contract, and
`playground/demo-engine.ts` in this repo is a ~300-line working engine you can read in
one sitting — the one the Vela™ playground itself runs.

## Related

- [Adding an engine](../contributing/adding-an-engine.md) — the port, in full.
- [The plugin SDK](../contributing/plugin-sdk.md) — `registerDefaultEngine` and the model
  vocabulary engines build with.
- [Native indicators](./api-reference.md) — core-computed indicators (volume, VPVR) that
  need no engine at all.
