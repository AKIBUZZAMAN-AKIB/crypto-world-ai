// Real workspace + delayed provider: never paint the previous comparison under a new
// symbol, do not duplicate fetches on mode changes, and ignore replies after teardown.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage(), errors = [], facts = {};
page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(e.stack ?? String(e)); });
try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.evaluate(() => {
        const old = window.__ws, Workspace = old.constructor;
        const original = old.active.chart.renderer.getBars();
        old.destroy();
        window.__slowCalls = {};
        window.__slowPending = {};
        window.__slowBars = (base) => original.map((b, i) => ({ ...b, open: base + i, high: base + i + 1, low: base + i - 1, close: base + i }));
        const provider = {
            listSymbols: () => Promise.resolve(['AAA', 'BBB', 'CCC', 'DDD'].map(ticker => ({ ticker }))),
            getBars: (symbol) => {
                window.__slowCalls[symbol] = (window.__slowCalls[symbol] ?? 0) + 1;
                if (symbol === 'AAA') return Promise.resolve(window.__slowBars(100));
                return new Promise(resolve => { window.__slowPending[symbol] = resolve; });
            },
        };
        window.__ws = new Workspace('#workspace', { layout: '1', symbol: 'AAA', timeframe: '60', bars: original.length,
            providers: { slowcompare: () => provider }, live: false, volume: false });
    });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar && window.__ws.active.chart.data.symbols().length >= 4, null, { timeout: 60_000 });
    await page.locator('.vela-widget-compare').click();
    const compare = page.locator('.vela-compare-panel'); await compare.waitFor({ state: 'visible' });
    await compare.locator('.vela-cmp-sym').click();
    const search = page.locator('.vela-symbol-panel'); await search.waitFor({ state: 'visible' });
    await search.locator('.vela-sp-input').fill('BBB');
    await search.locator('.vela-sp-row[data-ticker="BBB"] .vela-sp-pick').click();
    await compare.waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.__slowPending.BBB === 'function');
    await compare.locator('[data-display="own-scale"]').click();
    await compare.locator('[data-display="new-pane"]').click();
    await compare.locator('[data-display="own-scale"]').click();
    assert(await page.evaluate(() => window.__slowCalls.BBB) === 1, 'mode changes share one in-flight provider request');
    await page.evaluate(() => window.__slowPending.BBB(window.__slowBars(500)));
    await page.evaluate(() => {
        window.__compareSeries = () => {
            const chart = window.__ws.active.chart;
            const h = chart.indicators().find(x => x.nativeType === 'compare');
            return chart.orchestrator.registry.get(h.id).model?.series?.[0] ?? null;
        };
    });
    await page.waitForFunction(() => window.__compareSeries()?.points?.some(p => p.value != null), null, { timeout: 15_000 });
    const before = await page.evaluate(() => {
        const s = window.__compareSeries(); return { title: s.title, values: s.points.filter(p => p.value != null).slice(0, 3).map(p => p.value) };
    });
    assert(before.title === 'slowcompare:BBB' && before.values.every(x => x >= 500), 'the first provider series actually painted', before);

    await compare.locator('.vela-cmp-sym').click(); await search.waitFor({ state: 'visible' });
    await search.locator('.vela-sp-input').fill('CCC');
    await search.locator('.vela-sp-row[data-ticker="CCC"] .vela-sp-pick').click();
    await compare.waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.__slowPending.CCC === 'function');
    const during = await page.evaluate(() => {
        const s = window.__compareSeries(); return { title: s.title, numeric: s.points.filter(p => p.value != null).length };
    });
    assert(during.title === 'slowcompare:CCC' && during.numeric === 0,
        'changing the symbol immediately clears the old prices while the new request is pending', during);
    await page.evaluate(() => window.__slowPending.CCC(window.__slowBars(900)));
    await page.waitForFunction(() => window.__compareSeries()?.points?.some(p => p.value >= 900), null, { timeout: 15_000 });
    const after = await page.evaluate(() => {
        const s = window.__compareSeries(); return { title: s.title, values: s.points.filter(p => p.value != null).slice(0, 3).map(p => p.value) };
    });
    assert(after.title === 'slowcompare:CCC' && after.values.every(x => x >= 900), 'the replacement series paints its own data', after);

    await page.evaluate(() => window.__ws.setCompareSymbol('slowcompare:DDD'));
    await page.waitForFunction(() => typeof window.__slowPending.DDD === 'function');
    await page.evaluate(() => { window.__ws.destroy(); window.__slowPending.DDD(window.__slowBars(1300)); });
    await page.waitForTimeout(600);
    assert(errors.length === 0, 'a provider reply after workspace destruction cannot resurrect its chart', errors);
    facts.changes = { before, during, after, modeFetches: 1, teardownSafe: true };
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`compare-slow-provider-${engine}`, { ...facts, errors }); await context.close(); await browser.close(); }
