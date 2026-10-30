// Exercise real legacy modal hosts and a bare Vela chart in the existing playground.
// No invented HTML fixture: the real components are mounted into the offline app.
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    return { context, page };
}
try {
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.evaluate(async (moduleUrl) => {
            const { MoreDrawer } = await import(moduleUrl);
            const host = document.querySelector('.vela-workspace'); let cursor = 'cross';
            const drawer = new MoreDrawer({ host, canUndo: () => true, canRedo: () => false,
                priceStyles: () => [{ id: 'candles', label: 'Candles' }], priceStyle: () => 'candles', onPriceStyle: () => {},
                panels: () => [], onTogglePanel: () => {}, actions: () => [], cursorStyle: () => cursor, onCursorStyle: (value) => { cursor = value; } });
            window.__legacyMore = { drawer, cursor: () => cursor }; drawer.open();
        }, `/@fs${resolve('src/widget/more-drawer.ts')}`);
        const drawer = page.locator('.vela-drawer:visible').last(); await drawer.waitFor(); await page.waitForTimeout(400);
        assert(await drawer.locator('.vela-md-search').count() === 0, 'legacy More has no search either');
        const trigger = drawer.locator('.vela-md-row', { hasText: 'Cursor' }); await trigger.tap();
        const cursorMenu = page.locator('.vela-cursor-menu'); await cursorMenu.waitFor({ state: 'visible' });
        const hit = await cursorMenu.locator('[data-value="dot"]').evaluate((el) => {
            const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-value]')?.getAttribute('data-value');
        });
        assert(hit === 'dot' && await drawer.isVisible(), 'legacy cursor menu escapes sheet clipping and remains inside its focus trap', hit);
        await cursorMenu.locator('[data-value="dot"]').tap();
        assert(await page.evaluate(() => window.__legacyMore.cursor()) === 'dot' && await drawer.isVisible(), 'real cursor selection leaves legacy More open');
        await trigger.tap(); await page.keyboard.press('Escape');
        assert(!(await cursorMenu.isVisible()) && await drawer.isVisible(), 'Escape closes the legacy child first');
        await trigger.tap(); await page.evaluate(() => window.__legacyMore.drawer.close());
        assert(!(await cursorMenu.isVisible()), 'programmatically closing legacy More removes its child');
        await page.evaluate(() => window.__legacyMore.drawer.destroy()); await page.waitForTimeout(300);
        facts.more = { hit, cursor: await page.evaluate(() => window.__legacyMore.cursor()) };

        await page.evaluate(async (moduleUrl) => {
            const { AlertCreateSheet } = await import(moduleUrl);
            const host = document.querySelector('.vela-workspace');
            const sheet = new AlertCreateSheet({ host, symbol: () => 'AAA', currentPrice: () => 100,
                onCreate: (request) => { window.__legacyAlertRequest = request; return true; } });
            window.__legacyAlert = sheet; sheet.open();
        }, `/@fs${resolve('src/widget/alert-create.ts')}`);
        const alert = page.locator('.vela-drawer:visible').last(); await alert.waitFor(); await page.waitForTimeout(400);
        const condition = alert.getByRole('combobox', { name: 'Condition' }); await condition.tap();
        const options = page.locator('.vela-alert-select-pop'); await options.waitFor({ state: 'visible' });
        const alertHit = await options.locator('[data-value="cross-up"]').evaluate((el) => {
            const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-value]')?.getAttribute('data-value');
        });
        assert(alertHit === 'cross-up' && await alert.isVisible(), 'legacy alert select is visible and physically tappable above its modal', alertHit);
        await options.locator('[data-value="cross-up"]').tap();
        assert(await alert.locator('.vela-ac-select').inputValue() === 'cross-up' && await alert.isVisible(), 'legacy alert selection updates its model and keeps the form');
        await condition.tap(); await page.keyboard.press('Escape');
        assert(!(await options.isVisible()) && await alert.isVisible() && await condition.getAttribute('aria-expanded') === 'false',
            'Escape dismisses only the legacy alert select, not its modal form');
        assert(await condition.evaluate((el) => document.activeElement === el), 'Escape returns focus to the legacy alert condition');
        await condition.tap(); await page.evaluate(() => window.__legacyAlert.close());
        assert(!(await options.isVisible()), 'closing the legacy alert sheet cleans up its select');
        await page.waitForTimeout(300); await page.evaluate(() => window.__legacyAlert.open()); await page.waitForTimeout(400);
        await condition.tap(); await options.locator('[data-value="cross-up"]').tap();
        await alert.getByLabel('Alert level').fill('110'); await alert.locator('.vela-ac-create').tap();
        const request = await page.evaluate(() => window.__legacyAlertRequest);
        assert(request?.condition === 'cross-up' && request?.value === 110 && request?.frequency === 'once', 'legacy alert creation preserves condition, value and frequency', request);
        await page.evaluate(() => window.__legacyAlert.destroy());
        facts.alert = { hit: alertHit, request }; await context.close();
    }

    // A cramped legacy phone sheet must keep both its own form and its select list
    // independently scrollable, with the last condition reachable by an actual tap.
    {
        const { context, page } = await boot({ width: 240, height: 320 }, true);
        await page.evaluate(async (moduleUrl) => {
            const { AlertCreateSheet } = await import(moduleUrl);
            window.__smallAlert = new AlertCreateSheet({ host: document.querySelector('.vela-workspace'), symbol: () => 'AAA', currentPrice: () => 100,
                onCreate: (request) => { window.__smallAlertRequest = request; return true; } });
            window.__smallAlert.open();
        }, `/@fs${resolve('src/widget/alert-create.ts')}`);
        const drawer = page.locator('.vela-drawer:visible').last(); await drawer.waitFor(); await page.waitForTimeout(350);
        const body = drawer.locator('.vela-drawer-body'), condition = drawer.getByRole('combobox', { name: 'Condition' });
        await condition.scrollIntoViewIfNeeded(); await condition.tap();
        const pop = page.locator('.vela-alert-select-pop'), list = pop.locator('.vela-alert-select-options'); await pop.waitFor({ state: 'visible' });
        const geometry = await pop.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), viewport: [innerWidth, innerHeight],
            documentOverflow: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight] }));
        assert(geometry.rect.left >= -1 && geometry.rect.top >= -1 && geometry.rect.right <= 241 && geometry.rect.bottom <= 321 && geometry.documentOverflow.every((n) => n <= 0),
            'legacy alert options fit a very small viewport without scrolling the document', geometry);
        await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const scrolled = await list.evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }));
        assert(scrolled.top > 0 && scrolled.total > scrolled.height, 'the compact condition list scrolls independently', scrolled);
        const last = list.locator('[data-value="move-down-pct"]');
        const hit = await last.evaluate((el) => { const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-value]')?.getAttribute('data-value'); });
        assert(hit === 'move-down-pct', 'the last condition remains physically reachable after scrolling', hit);
        await last.tap();
        assert(await drawer.locator('.vela-ac-select').inputValue() === 'move-down-pct', 'the last option updates the real form model');
        await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(400);
        const bodyScroll = await body.evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, overflow: getComputedStyle(el).overflowY, behavior: getComputedStyle(el).scrollBehavior }));
        const create = drawer.locator('.vela-ac-create'); await create.scrollIntoViewIfNeeded();
        assert(bodyScroll.top > 0 && bodyScroll.total > bodyScroll.height && await create.isVisible(), 'the legacy form still scrolls to its create action', bodyScroll);
        await drawer.getByLabel('Move amount').fill('1'); await create.tap();
        const request = await page.evaluate(() => window.__smallAlertRequest);
        assert(request?.condition === 'move-down-pct' && request.value === 1 && request.frequency === 'once', 'scrolled legacy form creates the chosen moving alert', request);
        await page.evaluate(() => window.__smallAlert.destroy());
        facts.smallAlert = { geometry, scrolled, bodyScroll, request }; await context.close();
    }

    {
        const { context, page } = await boot({ width: 1000, height: 700 });
        const root = await page.evaluate(async (moduleUrl) => {
            const { Vela } = await import(moduleUrl), last = window.__ws.active.chart.lastBar;
            window.__ws.destroy();
            const host = document.querySelector('#workspace');
            Object.assign(host.style, { inset: 'auto', left: '100px', top: '110px', width: '320px', height: '360px' });
            const bars = Array.from({ length: 100 }, (_, i) => ({ time: last.time - 3600000 * (100 - i), open: 100 + i * .1, high: 102 + i * .1, low: 98 + i * .1, close: 101 + i * .1, volume: 10 }));
            const chart = new Vela(host, { data: bars, theme: 'dark', animations: false }); window.__bareChart = chart;
            await chart.ready(); const drawing = chart.drawings.add('hline', { anchors: [{ time: last.time, price: 110 }] }); window.__bareDrawing = drawing.id;
            return host.getBoundingClientRect().toJSON();
        }, `/@fs${resolve('src/Vela.ts')}`);
        // The first renderer resize closes a selection, so select only after it settles.
        await page.waitForTimeout(500);
        // Count visual-viewport subscriptions made by this panel and its drag helper.
        // Restoring the native methods after closing also leaves the real app untouched.
        await page.evaluate(() => {
            const view = visualViewport, add = view.addEventListener, remove = view.removeEventListener;
            const active = { resize: new Set(), scroll: new Set() };
            view.addEventListener = function (type, listener, options) {
                if (active[type]) active[type].add(listener);
                return add.call(this, type, listener, options);
            };
            view.removeEventListener = function (type, listener, options) {
                if (active[type]) active[type].delete(listener);
                return remove.call(this, type, listener, options);
            };
            window.__viewportTracking = { count: () => ({ resize: active.resize.size, scroll: active.scroll.size }),
                restore: () => { view.addEventListener = add; view.removeEventListener = remove; } };
        });
        await page.evaluate(() => window.__bareChart.drawings.openSettings(window.__bareDrawing));
        const bar = page.locator('.vela-dpop'), gear = bar.locator('[data-tip="Settings"]'); await bar.waitFor({ state: 'visible' });
        if (await gear.isVisible()) await gear.click();
        else { await bar.locator('[data-tip="More"]').click(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Settings' }).click(); }
        const panel = page.locator('.vela-dialog.vela-dsp'); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
        const initial = await panel.boundingBox(), header = await panel.locator('.vela-dialog-header').boundingBox();
        assert(initial.x + initial.width > root.right || initial.y + initial.height > root.bottom, 'bare-chart drawing settings can leave the chart host', { root, initial });
        await page.mouse.move(header.x + 50, header.y + 15); await page.mouse.down(); await page.mouse.move(50, 50, { steps: 10 }); await page.mouse.up();
        const moved = await panel.locator('.vela-dialog-header').boundingBox();
        const scroll = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
        assert((Math.abs(moved.x - header.x) > 30 || Math.abs(moved.y - header.y) > 30) && moved.x >= 0 && moved.y >= 0 && moved.x + moved.width <= 1000 && moved.y + moved.height <= 700 && scroll.every((x) => x <= 0),
            'bare-chart panel drags outside its host while keeping the header accessible and page still', { header, moved, scroll });
        const preferred = await panel.boundingBox(), subscriptions = await page.evaluate(() => window.__viewportTracking.count());
        assert(subscriptions.resize >= 2 && subscriptions.scroll >= 2, 'settings and drag helper subscribe to visual viewport changes', subscriptions);
        // The position chosen by the user is a preference, not overwritten by a
        // temporary keyboard/zoom constraint. Restoring the viewport should restore it.
        await page.evaluate(() => {
            const view = visualViewport;
            for (const [key, value] of Object.entries({ offsetLeft: 220, offsetTop: 150, width: 450, height: 300 })) Object.defineProperty(view, key, { configurable: true, value });
            view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(150);
        const constrained = await panel.boundingBox(), constrainedHeader = await panel.locator('.vela-dialog-header').boundingBox();
        assert(constrainedHeader.x >= 220 && constrainedHeader.y >= 150 && constrainedHeader.x + constrainedHeader.width <= 670 && constrainedHeader.y + constrainedHeader.height <= 450,
            'the moved settings header reflows into a temporarily smaller visual viewport', { preferred, constrained, constrainedHeader });
        await page.evaluate(() => {
            const view = visualViewport; for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) delete view[key];
            view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(150);
        const restored = await panel.boundingBox();
        assert(Math.abs(restored.x - preferred.x) < 2 && Math.abs(restored.y - preferred.y) < 2 && Math.abs(restored.height - preferred.height) < 2,
            'a moved settings panel returns to its chosen position and size after the viewport recovers', { preferred, constrained, restored });
        await panel.getByRole('button', { name: 'Ok' }).click(); await page.waitForTimeout(250);
        const afterClose = await page.evaluate(() => window.__viewportTracking.count());
        assert(afterClose.resize === 0 && afterClose.scroll === 0, 'closing settings removes every visual viewport listener it added', { subscriptions, afterClose });
        await page.evaluate(() => { window.__viewportTracking.restore(); window.__bareChart.destroy(); }); await page.waitForTimeout(250);
        assert(await page.locator('.vela-dsp, .vela-dpop').count() === 0, 'bare-chart destruction removes portaled drawing chrome');
        facts.bareChart = { root, initial, moved, scroll, preferred, constrained, restored, subscriptions, afterClose }; await context.close();
    }
    assert(errors.length === 0, 'no uncaught page errors', errors);
    report('legacy-floating', { engine, ...facts, errors });
} finally { await browser.close(); }
