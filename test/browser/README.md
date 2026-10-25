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

`playwright` is not a dependency of this repo: the checks are opt-in for hosts that
already have it (`npm i -D playwright`). Each script prints one JSON line and sets a
non-zero exit code on a failed assertion, so CI can gate on it.

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

| script | proves |
| --- | --- |
| `sync-doors.mjs` | the status-line badge and the series menu both open the table **on that chart**, and charts wear their numbers meanwhile |
| `sync-table-fit.mjs` | 4/8/16 charts: the table scrolls INSIDE itself, the page never scrolls sideways, phone sheet fits at 390/320 |
| `sync-pool.mjs` | a layout shrink pools per-chart state; growing back restores it; "remove hidden charts" arms → commits → undoes |
| `sync-canvas.mjs` | 8 cells mount WebGL2, 16 flip every cell to canvas2d, and the flip loses no chart |
| `sync-links.mjs` | crosshair (leader's bar on every follower), click-to-align time, style prefs, tab link across two real pages |
| `sync-responsive.mjs` | 560–720 px (phone sheet below 640, desktop popover above), coarse-pointer target sizes |
| `sync-saved-layouts.mjs` | save → inline rename → download a `.json` → import (name collision) → open |
| `sync-pine-subpane.mjs` | an `overlay=false` Pine study lands in its OWN pane: the 70/30 `fill(hline, hline)` wash, the RSI line and a divergence label pill are all measured as pixels |

`playground/offline.html` feeds every cell the SAME synthetic bars over a provider that
resolves any ticker, so instants, click times and visible ranges mean the same thing on
every machine and every run.
