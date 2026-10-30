// Build the delivered one-file page and prove Monaco, its worker, styles, codicon font,
// draft persistence and Pine suggestions work from file:// with network requests denied.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { assert, report } from './helpers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, ['tools/build-single-file.mjs'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const blocked = [];
await context.route('**/*', (route) => {
    if (/^https?:/.test(route.request().url())) {
        blocked.push(route.request().url());
        void route.abort();
    } else void route.continue();
});
if (context.routeWebSocket) await context.routeWebSocket('wss://**', (socket) => socket.close());
const page = await context.newPage();
const errors = [], workers = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('worker', (worker) => workers.push(worker.url()));
try {
    await page.goto(pathToFileURL(resolve(root, 'single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60_000 });
    assert(await page.evaluate(() => window.__ws.openEditor()), 'standalone workspace opens the script editor');
    await page.locator('.vela-pe .monaco-editor').waitFor({ timeout: 60_000 });
    const strip = await page.locator('.vela-pe').evaluate((el) => {
        const grip = el.querySelector('.vela-panel-grip'), head = el.querySelector('.vela-panel-header');
        return grip.parentElement === el && grip.nextElementSibling === head && Math.abs(grip.getBoundingClientRect().bottom - head.getBoundingClientRect().top) < 2;
    });
    assert(strip, 'standalone Pine Editor keeps its resize strip separate above the heading');
    const offline = await page.evaluate(() => ({
        text: document.querySelector('.vela-pe .view-lines')?.innerText.slice(0, 90),
        styles: document.querySelectorAll('style[data-vela-monaco]').length,
        embeddedFont: [...document.querySelectorAll('style[data-vela-monaco]')].some((style) => style.textContent.includes('data:font/ttf;base64,')),
        background: getComputedStyle(document.querySelector('.vela-pe .monaco-editor')).backgroundColor,
    }));
    assert(offline.text.includes('indicator') && offline.styles > 20 && offline.embeddedFont,
        'standalone loads real Monaco with embedded styling and font', offline);
    const area = await page.locator('.vela-pe .view-lines').boundingBox();
    await page.touchscreen.tap(area.x + 100, area.y + 24);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ta.sm', { delay: 30 });
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const suggestions = await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts();
    assert(suggestions.some((text) => /sma/.test(text)), 'standalone suggestions work without network', suggestions);
    await page.locator('.suggest-widget.visible .monaco-list-row', { hasText: 'sma' }).first().tap();
    await page.waitForTimeout(300);
    const code = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('vela-pine-library'));
        return saved.scripts.find((script) => script.id === saved.activeId)?.code;
    });
    assert(code.includes('ta.sma()'), 'standalone persists a tapped suggestion', code?.slice(-100));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60_000 });
    await page.evaluate(() => window.__ws.openEditor());
    await page.locator('.vela-pe .monaco-editor').waitFor({ timeout: 60_000 });
    const reloaded = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('vela-pine-library'));
        return saved.scripts.find((script) => script.id === saved.activeId)?.code;
    });
    assert(reloaded === code, 'standalone draft survives a file reload');
    assert(workers.some((worker) => worker.startsWith('blob:')), 'standalone worker was started without a network URL', workers);
    assert(!blocked.some((url) => /monaco|codicon|unpkg|jsdelivr/i.test(url)), 'the editor requests no Monaco CDN or font', blocked);
    assert(errors.length === 0, 'standalone has no uncaught page errors', errors);
    report('pine-standalone', { offline, suggestions, workerCount: workers.length, blockedMarketRequests: blocked.length, errors });
} finally {
    await context.close();
    await browser.close();
}
