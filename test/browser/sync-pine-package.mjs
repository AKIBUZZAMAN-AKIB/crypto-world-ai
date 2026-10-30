// Exercise the built npm workspace on the existing offline page, not a generated HTML
// harness. Playwright serves the actual dist files unchanged so Vite does not re-bundle
// them; Vite's own optimized Zag dependencies stand in for the consumer's bundler.
// Run `npm run build` first (normal npm install/prepare also builds dist).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const [name, outputs] of Object.entries(pkg.exports)) {
    for (const [kind, path] of Object.entries(outputs)) {
        assert(existsSync(resolve(root, path)), `package export ${name} has ${kind}`, path);
    }
}
const require = createRequire(import.meta.url);
assert(typeof require(resolve(root, 'dist/workspace.cjs')).VelaWorkspace === 'function', 'the CJS workspace loads in Node');

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [], workers = [], packageAssets = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('worker', (worker) => workers.push(worker.url()));
await page.route('**/__dist__/**', (route) => {
    const file = new URL(route.request().url()).pathname.replace('/__dist__/', '');
    packageAssets.push(file);
    return route.fulfill({ path: resolve(root, 'dist', file), contentType: 'text/javascript' });
});
await page.route('**/__deps__/**', (route) => {
    const file = new URL(route.request().url()).pathname.replace('/__deps__/', '');
    return route.fulfill({ path: resolve(root, 'node_modules/.vite/deps', file), contentType: 'text/javascript' });
});
try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 60_000 });
    await page.evaluate(() => {
        const map = document.createElement('script');
        map.type = 'importmap';
        map.textContent = JSON.stringify({ imports: Object.fromEntries(
            ['vanilla', 'menu', 'dialog', 'tooltip'].map((name) => [`@zag-js/${name}`, `/__deps__/@zag-js_${name}.js`]),
        ) });
        document.head.append(map);
    });
    const opened = await page.evaluate(async () => {
        const { VelaWorkspace } = await import('/__dist__/workspace.js');
        const { PineEngine } = await import('/vendor/pine-libre/index.js');
        window.__ws.destroy();
        const host = document.querySelector('#workspace');
        host.replaceChildren();
        const bars = Array.from({ length: 100 }, (_, i) => ({
            time: 1700000000000 + i * 3600000, open: 100 + i / 10, high: 102 + i / 10,
            low: 98 + i / 10, close: 101 + i / 10, volume: 100,
        }));
        const provider = { getBars: async () => bars, listSymbols: async () => [{ ticker: 'AAA' }] };
        window.__packageWorkspace = new VelaWorkspace(host, {
            layout: '1', symbol: 'AAA', timeframe: '60', providers: { offline: () => provider },
            engines: { pine: () => new PineEngine() }, defaultLanguage: 'pine', live: false, theme: 'dark',
        });
        return window.__packageWorkspace.openEditor();
    });
    assert(opened, 'the built ESM workspace opens its editor');
    await page.locator('.vela-pe .monaco-editor').waitFor({ timeout: 60_000 });
    const styles = await page.locator('style[data-vela-monaco]').count();
    const font = await page.evaluate(() => [...document.querySelectorAll('style[data-vela-monaco]')]
        .some((style) => style.textContent.includes('data:font/ttf;base64')));
    assert(styles > 20 && font, 'built ESM injects Monaco styles and an embedded codicon font', { styles, font });
    await page.locator('.vela-pe .view-lines').click({ position: { x: 90, y: 20 } });
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('ta.sm');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    assert((await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts()).some((row) => row.includes('sma')),
        'Pine completion works in the production ESM bundle');
    assert(workers.some((url) => url.startsWith('blob:')), 'the production ESM bundle creates an inline worker', workers);
    assert(!packageAssets.some((name) => /\.(?:css|ttf)$/.test(name)), 'Monaco needs no separate package CSS or font URL', packageAssets);
    await page.locator('.vela-pe .vela-panel-close').click();
    await page.locator('button[aria-label^="Layout —"]').click();
    const setup = page.locator('.vela-layout-setup'); await setup.waitFor({ state: 'visible' });
    const layoutSetup = await setup.evaluate(el => ({ standard: el.dataset.standardPane, floating: el.dataset.freeFloating ?? null,
        tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()), grid: el.querySelectorAll('.vela-lp-sq').length }));
    assert(layoutSetup.standard === '1' && layoutSetup.floating === null && layoutSetup.tabs.join('|') === 'Layout|Chart syncing'
        && layoutSetup.grid === 16, 'the production ESM workspace opens the docked Layout setup pane', layoutSetup);
    await setup.getByRole('tab', { name: 'Chart syncing' }).click();
    const symbol = setup.getByRole('switch', { name: 'Symbol sync' }); await symbol.click();
    assert(await page.evaluate(() => window.__packageWorkspace.sync.state().symbol === true)
        && await symbol.getAttribute('aria-checked') === 'true', 'the production bundle routes sync controls to its model');
    assert(errors.length === 0, 'no uncaught page errors in the production package', errors);
    report('pine-package', { styles, font, layoutSetup, workers: workers.length, assets: packageAssets.length, errors });
} finally {
    await browser.close();
}
