import { defineConfig } from 'vite';
// Sandbox only (untracked): measure WHERE the boot payload's weight lives.
export default defineConfig({
    root: 'playground',
    logLevel: 'error',
    build: {
        outDir: '/tmp/chunks',
        emptyOutDir: true,
        target: 'es2020',
        rollupOptions: {
            input: { workspace: 'playground/workspace.html' },
            output: {
                manualChunks(id) {
                    if (id.includes('playground/vendor')) return 'vendor-pine';
                    if (id.includes('/node_modules/')) return 'node-modules';
                    const m = id.match(/\/src\/([a-z-]+)\//);
                    if (m) return `src-${m[1]}`;
                    if (id.includes('/playground/')) return 'playground';
                    return 'misc';
                },
            },
        },
    },
});
