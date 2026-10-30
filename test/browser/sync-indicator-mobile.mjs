// Portrait touch and keyboard checks for the Object Tree's child forms and menus.
import { open, assert, report, OFFLINE } from './helpers.mjs';

const facts = [];
for (const viewport of [{ width: 240, height: 320 }, { width: 320, height: 640 }, { width: 390, height: 780 }]) {
    const { page, browser, errors } = await open({ base: OFFLINE, viewport, mobile: true, settle: 700 });
    try {
        const id = await page.evaluate(() => window.__ws.active.chart.addNativeIndicator('rsi').id);
        await page.waitForTimeout(700);
        await page.locator('.vela-mb-more').tap();
        await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Object tree' }).tap();
        await page.waitForTimeout(300);
        const row = page.locator(`.vela-ot-row[data-id="${id}"]`);
        await row.scrollIntoViewIfNeeded();
        await row.getByRole('button', { name: 'More actions' }).tap();
        await page.locator('.vela-menu-item:visible').filter({ hasText: /^Indicator templates$/ }).tap();
        await page.locator('.vela-menu-item:visible').filter({ hasText: /^Save as new template…$/ }).tap();
        const form = page.getByRole('dialog', { name: 'Save indicator template' });
        await form.waitFor({ state: 'visible' });
        const geometry = await form.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return { rect: r.toJSON(), radius: getComputedStyle(e).borderRadius, focus: document.activeElement?.getAttribute('aria-label'), tree: !document.querySelector('.vela-panel.vela-ot')?.hidden, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.rect.left >= 0 && geometry.rect.right <= viewport.width && geometry.rect.top >= 0 && geometry.rect.bottom <= viewport.height && geometry.overflow <= 0, 'child form fits the touch viewport', { viewport, geometry });
        assert(geometry.radius === '0px' && geometry.tree && geometry.focus === 'Indicator template name', 'touch form is square, focused and keeps its parent open', { viewport, geometry });
        await form.getByLabel('Indicator template name').fill(`RSI ${viewport.width}`);
        await form.getByRole('button', { name: 'Save' }).tap();
        await form.waitFor({ state: 'hidden' });
        const saved = await page.evaluate((width) => ({ template: !!window.__ws.getState().templates[`RSI ${width}`], tree: !document.querySelector('.vela-panel.vela-ot')?.hidden }), viewport.width);
        assert(saved.template && saved.tree, 'tap saves a real template and leaves Object Tree open', saved);
        assert(errors.length === 0, 'no mobile page errors', errors);
        facts.push({ viewport, geometry, saved });
    } finally { await browser.close(); }
}

// A keyboard can reveal actions without hovering, navigate a submenu, and Escape the
// child form back to its originating row without closing the Object Tree.
const desktop = await open({ base: OFFLINE, settle: 800 });
try {
    const { page, errors } = desktop;
    const id = await page.evaluate(() => window.__ws.active.chart.addNativeIndicator('rsi').id);
    await page.waitForTimeout(650);
    await page.locator('button[aria-label="Object tree"]').click();
    const row = page.locator(`.vela-ot-row[data-id="${id}"]`);
    await row.focus();
    const more = row.getByRole('button', { name: 'More actions' });
    assert(await more.isVisible(), 'focusing a row reveals the action buttons without hover');
    await more.focus();
    await page.keyboard.press('Enter');
    for (let n = 0; n < 12; n += 1) {
        await page.keyboard.press('ArrowDown');
        const highlighted = await page.locator('.vela-menu-item[data-highlighted]:visible').last().textContent();
        if (highlighted?.trim() === 'Indicator templates') break;
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(160);
    const highlighted = await page.locator('.vela-menu-item[data-highlighted]:visible').last().textContent();
    assert(highlighted?.trim() === 'Save as new template…', 'ArrowRight opens and focuses the nested action', highlighted);
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Save indicator template' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    const focus = await page.evaluate(() => ({ id: document.activeElement?.dataset.id, tree: !document.querySelector('.vela-panel.vela-ot')?.hidden, form: !!document.querySelector('.vela-ot-mini') }));
    assert(focus.id === id && focus.tree && !focus.form, 'Escape closes only the child and restores focus to its row', focus);
    assert(errors.length === 0, 'no keyboard page errors', errors);
    report('indicator-mobile-and-keyboard', { sizes: facts, focus });
} finally { await desktop.browser.close(); }
