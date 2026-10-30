#!/usr/bin/env node
// Build the exact production ESM, CJS, IIFE and declaration outputs sequentially.
// A combined tsup declaration worker can exceed the heap on multi-entry workspaces;
// splitting by entry preserves all outputs without dropping types or the Monaco bundle.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsup = resolve(dirname(require.resolve('tsup/package.json')), 'dist/cli-default.js');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const entries = Object.keys(pkg.exports).map((key) => key === '.' ? 'index' : key.replace(/^\.\//, ''));

function run(part, typeEntry) {
    const label = typeEntry ? `${part}: ${typeEntry}` : part;
    console.log(`\n── ${label} ──`);
    const args = [tsup, '--config', 'tools/tsup-build-part.config.ts'];
    if (part === 'types') args.push('--dts-only');
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, VELA_BUILD_PART: part, ...(typeEntry ? { VELA_TYPE_ENTRY: typeEntry } : {}) },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const part of ['esm', 'cjs', 'browser-dev', 'browser-min']) run(part);
for (const entry of entries) run('types', entry);
console.log('\nPackage build complete.');
