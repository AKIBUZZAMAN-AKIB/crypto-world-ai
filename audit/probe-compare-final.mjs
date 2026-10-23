import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2000);
const out = {};
for (const mode of ['same-percent', 'own-scale', 'new-pane']) {
  out[mode] = await p.evaluate(async (m) => {
    const ws = window.__ws;
    ws.setCompareSymbol('offline:BBB');
    await new Promise((r) => setTimeout(r, 1200));
    ws.setCompareDisplay(m);
    await new Promise((r) => setTimeout(r, 1400));
    const chart = ws.active.chart;
    const mine = chart.inspect().indicators.find((i) => i.nativeType === 'compare');
    const native = Object.values(chart.renderer).find((v) => v && typeof v === 'object' && v.scene && v.scene.indicators);
    const model = [...native.scene.indicators.values()].find((x) => x.native?.type === 'compare');
    const vals = model.series[0].points.filter((x) => x.value != null).length;
    return { pane: mine.paneId, ownScale: mine.paneId === 'price' ? chart.panes.list()[0].indicators.find((i) => i.id === mine.id)?.ownScale : null, scaleMode: chart.renderer.get('scaleMode'), plotted: vals, panes: chart.panes.list().length };
  }, mode);
  await p.screenshot({ path: `shots/8${Object.keys(out).indexOf(mode)}-compare-${mode}.png`, clip: { x: 0, y: 0, width: 600, height: 420 } });
}
console.log(JSON.stringify({ out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
