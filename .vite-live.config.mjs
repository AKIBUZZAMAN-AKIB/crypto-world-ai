import { defineConfig } from 'vite';
// Sandbox preview (untracked): the workspace playground on a stable port, reachable by the
// platform's proxy host (allowedHosts) so the user can look at the running app.
export default defineConfig({
    root: 'playground',
    server: { port: 5180, strictPort: true, host: '0.0.0.0', allowedHosts: true },
    plugins: [
        {
            name: 'land-on-workspace',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
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
