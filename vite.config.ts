import { defineConfig } from 'vite';

/**
 * Playground server: `npm run playground` serves playground/ with Vela imported STRAIGHT
 * from src/ (no build step, hot reload). Nothing else to configure — Vela ships no
 * scripting engine, so the page carries its own tiny demo engine (playground/demo-engine.ts)
 * and needs no bundler plumbing for it.
 */
export default defineConfig({
    root: 'playground',
    // `allowedHosts`: the playground is routinely served through a proxy/tunnel (a sandbox
    // preview, a share link), and Vite's host check would answer those with a blank 403.
    server: { host: '0.0.0.0', port: 5190, strictPort: true, allowedHosts: true },
});
