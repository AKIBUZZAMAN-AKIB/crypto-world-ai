#!/usr/bin/env node
// Refresh the vendored Pine engine (playground/vendor/pine-libre) from a checkout of the
// engine repo. Run it after `npm run build` there:
//
//     node scripts/sync-pine-engine.mjs ../pine-alpha
//
// The engine is MIT and dependency-free, so the copy is self-contained — see the vendored
// README for why it exists.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? '../pine-alpha');
const from = join(source, 'dist');

for (const file of ['index.js', 'index.d.ts']) {
    if (!existsSync(join(from, file))) {
        console.error(`missing ${join(from, file)} — build the engine first (npm run build)`);
        process.exit(1);
    }
}
if (!existsSync(join(source, 'LICENSE'))) {
    console.error(`missing ${join(source, 'LICENSE')}`);
    process.exit(1);
}

const to = join(root, 'playground/vendor/pine-libre');
mkdirSync(to, { recursive: true });
for (const file of ['index.js', 'index.d.ts', 'LICENSE']) {
    // The build artifacts live under `dist/`; the LICENSE at the repo root.
    copyFileSync(file === 'LICENSE' ? join(source, file) : join(from, file), join(to, file));
}

const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
const readme = join(to, 'README.md');
if (existsSync(readme)) {
    const text = readFileSync(readme, 'utf8').replace(/version \*\*[^*]+\*\*/, `version **${version}**`);
    writeFileSync(readme, text);
}
console.log(`synced vela-pine-libre ${version} → playground/vendor/pine-libre`);
