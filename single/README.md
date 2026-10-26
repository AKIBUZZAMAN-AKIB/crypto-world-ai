# One-file build (phone test)

`node tools/build-single-file.mjs` writes **`single/vela-workspace.html`** — the whole
workspace playground (app + Binance provider + Pine engine) as ONE self-contained page.

- **No server needed.** It also opens from `file://` (the script is inlined as a classic
  `<script>`, not a module, and `file://` refuses modules).
- **One chart by default.** A 4-cell grid on a 390 pt screen is four unreadable thumbnails;
  `--layout 4` brings the grid back, `--symbol ETHUSDT` picks the market.
- **Phone window hints.** The page carries `viewport-fit=cover`, `theme-color`, the
  standalone web-app metas and `overscroll-behavior: none` (no rubber-band drag when a
  chart is panned past its edge).
- **Network is still the network.** Charts stream Binance over HTTPS/WSS and the ticker
  icons come from `crypto-icons.ledger.com`; on a restricted network the charts stay empty
  while the app itself boots fine (measured: 372 ms load, 436 ms to the first chart on a
  throttled 390×780 device).

```sh
node tools/build-single-file.mjs                       # 1 chart, BTCUSDT → single/vela-workspace.html
node tools/build-single-file.mjs out.html --layout 4   # the 4-cell grid
node tools/build-single-file.mjs out.html --symbol ETHUSDT
```

Output is ~2.16 MB raw / ~597 KB gzip, built in about half a second. The generated HTML is
git-ignored — rebuild it rather than committing it.
