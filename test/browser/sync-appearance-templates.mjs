// Chart settings → Templates (R57): TradingView's appearance templates, in the dialog footer.
//
// jsdom proves the store's contracts; Chromium has to prove the surface: the footer control
// is where TV puts it (left, next to "Apply to all"), the menu is a real opaque panel inside
// the viewport, applying a template actually moves the chart's settings (the dialog re-seeds),
// a save labels the button with the template's name, the house default really seeds a NEW
// chart, and the whole thing still fits a 390px phone.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

const openSettings = async () => {
    if (await page.locator('.vela-sd-tplbtn').count()) return;
    await page.evaluate(() => window.__ws.active.chart.renderer.openSettings());
    await page.waitForSelector('.vela-sd-tplbtn', { timeout: 5000 });
};
const openMenu = async () => {
    if (await page.locator('.vela-sd-tpl').count()) return;
    await page.locator('.vela-sd-tplbtn').click();
    await page.waitForSelector('.vela-sd-tpl', { timeout: 5000 });
};
const closeMenu = async () => {
    if (!(await page.locator('.vela-sd-tpl').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-sd-tpl'), null, { timeout: 5000 });
};
const closeDialog = async () => {
    await closeMenu();
    if (!(await page.locator('.vela-sd-tplbtn').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-sd-tplbtn'), null, { timeout: 5000 });
};
const label = () => page.evaluate(() => document.querySelector('.vela-sd-tplbtn .vela-sd-tplname')?.textContent ?? null);
const names = () => page.evaluate(() => window.__ws.appearanceTemplateList().map((t) => `${t.name}${t.active ? '*' : ''}`));

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__ws.setActiveCell('a'));

    // ── 1. the control sits in the footer next to Apply to all ───────────────────
    await openSettings();
    const footer = await page.evaluate(() => {
        const foot = document.querySelector('.vela-sd-tplbtn')?.parentElement;
        return {
            text: document.querySelector('.vela-sd-tplbtn .vela-sd-tplname')?.textContent ?? null,
            applyAll: !!document.querySelector('.vela-sd-applyall'),
            reset: !!document.querySelector('.vela-sd-reset'),
            inFooter: foot?.classList.contains('vela-dialog-footer') || !!foot?.querySelector('.vela-sd-btn'),
        };
    });
    facts.footer = footer;
    assert(footer.text === 'Templates' && footer.applyAll && !footer.reset, 'Templates + Apply to all replace the bare reset button', footer);

    // ── 2. the menu is a real surface inside the viewport ───────────────────────
    await openMenu();
    const panel = await page.evaluate(() => {
        const el = document.querySelector('.vela-sd-tpl');
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundColor;
        return { x: r.x, y: r.y, w: r.width, h: r.height, bg, vw: innerWidth, vh: innerHeight, rows: el.querySelectorAll('.vela-sd-tpl-item').length };
    });
    facts.panel = panel;
    assert(panel.bg !== 'rgba(0, 0, 0, 0)' && panel.bg !== 'transparent', 'the menu paints its own surface', panel.bg);
    assert(panel.x >= 0 && panel.y >= 0 && panel.x + panel.w <= panel.vw && panel.y + panel.h <= panel.vh, 'the menu fits the viewport', panel);
    assert(panel.rows === 0, 'no templates yet', panel.rows);

    // ── 3. save the chart's appearance under a name ─────────────────────────────
    await page.click('.vela-sd-tpl-act[data-save]');
    await page.waitForSelector('.vela-sd-tpl-input', { timeout: 5000 });
    await page.fill('.vela-sd-tpl-input', 'Desk look');
    await page.click('.vela-sd-tpl-ok');
    await page.waitForTimeout(250);
    let state = await names();
    facts.saved = state;
    assert(state.some((n) => n === 'Desk look*'), 'the save lands and immediately matches this chart', state);
    assert((await label()) === 'Desk look', 'the footer button wears the template name', await label());
    const ticks = await page.evaluate(() => document.querySelectorAll('.vela-sd-tpl-item .vela-sd-tpl-tick svg').length);
    assert(ticks === 1, 'the matching row is ticked', ticks);

    // ── 4. another chart does not match, and one click makes it ────────────────
    await closeDialog();
    // Offline's cells share one look, so give b its own first — otherwise "does this chart
    // wear the template?" has the trivial answer "yes, it happens to look identical".
    await page.evaluate(() => {
        window.__ws.cell('b').chart.renderer.applyConfig({ grid: { vertLines: { visible: false } } });
        window.__ws.setActiveCell('b');
    });
    await page.waitForTimeout(200);
    const bBefore = await page.evaluate(() => ({ name: window.__ws.appearanceTemplateName('b'), list: window.__ws.appearanceTemplateList('b').map((t) => `${t.name}${t.active ? '*' : ''}`) }));
    facts.bBefore = bBefore;
    assert(bBefore.name === null, 'a different chart does not wear the template', bBefore);
    await openSettings();
    assert((await label()) === 'Templates', 'its dialog says Templates, not the other chart’s name', await label());
    await openMenu();
    await page.click('.vela-sd-tpl-item[data-name="Desk look"] .vela-sd-tpl-row');
    await page.waitForTimeout(400);
    const bAfter = await page.evaluate(() => window.__ws.appearanceTemplateName('b'));
    facts.bAfter = bAfter;
    assert(bAfter === 'Desk look', 'applying it moves this chart onto the template', bAfter);
    assert((await label()) === 'Desk look', 'and the dialog re-seeds to the new settings', await label());
    // Picking a template closes the dropdown (TV's own behaviour — the chart behind it
    // changes, so the menu gets out of the way) and the shell reports it as a toast.
    assert((await page.locator('.vela-sd-tpl').count()) === 0, 'the pick closes the dropdown', 'closed');
    const toasted = await page.evaluate(() => /applied to 1 chart/.test(document.body.textContent ?? ''));
    assert(toasted, 'the shell says what was applied', toasted);

    // ── 5. the house default seeds a NEW chart ─────────────────────────────────
    await openMenu();
    await page.click('.vela-sd-tpl-act[data-house]');
    await page.waitForTimeout(200);
    const house = await page.evaluate(() => window.__ws.defaultAppearanceTemplate());
    facts.house = house;
    assert(house === 'Desk look', 'the star makes it the house template', house);
    await closeDialog();
    await page.evaluate(() => window.__ws.setLayout('8'));
    await page.waitForTimeout(1200);
    const newCells = await page.evaluate(() => {
        const out = {};
        for (const cell of window.__ws.cells()) out[cell.id] = window.__ws.appearanceTemplateName(cell.id);
        return out;
    });
    facts.newCells = newCells;
    const minted = Object.keys(newCells).filter((id) => !['a', 'b', 'c', 'd'].includes(id));
    assert(minted.length > 0, 'the bigger layout minted charts', Object.keys(newCells));
    assert(minted.every((id) => newCells[id] === 'Desk look'), 'every new chart opened with the house look', newCells);

    // ── 6. Apply defaults puts the factory look back ────────────────────────────
    await closeDialog();
    await page.evaluate(() => window.__ws.setLayout('4'));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__ws.setActiveCell('a'));
    await openSettings();
    await openMenu();
    await page.click('.vela-sd-tpl-act[data-defaults]');
    await page.waitForTimeout(250);
    const afterReset = await page.evaluate(() => window.__ws.appearanceTemplateName('a'));
    facts.afterReset = afterReset;
    assert(afterReset === null, 'Apply defaults leaves the chart on no template', afterReset);
    await page.waitForSelector('.vela-sd-tplbtn', { timeout: 3000 });
    assert(true, 'the settings dialog stays open behind it', 'open');

    // ── 7. delete is two taps ──────────────────────────────────────────────────
    await openMenu();
    await page.click('.vela-sd-tpl-item[data-name="Desk look"] .vela-sd-tpl-del');
    await page.waitForTimeout(150);
    assert((await names()).some((n) => n.startsWith('Desk look')), 'one tap arms, it does not delete', await names());
    await page.click('.vela-sd-tpl-item[data-name="Desk look"] .vela-sd-tpl-del');
    await page.waitForTimeout(200);
    state = await names();
    facts.deleted = state;
    assert(state.length === 0, 'the second tap deletes it', state);
    assert((await label()) === 'Templates', 'the footer falls back to Templates', await label());

    // ── 8. Escape closes the menu, not the dialog ──────────────────────────────
    await openMenu();
    await closeMenu();
    assert((await page.locator('.vela-sd-tplbtn').count()) === 1, 'the settings dialog stays open', 'open');
    await closeDialog();

    // ── 9. a phone: same control, no sideways scroll ───────────────────────────
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await phone.newPage();
    const phoneErrors = [];
    mp.on('pageerror', (e) => phoneErrors.push(String(e)));
    await mp.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await mp.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await mp.waitForTimeout(1000);
    await mp.evaluate(() => {
        window.__ws.setActiveCell('a');
        window.__ws.active.chart.renderer.openSettings();
    });
    await mp.waitForSelector('.vela-sd-tplbtn', { timeout: 5000 });
    await mp.locator('.vela-sd-tplbtn').click();
    await mp.waitForSelector('.vela-sd-tpl', { timeout: 5000 });
    const mobile = await mp.evaluate(() => {
        const foot = document.querySelector('.vela-sd-tplbtn').parentElement;
        const panelEl = document.querySelector('.vela-sd-tpl');
        const r = panelEl.getBoundingClientRect();
        return {
            btn: document.querySelector('.vela-sd-tplbtn').getBoundingClientRect().width,
            footOver: Math.round(foot.scrollWidth - foot.clientWidth),
            pageOver: Math.round(document.documentElement.scrollWidth - innerWidth),
            panel: { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth },
            rows: panelEl.querySelectorAll('.vela-sd-tpl-item').length,
        };
    });
    facts.mobile = mobile;
    assert(mobile.btn >= 44, 'the footer control keeps a 44px touch target', mobile.btn);
    assert(mobile.footOver <= 1 && mobile.pageOver <= 0, 'the phone footer and page do not scroll sideways', mobile);
    assert(mobile.panel.left >= 0 && mobile.panel.right <= mobile.panel.vw, 'the menu fits a 390px screen', mobile.panel);
    assert(phoneErrors.length === 0, 'no page errors on the phone', phoneErrors);
    await phone.close();

    facts.errors = errors;
    assert(errors.length === 0, 'no page errors', errors);
} finally {
    await browser.close();
    report('appearance-templates', facts);
}
