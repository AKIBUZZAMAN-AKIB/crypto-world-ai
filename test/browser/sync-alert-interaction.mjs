import { chooseAlertOption } from './helpers.mjs';
// Phone routing, touch momentum, focus safety and host composition contracts.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};
const errors = [];
try {
    {
        const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 4);
        await page.locator('.vela-mb-more').tap();
        const moreRow = page.locator('.vela-more-panel:visible .vela-md-row').filter({ hasText: /^Alerts$/ });
        assert(await moreRow.count() === 1, 'More has one Alerts entry, not a duplicate panel entry');
        await moreRow.tap(); await page.waitForTimeout(300);
        assert(await page.locator('.vela-ap').isVisible() && await page.locator('.vela-mb-alerts').getAttribute('aria-pressed') === 'true', 'More opens the same pane as the direct phone bell');
        await chooseAlertOption(page.locator('.vela-ac-select'), 'cross-up');
        await page.getByLabel('Alert level').fill('200');
        await page.locator('.vela-ac-create').tap();
        const phoneCreated = await page.evaluate(() => window.__ws.getState().priceAlerts?.[0]);
        assert(phoneCreated?.cellId === 'a' && phoneCreated.condition === 'cross-up' && phoneCreated.value === 200, 'phone can create a real price alert in the shared pane', phoneCreated);
        // Script-like events are sent through the chart event bus to exercise the real
        // workspace aggregation path. No backend or notification delivery is implied.
        await page.evaluate(() => {
            const bus = window.__ws.cell('a').chart.orchestrator.events;
            for (let i = 0; i < 40; i++) bus.emit('alert', { id: `p${i}`, indicator: 'RSI', title: 'Signal', message: `event ${i}`, time: Date.now() + i });
        });
        assert(await page.locator('.vela-mb-alerts .vela-mb-badge').innerText() === '9+', 'phone badge follows retained events');
        await page.getByRole('tab', { name: /^Log/ }).tap();
        const scroll = page.locator('.vela-ap-log-view');
        await page.waitForTimeout(250);
        const initialRows = await page.locator('.vela-ap-log-row').count();
        const bounds = await scroll.boundingBox(), x = bounds.x + bounds.width * .72, y = bounds.y + bounds.height * .82;
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 95 * i / 8 }] });
            await page.waitForTimeout(10);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(30);
        const duringBefore = await scroll.evaluate((el) => ({ top: el.scrollTop, rows: el.querySelectorAll('.vela-ap-log-row').length, first: el.querySelector('.vela-ap-log-row') }));
        // Keep a DOM identity across a live update; the list must not be replaced in-flight.
        await scroll.evaluate((el) => { window.__firstLogRow = el.querySelector('.vela-ap-log-row'); });
        await page.evaluate(() => window.__ws.cell('a').chart.orchestrator.events.emit('alert', { id: 'live', indicator: 'RSI', title: 'Signal', message: 'live update', time: Date.now() + 100 }));
        const during = await scroll.evaluate((el) => ({ top: el.scrollTop, rows: el.querySelectorAll('.vela-ap-log-row').length, same: el.querySelector('.vela-ap-log-row') === window.__firstLogRow }));
        await page.waitForTimeout(700);
        const settled = await scroll.evaluate((el) => ({ top: el.scrollTop, rows: el.querySelectorAll('.vela-ap-log-row').length, same: el.querySelector('.vela-ap-log-row') === window.__firstLogRow }));
        assert(initialRows === 40 && during.same && during.rows === 40 && settled.rows === 41 && !settled.same && settled.top > during.top + 2, 'live log repaint waits for a real touch flick and preserves momentum', { initialRows, duringBefore, during, settled });
        // A new row above a reading position should keep the same visible message anchored.
        const anchorBefore = await scroll.evaluate((el) => { const top = el.getBoundingClientRect().top; const row = [...el.querySelectorAll('[data-anchor]')].find((r) => r.getBoundingClientRect().bottom > top); return { key: row?.dataset.anchor, top: row?.getBoundingClientRect().top, scroll: el.scrollTop }; });
        await page.evaluate(() => window.__ws.cell('a').chart.orchestrator.events.emit('alert', { id: 'live2', indicator: 'RSI', title: 'Signal', message: 'newer event', time: Date.now() + 101 }));
        await page.waitForTimeout(400);
        const anchorAfter = await scroll.evaluate((el, key) => { const row = [...el.querySelectorAll('[data-anchor]')].find((r) => r.dataset.anchor === key); return { top: row?.getBoundingClientRect().top, scroll: el.scrollTop }; }, anchorBefore.key);
        assert(anchorAfter.top != null && Math.abs(anchorAfter.top - anchorBefore.top) < 2 && anchorAfter.scroll > anchorBefore.scroll, 'reading position stays anchored when a newer event arrives', { anchorBefore, anchorAfter });
        // A live event during a press must not remove the clear button before release.
        await scroll.evaluate((el) => { el.scrollTop = 0; }); await page.waitForTimeout(250);
        const clear = page.getByRole('button', { name: 'Clear every alert log entry' });
        const clearBox = await clear.boundingBox(), cx = clearBox.x + clearBox.width / 2, cy = clearBox.y + clearBox.height / 2;
        await clear.evaluate((el) => { window.__heldClear = el; });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        await page.waitForTimeout(60);
        await page.evaluate(() => window.__ws.cell('a').chart.orchestrator.events.emit('alert', { id: 'held', indicator: 'RSI', title: 'Signal', message: 'during press', time: Date.now() + 102 }));
        const stillHeld = await page.evaluate(() => window.__heldClear.isConnected);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(350);
        const afterClear = await page.evaluate(() => window.__ws.alertEntries().length);
        assert(stillHeld && afterClear === 0, 'live events cannot invalidate a held Clear all touch', { stillHeld, afterClear });
        await page.evaluate(() => { const bus = window.__ws.cell('a').chart.orchestrator.events; for (let i = 0; i < 60; i++) bus.emit('alert', { id: `cap${i}`, indicator: 'RSI', title: 'Signal', message: `cap ${i}`, time: Date.now() + i }); });
        await page.waitForTimeout(250);
        const cap = await page.evaluate(() => ({ retained: window.__ws.alertEntries().length, displayed: document.querySelectorAll('.vela-ap-log-row').length, badge: document.querySelector('.vela-mb-alerts .vela-mb-badge').textContent }));
        assert(cap.retained === 50 && cap.displayed === 50 && cap.badge === '9+', 'log retention cap and phone badge remain in sync', cap);
        await cdp.detach();
        facts.touch = { phoneCreated, initialRows, during, settled, anchorBefore, anchorAfter, stillHeld, afterClear, cap };
        await context.close();
    }
    {
        const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 1);
        const moduleUrl = `/@fs${resolve('src/workspace/VelaWorkspace.ts')}`;
        await page.evaluate(async (url) => {
            const { VelaWorkspace } = await import(url);
            const bars = window.__ws.active.chart.renderer.getBars().map((bar) => ({ ...bar }));
            window.__ws.destroy();
            const host = document.querySelector('#workspace'); host.replaceChildren();
            window.__newWorkspace = (topbar) => {
                window.__ws2?.destroy(); host.replaceChildren();
                window.__ws2 = new VelaWorkspace(host, { layout: '1', symbol: 'AAA', timeframe: '60', data: bars, live: false, topbar });
            };
            window.__newWorkspace({ left: ['symbol'], right: ['alerts', 'panels'] });
        }, moduleUrl);
        await page.waitForFunction(() => window.__ws2?.cells().length >= 1);
        const custom = await page.evaluate(() => ({ right: document.querySelector('.vela-topbar-right')?.contains(document.querySelector('.vela-widget-alerts')),
            bells: document.querySelectorAll('.vela-widget-alerts').length, duplicates: document.querySelectorAll('.vela-widget-panel-alerts').length }));
        assert(custom.right && custom.bells === 1 && custom.duplicates === 0, 'explicit host ordering is honored without a duplicate bell', custom);
        await page.locator('.vela-widget-alerts').click();
        const state = await page.evaluate(() => window.__ws2.getState());
        await page.locator('.vela-ap .vela-panel-close').click(); await page.waitForTimeout(200);
        await page.locator('.vela-workspace').focus(); await page.keyboard.press('Alt+a');
        await page.waitForSelector('.vela-ap:visible');
        assert(await page.getByRole('tab', { name: 'Create' }).getAttribute('aria-selected') === 'true', 'Alt+A opens the real Create tab when Alerts is available');
        await page.locator('.vela-ap .vela-panel-close').click(); await page.waitForTimeout(200);
        await page.evaluate((document) => window.__ws2.applyState(document), state);
        assert(await page.locator('.vela-ap').isVisible() && await page.locator('.vela-widget-alerts').getAttribute('aria-pressed') === 'true', 'open Alerts pane restores through standard dock state');
        await page.evaluate(() => window.__newWorkspace({ left: ['symbol'], right: ['panels'] }));
        await page.waitForFunction(() => window.__ws2?.cells().length >= 1);
        const hiddenDesktop = await page.evaluate(() => ({ bell: document.querySelectorAll('.vela-widget-alerts').length,
            panelButton: document.querySelectorAll('.vela-widget-panel-alerts').length, panel: document.querySelectorAll('.vela-ap').length }));
        assert(hiddenDesktop.bell === 0 && hiddenDesktop.panelButton === 0 && hiddenDesktop.panel === 0, 'composition-hidden alerts do not leak through the panels slot', hiddenDesktop);
        await page.locator('.vela-workspace').focus(); await page.keyboard.press('Alt+a'); await page.waitForTimeout(150);
        assert(await page.locator('.vela-ap').count() === 0, 'composition-hidden alert shortcut stays hidden');
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        const mobileCount = await page.locator('.vela-mb-alerts').count();
        await page.locator('.vela-mb-more').click();
        const moreCount = await page.locator('.vela-more-panel:visible .vela-md-row').filter({ hasText: /^Alerts$/ }).count();
        assert(mobileCount === 0 && moreCount === 0, 'composition also hides direct and More phone routes', { mobileCount, moreCount });
        facts.composition = { custom, hiddenDesktop, mobileCount, moreCount };
        await context.close();
    }
    assert(errors.length === 0, 'no browser page errors', errors);
    report('alerts-interaction', { ...facts, errors });
} finally { await browser.close(); }
