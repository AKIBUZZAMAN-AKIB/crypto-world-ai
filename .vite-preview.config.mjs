import { defineConfig } from 'vite';
// Sandbox preview only (untracked): accept the platform's proxy host, and land the
// preview on the multi-chart WORKSPACE rather than the three-card index page.
export default defineConfig({
    root: 'playground',
    server: { port: 5190, strictPort: true, host: '0.0.0.0', allowedHosts: true },
    plugins: [
        {
            name: 'preview-land-on-workspace',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    // Keep the query string: `/?layout=mobile` must land on
                    // `/workspace.html?layout=mobile`.
                    const [path, query] = (req.url ?? '/').split('?');
                    if (path === '/' || path === '/index.html') {
                        res.writeHead(302, { Location: `/workspace.html${query ? `?${query}` : ''}` });
                        res.end();
                        return;
                    }
                    next();
                });
            },
        },
    ],
});
