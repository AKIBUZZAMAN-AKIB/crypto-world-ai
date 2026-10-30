// The Compare control (R58): TradingView's second-series tool in the top toolbar.
//
// The compare flow existed but had ONE door — the phone's More drawer — so on a desktop the
// feature was invisible however well it worked. This probe proves the toolbar door and the
// state it carries: the glyph sits in the right cluster, clicking it opens the sheet, the
// chart taking a comparison lights the glyph and names the symbol, and removing the
// comparison puts it back. The phone keeps its drawer row and hides the toolbar.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1200);

    // ── 1. the glyph lives in the toolbar's right cluster ────────────────────────
    const btn = await page.evaluate(() => {
        const b = document.querySelector('.vela-widget-compare');
        const right = b?.closest('.vela-topbar-right');
        const r = b?.getBoundingClientRect();
        return {
            present: !!b,
            inRight: !!right,
            w: r ? Math.round(r.width) : null,
            title: b?.getAttribute('aria-label') ?? null,
            active: b?.dataset.active ?? null,
        };
    });
    facts.button = btn;
    assert(btn.present && btn.inRight, 'Compare is a top-toolbar tool (right cluster)', btn);
    assert(btn.w >= 28 && btn.w <= 40, 'it is one 32px tool, not a squeezed chip', btn.w);
    assert(btn.title === 'Compare symbol' && btn.active === '0', 'it starts idle and says what it does', btn);

    // ── 2. clicking opens the compare sheet ──────────────────────────────────────
    await page.locator('.vela-widget-compare').click();
    await page.waitForTimeout(600);
    const sheet = await page.evaluate(() => {
        const dlg = document.querySelector('.vela-compare-panel:not([hidden])');
        return { open: !!dlg, text: dlg?.textContent?.replace(/\s+/g, ' ').slice(0, 120) ?? null };
    });
    facts.sheet = sheet;
    assert(sheet.open && /Choose symbol/.test(sheet.text ?? ''), 'the click opens the compare pane, not a dead button', sheet);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── 3. a comparison lights the glyph and names the symbol ────────────────────
    await page.evaluate(() => window.__ws.setCompareSymbol('BINANCE:ETHUSDT'));
    await page.waitForTimeout(700);
    const on = await page.evaluate(() => {
        const b = document.querySelector('.vela-widget-compare');
        return {
            active: b?.dataset.active,
            pressed: b?.getAttribute('aria-pressed'),
            title: b?.getAttribute('aria-label'),
            studies: window.__ws.active.chart.indicators().filter((h) => h.nativeType === 'compare').length,
        };
    });
    facts.active = on;
    assert(on.active === '1' && on.pressed === 'true', 'the tool reads as ON while a chart compares', on);
    assert(on.title === 'Comparing with ETHUSDT — click to change', 'the tooltip names the compared ticker', on.title);
    assert(on.studies === 1, 'exactly one compare study is on the chart', on.studies);

    // ── 4. removing the comparison puts it back to idle ──────────────────────────
    await page.evaluate(() => window.__ws.removeCompare());
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => {
        const b = document.querySelector('.vela-widget-compare');
        return { active: b?.dataset.active, title: b?.getAttribute('aria-label'), studies: window.__ws.active.chart.indicators().filter((h) => h.nativeType === 'compare').length };
    });
    facts.cleared = off;
    assert(off.active === '0' && off.studies === 0, 'removing the comparison returns it to idle', off);
    assert(off.title === 'Compare symbol', 'and the tooltip goes back to the bare verb', off.title);

    // ── 5. the phone: toolbar hidden, the drawer row is the door ─────────────────
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await phone.newPage();
    const phoneErrors = [];
    mp.on('pageerror', (e) => phoneErrors.push(String(e)));
    await mp.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await mp.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await mp.waitForTimeout(1000);
    await mp.locator('button[aria-label="More"]').first().click();
    await mp.waitForTimeout(600);
    const mobile = await mp.evaluate(() => {
        const b = document.querySelector('.vela-widget-compare');
        const rows = [...document.querySelectorAll('.vela-md button, .vela-drawer button')].map((x) => x.textContent?.trim());
        const row = [...document.querySelectorAll('.vela-md button, .vela-drawer button')].find((x) => x.textContent?.trim() === 'Compare');
        const r = row?.getBoundingClientRect();
        return {
            toolbar: b ? Math.round(b.getBoundingClientRect().width) : null,
            hasRow: !!row,
            rowH: r ? Math.round(r.height) : null,
            over: Math.round(document.documentElement.scrollWidth - innerWidth),
        };
    });
    facts.mobile = mobile;
    // The phone leaves the whole desktop toolbar out of the document (R67): absent counts
    // as hidden, exactly like a zero-width control.
    assert(mobile.toolbar === null || mobile.toolbar === 0, 'the phone hides the toolbar control', mobile.toolbar);
    assert(mobile.hasRow && mobile.rowH >= 40, 'the More drawer keeps a full-size Compare row', mobile);
    assert(mobile.over <= 0, 'the phone sheet does not scroll sideways', mobile.over);
    assert(phoneErrors.length === 0, 'no page errors on the phone', phoneErrors);
    await phone.close();

    facts.errors = errors;
    assert(errors.length === 0, 'no page errors', errors);
} finally {
    await browser.close();
    report('compare-button', facts);
}
