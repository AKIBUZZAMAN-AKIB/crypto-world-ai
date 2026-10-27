import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());
// apply a light theme through the public config path
const applied = await p.evaluate(async () => {
  const ws = window.__ws;
  const cell = ws.cells()[0];
  try {
    ws.setTheme('light');
  } catch (e) { return { err: String(e).slice(0, 80) }; }
  await new Promise((r) => setTimeout(r, 1200));
  const bg = getComputedStyle(document.body).backgroundColor;
  return { bg, theme: ws.theme ?? null };
});
await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/vela-probes/99-light-theme.png' });
await p.evaluate(axe);
const viol = await p.evaluate(async () => {
  const r = await window.axe.run(document.body, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } });
  return r.violations.map((v) => ({ id: v.id, n: v.nodes.length, sample: (v.nodes[0]?.html||'').slice(0,80) }));
});
console.log(JSON.stringify({ applied, viol }, null, 1));
await b.close();
