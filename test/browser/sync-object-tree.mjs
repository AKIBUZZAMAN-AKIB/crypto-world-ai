// Object tree — the phone's ONLY readout, so the check is about VALUES, not layout:
//   1. every indicator row carries a live value, and a study with several plots can be
//      opened to list them all (name + value + the plot's own colour);
//   2. those values follow the crosshair — scrubbing the chart rewrites them in place;
//   3. the More sheet has a "Pine Editor" row on a phone (the editor's own door there).
import { open, assert, report } from './helpers.mjs';

// ── 1 + 2: desktop, where the tree sits in the right panel ─────────────────────────────
const desktop = await open({ settle: 2200 });
const { page, errors, browser } = desktop;

const added = await page.evaluate(async () => {
    const chart = window.__ws.active.chart;
    chart.addNativeIndicator('bollinger-bands');
    chart.addNativeIndicator('macd');
    await new Promise((r) => setTimeout(r, 5000));
    return chart.indicators().length;
});
assert(added >= 3, 'the studies mounted (volume + two added)', added);

// The panel toggle on the right toolbar.
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Object tree'));
    btn?.click();
});
await page.waitForTimeout(900);

const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.vela-ot-row[data-row-kind="indicator"]')].map((r) => ({
        name: r.querySelector('.vela-ot-name')?.textContent ?? '',
        value: r.querySelector('.vela-ot-val')?.textContent ?? '',
        fold: !!r.querySelector('.vela-ot-fold'),
    })),
);
assert(rows.length >= 3, 'the tree lists every indicator', rows.length);
assert(
    rows.every((r) => r.value !== ''),
    'every indicator row shows a value',
    rows.filter((r) => r.value === ''),
);

// Open every study that can expand, then read the value blocks.
await page.evaluate(() => {
    for (const fold of document.querySelectorAll('.vela-ot-fold')) fold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(600);
const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('.vela-ot-values')].map((block) =>
        [...block.querySelectorAll('.vela-ot-vrow')].map((line) => ({
            label: line.querySelector('.vela-ot-vlabel')?.textContent ?? '',
            value: line.querySelector('.vela-ot-val')?.textContent ?? '',
            dot: line.querySelector('.vela-ot-dot') ? getComputedStyle(line.querySelector('.vela-ot-dot')).backgroundColor : '',
        })),
    ),
);
assert(blocks.length >= 2, 'the multi-plot studies opened their value list', blocks.length);
assert(
    blocks.every((lines) => lines.length >= 2),
    'each opened block lists every plot',
    blocks.map((b) => b.length),
);
assert(
    blocks.every((lines) => lines.every((l) => l.label !== '' && l.value !== '')),
    'no blank label or value in an opened block',
    blocks,
);
assert(
    blocks.every((lines) => lines.every((l) => l.dot !== '' && l.dot !== 'rgba(0, 0, 0, 0)')),
    'every plot line carries its colour dot',
    blocks,
);

// …and they follow the crosshair: hover a bar in the past and the readout must move.
const before = await page.evaluate(() => [...document.querySelectorAll('.vela-ot-vrow .vela-ot-val')].map((v) => v.textContent));
const rect = await page.evaluate(() => {
    const r = window.__ws.active.host.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.mouse.move(Math.round(rect.x + rect.width * 0.3), Math.round(rect.y + rect.height * 0.35));
await page.waitForTimeout(700);
const after = await page.evaluate(() => [...document.querySelectorAll('.vela-ot-vrow .vela-ot-val')].map((v) => v.textContent));
assert(
    before.length > 0 && JSON.stringify(before) !== JSON.stringify(after),
    'the tree values follow the crosshair',
    { before, after },
);

const facts = {
    rows: rows.map((r) => `${r.name}=${r.value}`),
    blocks: blocks.map((lines) => lines.map((l) => `${l.label}=${l.value}`)),
    followed: JSON.stringify(before) !== JSON.stringify(after),
};
assert(errors.length === 0, 'no page errors on the desktop pass', errors.slice(0, 3));
await browser.close();

// ── 3: phone, the More sheet's editor row ─────────────────────────────────────────────
const phone = await open({ viewport: { width: 412, height: 839 }, mobile: true, settle: 2500 });
const p = phone.page;
await p.click('.vela-mb-more');
await p.waitForTimeout(800);
const moreRows = await p.evaluate(() => [...document.querySelectorAll('.vela-md-row')].map((r) => (r.textContent || '').trim()));
const editorRow = moreRows.find((r) => /^Pine Editor/.test(r));
assert(editorRow !== undefined, 'the More sheet has a Pine Editor row on a phone', moreRows.slice(0, 12));
await p.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => /^Pine Editor/.test(r.textContent || ''))?.click());
await p.waitForTimeout(1200);
const editorOpen = await p.evaluate(() => !!document.querySelector('.vela-pe-input'));
assert(editorOpen, 'the More sheet row opens the editor', editorOpen);
assert(
    (await p.evaluate(() => document.documentElement.scrollWidth)) <= 412,
    'the phone never scrolls sideways',
    await p.evaluate(() => document.documentElement.scrollWidth),
);
assert(phone.errors.length === 0, 'no page errors on the phone pass', phone.errors.slice(0, 3));
await phone.browser.close();

report('object-tree-values', { ...facts, phone: { editorRow, editorOpen } });
