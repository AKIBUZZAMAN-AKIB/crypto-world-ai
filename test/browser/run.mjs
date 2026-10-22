// Runs every browser check in this folder, in order, and exits non-zero if any failed.
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here)).filter((f) => f.endsWith('.mjs') && f !== 'helpers.mjs' && f !== 'run.mjs' && f !== 'ci.mjs').sort();
let failed = 0;
for (const f of files) {
    const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(here, f)], { stdio: 'inherit' });
        child.on('exit', (c) => resolve(c ?? 1));
    });
    if (code !== 0) failed += 1;
}
if (failed > 0) {
    console.error(`${failed} browser check(s) failed`);
    process.exit(1);
}
console.log(`${files.length} browser check(s) passed`);
