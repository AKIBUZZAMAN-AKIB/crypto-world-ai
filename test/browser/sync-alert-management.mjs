import { chooseAlertOption } from './helpers.mjs';
// Real alert management, contrast and lifecycle against the existing offline workspace.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const open = async (viewport = { width: 1280, height: 820 }, touch = false) => {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => { if (!String(error).includes('ResizeObserver loop completed')) errors.push(String(error)); });
    await page.goto(OFFLINE);
    await page.waitForFunction(() => window.__ws?.cells().length >= 4);
    await page.evaluate(() => Promise.all(window.__ws.cells().map((cell) => cell.chart.ready())));
    await page.evaluate(() => window.__ws.openAlertCreate());
    return { context, page };
};
const create = async (page, condition, value, frequency = 'Once only') => {
    await page.getByRole('tab', { name: 'Create', exact: true }).click();
    const form = page.locator('.vela-ap-create-view');
    await chooseAlertOption(form.locator('.vela-ac-select'), condition);
    await form.getByLabel(condition.startsWith('move-') ? 'Move amount' : 'Alert level').fill(String(value));
    await form.getByRole('button', { name: frequency }).click();
    await form.locator('.vela-ac-create').click();
};
const alerts = async (page) => { await page.getByRole('tab', { name: /^Alerts/ }).click(); await page.waitForTimeout(220); };
const tick = async (page, cellId, close) => page.evaluate(({ cellId, close }) => {
    const chart = window.__ws.cell(cellId).chart, last = chart.lastBar;
    chart.orchestrator.applyBar({ time: last.time + 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 10 });
}, { cellId, close });
const contrast = (fg, bg) => {
    const channel = (n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const luminance = (color) => {
        const parts = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel);
        return .2126 * parts[0] + .7152 * parts[1] + .0722 * parts[2];
    };
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
try {
    // The real premium theme made both foreground and fill white. Check both states,
    // both themes, plus the normal non-premium tokens, rather than just inspecting CSS.
    {
        const { context, page } = await open({ width: 390, height: 780 }, true);
        const measurements = [];
        for (const premium of [true, false]) for (const theme of ['dark', 'light']) {
            await page.evaluate(({ premium, theme }) => { window.__ws.setTheme(theme); document.documentElement.classList.toggle('vela-premium', premium); }, { premium, theme });
            const form = page.locator('.vela-ap-create-view');
            await form.getByLabel('Alert level').fill('123');
            for (const disabled of [false, true]) {
                if (disabled) await form.getByLabel('Alert level').fill('');
                const state = await form.locator('.vela-ac-create').evaluate((el) => {
                    const style = getComputedStyle(el), icon = getComputedStyle(el.querySelector('.vela-icon'));
                    return { fg: style.color, bg: style.backgroundColor, icon: icon.backgroundColor, opacity: style.opacity, premium: document.documentElement.classList.contains('vela-premium'), disabled: el.disabled, text: el.textContent };
                });
                const ratio = contrast(state.fg, state.bg);
                assert(state.disabled === disabled && state.premium === premium && state.opacity === '1' && state.text.includes('Create alert') && state.icon === state.fg && ratio >= 4.5,
                    'Create text and icon remain readable in both enabled and disabled themes', { premium, theme, disabled, ratio, state });
                measurements.push({ premium, theme, disabled, ratio: Number(ratio.toFixed(2)), ...state });
            }
        }
        facts.contrast = measurements;
        await context.close();
    }
    // Pausing persists and suppresses ticks; resume/re-arm anchor to the current chart,
    // not to a price that crossed while the alert was stopped.
    {
        const { context, page } = await open();
        await tick(page, 'a', 90);
        await create(page, 'cross-up', 100);
        await alerts(page);
        const row = page.locator('.vela-ap-armed-row').filter({ hasText: 'AAA · Crossing up 100.00' });
        await row.getByRole('button', { name: /^Pause alert/ }).click();
        await tick(page, 'a', 110);
        const paused = await page.evaluate(() => ({ row: window.__ws.getState().priceAlerts[0], logs: window.__ws.alertEntries().length, state: window.__ws.getState() }));
        assert(paused.row.state === 'paused' && paused.row.fires === 0 && paused.logs === 0, 'paused crossings do not fire or enter Log', paused);
        await page.evaluate((state) => window.__ws.applyState(state), paused.state);
        await page.waitForTimeout(250);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts[0].state)) === 'paused', 'pause survives document restore');
        await page.getByRole('button', { name: /^Resume alert AAA/ }).click();
        await tick(page, 'a', 111);
        const afterResume = await page.evaluate(() => ({ row: window.__ws.getState().priceAlerts[0], logs: window.__ws.alertEntries().length }));
        assert(afterResume.row.state === 'active' && afterResume.row.fires === 0 && afterResume.logs === 0, 'resume does not replay a paused crossing', afterResume);
        await tick(page, 'a', 99); await tick(page, 'a', 101);
        const fired = await page.evaluate(() => ({ row: window.__ws.getState().priceAlerts[0], logs: window.__ws.alertEntries().length }));
        assert(fired.row.state === 'fired' && fired.row.fires === 1 && fired.logs === 1, 'a new crossing after resume fires once', fired);
        await page.waitForTimeout(250);
        await page.getByRole('button', { name: /^Re-arm alert AAA/ }).click();
        await tick(page, 'a', 102);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts[0].fires)) === 1, 're-arm does not invent a crossing already above the level');
        await tick(page, 'a', 99); await tick(page, 'a', 101);
        const rearmed = await page.evaluate(() => ({ row: window.__ws.getState().priceAlerts[0], logs: window.__ws.alertEntries().length }));
        assert(rearmed.row.state === 'fired' && rearmed.row.fires === 2 && rearmed.logs === 2, 're-armed alert fires on a later genuine crossing and retains history', rearmed);
        await chooseAlertOption(page.locator('.vela-ap-filter'), 'paused');
        assert((await page.locator('.vela-ap-section').innerText()).includes('No paused alerts'), 'status filter is real');
        await chooseAlertOption(page.locator('.vela-ap-filter'), 'fired');
        assert(await page.locator('.vela-ap-armed-row').count() === 1, 'Triggered filter contains the fired row');
        await page.getByRole('tab', { name: /^Log/ }).click();
        assert(await page.locator('.vela-ap-log-row').count() === 2, 'management does not erase existing log entries');
        facts.lifecycle = { paused: paused.row, afterResume, fired, rearmed };
        await context.close();
    }
    // Edit one of two shared price lines while a third alert follows that same drawing.
    // Also verify chart binding, an independent Create draft and source validation.
    {
        const { context, page } = await open();
        await tick(page, 'a', 90);
        await create(page, 'cross-up', 100);
        await create(page, 'cross-up', 100);
        const sharedId = await page.evaluate(() => {
            const chart = window.__ws.cell('a').chart;
            const line = chart.drawings.all().find((d) => d.type === 'hline' && d.style?.lineStyle === 'dotted' && d.anchors?.[0]?.price === 100);
            chart.orchestrator.events.emit('drawing:alert-request', { id: line.id });
            return line.id;
        });
        await page.locator('.vela-ap-create-view .vela-ac-create').click();
        await page.evaluate(() => window.__ws.openAlertCreate());
        await page.locator('.vela-ap-create-view').getByLabel('Alert level').fill('123.45');
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        await alerts(page);
        const originalId = await page.locator('.vela-ap-armed-row').last().getAttribute('data-alert');
        const original = page.locator(`.vela-ap-armed-row[data-alert="${originalId}"]`);
        await original.getByRole('button', { name: /^Edit alert/ }).click();
        assert((await page.evaluate(() => window.__ws.active.id)) === 'a', 'editing activates the original owner, not the previously active chart');
        const editor = page.locator('.vela-ap-editor');
        await editor.getByLabel('Alert level').fill('110');
        await editor.getByRole('button', { name: 'Every time' }).click();
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        const changedChart = { disabled: await editor.getByRole('button', { name: 'Save changes' }).isDisabled(), value: await editor.getByLabel('Alert level').inputValue(), warning: await editor.locator('.vela-ac-warning').innerText() };
        assert(changedChart.disabled && changedChart.value === '110' && /original chart/i.test(changedChart.warning), 'a chart change preserves and blocks the edit rather than retargeting', changedChart);
        await page.evaluate(() => window.__ws.setActiveCell('a'));
        await editor.getByRole('button', { name: 'Save changes' }).click();
        await page.waitForTimeout(250);
        const edited = await page.evaluate((id) => {
            const ws = window.__ws, drawings = ws.cell('a').chart.drawings.all();
            const levels = drawings.filter((d) => d.type === 'hline' && d.style?.lineStyle === 'dotted').map((d) => d.anchors?.[0]?.price);
            return { alerts: ws.getState().priceAlerts, levels, sharedExists: drawings.some((d) => d.id === id) };
        }, sharedId);
        assert(edited.alerts.length === 3 && edited.alerts.some((a) => a.value === 110 && a.frequency === 'each' && a.state === 'active')
            && edited.alerts.some((a) => a.source?.drawingId === sharedId) && edited.levels.filter((v) => v === 100).length === 1
            && edited.levels.filter((v) => v === 110).length === 1 && edited.sharedExists,
        'edit moves only its owned level; shared source and the other alert survive', edited);
        await page.getByRole('tab', { name: 'Create', exact: true }).click();
        assert((await page.locator('.vela-ap-create-view').getByLabel('Alert level').inputValue()) === '123.45', 'editing keeps the separate Create draft');
        await tick(page, 'a', 105);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts.find((a) => a.value === 110).fires)) === 0, 'old level no longer triggers the edited alert');
        await tick(page, 'a', 111);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts.find((a) => a.value === 110).fires)) === 1, 'edited level drives the real engine');
        await alerts(page);
        const sourceRow = page.locator('.vela-ap-armed-row').filter({ hasText: 'Drawing' }).filter({ hasText: '100.00' });
        await sourceRow.getByRole('button', { name: /^Edit alert/ }).click();
        assert(await editor.getByLabel('Alert level').isEditable() === false, 'drawing-backed edit remains bound to its source');
        await chooseAlertOption(editor.locator('.vela-ac-select'), 'cross-down');
        await editor.getByRole('button', { name: 'Every time' }).click();
        await editor.getByRole('button', { name: 'Save changes' }).click();
        const sourced = await page.evaluate((id) => window.__ws.getState().priceAlerts.find((a) => a.source?.drawingId === id), sharedId);
        assert(sourced?.condition === 'cross-down' && sourced.frequency === 'each' && sourced.state === 'fired' && sourced.fires === 1,
            'editing a drawing alert preserves source, stopped state and trigger history', sourced);
        // A newly created drawing vanishes while its editor is open: Save must block.
        const independent = await page.evaluate(() => {
            const chart = window.__ws.cell('a').chart, line = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: 150 }] });
            chart.orchestrator.events.emit('drawing:alert-request', { id: line.id }); return line.id;
        });
        await page.locator('.vela-ap-create-view .vela-ac-create').click();
        await alerts(page);
        const independentRow = page.locator('.vela-ap-armed-row').filter({ hasText: '150.00' }).filter({ hasText: 'Drawing' });
        await independentRow.getByRole('button', { name: /^Edit alert/ }).click();
        await page.evaluate((id) => window.__ws.cell('a').chart.drawings.remove(id), independent);
        const missingSource = { disabled: await editor.getByRole('button', { name: 'Save changes' }).isDisabled(), warning: await editor.locator('.vela-ac-warning').innerText(), rebindHidden: await editor.locator('.vela-ac-rebind').isHidden() };
        assert(missingSource.disabled && missingSource.rebindHidden && /drawing is no longer available/i.test(missingSource.warning), 'a deleted source cannot be silently replaced on edit', missingSource);
        await editor.getByRole('button', { name: 'Cancel editing alert' }).click();
        assert((await independentRow.innerText()).includes('Waiting for drawing'), 'missing drawing is labelled after cancelling edit');
        // Restoring a document invalidates runtime row IDs and closes any stale editor.
        const edit110 = page.locator('.vela-ap-armed-row').filter({ hasText: '110.00' });
        await edit110.getByRole('button', { name: /^Edit alert/ }).click();
        const oldId = await edit110.getAttribute('data-alert');
        await page.evaluate(() => { const ws = window.__ws; ws.applyState(ws.getState()); });
        await page.waitForTimeout(250);
        assert(await editor.isHidden() && (await page.locator(`.vela-ap-armed-row[data-alert="${oldId}"]`).count()) === 0,
            'restore invalidates the old editor and does not reuse its row ID');
        facts.edit = { sharedId, changedChart, edited, sourced, missingSource, staleId: oldId };
        await context.close();
    }
    // A user-created dotted line can coincide with a price alert. Editing or deleting
    // the alert must never mistake that drawing for a disposable alert-owned line.
    {
        const { context, page } = await open();
        const userLine = await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            return chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: 200 }], style: { lineStyle: 'dotted', lineWidth: 1 } }).id;
        });
        await create(page, 'cross', 200);
        const created = await page.evaluate((id) => ({ alert: window.__ws.getState().priceAlerts[0],
            lines: window.__ws.active.chart.drawings.all().filter((d) => d.type === 'hline' && d.anchors?.[0]?.price === 200).map((d) => d.id), userLine: id }), userLine);
        assert(created.lines.length === 2 && created.lines.includes(userLine) && created.alert.lineOwned === true && created.alert.lineId !== userLine,
            'a fresh alert owns its own line rather than adopting an unrelated user drawing', created);
        await page.evaluate(() => { const ws = window.__ws; ws.applyState(ws.getState()); });
        await alerts(page);
        await page.getByRole('button', { name: /^Edit alert/ }).click();
        await page.locator('.vela-ap-editor').getByLabel('Alert level').fill('220');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.waitForTimeout(220);
        const afterEdit = await page.evaluate((id) => ({ alert: window.__ws.getState().priceAlerts[0],
            lines: window.__ws.active.chart.drawings.all().map((d) => ({ id: d.id, price: d.anchors?.[0]?.price })), userLine: id }), userLine);
        assert(afterEdit.lines.some((line) => line.id === userLine && line.price === 200)
            && !afterEdit.lines.some((line) => line.id === created.alert.lineId) && afterEdit.alert.value === 220 && afterEdit.alert.lineOwned === true,
        'edit after restore replaces only the alert-owned line', afterEdit);
        await page.getByRole('button', { name: /^Delete alert/ }).click();
        await page.getByRole('button', { name: /^Confirm delete alert/ }).click();
        const afterDelete = await page.evaluate((id) => ({ user: window.__ws.active.chart.drawings.all().some((d) => d.id === id),
            alerts: window.__ws.getState().priceAlerts?.length ?? 0 }), userLine);
        assert(afterDelete.user && afterDelete.alerts === 0, 'confirmed deletion also preserves the unrelated drawing', afterDelete);
        // Pre-upgrade documents did not record ownership. Their price-matched line is
        // conservatively unowned, and remains untouched if the legacy alert is deleted.
        await page.evaluate(() => {
            const ws = window.__ws, state = ws.getState();
            state.priceAlerts = [{ cellId: 'a', symbol: 'AAA', condition: 'cross', value: 200, frequency: 'once', bars: 5, state: 'active', createdAt: Date.now(), fires: 0 }];
            ws.applyState(state);
        });
        await page.waitForTimeout(220);
        const legacy = await page.evaluate(() => window.__ws.getState().priceAlerts[0]);
        assert(legacy.lineId === userLine && legacy.lineOwned === false, 'legacy level matching never claims ownership', legacy);
        await page.getByRole('button', { name: /^Delete alert/ }).click();
        await page.getByRole('button', { name: /^Confirm delete alert/ }).click();
        assert(await page.evaluate((id) => window.__ws.active.chart.drawings.all().some((d) => d.id === id), userLine), 'deleting a legacy matched alert cannot delete the user line');
        facts.userDrawing = { created, afterEdit, afterDelete, legacy };
        await context.close();
    }
    // A hidden/pooled chart can be paused or re-armed without watching another chart.
    {
        const { context, page } = await open();
        await page.evaluate(() => { window.__ws.setActiveCell('b'); window.__ws.openAlertCreate(); });
        await create(page, 'cross-up', 200);
        await page.evaluate(() => { window.__ws.setActiveCell('a'); window.__ws.setLayout('1'); });
        await alerts(page);
        const row = page.locator('.vela-ap-armed-row').filter({ hasText: 'BBB · Crossing up 200.00' });
        assert((await row.innerText()).includes('Waiting for chart') && await row.getByRole('button', { name: /^Edit alert/ }).isDisabled(), 'pooled row is manageable but cannot be edited on a different chart');
        await row.getByRole('button', { name: /^Pause alert/ }).click();
        const pooledState = await page.evaluate(() => window.__ws.getState());
        await page.evaluate((state) => window.__ws.applyState(state), pooledState);
        await page.waitForTimeout(250);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts[0].state)) === 'paused', 'pooled pause survives save/restore');
        await page.getByRole('button', { name: /^Resume alert BBB/ }).click();
        assert((await page.locator('.vela-ap-armed-row').innerText()).includes('Waiting for chart'), 'resume stays waiting for its own chart');
        await page.evaluate(async () => { window.__ws.setLayout('4'); await window.__ws.cell('b').chart.ready(); });
        await page.waitForTimeout(250);
        const ready = await page.evaluate(() => window.__ws.getState().priceAlerts[0]);
        assert(ready.state === 'active' && ready.fires === 0, 'pooled re-arm survives the chart returning without a phantom fire', ready);
        facts.pooled = { paused: pooledState.priceAlerts[0], ready };
        await context.close();
    }
    // If a drawing disappears while prices move, restoring it must not report a
    // crossing from the unobservable interval. Undo restores the same drawing ID.
    {
        const { context, page } = await open();
        await tick(page, 'a', 140);
        const source = await page.evaluate(() => {
            const chart = window.__ws.active.chart, line = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: 150 }] });
            chart.orchestrator.events.emit('drawing:alert-request', { id: line.id }); return line.id;
        });
        await chooseAlertOption(page.locator('.vela-ap-create-view .vela-ac-select'), 'cross-up');
        await page.locator('.vela-ap-create-view .vela-ac-create').click();
        await alerts(page);
        await page.evaluate((id) => window.__ws.active.chart.drawings.remove(id), source);
        await page.getByRole('button', { name: /^Pause alert/ }).click();
        await tick(page, 'a', 160);
        await page.waitForTimeout(220);
        await page.getByRole('button', { name: /^Resume alert/ }).click();
        await page.evaluate(() => window.__ws.active.chart.drawings.undo());
        await tick(page, 'a', 161);
        const restored = await page.evaluate((id) => ({ exists: window.__ws.active.chart.drawings.all().some((d) => d.id === id), alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries().length }), source);
        assert(restored.exists && restored.alert.state === 'active' && restored.alert.fires === 0 && restored.log === 0,
            'resuming while a source is absent does not replay a crossing when Undo restores it', restored);
        await tick(page, 'a', 140); await tick(page, 'a', 160);
        const crossed = await page.evaluate(() => ({ alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries().length }));
        assert(crossed.alert.state === 'fired' && crossed.alert.fires === 1 && crossed.log === 1, 'the restored source still catches a later real crossing', crossed);
        facts.sourceReturn = { restored, crossed };
        await context.close();
    }
    // Resume and edit against the visible replay candle (not an unrevealed live price),
    // including a partially formed tick and a later replay seek/re-arm.
    {
        const { context, page } = await open();
        const start = await page.evaluate(async () => {
            const chart = window.__ws.active.chart, bars = chart.renderer.getBars().map((bar) => ({ ...bar }));
            window.__managementReplayBars = bars;
            await chart.replay.start({ from: bars[199].time });
            const shown = chart.renderer.getBars().at(-1).close;
            chart.replay.setTicks(() => [{ price: shown + .5 }, { price: shown + 2 }, { price: shown + 2.5 }]);
            window.__ws.openAlertCreate();
            return { shown, future: bars.at(-1).close };
        });
        await create(page, 'cross-up', start.shown + 1);
        await alerts(page);
        await page.getByRole('button', { name: /^Pause alert/ }).click();
        const partial = await page.evaluate(async () => {
            const chart = window.__ws.active.chart; chart.replay.stepUpdate();
            await new Promise((resolve) => setTimeout(resolve, 60));
            return { shown: chart.renderer.getBars().at(-1).close, alert: window.__ws.getState().priceAlerts[0] };
        });
        await page.waitForTimeout(220);
        await page.getByRole('button', { name: /^Edit alert/ }).click();
        const editor = page.locator('.vela-ap-editor');
        await editor.getByLabel('Alert level').fill(String(start.shown + 1.25));
        await editor.getByRole('button', { name: 'Save changes' }).click();
        await page.waitForTimeout(220);
        assert((await page.evaluate(() => window.__ws.getState().priceAlerts[0].state)) === 'paused', 'editing a paused replay alert leaves it paused');
        await page.getByRole('button', { name: /^Resume alert/ }).click();
        const triggered = await page.evaluate(async () => {
            const chart = window.__ws.active.chart; chart.replay.stepUpdate();
            await new Promise((resolve) => setTimeout(resolve, 60));
            return { shown: chart.renderer.getBars().at(-1).close, alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries().length };
        });
        assert(start.shown !== start.future && partial.shown === start.shown + .5 && partial.alert.fires === 0
            && triggered.alert.value === start.shown + 1.25 && triggered.alert.state === 'fired' && triggered.alert.fires === 1 && triggered.log === 1,
        'edited alert resumes from a partial replay tick and fires only on a visible later tick', { start, partial, triggered });
        const seek = await page.evaluate(async () => {
            const chart = window.__ws.active.chart, bars = window.__managementReplayBars;
            await chart.replay.start({ from: bars[500].time });
            await chart.replay.start({ from: bars[199].time });
            const shown = chart.renderer.getBars().at(-1).close;
            chart.replay.setTicks(() => [{ price: shown + 2 }, { price: shown + 2.5 }]);
            return { shown, alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries().length };
        });
        assert(seek.alert.fires === 1 && seek.log === 1, 'replay seeks never invent a trigger', seek);
        await page.waitForTimeout(220);
        await page.getByRole('button', { name: /^Re-arm alert/ }).click();
        const again = await page.evaluate(async () => {
            const chart = window.__ws.active.chart; chart.replay.stepUpdate();
            await new Promise((resolve) => setTimeout(resolve, 60));
            return { alert: window.__ws.getState().priceAlerts[0], log: window.__ws.alertEntries().length };
        });
        assert(again.alert.fires === 2 && again.log === 2, 're-arm after seeking uses the revealed replay price', again);
        facts.replay = { start, partial, triggered, seek, again };
        await context.close();
    }
    // Verify a market request disables an open editor before an in-flight tick lands.
    {
        const { context, page } = await open();
        await create(page, 'cross-up', 160);
        await alerts(page);
        await page.getByRole('button', { name: /^Edit alert AAA/ }).click();
        const editor = page.locator('.vela-ap-editor');
        await editor.getByLabel('Alert level').fill('170');
        await page.evaluate(() => {
            const chart = window.__ws.active.chart, feed = chart.orchestrator.feed;
            feed.loadProgressive = undefined;
            window.__pendingEditMarkets = [];
            feed.load = (market) => new Promise((resolve) => window.__pendingEditMarkets.push({ symbol: market.symbol, resolve }));
            void chart.setMarket({ symbol: 'SLOW' });
        });
        await page.waitForFunction(() => window.__pendingEditMarkets.some((p) => p.symbol === 'SLOW'));
        const loading = { disabled: await editor.getByRole('button', { name: 'Save changes' }).isDisabled(), value: await editor.getByLabel('Alert level').inputValue(), warning: await editor.locator('.vela-ac-warning').innerText() };
        await page.evaluate(() => window.__ws.active.chart.orchestrator.events.emit('bar', { time: 1800000000000, open: 200, high: 201, low: 199, close: 200, volume: 1 }));
        assert(loading.disabled && loading.value === '170' && /load/i.test(loading.warning) && (await page.evaluate(() => window.__ws.getState().priceAlerts[0].fires)) === 0,
            'in-flight market request blocks Save and cannot trigger the old-symbol alert', loading);
        await page.evaluate(() => window.__pendingEditMarkets.find((p) => p.symbol === 'SLOW').resolve([{ time: 1701000000000, open: 241, high: 245, low: 240, close: 243.6, volume: 13 }]));
        await page.waitForFunction(() => window.__ws.active.symbol === 'SLOW' && !window.__ws.active.chart.loading);
        assert(await editor.getByRole('button', { name: 'Save changes' }).isDisabled(), 'completed market switch still cannot retarget an existing alert');
        facts.marketRace = loading;
        await context.close();
    }
    // CDP dispatches a real touch stream for the momentum-only scenario; WebKit runs
    // the remaining management tests and the dedicated phone touch/menu suite.
    if (engine === 'chromium') {
        const { context, page } = await open({ width: 390, height: 780 }, true);
        await page.evaluate(() => {
            const ws = window.__ws, state = ws.getState();
            state.priceAlerts = Array.from({ length: 24 }, (_, i) => ({ cellId: 'a', symbol: 'AAA', condition: 'cross-up', value: 150 + i,
                frequency: 'once', bars: 5, state: 'active', createdAt: Date.now() + i, fires: 0 }));
            ws.applyState(state);
        });
        await alerts(page);
        const view = page.locator('.vela-ap-alerts-view'), bounds = await view.boundingBox();
        const x = bounds.x + bounds.width * .72, y = bounds.y + bounds.height * .82;
        await view.evaluate((el) => { window.__heldAlertRow = el.querySelector('.vela-ap-armed-row'); });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 90 * i / 8 }] });
            await page.waitForTimeout(10);
        }
        await tick(page, 'a', 200);
        const held = await view.evaluate((el) => ({ same: el.querySelector('.vela-ap-armed-row') === window.__heldAlertRow, top: el.scrollTop,
            firedRows: [...el.querySelectorAll('.vela-ap-meta')].filter((row) => row.textContent.includes('Triggered')).length }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(700);
        const settled = await view.evaluate((el) => ({ same: el.querySelector('.vela-ap-armed-row') === window.__heldAlertRow, top: el.scrollTop,
            firedRows: [...el.querySelectorAll('.vela-ap-meta')].filter((row) => row.textContent.includes('Triggered')).length }));
        assert(held.same && held.firedRows === 0 && !settled.same && settled.firedRows === 24 && settled.top >= held.top,
            'management list waits through touch release/momentum before painting real fired states', { held, settled });
        await cdp.detach();
        facts.scroll = { held, settled };
        await context.close();
    }
    // At small and wide touch sizes every row action stays inside the pane, wraps if
    // necessary, and has a 44px touch height. The real pane keeps its internal scroll.
    {
        const sizes = [];
        for (const [width, height] of [[240, 320], [390, 780], [568, 320], [844, 390]]) {
            const { context, page } = await open({ width, height }, true);
            await create(page, 'cross', 200);
            await alerts(page);
            const geometry = await page.evaluate(() => {
                const panel = document.querySelector('.vela-ap').getBoundingClientRect(), view = document.querySelector('.vela-ap-alerts-view');
                const row = document.querySelector('.vela-ap-armed-row');
                return { panel: { left: panel.left, right: panel.right }, scroll: [view.clientHeight, view.scrollHeight],
                    actions: [...row.querySelectorAll('button')].map((button) => { const r = button.getBoundingClientRect(); return { name: button.textContent.trim(), left: r.left, right: r.right, height: r.height }; }) };
            });
            assert(geometry.actions.length === 4 && geometry.actions.every((action) => action.left >= geometry.panel.left - .5 && action.right <= geometry.panel.right + .5 && action.height >= 44),
                'touch management actions stay in-bounds with adequate hit targets', { width, height, geometry });
            sizes.push({ width, height, ...geometry });
            await context.close();
        }
        facts.touch = sizes;
    }
    assert(errors.length === 0, 'no browser page errors', errors);
    report('alerts-management', { engine, realTouchMomentum: engine === 'chromium', ...facts, errors });
} finally { await browser.close(); }
