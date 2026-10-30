import { defineConfig } from 'vite';

// Reuse the deterministic offline workspace for the chart preview. Pass ?preview=editor
// to open the Pine editor; direct offline.html visits remain the engine-free test fixture.
export default defineConfig({
    root: 'playground',
    server: { port: 5191, strictPort: true, host: '0.0.0.0', allowedHosts: true },
    plugins: [{
        name: 'preview-offline-workspace',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const [path, query] = (req.url ?? '/').split('?');
                if (path === '/' || path === '/index.html') {
                    const params = new URLSearchParams(query ?? '');
                    const queryString = params.toString();
                    res.writeHead(302, { Location: `/offline.html${queryString ? `?${queryString}` : ''}` });
                    res.end();
                    return;
                }
                next();
            });
        },
    }],
});
