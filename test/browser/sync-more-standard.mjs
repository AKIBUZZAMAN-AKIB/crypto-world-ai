// The phone More door uses the same non-modal, bottom-attached pane as workspace tools.
// Tests real workspace DOM and interactions on Chromium and WebKit; no screenshot files.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
const same = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const rects = (panel) => panel.evaluate(el => {
    const box = node => node?.getBoundingClientRect().toJSON();
    const body = el.querySelector('.vela-panel-body'), search = el.querySelector('.vela-md-search');
    return { panel: box(el), host: box(el.parentElement), head: box(el.querySelector('.vela-panel-header')),
        grip: box(el.querySelector('.vela-panel-grip')), close: box(el.querySelector('.vela-panel-close')),
        max: box(el.querySelector('.vela-panel-max')), standard: el.hasAttribute('data-standard-pane'),
        maximized: el.hasAttribute('data-maximized'), role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'),
        title: el.querySelector('.vela-panel-title')?.textContent, bodyWidth: body?.clientWidth, bodyScrollWidth: body?.scrollWidth,
        searchRadius: search && getComputedStyle(search).borderRadius, searchShadow: search && getComputedStyle(search).boxShadow,
        row: (() => { const row = el.querySelector('.vela-md-row:not([hidden])'); if (!row) return null; const cs = getComputedStyle(row); return { radius: cs.borderRadius, shadow: cs.boxShadow, background: cs.backgroundColor }; })(),
        action: (() => { const action = el.querySelector('.vela-md-action:not([hidden])'); if (!action) return null; const cs = getComputedStyle(action); return { radius: cs.borderRadius, shadow: cs.boxShadow, background: cs.backgroundColor }; })(),
        pageOverflow: [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.documentElement.scrollHeight - document.documentElement.clientHeight] };
});
async function boot(width = 390, height = 780) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(`${OFFLINE}?preview=editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    return { context, page };
}
async function drag(context, page, target, dy) {
    const r = await target.boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (engine === 'webkit') {
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy, { steps: 8 }); await page.mouse.up();
    } else {
        const client = await context.newCDPSession(page);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach();
    }
    await page.waitForTimeout(200);
}
try {
    const { context, page } = await boot();
    const trigger = page.locator('.vela-mb-more'), panel = page.locator('.vela-more-panel');
    await trigger.tap(); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(200);
    const initial = await rects(panel);
    const relationship = await trigger.evaluate((el, id) => ({ expanded: el.getAttribute('aria-expanded'), controls: el.getAttribute('aria-controls') === id, popup: el.getAttribute('aria-haspopup') }), await panel.getAttribute('id'));
    assert(initial.standard && initial.title === 'More' && initial.role === 'region' && !initial.modal, 'More is the named non-modal standard pane', initial);
    assert(initial.grip && near(initial.grip.width, initial.panel.width) && initial.grip.bottom <= initial.head.top + 2 && initial.max && initial.close, 'separate grip, title, fullscreen and close', initial);
    assert(near(initial.panel.left, initial.host.left) && near(initial.panel.right, initial.host.right) && near(initial.panel.bottom, initial.host.bottom), 'More fills and attaches to the workspace bottom', initial);
    assert(relationship.expanded === 'true' && relationship.controls && !relationship.popup, 'More trigger points to the non-modal pane', relationship);
    assert(!await page.locator('.vela-ws-main').evaluate(el => el.hasAttribute('inert')), 'the chart is not inert');
    assert(await panel.locator('.vela-md-search').count() === 0, 'More has no search field, icon or clear button');
    assert([initial.row, initial.action].every(surface => surface && surface.radius === '0px' && surface.shadow === 'none' && surface.background === 'rgba(0, 0, 0, 0)'), 'More rows and quick actions use a flat interior', initial);
    assert(await panel.locator('.vela-md-search-clear').count() === 0, 'the complete More search control is removed');
    await drag(context, page, panel.locator('.vela-panel-header'), -65);
    assert(same(initial.panel, (await rects(panel)).panel), 'heading does not detach the phone pane');
    await drag(context, page, panel.locator('.vela-panel-grip'), -70);
    const resized = await rects(panel);
    assert(resized.panel.height > initial.panel.height + 35 && near(resized.panel.bottom, initial.panel.bottom), 'separate grip resizes while remaining bottom attached', { initial, resized });
    await panel.locator('.vela-panel-max').tap(); const full = await rects(panel);
    assert(full.maximized && full.panel.height > resized.panel.height, 'fullscreen opens', full);
    await panel.locator('.vela-panel-max').tap(); const restored = await rects(panel);
    assert(!restored.maximized && same(resized.panel, restored.panel), 'restore returns to the prior bottom-attached size', { resized, restored });
    const visibleRows = await panel.locator('.vela-md-row .vela-md-row-label').allTextContents();
    const cursorRow = panel.locator('.vela-md-row', { hasText: 'Cursor' });
    await cursorRow.tap();
    const cursor = page.locator('.vela-cursor-menu:visible'); await cursor.waitFor();
    assert(await panel.isVisible() && await cursor.locator('[role="menuitemradio"]').count() === 7, 'cursor opens as a compact menu above the unchanged More pane');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'dot' && await panel.isVisible(), 'keyboard navigation selects the next cursor without closing More');
    await cursorRow.tap(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'none', 'End and Enter select the final cursor');
    await cursorRow.tap(); await cursor.locator('[data-value="arrow"]').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('cursorStyle')) === 'arrow' && (await cursorRow.textContent()).includes('Arrow'), 'cursor selection updates the parent label in place');
    await panel.locator('.vela-md-row', { hasText: 'Layout setup' }).tap();
    const setup = page.locator('.vela-layout-setup'); await setup.waitFor({ state: 'visible' });
    assert(!(await panel.isVisible()) && await setup.getByRole('tab', { name: 'Chart syncing' }).count() === 1, 'Layout setup opens its own exclusive pane');
    await setup.locator('.vela-panel-close').tap();
    await trigger.tap();
    await panel.getByRole('button', { name: 'Indicator templates', exact: true }).tap();
    const templates = page.locator('.vela-templates-panel'); await templates.waitFor({ state: 'visible' });
    assert(!(await panel.isVisible()), 'Indicator templates opens separately');
    await templates.locator('.vela-panel-close').tap();
    await trigger.tap();
    await panel.locator('.vela-md-row', { hasText: 'Chart actions' }).tap();
    const actions = page.locator('.vela-chart-actions'); await actions.waitFor({ state: 'visible' });
    assert(await panel.isVisible(), 'Chart actions is a compact child above More');
    await page.keyboard.press('Escape');
    assert(!(await actions.isVisible()) && await panel.isVisible(), 'Escape closes only the child menu');
    const beforeState = await page.evaluate(() => window.__ws.dock.getState());
    await panel.locator('.vela-panel-close').tap();
    assert((await trigger.getAttribute('aria-expanded')) === 'false', 'Close updates trigger');
    await page.evaluate(state => window.__ws.dock.applyState(state), beforeState);
    await panel.waitFor({ state: 'visible' });
    assert(await panel.locator('.vela-md-row').count() > 5, 'restored pane has its live content');
    await page.setViewportSize({ width: 780, height: 390 }); await page.waitForTimeout(450);
    assert(await panel.isVisible() && await page.evaluate(() => document.querySelector('.vela-workspace').dataset.layout) === 'desktop', 'More remains open as a desktop pane after rotation');
    assert(await panel.locator('.vela-md-search').count() === 0 && await panel.locator('.vela-md-row').count() > 5, 'rotation keeps the unfiltered More actions');
    await panel.locator('.vela-md-row:visible', { hasText: 'Chart type' }).click();
    assert((await panel.locator('.vela-md-row').allTextContents()).some(text => text.includes('Candles')), 'desktop More uses its functional chart-type subview when the phone sheet is unavailable');
    await panel.locator('.vela-md-back').click();
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(450);
    assert(await panel.isVisible() && near((await rects(panel)).panel.bottom, (await rects(panel)).host.bottom), 'rotating back restores the bottom-attached More pane');
    await trigger.tap(); await panel.waitFor({ state: 'hidden' });
    assert((await trigger.getAttribute('aria-expanded')) === 'false', 'the More button toggles its open pane closed');
    facts.phone = { initial, resized, full, restored, visibleRows };
    await context.close();

    // A restored pane may open before the lazily constructed More content exists.
    const fresh = await boot(240, 600);
    await fresh.page.evaluate(() => window.__ws.dock.applyState({ open: 'more' }));
    const narrow = fresh.page.locator('.vela-more-panel'); await narrow.waitFor({ state: 'visible' });
    await narrow.locator('.vela-md-row').first().waitFor({ state: 'visible' });
    const narrowBox = await rects(narrow);
    assert(narrowBox.standard && near(narrowBox.panel.width, 240) && near(narrowBox.panel.bottom, narrowBox.host.bottom), 'late content restores in a narrow phone pane', narrowBox);
    assert(narrowBox.bodyScrollWidth <= narrowBox.bodyWidth + 1 && narrowBox.pageOverflow.every(n => n <= 1), 'narrow pane avoids horizontal or page overflow', narrowBox);
    assert(await narrow.locator('.vela-md-row').count() > 5, 'lazy restore populated the rows');
    facts.narrow = narrowBox;
    await fresh.context.close();

    const persistContext = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const persistPage = await persistContext.newPage();
    persistPage.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await persistPage.goto(`${OFFLINE}?persist=1`, { waitUntil: 'domcontentloaded' });
    await persistPage.evaluate(() => { window.__ws.destroy(); localStorage.clear(); });
    await persistPage.reload({ waitUntil: 'domcontentloaded' });
    await persistPage.waitForFunction(() => window.__ws?.active?.chart?.lastBar);
    await persistPage.locator('.vela-mb-more').tap();
    const persisted = persistPage.locator('.vela-more-panel'); await persisted.waitFor({ state: 'visible' });
    await persisted.locator('.vela-panel-grip').focus(); await persistPage.keyboard.press('ArrowUp');
    await persistPage.waitForTimeout(1600);
    const beforeReload = await rects(persisted);
    await persistPage.reload({ waitUntil: 'domcontentloaded' });
    await persistPage.waitForFunction(() => window.__ws?.active?.chart?.lastBar);
    await persisted.waitFor({ state: 'visible' }); await persisted.locator('.vela-md-row').first().waitFor({ state: 'visible' });
    const afterReload = await rects(persisted);
    assert(near(beforeReload.panel.height, afterReload.panel.height) && near(afterReload.panel.bottom, afterReload.host.bottom), 'open More and its height restore on phone-first boot', { beforeReload, afterReload });
    assert(await persisted.locator('.vela-md-row').count() > 5, 'boot-restored More receives lazy content without stealing focus');
    facts.persist = { before: beforeReload.panel.height, after: afterReload.panel.height };
    await persistContext.close();

    const embedded = await boot(800, 700);
    await embedded.page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
    await embedded.page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
    await embedded.page.locator('.vela-mb-more').tap();
    const embeddedPane = embedded.page.locator('.vela-more-panel'); await embeddedPane.waitFor({ state: 'visible' });
    const embeddedBefore = await rects(embeddedPane);
    await drag(embedded.context, embedded.page, embeddedPane.locator('.vela-panel-grip'), -45);
    const embeddedAfter = await rects(embeddedPane);
    assert(near(embeddedBefore.panel.left, embeddedBefore.host.left) && near(embeddedBefore.panel.right, embeddedBefore.host.right) && near(embeddedAfter.panel.bottom, embeddedAfter.host.bottom), 'embedded pane remains inside and attached to its own host', { embeddedBefore, embeddedAfter });
    facts.embedded = { before: embeddedBefore, after: embeddedAfter };
    await embedded.context.close();
    assert(errors.length === 0, 'no uncaught page errors', errors);
    report('more-standard', { engine, ...facts, errors });
} finally { await browser.close(); }
