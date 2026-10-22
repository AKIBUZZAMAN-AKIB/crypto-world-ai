// Shared plumbing for the browser checks: a Chromium, the playground URL, and a tiny
// assertion helper that prints the measured value on failure.
import { chromium } from 'playwright';

export const BASE = process.env.SYNC_BASE ?? 'http://127.0.0.1:5190/workspace.html';
/** The deterministic, network-free page (playground/offline.html). Checks that depend on
 *  DATA (crosshair instants, click-to-align time, visible ranges) use this one. */
export const OFFLINE = process.env.SYNC_BASE_OFFLINE ?? 'http://127.0.0.1:5190/offline.html';

export async function open(opts = {}) {
    const base = opts.base ?? BASE;
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({
        viewport: opts.viewport ?? { width: 1440, height: 900 },
        ...(opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(opts.settle ?? 1500);
    return { browser, page, errors };
}

export function assert(ok, message, measured) {
    if (ok) return;
    console.error(`FAIL ${message}${measured === undefined ? '' : ` — ${JSON.stringify(measured)}`}`);
    process.exitCode = 1;
}

export function report(name, facts) {
    console.log(JSON.stringify({ check: name, ...facts }));
}
