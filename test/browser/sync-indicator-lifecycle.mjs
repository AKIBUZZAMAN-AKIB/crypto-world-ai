// Source-backed template/link and pooled/new-chart lifecycle on the real workspace.
import { open, assert, report, OFFLINE } from './helpers.mjs';

const { browser, page, errors } = await open({ base: OFFLINE, settle: 1100 });
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
try {
    const script = await page.evaluate(async () => {
        const ws = window.__ws;
        const { DemoEngine } = await import('/demo-engine.ts');
        ws.cells().forEach((cell) => cell.chart.registerEngine('demo', new DemoEngine()));
        const code = 'title Demo\noverlay false\ninput len = 14\nplot sma(close, len) "Moving average" #ff0000';
        const a = ws.cell('a'), b = ws.cell('b');
        const h = a.addManifestInstance({ name: 'Demo', script: code, enabled: true, language: 'demo' }, { standalone: true });
        h.setInput('len', 22); // before async prepare has completed
        const early = a.indicatorLedger();
        ws.setIndicatorLiveSync([h.id], 'charts', ['b']);
        const peer = b.chart.indicators().find((x) => x.source === code);
        peer.setInput('len', 29);
        const saved = ws.saveSelectedIndicatorTemplate('Demo set', [h.id]);
        const native = a.chart.addNativeIndicator('rsi');
        const appended = ws.saveSelectedIndicatorTemplate('Demo set', [native.id], true);
        return { early, source: h.inputValues(), peer: peer.inputValues(), language: h.language, peerLanguage: peer.language, saved, appended, template: ws.getState().templates['Demo set'] };
    });
    assert(script.early.manifest[0]?.inputs?.len === 22 && script.early.manifest[0]?.language === 'demo', 'early pre-prepare edits survive the ledger', script);
    assert(script.source.len === 29 && script.peer.len === 29 && script.language === 'demo' && script.peerLanguage === 'demo', 'a non-default language source syncs bidirectionally', script);
    assert(script.saved && script.appended && script.template.scripts[0]?.language === 'demo' && script.template.indicators.length === 1, 'template holds source, language and appended native', script.template);
    await page.waitForTimeout(1600);
    const restored = await page.evaluate(() => {
        const ws = window.__ws;
        const state = ws.getState();
        ws.applyState(state);
        const a = ws.cell('a').chart, b = ws.cell('b').chart;
        const source = a.indicators().find((h) => h.language === 'demo');
        const peer = b.indicators().find((h) => h.language === 'demo');
        peer.setInput('len', 37);
        const afterLinkRestore = { source: source.inputValues().len, peer: peer.inputValues().len, links: ws.getState().indicatorSyncLinks };
        const applied = ws.applyTemplate('Demo set', 'd');
        const d = ws.cell('d').chart;
        return { afterLinkRestore, applied, script: d.indicators().find((h) => h.language === 'demo')?.inputValues(), native: d.indicators().some((h) => h.nativeType === 'rsi') };
    });
    assert(restored.afterLinkRestore.source === 37 && restored.afterLinkRestore.peer === 37 && restored.afterLinkRestore.links?.length === 1, 'source-backed live link rebinds after state restore', restored);
    assert(restored.applied === 1 && restored.script?.len === 29 && restored.native, 'applying the separate template restores both kinds', restored);
    await page.waitForTimeout(1200);
    assert(consoleErrors.length === 0, 'registered source language has no engine errors', consoleErrors);

    // A missing target engine must not create a dead linked copy or delete the target's
    // existing studies while attempting to apply a source-backed template.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4);
    await page.waitForTimeout(600);
    const unsupported = await page.evaluate(async () => {
        const ws = window.__ws, a = ws.cell('a'), b = ws.cell('b');
        const { DemoEngine } = await import('/demo-engine.ts');
        a.chart.registerEngine('demo', new DemoEngine());
        const h = a.addManifestInstance({ name: 'Demo', script: 'title Demo\noverlay true\ninput len = 5\nplot sma(close, len)', language: 'demo', enabled: true }, { standalone: true });
        const before = b.chart.indicators().map((x) => x.id);
        const linked = ws.setIndicatorLiveSync([h.id], 'charts', ['b']);
        ws.saveSelectedIndicatorTemplate('Requires demo', [h.id]);
        const applied = ws.applyTemplate('Requires demo', 'b');
        const status = ws.indicatorSyncStatus(h.id);
        const partial = ws.applyTemplate('Requires demo', 'all');
        return { before, after: b.chart.indicators().map((x) => x.id), linked, applied, partial, status };
    });
    assert(unsupported.linked === 0 && unsupported.status.mode === 'none' && unsupported.applied === 0 && unsupported.partial === 1 && JSON.stringify(unsupported.before) === JSON.stringify(unsupported.after), 'missing engines neither claim sync nor destroy unsupported charts, even for partial all-chart application', unsupported);

    // Fresh page: start with one live chart and no pooled slots so expansion really mints
    // cells rather than merely restoring the playground's original four.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4);
    await page.waitForTimeout(1000);
    const expanded = await page.evaluate(() => {
        const ws = window.__ws;
        const one = ws.getState();
        one.layout = '1';
        one.charts = one.charts.filter((c) => c.id === 'a');
        one.activeCellId = 'a';
        ws.applyState(one);
        const source = ws.cell('a').chart.addNativeIndicator('rsi');
        source.setInputs({ length: 11, color: '#224466' });
        ws.setIndicatorLiveSync([source.id], 'layout');
        const before = ws.indicatorSyncStatus(source.id);
        ws.setLayout('4');
        const cells = ws.cells().map((cell) => ({ id: cell.id, copies: cell.chart.indicators().filter((h) => h.nativeType === 'rsi').map((h) => ({ id: h.id, v: h.inputValues() })) }));
        const second = ws.cells()[1];
        const h = second.chart.indicators().find((v) => v.nativeType === 'rsi');
        h.setInput('length', 25);
        return { before, cells, all: ws.cells().map((c) => c.chart.indicators().find((v) => v.nativeType === 'rsi')?.inputValues().length), ids: ws.cells().map((c) => c.id) };
    });
    assert(expanded.before.mode === 'layout' && expanded.cells.length === 4 && expanded.cells.every((c) => c.copies.length === 1), 'single-chart opt-in expands without duplicating inherited indicators', expanded);
    assert(expanded.all.every((v) => v === 25), 'new layout cells remain bidirectionally linked', expanded);

    const pooled = await page.evaluate(({ ids }) => {
        const ws = window.__ws, [a, b] = ids;
        ws.setActiveCell(b);
        const member = ws.cell(b).chart.indicators().find((h) => h.nativeType === 'rsi');
        ws.objectTree.setGroupsFor(ws.cell(b).chart, [{ id: 'pooled-group', name: 'Pooled group', ids: [], indicators: [member.id] }]);
        ws.setActiveCell(a);
        ws.setLayout('1');
        const aSource = ws.cell(a).chart.indicators().find((h) => h.nativeType === 'rsi');
        ws.setIndicatorLiveSync([aSource.id], 'layout'); // reaffirm while the other charts are pooled
        const stillPending = ws.indicatorSyncStatus(aSource.id).pending;
        aSource.setInput('length', 43); // b is hidden and cannot receive this yet
        const swapped = ws.showHiddenChart(b);
        const back = ws.cell(b).chart.indicators().find((h) => h.nativeType === 'rsi');
        const valueOnReturn = back.inputValues().length;
        const groups = ws.objectTree.groupsFor(ws.cell(b).chart);
        back.setInput('length', 51); // a is now hidden
        ws.showHiddenChart(a);
        const aAgain = ws.cell(a).chart.indicators().find((h) => h.nativeType === 'rsi').inputValues().length;
        return { swapped, valueOnReturn, aAgain, groups, stillPending, pending: ws.getState().indicatorSyncLinks };
    }, expanded);
    assert(pooled.swapped && pooled.stillPending.includes(expanded.ids[1]) && pooled.valueOnReturn === 43 && pooled.aAgain === 51, 'reaffirmed layout sync retains pooled members and catches them up in either direction', pooled);
    assert(pooled.groups[0]?.name === 'Pooled group' && pooled.groups[0].indicators.length === 1, 'pooled chart retains and rebinds its indicator group', pooled.groups);
    assert(errors.length === 0, 'no browser page errors', errors);
    report('indicator-lifecycle', { script, restored, unsupported, expanded, pooled });
} finally { await browser.close(); }
