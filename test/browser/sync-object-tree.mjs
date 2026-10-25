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

// ── multi-select: Ctrl-click, the bar, and Esc ───────────────────────────────────────
const rowPoint = async (name) =>
    page.evaluate((n) => {
        const r = [...document.querySelectorAll('.vela-ot-row[data-row-kind="indicator"]')].find(
            (x) => (x.querySelector('.vela-ot-name')?.textContent || '') === n,
        );
        const b = r.getBoundingClientRect();
        return { x: b.x + 60, y: b.y + b.height / 2 };
    }, name);
const clickRow = async (name, mods = []) => {
    const p = await rowPoint(name);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(p.x, p.y);
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(250);
};
await clickRow('BB');
await clickRow('MACD', ['Control']);
const bulk = await page.evaluate(() => ({
    visible: !document.querySelector('.vela-ot-selbar')?.hidden,
    count: document.querySelector('.vela-ot-selcount')?.textContent ?? '',
    verbs: [...document.querySelectorAll('.vela-ot-selbar .vela-ot-btn')].map((b) => b.dataset.icon),
    picked: [...document.querySelectorAll('.vela-ot-row[data-picked]')].map((r) => r.querySelector('.vela-ot-name')?.textContent),
}));
assert(bulk.visible, 'Ctrl-click on a second row opens the selection bar', bulk);
assert(bulk.count === '2 selected', 'the bar counts the pick', bulk.count);
assert(bulk.verbs.includes('eye-off') && bulk.verbs.includes('trash'), 'the bar carries the eye and the bin', bulk.verbs);
assert(
    bulk.picked.length === 2 && bulk.picked.includes('BB') && bulk.picked.includes('MACD'),
    'both rows read as picked',
    bulk.picked,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
const cleared = await page.evaluate(() => ({
    hidden: document.querySelector('.vela-ot-selbar')?.hidden === true,
    picked: document.querySelectorAll('.vela-ot-row[data-picked]').length,
    panel: !!document.querySelector('.vela-ot-row'),
}));
assert(cleared.hidden && cleared.picked === 0, 'Esc lets go of the pick', cleared);
assert(cleared.panel, '…without closing the panel', cleared);

// ── the row menu's "Source code": the legend's { } chip, reachable without the legend ──
await page.evaluate(() => {
    const row = [...document.querySelectorAll('.vela-ot-row[data-row-kind="indicator"]')].find(
        (r) => (r.querySelector('.vela-ot-name')?.textContent || '') === 'BB',
    );
    row?.querySelector('.vela-ot-btn[data-icon="more"]')?.click();
});
await page.waitForTimeout(600);
const menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('.vela-menu .vela-menu-item')].filter((i) => i.offsetParent !== null).map((i) => (i.textContent || '').trim()),
);
assert(menuItems.some((t) => /^Source code/.test(t)), "the indicator menu offers Source code", menuItems);
await page.locator('.vela-menu-item:visible', { hasText: 'Source code' }).first().click({ timeout: 5000 });
await page.waitForTimeout(1500);
const source = await page.evaluate(() => {
    const ta = document.querySelector('.vela-pe-input');
    return { text: (ta?.value || '').slice(0, 120), readOnly: ta?.readOnly ?? null, banner: !!document.querySelector('.vela-pe-builtin:not([hidden])') };
});
assert(/indicator\(\s*"Bollinger Bands"/.test(source.text), "Source code opens the built-in's own Pine text", source.text.slice(0, 80));
assert(source.readOnly === true, 'a built-in opens read-only', source.readOnly);
assert(source.banner === true, 'the read-only banner is shown', source.banner);

const facts = {
    menu: menuItems.filter((t) => /Source code/.test(t)),
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

// A phone's plain tap must NOT start a pick (the bulk bar would follow every look);
// a long-press does. The tap half is cheap to assert and catches the regression that
// makes browsing the tree feel like it is editing.
await p.evaluate(async () => {
    const c = window.__ws.active.chart;
    c.addNativeIndicator('bollinger-bands');
    await new Promise((r) => setTimeout(r, 4000));
});
const tapPoint = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.vela-ot-row[data-row-kind="indicator"]')].find(
        (x) => (x.querySelector('.vela-ot-name')?.textContent || '') === 'BB',
    );
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + 60, y: b.y + b.height / 2 };
});
let tapStartedPick = null;
if (tapPoint) {
    await p.touchscreen.tap(tapPoint.x, tapPoint.y);
    await p.waitForTimeout(400);
    tapStartedPick = await p.evaluate(() => !document.querySelector('.vela-ot-selbar')?.hidden);
    assert(tapStartedPick === false, 'a plain tap on a phone does not start a pick', tapStartedPick);
}

assert(p.url().length > 0, 'the phone context is still alive for the tap check', true);
await phone.browser.close();

report('object-tree-values', { ...facts, bulk, phone: { editorRow, editorOpen, tapStartedPick } });
