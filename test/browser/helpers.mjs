// Shared plumbing for the browser checks: a Chromium, the playground URL, and a tiny
// assertion helper that prints the measured value on failure.
import { chromium } from 'playwright';
import { resolve } from 'node:path';

export const BASE = process.env.SYNC_BASE ?? 'http://127.0.0.1:5190/workspace.html';
/** The deterministic, network-free page (playground/offline.html). Checks that depend on
 *  DATA (crosshair instants, click-to-align time, visible ranges) use this one. */
export const OFFLINE = process.env.SYNC_BASE_OFFLINE ?? 'http://127.0.0.1:5190/offline.html';

export async function open(opts = {}) {
    const base = opts.base ?? BASE;
    // `--disable-dev-shm-usage`: a container's /dev/shm defaults to 64 MB and the
    // 8-and-16-chart pages crash the renderer there. `--js-flags` caps the heap for the
    // same reason — a crash reads as a test failure and hides the real cause.
    const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage', ...(process.env.CHROMIUM_EXTRA_ARGS ?? '').split(' ').filter(Boolean)],
    });
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

// An actual contributed side panel, for checking movement/maximize independently of
// the built-in standard panes. The existing offline workspace remains the only fixture.
export async function installMovablePanel(page) {
    const url = `/@fs${resolve('src/widget/contributions.ts')}`;
    await page.evaluate(async (fallbackUrl) => {
        // Vite adds an HMR timestamp after an edit. Import the exact registry module
        // already used by the workspace rather than creating a second registry copy.
        const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
            .find((name) => name.includes('/src/widget/contributions.ts')) ?? fallbackUrl;
        const { registerSidePanel } = await import(moduleUrl);
        registerSidePanel({
            id: 'resizeProbe', title: 'Resize probe', icon: 'tester', resizable: true,
            maximizable: true, mount: (_context, body) => { body.textContent = 'Panel resize probe'; },
        });
        window.__ws.refreshActions();
    }, url);
}

export function assert(ok, message, measured) {
    if (ok) return;
    console.error(`FAIL ${message}${measured === undefined ? '' : ` — ${JSON.stringify(measured)}`}`);
    process.exitCode = 1;
}

export function report(name, facts) {
    console.log(JSON.stringify({ check: name, ...facts }));
}

// Interact with the visible alert combobox, not its backing (hidden) native select.
export async function chooseAlertOption(select, value) {
    const trigger = select.locator('..').getByRole('combobox');
    await trigger.click();
    const list = await trigger.getAttribute('aria-controls');
    await select.page().locator(`#${list} [data-value="${value}"]`).click();
}
