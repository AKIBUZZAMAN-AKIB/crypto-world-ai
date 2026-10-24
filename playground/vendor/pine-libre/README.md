# vela-pine-libre (vendored build)

A verbatim copy of the built engine from
[`AKIBUZZAMAN-AKIB/pine-alpha`](https://github.com/AKIBUZZAMAN-AKIB/pine-alpha),
version **0.1.0** — MIT licensed (see `LICENSE`, © the vela-pine-libre authors).

**Why vendored.** It carries no runtime dependencies, so a self-contained copy makes the
playground work from a plain checkout of this repo alone: no sibling directory, no
`file:../pine-alpha` dependency, and CI (which checks out this repo by itself) typechecks
and runs the browser checks without installing anything extra.

**Refreshing it** (from the engine repo, after `npm run build`):

```bash
node scripts/sync-pine-engine.mjs ../pine-alpha
```

Registry installs are still the right way to consume the engine in a real application —
`npm i vela-pine-libre` — this copy exists only so the demo is self-sufficient.
