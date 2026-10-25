// Indicator settings → Defaults (R57): TradingView's footer control, in Chromium.
//
// jsdom proves the store and the menu's wiring; this proves the SURFACE: the footer chip
// replaces "Reset defaults", the menu is a real opaque panel inside the viewport, "Save as
// default" writes the document, a NEW instance of the type really opens with those values,
// "Clear saved default" forgets them, and a 390px phone still fits it.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

/** Open the settings dialog for the FIRST native of `type` on the active cell. */
const openSettings = async (type) => {
    await page.evaluate((t) => {
        const cell = window.__ws.cell('a');
        const handle = cell.chart.indicators().find((h) => h.nativeType === t);
        cell.chart.renderer.openIndicatorSettings(handle.id);
    }, type);
    await page.waitForSelector('.vela-ind-defaults, .vela-dialog-footer', { timeout: 5000 });
};
const rows = () =>
    page.evaluate(() => [...document.querySelectorAll('.vela-ind-defmenu .vela-ind-defrow')].map((b) => ({ label: b.textContent ?? '', disabled: b.disabled })));
/** Escape unwinds ONE layer at a time (menu, then dialog) — press it until both are gone. */
const closeDialog = async () => {
    for (let i = 0; i < 3 && (await page.locator('.vela-ind-defaults').count()); i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }
    await page.waitForFunction(() => !document.querySelector('.vela-ind-defaults'), null, { timeout: 5000 });
};

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1000);

    // Two instances so the chart-wide row is offered; one chart, so the layout row is not.
    await page.evaluate(() => {
        const cell = window.__ws.cell('a');
        cell.addNative('rsi');
        cell.addNative('rsi');
        cell.chart.indicators().find((h) => h.nativeType === 'rsi').setInput('length', 34);
    });
    await page.waitForTimeout(400);

    // ── 1. the footer control is Defaults ▾, not a bare reset ───────────────────
    await openSettings('rsi');
    const footer = await page.evaluate(() => {
        const btn = document.querySelector('.vela-ind-defaults');
        const foot = btn?.closest('.vela-dialog-footer');
        return { label: btn?.textContent ?? null, caret: !!btn?.querySelector('.vela-ind-defaults-caret'), bare: !!foot?.querySelector('.vela-dialog-btn:not(.vela-ind-defaults)') && [...foot.querySelectorAll('.vela-dialog-btn')].length };
    });
    facts.footer = footer;
    assert(footer.label === 'Defaults' && footer.caret, 'the footer shows Defaults ▾', footer);

    // ── 2. the menu: the whole verb set, disabled where nothing is saved ─────────
    await page.click('.vela-ind-defaults');
    await page.waitForSelector('.vela-ind-defmenu', { timeout: 5000 });
    const menu = await page.evaluate(() => {
        const el = document.querySelector('.vela-ind-defmenu');
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, bg: getComputedStyle(el).backgroundColor };
    });
    facts.panel = menu;
    assert(menu.w > 200 && menu.h > 100, 'the menu is a real panel, not a collapsed shell', menu);
    assert(menu.bg !== 'rgba(0, 0, 0, 0)', 'the panel paints its own opaque surface', menu.bg);
    assert(menu.x >= 0 && menu.x + menu.w <= menu.vw && menu.y >= 0 && menu.y + menu.h <= menu.vh, 'the menu fits the viewport', menu);

    const before = await rows();
    facts.before = before;
    assert(before.map((r) => r.label).join('|') === [
        'Save as default',
        'Load saved default',
        'Clear saved default',
        'Apply to every RSI on this chart',
        'Apply to every RSI in the layout',
        'Reset to factory defaults',
    ].join('|'), 'the rows are TV’s: both apply verbs, gated by siblings and by sibling charts', before);
    assert(before.find((r) => r.label === 'Load saved default')?.disabled === true, 'nothing saved yet ⇒ Load is greyed', before);

    // ── 3. Save as default writes the document ──────────────────────────────────
    await page.click('.vela-ind-defmenu .vela-ind-defrow');
    await page.waitForTimeout(250);
    const saved = await page.evaluate(() => window.__ws.indicatorDefault('rsi'));
    facts.saved = saved;
    assert(saved?.inputs?.length === 34, 'the saved default carries the edited value', saved);
    const after = await rows();
    assert(after[0].label === 'Update saved default' && after[1].disabled === false, 'the menu flips to update/load/clear', after);

    // ── 4. a NEW instance opens with it ────────────────────────────────────────
    await closeDialog();
    const seeded = await page.evaluate(() => {
        const cell = window.__ws.cell('a');
        cell.addNative('rsi');
        const handles = cell.chart.indicators().filter((h) => h.nativeType === 'rsi');
        return handles.map((h) => h.inputValues().length);
    });
    facts.seeded = seeded;
    // The two instances that already existed keep their own settings; the NEW one opens
    // with the saved default. That is the whole promise of "save as default".
    assert(seeded[seeded.length - 1] === 34, 'a new instance opens with the saved default', seeded);
    assert(seeded[1] === 14, 'an existing instance is left alone', seeded);

    // ── 5. Clear forgets it; the next instance falls back to the declaration ────
    await openSettings('rsi');
    await page.click('.vela-ind-defaults');
    await page.waitForSelector('.vela-ind-defmenu');
    await page.click('.vela-ind-defmenu .vela-ind-defrow:nth-child(3)');
    await page.waitForTimeout(200);
    facts.cleared = await page.evaluate(() => window.__ws.indicatorDefault('rsi'));
    assert(facts.cleared === null, 'Clear saved default empties the store', facts.cleared);
    const flipped = await rows();
    assert(flipped[0].label === 'Save as default' && flipped[1].disabled === true, 'and the menu says so', flipped);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-ind-defmenu'), null, { timeout: 5000 });
    assert((await page.locator('.vela-ind-defaults').count()) === 1, 'Escape closes the menu, not the dialog', 'open');
    await closeDialog();

    // ── 6. a phone: the same control, no sideways scroll ───────────────────────
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await phone.newPage();
    const phoneErrors = [];
    mp.on('pageerror', (e) => phoneErrors.push(String(e)));
    await mp.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await mp.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await mp.waitForTimeout(900);
    await mp.evaluate(() => window.__ws.cell('a').addNative('rsi'));
    await mp.waitForTimeout(500); // the legend row (what the dialog opens against) lands a beat later
    await mp.evaluate(() => {
        const cell = window.__ws.cell('a');
        const handle = cell.chart.indicators().find((h) => h.nativeType === 'rsi');
        cell.chart.renderer.openIndicatorSettings(handle.id);
    });
    await mp.waitForSelector('.vela-ind-defaults', { timeout: 5000 });
    await mp.locator('.vela-ind-defaults').click();
    await mp.waitForSelector('.vela-ind-defmenu', { timeout: 5000 });
    const mobile = await mp.evaluate(() => {
        const el = document.querySelector('.vela-ind-defmenu');
        const r = el.getBoundingClientRect();
        const foot = document.querySelector('.vela-ind-defaults').closest('.vela-dialog-footer');
        return {
            panel: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight },
            btn: Math.round(document.querySelector('.vela-ind-defaults').getBoundingClientRect().height),
            footOver: Math.round(foot.scrollWidth - foot.clientWidth),
            pageOver: Math.round(document.documentElement.scrollWidth - innerWidth),
            rows: el.querySelectorAll('.vela-ind-defrow').length,
        };
    });
    facts.mobile = mobile;
    assert(mobile.rows >= 4, 'the phone menu carries the verbs', mobile.rows);
    assert(mobile.panel.left >= 0 && mobile.panel.right <= mobile.panel.vw, 'the phone menu fits 390px', mobile.panel);
    assert(mobile.footOver <= 1 && mobile.pageOver <= 0, 'no sideways scroll on the phone', mobile);
    assert(mobile.btn >= 44, 'the footer action keeps a 44px thumb target', mobile.btn);
    assert(phoneErrors.length === 0, 'no page errors on the phone', phoneErrors);
    await phone.close();

    facts.errors = errors;
    assert(errors.length === 0, 'no page errors', errors);
} finally {
    await browser.close();
    report('indicator-defaults', facts);
}
