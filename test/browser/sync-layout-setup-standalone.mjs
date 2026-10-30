// The real delivered file:// workspace, with networking blocked, must retain the
// unified Layout setup on both desktop and portrait phone. No generated harness.
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const url = pathToFileURL(resolve('single/vela-workspace.html')).href;
const errors = [], facts = {};
async function boot(viewport, phone = false) {
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.route('**/*', (route) => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
    if (context.routeWebSocket) await context.routeWebSocket('wss://**', (socket) => socket.close());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 30_000 });
    return { context, page };
}
try {
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.evaluate(() => window.__ws.setLayout('4'));
        await page.waitForFunction(() => window.__ws.cells().length === 4);
        await page.locator('.vela-mb-more').tap();
        const entries = await page.locator('.vela-more-panel:visible .vela-md-row').allTextContents();
        assert(entries.filter(text => /Layout setup|Chart syncing/.test(text)).length === 1 && entries.some(text => text.includes('Layout setup')),
            'offline standalone phone has one Layout setup entry', entries);
        await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Layout setup' }).tap();
        const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
        facts.phone = await panel.evaluate(el => ({
            tabs: [...el.querySelectorAll('[role="tab"]')].map(tab => tab.textContent.trim()),
            selected: el.querySelectorAll('.vela-lp-sq[data-on]').length,
            rect: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON(),
            pageW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            pageH: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        }));
        assert(facts.phone.tabs.join('|') === 'Layout|Chart syncing' && facts.phone.selected === 4
            && Math.abs(facts.phone.rect.bottom - facts.phone.host.bottom) < 3 && facts.phone.pageW === 0 && facts.phone.pageH === 0,
            'offline standalone phone has the bottom-attached tabbed pane without page overflow', facts.phone);
        await panel.getByRole('tab', { name: 'Chart syncing' }).tap();
        const symbol = panel.getByRole('switch', { name: 'Symbol sync' });
        const before = await symbol.getAttribute('aria-checked'); await symbol.tap();
        assert(await symbol.getAttribute('aria-checked') !== before && await page.evaluate(() => Boolean(window.__ws.sync.state().symbol)) === (before !== 'true')
            && await panel.locator('.vela-md-matrix-head[data-cell]').count() === 4,
            'offline standalone sync tab updates its actual model and four-chart matrix');
        await panel.locator('.vela-panel-max').tap();
        assert(await panel.getAttribute('data-maximized') !== null, 'offline standalone phone pane opens fullscreen');
        await panel.locator('.vela-panel-max').tap();
        assert(await panel.getAttribute('data-maximized') === null, 'offline standalone phone restores from fullscreen');
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        await page.locator('button[aria-label^="Layout —"]').click();
        const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
        facts.desktop = await panel.evaluate(el => ({ standard: el.dataset.standardPane, floating: el.dataset.freeFloating ?? null,
            rect: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON() }));
        assert(facts.desktop.standard === '1' && facts.desktop.floating === null &&
            Math.abs(facts.desktop.rect.height - facts.desktop.host.height) < 3,
            'offline standalone desktop opens a real docked pane', facts.desktop);
        await panel.locator('.vela-lp-sq[data-r="1"][data-c="1"]').click();
        await page.waitForFunction(() => window.__ws.cells().length === 4);
        await panel.getByRole('tab', { name: 'Chart syncing' }).click();
        assert(await panel.locator('.vela-ls-syncrows [role="switch"]').count() === 7 &&
            await panel.locator('.vela-md-matrix-head[data-cell]').count() === 4,
            'offline standalone desktop retains seven switches and every chart column');
        await panel.locator('.vela-panel-dock-toggle').click();
        assert(await panel.getAttribute('data-free-floating') === '1' && await panel.locator('.vela-panel-corner-resize').isVisible(),
            'offline standalone desktop can float and directly resize the pane');
        await panel.locator('.vela-panel-dock-toggle').click();
        assert(await panel.getAttribute('data-free-floating') === null, 'offline standalone pane returns to the dock');
        await context.close();
    }
    assert(errors.length === 0, 'standalone pages have no uncaught errors', errors);
    report('layout-setup-standalone', { engine, ...facts, errors });
} finally { await browser.close(); }
