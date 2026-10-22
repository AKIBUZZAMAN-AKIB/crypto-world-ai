// CI entry point for the browser checks: boot the playground server, wait until it
// answers, run `run.mjs`, and always shut the server down.
//
// Locally `npm run test:browser` assumes a dev server is already up (`npm run
// playground`). In CI nobody is holding that server, and the alternative — a Playwright
// `webServer` block — would mean pulling `@playwright/test` for a suite that uses plain
// `playwright` scripts. This keeps the two apart: the suite stays framework-free, and CI
// just needs the server it always needed.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const PORT = Number(process.env.SYNC_PORT ?? 5190);
const BASE = `http://127.0.0.1:${PORT}`;

async function answers(url, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {
            /* not up yet */
        }
        await sleep(300);
    }
    return false;
}

const vite = join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
// Bind IPv4 explicitly: `localhost` can resolve to ::1 on a CI runner, and the checks
// poll 127.0.0.1 — a server listening only on ::1 answers nobody.
const server = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: repo,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CI: '1' },
});
let stopping = false;
const stop = () => {
    if (stopping) return;
    stopping = true;
    server.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const up = await answers(`${BASE}/workspace.html`, 120_000);
if (!up) {
    console.error(`playground server did not answer on ${BASE}`);
    stop();
    process.exitCode = 1;
} else {
    const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(here, 'run.mjs')], {
            stdio: 'inherit',
            env: { ...process.env, SYNC_BASE: `${BASE}/workspace.html`, SYNC_BASE_OFFLINE: `${BASE}/offline.html` },
        });
        child.on('exit', (c) => resolve(c ?? 1));
    });
    process.exitCode = code;
}
stop();
// Do not leave the child behind if it ignored SIGTERM.
setTimeout(() => {
    if (!server.killed) server.kill('SIGKILL');
    process.exit(process.exitCode ?? 1);
}, 2000).unref();
