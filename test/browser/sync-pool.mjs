// Gap 7 — the POOL. A layout switch is not a reset: charts that fall out of a smaller
// grid keep their identity and come back exactly as they were; the housekeeping row
// that forgets them takes two clicks and can be undone. Only a real browser proves the
// round-trip through destroy/rebuild (jsdom has no renderer to rebuild).
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
try {
    const facts = await page.evaluate(async () => {
        const ws = window.__ws;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const rows = () => ws.getState().charts.map((c) => `${c.id}|${c.symbol}|${c.timeframe}`);

        ws.setLayout('4');
        await wait(600);
        const ids = ws.getState().charts.map((c) => c.id);
        const wanted = ['XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LTCUSDT'];
        const spans = ['5', '30', '120', 'D'];
        ids.forEach((id, i) => {
            ws.cell(id).setSymbol(wanted[i]);
            ws.cell(id).setTimeframe(spans[i]);
        });
        await wait(1600);
        const before = rows();

        ws.setLayout('1'); // three charts go dormant
        await wait(900);
        const shrunk = { live: ws.cells().length, hidden: ws.hiddenChartCount };
        ws.setLayout('4'); // …and come back
        await wait(1400);
        const after = rows();
        return { ids, before, shrunk, after };
    });

    assert(facts.before.length === 4, 'four charts boot', facts.before);
    assert(facts.shrunk.live === 1 && facts.shrunk.hidden === 3, 'shrinking pools the surplus charts', facts.shrunk);
    assert(
        facts.after.join(',') === facts.before.join(','),
        'every chart returns with its own symbol AND interval',
        { before: facts.before, after: facts.after },
    );

    // The housekeeping row: arm, commit, undo — each step visible in the DOM.
    const row = page.locator('[data-action="clear-hidden-charts"]');
    await page.evaluate(async () => {
        window.__ws.setLayout('1');
        await new Promise((r) => setTimeout(r, 700));
        document.querySelector('button[aria-label^="Layout —"]').click();
    });
    await row.waitFor({ timeout: 5000 });
    const label = (await row.textContent())?.trim();
    assert(label === 'Remove 3 hidden charts', 'the row states what it would drop', label);

    await row.click();
    const armed = {
        text: (await row.textContent())?.trim(),
        hidden: await page.evaluate(() => window.__ws.hiddenChartCount),
    };
    assert(armed.hidden === 3, 'the first click only arms the row', armed);
    assert(armed.text?.includes('confirm'), 'the armed row says what the second click does', armed.text);

    await row.click();
    const cleared = await page.evaluate(() => ({ hidden: window.__ws.hiddenChartCount, undo: window.__ws.clearedChartCount }));
    assert(cleared.hidden === 0 && cleared.undo === 3, 'the second click clears the pool', cleared);

    await page.evaluate(() => document.querySelector('[data-action="undo-hidden-charts"]').click());
    const undone = await page.evaluate(() => ({ hidden: window.__ws.hiddenChartCount, undo: window.__ws.clearedChartCount }));
    assert(undone.hidden === 3 && undone.undo === 0, 'Undo brings the batch back', undone);

    // The restored pool is real state, not a count: growing back restores the charts.
    const back = await page.evaluate(async () => {
        window.__ws.setLayout('4');
        await new Promise((r) => setTimeout(r, 1400));
        return window.__ws.getState().charts.map((c) => `${c.id}|${c.symbol}|${c.timeframe}`);
    });
    assert(back.join(',') === facts.before.join(','), 'the undo restores the same charts', { back, before: facts.before });

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-pool', { before: facts.before, shrunk: facts.shrunk, label, armed, cleared, undone });
} finally {
    await browser.close();
}
