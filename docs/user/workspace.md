# The workspace (multi-chart)

`@luxalgo/vela/workspace` is the multi-chart shell: a grid of full Vela™ charts behind **one
shared data feed**, wrapped in **one shared chrome** — topbar (symbol / timeframe /
style controls, **Layout setup** pane, indicator picker, alerts), one drawing toolbar, object
tree, data window, bottom bar, one keyboard map — that always **reflects and acts on the
ACTIVE cell**. Cells are switched in place (`setMarket` under the hood), so indicators,
drawings, and your subscriptions survive every symbol/timeframe change.

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets'; // Vela™ ships no engine — see ./scripting-engines.md
import { BinanceProvider } from '@luxalgo/vela/providers/binance';

const ws = new VelaWorkspace('#app', {
    layout: '4', // '1' | '2h' | '2v' | '4' | '8' | picker ids ('g3x2') | a registerLayout() id
    //           // `false` = SINGLE-CHART mode: one cell, no Layout setup pane or sync
    //           // switches anywhere, `setLayout` no-ops, no `cells` entry needed
    // Chart options at the TOP LEVEL are every cell's DEFAULT — the same words the
    // widget (and the bare chart) use. `cells` overrides them per cell; a cell's NAME
    // is its durable identity, DECLARATION ORDER fills the layout's slots:
    symbol: 'BTCUSDT',
    timeframe: '60',
    cells: {
        btc: { symbol: 'BTCUSDT', timeframe: '60' }, // 1st declared → 1st slot
        eth: { symbol: 'ETHUSDT', timeframe: '15' }, // slots 3–4: no entry → pure defaults
    },
    providers: { binance: () => new BinanceProvider() }, // registered ONCE, shared by every cell
    engines: { pine: () => new PineWorkerEngine() }, // instantiated per cell (a worker each)
    live: true,
    theme: 'dark',
    sync: { viewport: true }, // optional links — see below
    persist: true, // state persistence (localStorage by default — see State & persistence)
});
```

**One options vocabulary.** `VelaWorkspaceOptions` = the widget's chart options (all of
`VelaOptions` except `height` — the grid sizes its cells) + the shared shell surface
(`providers`, `engines`, `indicators`, `timeframes`, `timezone`, chrome toggles,
`persist`/`storage`) + the grid's own options (`layout`, `cells`, `sync`,
`drawingToolbar`, `maxWebglCells`, `alertCap`). A chart option means the same thing
everywhere: on the widget it configures *the* chart, here it is the *default* of each
cell — `upColor`, `glow`, `logScale`, `animations`, `defaultLanguage`, even `renderer`
all apply to every cell. An explicit `nativeBackend` (other than `'auto'`) wins over
the `maxWebglCells` budget policy.

The `drawings` option applies here too, mapped onto the SHARED drawing surface:
`false` removes it entirely — no toolbar, no mobile drawings entry, no tool pill (the
programmatic `chart.drawings` API stays) — and `{ tools }` / `{ groups }` pick what
the shared toolbar offers. Only its `toolbar` sub-key changes meaning: one shared bar
serves the grid, so per-cell in-chart bars never render (`drawingToolbar: false` hides
the shared bar itself).

## Alerts

The **Alerts** bell is visible near the symbol on desktop and touch landscape, and at the
start of the phone's scrolling tool bar. The phone's **More → Alerts** opens the same pane;
**Alt+A** opens its Create tab. On desktop it is a square docked panel with a resizable width;
on a portrait phone it attaches across the bottom and the top grip changes its height.
Touch landscape uses desktop chrome. A host's explicit topbar composition still controls
whether and where the bell appears. Condition and status-filter dropdowns use compact,
theme-matched lists; use arrows, Home/End and Enter to choose, or Escape to dismiss.
Unavailable drawing-backed moving conditions stay disabled.

The pane has three tabs:

- **Create** binds a draft to the selected chart and market. Choose a crossing,
  greater/less-than or moving (including percentage) condition, a level or move amount,
  the moving lookback (1–500 bars), and **Once only** or **Every time**. A drawing's alert
  action creates a level that follows that drawing. If the selected chart, symbol, interval
  or trading session changes, the old draft is preserved but cannot be submitted until
  **Use active chart** is chosen.
- **Alerts** lists created price and drawing alerts with their chart, condition, frequency,
  status and trigger count. Filter by **All statuses**, **Active**, **Paused** or
  **Triggered**. **Edit** changes the condition, level, lookback or frequency without
  replacing the separate Create draft; **Pause** stops evaluation, **Resume** restarts a
  paused alert, and **Re-arm** restarts a once-only alert after it triggered. The chart action
  activates the owner, and deletion asks for confirmation. Editing preserves the alert's
  current status and trigger count; a paused or triggered alert remains stopped until it is
  explicitly resumed or re-armed. Editing is unavailable while the owning chart, its original
  symbol or a source drawing is unavailable, or while its market is loading. An alert on a
  different symbol waits for its original symbol; a pooled or removed chart is retained and
  marked **Waiting for chart**. A missing drawing is marked **Waiting for drawing**. Pausing,
  resuming or deleting a waiting alert is still possible; deletion removes an owned level
  line only if no other alert uses it. Manually drawn lines are not taken over by a new
  price alert. Older documents without line ownership are restored conservatively: a
  price-matched legacy line is preserved rather than deleted during edit or removal.
- **Log** groups triggered price and script events by chart, with the symbol, timeframe and
  script captured when each event fired. **Go** activates a chart; **Clear** and **Clear all**
  remove log entries only, not price alerts. Events remain visible even if their original
  chart is no longer in the current layout. `alertCap` limits the session log (default 50).

Resuming, re-arming or saving an edited level alert uses the current price as its new
crossing anchor; crossings that happened while stopped are not replayed. Greater/less-than
alerts that are already beyond their level wait for a return and a new crossing after resume
or edit. Moving alerts use the chart's current loaded lookback on the next bar, which can
include bars from before resume. If a drawing source disappears, a crossing alert starts
with a fresh side when that source returns rather than counting the missing interval.
Replay jumps rebase the alert price and moving lookback to the revealed bars; a partially
played candle restored internally during a seek is not treated as a new price print.
Price alerts are checked locally as their chart receives data, not by a background server;
this feature does not promise delivery when the workspace is closed or disconnected.
Price alerts are part of the layout state and can be restored when the host saves that state;
the triggered-event log is session-only. `ws.toast(message, kind?, durationMs?)` shows a
host notice on the same in-app surface.

## Single chart (`layout: false`)

`layout: false` pins the workspace to **one chart**: Layout setup and the sync
switches disappear (desktop and mobile), `setLayout` is a no-op, and no `cells` entry
is needed — the top-level chart options seed the single chart. Everything else on this
page applies unchanged; the state document is simply the single-cell case
(`layout: '1'`, one `charts` entry).

```ts
const chart = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'BTCUSDT',
    timeframe: '60',
    providers: { binance: () => new BinanceProvider() },
    persist: true,
});
```

> **Migrating from `VelaWidget`.** The old single-chart class is deprecated and now
> wraps exactly this. Replace `new VelaWidget(el, opts)` with
> `new VelaWorkspace(el, { ...opts, layout: false })`; pass `persist: 'vela-widget'`
> to keep reading the state the widget stored. The widget-only `urlState` option is
> gone — encode `getState()` into your own URL scheme if you need shareable links.

## Cells and the active cell

A cell's **identity** is its declared name (`btc`, `eth`, … — the keys of `cells`), or
`c<N>` for a slot no entry declared. It is durable and never content: the symbol,
timeframe, style, indicators and drawings are mutable state *of that identity*. The
layout's own `c1`…`cN` are slot POSITIONS, and declaration order is what maps an identity
onto one. Identity is also what survives a layout change, so `4 → 2h → 4` restores the
third and fourth cells exactly (market, renderer config, drawings, indicators) from the
workspace pool.

```ts
ws.active;               // the ChartCell the shared chrome reflects/acts on
ws.chart;                // shortcut ≡ ws.active.chart (the widget.chart habit)
ws.cell('eth');          // a specific cell BY IDENTITY — the durable handle to hold
ws.cells();              // every live cell, in slot order
ws.setActiveCell('sol');
ws.setLayout('8');       // cells diff BY IDENTITY; identities past the new size pool their state
// Shrinking never pools the ACTIVE chart: if its slot would leave the layout, it
// moves into the last surviving slot instead (the other cells keep their order).
ws.setTheme('light');    // re-skins the shared chrome + EVERY cell live (also reachable from any cell's chart settings → Canvas → Theme)
ws.maximizeCell('sol');  // one cell over the whole grid (null restores) — pure presentation,
ws.maximizedCell;        //  the other cells keep everything; layout/state changes restore
ws.swapCells('btc', 'eth'); // the two cells trade SLOTS (arrangement only — cells untouched)
ws.on('cell:active' | 'layout:changed' | 'cell:maximized' | 'cell:created' | 'cell:destroyed' | 'cell:priceStyle' | 'state:changed', cb);
```

**Rule of thumb:** hold the cell (or its identity), read `cell.chart` at the point of
use. The chart instance survives market changes and only dies when its cell leaves the
layout (`cell:destroyed`). Host code that tracks cells should **follow
`cell:created`/`cell:destroyed`** rather than snapshot `ws.cells()` once: a later
`setLayout` (or a restored document) mints cells that a one-time snapshot never sees.

Layouts live in a registry (`registerLayout` from `@luxalgo/vela/workspace`). The topbar's
**Layout setup** button opens a right-side dock with a 4×4 grid canvas: hover previews the full
*columns × rows* rectangle from the top-left (the table-insert idiom); a click
applies it immediately. Rectangles matching a classic preset (`1`, `2h`, `2v`, `4`,
`8`) reuse it; anything else gets a self-describing dynamic id (`g3x2` = 3 rows ×
2 columns) that resolves without registration (persisted picks restore across boots).
Plugin layouts the canvas cannot express (bespoke `areas`) appear as named preset tiles
grouped by chart count, so `registerLayout` contributions keep appearing automatically. In code,
the same composition is `layoutForGrid(rows, cols)` (exported from `@luxalgo/vela/workspace`),
handed to `ws.setLayout(...)`.

### Layout setup and chart syncing

Desktop **Layout setup** is a square docked pane, like Data window. Use the button beside
Close to Float or Dock it, the dock's inner edge to change its width, or the resize button
immediately after Close to resize a floating card. The desktop heading drags the card; it
can coexist with another docked panel and other floating cards. Its placement and size use
the normal panel persistence and undo/redo. On a portrait phone, **More → Layout setup**
opens one full-width, bottom-attached pane: the strip above the heading resizes its height,
the heading does not detach it, and the button beside Close toggles fullscreen/restore.
Landscape uses desktop-style chrome. The two tabs are the same on both devices:

- **Layout** contains the square grid, grouped asymmetric presets, layout-wide settings and
  indicator actions, link-tabs selector, Share and **Manage layouts**. Removing hidden
  charts takes a confirmation and offers Undo; their restored state is retained. Manage
  layouts is a separate compact floating menu and does not close its parent pane.
- **Chart syncing** contains the seven independent link switches and a chart-by-link matrix.
  A chart's mark identifies its group; choose a chart header to activate it, click/tap a
  chip to cycle, or right-click/long-press for the direct palette. **ALL** links every
  chart for that row; group names and marks are editable when in use. Drawing scope is a
  separate control from the Drawings switch. The table scrolls horizontally within the pane
  when needed, and live changes update without rebuilding the focused controls.

The status-line sync badge and chart context menu open the same pane on **Chart syncing**,
with that chart's column highlighted and brought into view. Keyboard users can move between
tabs with Left/Right, Home and End; the grid uses arrows to preview and Enter or Space to
apply. Preset arrows move focus while Enter or Space applies, and link-tab arrows select a
set. Escape closes the focused pane and returns focus to its opener (a tooltip or child menu
may consume Escape first). The grid's help button also exposes its instructions on touch.
The phone More menu has **one** Layout setup entry, not a second Chart syncing entry;
**Manage layouts** and **Indicator templates** remain separate actions.

Splitters between cells resize the grid tracks (double-click a divider for an even
split).

Each cell also carries its own **view controls**: rest the cursor near the bottom
center of a chart (the same reveal as the jump-to-latest button) and a small cluster
appears — a drag handle, zoom out, zoom in, maximize, and reset. The drag handle
(the dotted grip at the left) moves the chart within the grid: hold it, sweep onto
another chart — a dashed ring previews the target — and release to trade slots
(`swapCells` behind a gesture; releasing anywhere else cancels). Maximize is
`maximizeCell` behind a button: that one chart takes the whole grid, restore (or a
layout switch) brings the grid back, and nothing about the hidden charts is lost.
Reset re-enables auto price scaling and frames the full history — the context menu's
"Reset view". On single-cell grids the drag handle and maximize stay away; zoom and
reset remain.

The same rule picks what a **touch** layout shows, and it is a rule about SPACE, not
about the device: where there is no cursor to hover with, the cluster keeps its one
essential verb — **reset** — out as a small chip at the bottom-left of every cell, and
the cursor-only verbs (drag, zoom, maximize) stand down. The mobile bottom bar carries
a **maximize stop** in their place: one tap isolates the current chart over the grid,
and the stop lights up as an inverse chip whenever something is isolated — the chart
itself, or a pane inside it (a double-tap in the plot maximizes a pane). Tapping the
lit stop restores the view. The **jump-back-to-latest** button needs no hover on a
phone at all: it appears the moment the newest bar is off screen, at a 32px touch
target, and disappears again when the view is back at the edge.

On a phone, **More → Chart actions** opens a compact menu next to More rather than a
second sheet. It exposes the active chart's right-click actions: reset the view, chart
syncing and apply-to-all when available, remove drawings or indicators, settings, and
contributed chart-body actions. Empty removals stay visible but disabled. The menu
scrolls when needed, dismisses on an outside tap or when its opener disappears, and
Escape returns focus to More. The desktop chart-body right-click menu is unchanged.

## Sync links

Per kind — `viewport`, `time`, `symbol`, `timeframe`, `crosshair`, `drawings`, `style` — link
every cell (`true`) or named groups keyed by cell IDENTITY (`{ btc: 'a', eth: 'a',
sol: 'b' }`: only same-group cells follow each other). Cross-timeframe viewport groups
align on the **right edge** (a finer-timeframe cell clamps the window to its own
minimum zoom).

`symbol` and `timeframe` follow **independently** — each has its own link, so cells can
share a market without sharing an interval. Changing one cell's market (topbar picker,
the cell API, a restored document) pushes that cell's symbol/timeframe onto its group;
the pair a layout shows is whatever each **cell identity** carries — a layout is only
an arrangement, so `4` → `2h` → `1` keeps every cell's own market. `ws.sync.set('symbol',
true)` also aligns the group to the active cell once (the "starts coherent" rule the
whole surface follows), while the pane's switches only link what happens NEXT: with
four different pairs on screen, flipping **Symbol** on leaves all four untouched until
one of them changes. Cells a later layout change adds to an all-cells link (`true`)
adopt a pre-existing group peer's market on arrival — the market twin of the style and
drawings rules below — so growing the grid cannot leave a linked cell sitting on the
workspace defaults. A group record leaves a newborn unlinked (it has no entry in the
record yet).

`crosshair` mirrors the pointer's TIME onto same-group cells as a **ghost crosshair**
(a dimmed vertical line snapped to each follower's own bar, with its time chip);
leaving the origin clears every ghost. The ghost needs the renderer's optional
`setExternalCrosshair` seam — the native renderer has it; a custom renderer without it
simply never shows one (enabling warns only when NO cell could).

`drawings` copies each **newly created** drawing onto its same-group cells — the
anchors are time+price, so the copy lands at the same spot whatever each follower
shows — and keeps the set **linked**: moving/restyling/deleting any member follows on
its peers (while the link stays on). Placement itself mirrors **live**: while you are
still clicking anchors, the followers show the in-progress shape as a reduced-opacity
ghost (the same seam as crosshair ghosts — a custom renderer without it simply syncs
at completion). Link membership is session-scoped and survives a toggle-off: turning
the link off freezes create/edit/delete propagation (and clears placement ghosts) but
keeps the in-memory pairs, so re-enabling resumes edit/delete for drawings that were
linked earlier in the session. Drawings created while the link was off stay
independent — re-enabling never copies or pairs them. A reload (or `applyState`)
drops the pairs, so previously synced drawings are independent again.

Cells a later layout change adds to a linked group arrive with every drawing of the
active cell (or of another group member when the active cell is outside the group),
including drawings made while the link was off or on a one-chart layout. The copies
are linked like any synced drawing and add no undo steps on the new cell. A cell
returning to the grid refreshes the linked copies it already holds instead of
duplicating them.

`style` mirrors the chart's presentation across same-group cells: the settings
dialog's **Symbol** tab looks (candle body, border and wick colors, the bar, line,
area and baseline styles, bar spacing, the animation switches and the watermark
toggles), its **Canvas** tab (background and text, grid, pane separators, margins),
its **Scales and lines** tab (price-scale mode, last-price line and labels), its
**Crosshair** tab (shape — cross / vertical only / horizontal only / dot — colour,
width, line style, opacity, the price and time axis labels with their background, and
magnet mode: off, snap to the close, or snap to the nearest of O/H/L/C), its
**Status line** tab (segment toggles, indicator titles and values), and
the session shading colors. A candle-based chart type registered by a plugin shares
the candle colors it stores; its own settings section stays per cell, because those
settings can depend on the cell's market. Editing any of them on one cell applies
the same change to its group, and enabling the link aligns the group to the active
cell once. Cells a later layout change adds to a linked group inherit the group's
presentation on arrival (from the active cell when it belongs to the group). The
chart type itself stays per cell — a candles cell and a line cell keep their types
and share their colors — and so do the baseline price and the **Events** tab. The
display timezone and theme are already workspace-global, so neither rides this link.

The **Chart syncing** tab exposes **Date range**, **Time**, **Symbol**, **Interval**,
**Crosshair**, **Drawings** and **Style** as independent switches. Drawings is also a
toggle on the shared drawing toolbar. A group record reads as on: switching it off
parks its grouping and switching it back on restores it. The matrix edits individual
memberships directly; **ALL** returns a row to the all-cells form. A switch is a LINK,
not an edit: turning one on never rewrites the markets currently shown (the API's
`ws.sync.set(kind, true)` aligns once by default).

```ts
ws.sync.set('viewport', true); // aligns followers to the active cell, then follows pans
ws.sync.set('symbol', { btc: 'watch', eth: 'watch' });
ws.sync.set('crosshair', true); // hover any cell → ghost time-line on all the others
ws.sync.set('drawings', true); // draw on any cell → the same drawing on all the others
ws.sync.set('style', true); // every look in the settings dialog mirrors on all the others
ws.sync.get('viewport'); // true
ws.sync.state(); // { viewport: true, symbol: {...}, crosshair: true, drawings: true, style: true }
```

## Watching what the cells compute

Every cell runs its own engine session, so a script's runs are per-cell. The workspace
relays them as one event, tagged with the cell identity — **one subscription covers the
whole grid**, cells created by a later layout change included:

```ts
ws.on('script:run', (run) => {
    run.cell;              // 'btc' — which cell computed
    run.title;             // the script's declared title
    if (run.cause === 'bar') persist(run.cell, run.strategy);
});
```

The payload is the chart-level [`ScriptRun`](./api-reference.md#capturing-what-a-script-computes)
plus `cell`; everything there — `cause`, `forming`, `plots`, `vars`, `strategy`, `trades()` —
applies unchanged.

## Following price-style switches

A cell's style switch (candles → line, area, a chart type, …) is relayed the same way:
`cell:priceStyle` carries the cell identity with the chart-level
[`priceStyle:change`](./api-reference.md#chart-level-events) payload. Only the cell whose
style changes emits, whatever the path — the topbar style menu, `ctx.setPriceStyle`,
`chart.renderer.set('priceStyle', …)`, the chart settings dialog, a config template, or a
state document applied in place. The event is synchronous and fires before that cell
repaints, so the cell still shows the outgoing style while your listener runs:

```ts
ws.on('cell:priceStyle', ({ id, from, to }) => {
    const cell = ws.cell(id)!;
    cell.priceStyle; // still `from`
    const outgoing = cell.chart.renderer.screenshotCanvas(); // the old frame, to animate from
    animateSwitch(cell, outgoing, to);
});
```

Don't change the style again from inside the listener.

## Bar replay across the grid

`ws.replay` rewinds **every cell at once** and replays them on one clock. It takes the same
verbs as a chart's [`chart.replay`](./api-reference.md#chartreplay--the-bar-replay-control-surface):
`start`, `step`, `stepUpdate`, `play`, `pause`, `stop`, `state`, `bounds`, plus `on` for the
`replay:*` events.

```ts
await ws.replay.start({ from: Date.UTC(2024, 5, 3, 14), cell: 'btc' }); // read on the 'btc' cell (default: the active one)
ws.replay.play(1000);
ws.replay.on('replay:step', ({ cursorTime, remaining }) => updateUi(cursorTime, remaining));
```

### The replay controls

The workspace ships the whole replay UI, and it is a pure view over the API above — a
session started from code, a contribution or a shortcut wears the same chrome:

- **The topbar's replay button** (the `'replay'` entry, beside the alerts bell) opens the
  menu: **Select bar** (the cursor arms; click any chart to start the replay there),
  **Select date** (a calendar — the session starts at that day's first bar), **Random
  bar**, and **Jump to real time** (ends the replay and pans to the newest bars). On a
  phone the same menu lives behind the kebab drawer's **Replay** action, and a
  composition without `'replay'` removes both entry points.
- **The transport bar** floats at the top of the grid while a session runs: play/pause,
  step forward, the speed menu (0.1 s → 30 s per update), the replay clock, how many bars
  are left, jump-to-real-time and ✕ to exit. Stepping pauses a running session first.
- **Keyboard:** `Shift+↓` plays/pauses, `Shift+→` steps (both no-ops outside a session).
- While **Select bar** is armed, hovering previews the cut on the other charts as a ghost
  crosshair (`lastOpenClosedBy`), so every chart's clipped edge is visible before the
  click; `Esc` (or the hint's ✕) cancels.

Turn the whole chrome off with `replay: false` — `ws.replay`, `ctx.replay`, the events
and the shortcuts' targets stay intact, for a host that drives replay from its own
controls:

```ts
new VelaWorkspace('#chart', { replay: false });
```

- **One replay time, no look-ahead.** `from` is read on one cell the way `chart.replay.start`
  reads it, and the close of that cell's last kept bar becomes the shared replay time. Every
  other chart keeps exactly the bars that had **closed** by then: next to a 1h chart rewound to
  10:00, a 15m chart shows its 10:45 bar and a daily chart ends on the day before. A market
  closed over the weekend never shows Monday while the clock is still on Sunday.
- **The finest timeframe sets the pace.** A step moves the clock to the next bar close on any
  chart, and each chart reveals what closed by then, so a coarser chart shows its bar the
  moment it completes. In a multi-chart layout, bars are revealed whole. A single-chart
  layout hands every call to that chart's own replay, including
  [tick replay](./api-reference.md#tick-replay).
- **The grid can change underneath.** A cell added by a layout change joins at the shared
  time; a cell switching symbol rejoins once its new bars load; a timeframe switch keeps the
  cell's place.
- **It ends everywhere together**, with `stop()` or when any chart reaches its last bar.
- **The state follows the active cell.** `state.active`, `playing` and `intervalMs` describe
  the whole workspace; `cursorTime`, `remaining` and `nextTime` (and `bounds`) read the
  active cell's chart, and the `replay:step` / `replay:tick` events report it.

A contribution drives it as `ctx.replay`. Driving one cell's `chart.replay` directly still
replays that chart alone. The cut rule is exported for interfaces that preview it:
`barClose(open, timeframe)` is when a bar closes (calendar months for month-based
timeframes), and `lastOpenClosedBy(time, timeframe)` is the last bar open a chart keeps at a
given replay time — for example, the spot for a ghost crosshair
(`renderer.setExternalCrosshair`) marking where each chart would be cut.

## State & persistence

The state SURFACE is the product; persistence is an adapter on top of it.

### Reading and restoring the whole workspace

```ts
const state = ws.getState();
// → { version: 1, layout, trackSizes?, activeCellId?, sync?, timezone?, favorites?,
//     timeframeFavorites?, drawingTools?, charts: […], ext? }
// `drawingTools` = { defaults?, templates?, magnet?, stay? }: each drawing tool's remembered
// settings (what its next drawing starts from), its saved styles, the magnet and
// stay-in-drawing-mode — shared by every chart of the workspace, like the favorite stars.
// One ORDERED `charts` entry per cell, live AND dormant — array position i restores
// into slot i, `id` is the cell's durable name: { id: 'btc', symbol, provider?, timeframe,
//   priceStyle, bars?, watermark?, indicatorTitles?, rendererConfig (renderer.getConfig() document),
//   drawings (drawings.toJSON() document), indicators: { manifest: string[], natives: string[] },
//   ext? (third-party per-chart state, by namespaced key) }
// `ext` bags (document root and per chart) carry PLUGIN state — written and restored by
// handlers plugins register (registerStatePersistence, see the plugin SDK); entries pass
// through opaquely, so a document never loses them when the plugin isn't loaded.

ws.applyState(state); // untrusted-safe: malformed fields dropped; same-shape documents
//                    // apply IN PLACE (charts, handles and subscriptions survive),
//                    // structural changes rebuild the grid
ws.on('state:changed', () => {
    /* debounced (~500ms) — re-pull getState() */
});
```

`getState()` is the SDK's one call to read the **config and current content of every
chart**; `applyState()` is its inverse. Custom flows — server-side snapshots, share
links, layout templates — compose these two directly and need none of the plumbing
below. There is deliberately **no built-in URL persistence**: a host wanting shareable
links encodes `getState()` into its own URL scheme and calls `applyState()` at boot.

One format for every shape: the [single-chart mode](#single-chart-layout-false) speaks
the same triplet (`getState`/`applyState`/`state:changed`) and writes the same document
with one `c1` cell — a saved single chart drops into a grid slot as-is, and a cell's
state restores into a single-chart shell.

### The `persist` option and the storage interface

```ts
new VelaWorkspace('#app', { persist: true }); // key 'vela-workspace'
new VelaWorkspace('#app', { persist: 'my-key', storage: myAdapter });
```

`persist` writes the state document through a **storage adapter** and restores it as
defaults at construction (synchronous adapters restore before the first paint; async
ones late-apply when they resolve). Writes are debounced ~500ms and flushed on
`beforeunload` and `destroy()`.

**The default adapter is localStorage** — the same default as the widget, so
`persist: true` survives reloads out of the box. An in-memory, session-lived adapter
stays available for state that must NOT outlive the page
(`import { memoryStorageAdapter } from '@luxalgo/vela/workspace'`). Any backend fits through
this interface (one contract for both shells):

```ts
/** Both methods may be synchronous (localStorage-like) or return promises (REST/IndexedDB). */
interface VelaStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}
```

Example — a REST-backed store (per-user server-side workspaces):

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { VelaStorage } from '@luxalgo/vela/widget'; // one storage contract for both shells

const restStorage: VelaStorage = {
    async get(key) {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(key)}`);
        return res.ok ? res.text() : null;
    },
    async set(key, value) {
        await fetch(`/api/workspaces/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
    },
};

new VelaWorkspace('#app', { persist: 'main', storage: restStorage /* … */ });
```

Notes: writes are fire-and-forget (the UI never blocks on storage); a remote adapter
that must survive tab-close should use `navigator.sendBeacon` in its `set`. A saved
state referencing a plugin layout id restores only if that layout is registered
(`registerLayout`) before `applyState` runs; the layout grid's dynamic ids (`g3x2`)
are self-describing and always resolve.

## Options (summary)

**Chart options** (every key of [the chart's options](./options.md) except `height`) sit
at the top level and are each cell's **default** — `symbol` (bare = first declared
provider; an `EXCHANGE:` prefix pins a venue), `timeframe`, `bars`, `priceStyle`,
`data`, `visibleRange`, `theme`, `live`, `volume`, `upColor`, `downColor`, `glow`,
`animations`, `logScale`, `currentPriceLine`, `drawings` (toolbar excepted),
`priceAxis`, `defaultLanguage`, `renderer`, `nativeBackend` (explicit value wins over the
`maxWebglCells` policy). `cells` overrides the market/view seeds per cell:
`{ symbol, timeframe, bars, priceStyle, data, visibleRange }`.

**Cell names are identities, not positions.** A `cells` key is free-form (`btc`, `main`,
…): it names the cell durably — persistence, `sync` groups and `ws.cell(name)` all speak
it — while DECLARATION ORDER decides which layout slot each one fills (first declared →
first slot). Any entry is optional (an undeclared slot boots on the defaults, with an
auto name); extra entries beyond the layout wait dormant and appear when a larger layout
reveals them. Purely-numeric names are rejected with a warning (JS object keys would
silently reorder them).

**Shell options** (shared with the widget, same semantics):

| Option | Default | What it does |
| --- | --- | --- |
| `providers` | — | Factories; the workspace instantiates ONCE onto the single shared feed. |
| `engines` | — | Factories; one instance per cell (merged over `registerDefaultEngine`). |
| `indicators` | — | Shared manifest; `enabled` entries auto-add to fresh cells. |
| `timeframes` | presets | Topbar timeframe presets. |
| `timezone` | `'Etc/UTC'` | Display timezone (every cell): an IANA zone, or `'exchange'` — each cell renders in its own market's zone (Chicago for a CME future, New York for a US equity, UTC for crypto), as declared by its provider's symbol metadata. |
| `statusline` / `watermark` / `bottombar` | `true` | Chrome toggles. |
| `topbar` | defaults | Declarative topbar composition — `{ left, right }` lists of the VISIBLE entries, in order (see [Composing the topbar](#composing-the-topbar)). |
| `indicatorPicker` | `true` | **Deprecated (removal in 0.7.0).** `false` removes the built-in indicator dialog's entry points. Replace it with the composition (omit `'indicators'` from `topbar.left` — same effect) or a plugin [slot override](../contributing/plugin-sdk.md#replacing-a-built-in-button--slot-overrides). |
| `layoutMode` | `'auto'` | Chrome size class — see [Mobile](#mobile). |
| `autofocus` | `false` | Focus the active chart on mount (off: an embedded workspace should not steal the page's focus). |
| `persist` / `storage` | off / localStorage | State persistence (see above). |

**Workspace options** (the grid's own):

| Option | Default | What it does |
| --- | --- | --- |
| `layout` | `'4'` | Initial grid — preset id, picker id (`g3x2`), `registerLayout()` id, or inline definition. `false` = [single-chart mode](#single-chart-layout-false). |
| `cells` | — | Per-cell overrides, keyed by FREE-FORM name = the cell's durable identity; declaration order fills the layout's slots (see above). |
| `sync` | off | Initial sync links (see above). |
| `drawingToolbar` | `true` | The one shared drawing toolbar (acts on the active cell). |
| `maxWebglCells` | `8` | Above this many cells, every cell uses canvas2d (uniform look inside the browser's WebGL budget; `glow` unavailable there). |
| `alertCap` | `50` | Alerts the topbar bell keeps (oldest drop beyond it). |

Contributed actions/attachments (`@luxalgo/vela/plugin`) work unchanged — `ctx.chart` resolves
to the ACTIVE cell's chart; grid-aware plugins additionally get `ctx.cells`,
`ctx.activeCellId`, `ctx.setActiveCell(id)`, and `ctx.replay` (the
[grid-wide replay](#bar-replay-across-the-grid)).

## The indicator manifest

The shell takes its script library as **data** — an array (or `{ indicators: [...] }`
wrapper) of entries, inline or fetched from a URL, shared by every cell:

```json
[
    { "name": "EMA 20", "script": "//@version=5\nindicator(\"EMA 20\", overlay=true)\nplot(ta.ema(close, 20))" },
    { "name": "My RSI", "url": "/scripts/rsi.pine", "language": "pine", "enabled": false }
]
```

- `script` is inline source; `url` fetches it (relative to the manifest URL).
- `enabled: false` entries don't auto-add — they appear in the **Indicators** picker for
  the user to toggle on. Toggles are live and per cell, and survive market switches.
- A broken entry is skipped with a console warning — one bad script never takes the
  chart down. A failing manifest URL throws.

## Keyboard

The shell is keyboard-first (bindings act on the **active cell**):

- Type a **letter** or `0` anywhere on a chart → the symbol search opens, seeded with it.
- Type a **digit from 1 to 9** → select its mapped chart interval. Press `,` to open
  the typed timeframe entry (`15`, `4H`, `D`, `3M`, …).
- `/` opens Indicators (or its configured slot override); `Alt+W` opens Symbol Search.
- `alt+S` → download a PNG of the visible layout (every chart, or the
  maximized one). `?` → the shortcuts panel.
- `mod+↑/↓` glide-zoom, `mod+←/→` glide-pan with the exact feel and limits of a drag
  (toward now it rests on the newest candle plus the usual empty space). `alt+T` arms
  the trend line tool; `alt+H` / `alt+V` drop a horizontal / vertical line at the
  cursor — the drawing toolbar's menus show these chords beside the tools.
- Mouse: `Shift`+scroll pans through history instead of zooming, `Shift`+click starts
  the measure ruler at the cursor, and middle-click deletes the drawing under it.
- Drawing keys (undo/redo, copy/paste, delete, nudge) come from the core — see
  [Drawing tools](./drawing-tools.md).

Bindings are declarative descriptors on `ws.keymap` — `register({ id, keys:
'mod+shift+k', label, category, scope?, run })` — and are listed automatically in the
`?` panel. `'mod'` is ⌘ on macOS and Ctrl elsewhere. Scopes stack: the shell pushes
`'dialog'` while any of its dialogs is open, muting chart-scope bindings.

Shortcuts fire while keyboard focus is **inside the shell** (any click on a chart puts
it there). For a page where the chart is the main content, set `autofocus: true` so
they work from the very first keystroke, before any click.

## The chrome

- **Topbar** — symbol button (opens the search), timeframe dropdown (hover a row to
  star a favorite: starred timeframes sit as duration-sorted chips, the current one
  highlighted in place; an unstarred current sits next to the caret, and the caret
  opens the full list — or the combined label+caret when nothing is starred),
  chart-style dropdown (built-ins ∪ [plugin chart types](../contributing/plugin-sdk.md),
  with their icons and labels), the Layout setup pane (multi-chart grids only),
  Indicators pane and the separate Indicator templates pane beside it (see
  [Chart templates](#chart-templates)), undo/redo (same history as Ctrl+Z / Ctrl+Y),
  the saved-layout chip and its Save button (see [The layout menu](#the-layout-menu)),
  compare (it lights up while the active chart carries a second series), alerts bell,
  data-window and object-tree panel toggles, then any
  [contributed actions](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction)
  in the right-hand cluster. The whole bar is composable — see
  [Composing the topbar](#composing-the-topbar).

  When the chrome is wider than the window — a narrow desktop, many starred
  intervals, a long layout name, every panel toggle docked — the bar is **one
  scrollable strip**: it never wraps and never widens the page, the pair stays
  pinned at the start and the tools pinned at the end, and the middle slides
  under them (a soft edge marks the side that still has more). Drag it with the
  mouse, wheel it, or Tab into it — a control the strip has slid past scrolls
  itself back into view. A press that never moves is still a click, so every
  button works as before. The strip's scroll range ends **before** the pinned
  cluster: it reserves that cluster's width as room at its own end, so scrolling
  to the far side brings the last middle tool out from under the pinned tools
  instead of ending with it still covered. (Keyboard focus gets the same room
  through `scroll-margin-inline-end`.)
- **Status line** — symbol + OHLC and change of the hovered bar (resting on the latest
  live bar), stacked above the renderer's indicator legend and dressed like its rows:
  hovering outlines the chip, and while the chart's price series is hidden the line
  dims, drops its value readouts, and shows an eye that brings the chart back.
  Right-clicking it opens an action menu with a
  toggle per element (logo, name, market status, OHLC, bar change — the same toggles
  as the settings dialog's Status line tab; hiding the name also hides the
  venue/timeframe beside it) plus hide/show for the chart's price series. In
  multi-cell grids it stays on one row — segments that don't fit the cell hide instead
  of wrapping (bar change first, then venue/timeframe, then the market badge; the logo
  + ticker always stay). While the chart replays past bars, the market badge gives way to
  a replay badge (the replay icon on the inverse chip), and the market status returns when
  the replay ends.
- **Object tree** — a docked panel grouping every item under the pane it belongs to. Each pane is
  one column read top to bottom as front to back: its drawings, its indicators and, in the main
  pane, the price series, all in draw order — new indicators and new drawings both start under
  the price, so the candles stay readable. Rows carry hide/show, lock and remove; right-clicking one opens the rest
  (duplicate, restack, and moving an indicator to another pane or a new one), and each pane's
  header carries its reorder/collapse/maximize controls. Rows are also draggable — onto a pane to
  move an item there, onto the band between two panes to open a new one, or to any slot in a
  pane's column to set draw order, a drawing under the candles or between two indicators included
  — with a ghost label and a drop hint while the drag is live. An indicator's row carries
  everything the indicator paints: its plots, fills, script drawings and tables all move through
  the stack together. Every indicator row shows its **newest value**, and a study with more than
  one plot has a chevron that opens the **full readout**: one line per plot, with the plot's own
  colour and its value, updating in place as the crosshair moves or a bar closes. On a phone
  the legend rows carry that readout directly while the pane has room for them; the tree is
  the fallback for a cramped cell, and it carries every study's values there too. Right-clicking an indicator also offers **Source code** (the legend's `{ }`
  chip by another route): a built-in opens read-only, a script editable. Double-clicking a
  study's row opens its settings.
  The tree multi-selects the way TradingView's does — **Ctrl/Cmd-click** extends the pick,
  **Shift-click** takes the range, **Ctrl/Cmd+A** takes every row, **Delete/Backspace** removes
  the pick and **Esc** lets go without closing the panel. A pick can hold studies and drawings
  at once; a sticky bar then carries the verbs that make sense for it (**eye** hides or shows
  the lot, **bin** removes it, **gear** for one study, **group** for compatible picks, and
  **duplicate** for drawing-only picks). Right-clicking inside a pick acts on the whole pick;
  on a phone a **long-press** starts a pick and the next tap extends it.

  Groups may contain **drawings only**, **indicators only**, or **both**; they may nest and
  can include objects from different panes. Grouping is organizational: it does not move an
  item to a different pane or change its physical z-order. Cross-pane/mixed folders appear
  once as a tree, while each member continues to render in its original pane. The group menu
  adapts to its contents: drawing groups have drawing sync, lock and drawing-template actions;
  indicator groups have indicator templates and live sync; mixed groups have both sets, with
  **Lock drawings** explicitly scoped to the drawings. **Duplicate group** is offered for
  drawing-only branches rather than silently dropping studies from a mixed duplicate.

  Drag onto another group header to nest; **Ungroup** lifts children a level, and an empty
  group disappears. Rename by double-click. Membership and nesting are stored with the layout
  and participate in undo/redo. The panel is scoped to the active chart; **Manage layouts**
  remains the separate workspace layout menu. On touch screens, hold a row then drag, or use
  its grip without waiting; a plain flick scrolls. Drawing selection stays synchronized with
  the chart (Ctrl/Cmd-click or marquee there, or a pick in the tree). Keyboard focus reveals
  row actions; Escape from a child form returns focus without closing Object tree.
- **Data window** — a square, standard pane for the **active chart**, opened from its topbar
  toggle or **More → Data window** on a portrait phone. On desktop it docks beside the chart;
  on a phone it is attached to the bottom at full host width, with a height-adjustable top edge.
  It has two tabs:

  - **Data** shows the symbol, interval, timezone, date/time, OHLCV and available indicator
    plots. The source is **Crosshair**, **Synced crosshair** or **Latest bar**. A linked
    follower reads its own bar containing the synced time; without an inspected bar it returns
    to its latest. Mouse hover and touch crosshair tracking drive the same live readout. There
    is no hold or automatic freeze: moving into the pane or selecting text does not pause it.
    Values follow bars, indicator calculations, replay, precision and timezone. **Copy** copies
    the current readout including collapsed sections, subject to clipboard permissions.
  - **Table** shows the chart's **loaded** candles, newest first, with date/time, OHLC, full
    volume and visible numeric indicator plots supported by the renderer. Candle OHLC and
    volume retain the full loaded values; indicator plots use chart display precision.
    Missing values show `—`. The current candle and studies update
    as data arrives. The header shows the market, interval, timezone and loaded count; replay
    shows only revealed bars. It is not a request for all exchange history: load more history
    on the chart to extend the table. A third-party renderer without the optional history seam
    shows its available candle bars without fabricated study columns.

  Scroll the table vertically for older bars and horizontally for more columns; the header and
  content-sized time column stay pinned and opaque. Click or tap a row, or focus its date/time
  button and press Enter or Space, to reveal that loaded candle on the active native chart. The
  chart keeps its zoom and briefly shows a background marker; reduced-motion preferences replace
  the glide/fade with an immediate pan and a static marker. Text selection does not navigate.
  On a third-party renderer without the optional navigation seam, rows remain read-only.
  Rendering is virtualized, so only a bounded slice is in the DOM. During a market load the pane
  hides old values instead of labeling them with the new market. The tabs support arrow keys,
  Home and End. Each pane's contents scroll independently.
- **Strategy tester** — a square, standard pane showing the active chart's strategy report.
  On desktop it docks beside the chart; in portrait it is attached to the bottom at full host
  width, with an adjustable top edge. Touch landscape uses desktop chrome. The four tabs are:
  **Overview** (total P&L, return on initial capital, max drawdown, profitable trades, profit
  factor and a cumulative-P&L curve); **Performance** (All / Long / Short statistics);
  **Trades** (one row per round trip in exit order, with a running total); and **Properties**
  (strategy declaration and inputs). Open trades appear last and are excluded from closed
  trade money columns. Tap or activate a trade number to reveal entry/exit time and price,
  size, bars held and available excursion figures. Times in trade details are UTC.

  The tabs support Left/Right, Home and End. Tables scroll within the pane, with sticky headers
  and a pinned first column. The trade list renders a bounded slice of large ledgers; on a trade
  number, Up/Down, Home and End navigate through the full list. Each tab retains its scroll
  position, including when a live result updates. A live repaint waits for an active scroll
  or text selection to finish, so a phone flick or copy is not interrupted. A market change
  hides the previous report while the new chart data and strategy result load. `script:run` feeds the active chart, while
  each cell's most recent run is remembered; the first strategy run opens the panel once unless
  another panel is already open. A missing ledger is identified instead of being called an empty
  ledger. The calculations use the engine's trade P&Ls and broker state as supplied, and missing
  optional metrics show `—`. If the broker's net P&L differs from the ledger total (for example,
  because an engine reports gross trade P&Ls and net broker figures), the status shows the
  broker net and marks the discrepancy; the tester does not silently change either figure.
- **The dock and floating panels** — built-ins and plugins
  ([`registerSidePanel`](../contributing/plugin-sdk.md#side-panels--registersidepanel)) share
  the same shell. On desktop, click the button immediately beside **Close** to turn a docked
  panel into a movable card; click it again to **Dock panel beside chart**. The chart regains
  the side column while the card floats. Several floating panels can stay open together with
  one docked panel. Opening another dock replaces only the current dock; interacting with a
  card or the dock brings it forward without rebuilding its contents.

  Drag a floating header to move it. A focused header also accepts arrow keys; right-click it,
  press **Shift+F10**, or tap it on a touch screen for position sliders and exact pixel inputs
  without dragging. Cards start at staggered positions. A panel's body may extend beyond the
  visible workspace, but its entire header and controls remain reachable. This does not enlarge
  or scroll the surrounding page; a host page with its own content can still scroll normally.
  If keyboard focus reaches an off-screen control, the card temporarily moves enough to reveal
  it without changing its saved position. On a floating card, drag the resize button immediately **after Close** to change width and height together;
  the opposite bottom-left corner stays fixed. Arrow keys on that button also resize. Clicking
  or tapping a resize button or grip does not open a size popup. Floating cards have no separate
  top strip or edge handles. Narrow headers, tabs and content scroll when needed, including the
  Pine Editor's header actions. Built-in cards can shrink to 160 × 112 px where the host has
  room. Contributed panels keep their declared resize bounds.

  A resizable dock's inner-edge width handle accepts arrow keys, Home and End; double-click
  restores the declared width. Object tree, Data window, Alerts, Pine Editor and Strategy
  tester remain square and start as full-height desktop docks. Watchlist and other panels that
  already had desktop maximize keep it. In phone portrait, every pane has a maximize/restore
  toggle immediately before Close. It fills the visible workspace and restores the preceding
  position and size. Contents and tabs remain mounted, and open modes, widths, heights and
  positions are saved and participate in undo/redo. A phone pane stays attached to the bottom:
  drag the separate strip immediately above its header to change height. The header itself
  does not move or resize the pane, and older saved phone offsets cannot detach it.
- **Bottom bar** — range chips, a live clock, and the timezone picker. Each chip switches
  the active chart's timeframe, **fetches the depth its window needs**, and frames it:
  `1D`→1m, `7D`→5m, `1M`→30m, `3M`→1h, `6M`→4h, `YTD`/`1Y`→1D, `5Y`/`ALL`→1W. Changing
  the timeframe by hand leaves range mode (the chip clears and the fetch depth returns
  to the chart's own `bars` setting). The picker's **Exchange** row (right under UTC) follows each
  chart's own market: a CME future renders in Chicago time, a US equity in New York, crypto
  in UTC — and in a multi-chart grid every cell reads its own market's clock. The bar's
  clock and offset show the active cell's zone. The chart settings' Time zone row (Symbol
  tab) is the same picker, Exchange included; picking a fixed zone anywhere switches the
  whole workspace back to that zone.
- **Context menus** — right-click the chart body for reset view, removing all drawings or all
  indicators, and the settings dialog; the price axis for that pane's own scale (autoscale,
  invert, regular/percent/indexed/logarithmic, and the label and level toggles); the time axis
  for the display timezone. On a touch screen a **long press** on the plot enters the
  crosshair and keeps it there — the finger's lift does not end the readout. On a new touch,
  the existing crosshair stays put and moves by the finger's displacement instead of jumping
  under it; tracking does not pan. A single tap exits, as does a pinch. A long press on the
  price axis opens a compact desktop-style menu with nested Labels and Levels; a long press
  on the time axis opens a compact timezone menu with its own search. Every pane's price scale has its own menu, so a study pane's scale
  is independent of the main one. Each menu's settings entry opens the settings dialog on the
  tab that belongs to it — Canvas from the chart body, Scales and lines from either axis.
  Rows a plugin adds sort in with the built-in ones: by default after the built-in actions and
  before the settings entry at the bottom of the menu (see [Right-click menu
  actions](../contributing/plugin-sdk.md#right-click-menu-actions)).

### What is built, and when

The shell is a workspace, not a page: nearly everything it can show starts **closed**, and
closed chrome is built the first moment it is opened, not at boot. That is why a four-chart
desktop workspace costs ~1.3k nodes rather than ~2.3k, and a phone ~1.2k:

- **A menu nobody has opened carries neither rows nor a layer.** The row list is projected
  from the menu's descriptors on the first `open` (and again only when the items or the
  state change), and the floating layer the list rides in is mounted by that same open (or
  by the hover that pre-warms it). A closed menu is a machine and a detached list — zero
  nodes — so a timeframe caret costs nothing until it is clicked, and the click still builds
  the nine rows and opens them in the same frame.
- **The status line's market bubble paints its glyph too.** A chart's status line carries a
  small tinted bubble naming the market's state (Open / Pre-market / Closed). It used to hold a
  ten-node inline `<svg>` for its 12px icon; it is now a masked element inside the same
  circle, tinted by the same `color`, with the same `role="img"` name. Each cell is 58 → 49
  nodes.
- **Tab is never a trap.** `Tab` inside a chart walks the grid's charts, then lets go at
  the last one so the browser can carry focus into the chrome — and the tab stop follows
  the chart it selected. A canvas that keeps Tab for every press is a keyboard trap
  (WCAG 2.1.2), not a shortcut.
- **A saved PNG keeps its glyphs.** The screenshot exporter rasterizes the chart's DOM
  chrome by hand (it has no HTML renderer to call), so an icon has to be redrawn as shapes,
  not copied: the exporter decodes each icon's mask and strokes the same paths in the
  icon's own colour. An icon whose mask is missing paints nothing — never a solid square.
- **An icon's mask must DECODE.** The glyph is a data-URI SVG used as a mask, and a mask is
  loaded as XML, where a repeated attribute is a fatal error (unlike inline HTML, which
  keeps the first). The helper de-dupes before encoding, so an icon that overrides a tier
  default still lands as the drawing it was declared to be — and a test walks the whole
  registry to prove every one of them decodes.
- **An icon is a colour, not a drawing.** Every icon the kit renders used to wrap an inline
  `<svg>` with one to four shapes inside it, so a 14px chevron cost three or four elements
  and the top bar spent 60 of them on nineteen glyphs. The glyph is now a **CSS mask**: the
  element carries no children, the shape lives in one shared stylesheet rule per icon id
  (`.vela-ic-<id>`, `head`'s style sheet — not the UI's node budget), and the paint is
  `background-color: currentColor`, so `color` still tints it and colour transitions still
  animate. Component rules like `.vela-switch .vela-icon { width: 12px }` keep working
  because the size lives on the element, not on a removed `<svg>`. An unknown icon id is
  still an empty, invisible span. The same painted path serves the renderer's own chrome
  (`iconGlyph`): the drawing rail's nine tool groups, the flyout badges, the favourite stars
  and the selected-row check are all masks now, so an open flyout holds **zero** SVG shapes
  and the rail is 117 → 56 nodes without losing a tool — the hover square that used to be a
  `.vela-dtb-hit` span is now the button's own `::before`, so a tool button's only child is
  its glyph. (A masked glyph is a data-URI document, so the mask carries the SVG namespace;
  without it the mask decodes to nothing and every icon is silently invisible.)
- **The rail's caret is drawn, not built.** A cell's little chevron — the hover target that
  opens a tool's flyout — used to be five elements (a button around a hit square around a
  wrapper span around an SVG around a path) and each icon paid for a wrapper span it did not
  need. Nine cells meant 45 nodes for two tiny glyphs. The caret is now a bare 11×22 button
  whose pill and chevron are `::before` / `::after`, and the icon's SVG carries its own 18px
  size: same hover reveal, same flyout on click, same tints, 54 fewer nodes.
- **A cell carries only what it is showing.** Each chart cell used to keep four invisible
  containers from construction: its own drawing-rail mount (a workspace shares ONE rail), its
  attribution mark (the grid mounts one for the whole workspace), the timeline-marks'
  positioning anchor, and the shade-right veil element. Each is now built by the state that
  shows it — the veil by the frame that paints a veil, the anchor by the first opened
  timeline mark, the mark by the moment attribution is on, the rail by the first time it is
  visible. The per-cell zoom cluster (bottom-center) is mounted the same way: by its first
  reveal. A cell is its chart root, its watermark and its status line.
- **One drawing rail per workspace, and only when shown.** Each chart *can* own a rail
  (that is what a standalone chart sees), but in a grid the shared bar on the left of the
  grid is the one on screen. A cell's own rail is therefore left unbuilt — 157 nodes per
  cell did nothing but sit at `display:none` — and it is constructed the first time
  something asks to show it. Its state (selection, magnet, lock) is still tracked while
  unbuilt, so a rail that appears later shows the right tool lit.

Nothing about this is visible in the UI: every control, panel, menu and dialog still
appears complete the first time you reach for it. It only changes what a boot costs.

**…and the click never pays for it.** Waiting until the click to build would trade boot
weight for a stall at exactly the wrong moment, so the shell spends the *intent* instead:
resting the pointer on a trigger for a beat (or focusing it, or pressing on it) builds that
menu's rows before the click lands, and the click itself only opens them. A pointer merely
passing over the bar builds nothing, so a page at rest still carries no rows.

**A legend row's buttons arrive with the hover.** An indicator row shows its title and
values at rest; its eye, gear, move and ✕ are built the first time the row is revealed (and
a hidden indicator gets its eye straight away). The fold measurement still counts the full
cluster, so a row that would not fit still folds.

**The price scale's A/L chips arrive with the hover that shows them.** The Auto and Log
buttons that sit at the bottom of a pane's master scale column are built the first time a
cursor actually reaches that column — six nodes per pane (the strip and its two chips) that
a chart nobody has hovered does not carry. They still reflect the hovered pane's state the
moment they appear, and a touch chart (no hover) never builds them at all.

**A chart's own controls arrive with the cursor.** The small zoom/maximize/reset cluster
that appears near the bottom-centre of a chart is built the first time it is revealed, not
with the chart — on a phone the compact reset chip is out from the start, because a thumb
has no hover to wait for.

**Chrome that belongs to a state arrives with that state.** Four surfaces are only ever
meaningful in one situation, so they are built when it first happens rather than hidden
until it does: the *scroll to the latest bar* chip (a chart showing its newest bar has
nothing to jump to), the **REPLAY** watermark line and the status line's replay badge (both
appear with a session), and the status line's show-chart eye (only while the chart itself is
hidden). A workspace that never replays, never scrolls back and never hides a chart carries
none of their nodes — 68 across four cells — and each one comes out at the right size class
when it arrives (a phone's scroll chip is the 32px finger target, not the 26px cursor one).

**The desktop's chrome is not in a phone's document.** The top bar, the shared drawing rail
and the bottom bar belong to the desktop size class: on a phone they are detached (not just
hidden) and come back — in exactly the same place, with the same state — when the layout
returns to desktop. Nothing is rebuilt on the flip; it is the same widgets re-attached.

**Chrome that belongs to one size class is built by that class.** A desktop workspace does
not construct the phone's bottom bar or the drawing dock above it, and a phone does not pay
for them twice; a flip between the size classes builds what the new one needs and projects
the active chart onto it. The replay transport is mounted by the first replay session —
`Shift+↓` still starts and pauses one from the keyboard.

**Panels and dialogs mount when they open.** The Pine editor's surface, a dialog's scrim
and panel, and the Layout setup matrix are held outside the document until first opened.
A docked panel's header, body and width handle are appended to the dock on first open, so
closed built-in panels do not add their UI nodes to the document; closing retains the panel
shell and applicable state. Some contents, including the
Strategy tester report, are refreshed when reopened so they reflect the latest chart. The Pine
editor loads its Monaco surface on first open and measures it against the real box rather
than a detached one.

Long lists stream instead of landing in one lump. The symbol picker's page of a hundred
symbols paints its first screenful when the search opens and appends the rest over
the next few frames, and its row icons are lazy — off-screen coin logos are fetched and
decoded as they come into view, not all during the opening click.

### Indicators, templates, Compare and Symbol Search

**Indicators**, **Indicator templates**, **Compare** and **Symbol Search** are four
separate, non-modal workspace panes. On desktop they start docked beside the chart; use
**Float/Dock** beside Close to switch to a movable card, and drag the control after Close
to resize a floating card in both dimensions. Several floating panes can coexist with one
dock. On a portrait phone each opens as a square, full-width bottom-attached pane: drag the
separate grip above its header to resize, or use fullscreen/restore beside Close. The title
itself does not detach the pane. Phone landscape uses the desktop-style dock again. The
panel layout and size use the normal workspace persistence and history.

Indicators retains search, categories, favorites, recents, on-chart controls, settings and
source access. Its **Templates** shortcut opens the *separate* Indicator templates pane,
not a tab merged into the indicator catalog. A compact indicator settings form can remain
open over its parent pane; closing the form returns to Indicators. The dedicated toolbar
button and phone **More → Indicator templates** remain available as well.

Symbol Search keeps the watchlist, ranked results, asset filters, exchange/venue labels and
keyboard selection. Arrow keys move the highlighted result and Enter selects it; watchlist
stars never select a market. Search can load a watchlist symbol on all charts in a multichart
layout. In **Compare with** mode that bulk primary-market action is omitted so choosing a
comparison cannot accidentally replace the charts' main symbols. Compare controls one
comparison symbol for the active chart, with Same % scale, New price scale or New pane, plus
removal. Its symbol and display placement restore with the chart; when Compare switched the
price axis to percent, removing it restores the price axis without overriding a percent axis
you chose yourself. Canceling symbol search returns to Compare unless another pane has taken
the dock.
A provider index arriving late refreshes an open search without discarding its query.

### Chart templates

A **template** is a chart's *indicators, settings included* — not the chart: no drawings,
and the symbol and timeframe only if you asked for them. TradingView keeps its own
("Indicator templates") beside the Indicators button. In this shell the separate pane
has **Favorites**, **My templates**, **Technical** and **Financial** tabs. The **Save**
and **Import** controls stay above the independently scrolling list in My templates and
Favorites. It offers

- the saved templates, each with its indicator count (and the market, when it was saved
  with one) — **clicking one applies it** here and closes the pane, replacing this chart's
  indicators as TradingView's does;
- **the six built-ins TradingView ships** — *Bill Williams' 3 Lines*, *Displaced EMA*,
  *MA Exp Ribbon* (five EMAs at 8/13/21/34/55), *Oscillators*, *Swing Trading* and
  *Volume Based* — in the Technical/Financial categories and read-only: they apply like any other
  template and can be favorited, but cannot be renamed or overwritten;
- a separate **favorite** control, the row's **default star** (the set **new charts open
  with**), and the row's **kebab**: *Apply to all charts* (a multi-chart
  layout only), *Rename…*, *Export*, *Delete* — delete arms on the first tap, deletes on
  the second;
- **Save template…** — a name, and a *Remember symbol & timeframe* box that is **off by
  default**, because a template is meant to travel between markets;
- **Import template file…** for a `.vela-template.json` written by *Export*.

Escape first cancels an open save/rename form or closes a row's actions without closing the
pane; otherwise it closes the pane and returns focus to its opener when available. The desktop
button, indicator shortcut and phone More entry use the same template store and panel. From Object tree, open an
indicator, group or selected indicators → **Indicator templates** → **Save as new template…**
or **Add to existing template**. A mixed selection contributes only its indicators; drawing
sets remain a separate feature. The compact name form leaves Object tree open. Native types,
source-backed scripts, their languages, inputs, declaration properties and visibility travel
with the template. Saving or appending does not apply it to the chart.

Applying replaces the target chart's indicator set. A target without a required scripting
engine is skipped and reported instead of losing its current indicators. Likewise, if removing
the last study in a pane would leave a drawing stranded there, that chart is skipped: move the
drawing to a surviving pane first. Other safe targets in an all-chart request can still apply.
`ws.saveTemplate` / `applyTemplate` / `renameTemplate` / `deleteTemplate` /
`setDefaultTemplate` drive the library from code. Composition id `'templates'` is also
available in a single-chart shell.

### Indicator live sync

Live indicator sync is **opt-in** and separate from drawing sync and one-shot template
application. From an indicator, an indicator group or a mixed group in Object tree, choose
**Indicator live sync → Live sync in layout** or select individual charts under **Live sync to
specific charts**. Initial linking uses the initiating indicator's settings; later input and
style/declaration-property changes on **any linked copy** propagate to its peers. Existing
inherited counterparts and single-instance studies can be reused; unrelated same-type studies
are not silently commandeered. A missing required engine is reported, and an inherited script
that is still loading is linked when its manifest resolves.

The scope is the **current layout**, never all saved layouts. A layout-wide link can be enabled
on one chart before expanding the grid; newly created charts then join it. Changing the link to
**Not synced** leaves the copies on their charts. Visibility, pane placement, source-code edits
and deletion are local rather than propagated; removing a linked copy also excludes that chart
from future automatic layout expansion for that link. Link settings and the latest values are
saved with the layout so temporarily hidden charts can catch up when restored. From host code,
`ws.setIndicatorLiveSync(ids, 'layout')`, `ws.setIndicatorLiveSync(ids, 'charts', cellIds)`,
`ws.setIndicatorLiveSync(ids, 'none')`, and `ws.indicatorSyncStatus(id)` use the active chart's
indicator IDs; status distinguishes connected `charts` from still-loading `pending` targets.
This live link is a Vela extension; TradingView documents manual indicator
application rather than automatic indicator synchronization across a layout.

### Chart Settings and color

On desktop, drag Chart Settings by its header, or drag the resize button just after Close to
change both width and height; its arrow keys resize too. In phone portrait it starts as a
bottom-attached pane with a separate height-resize strip immediately above the header. Drag
the grip to resize; the title stays in place. Use the toggle immediately before Close to fill
the visible workspace and restore the previous height and bottom-attached position. Grip and resize-button taps do not open size
popups. Its section button opens the section rail, and its contents scroll inside the pane.
Templates sits in the header, so a fixed action footer does not take space from a short
pane. The square, compact color picker stays inside the visible screen, but may extend beyond an
embedded chart or workspace when needed; it scrolls internally when space is limited. Its recent-color strip automatically keeps up to ten selected hues for the
current page session; scroll the strip to reach the rest. Select the current-color well with
the pencil to edit a custom color. The native custom-color chooser itself is controlled by
the browser and operating system. The picker includes its own opacity slider and numeric
percentage, so Crosshair does not show a duplicate opacity row. Tap a point on the slider,
drag it, use arrow/Home/End keys, or type a percentage. Existing
crosshair configurations with alpha in both the color and `crosshair.opacity` keep their
combined appearance; opening the picker alone never changes them. On an edit, the chosen
hue is stored as opaque RGB with the effective opacity in the legacy opacity field. A
projection-wide opacity setting remains separate because it affects more than one color.

### Chart-settings templates

The chart-settings dialog offers a **Templates** control in the desktop footer or the
phone pane header. It names the template the chart currently wears (or says *Templates*
when it matches none). A settings
template is the **appearance** — candle and background colours, grid, scales, status line —
and deliberately neither a market nor an indicator set: applying one restyles whatever the
chart is showing.

- **clicking a row** applies it to this chart (the dialog re-seeds its controls at once, so
  it never shows the settings it just replaced);
- the row's **star** makes it the look **new charts open with** — a template that keeps a
  live chart out of it leaves the star alone;
- the row's **trash arms on the first tap and deletes on the second**;
- **Save template…** captures the open chart as it is now — the same document
  `getConfig()` returns, which is also what `applyConfig` takes back;
- **Apply defaults** restores the factory look;
- **Apply to all** copies the chart's current settings onto every chart in the layout. On
  desktop it is beside Templates; on a phone it is the first action inside Templates.

Deleting a template that the house pointer names clears the pointer rather than leaving it
dangling. The phone's action menu is scrollable and stays within the visible workspace.
From code: `ws.appearanceTemplateList`,
`appearanceTemplateName`, `saveAppearanceTemplate`, `applyAppearanceTemplate`,
`deleteAppearanceTemplate`, `defaultAppearanceTemplate`, `setDefaultAppearanceTemplate`.

### Indicator settings — Inputs, Style and Visibility

The indicator settings dialog provides three standard tabs alongside any script-declared
input tabs:

- **Inputs** is generated from the script's declared input fields and keeps its Pine groups,
  inline rows, and conditional gates.
- **Style** exposes settings for renderable plot series: plot visibility, static colors where
  a single color is meaningful, line width/style, candle up/down colors, and the indicator's
  price-scale labels and status-line values. A dynamically colored plot does not get a single
  misleading color picker, and Pine plots declared with `editable=false` stay out of the
  generated controls. Pine drawing objects (lines, boxes, labels, tables) are not plot
  series, so they do not get fabricated Style controls; use the script's color Inputs where
  it declares them.
- **Visibility** provides interval-family switches for Ticks, Seconds, Minutes, Hours, Days,
  Weeks, and Months. A disabled family hides the indicator on charts in that family; changing
  the active interval re-evaluates the selection.

Edits apply live, and **Cancel** restores the Style and Visibility choices captured when the
settings dialog opened. Tab navigation supports keyboard arrows and scrolls horizontally when
space is narrow.

### Indicator settings — Defaults

The indicator settings dialog's footer opens with **Defaults ▾** (TradingView's own
control), a menu of:

- **Save as default** (then *Update saved default*) — this indicator **type**'s current
  inputs and declaration props become what every *new* instance of that type opens with,
  whichever chart or layout it is added on. Existing instances keep their own settings;
- **Load saved default** — writes the saved values into this form, greyed until one exists;
- **Clear saved default** — forgets it, so new instances fall back to the declaration again;
- **Apply to every <study> on this chart** / **…in the layout** — copy the current settings
  onto the other instances of the same type (the rows only appear when there are some);
- **Reset to factory defaults** — the old reset button, now one row in the menu.

Values live in the workspace document (`indicatorDefaults`), so they survive a reload and
travel with a saved layout, and they are sanitized to primitives on the way back in. A
script indicator (no registered type) keeps the plain *Reset defaults* chip. From code:
`ws.saveIndicatorDefault(type, inputs, props)`, `indicatorDefault(type)`,
`clearIndicatorDefault(type)`, `indicatorDefaults` in the document, and
`chart.renderer.setIndicatorDefaults(host)` — or `ws.indicatorDefaultTypes()`.

### The layout menu

The chip after undo/redo reads the active layout's name — *Untitled layout* until it has
one — and lights a dot when there is something to save. Its **Save** button and `Ctrl`/`⌘ S`
write a named layout in place; an untitled layout first asks for a name. Press the chip to
open a small anchored **Manage layouts** menu, not a separate panel. On a phone, open
**More → Manage layouts**; the menu floats next to More. It also opens from
**Layout setup → Manage layouts** on either device. It keeps the actions in compact,
scrollable menu pages:

- **Save layout** or **Name and save…**, **Autosave**, **Make a copy**, and **Rename…**;
- **Sharing** — turn workspace-link sharing on or off, copy or view the link, or open a
  shared link; the link remains selectable if clipboard access is refused;
- **Saved layouts** — select a layout to open, rename, copy under a chosen name, share,
  export or delete it. Active and unsaved layouts are marked, and long lists can be
  filtered. Delete requires a second confirmation;
- **More actions** — **Save as…**, export chart data as CSV, import a layout file, or
  open the existing drawing-template library.

The menu uses the same saved-layout store as the rest of the workspace. It flips or
scrolls to fit available space, closes on an outside click, and returns focus to its opener
on Escape. Arrow keys navigate its menu rows. Composition id `'layouts'` supplies the
name chip on multi-chart shells.

### Following menus and panels

Every menu, popover, dialog, drawer and side panel announces itself with a DOM event on its
own element: `vela:surface-open` once it shows, and `vela:surface-close` as it starts to
close, while it is still on screen and before it fades out or leaves the DOM. Both bubble, so
one listener on the chart's container follows all of its chrome without watching the DOM:

```ts
import { SURFACE_OPEN_EVENT, SURFACE_CLOSE_EVENT, type SurfaceEventDetail } from '@luxalgo/vela/ui';

container.addEventListener(SURFACE_OPEN_EVENT, (e) => {
    const { kind, trigger } = (e as CustomEvent<SurfaceEventDetail>).detail;
    // e.target is the surface: a .vela-menu, .vela-popover, .vela-dialog, .vela-drawer, .vela-panel …
});
```

`kind` is `'menu'` (submenus and the drawing toolbar's flyouts included), `'popover'` (select
lists, color pickers, mark cards and the generic-host layout picker), `'dialog'`, `'drawer'` or `'panel'`.
`trigger` is the element that opened it — a menu's button, a submenu's row, the control that
had focus when a dialog opened — or `null` when there is none (a right-click menu). A surface
created without an explicit host portals to `<body>`; listen on `document` to catch those too.

### Animating closes

Surfaces leave the screen at once by default. To animate them out, style the `data-closing`
attribute: as a surface starts to close (right after its `vela:surface-close`), Vela sets
`data-closing` on it and keeps it displayed but inert — it takes no clicks and no focus — until
every CSS animation or transition that the attribute started on it or inside it has finished,
then hides or removes it. These elements get the attribute:

| Element | Surface |
| --- | --- |
| `.vela-menu` | A dropdown or context menu, each submenu on its own. |
| `.vela-popover` | Select lists, color pickers and other kit popovers. |
| `.vela-dialog` and `.vela-dialog-backdrop` | A dialog and its scrim. |
| `.vela-drawer` and `.vela-drawer-backdrop` | A bottom sheet (mobile chrome) and its scrim. |
| `.vela-panel` | A side panel. |
| `.vela-lp` | The generic-host layout picker (the workspace's Layout setup uses `.vela-panel`). |
| `.vela-dtb-flyout` | A drawing toolbar flyout. |

```css
@media (prefers-reduced-motion: no-preference) {
    .vela-menu[data-closing],
    .vela-popover[data-closing],
    .vela-dialog[data-closing],
    .vela-dialog-backdrop[data-closing] {
        animation: host-fade-out 150ms ease forwards;
    }
}
@keyframes host-fade-out {
    to { opacity: 0; }
}
```

- **Without exit CSS nothing changes**: no animation starts, so the surface closes at once.
- **The wait is capped at 1 second**, and an infinite animation inside the surface (a spinner)
  never holds it.
- **Reopening during the exit cancels it**: the same element loses `data-closing` and is
  interactive again. A surface its owner rebuilds on every open (the chart settings dialog)
  lets the previous copy finish its exit beside the new one.
- **A side panel reports closed at once** (its `open` state and the topbar button), but keeps
  its column until the exit ends. A panel that hands the column to another one, or that a
  restored state closes, leaves without an exit.
- **Reduced motion is yours to honor**: Vela waits for whatever your stylesheet starts, so
  guard the exit rules with `prefers-reduced-motion` as above.

## Composing the topbar

The `topbar` option DESCRIBES the bar: `{ left, right }` lists of the **visible**
entries, per side, in render order. A side you don't declare keeps its default — the
option is pure opt-in, and a shell without it behaves exactly as before.

```ts
new VelaWorkspace('#chart', {
    topbar: {
        // right undeclared ⇒ default right side (actions, replay, alerts, panels, screenshot)
        left: ['symbol', 'timeframes', 'style', 'my-plugin.indicator-menu.open', 'undo-redo'],
    },
});
```

Entries come from one shared vocabulary:

| Entry | What it is |
| --- | --- |
| `'symbol'` | The symbol button (opens the search). |
| `'timeframes'` | The favorite chips + timeframe dropdown group. |
| `'style'` | The chart-style dropdown. |
| `'layout'` | The Layout setup button (renders on multi-chart shells only). |
| `'layouts'` | The saved-layout chip — name, unsaved dot, Save — and the [layout menu](#the-layout-menu) it opens (multi-chart shells only; default last in `left`). |
| `'templates'` | The separate Indicator templates pane, opened beside `'indicators'` (a single-chart shell has it too). |
| `'indicators'` | The Indicators slot — the built-in button, or a plugin's [slot override](../contributing/plugin-sdk.md#replacing-a-built-in-button--slot-overrides). Omitting it removes the button, the mobile stop, the `/` shortcut, and skips the built-in picker pane. |
| `'undo-redo'` | The undo/redo pair. |
| `'compare'` | The Compare tool — opens the Compare pane for the active chart (symbol, and the three display modes). The glyph takes the accent and its tooltip names the compared ticker while that chart carries a second series; `'compare'` renders only when the shell offers the feature. |
| `'replay'` | The bar-replay button — opens the replay menu (Select bar / Select date / Random bar). Renders only when the shell runs the replay chrome (`replay: false` removes it, and the mobile bar has no counterpart). |
| `'alerts'` | The alerts bell (badge included). |
| `'panels'` | The side-panel toggle group (object tree, data window, contributed panels). |
| `'screenshot'` | The screenshot slot — the built-in download button, or a plugin's override (which then also owns `mod+alt+S` and the mobile drawer button). |
| `'actions'` | The FLOW slot: where contributed actions not named in the lists land, per their declared `align` (may appear once per side). |
| any other id | A [contributed action](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction)'s `id` — naming it PINS the action at that list position, overriding its declared `align`/`order`. |

The rules that make it predictable:

- **An explicit list is that side's complete contract.** Ids not listed do not render
  there — including contributed actions, when the side has no `'actions'` slot. It also
  **freezes** the side: chrome a future Vela™ release adds will not appear for a curating
  host (the deliberate trade-off of describing what IS there).
- **Hiding an entry removes its other entry points too**: the mobile counterpart (the
  more-drawer's undo/redo/screenshot buttons, alerts and panel rows, the mobile-bar
  indicators stop) and the entry's keyboard chord — `mod+alt+S` goes with
  `'screenshot'`. Ctrl+Z / Ctrl+Y stay regardless of `'undo-redo'`: they belong to
  editing, not to the buttons.
- **Mobile keeps its own arrangement.** The composition decides *visibility* everywhere,
  but only the desktop bar takes the *ordering* — the mobile bar and drawers keep their
  touch-first layout.
- Separators are the shell's business — never listed.

The replace-a-built-in recipe pairs naturally with the plugin SDK: hide `'screenshot'`,
pin your own action in its place (`right: ['actions', 'alerts', 'panels',
'mytool.screenshot.open']`), and the contributed dropdown sits exactly where the
built-in button was.

## Mobile

In a container narrower than ~640px (or up to ~920px with a coarse pointer — a
tablet), the shell switches to its **mobile chrome**; `layoutMode: 'mobile'` or
`'desktop'` pins the choice. The mode is container-driven and live: resizing across
the breakpoint swaps the chrome in place. Most transient dialogs close; open Chart
Settings instead changes presentation while retaining its selected section and chosen
phone-pane height. On a touch phone in landscape, desktop-style chrome takes over: the pair
stays pinned and the rest of the top bar can scroll. Sheets and pickers act on the
**active cell**.

What changes on mobile:

- **One bottom bar replaces both desktop bars.** Its two ends are pinned: the **pair
  name** on the left (the pin that says which cell your next tap acts on; tapping it
  opens the bottom-attached Symbol Search pane) and, on the right, the **More pane** and
  **chart settings**. Everything between them scrolls sideways in one band, in the order
  a trade is set up: **interval → chart type → undo / redo → drawings → fullscreen →
  indicators → the script editor**. Undo and redo sit near the head of the band because
  the band is only ~3½ stops wide on a 390px phone: a stop parked at its tail lives its
  whole life scrolled out of sight. Both stops are state-bound — an empty history dims
  them and takes them out of the tab order — and they dispatch the **active chart's**
  unified history (the same one the desktop topbar drives). The interval button is a bottom sheet with the date-range presets
  on top and the timeframe grid below; drawings is a sheet with a search bar, the tool
  groups as scrollable tabs and favorite stars; the editor (when a scripting engine is
  configured) opens as a bottom-attached pane (see
  [scripting engines](./scripting-engines.md#the-script-editor)). The band fades at
  whichever edge still has stops behind it, so a phone with no chart maximized still
  shows where the tools went. The More pane has no search box; its flat, grouped interior keeps
  undo/redo, screenshot, chart type, the side panels, time zone, alerts, contributed topbar
  actions, and an entry per
  **hidden chart** (`ws.hiddenChartList()` — the charts a smaller layout set aside; tapping
  one puts it in the active pane and parks the chart it replaced, `ws.showHiddenChart(id)`
  from code). On multi-chart grids, **Layout setup** is one entry containing Layout and
  Chart syncing tabs; **Manage layouts** and **Indicator templates** are separate actions.
  **Manage layouts**, **Cursor**, **Time zone** and **Chart actions** open compact floating
  menus over More without closing it or changing its size or scroll. The timezone menu's own
  search narrows the desktop-equivalent zone list. The chart-type chooser keeps its favorites
  and selection controls in a square-cornered surface.
- **Selected drawing controls stay on one line.** Open the drawing toolbar's existing **…**
  to reach controls that do not fit and its duplicate, style and ordering actions. The menu
  keeps each hidden control's icon and label, sizes to its content, is viewport-bounded, and
  cannot be panned sideways. It may extend beyond the chart when space requires. On desktop,
  drawing **Settings** follows the Chart Settings floating-card pattern: a direct two-axis
  resize control, full-card viewport bounds, and both horizontal and vertical content scrolling.
  On phones, it follows the Data Window pane: bottom-attached, a separate resize grip, and
  maximize/restore beside Close. The pane remains within the workspace and visible viewport;
  its header does not drag it. The bottom-bar **Drawings** entry opens the tool picker in a
  square, bottom-attached pane with its own resize grip, maximize/restore and Close controls;
  More continues to list **Object tree** under that name. Cancel still restores the drawing to
  the state it had when settings opened.
- **The docked drawing toolbar hides.** Picking a tool from the drawings sheet arms it
  and shows a floating pill over the chart — the armed tool's icon, the magnet cycle,
  stay-in-drawing-mode, the eraser, and ✕ to disarm. Favorites keep working (stars in
  the sheet), so a radial-wheel-style picker built on them keeps its data.
- **Compact child forms** such as indicator settings remain separate from their parent
  pane; closing the form returns to the still-open Indicators pane. Smaller action menus
  stay compact rather than becoming full panels.
- **Side panels** open over the chart instead of docking a column beside it. Indicators,
  Indicator templates, Compare, Symbol Search, Object tree, Data window, Layout setup,
  Pine Editor, Alerts, Strategy tester and More start as square, full-width,
  bottom-attached panes. Their resize grips sit in a separate strip above the header; dragging
  the title leaves the pane in place.
  Each has a fullscreen/restore toggle just before Close; restore returns to the previous
  position and size. Chart Settings uses the same interaction and remains non-modal: the
  exposed chart stays interactive. Drag its grip or use the grip's keyboard arrows; tapping
  it does not open a height popup. Its section rail and body scroll independently. The desktop
  Float/Dock button is hidden in portrait: one phone pane is visible at a time, and other
  desktop cards are suspended rather than lost. Rotating back restores those cards and their
  positions; a panel explicitly closed on the phone stays closed. Phone bottom drawers also
  keep their resize grip in a separate top strip and do not move when their heading or blank
  rail is dragged. Landscape phone mode uses the desktop-style dock again.
- **The indicator legend is measured, not assumed** — in BOTH directions: the rows (title,
  values, hide, ⚙, ×) show whenever the pane can hold them by height *and* by width (a
  title stub plus the action cluster), exactly as on a desktop, and only a genuinely
  cramped cell folds them behind a bordered count chip. There the chip is the door to the
  **object tree** instead of an in-place unfold — its per-indicator action menu carries an
  "Indicator settings" entry, so everything the rows offered stays one tap away. The tree's
  rows carry every study's values (see above), and its menu also opens a study's
  **source code**.
- **The More sheet has a "Pine Editor — Open" row**: this is the phone's one-tap door to
  the same Monaco-based editor used on desktop. Long-press the code or use its **Actions**
  button for editing operations; the minimap hides in phone portrait. See the
  [script editor](./scripting-engines.md#the-script-editor) for suggestion coverage,
  clipboard permissions and the mobile-browser limitation.
- **Pane controls are measured, not switched off.** `move up / move down / collapse /
  maximize` used to be suppressed outright by the mobile mode flag. They now follow the
  desktop rule on every device: a pane that can hold a row of 24px chips under its legend
  line (≥150px of data width) keeps the cluster up *permanently*, because a touch screen
  has no hover to reveal it — and the pane at the plot's top drops it below the status
  line's chip rather than on top of it. A pane without that room shows nothing; every one
  of its verbs is in the object tree, one tap away.
- **The status line keeps O/H/L/C on a phone.** The width ladder gives up the bar delta
  before it gives up a value: the absolute change first (the percent stays, as
  TradingView's phone layout reads it), then the delta moves up onto the symbol line so the
  four values keep a row of their own. 360–430px therefore read out **O H L C + change** on
  two lines; only a truly cramped chip (≈320px) falls back to the close.
- **Layout setup and Manage layouts stay separate.** More opens one **Layout setup** pane
  with **Layout** and **Chart syncing** tabs. **Manage layouts** is a minimal floating menu
  for autosave, copying, renaming, sharing and saved layouts, rather than another panel.
- **Indicator templates have their own panel.** Its Favorites, My templates, Technical and
  Financial categories keep template management separate from both the indicator search
  and layout management.
- **Drawing templates come in two kinds.** A tool's saved *look* is still on the floating
  toolbar and in a drawing's settings; a **drawing set** is a whole reusable bundle saved
  from the object tree (selection, group or bulk menu → **Drawing templates → Save as
  template…**). Geometry is stored as time offsets and price ratios, so a breakout pattern
  keeps its shape on another symbol; insertion is one undo step and lands as a group in
  the tree. **Manage layouts → More actions → Drawing templates** opens the library,
  which lists sets first (insert / export / import / delete), then per-tool looks.
- **Every plottable built-in has Pine source.** The legend's `{ }` opens v6 scripts for all
  72 classic studies plus **Volume** and **Compare**; VPVR (visible-range volume profile)
  is the one intentional exception, matching TradingView.
- **Touch gestures**: one-finger pan (with the usual fling) and two-finger pinch zoom
  anchored between the fingers. **Long-press** the plot to enter crosshair tracking:
  drag to inspect without panning, and lift to keep the crosshair and values visible.
  Touch again and drag by a relative offset to move the retained crosshair without it
  jumping under your finger; a single tap exits tracking. A pinch exits tracking and
  zooms normally. With no loaded bars, the lines remain visible but no price, time or
  OHLC is invented. Long-press tracking temporarily displays the configured crosshair
  even when Arrow, None or another non-line cursor is selected, provided an active drawing
  tool is not using the gesture. It does not change saved cursor or crosshair settings. The
  legacy default color/opacity pair gets temporary contrast-aware tracking ink on light/dark
  backgrounds; other color/opacity values, shapes and runtime overrides remain in force.
  A **double-tap** mirrors the desktop double-click: on the price axis it resets that
  pane's scale to auto, on the time axis it fits the view to content, and inside the
  plot it maximizes the tapped pane (price or indicator) — a second double-tap
  restores the split. The price/time axis strips still drag-rescale, and the button
  that jumps back to the most recent bar stays visible whenever the chart has data.

### Why these doors are separate

A **layout** is the whole saved workspace (symbol, interval, indicators, drawings, colors),
opened from **Manage layouts**, while **Layout setup** combines the multi-chart grid and its
chart-syncing controls in two tabs [1](https://www.tradingview.com/support/solutions/43000746975-tradingview-layouts-a-quick-guide/).
An **indicator template** is only the applied studies with their inputs and styles — never
drawings or the theme — and it replaces the chart's current stack when applied
[1](https://www.tradingview.com/charting-library-docs/latest/saving_loading/)
[2](https://www.tradingview.com/support/solutions/43000543048-what-are-indicator-templates/).
A **drawing template** is officially one tool's saved properties; TradingView's drawing
API groups have one pane and sequential z-order
[1](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/drawings-api/).
Vela deliberately extends the organizational tree to indicators and mixed, cross-pane folders
without repaning or restacking the members, and adds **drawing sets** — a selected group saved
with relative geometry. Applying one study set to every chart follows TradingView's own
*Apply these Indicators to Entire Layout* rule
[18](https://www.tradingview.com/blog/en/apply-all-technical-analysis-tools-to-all-charts-in-the-workspace-19368/).

Built-in source is not universal on the reference either: TradingView says Volume Profiles
and Chart Patterns are not Pine, so their `{ }` source is unavailable
[1](https://www.tradingview.com/support/solutions/43000481659-i-want-to-see-the-source-code-of-a-built-in-script/).
Vela goes further — every plottable built-in, including Volume and Compare, now opens a
readable v6 script; only the viewport-dependent VPVR layer keeps no source. Undo/redo and
fullscreen are header tools on the reference, so the phone bar keeps them in its scrolling
band rather than one drawer deep [3](https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/)
[13](https://www.tradingview.com/charting-library-docs/latest/releases/release-notes/).

Embedders need nothing special: the mode also reaches the renderer's own chrome, and a
chart in a phone-sized *container on a desktop page* gets the same treatment — the
shell's own bounds, not the viewport, are what count.

## Theming

The `theme` option (`'dark'`, `'light'`, or a full theme object) skins the whole shell —
charts, topbar, menus, panels. Swap it at runtime with `ws.setTheme(...)`: every chart
re-skins live and the chrome follows, no rebuild. Users reach the same switch in chart
settings → Canvas → Theme. The built-in themes share the same candle colors, so
switching never recolors the series.

## Customization

Three levels, shallow to deep:

1. **Design tokens** — all chrome is styled through `--vela-*` CSS custom properties
   (surfaces, borders, focus, radii, spacing, z-index). Override them on the container.
2. **Stable class names** — every component uses prefixed classes (`.vela-dialog`,
   `.vela-menu-item`, `.vela-sp-row`, …) your CSS can restyle.
3. **Contributed actions** — plugins and hosts add topbar buttons and context-menu items
   as data descriptors via
   [`registerWidgetAction`](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction);
   the kit's primitives (`Dialog`, `Drawer`, `Menu`, `Tooltip`, `Popover`, `Switch`,
   `Select`, `NumberInput`, `TextField`, `ColorField` / `buildColorPicker`,
   `KeymapManager`) are exported from `@luxalgo/vela/ui` for building your own panels against
   the headless core. Form controls share `md` (settings dialogs: 34px fields, hover
   steppers, chip colors) and a compact `sm` size so a host panel can match either
   surface.
