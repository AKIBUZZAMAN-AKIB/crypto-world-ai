// The Pine engine, isolated in a module of its own so every page can import it
// LAZILY.
//
// `vela-pine-libre` is installed as a local file dependency (`file:../pine-alpha`), which
// only exists on a machine that has both repos side by side. A static import would make
// the whole playground — and `tsc` — fail wherever it does not, so the chart options take
// a factory that awaits the dynamic import and the page degrades to "Pine unavailable"
// instead of failing to load.
import type { ScriptingEngine } from '../src/core/ports/ScriptingEngine';

/** True once the engine module has resolved (pages use it to gate the editor's Run). */
let loaded = false;

export function pineEngineLoaded(): boolean {
    return loaded;
}

/**
 * Load `vela-pine-libre` and build an engine instance. Rejects when the package is not
 * installed — callers decide whether that is fatal (the editor says so; the workspace
 * simply has no `pine` language).
 */
// Non-literal specifier: a literal one is resolved at COMPILE time, so `tsc` would fail
// wherever the package is not installed (CI checks out this repo alone). Through a
// variable the type is `any`, and an absent package becomes a runtime rejection that the
// pages already handle.
const ENGINE_MODULE = 'vela-pine-libre';

export async function createPineEngine(): Promise<ScriptingEngine> {
    const mod = (await import(/* @vite-ignore */ ENGINE_MODULE)) as { PineEngine: new () => ScriptingEngine };
    loaded = true;
    return new mod.PineEngine();
}
