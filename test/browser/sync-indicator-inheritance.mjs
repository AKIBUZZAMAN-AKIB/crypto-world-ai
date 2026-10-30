// Live-link provenance, house-template and delayed-manifest regressions on real charts.
import { open, assert, report, OFFLINE } from './helpers.mjs';
const { browser, page, errors } = await open({ base: OFFLINE, settle: 1000 });
try {
    const singleton = await page.evaluate(() => {
        const ws = window.__ws, source = ws.cell('a').chart.indicators().find((h) => h.nativeType === 'volume');
        const added = ws.setIndicatorLiveSync([source.id], 'layout');
        ws.cells()[1].chart.indicators().find((h) => h.nativeType === 'volume').setInput('upColor', '#aabbcc');
        return { added, cells: ws.cells().map((cell) => cell.chart.indicators().filter((h) => h.nativeType === 'volume').map((h) => h.inputValues().upColor)) };
    });
    assert(singleton.added === 3 && singleton.cells.every((values) => values.length === 1 && values[0] === '#aabbcc'), 'existing singleton Volume handles link without duplication and sync styles bidirectionally', singleton);

    // Start from one genuinely live cell, with no pre-existing pooled cells.
    const inherited = await page.evaluate(() => {
        const ws = window.__ws, state = ws.getState();
        state.layout = '1'; state.charts = state.charts.filter((c) => c.id === 'a'); state.activeCellId = 'a'; state.indicatorSyncLinks = [];
        ws.applyState(state);
        const source = ws.active.chart.addNativeIndicator('rsi');
        source.setInput('length', 11);
        ws.setLayout('4'); // copies are inherited, before live sync is enabled
        const second = ws.cells()[1], unrelated = second.chart.addNativeIndicator('rsi');
        unrelated.setInput('length', 42);
        const added = ws.setIndicatorLiveSync([source.id], 'layout');
        ws.cells()[2].chart.indicators().find((h) => h.nativeType === 'rsi').setInput('length', 33);
        return { added, cells: ws.cells().map((c) => ({ id: c.id, values: c.chart.indicators().filter((h) => h.nativeType === 'rsi').map((h) => h.inputValues().length) })) };
    });
    assert(inherited.added === 3 && JSON.stringify(inherited.cells.map((c) => c.values)) === JSON.stringify([[33], [33, 42], [33], [33]]), 'linking inherited studies reuses them without touching an unrelated same-type instance', inherited);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4);
    await page.waitForTimeout(800);
    const house = await page.evaluate(() => {
        const ws = window.__ws, state = ws.getState();
        state.layout = '1'; state.charts = state.charts.filter((c) => c.id === 'a'); state.activeCellId = 'a';
        ws.applyState(state);
        const source = ws.active.chart.addNativeIndicator('rsi');
        source.setInput('length', 14);
        ws.saveTemplate('House set'); ws.setDefaultTemplate('House set');
        source.setInput('length', 30); ws.setIndicatorLiveSync([source.id], 'layout'); ws.setLayout('4');
        const before = ws.cells().map((c) => c.chart.indicators().filter((h) => h.nativeType === 'rsi').map((h) => h.inputValues().length));
        ws.cells()[1].chart.indicators().filter((h) => h.nativeType === 'rsi')[1].setInput('length', 35);
        return { before, after: ws.cells().map((c) => c.chart.indicators().filter((h) => h.nativeType === 'rsi').map((h) => h.inputValues().length)) };
    });
    assert(JSON.stringify(house.before) === JSON.stringify([[30], [14, 30], [14, 30], [14, 30]]) && JSON.stringify(house.after) === JSON.stringify([[35], [14, 35], [14, 35], [14, 35]]), 'house-template instances are not mistaken for inherited linked copies', house);

    // Reuse the actual playground workspace constructor and data with a controlled
    // asynchronous manifest. The cells and engine are production components.
    const delayed = await page.evaluate(async () => {
        const { DemoEngine } = await import('/demo-engine.ts');
        const old = window.__ws, Workspace = old.constructor, bars = old.active.chart.renderer.getBars();
        old.destroy(); document.querySelector('#workspace').innerHTML = '';
        let finish;
        const manifest = new Promise((resolve) => { finish = resolve; });
        const provider = { getBars: () => Promise.resolve(bars), listSymbols: () => Promise.resolve([{ ticker: 'AAA' }]) };
        const ws = new Workspace('#workspace', { layout: '1', symbol: 'AAA', timeframe: '60', providers: { offline: () => provider }, live: false, indicators: () => manifest, engines: { demo: () => new DemoEngine() } });
        window.__ws = ws;
        const entry = { name: 'Late Demo', script: 'title Late Demo\noverlay true\ninput len = 5\nplot sma(close, len)', language: 'demo', enabled: true };
        const source = ws.active.addManifestInstance(entry); // a normal named manifest entry
        source.setInput('len', 27); ws.setLayout('4');
        const before = ws.cells().map((c) => c.chart.indicators().filter((h) => !h.nativeType).length);
        ws.setIndicatorLiveSync([source.id], 'layout');
        const pending = ws.indicatorSyncStatus(source.id);
        source.setInput('len', 31); // the latest value must catch up when the manifest lands
        finish([entry]);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const loaded = ws.cells().map((c) => c.chart.indicators().filter((h) => !h.nativeType).map((h) => h.inputValues().len));
        const linked = ws.indicatorSyncStatus(source.id);
        ws.cells()[1].chart.indicators().find((h) => !h.nativeType).setInput('len', 39);
        const reverse = ws.cells().map((c) => c.chart.indicators().filter((h) => !h.nativeType).map((h) => h.inputValues().len));
        return { before, pending, loaded, linked, reverse };
    });
    assert(JSON.stringify(delayed.before) === JSON.stringify([1, 0, 0, 0]) && delayed.pending.mode === 'layout' && delayed.pending.pending.length === 3, 'a not-yet-loaded inherited script remains a pending link', delayed);
    assert(JSON.stringify(delayed.loaded) === JSON.stringify([[31], [31], [31], [31]]) && delayed.linked.pending.length === 0 && JSON.stringify(delayed.reverse) === JSON.stringify([[39], [39], [39], [39]]), 'manifest resolution catches up once without duplicates and remains bidirectional', delayed);

    const scriptHouse = await page.evaluate(async () => {
        const { DemoEngine } = await import('/demo-engine.ts');
        const old = window.__ws, Workspace = old.constructor, bars = old.active.chart.renderer.getBars();
        old.destroy(); document.querySelector('#workspace').innerHTML = '';
        const provider = { getBars: () => Promise.resolve(bars), listSymbols: () => Promise.resolve([{ ticker: 'AAA' }]) };
        const ws = new Workspace('#workspace', { layout: '1', symbol: 'AAA', timeframe: '60', providers: { offline: () => provider }, live: false, engines: { demo: () => new DemoEngine() } });
        window.__ws = ws;
        const h = ws.active.addManifestInstance({ name: 'House script', script: 'title House script\noverlay true\ninput len = 5\nplot sma(close, len)', language: 'demo', enabled: true }, { standalone: true });
        h.setInput('len', 17); ws.saveTemplate('Script house'); ws.setDefaultTemplate('Script house'); ws.setLayout('4');
        await new Promise((resolve) => setTimeout(resolve, 650));
        return ws.cells().map((c) => c.chart.indicators().filter((x) => !x.nativeType).map((x) => ({ language: x.language, len: x.inputValues().len })));
    });
    assert(scriptHouse.length === 4 && scriptHouse.every((items) => items.length === 1 && items[0].language === 'demo' && items[0].len === 17), 'default templates seed source, language and inputs onto new cells', scriptHouse);
    assert(errors.length === 0, 'no browser errors', errors);
    report('indicator-inheritance', { singleton, inherited, house, delayed, scriptHouse });
} finally { await browser.close(); }
