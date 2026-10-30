// R62 — the CLICK GATE. A control that takes a third of a second to appear reads as a
// hang, whatever the node count says. This check clicks the shell's real controls from a
// cold page and times the frame their surface appears in.
//
// It is deliberately a WALL-CLOCK bound and not a micro-benchmark: the numbers are the
// kind a trader feels (>100 ms = "did that click register?"). Everything here is measured
// on the same page, in order, so a regression in one surface cannot hide behind another.
import { BASE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

/** A surface must be up inside this many ms of the click. */
const SHOW_MS = 120;
/** …and the symbol picker's list must be COMPLETE (all 100 rows) inside this. */
const FULL_MS = 320;

const VISIBLE = (sel) =>
    `[...document.querySelectorAll('${sel}')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 20 && r.width > 20; })`;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 90000 });
await page.waitForTimeout(2000);
// A deterministic full-page index keeps this a meaningful 100-row stress test when
// the network-free fixture has only six symbols (or the live venue is unavailable).
await page.evaluate(() => {
    const picker = window.__ws.symbolPicker;
    const symbols = Array.from({ length: 150 }, (_, i) => ({ ticker: `TEST${String(i).padStart(3, '0')}`,
        description: `Synthetic symbol ${i}`, type: 'crypto', provider: 'offline' }));
    picker.setSource(() => symbols);
    picker.opts.iconFor = () => 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/%3E';
});

const facts = {};

const timeOne = async (label, sel, surfaceSel) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(420);
    const box = await page.locator(sel).first().boundingBox();
    assert(!!box, `${label}: the control exists`, box);
    if (!box) return;
    await page.evaluate((s) => {
        const vis = () => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 20 && r.width > 20; }).length;
        window.__n0 = vis();
        window.__t = { start: performance.now(), shown: -1 };
        const tick = () => {
            if (vis() > window.__n0) { window.__t.shown = performance.now() - window.__t.start; return; }
            if (performance.now() - window.__t.start < 3000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, surfaceSel);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => Math.round(window.__t.shown));
    facts[label] = shown;
    assert(shown >= 0 && shown <= SHOW_MS, `${label}: its surface is up within ${SHOW_MS}ms of the click`, shown);
    return shown;
};

// ── the topbar's own dropdowns ────────────────────────────────────────────────
await timeOne('timeframe', '.vela-widget-tf-caret', '.vela-menu');
await timeOne('chart style', '.vela-widget-style', '.vela-menu');
await timeOne('replay', '.vela-widget-replay', '.vela-menu');
await timeOne('templates', '.vela-widget-tplcaret', '.vela-tm');
await timeOne('layout', '.vela-widget-layoutname', '.vela-lmp');
await timeOne('indicators', '.vela-widget-indicators', '.vela-indicator-panel');
await page.keyboard.press('Escape');
await page.waitForTimeout(420);

// ── the symbol picker: the heaviest surface the shell has ─────────────────────
{
    const box = await page.locator('.vela-widget-symbol').first().boundingBox();
    await page.evaluate(() => {
        const list = () => document.querySelectorAll('.vela-sp-list > *').length;
        window.__s = { start: performance.now(), shown: -1, first: -1, full: -1, rows: 0 };
        const tick = () => {
            const s = window.__s;
            // The picker's own list, not "the first .vela-dialog in the document": the
            // shell owns several dialogs and they are mounted when they open.
            const d = document.querySelector('.vela-sp-list');
            if (d && d.getBoundingClientRect().height > 20 && s.shown < 0) s.shown = performance.now() - s.start;
            const n = list();
            if (n > 0 && s.first < 0) s.first = performance.now() - s.start;
            if (n > s.rows) { s.rows = n; s.full = performance.now() - s.start; }
            if (performance.now() - s.start < 2000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    const s = await page.evaluate(() => ({ shown: Math.round(window.__s.shown), first: Math.round(window.__s.first), full: Math.round(window.__s.full), rows: window.__s.rows }));
    facts.symbol = s;
    assert(s.shown >= 0 && s.shown <= SHOW_MS, `symbol picker opens within ${SHOW_MS}ms`, s);
    assert(s.first >= 0 && s.first <= SHOW_MS * 2, 'its first rows paint in the same breath', s);
    assert(s.rows >= 100 && s.full <= FULL_MS, `the whole page of rows lands within ${FULL_MS}ms`, s);

    // Images are decorative and off-screen ones must not be fetched in the click.
    const imgs = await page.evaluate(() => {
        const all = [...document.querySelectorAll('.vela-sp-row img')];
        return { n: all.length, lazy: all.filter((i) => i.loading === 'lazy').length };
    });
    facts.iconImages = imgs;
    assert(imgs.n > 0 && imgs.lazy === imgs.n, 'every row icon is lazy — a hundred badges do not load in the click', imgs);

    // Typing filters: the rebuild must not stall the keystroke.
    const typed = await page.evaluate(async () => {
        const input = document.querySelector('.vela-sp-input');
        const t = performance.now();
        input.value = 'et';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(r));
        return Math.round(performance.now() - t);
    });
    facts.typing = typed;
    assert(typed <= 60, 'a keystroke repaints the filtered list without a stall', typed);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
}

// ── phone: the More drawer is the shell's front door there ───────────────────
{
    const ph = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p2 = await ph.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(`${BASE}?layout=mobile`, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 90000 });
    await p2.waitForTimeout(2000);
    const box = await p2.locator('.vela-mb-more').first().boundingBox();
    assert(!!box, 'phone: the More control exists', box);
    if (box) {
        await p2.evaluate(() => {
            const vis = () => document.querySelectorAll('.vela-menu, .vela-dialog, .vela-drawer, .vela-sheet').length;
            window.__n0 = vis();
            window.__t = { start: performance.now(), shown: -1 };
            const tick = () => {
                if (vis() > window.__n0) { window.__t.shown = performance.now() - window.__t.start; return; }
                if (performance.now() - window.__t.start < 3000) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await p2.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await p2.waitForTimeout(700);
        const shown = await p2.evaluate(() => Math.round(window.__t.shown));
        facts.phoneMore = shown;
        assert(shown >= 0 && shown <= 160, 'phone: the More drawer is up within 160ms of the tap', shown);
    }
    await ph.close();
}

assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
report('sync-interaction-latency', facts);
await browser.close();
