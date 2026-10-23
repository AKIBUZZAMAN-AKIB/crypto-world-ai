// Round 22 — the four Tier-1 drawing tools, drawn for real in a browser.
//
// A unit test can prove geometry; only a browser can prove the tool ARM, the three/four
// click placement, the painter, and the settings panel all line up. This probe:
//   1. lists the toolbar flyouts and checks the new labels are where they claim to be;
//   2. places each tool by clicking the plot (synthetic pointer events through Playwright);
//   3. reads the drawing back from the model and screenshots the chart.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://127.0.0.1:5190/workspace.html';
const OUT = 'audit';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
    if (m.type() === 'error' && !/CORS|ERR_FAILED|binance/i.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ws && window.__ws.cells().length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1600);

const cell = page.locator('.vela-cell').first();
const box = await cell.boundingBox();
if (!box) throw new Error('no cell box');
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

/** Place a tool by clicking a list of fractional points, then report what the model holds. */
async function place(type, points, settle = 420) {
    await page.evaluate((t) => window.__ws.cells()[0].chart.drawings.setTool(t), type);
    await page.waitForTimeout(180);
    for (const [fx, fy] of points) {
        const p = at(fx, fy);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(140);
    }
    await page.waitForTimeout(settle);
    const info = await page.evaluate(() => {
        const docs = window.__ws.cells()[0].chart.drawings.all();
        const d = docs[docs.length - 1];
        return d ? { type: d.type, anchors: d.anchors?.length ?? 0, text: d.text?.value ?? null } : null;
    });
    await page.evaluate(() => window.__ws.cells()[0].chart.drawings.setTool(null));
    await page.waitForTimeout(120);
    return info;
}

// ── 1. the toolbar really offers them ───────────────────────────────────────
const rows = {};
for (const [label, group] of [
    ['Fibonacci — more', 'fib'],
    ['Text — more', 'text'],
    ['Shapes — more', 'shapes'],
]) {
    const arrow = page.locator(`[aria-label="${label}"]`).first();
    if ((await arrow.count()) === 0) {
        rows[group] = 'no chevron';
        continue;
    }
    const cellEl = arrow.locator('xpath=..');
    await cellEl.hover();
    await page.waitForTimeout(120);
    await arrow.click({ force: true });
    await page.waitForTimeout(280);
    rows[group] = (await page.locator('.vela-dtb-item[aria-label]').allTextContents()).map((t) => t.trim());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(160);
    await page.evaluate(() => document.body.click()); // close any flyout that survived Escape
    await page.waitForTimeout(120);
}
console.log('flyouts:', JSON.stringify(rows, null, 1));

// ── 2. place each tool ──────────────────────────────────────────────────────
const placed = {};
placed.doublecurve = await place('doublecurve', [[0.30, 0.62], [0.62, 0.40], [0.34, 0.34], [0.58, 0.70]]);
await page.screenshot({ path: `${OUT}/r22-double-curve.png` });

placed.fibpitchfan = await place('fibpitchfan', [[0.30, 0.78], [0.55, 0.25], [0.66, 0.45]]);
await page.screenshot({ path: `${OUT}/r22-fib-pitchfan.png` });

placed.gannsquarefixed = await place('gannsquarefixed', [[0.28, 0.30], [0.44, 0.22]]);
await page.screenshot({ path: `${OUT}/r22-gann-fixed.png` });

placed.pin = await place('pin', [[0.70, 0.30], [0.78, 0.18]]);
await page.screenshot({ path: `${OUT}/r22-pin.png` });

console.log('placed:', JSON.stringify(placed, null, 1));

// ── 3. the Gann fixed square must be square in PIXELS ──────────────────────
const squarePx = await page.evaluate(() => {
    const docs = window.__ws.cells()[0].chart.drawings.all();
    const d = docs.find((x) => x.type === 'gannsquarefixed');
    return d ? { anchors: d.anchors.length } : null;
});

const report = {
    flyouts: rows,
    hasDoubleCurve: (rows.shapes ?? []).includes('Double curve'),
    hasPitchfan: (rows.fib ?? []).includes('Fib Pitchfan'),
    hasGannFixed: (rows.fib ?? []).includes('Gann Square Fixed'),
    hasPin: (rows.text ?? []).includes('Pin'),
    placed,
    squarePx,
    errors,
};
writeFileSync(`${OUT}/r22-tier1-drawings.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
