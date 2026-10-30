// Template application must never silently strand drawings in removed study panes.
import { open, assert, report, OFFLINE } from './helpers.mjs';
const { browser, page, errors } = await open({ base: OFFLINE, settle: 1000 });
try {
    const setup = await page.evaluate(async () => {
        const ws = window.__ws, a = ws.cell('a').chart, b = ws.cell('b').chart;
        ws.saveTemplate('Base indicators');
        const rsi = a.addNativeIndicator('rsi'); b.addNativeIndicator('rsi');
        await new Promise((resolve) => setTimeout(resolve, 600));
        const pane = a.panes.list().find((p) => p.indicators.some((i) => i.id === rsi.id)).id;
        const range = a.getVisibleRange();
        const drawing = a.drawings.add('box', { paneId: pane, anchors: [{ time: range.from, price: 40 }, { time: range.to, price: 60 }] });
        const before = { pane, drawing: drawing.id, indicators: a.indicators().map((h) => h.id) };
        const applied = ws.applyTemplate('Base indicators', 'all');
        return { before, applied, a: { indicators: a.indicators().map((h) => h.id), panes: a.panes.list().map((p) => p.id), drawings: a.drawings.all().map((d) => ({ id: d.id, paneId: d.paneId })) }, b: b.indicators().map((h) => h.nativeType) };
    });
    assert(setup.applied === 3 && JSON.stringify(setup.a.indicators) === JSON.stringify(setup.before.indicators) && setup.a.panes.includes(setup.before.pane) && setup.a.drawings[0].paneId === setup.before.pane && !setup.b.includes('rsi'), 'unsafe target is skipped while other charts apply safely', setup);
    const result = await page.evaluate(({ before }) => {
        const ws = window.__ws, a = ws.cell('a').chart;
        const blockedBuiltin = ws.applyBuiltinTemplate('displaced-ema');
        const retainedBuiltin = ws.applyBuiltinTemplate('oscillators'); // retains the RSI owning this pane
        const retained = a.panes.list().some((p) => p.id === before.pane) && a.drawings.all().some((d) => d.id === before.drawing && d.paneId === before.pane);
        a.drawings.update(before.drawing, { paneId: 'price' });
        const afterMove = ws.applyTemplate('Base indicators');
        return { blockedBuiltin, retainedBuiltin, retained, afterMove, drawing: a.drawings.all().find((d) => d.id === before.drawing)?.paneId };
    }, setup);
    assert(result.blockedBuiltin === 0 && result.retainedBuiltin === 1 && result.retained && result.afterMove === 1 && result.drawing === 'price', 'built-ins use the same guard; a retained pane or moved drawing permits application', result);
    assert(errors.length === 0, 'no browser errors', errors);
    report('indicator-template-safety', { setup, result });
} finally { await browser.close(); }
