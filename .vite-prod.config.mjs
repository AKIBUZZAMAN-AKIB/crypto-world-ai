import { defineConfig } from 'vite';
// Sandbox only (untracked): production build of the workspace playground, used to measure
// REAL boot cost — the dev server's per-module ESM requests are not what a user downloads.
export default defineConfig({
    root: 'playground',
    logLevel: 'warn',
    build: {
        outDir: '/tmp/prod',
        emptyOutDir: true,
        target: 'es2020',
        rollupOptions: { input: { workspace: 'playground/workspace.html' } },
    },
});
