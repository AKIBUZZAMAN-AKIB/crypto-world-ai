// Automated accessibility sweep with axe-core, run against the real workspace shell
// (not a fixture): main screen, the More drawer, the alert sheet and the indicator picker.
// We keep the RAW axe rule ids + node counts so the report can name what to fix.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

async function scan(label, opener) {
    if (opener) { await p.evaluate(opener); await p.waitForTimeout(900); }
    await p.evaluate(axe);
    const res = await p.evaluate(async () => {
        const r = await window.axe.run(document.body, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: (v.nodes[0]?.html || '').slice(0, 90) }));
    });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    return { label, violations: res };
}

const out = [];
out.push(await scan('main workspace'));
out.push(await scan('more drawer', () => window.__ws.openMoreDrawer?.()));
out.push(await scan('alert create sheet', () => window.__ws.openAlertCreate?.()));
out.push(await scan('indicator picker', () => window.__ws.openIndicators?.()));
out.push(await scan('command palette', () => window.__ws.openPalette?.() ?? window.__ws.togglePalette?.()));

const summary = out.map((s) => ({
    where: s.label,
    rules: s.violations.map((v) => `${v.id}(${v.impact})×${v.nodes}`),
}));
console.log(JSON.stringify({ summary, detail: out }, null, 1));
await b.close();
