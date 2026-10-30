import { chooseAlertOption } from './helpers.mjs';
// End-to-end price/drawing alerts and log routing through the existing offline workspace.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 4);
    await page.evaluate(() => Promise.all(window.__ws.cells().map((cell) => cell.chart.ready())));
    await page.evaluate(() => { window.__originalOfflineBars = window.__ws.cell('a').chart.orchestrator.rawBars.map((bar) => ({ ...bar })); });
    await page.locator('.vela-widget-alerts').click();
    const select = page.locator('.vela-ac-select'), value = page.getByLabel('Alert level'), create = page.locator('.vela-ac-create');
    const initial = await page.evaluate(() => ({ input: Number(document.querySelector('.vela-ac-input').value), price: window.__ws.active.chart.lastBar.close }));
    assert(initial.input === initial.price, 'initial level is the exact last loaded price, not a rounded or panned price', initial);
    await value.fill('100'); await chooseAlertOption(select, 'gt');
    assert(await value.inputValue() === '100', 'switching between level operators preserves the typed draft');
    await value.fill(''); assert(await create.isDisabled(), 'blank level cannot silently become zero');
    await value.fill('100'); await page.getByRole('button', { name: 'Every time' }).click(); await create.click();
    const immediate = await page.evaluate(() => ({ alerts: window.__ws.getState().priceAlerts, log: window.__ws.alertEntries(), now: Date.now() }));
    assert(immediate.alerts[0]?.frequency === 'each' && immediate.alerts[0]?.fires === 1 && immediate.alerts[0]?.state === 'active', 'repeating greater-than alert fires immediately and stays active', immediate);
    assert(immediate.log.length === 1 && Math.abs(immediate.now - immediate.log[0].time) < 5000 && immediate.log[0].source === 'AAA 1h', 'immediate fire is logged once with a real timestamp and source', immediate);
    // Feed actual bars through the chart's normal bar path, not by editing UI state.
    const tick = async (price) => page.evaluate((close) => {
        const chart = window.__ws.cell('a').chart, last = chart.lastBar;
        chart.orchestrator.applyBar({ time: last.time + 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 10 });
    }, price);
    await tick(99); await tick(101);
    const repeated = await page.evaluate(() => ({ alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries() }));
    assert(repeated.alert.fires === 2 && repeated.log.length === 2, 'Every time re-arms after price retreats and triggers on the next genuine crossing', repeated);
    // Price level crossing on a real next bar, once-only retirement, and status in Alerts.
    await chooseAlertOption(select, 'cross-up'); await value.fill('105');
    await page.getByRole('button', { name: 'Once only' }).click(); await create.click();
    await tick(106);
    await page.getByRole('tab', { name: /^Alerts/ }).click();
    const once = await page.evaluate(() => ({ alert: window.__ws.getState().priceAlerts.find((a) => a.condition === 'cross-up'), log: window.__ws.alertEntries(), visible: document.querySelector('.vela-ap-section').innerText }));
    assert(once.alert?.state === 'fired' && once.alert?.fires === 1 && /Triggered/.test(once.visible) && once.log.length === 3, 'once-only crossing fires, retires and appears in the armed manager', once);
    await page.getByRole('tab', { name: 'Create' }).click();
    await tick(104); await tick(107);
    assert((await page.evaluate(() => window.__ws.getState().priceAlerts.find((a) => a.condition === 'cross-up').fires)) === 1, 'once-only alert never fires twice');
    // Moving conditions use a real bar lookback; malformed inputs remain disabled.
    await chooseAlertOption(select, 'move-up-pct');
    const move = page.getByLabel('Move amount');
    assert(await move.inputValue() === '' && await create.isDisabled(), 'moving distance starts empty');
    await move.fill('1');
    const bars = page.getByLabel('Within number of bars');
    await bars.fill('501'); assert(await create.isDisabled(), 'invalid lookback is rejected instead of silently changed');
    await bars.fill('2'); await create.click();
    await tick(109);
    const moving = await page.evaluate(() => window.__ws.getState().priceAlerts.find((a) => a.condition === 'move-up-pct'));
    assert(moving?.bars === 2 && moving.state === 'fired' && moving.fires === 1, 'moving alert evaluates actual bar history', moving);
    // A pending draft remains bound to its old chart, even when live changes arrive.
    await chooseAlertOption(select, 'cross'); await value.fill('123.45');
    await page.evaluate(() => window.__ws.setActiveCell('b'));
    const change = await page.evaluate(() => ({ value: document.querySelector('.vela-ac-input').value, warning: document.querySelector('.vela-ac-warning').innerText, disabled: document.querySelector('.vela-ac-create').disabled }));
    assert(change.value === '123.45' && change.disabled && /BBB/.test(change.warning), 'chart change preserves and blocks the old draft', change);
    const beforeWrong = await page.evaluate(() => window.__ws.getState().priceAlerts.length);
    await create.evaluate((el) => el.click());
    assert((await page.evaluate(() => window.__ws.getState().priceAlerts.length)) === beforeWrong, 'a blocked click cannot arm a different chart');
    await page.getByRole('button', { name: 'Use active chart' }).click();
    assert((await page.locator('.vela-ac-target').innerText()).includes('BBB'), 'explicit rebind identifies the new chart');
    await create.click();
    assert((await page.evaluate(() => window.__ws.getState().priceAlerts.at(-1)?.cellId)) === 'b', 'new alert belongs to the explicitly chosen chart');
    // Symbol switch in the same cell invalidates the draft and old price cache.
    await page.evaluate(() => window.__ws.setActiveCell('a'));
    await page.getByRole('button', { name: 'Use active chart' }).click();
    await page.getByLabel('Alert level').fill('120');
    await page.evaluate(() => {
        // The deterministic provider shares its sample array with charts. Restore the
        // source array after synthetic live ticks so the incoming market is distinct.
        const bars = window.__ws.cell('a').chart.orchestrator.rawBars;
        bars.splice(0, bars.length, ...window.__originalOfflineBars);
        window.__ws.cell('a').setSymbol('ZZZ');
    });
    await page.waitForFunction(() => window.__ws.cell('a').symbol === 'ZZZ' && window.__ws.cell('a').chart.market.symbol === 'ZZZ' && !window.__ws.cell('a').chart.loading);
    const market = await page.evaluate(() => ({ warning: document.querySelector('.vela-ac-warning').innerText, disabled: document.querySelector('.vela-ac-create').disabled, rows: document.querySelector('.vela-ap-section').innerText }));
    assert(market.disabled && /ZZZ/.test(market.warning) && /Waiting for AAA/.test(market.rows), 'same-cell symbol switch blocks stale draft and labels off-chart alerts honestly', market);
    await page.getByRole('button', { name: 'Use active chart' }).click();
    const newPrice = await page.evaluate(() => ({ input: Number(document.querySelector('.vela-ac-input').value), latest: window.__ws.active.chart.lastBar.close }));
    assert(newPrice.input === newPrice.latest && newPrice.input !== 109, 'new market uses its own latest price, not the prior symbol cache', newPrice);
    // Real drawing-backed entry: a chart drawing emits the same event as its clock button.
    const drawing = await page.evaluate(() => {
        const chart = window.__ws.cell('b').chart, bar = chart.lastBar;
        const line = chart.drawings.add('hline', { anchors: [{ time: bar.time, price: 150 }] });
        chart.orchestrator.events.emit('drawing:alert-request', { id: line.id });
        return { id: line.id, time: bar.time };
    });
    assert((await page.evaluate(() => window.__ws.active.id)) === 'b', 'drawing entry activates its own chart');
    assert(await page.getByLabel('Alert level').isEditable() === false && Number(await page.getByLabel('Alert level').inputValue()) === 150, 'drawing-backed level is inherited and read-only');
    await page.evaluate(({ id, time }) => window.__ws.cell('b').chart.drawings.update(id, { anchors: [{ time, price: 155 }] }), drawing);
    assert(Number(await page.getByLabel('Alert level').inputValue()) === 155, 'draft follows an edited drawing');
    await create.click();
    const drawingAlert = await page.evaluate(() => window.__ws.getState().priceAlerts.find((a) => a.source?.drawingId));
    assert(drawingAlert?.cellId === 'b' && drawingAlert.source.drawingId === drawing.id && drawingAlert.value === 155, 'drawing source and real current level are saved', drawingAlert);
    await page.evaluate(() => window.__ws.swapCells('a', 'b')); await page.waitForTimeout(250);
    const swapped = await page.evaluate(() => ({ detail: document.querySelector('.vela-ac-target-detail').textContent,
        rows: [...document.querySelectorAll('.vela-ap-armed-row')].map((r) => r.innerText) }));
    assert(swapped.detail.includes('Chart 1') && swapped.rows.some((row) => row.includes('BBB ·') && row.includes('Chart 1'))
        && swapped.rows.some((row) => row.includes('AAA ·') && row.includes('Chart 2')),
    'swapping charts immediately renumbers the target and armed rows', swapped);
    await page.evaluate(() => window.__ws.swapCells('a', 'b')); await page.waitForTimeout(250);
    // Save / delete / restore the real workspace document, including drawing linkage.
    const saved = await page.evaluate(() => window.__ws.getState());
    const beforeSaved = saved.priceAlerts.length;
    await page.getByRole('tab', { name: /^Alerts/ }).click();
    await page.getByRole('button', { name: /^Delete alert/ }).first().click();
    await page.getByRole('button', { name: /^Confirm delete alert/ }).click();
    assert((await page.evaluate(() => window.__ws.getState().priceAlerts.length)) === beforeSaved - 1, 'confirmed delete removes a real price alert');
    await page.evaluate((state) => window.__ws.applyState(state), saved);
    const restored = await page.evaluate(() => window.__ws.getState().priceAlerts);
    assert(restored.length === beforeSaved && restored.some((a) => a.source?.drawingId === drawing.id), 'layout state restores price alerts and drawing source', restored);
    await page.evaluate(({ id }) => {
        const chart = window.__ws.cell('b').chart;
        chart.orchestrator.events.emit('drawing:alert-request', { id });
        chart.drawings.remove(id);
    }, drawing);
    const removedSource = await page.evaluate(() => ({ disabled: document.querySelector('.vela-ac-create').disabled,
        warning: document.querySelector('.vela-ac-warning').innerText, armed: document.querySelector('.vela-ap-section').innerText }));
    assert(removedSource.disabled && /drawing is no longer available/i.test(removedSource.warning) && /Waiting for drawing/.test(removedSource.armed), 'deleted drawing blocks creation and its armed alert is labelled waiting', removedSource);
    // Script-style chart event provenance and chart-specific clearing share the same log.
    await page.evaluate(() => window.__ws.cell('b').chart.orchestrator.events.emit('alert', { id: 'demo', indicator: 'RSI', title: 'Signal', message: 'Above threshold', time: Date.now() }));
    await page.getByRole('tab', { name: /^Log/ }).click();
    const logs = await page.locator('.vela-ap-log').innerText();
    assert(/BBB 1h RSI/.test(logs) && /Signal/.test(logs) && /Price alert/.test(logs), 'Log groups price and script events with fire-time provenance', logs);
    await page.getByRole('button', { name: 'Go to chart 1' }).click();
    assert((await page.evaluate(() => window.__ws.active.id)) === 'a' && await page.locator('.vela-ap').isVisible(), 'Go activates the chart without dismissing the pane');
    await page.getByRole('button', { name: 'Clear alerts for chart 1' }).click();
    const cleared = await page.evaluate(() => ({ log: window.__ws.alertEntries(), armed: window.__ws.getState().priceAlerts.length }));
    assert(cleared.log.length === 1 && cleared.log[0].cellId === 'b' && cleared.armed === beforeSaved, 'clearing one chart log leaves other logs and all armed alerts untouched', cleared);
    await page.mouse.move(1, 1); // leave the hoverable tooltip before the adjacent action
    await page.getByRole('button', { name: 'Clear every alert log entry' }).click();
    assert((await page.evaluate(() => window.__ws.alertEntries().length)) === 0 && (await page.evaluate(() => window.__ws.getState().priceAlerts.length)) === beforeSaved, 'Clear all affects the session log only');
    facts.creation = { initial, immediate: immediate.alerts[0], repeatFires: repeated.alert.fires, once: once.alert, moving, market, newPrice, drawingAlert, restored: restored.length };
    await context.close();
    // Replay and overlapping market requests must not expose future/stale prices.
    {
        const context2 = await browser.newContext({ viewport: { width: 1100, height: 760 } });
        const page2 = await context2.newPage();
        page2.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
        await page2.goto(OFFLINE); await page2.waitForFunction(() => window.__ws?.cells().length >= 4);
        await page2.evaluate(() => window.__ws.active.chart.ready());
        await page2.locator('.vela-widget-alerts').click();
        await chooseAlertOption(page2.locator('.vela-ac-select'), 'cross-down');
        await page2.getByLabel('Alert level').fill('120'); await page2.locator('.vela-ac-create').click();
        await chooseAlertOption(page2.locator('.vela-ac-select'), 'move-down');
        await page2.getByLabel('Move amount').fill('10'); await page2.getByLabel('Within number of bars').fill('1'); await page2.locator('.vela-ac-create').click();
        await page2.evaluate(() => window.__ws.openAlertCreate()); // pristine current-price draft
        const replay = await page2.evaluate(async () => {
            const ws = window.__ws, chart = ws.active.chart, all = chart.renderer.getBars().map((bar) => ({ ...bar })), future = all[all.length - 1].close;
            window.__replayAlertsTape = all;
            const line = chart.drawings.add('trendline', { anchors: [{ time: all[0].time, price: 100 }, { time: all[799].time, price: 200 }] });
            const expectedDrawing = 100 + 100 * (all[199].time - all[0].time) / (all[799].time - all[0].time);
            await chart.replay.start({ from: all[199].time });
            const shown = chart.renderer.getBars();
            const input = Number(document.querySelector('.vela-ac-input').value);
            chart.orchestrator.events.emit('drawing:alert-request', { id: line.id });
            return { shown: shown[shown.length - 1].close, future, input, drawing: Number(document.querySelector('.vela-ac-input').value), expectedDrawing };
        });
        assert(replay.input === replay.shown && replay.input !== replay.future, 'Create prefill during replay never reads an unrevealed future bar', replay);
        assert(Math.abs(replay.drawing - replay.expectedDrawing) < 1e-8, 'drawing-backed level uses the replay bar time, not the hidden future time', replay);
        const replaySteps = await page2.evaluate(async () => {
            const ws = window.__ws, chart = ws.active.chart, tape = window.__replayAlertsTape;
            chart.replay.step();
            const first = ws.getState().priceAlerts.map((a) => ({ condition: a.condition, state: a.state, fires: a.fires }));
            await chart.replay.start({ from: tape[500].time });
            await chart.replay.start({ from: tape[199].time });
            const cursor = chart.replay.state.cursorTime, times = ws.closeTimes.get(ws.active.id) ?? [];
            const newestHistoryTime = times[times.length - 1];
            chart.replay.step();
            return { first, afterSeek: ws.getState().priceAlerts.map((a) => ({ condition: a.condition, state: a.state, fires: a.fires })),
                newestHistoryTime, cursor, log: ws.alertEntries().length };
        });
        assert(replaySteps.first.every((a) => a.state === 'active' && a.fires === 0)
            && replaySteps.afterSeek.every((a) => a.state === 'active' && a.fires === 0)
            && replaySteps.newestHistoryTime <= replaySteps.cursor && replaySteps.log === 0,
        'replay entry and seeking rebase crossing anchors and moving lookbacks without firing on hidden future data', replaySteps);
        const midTick = await page2.evaluate(async () => {
            const ws = window.__ws, chart = ws.active.chart, tape = window.__replayAlertsTape;
            await chart.replay.start({ from: tape[199].time });
            chart.replay.setTicks(() => [{ price: 130 }, { price: 131 }]);
            chart.replay.stepUpdate();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const displayed = chart.lastBar.close;
            await chart.replay.start({ from: tape[199].time });
            chart.replay.setTicks(null);
            return { displayed, alerts: ws.getState().priceAlerts.map((a) => ({ state: a.state, fires: a.fires })), log: ws.alertEntries().length };
        });
        assert(midTick.displayed === 130 && midTick.alerts.every((a) => a.state === 'active' && a.fires === 0) && midTick.log === 0,
            'seeking mid-tick does not fire on the internally restored unseen full candle', midTick);
        await page2.evaluate(() => window.__ws.active.chart.replay.stop());
        await page2.evaluate(() => {
            const chart = window.__ws.active.chart, feed = chart.orchestrator.feed;
            feed.loadProgressive = undefined;
            window.__pendingAlertsMarkets = [];
            feed.load = (market) => new Promise((resolve) => window.__pendingAlertsMarkets.push({ symbol: market.symbol, resolve }));
            void chart.setMarket({ symbol: 'SLOW' });
        });
        await page2.waitForFunction(() => window.__pendingAlertsMarkets.some((p) => p.symbol === 'SLOW'));
        const slow = await page2.evaluate(() => ({ disabled: document.querySelector('.vela-ac-create').disabled, warning: document.querySelector('.vela-ac-warning').innerText }));
        const inFlightTick = await page2.evaluate(() => {
            const ws = window.__ws, c = ws.active.chart;
            // A feed can synchronously publish as it reconnects before the cell projects
            // the requested market. That print must not be judged as the old symbol.
            c.orchestrator.events.emit('bar', { time: 1800000000000, open: 100, high: 101, low: 99, close: 100, volume: 1 });
            return { alerts: ws.getState().priceAlerts.map((a) => ({ state: a.state, fires: a.fires })), log: ws.alertEntries().length };
        });
        assert(inFlightTick.alerts.every((a) => a.state === 'active' && a.fires === 0) && inFlightTick.log === 0,
            'an in-flight new-market print cannot fire old-symbol alerts', inFlightTick);
        await page2.evaluate(() => { void window.__ws.active.chart.setMarket({ symbol: 'FAST' }); });
        await page2.waitForFunction(() => window.__pendingAlertsMarkets.some((p) => p.symbol === 'FAST'));
        const fast = await page2.evaluate(() => ({ disabled: document.querySelector('.vela-ac-create').disabled, warning: document.querySelector('.vela-ac-warning').innerText }));
        assert(slow.disabled && fast.disabled, 'overlapping pending markets cannot create against the old price', { slow, fast });
        await page2.evaluate(() => window.__pendingAlertsMarkets.find((p) => p.symbol === 'FAST').resolve([{ time: 1701000000000, open: 241, high: 245, low: 240, close: 243.6, volume: 13 }]));
        await page2.waitForFunction(() => window.__ws.active.symbol === 'FAST' && !window.__ws.active.chart.loading);
        const changed = await page2.evaluate(() => ({ disabled: document.querySelector('.vela-ac-create').disabled, warning: document.querySelector('.vela-ac-warning').innerText }));
        assert(changed.disabled && /FAST/.test(changed.warning), 'completed market switch still requires explicit target review', changed);
        await page2.getByRole('button', { name: 'Use active chart' }).click();
        const winner = Number(await page2.getByLabel('Alert level').inputValue());
        await page2.evaluate(() => window.__pendingAlertsMarkets.find((p) => p.symbol === 'SLOW').resolve([{ time: 1700000000000, open: 1, high: 3, low: 1, close: 2, volume: 1 }]));
        await page2.waitForTimeout(250);
        const late = await page2.evaluate(() => ({ symbol: window.__ws.active.symbol, value: Number(document.querySelector('.vela-ac-input').value) }));
        assert(winner === 243.6 && late.symbol === 'FAST' && late.value === 243.6, 'late superseded market cannot corrupt the active alert target', { winner, late });
        facts.safety = { replay, replaySteps, midTick, slow, inFlightTick, fast, changed, winner, late };
        await context2.close();
    }
    // Pooled charts are not live but their alerts and owned drawings must survive save/restore.
    {
        const context3 = await browser.newContext({ viewport: { width: 1100, height: 760 } });
        const page3 = await context3.newPage(); page3.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
        await page3.goto(OFFLINE); await page3.waitForFunction(() => window.__ws?.cells().length >= 4);
        await page3.evaluate(async () => { await window.__ws.cell('b').chart.ready(); window.__ws.setActiveCell('b'); window.__ws.openAlertCreate(); });
        await page3.getByLabel('Alert level').fill('200'); await page3.locator('.vela-ac-create').click();
        await page3.getByLabel('Alert level').fill('201'); await page3.locator('.vela-ac-create').click();
        const sourceId = await page3.evaluate(() => {
            const c = window.__ws.cell('b').chart, line = c.drawings.add('hline', { anchors: [{ time: c.lastBar.time, price: 150 }] });
            c.orchestrator.events.emit('drawing:alert-request', { id: line.id });
            c.orchestrator.events.emit('alert', { id: 'orphan', indicator: 'RSI', title: 'Signal', message: 'from hidden chart', time: Date.now() });
            return line.id;
        });
        await page3.locator('.vela-ac-create').click();
        const pooled = await page3.evaluate(() => {
            const ws = window.__ws; ws.setActiveCell('a'); ws.setLayout('1');
            const state = ws.getState(); return { state, armedText: document.querySelector('.vela-ap-section').innerText };
        });
        assert(pooled.state.priceAlerts.length === 3 && /Waiting for chart/.test(pooled.armedText), 'pooled chart alerts remain armed but clearly wait for their chart', pooled.armedText);
        await page3.getByRole('tab', { name: /^Log/ }).click();
        const orphanLog = await page3.locator('.vela-ap-log').innerText();
        assert(/Chart b · not in layout/.test(orphanLog) && await page3.getByRole('button', { name: 'Go to chart 2' }).count() === 0, 'hidden-chart events stay readable without a false Go action', orphanLog);
        await page3.evaluate((state) => window.__ws.applyState(state), pooled.state);
        await page3.getByRole('tab', { name: /^Alerts/ }).click();
        const afterRestore = await page3.evaluate(() => window.__ws.getState().priceAlerts);
        assert(afterRestore?.length === 3 && afterRestore.some((a) => a.source?.drawingId === sourceId), 'restoring a smaller layout keeps hidden-chart price and drawing alerts', afterRestore);
        const delete201 = page3.getByRole('button', { name: 'Delete alert BBB · Crossing 201.00' });
        await delete201.click();
        await page3.getByRole('button', { name: 'Confirm delete alert BBB · Crossing 201.00' }).click();
        await page3.evaluate(async () => { window.__ws.setLayout('4'); await window.__ws.cell('b').chart.ready(); });
        const returned = await page3.evaluate(() => {
            const ws = window.__ws, c = ws.cell('b').chart, drawings = c.drawings.all();
            const lineAt = (price) => drawings.filter((d) => d.type === 'hline' && d.style?.lineStyle === 'dotted' && d.anchors?.[0]?.price === price).length;
            return { alerts: ws.getState().priceAlerts, sourceIds: drawings.map((d) => d.id),
                level200: lineAt(200), level201: lineAt(201), armedText: document.querySelector('.vela-ap-section').innerText };
        });
        assert(returned.alerts?.length === 2 && returned.sourceIds.includes(sourceId) && returned.level200 === 1 && returned.level201 === 0 && !/Waiting for chart/.test(returned.armedText),
            'returning chart reconnects the retained line/source and does not resurrect a deleted alert line', returned);
        await page3.evaluate(() => { const c = window.__ws.cell('b').chart, last = c.lastBar; c.orchestrator.applyBar({ time: last.time + 3600000, open: 200.5, high: 201, low: 200, close: 200.5, volume: 1 }); });
        const resumed = await page3.evaluate(() => window.__ws.getState().priceAlerts?.find((a) => a.value === 200));
        assert(resumed?.state === 'fired' && resumed.fires === 1, 'retained alert resumes on its own chart after it returns', resumed);
        const sharedLineId = await page3.evaluate(() => {
            const ws = window.__ws, c = ws.cell('b').chart; ws.setActiveCell('b');
            const line = c.drawings.all().find((d) => d.type === 'hline' && d.style?.lineStyle === 'dotted' && d.anchors?.[0]?.price === 200);
            c.orchestrator.events.emit('drawing:alert-request', { id: line.id }); return line.id;
        });
        await page3.locator('.vela-ac-create').click();
        const sharedState = await page3.evaluate(() => window.__ws.getState());
        await page3.evaluate((state) => window.__ws.applyState(state), sharedState);
        await page3.waitForTimeout(250);
        const sharedRestored = await page3.evaluate((id) => ({ exists: window.__ws.cell('b').chart.drawings.all().some((d) => d.id === id),
            linked: window.__ws.getState().priceAlerts.filter((a) => a.source?.drawingId === id).length,
            text: document.querySelector('.vela-ap-section').innerText }), sharedLineId);
        assert(sharedRestored.exists && sharedRestored.linked === 1 && !/Waiting for drawing/.test(sharedRestored.text),
            'restoring a price line also preserves another alert linked to that exact drawing ID', sharedRestored);
        await page3.getByRole('tab', { name: /^Alerts/ }).click();
        const triggeredPrice = page3.locator('.vela-ap-armed-row').filter({ hasText: 'BBB · Crossing 200.00' }).filter({ hasText: 'Triggered' });
        await triggeredPrice.getByRole('button', { name: /^Delete alert/ }).click();
        await triggeredPrice.getByRole('button', { name: /^Confirm delete alert/ }).click();
        await page3.waitForTimeout(250);
        const sharedAfterDelete = await page3.evaluate((id) => ({ exists: window.__ws.cell('b').chart.drawings.all().some((d) => d.id === id),
            linked: window.__ws.getState().priceAlerts.filter((a) => a.source?.drawingId === id).length,
            priceRow: window.__ws.getState().priceAlerts.some((a) => !a.source && a.value === 200) }), sharedLineId);
        assert(sharedAfterDelete.exists && sharedAfterDelete.linked === 1 && !sharedAfterDelete.priceRow, 'deleting a price alert keeps its line while another alert uses it as a source', sharedAfterDelete);
        const removedChart = await page3.evaluate(() => {
            const ws = window.__ws; ws.setActiveCell('a'); ws.setLayout('1'); ws.clearPooled();
            const state = ws.getState(), count = state.priceAlerts.length; ws.applyState(state);
            return { count, restored: ws.getState().priceAlerts?.length ?? 0, chartCount: state.charts.length };
        });
        await page3.waitForTimeout(250);
        removedChart.text = await page3.locator('.vela-ap-section').innerText();
        assert(removedChart.chartCount === 1 && removedChart.restored === removedChart.count && /Waiting for chart/.test(removedChart.text),
            'a removed chart leaves its alert manageable and marked waiting rather than discarding it on save/restore', removedChart);
        facts.pooled = { before: pooled.state.priceAlerts.length, afterRestore: afterRestore?.length ?? 0, returned, resumed, sharedRestored, sharedAfterDelete, removedChart, orphanLog };
        await context3.close();
    }
    assert(errors.length === 0, 'no browser page errors', errors);
    report('alerts-behavior', { engine, ...facts, errors });
} finally { await browser.close(); }
