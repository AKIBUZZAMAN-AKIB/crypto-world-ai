# Round 21 — Where Vela stands against TradingView

**Scope:** chart types & price styles · layouts & workspace sync · drawing tools.
**Mode:** research and explanation only. No source files were changed for this report; the tree is still at `239ab5d`.

**How to read the labels**

| Label | Meaning |
|---|---|
| **HAVE** | Behaviour exists and is reachable from the UI. |
| **PARTIAL** | The primitive exists but a verb, a mode, or a scope is missing. |
| **MISSING** | Nothing in the tree does this. |

Every "MISSING" carries the *architectural* reason it is missing, not just a name. That is the part that decides cost: two items with the same word can differ by a week.

---

## 0. The one-paragraph answer

Vela's drawing catalogue is roughly at 80–85 % of TradingView's and its **layout** story is already *broader* than TradingView's (44 named presets plus a free-form grid composer, versus TV's ~20). The genuine gaps are concentrated in exactly two places: **(1) chart types** — Vela has 6 price styles to TV's 20+, and the missing 14 split into two very different jobs (9 cheap *painting* variants vs 5 expensive *re-bucketing* types like Renko), and **(2) layout verbs** — one missing action (CSV export of chart data) plus two missing *scopes* (per-layout share link, global drawings sync). Drawing tools are the smallest gap of the three: what is missing is mostly content-shaped (annotations, pattern libraries, time-cycle objects) rather than mechanically hard.

---

# Part A — Chart types and price styles

## A1. What Vela actually has

| Layer | Where | Reality |
|---|---|---|
| Style id type | `src/core/options.ts:355` | `PriceStyle = 'candles' \| 'bars' \| 'line' \| 'area' \| 'baseline' \| 'heikinashi' \| (string & {})` |
| Built-in list | `src/renderers/native/core/chartConfig.ts:356` (`BUILTIN_PRICE_STYLES`) | **6**: candles, bars, line, area, baseline, heikinashi |
| Style menu contents | `chartConfig.ts:453` (`priceStyleIds()`) | built-ins **+ every registered chart type** |
| Extension seam | `src/chart-types/registry.ts:68` (`ChartTypeDefinition`), `:380` (`registerChartType`) | full type definition: `id / label / icon / settings / barTransform / tickerModifier / dataEngine / basePainting` |
| Registered types | `src/chart-types/builtins.ts` | **one**: `heikinashi` (which is already a built-in style) |

So the visible style picker is six entries. Everything else must come through `registerChartType` — and there is deliberately **no** `registerPriceStyle`, no `priceStyleRegistry`, and no entry in `src/core/price-styles/` other than `BarTransform.ts` and `heikin-ashi.ts`.

## A2. The two seams — and why the missing types are not one job

The registry models **two** kinds of new chart type, and the difference is the whole cost story.

### Seam 1 — `BarTransform` (cheap, N bars in → N bars out)

`src/core/price-styles/BarTransform.ts` takes an OHLCV bar and returns one bar. Same timestamps, same count, same x-axis. Heikin Ashi is the existing user of this seam.

Anything that only changes *how a bar is drawn* belongs here or in the painter:

> **The 9 cheap ones:** hollow candles, volume candles, line with markers, step line, HLC area, columns, high-low, HLC bars, and (arguably) the candle-body/price-scale variants.

None of these need a transform at all — they need a paint branch and, at most, a couple of settings (hollow up/down colours, marker size, column baseline). They are **painting variants**, and the honest reason they are missing is simply that nobody wrote the paint branches; the reachability seam already accepts them.

### Seam 2 — `SeriesDataEngine` (expensive, N bars in → M bars out)

Renko, Kagi, Point & Figure, Line break and Range bars **destroy the time axis**. A Renko brick is not a time interval; two bricks can share a timestamp and one brick can span a week. That is why a `BarTransform` cannot express them — the file says so explicitly — and why the registry instead exposes:

```ts
interface SeriesDataEngine {           // src/chart-types/registry.ts:16-65
  start(...); suspend(); resume(); stop();
  onViewport(...); onBars(...); onSettings(...);
  // + host: bars(), pushData(), pushPending()
}
```

…paired with `basePainting: 'none'`, so the type owns its own rendering. **The registry supports this today. Zero such types are built.** That is the single largest structural gap in the product, and it is already *modelled* — the work is in the engines, not the plumbing.

## A3. Full mapping — TradingView's 20+ series types

| # | TradingView type | Vela | Seam required | Notes |
|---|---|---|---|---|
| 1 | Candles | **HAVE** | — | |
| 2 | Bars (OHLC) | **HAVE** | — | |
| 3 | Line | **HAVE** | — | |
| 4 | Area | **HAVE** | — | |
| 5 | Baseline | **HAVE** | — | |
| 6 | Heikin Ashi | **HAVE** | BarTransform | the reference implementation of seam 1 |
| 7 | **Hollow candles** | **MISSING** | paint branch | body stroke vs fill; up/down hollow toggle |
| 8 | **Volume candles** | **MISSING** | paint branch | candle body is a volume histogram around a centre line |
| 9 | **Line with markers** | **MISSING** | paint branch | line + dots at each pivot/close |
| 10 | **Step line** | **MISSING** | paint branch | horizontal-then-vertical path |
| 11 | **HLC area** | **MISSING** | paint branch | fill between high and low, close as the edge |
| 12 | **Columns** | **MISSING** | paint branch | single vertical bar from a baseline |
| 13 | **High-low** | **MISSING** | paint branch | two-value line (no open/close) |
| 14 | **HLC bars** | **MISSING** | paint branch | bar without the open tick |
| 15 | **Renko** | **MISSING** | **data engine** | brick size setting, reversal=1 by default |
| 16 | **Kagi** | **MISSING** | **data engine** | yang/yin line, reversal amount |
| 17 | **Point & Figure** | **MISSING** | **data engine** | box size, reversal count, X/O grid |
| 18 | **Line break** | **MISSING** | **data engine** | N-line break |
| 19 | **Range bars** | **MISSING** | **data engine** | fixed price range per bar |
| 20 | **Volume footprint** | **MISSING** | indicator-rendered type | needs per-bar bid/ask volume-at-price |
| 21 | **Session volume profile (SVP)** | **MISSING** | indicator-rendered type | session-bucketed profile |
| 22 | **TPO (time price opportunity)** | **MISSING** | indicator-rendered type | letter-per-time-at-price |

**Score: 6 HAVE, 16 MISSING — but 9 of the 16 are painting variants.**

## A4. The third category: indicator-backed chart types

Footprint, SVP and TPO are not really "chart types" at all in the painter sense; TradingView lists them as chart styles but they are indicator engines that happen to own the whole pane. Vela has the *closest* thing already: `VpvrIndicator` ("Visible Range Volume Profile", rows / POC / value-area settings) plus two drawing-level volume tools (`anchoredvwap`, `fixedrangevp`).

What is missing is not the histogram code — it is **volume-at-price data**. `VpvrIndicator` buckets whatever `bar.volume` exists; footprint needs volume *per price level per bar*, which no capability in the tree provides today (`EngineOrchestrator` even notes a "footprint feed" in passing at :311 as a surface it cannot resolve). That is a data-provider question first and a renderer question second.

## A5. The API gap this exposes

`PriceStyle` ends in `(string & {})`, which means a host can *type* any style id — but the style menu, the reset config (`factoryResetConfig`, `chartConfig.ts:581`) and the settings bags only know about the six built-ins plus `registerChartType`. Consequences worth naming, because they are cheap to fix and they unblock everything in A3:

1. A plugin that wants "hollow candles" today must write a whole `ChartTypeDefinition` — settings schema, ticker modifier, basePainting — for what is four lines of paint code. A `registerPaintVariant(id, { baseOf: 'candles', paint })` helper would make items 7–14 in the table above an afternoon's work *collectively*.
2. `src/core/price-styles/` is a folder with a seam in it and no inventory — a natural home for the variants, and the reason a reader assumes the features exist.
3. `heikinashi` is simultaneously a built-in style **and** a registered chart type, so the menu already demonstrates the dual-registration path; the nine variants are exactly the same shape of object.

---

# Part B — Layouts and workspace

## B1. Grid shapes: Vela is ahead

`src/workspace/layouts.ts` registers **44** presets, not the ~20 I had recorded:

```
1 · 2h · 2v · 4 · 8 · 16                              (uniform)
1-2 · 2-1 · 1-3 · 3-1 · 2-3 · 3-2 · 2-2 · 2-2-l · 2-2-r
1-4 · 4-1 · 2-3-l · 2-3-r · 2-4 · 4-2 · 4-3
3h · 3v · 3s · 3r · 4h · 4v · 5h · 5v · 5s · 5s-l
6 · 6h · 6v · 6c · 7h · 7s · 8h · 8v · 8c · 4s · 4s-r · 4s-l
```

…on top of which `layoutForGrid(rows, cols)` synthesizes **any** rows×cols grid up to 4×4 (16 cells, `GRID_PICKER_MAX` / `POOL_CAP`). TradingView's own selector is a fixed set of around twenty shapes gated by subscription tier. **This is not a gap; it is a lead.** Any future work should resist "add more presets" and spend the effort on the verbs below.

## B2. Layout management verbs — the real gap

| TradingView verb | Vela | Where | Verdict |
|---|---|---|---|
| Save layout (Ctrl/Cmd+S) | yes | `layout-picker.ts:1603` ("Save layout as…") | **HAVE** |
| Autosave toggle | yes | `layout-picker.ts:1575-1594` | **HAVE** |
| Rename | yes | inline edit, `layout-picker.ts:1265` | **HAVE** |
| Make a copy | yes | `onDuplicateLayout`, `layout-picker.ts:1734` | **HAVE** |
| Open layout (searchable) | yes | `layout-picker.ts:1648` | **HAVE** |
| Export layout as JSON | yes | `onExportLayout`, `layout-picker.ts:1738` | **HAVE** (TV has no equivalent) |
| Import layout | yes | `pickImportFile`, `layout-picker.ts:1293` | **HAVE** |
| Delete | yes | kebab verbs | **HAVE** |
| **Copy link** | yes — but **whole workspace** | `src/state/share.ts` (`#s1=` gzip / `#s0=` raw), `VelaWorkspace.shareLink()`, buttons at `layout-picker.ts:1278` and `more-drawer.ts:1345` | **PARTIAL** |
| **Export chart data as CSV** | **nothing** | `grep -ri csv src` → 0 hits | **MISSING** |

### B2.1 — CSV chart-data export (the one clean omission)

This is the only *action* in TradingView's layout menu with no counterpart. It is also the cheapest high-value item in this entire report:

- The bars are already in `BarStore`; the visible range is already computable from the viewport.
- Scope decision needed: **visible range** (TV's default) vs **all loaded history**. Recommend visible-range first, with "all loaded" as a second menu entry.
- Cost is a CSV writer (header `time,open,high,low,close,volume`, ISO time, locale-safe decimals), a Blob download, and one row in the layout kebab. No architectural change.
- One caveat worth stating up front: for the five non-time chart types in A3 this export would have to export the *source* bars, not the re-bucketed ones — another reason CSV isn't as neutral as it looks once Renko exists.

### B2.2 — Share link: right mechanism, wrong scope

`src/state/share.ts` is genuinely good work: one document, `encodeState`, gzip + base64url, ~1.3 KB for a 4-chart workspace, and a paranoid decoder that returns null rather than half-applying. But the *scope* is the whole workspace document. TradingView's "Copy link" shares **one layout, read-only**.

That produces two distinct product gaps:

1. **No per-layout link.** A user who wants to send "just my 4-chart BTC setup" sends all their layouts.
2. **No read-only mode.** A `#s1=` link opens fully editable, and anything the visitor changes is not attributed back — but there is no visual "you are viewing a shared copy" state either.

A per-layout link is mostly a serialization slice: encode one `SavedLayout` (already a discrete object with `layoutMeta`) instead of the whole `WorkspaceState`. The read-only affordance is the larger design question, because it touches every mutating surface (drawings, indicators, save, autosave).

### B2.3 — Indicator broadcasting

`VelaWorkspace.ts:2306-2319` implements TV's *new chart* rule: newborn cells inherit the first chart's live indicator ledger (`inheritLedger`). What TV also offers is the **existing-chart** verb — right-click an indicator → "Apply to entire layout". Vela has the precedent (`inheritLedger` copies the same ledger) but no menu entry that runs it over live cells. Small, contained, high perceived value in 4+ chart layouts.

## B3. Sync matrix

`SyncOptions` (`src/state/document.ts:50-59`) and `STYLE_SYNC_CONFIG_KEYS` (`src/workspace/sync.ts:85`):

| Property | TradingView | Vela | Verdict |
|---|---|---|---|
| Symbol | ✓ | `symbol` | **HAVE** |
| Interval | ✓ | `timeframe` | **HAVE** |
| Crosshair | ✓ | `crosshair` | **HAVE** |
| Time (click-to-align a moment) | ✓ | `time` | **HAVE** |
| Date range (zoom window) | ✓ | `viewport` | **HAVE** (different name, same behaviour) |
| Drawings | 3-state: off / in layout / **global** | binary `drawings`, layout-scoped | **PARTIAL** |
| Style/indicators | ✓ (via "apply to layout") | `style` + `STYLE_SYNC_CONFIG_KEYS` (layout, panes, grid, margins, priceScale, crosshair, animations, per-style blocks, sessions) | **HAVE** |
| Chart type sync | deliberately not synced | deliberately per-cell | **by design**, matches TV |
| **Per-chart link groups** | ✓ (emoji/colour marker per chart) | named groups: `SyncSetting` = `boolean \| Record<cellId, groupName>` | **HAVE** — Vela's *named* groups are richer than TV's colour markers |

The one structural difference is **scope** on drawings. Vela's drawings sync is a layout-wide boolean; TV's is a three-state choice where "global" means *the same symbol shows the same drawings in every layout, including layouts created later*. That is not a toggle you can bolt on: it changes where drawings are *stored* (per-cell vs per-symbol-global), which is the same class of decision as `SyncOptions` itself. It is the most expensive item in Part B and it is invisible until a user has two layouts.

---

# Part C — Drawing tools

## C1. Coverage

`src/core/drawings/registry.ts` registers **79** types; `toolbar.ts` composes them into **seven** top-level buttons carrying **17** labelled flyout sections (Lines, Channels, Pitchforks / Fibonacci, Price Action, Gann, Geometry / Patterns, Elliott, Harmonics / Measurements, Volume / Brushes, Arrows, Shapes / Text / Icons). Per-group counts from the registry:

| Group | Count | Group | Count |
|---|---|---|---|
| fibonacci | 15 | measure (+ harmonics) | 11 |
| shapes | 14 | channels | 4 |
| lines | 9 | pitchforks | 4 |
| annotations | 7 | price action | 3 |
| geometry | 5 | stamps | 2 |
| patterns | 5 | | |

Set against TV's catalogue, that is roughly **80–85 %** coverage by item count — but coverage is not even: **Fibonacci is at parity or better** (15 items including speed-resistance arcs, wedge, spiral, trend-based time, circles), while **annotations and patterns are the thin categories**.

## C2. What is missing, and why each one is missing

Grouped by *the thing that actually has to be built*, because that is what determines order of work.

### Group 1 — trivial gaps (same primitive, different settings)
| TradingView tool | Why it's absent | Work |
|---|---|---|
| **Price range** measurer | Vela only ships the combined `datepricerange`; the one-axis variants were never split out | suppress one axis in the existing ruler |
| **Date range** measurer | same | same |
| **Double curve** | `curve` exists with a single curvature control | second anchor pair |
| **Gann square fixed** | `gannsquare` exists; TV's "fixed" variant locks the square proportion | one clamped setting |
| **Pin** | annotation set stops at signpost/price label | callout variant with a pin glyph |
| **Arrow marker / arrow marks** | `arrow` / `arrowmarkup` / `arrowdown` exist but not the marker glyph or the multi-arrow object | one glyph + a repeated-instance object |

### Group 2 — content libraries (real work, zero architecture)
| TradingView tool | Why it's absent |
|---|---|
| **Fib pitchfan** | the 15 Fibonacci entries cover fib *fan* (one anchor) but not the pitchfork-style three-anchor fan |
| **Triangle pattern** | `patterns` has XABCD/ABCD/H&S; TV's triangle pattern (contracting/expanding) is its own zone table |
| **Three drives** | same category, its own ratio table |
| **Cypher** | *already present* — one of the six harmonics |
| **Elliott variants** (triangle, double/triple combo, diagonal…) | Vela ships impulse + correction only; TV has ~7 Elliott labels. Each is a labelled polyline plus a ratio table, so this is **breadth by repetition**, not new mechanics |
| **Regression trend** | `regressionchannel` covers the channel form, not the bare trend line |
| **Sector** | a filled wedge between two rays; no dependency |

### Group 3 — new primitives (moderate architecture)
| TradingView tool | Why it's genuinely absent |
|---|---|
| **Cyclic lines / Time cycles / Sine line** | Vela's projection engine repeats *price* levels (fib/Gann). These repeat **time**: a period, a decay, a phase. Needs a time-domain repetition model, not another zone table |
| **Position forecast** | `position` (long/short) draws risk/reward boxes from anchors; forecast adds a projected path with a target date — a path primitive, not a box |
| **Anchored volume profile** | Vela has `anchoredvwap` and `fixedrangevp`, but the VP engine (`VpvrIndicator`) is **viewport-scoped**. An anchored VP needs the same bucketing driven by drawing anchors — an engine/drawing coupling that doesn't exist yet |
| **Bars pattern / Ghost feed** | These **reference bar data** and transform it. Every Vela drawing is a vector object on the time/price plane with no notion of "this range of source bars". That reference model is the missing piece, and it is the same model Renko/Kagi need — shared prerequisite |

### Group 4 — pipeline-level (not drawing work at all)
| TradingView tool | Why it's absent |
|---|---|
| **Image** | the workspace document is a JSON blob in localStorage *and* in a 1.3 KB share URL. An embedded image needs an asset store or a hard data-URI budget; a naive implementation would blow the share link |
| **Table** | needs real text layout (columns, alignment, in-place editing) — the annotation renderer is single-run text |
| **X posts / ideas** | a network integration; out of scope by nature |

## C3. Chart-management verbs (the row on the left toolbar)

| Verb | TradingView | Vela | Verdict |
|---|---|---|---|
| Measure | ✓ | `measure` mode | **HAVE** |
| Zoom in | ✓ | `zoom` mode + `zoomToRegion` (round 20) | **HAVE** |
| Magnet: off / weak / strong | ✓ | `magnet: 'off' \| 'weak' \| 'strong'` (`state/document.ts:90`) | **HAVE** |
| **Magnet: snap to indicators** | ✓ (third mode) | — | **MISSING** |
| Stay in drawing mode | ✓ | pill "Stay" toggle | **HAVE** |
| Lock all | ✓ | `onLockAll` (round 20) | **HAVE** |
| Hide all | ✓ | `allHidden` / `getAllHidden` / `setAllHidden` | **HAVE** |
| Remove all | ✓ | `onRemoveAll` (round 20) | **HAVE** |
| Sync drawings (3-state) | ✓ | see B3 | **PARTIAL** |
| Hide/remove *indicators*, hide *positions* | ✓ | — | **MISSING** (separate surfaces, not drawing code) |
| Object tree / drawings list | ✓ | Drawings pane in the More drawer (round 19) | **HAVE** |
| Templates | ✓ | save / apply-to-selection / export / persist (round 20) | **HAVE** (ahead — TV does not export templates) |
| Cursors | 6 | 7 (cross, dot, arrow, demo, magic, eraser + None) | **HAVE**, ahead |

**Snap-to-indicators** is the one magnet mode missing, and the reason is honest: the magnet snaps to `ohlcv` values (open/high/low/close), while indicator values live in the engine's output buffers. Wiring it means exposing "snap candidates" from `EngineOrchestrator` to the drawing controller — a read-only query, but a new cross-module dependency.

## C4. Where Vela is ahead

Worth recording so future rounds don't "fix" these:

- **Drawing templates** — save per-tool settings, apply to a selection, export, persist across reload. TV offers per-tool templates with a menu at the top of the settings dialog, no export.
- **Seven cursors** (TV documents six).
- **Geometry group** (Dedekind tessellation, Sonic / Supersonic / Golden Sonic / Golden Supersonic) and **price-action objects** (Fair Value Gap, Order Block, Liquidity) — no direct counterparts in TV's drawing catalogue.
- **Magnifier** drawing.
- **44 layout presets + free-form 4×4 grid composer** vs TV's fixed ~20 gated by tier.
- **Layout export/import as JSON.**

---

# Part D — Ranked, if you ever say "implement"

Estimates are engineering judgement, not measured. Ordered by payoff per unit of risk.

### Tier 1 — hours each, low risk, user-visible
1. **CSV chart-data export** (layout kebab, visible range first) — the only missing layout *action*.
2. **Price range / Date range measurers** — split the existing combined ruler.
3. **Paint variants: hollow candles, step line, HLC area, line with markers, columns** — five styles, one seam, ideally behind a small `registerPaintVariant` helper (Part A5).
4. **Snap-to-indicators magnet** — third magnet mode; needs an engine read query.
5. **Apply indicator to entire layout** — reuse `inheritLedger` across live cells.
6. **Double curve, Gann square fixed, Pin, Fib pitchfan** — one-off geometry.

### Tier 2 — days to a week
7. **High-low, HLC bars, volume candles** — finish the painting family.
8. **Per-layout share link** (serialize one `SavedLayout`) — decide whether read-only lands with it or after.
9. **Pattern/Elliott breadth** — triangle pattern, three drives, Elliott triangle/double/triple combo. Repetitive content, no new mechanics.
10. **Global drawings sync (3-state)** — the storage-scope decision in B3.

### Tier 3 — architectural, plan as a round of their own
11. **Renko, Kagi, Point & Figure, Line break, Range bars** — the `SeriesDataEngine` path. Everything needed is modelled; nothing is implemented. Start with **Renko** (simplest brick rule, clearest visual payoff, best test oracle) and let it prove the engine path before the other four.
12. **Bar-data reference model** — unlocks Bars pattern, Ghost feed *and* is the shared prerequisite for the re-bucketing types.
13. **Volume-at-price feed** — footprint, SVP, TPO, anchored VP. Data-provider work before rendering work.
14. **Image / Table objects** — needs an asset store and a text layout engine; also a document-size budget.

---

# Part E — Honest caveats

1. **"MISSING" means absent from the source tree**, not "impossible today" — every item above has a modelled or adjacent seam.
2. **Effort estimates are judgements**, derived from which seam each item touches, not from prototypes.
3. **TradingView counts are from their published support pages and the `SeriesType` / `ChartStyle` enums**; their exact live catalogue shifts, so treat the 20+ and the drawing list as a snapshot rather than a spec.
4. **Coverage percentages are item counts**, not capability: a Hollow Candles variant and a Renko engine both count as "1".
5. **Nothing here is implemented.** The tree is unchanged at `239ab5d` — `tsc` 0, `eslint` 0, `vitest` 198 files / 2361 tests.
