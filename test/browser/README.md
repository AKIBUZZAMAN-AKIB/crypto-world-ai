# Browser checks (opt-in)

The vitest suite is jsdom: it can prove `drawer.open()` built the right DOM, but not that
the table FITS, that nothing scrolls the page sideways, that a Zag menu row answers a real
pointer, or that a click on one chart re-centers three others. These scripts drive a real
Chromium through Playwright and assert the measured numbers.

```bash
npm run playground &            # port 5190 (playground/)
npx playwright install chromium # once
npm run test:browser            # runs every *.mjs here, exits non-zero on failure
```

`playwright` is a development dependency; install its Chromium browser separately as
above. Each script prints one JSON line and sets a non-zero exit code on a failed
assertion, so CI can gate on it. These checks use real interactions and measurements;
they do not save screenshots.

### In CI (nobody is holding a server)

```bash
npm i --no-save playwright@1.64.1
npx playwright install --with-deps chromium
npm run test:browser:ci        # boots vite on 127.0.0.1:5190, runs the suite, kills it
```

`test:browser:ci` exists for exactly that: `.github/workflows/ci.yml`'s `browser` job has
no dev server of its own, and a Playwright `webServer` block would drag in
`@playwright/test` for a suite that uses plain `playwright`. The runner waits for the page
to answer (up to 120 s), runs `run.mjs`, forwards its exit code, and always stops vite.
`playwright` is installed with `--no-save` — it is a test tool, never a runtime
dependency, and adding it to `package.json` without regenerating the lockfile would make
`npm ci` refuse to run.

Environment knobs:

- `PLAYWRIGHT_BROWSERS_PATH` — where the browser builds are unpacked
- `SYNC_BASE` — the live page under test (default `http://127.0.0.1:5190/workspace.html`)
- `SYNC_BASE_OFFLINE` — the deterministic page (default `…/offline.html`)
- `SYNC_BROWSER=webkit` — run the Settings, color, floating-panel, direct-resize and keyboard
  scripts that support it with Playwright WebKit instead of Chromium (requires WebKit and
  system dependencies)

| script | proves |
| --- | --- |
| `sync-phone-polish.mjs` | no-search More and parent-preserving children, no relabeling Object tree, square chart types, icon-led one-line drawing overflow without horizontal pan, bottom-tab Drawings picker styled as a bounded Data Window-like pane with resize/maximize/close, viewport-fit drawing Settings and teardown (Chromium touch stream; WebKit synthetic pointer path) |
| `sync-drawing-overflow-controls.mjs` | real overflowed swatches with retained icons, numeric and text controls, Settings action through the narrow overflow menu, keyboard/Escape, duplicate/copy/paste/reset, content-sized menu without horizontal overflow and teardown on tiny cells (Chromium or WebKit) |
| `sync-drawing-selection-settings.mjs` | real chart-pointer drawing selection followed by a touch activation of Settings, in single-chart and compact multi-chart layouts; confirms the pane title and content become visible (Chromium) |
| `sync-drawing-settings-desktop.mjs` | floating desktop Settings card, direct two-axis resize control, whole-card viewport clamping, two-axis content overflow and Close after resizing (Chromium or WebKit) |
| `sync-legacy-floating.mjs` | legacy More and alert modal children, Escape, independent alert/form scrolling at 240 × 320, standalone drawing-panel drag, visual-viewport position restoration and listener teardown (Chromium or WebKit) |
| `sync-touch-regrab.mjs` | trusted Chromium phone touch; actual canvas pixels and readouts with Cross/Dot/Arrow/None in dark/light, saved/custom appearance, relative re-grab and tap exit |
| `sync-price-scale-menu.mjs` | compact price-axis menu, accessible state, nested touch Labels/Levels, independent study-pane scales, short embedded host and internal scrolling (Chromium; WebKit pointer path) |
| `sync-more-standard.mjs` | non-modal standard More pane without search, keyboard/touch actions and child menus, grip/fullscreen, subviews, panel exclusivity, rotation, phone-first reload and narrow/embedded geometry (Chromium or WebKit) |
| `sync-standalone-touch.mjs` | network-blocked delivered HTML: More pane, visible None-cursor tracking, relative re-grab and compact nested scale menu (Chromium CDP; WebKit synthetic chart pointers + real menu taps) |
| `sync-accent-contrast.mjs` | measured phone/desktop badges, selected states and switches in dark/light and premium/plain modes; Create/Save hover and disabled contrast, favorite stars, color swatches and preserved chart/drawing colors |
| `sync-chart-settings-pane.mjs` | real desktop drag, shared button/drawing tooltips, legacy and externally updated color/alpha, visibility policy, phone touch/keyboard resize, non-modal chart interaction, visual-viewport simulation, rotation and narrow/embedded geometry |
| `sync-chart-settings-compact.mjs` | desktop movement without a height popup; phone minimum-height geometry, header actions, actual Apply to all and template saving, keyboard/focus, reset fallback, rotation, narrow and embedded hosts and a reduced visual viewport |
| `sync-color-panel.mjs` | compact square picker, automatic recents, custom color and opacity, keyboard/focus and wheel/touch; resize, rotation, visual-viewport fitting and escaping embedded chart boundaries, mixed-drawing colors (Chromium or WebKit) |
| `sync-alert-geometry.mjs` | initial visible bell, square standard dock and full-width phone pane at six sizes and an embedded host; keyboard tabs, touch resize, state and rotation |
| `sync-alert-behavior.mjs` | real price and drawing-backed create, once/repeat/moving triggers, persistence, log provenance/clearing, chart/market race safety, replay seek/mid-tick safety, pooled/removed charts and shared-line preservation (Chromium or WebKit) |
| `sync-alert-interaction.mjs` | phone More/direct routing and creation, retained cap, live touch momentum/scroll anchor/held action, and explicit topbar composition |
| `sync-alert-management.mjs` | theme/disabled button contrast, real Edit/Pause/Resume/Re-arm/filter/delete, document restore, shared and missing drawings, pooled charts, replay/mid-tick seeks, pending-market safety and target sizes (Chromium or WebKit); trusted touch-momentum check uses Chromium CDP |
| `sync-alert-preview.mjs` | opt-in Alerts preview on synthetic data, desktop and phone; ordinary offline fixture does not auto-open it |
| `sync-doors.mjs` | the status-line badge and the series menu both open the table **on that chart**, and charts wear their numbers meanwhile |
| `sync-table-fit.mjs` | 4/8/16 charts: the table scrolls INSIDE itself, the page never scrolls sideways, phone sheet fits at 390/320 |
| `sync-pool.mjs` | a layout shrink pools per-chart state; growing back restores it; "remove hidden charts" arms → commits → undoes |
| `sync-canvas.mjs` | 8 cells mount WebGL2, 16 flip every cell to canvas2d, and the flip loses no chart |
| `sync-links.mjs` | crosshair (leader's bar on every follower), click-to-align time, style prefs, tab link across two real pages |
| `sync-touch-crosshair.mjs` | real CDP touch hold/wobble/drag/lift/tap, canvas pixels, empty and updated data, indicator panes, magnet, rotation, axes, pinch, cancellation and linked follower live/loading/different-timeframe readouts |
| `sync-data-window.mjs` | square desktop docks and bottom-attached phone panes at 240–1440 px and embedded size; Data/Table tabs, live values, selection, native indicator columns, timezone, replay, superseded loads, synced chart rebinding, virtual/sticky table, real touch scrolling, resize and rotation |
| `sync-data-window-navigation.mjs` | content-sized seconds/milliseconds, opaque sticky hover in dark/light themes, chart navigation by row/keyboard/touch, repeated clicks, live append/press race, replay plus Renko, 20,000 rows, active-chart isolation, drawings/highlights and reduced motion |
| `sync-strategy-tester.mjs` | square desktop/phone panes, tabs and sticky tables at six sizes and embedded hosts; touch, resize/rotation, live updates, selection, market races and a real Pine strategy |
| `sync-strategy-preview.mjs` | optional demo preview automatically runs a real Pine strategy over labeled synthetic bars on desktop and phone |
| `sync-strategy-tester-scale.mjs` | 20,000-trade virtual list, deep disclosures, large values, scroll geometry, live focus, keyboard End/Up, touch momentum during updates and 5,000-trade phone rotation |
| `sync-responsive.mjs` | 560–720 px (phone or desktop Layout Setup pane), internal matrix overflow and coarse-pointer target sizes |
| `sync-saved-layouts.mjs` | retained rich-menu API: save → rename → download `.json` → import with collision → open |
| `sync-floating-layout-manager.mjs` | real phone/desktop doors, menu bounds and keyboard, save/copy/rename/share/import/export/delete, search, dismissal, keyboard viewport and rotation |
| `sync-floating-chart-actions.mjs` | phone More door, viewport/embedded/landscape bounds, touch scrolling, keyboard, active-chart actions, contributions, dismissal and desktop right-click |
| `sync-single-file.mjs` | rebuilds and boots the `file://` standalone with network blocked; checks the unified phone/desktop Layout setup, multi-card dock/float and drag, desktop Settings drag, phone Settings resize/color/opacity, indicator tooltips, badges and Pine Editor hover, Alerts/localStorage reload, Data Window/table, Strategy Tester, Object Tree/template/live-sync actions, floating menus, chart reset and rotation |
| `sync-pine-editor.mjs` | real desktop and emulated-phone Monaco editing, Pine completion/signatures/user types/methods, script-specific undo, engine error navigation and stale-result races, run/update, versions, read-only copies, clipboard denial, context/long-press actions, touch scroll, pane resize and rotation |
| `sync-pine-standalone.mjs` | rebuilds and opens the `file://` editor with all network denied, checking embedded styles/font, Blob worker, Pine completion and reload persistence |
| `sync-pine-package.mjs` | after `npm run build`, loads actual production ESM/CJS workspace outputs and all declared package paths, then checks the docked Layout setup and live sync controls plus Monaco style/font injection, Blob worker and Pine completion |
| `sync-pine-subpane.mjs` | an `overlay=false` Pine study lands in its OWN pane: the 70/30 `fill(hline, hline)` wash, the RSI line and a divergence label pill are all measured as pixels |
| `sync-object-tree-visual-order.mjs` | Visual Order changes both tree rows and real canvas pixels; candles, indicators, drawings and groups share one z stack |
| `sync-object-tree-touch-order.mjs` | phone users can open the compact Visual order submenu and restack a drawing by touch |
| `sync-indicator-groups.mjs` | type-specific drawing/indicator/mixed menus; cross-pane grouping, selected/new templates and bidirectional selected-chart sync |
| `sync-indicator-group-order.mjs` | real cross-pane and nested drags, physical z-order/pane preservation, Visual order, undo and redo |
| `sync-indicator-lifecycle.mjs` | source-language templates, missing-engine partial application, single-chart opt-in/expansion and pooled-link catch-up |
| `sync-indicator-inheritance.mjs` | singleton reuse, unrelated same-type protection, house-template seeding and delayed-manifest link resolution |
| `sync-indicator-template-safety.mjs` | saved/built-in templates skip charts where removed study panes would strand drawings, without blocking safe peers |
| `sync-indicator-mobile.mjs` | square compact child forms at 240–390 px, touch save, preserved Object tree and desktop keyboard/focus restoration |
| `sync-indicator-settings-ui.mjs` | live settings-dialog input and rendered color propagation, Cancel rollback and reverse editing from the follower |
| `sync-unified-history.mjs` | visual order, chart settings, indicator inputs, layout preferences and object-tree groups all undo/redo in one timeline |
| `sync-desktop-layout-split.mjs` | standard docked Layout/Chart syncing tabs; the compact Manage layouts popover leaves its parent pane open |
| `sync-layout-setup-pane.mjs` | real desktop/phone tabs, all seven live links, bidirectional groups and palette, keyboard/RTL, help, grid/presets, pool Undo, manager, dock/float/resize, focus, narrow scrolling, rotation and reload persistence (Chromium or WebKit) |
| `sync-layout-setup-standalone.mjs` | delivered `file://` page with networking blocked: unified phone/desktop pane, live matrix, fullscreen and Float/Dock (Chromium or WebKit) |
| `sync-floating-side-panels.mjs` | desktop dock/float button, several live cards plus one dock, stacking, drag/resize, keyboard and click-only position controls, undo/redo, Settings/color and Monaco preservation, persistent phone-first boot, rotation, visual viewport and offset embedded host (Chromium or WebKit) |
| `sync-floating-corner-resize.mjs` | direct two-axis button drag, 160 × 112 px built-ins and constrained plugins, tiny Watchlist/Pine/Alerts/Data/Table/Strategy content, keyboard/click/touch, cancellation, undo/redo, reload, rotation, short landscape and embedded visual viewport (Chromium or WebKit; real touch drag in Chromium) |
| `sync-panel-page-overflow.mjs` | off-screen panels (including embedded Layout setup), Settings, dialogs and draggable layout popovers do not grow or scroll the page; header, focus, content scrolling, popover anchoring, multiple floats, transformed/normal embedded hosts and legitimate host-page scrolling (Chromium or WebKit) |
| `sync-panel-direct-resize.mjs` | desktop off-screen movement; Settings, drawers and panel direct resizing, stationary phone headings, bottom attachment, fullscreen/exact restore, real Chromium touch cancellation, viewport recovery, mobile history/reload, narrow and embedded hosts (Chromium or WebKit) |
| `sync-panel-nondrag.mjs` | named separator semantics, keyboard size changes and phone height persistence; position-only controls remain available and no size popup opens (Chromium or WebKit) |
| `sync-panel-movement.mjs` | a contributed movable panel retains desktop dock width, maximize and title-drag to float; stationary phone title, keyboard resize, no size popup or movement buttons |
| `sync-panel-resize.mjs` | continuous mouse/touch resize on side panels, drawers, dialogs and panel-like popovers; anchored edges, scroll, non-drag controls, history and rotation |
| `sync-phone-pane-anchor.mjs` | phone panel (including embedded Layout setup) and drawer headings and header buttons cannot detach panes; grip-only resize, fullscreen, legacy offsets and opening in a shortened visual viewport (Chromium or WebKit) |
| `sync-phone-rotation.mjs` | portrait → landscape → portrait keeps the chart; touch landscape uses the desktop topbar with only the pair pinned |
| `sync-panel-ergonomics.mjs` | square selected grid cells; draggable floating layout pane and stationary compact child popover; horizontal touch scrolling, no page overflow and neutral header icons in light/dark themes |
| `sync-discovery-panels.mjs` | four independent workspace panes, dock/float/resize and tiny content, child settings, favorites/template actions, Compare search/modes/removal, watchlist keyboard, phone grip/fullscreen, rotation and persisted geometry (Chromium or WebKit) |
| `sync-discovery-accessibility.mjs` | `/`, `Alt+W`, focus return, template keyboard tabs, Compare cancellation races, and all four panes in an offset embedded phone host (Chromium or WebKit) |
| `sync-discovery-narrow.mjs` | real touch interaction at 240px, separate template door, 40px row actions, input sizing and panel/page overflow (Chromium or WebKit) |
| `sync-template-panel-flat.mjs` | flat template-pane surfaces, dark/light contrast, sticky toolbar and long-list scrolling, import/draft safety, keyboard focus/cancellation, and narrow/embedded phone layout (Chromium or WebKit) |
| `sync-discovery-restore.mjs` | restored search with delayed provider index; Compare symbol/modes, placement, axis ownership, removal and pooled-chart restoration; Indicators slot-override `/` shortcut (Chromium or WebKit) |
| `sync-discovery-standalone.mjs` | rebuilds the delivered `file://` page and tests all four desktop/phone panes, the flat template interior and short-phone save form, and Compare with network blocked (Chromium or WebKit) |
| `sync-compare-slow-provider.mjs` | real delayed provider: Compare clears stale prices, reuses an in-flight request across mode changes, paints the replacement and ignores a reply after destruction (Chromium or WebKit) |
| `sync-indicator-templates-separation.mjs` | separate Indicator templates panel has Favorites / My templates / Technical / Financial; Manage layouts and Layout setup stay template-free |
| `sync-premium-panels.mjs` | theme tokens resolve on floating hosts; minimal headers, unified Layout/Chart syncing tabs and separate Manage layouts and Indicator templates surfaces |

`playground/offline.html` feeds every cell the SAME synthetic bars over a provider that
resolves any ticker, so instants, click times and visible ranges mean the same thing on
every machine and every run. It has no persistence by default; `?persist=1` opts into a
separate local-storage key for reload and initial-layout checks.
