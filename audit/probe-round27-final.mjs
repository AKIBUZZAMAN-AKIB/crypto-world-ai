// Round-27 acceptance sweep: the three Compare displays + a Moving alert armed, restored,
// and listed. Screenshots land in shots/92-94. Run against the local playground.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1180, height: 860 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
const modes = {};
for (const mode of ['percent', 'own', 'pane']) {
  modes[mode] = await p.evaluate(async (m) => {
    const cell = window.__ws.cells()[0];
    cell.chart.compare?.setSymbol?.('ETHUSDT');
    await new Promise((r) => setTimeout(r, 300));
    cell.chart.compare?.setDisplay?.(m);
    await new Promise((r) => setTimeout(r, 700));
    const study = Object.values(cell.chart.renderer).find((v) => v.scene?.indicators)?.scene?.indicators;
    const inst = study?.[0]?.instance;
    const line = Object.values(inst?.scene ?? {}).find((v) => v?.points);
    return { pane: study?.[0]?.pane, pts: line?.points?.filter((pt) => pt && Number.isFinite(pt.value)).length ?? 0 };
  }, mode);
  await p.screenshot({ path: `shots/9${2 + Object.keys(modes).length}-compare-${mode}.png` });
}
const alert = await p.evaluate(async () => {
  const ws = window.__ws;
  ws.openAlertCreate();
  await new Promise((r) => setTimeout(r, 400));
  [...document.querySelectorAll('.vela-ac-opt')].find((o) => o.textContent === 'Moving up %')?.click();
  const input = document.querySelectorAll('.vela-ac-value input')[0];
  input.value = '0.4';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.vela-ac-create').click();
  await new Promise((r) => setTimeout(r, 800));
  const created = ws.getState().priceAlerts;
  const lines = ws.cells()[0].chart.drawings.all().map((d) => d.anchors?.[0]?.price);
  return { created, lines };
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
const restored = await p.evaluate(async () => {
  const ws = window.__ws;
  document.querySelector('button[aria-label*=lert]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  return {
    state: ws.getState().priceAlerts?.map((a) => `${a.condition} ${a.value} in ${a.bars} bars (${a.state})`),
    rows: [...document.querySelectorAll('.vela-al-row')].map((r) => r.textContent),
    lines: ws.cells()[0].chart.drawings.all().map((d) => d.anchors?.[0]?.price),
  };
});
await p.screenshot({ path: 'shots/95-alert-restored.png' });
console.log(JSON.stringify({ modes, alert, restored, errors: errors.slice(0, 3) }, null, 1));
await b.close();
