// The templates dropdown (R56): TradingView's "Indicator templates", beside Indicators.
//
// jsdom (test/templates-menu.test.ts) proves the menu's contract against stubs. Only
// Chromium proves the things that make it TV-grade: the button sits in the toolbar's own
// row right after Indicators, the panel is a real floating surface inside the viewport,
// a save really lands in the workspace store, the row star really moves the house
// default, and the two-tap delete cannot take a template out on its first press.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

const state = () =>
    page.evaluate(() => ({
        names: window.__ws.templateList().map((t) => `${t.name}:${t.count}`),
        house: window.__ws.defaultTemplate(),
        open: !!document.querySelector('.vela-tm'),
        flash: document.querySelector('.vela-tm-flash')?.textContent ?? '',
    }));

const openMenu = async () => {
    if (await page.locator('.vela-tm').count()) return;
    await page.locator('.vela-widget-templates').click();
    await page.waitForSelector('.vela-tm', { timeout: 5000 });
};
const closeMenu = async () => {
    if (!(await page.locator('.vela-tm').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-tm'), null, { timeout: 5000 });
};
const rowKebab = async (name) => {
    await openMenu();
    await page.evaluate((n) => {
        const wrap = [...document.querySelectorAll('.vela-tm-item')].find((r) => r.dataset.name === n);
        wrap?.querySelector('.vela-tm-kebab')?.click();
    }, name);
};
const chip = async (label) => {
    await page.evaluate((l) => {
        [...document.querySelectorAll('.vela-tm-chip')].find((b) => b.textContent.trim().startsWith(l))?.click();
    }, label);
    await page.waitForTimeout(150);
};

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1000);

    // ── 1. the button sits beside Indicators ─────────────────────────────────────
    const order = await page.evaluate(() => {
        const bar = document.querySelector('.vela-widget-topbar');
        return [...(bar?.children ?? [])].map((el) => {
            const c = el.className || '';
            if (c.includes('vela-widget-indicators')) return 'indicators';
            if (c.includes('vela-widget-templates')) return 'templates';
            return '';
        }).filter(Boolean);
    });
    facts.order = order;
    assert(order[0] === 'indicators' && order[1] === 'templates', 'Templates follows Indicators, with no hairline between them', order);

    // ── 2. open: a real floating surface inside the viewport ─────────────────────
    await page.locator('.vela-widget-templates').click();
    await page.waitForSelector('.vela-tm', { timeout: 5000 });
    const box = await page.evaluate(() => {
        const el = document.querySelector('.vela-tm');
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundColor;
        return { x: r.x, y: r.y, w: r.width, h: r.height, bg, vw: innerWidth, vh: innerHeight, rows: el.querySelectorAll('.vela-tm-item').length };
    });
    facts.panel = box;
    assert(box.bg !== 'rgba(0, 0, 0, 0)' && box.bg !== 'transparent', 'the panel paints its own surface', box.bg);
    assert(box.x >= 0 && box.y >= 0 && box.x + box.w <= box.vw && box.y + box.h <= box.vh, 'the panel fits the viewport', box);
    assert(box.rows === 0, 'a fresh workspace has no templates yet', box.rows);
    await closeMenu();

    // ── 3. save with "remember the market", straight into the store ──────────────
    await openMenu();
    await page.click('.vela-tm-save');
    await page.waitForSelector('.vela-tm-input', { timeout: 5000 });
    await page.fill('.vela-tm-input', 'Morning set');
    await page.check('.vela-tm-check input');
    await page.click('.vela-tm-primary');
    await page.waitForTimeout(250);
    let s = await state();
    facts.saved = s;
    assert(s.names.some((n) => n.startsWith('Morning set:')), 'the template lands in the workspace store', s.names);
    assert(/saved/.test(s.flash), 'the panel says it saved', s.flash);
    const rowMeta = await page.evaluate(() => document.querySelector('.vela-tm-item[data-name="Morning set"] .vela-tm-meta')?.textContent ?? '');
    facts.rowMeta = rowMeta;
    assert(/indicator/.test(rowMeta) && /AAA/.test(rowMeta), 'the row shows the count and the remembered market', rowMeta);

    // ── 4. applying closes the menu (TV closes on pick) ──────────────────────────
    await page.click('.vela-tm-row[data-name="Morning set"]');
    await page.waitForFunction(() => !document.querySelector('.vela-tm'), null, { timeout: 5000 });
    assert(!(await state()).open, 'picking a template applies and closes', 'closed');

    // ── 5. the star is TV's "Set as default" ─────────────────────────────────────
    await openMenu();
    await page.click('.vela-tm-item[data-name="Morning set"] .vela-tm-star');
    await page.waitForTimeout(200);
    s = await state();
    facts.house = s;
    assert(s.house === 'Morning set', 'the row star sets the house template', s.house);
    const sub = await page.evaluate(() => document.querySelector('.vela-tm-sub')?.textContent ?? '');
    assert(/New charts start with/.test(sub), 'the header says what new charts will start with', sub);
    await page.click('.vela-tm-item[data-name="Morning set"] .vela-tm-star');
    await page.waitForTimeout(200);
    assert((await state()).house === null, 'a second press clears it', (await state()).house);

    // ── 6. kebab: apply to all charts, rename, export, delete ────────────────────
    await rowKebab('Morning set');
    const chips = await page.evaluate(() => [...document.querySelectorAll('.vela-tm-chip')].map((b) => b.textContent.trim()));
    facts.chips = chips;
    assert(chips.some((c) => c.startsWith('Apply to all charts')), 'a multi-chart layout offers Apply to all charts', chips);
    await chip('Apply to all charts');
    s = await state();
    assert(/applied to 4 charts/.test(s.flash), 'the flash reports how many charts took it', s.flash);

    await rowKebab('Morning set');
    await chip('Rename…');
    await page.waitForSelector('.vela-tm-input', { timeout: 5000 });
    await page.fill('.vela-tm-input', 'Desk set');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    s = await state();
    facts.renamed = s;
    assert(s.names.some((n) => n.startsWith('Desk set:')), 'rename lands in the store', s.names);
    assert(!s.names.some((n) => n.startsWith('Morning set:')), 'and the old name is gone', s.names);

    // A second template, so a duplicate rename has something to refuse.
    await page.click('.vela-tm-save');
    await page.waitForSelector('.vela-tm-input', { timeout: 5000 });
    await page.fill('.vela-tm-input', 'Second set');
    await page.click('.vela-tm-primary');
    await page.waitForTimeout(250);
    await rowKebab('Second set');
    await chip('Rename…');
    await page.fill('.vela-tm-input', 'Desk set');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    s = await state();
    facts.dup = s;
    assert(/already exists/.test(s.flash), 'a taken name is refused, not overwritten', s.flash);

    const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await rowKebab('Desk set');
    await chip('Export');
    const file = await download;
    facts.exported = file?.suggestedFilename() ?? null;
    assert(file?.suggestedFilename() === 'Desk set.vela-template.json', 'Export writes the template file', facts.exported);

    // ── 7. delete is two taps ────────────────────────────────────────────────────
    await rowKebab('Second set');
    await chip('Delete');
    s = await state();
    assert(s.names.some((n) => n.startsWith('Second set:')), 'one tap arms, it does not delete', s.names);
    await chip('Tap again to delete');
    s = await state();
    facts.deleted = s;
    assert(!s.names.some((n) => n.startsWith('Second set:')), 'the second tap deletes it', s.names);
    assert(s.names.some((n) => n.startsWith('Desk set:')), 'and leaves the others alone', s.names);

    // ── 8. Escape closes and gives focus back to the button ──────────────────────
    await closeMenu();
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('vela-widget-templates'));
    assert(focused === true, 'Escape returns focus to the toolbar button', focused);

    // ── 9. a narrow desktop still fits the panel ────────────────────────────────
    const fits = {};
    for (const w of [1024, 820]) {
        await page.setViewportSize({ width: w, height: 820 });
        await page.waitForTimeout(250);
        await openMenu();
        const r = await page.evaluate(() => {
            const el = document.querySelector('.vela-tm');
            const b = el.getBoundingClientRect();
            return { left: b.left, right: b.right, vw: innerWidth, over: document.documentElement.scrollWidth - innerWidth };
        });
        await closeMenu();
        fits[w] = { left: Math.round(r.left), right: Math.round(r.right), over: r.over };
        assert(r.left >= 0 && r.right <= r.vw && r.over <= 0, `the panel and the page fit at ${w}px`, fits[w]);
    }
    facts.widths = fits;

    facts.errors = errors;
    assert(errors.length === 0, 'no page errors', errors);
} finally {
    await browser.close();
    report('templates-menu', facts);
}
