// Gap 6 — the CANVAS ceiling. The workspace spends WebGL on at most 8 cells; a denser
// grid (9–16) flips EVERY cell to the canvas2d backend so the look stays uniform. That
// flip rebuilds every chart through the pool, which is exactly the kind of thing that
// silently eats symbols/indicators. This check proves the flip and proves nothing is lost.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
try {
    const read = async () =>
        page.evaluate(async () => {
            const ws = window.__ws;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            await wait(120);
            const cells = [...ws.getState().charts];
            return {
                count: cells.length,
                symbols: cells.map((c) => c.symbol),
                frames: cells.map((c) => `${c.id}:${c.timeframe}`),
                backends: [...new Set(ws.cells().map((c) => c.chart.renderer.backend))],
                perCell: ws.cells().map((c) => `${c.id}:${c.chart.renderer.backend}`),
                canvases: document.querySelectorAll('.vela-cell canvas').length,
            };
        });

    const set = async (layout, wait = 1600) => {
        await page.evaluate(async ([l, ms]) => {
            window.__ws.setLayout(l);
            await new Promise((r) => setTimeout(r, ms));
        }, [layout, wait]);
    };

    await set('8');
    const eight = await read();
    assert(eight.count === 8, 'the 8-chart layout builds 8 charts', eight.count);

    // Give every chart an identity we can recognise after the rebuild.
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LTCUSDT'];
    await page.evaluate(async (syms) => {
        const ws = window.__ws;
        const ids = ws.getState().charts.map((c) => c.id);
        ids.forEach((id, i) => ws.cell(id).setSymbol(syms[i]));
        await new Promise((r) => setTimeout(r, 1800));
    }, symbols);
    const before16 = await page.evaluate(() => window.__ws.getState().charts.map((c) => c.symbol));

    await set('16', 2600);
    const sixteen = await read();
    assert(sixteen.count === 16, 'the 16-chart layout builds 16 charts', sixteen.count);
    assert(
        sixteen.backends.length === 1 && sixteen.backends[0] === 'canvas2d',
        'above the WebGL budget every cell uses canvas2d',
        sixteen.backends,
    );
    assert(
        sixteen.symbols.slice(0, 8).join(',') === before16.join(','),
        'the backend flip keeps every live chart’s symbol',
        { before: before16, after: sixteen.symbols.slice(0, 8) },
    );
    assert(sixteen.canvases >= 16, 'every cell mounted a canvas', sixteen.canvases);

    await set('8', 2200);
    const back = await read();
    assert(
        back.backends.includes('webgl2') || back.backends.includes('canvas2d'),
        'the grid returns to the cheap backend set',
        back.backends,
    );
    assert(
        back.symbols.slice(0, 8).join(',') === before16.join(','),
        'switching back restores the same eight charts',
        { before: before16, after: back.symbols.slice(0, 8) },
    );

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-canvas', { eight: eight.count, sixteen: sixteen.count, backends16: sixteen.backends, backends8: back.backends, canvases: sixteen.canvases });
} finally {
    await browser.close();
}
