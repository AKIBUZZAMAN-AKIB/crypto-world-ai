// Composite undo/redo in the real browser: visual order, chart settings, indicator
// inputs, layout-management preferences and Object Tree groups all belong to ONE
// timeline. No screenshots are written; state is measured from the live APIs.
import { open, assert, report } from './helpers.mjs';

const { page, errors, browser } = await open({ settle: 1800 });
const settle = () => page.waitForTimeout(260);

await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Object tree'));
    if (!document.querySelector('.vela-ot-row')) button?.click();
});
await page.waitForTimeout(300);

const state = (fn, arg) => page.evaluate(fn, arg);
const undo = async () => {
    await page.evaluate(() => window.__ws.undo());
    await settle();
};
const redo = async () => {
    await page.evaluate(() => window.__ws.redo());
    await settle();
};

// 1 — Visual order from the object tree: one menu action = one history step.
const candleBefore = await state(() => window.__ws.active.chart.renderer.getConfig().stacking.candles);
const pricePoint = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.vela-ot-row')].find((r) => r.dataset.rowKind === 'price');
    const b = row.getBoundingClientRect();
    return { x: b.x + 70, y: b.y + b.height / 2 };
});
await page.mouse.click(pricePoint.x, pricePoint.y, { button: 'right' });
await page.waitForTimeout(220);
await page.locator('.vela-menu-item:visible', { hasText: /^Send to back$/ }).first().click();
await settle();
const candleAfter = await state(() => window.__ws.active.chart.renderer.getConfig().stacking.candles);
assert(candleAfter !== candleBefore, 'the visual-order action changes the candle z key', { candleBefore, candleAfter });
await undo();
const candleUndo = await state(() => window.__ws.active.chart.renderer.getConfig().stacking.candles);
assert(candleUndo === candleBefore, 'one undo restores the candle z key', { candleBefore, candleUndo });
await redo();
const candleRedo = await state(() => window.__ws.active.chart.renderer.getConfig().stacking.candles);
assert(candleRedo === candleAfter, 'redo re-applies the visual order', { candleAfter, candleRedo });
await undo(); // leave the original stack for the following checks

// 2 — Chart settings (config edits) are chart changes, not silent preferences.
await page.evaluate(() => window.__ws.active.chart.renderer.applyConfig({ grid: { vertLines: { visible: false } } }));
await settle();
const gridChanged = await state(() => window.__ws.active.chart.renderer.getConfig().grid.vertLines.visible);
assert(gridChanged === false, 'the config edit landed', gridChanged);
await undo();
const gridUndo = await state(() => window.__ws.active.chart.renderer.getConfig().grid.vertLines.visible);
assert(gridUndo === true, 'undo restores the grid setting', gridUndo);
await redo();
const gridRedo = await state(() => window.__ws.active.chart.renderer.getConfig().grid.vertLines.visible);
assert(gridRedo === false, 'redo restores the edited grid setting', gridRedo);
await undo();

// 3 — Indicator inputs: undo brings back the exact value, not a default instance.
await page.evaluate(async () => {
    window.__ws.active.chart.addNativeIndicator('sma');
    await new Promise((r) => setTimeout(r, 700));
});
await settle();
const inputBefore = await state(() => {
    const h = window.__ws.active.chart.indicators().find((x) => x.nativeType === 'sma');
    const input = h?.inputs.find((i) => i.type === 'int');
    const key = input?.key;
    return { id: h?.id, key, value: key ? h.inputValues()[key] : null };
});
assert(inputBefore.id && inputBefore.key, 'an SMA with an editable input is mounted', inputBefore);
await page.evaluate(({ id, key, value }) => {
    const h = window.__ws.active.chart.indicators().find((x) => x.id === id);
    h?.setInputs({ [key]: Number(value) + 1 });
}, inputBefore);
await settle();
const inputAfter = await state(({ id, key }) => {
    const h = window.__ws.active.chart.indicators().find((x) => x.id === id);
    return key && h ? h.inputValues()[key] : null;
}, inputBefore);
assert(inputAfter === Number(inputBefore.value) + 1, 'the indicator input changed', { inputBefore, inputAfter });
await undo();
const inputUndo = await state(({ key }) => {
    const h = window.__ws.active.chart.indicators().find((x) => x.nativeType === 'sma');
    return key && h ? h.inputValues()[key] : null;
}, inputBefore);
assert(inputUndo === inputBefore.value, 'undo restores the indicator input', { inputBefore, inputUndo });
await redo();
const inputRedo = await state(({ key }) => {
    const h = window.__ws.active.chart.indicators().find((x) => x.nativeType === 'sma');
    return key && h ? h.inputValues()[key] : null;
}, inputBefore);
assert(inputRedo === inputAfter, 'redo re-applies the indicator input', { inputAfter, inputRedo });
await undo();

// 4 — Layout management preference (not a chart object at all).
await page.evaluate(() => window.__ws.setLayoutSharing(true));
await settle();
const sharingOn = await state(() => window.__ws.getState().layoutPrefs?.sharing === true);
assert(sharingOn, 'sharing is on', sharingOn);
await undo();
const sharingUndo = await state(() => window.__ws.getState().layoutPrefs?.sharing === true);
assert(sharingUndo === false, 'undo turns sharing back off', sharingUndo);
await redo();
const sharingRedo = await state(() => window.__ws.getState().layoutPrefs?.sharing === true);
assert(sharingRedo, 'redo turns sharing back on', sharingRedo);
await undo();

// 5 — Object Tree groups/folders are chart content and round-trip through history.
await page.evaluate(() => {
    const c = window.__ws.active.chart;
    const r = c.getVisibleRange();
    const price = c.lastBar.close;
    c.drawings.add('hline', { anchors: [{ time: r.from + (r.to - r.from) * 0.3, price }] });
    c.drawings.add('hline', { anchors: [{ time: r.from + (r.to - r.from) * 0.6, price }] });
});
await settle();
const points = await page.evaluate(() =>
    [...document.querySelectorAll('.vela-ot-row[data-row-kind="drawing"]')]
        .slice(0, 2)
        .map((r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x + 70, y: b.y + b.height / 2 };
        }),
);
assert(points.length === 2, 'two drawing rows exist for grouping', points);
await page.mouse.click(points[0].x, points[0].y);
await page.keyboard.down('Control');
await page.mouse.click(points[1].x, points[1].y);
await page.keyboard.up('Control');
await page.waitForTimeout(200);
await page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label="Group selection"]')].find((x) => x.offsetParent !== null);
    b?.click();
});
await settle();
const groupsAfter = await state(() => window.__ws.getState().charts[0]?.objectTreeGroups?.length ?? 0);
assert(groupsAfter === 1, 'the group is captured in workspace state', groupsAfter);
await undo();
const groupsUndo = await state(() => window.__ws.getState().charts[0]?.objectTreeGroups?.length ?? 0);
assert(groupsUndo === 0, 'undo removes the group', groupsUndo);
await redo();
const groupsRedo = await state(() => window.__ws.getState().charts[0]?.objectTreeGroups?.length ?? 0);
assert(groupsRedo === 1, 'redo restores the group', groupsRedo);

assert(errors.length === 0, 'no page errors during composite undo/redo', errors.slice(0, 3));
await browser.close();
report('unified-history', {
    visualOrder: { before: candleBefore, after: candleAfter, undo: candleUndo, redo: candleRedo },
    grid: { changed: gridChanged, undo: gridUndo, redo: gridRedo },
    indicatorInput: { before: inputBefore, after: inputAfter, undo: inputUndo, redo: inputRedo },
    sharing: { on: sharingOn, undo: sharingUndo, redo: sharingRedo },
    groups: { after: groupsAfter, undo: groupsUndo, redo: groupsRedo },
});
