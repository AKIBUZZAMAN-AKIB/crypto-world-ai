// Restore an already-open search while an actual provider index is still pending;
// then check that an Indicators slot override retains its original / shortcut.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
import { resolve } from 'node:path';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const workspaceModule = `/@fs${resolve('src/workspace/index.ts')}`;
const contributionModule = `/@fs${resolve('src/widget/contributions.ts')}`;
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.locator('.vela-widget-symbol').click();
    const state = await page.evaluate(() => JSON.stringify(window.__ws.getState()));
    await page.evaluate(async ({ saved, workspaceModule }) => {
        const { VelaWorkspace } = await import(workspaceModule);
        window.__ws.destroy();
        const storage = { get: () => saved, set: () => {}, remove: () => {} };
        const provider = {
            getBars: () => Promise.resolve([]),
            listSymbols: () => new Promise(resolve => { window.__resolveSymbols = resolve; }),
        };
        window.__ws = new VelaWorkspace('#workspace', {
            persist: 'pending-index', storage, layout: '4', symbol: 'AAA',
            providers: { offline: () => provider }, live: false,
        });
    }, { saved: state, workspaceModule });
    const search = page.locator('.vela-symbol-panel'); await search.waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.__resolveSymbols === 'function');
    const loading = await search.locator('.vela-sp-empty').innerText();
    assert(loading.includes('loading'), 'restored search honestly reports a pending provider index', loading);
    await search.locator('.vela-sp-input').fill('BB');
    await page.evaluate(() => window.__resolveSymbols(['AAA', 'BBB', 'CCC', 'DDD'].map(ticker => ({ ticker }))));
    await search.locator('.vela-sp-row[data-i="0"][data-ticker="BBB"]').waitFor();
    assert(await search.locator('.vela-sp-input').inputValue() === 'BB', 'late symbol index refresh keeps the typed query');
    facts.restoredProvider = { query: 'BB', result: 'BBB' };

    // Compare's symbol, selected mode and ownership of the percent axis must survive
    // boot and in-place state restoration. A stale placement retry may not undo a later mode.
    await page.goto(`${OFFLINE}?persist=1`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { window.__ws.destroy(); localStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.evaluate(() => {
        window.__ws.setCompareSymbol('offline:BBB');
        window.__ws.setCompareDisplay('new-pane');
        window.__ws.setCompareDisplay('own-scale');
        window.__ws.openCompare();
    });
    await page.waitForFunction(() => {
        const chart = window.__ws.active.chart, h = chart.indicators().find(x => x.nativeType === 'compare');
        const pane = chart.panes.list().find(p => p.indicators.some(i => i.id === h?.id));
        return pane?.id === 'price' && pane.indicators.find(i => i.id === h.id)?.ownScale === true;
    }, null, { timeout: 15_000 });
    await page.waitForTimeout(1500); // earlier mounting retries must not undo the latest choice
    assert(await page.evaluate(() => {
        const chart = window.__ws.active.chart, h = chart.indicators().find(x => x.nativeType === 'compare');
        const pane = chart.panes.list().find(p => p.indicators.some(i => i.id === h?.id));
        return pane?.id === 'price' && pane.indicators.find(i => i.id === h.id)?.ownScale === true;
    }), 'a stale Compare placement retry cannot override the latest display');
    await page.evaluate(() => window.__ws.destroy());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    const compare = page.locator('.vela-compare-panel'); await compare.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
        const chart = window.__ws.active.chart, h = chart.indicators().find(x => x.nativeType === 'compare');
        const pane = chart.panes.list().find(p => p.indicators.some(i => i.id === h?.id));
        return pane?.id === 'price' && pane.indicators.find(i => i.id === h.id)?.ownScale === true;
    }, null, { timeout: 15_000 });
    assert(await compare.locator('.vela-cmp-sym-name').textContent() === 'offline:BBB' &&
        await compare.locator('[data-display="own-scale"]').getAttribute('aria-pressed') === 'true' &&
        (await page.locator('.vela-widget-compare').getAttribute('aria-label')).includes('BBB'),
        'a restored Compare pane projects its saved symbol and display to pane and toolbar');
    await page.evaluate(() => window.__ws.setCompareSymbol('offline:CCC'));
    assert(await compare.locator('.vela-cmp-sym-name').textContent() === 'offline:CCC' &&
        await compare.locator('[data-display="own-scale"]').getAttribute('aria-pressed') === 'true',
        'choosing another symbol after restore keeps its display mode');
    await page.evaluate(() => window.__ws.active.chart.indicators().find(x => x.nativeType === 'compare').setInput('symbol', 'offline:DDD'));
    assert(await compare.locator('.vela-cmp-sym-name').textContent() === 'offline:DDD' &&
        (await page.locator('.vela-widget-compare').getAttribute('aria-label')).includes('DDD'),
        'an external indicator input edit updates the Compare pane and toolbar');
    await page.evaluate(() => window.__ws.active.chart.indicators().find(x => x.nativeType === 'compare').setInput('display', 'new-pane'));
    await page.waitForFunction(() => {
        const chart = window.__ws.active.chart, h = chart.indicators().find(x => x.nativeType === 'compare');
        return chart.panes.list().some(p => p.id !== 'price' && p.indicators.some(i => i.id === h?.id));
    }, null, { timeout: 15_000 });
    assert(await compare.locator('[data-display="new-pane"]').getAttribute('aria-pressed') === 'true',
        'an external display edit moves the Compare study and updates its selection');
    await page.evaluate(() => window.__ws.destroy());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await compare.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
        const chart = window.__ws.active.chart, h = chart.indicators().find(x => x.nativeType === 'compare');
        return chart.panes.list().some(p => p.id !== 'price' && p.indicators.some(i => i.id === h?.id));
    }, null, { timeout: 15_000 });
    assert(await compare.locator('[data-display="new-pane"]').getAttribute('aria-pressed') === 'true',
        'a restored New pane mode recreates its actual chart pane');
    await page.evaluate(() => window.__ws.setCompareDisplay('same-percent'));
    const sameState = await page.evaluate(() => window.__ws.getState());
    assert(sameState.charts.find(c => c.id === sameState.activeCellId)?.compareAutoPercent === true,
        'a Compare-owned percent axis records its provenance');
    await page.evaluate(state => { window.__ws.removeCompare(); window.__ws.applyState(state); }, sameState);
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'percent' &&
        await compare.locator('.vela-cmp-sym-name').textContent() === 'offline:DDD',
        'in-place restore rehydrates Compare mode and its axis ownership');
    await page.evaluate(() => window.__ws.destroy());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await compare.waitFor({ state: 'visible' });
    await compare.locator('.vela-cmp-remove').click();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'price' &&
        await page.evaluate(() => !window.__ws.getState().charts.find(c => c.id === window.__ws.getState().activeCellId)?.compareAutoPercent),
        'removing restored Compare puts back the price axis it owned');
    await page.evaluate(() => {
        window.__ws.active.chart.renderer.set('scaleMode', 'percent'); // explicitly chosen by user
        window.__ws.setCompareSymbol('offline:CCC');
        window.__ws.openCompare();
    });
    await page.evaluate(() => window.__ws.destroy());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await compare.waitFor({ state: 'visible' });
    await compare.locator('.vela-cmp-remove').click();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'percent',
        'removing restored Compare leaves the user-selected percent axis unchanged');
    await page.evaluate(() => {
        const ws = window.__ws;
        ws.active.chart.renderer.set('scaleMode', 'price');
        ws.setCompareSymbol('offline:BBB'); ws.openCompare();
        ws.active.chart.indicators().find(x => x.nativeType === 'compare').remove();
    });
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'price' &&
        await compare.locator('.vela-cmp-sym-name').textContent() === 'Choose symbol…' &&
        await page.locator('.vela-widget-compare').getAttribute('aria-pressed') === 'false',
        'removing Compare through a chart indicator control restores its owned axis and pane state');
    await page.evaluate(() => {
        const ws = window.__ws;
        ws.setActiveCell('b');
        ws.active.chart.renderer.set('scaleMode', 'price');
        ws.setCompareSymbol('offline:CCC');
        ws.setLayout('1');
    });
    assert(await page.evaluate(() => window.__ws.getState().charts.find(c => c.id === 'b')?.compareAutoPercent === true),
        'the percent-axis provenance remains with a pooled hidden chart');
    await page.evaluate(() => { window.__ws.setLayout('4'); window.__ws.setActiveCell('b'); });
    await page.waitForFunction(() => window.__ws.active.chart.indicators().some(h => h.nativeType === 'compare'));
    await page.evaluate(() => window.__ws.removeCompare());
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'price',
        'a restored pooled chart still restores its own price axis on removal');
    facts.restoredCompare = { symbol: 'offline:DDD', mode: 'same-percent', ownedAxisRestored: true, userPercentPreserved: true,
        latestModeWins: true, newPaneRestored: true, externalRemoval: true, pooledChart: true };

    await page.evaluate(async ({ workspaceModule, contributionModule }) => {
        const { VelaWorkspace } = await import(workspaceModule);
        const { registerWidgetAction } = await import(contributionModule);
        window.__ws.destroy();
        window.__overrideCount = 0;
        window.__overrideOff = registerWidgetAction({ id: 'indicators', target: 'topbar', label: 'Custom studies',
            run: () => { window.__overrideCount++; } });
        const provider = { getBars: () => Promise.resolve([]), listSymbols: () => Promise.resolve([{ ticker: 'AAA' }]) };
        window.__ws = new VelaWorkspace('#workspace', { layout: '1', symbol: 'AAA', providers: { offline: () => provider }, live: false });
    }, { workspaceModule, contributionModule });
    await page.locator('.vela-workspace').focus(); await page.keyboard.press('/');
    assert(await page.evaluate(() => window.__overrideCount) === 1 && await page.locator('.vela-indicator-panel').count() === 0,
        'the / shortcut still calls an Indicators slot override instead of building the built-in pane');
    facts.override = { slashCalls: await page.evaluate(() => window.__overrideCount) };
    await page.evaluate(() => { window.__ws.destroy(); window.__overrideOff(); });
    assert(errors.length === 0, 'no page errors', errors);
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`discovery-restore-${engine}`, { ...facts, errors }); await context.close(); await browser.close(); }
