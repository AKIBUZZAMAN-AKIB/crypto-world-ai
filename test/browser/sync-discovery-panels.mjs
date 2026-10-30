// Docked discovery panes, real workspace actions and portrait/landscape transitions.
// Uses the real deterministic workspace; SYNC_BROWSER=webkit selects WebKit.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [];
const near = (a, b, n = 3) => Math.abs(a - b) <= n;
async function boot(viewport, phone = false, query = '') {
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', error => { if (!String(error).includes('ResizeObserver loop completed')) errors.push(String(error)); });
    await page.goto(OFFLINE + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}
async function drag(page, target, dx, dy) {
    const r = await target.boundingBox();
    if (!r) throw new Error('Drag target has no box');
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(100);
}
async function touchDrag(context, page, target, dx, dy) {
    if (engine === 'webkit') return drag(page, target, dx, dy);
    const r = await target.boundingBox();
    if (!r) throw new Error('Touch target has no box');
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach(); await page.waitForTimeout(400);
}
async function measure(panel) {
    return panel.evaluate(el => {
        const rect = node => node?.getBoundingClientRect().toJSON();
        const body = el.querySelector('.vela-panel-body');
        return {
            panel: rect(el), host: rect(el.parentElement), header: rect(el.querySelector('.vela-panel-header')),
            grip: rect(el.querySelector(':scope > .vela-panel-grip')), close: rect(el.querySelector('.vela-panel-close')),
            max: rect(el.querySelector('.vela-panel-max')), standard: el.hasAttribute('data-standard-pane'),
            floating: el.hasAttribute('data-free-floating'), maximized: el.hasAttribute('data-maximized'),
            radius: getComputedStyle(el).borderRadius, background: getComputedStyle(el).backgroundColor,
            bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
            pageW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            pageH: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
    });
}
async function openMore(page, text) {
    await page.locator('.vela-mb-more').click();
    await page.locator('.vela-more-panel:visible').getByText(text, { exact: true }).click();
}
try {
    // Every desktop door opens the same style of non-modal, directly resizable pane.
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        const specs = [
            ['indicators', '.vela-widget-indicators', '.vela-indicator-panel'],
            ['templates', '.vela-widget-templates', '.vela-templates-panel'],
            ['compare', '.vela-widget-compare', '.vela-compare-panel'],
            ['symbol', '.vela-widget-symbol', '.vela-symbol-panel'],
        ];
        facts.desktop = {};
        for (const [name, triggerSelector, paneSelector] of specs) {
            const trigger = page.locator(triggerSelector), pane = page.locator(paneSelector);
            await trigger.click(); await pane.waitFor({ state: 'visible' });
            const initial = await measure(pane);
            const relation = await trigger.evaluate((el, id) => ({ expanded: el.getAttribute('aria-expanded'), controls: el.getAttribute('aria-controls') === id }), await pane.getAttribute('id'));
            assert(initial.standard && !initial.floating && initial.radius === '0px' && initial.background !== 'rgba(0, 0, 0, 0)', `${name} starts as an opaque square dock`, initial);
            assert(relation.expanded === 'true' && relation.controls, `${name} button identifies its open pane`, relation);
            assert(await page.locator('.vela-ws-main').evaluate(el => !el.hasAttribute('inert')), `${name} is non-modal`);
            const seam = pane.locator('.vela-panel-resizer');
            await seam.focus(); await page.keyboard.press('ArrowLeft');
            const dockResized = await measure(pane);
            assert(Math.abs(dockResized.panel.width - initial.panel.width) >= 12, `${name} dock seam resizes`, { initial, dockResized });
            await pane.locator('.vela-panel-dock-toggle').click();
            const floating = await measure(pane);
            assert(floating.floating, `${name} floats explicitly`, floating);
            const corner = pane.locator('.vela-panel-corner-resize');
            assert(await corner.evaluate(el => el.previousElementSibling?.classList.contains('vela-panel-close')), `${name} has direct resize immediately after Close`);
            await drag(page, corner, -65, 75);
            const resized = await measure(pane);
            assert(resized.panel.width < floating.panel.width - 45 && resized.panel.height < floating.panel.height - 55, `${name} direct button resizes both axes`, { floating, resized });
            await corner.click();
            assert(await pane.locator('.vela-panel-size-control, .vela-size-control, input[type=range]').count() === 0, `${name} resize click opens no size popup`);
            if (name === 'indicators' || name === 'symbol') {
                await drag(page, corner, -500, 500);
                const compact = await pane.evaluate(el => {
                    const body = el.querySelector('.vela-panel-body'), list = el.querySelector('.vela-ip-list,.vela-sp-list');
                    return { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
                        bodyClient: body.clientHeight, bodyScroll: body.scrollHeight, listClient: list.clientHeight,
                        overflow: getComputedStyle(body).overflow };
                });
                assert(compact.width <= 162 && compact.height <= 114 && compact.overflow === 'auto' && compact.bodyScroll > compact.bodyClient && compact.listClient >= 100,
                    `${name} keeps its list reachable at minimum floating size`, compact);
                const smallAction = name === 'indicators' ? pane.locator('.vela-ip-row[data-library] .vela-ip-star').first()
                    : pane.locator('.vela-sp-row[data-i="0"] .vela-sp-star');
                await smallAction.scrollIntoViewIfNeeded(); await smallAction.click();
                assert(await pane.isVisible(), `${name} compact child action is reachable and keeps the pane open`);
            }
            await drag(page, pane.locator('.vela-panel-title'), 0, 900);
            const moved = await measure(pane);
            assert(moved.header.top >= 0 && moved.header.bottom <= 800 && moved.header.right <= 1281 && moved.pageW <= 1 && moved.pageH <= 1,
                `${name} keeps its full header visible without page overflow`, moved);
            await pane.locator('.vela-panel-dock-toggle').click();
            assert(!(await measure(pane)).floating, `${name} returns to the dock`);
            await pane.locator('.vela-panel-close').click();
            assert(await trigger.getAttribute('aria-expanded') === 'false', `${name} close updates its trigger`);
            facts.desktop[name] = { width: initial.panel.width, resized: [Math.round(resized.panel.width), Math.round(resized.panel.height)] };
        }

        // Indicators: independent stars, keyboard-operable rows, and a separate Templates entry.
        await page.locator('.vela-widget-indicators').click();
        const indicators = page.locator('.vela-indicator-panel');
        await indicators.locator('.vela-ip-search').fill('Exponential Moving Average');
        const row = indicators.locator('.vela-ip-row[data-library]').first();
        await row.waitFor({ state: 'visible' });
        const before = await page.evaluate(() => window.__ws.active.chart.indicators().length);
        await row.locator('.vela-ip-star').click();
        assert(await page.evaluate(() => window.__ws.active.chart.indicators().length) === before, 'Indicator favorite does not add an instance');
        const pick = indicators.locator('.vela-ip-row[data-library] .vela-ip-pick').first();
        await pick.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(count => window.__ws.active.chart.indicators().length > count, before);
        assert(await indicators.isVisible(), 'Adding an indicator keeps its pane open');
        await indicators.locator('.vela-ip-row[data-instance] .vela-ip-gear').first().click();
        const settings = page.locator('.vela-ind-dialog'); await settings.waitFor({ state: 'visible' });
        assert(await indicators.isVisible(), 'Opening indicator settings keeps its parent pane open');
        await settings.locator('.vela-dialog-close').click(); await settings.waitFor({ state: 'hidden' });
        assert(await indicators.isVisible(), 'Closing the child form returns to the indicator pane');
        const activeTab = indicators.locator('[role="tab"][aria-selected="true"]');
        const tabInfo = await activeTab.evaluate(el => ({ id: el.id, view: el.getAttribute('aria-controls'), labelled: document.getElementById(el.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') }));
        assert(tabInfo.id === tabInfo.labelled && !!tabInfo.view, 'Indicator tabs identify their active view', tabInfo);
        await activeTab.focus(); await page.keyboard.press('Home');
        assert(await indicators.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label') === 'Favourites', 'Indicator tabs support Home');
        assert(await indicators.locator('[role="tab"][data-templates]').count() === 0, 'Templates is not merged into the Indicators tabs');
        await indicators.locator('.vela-panel-dock-toggle').click();

        // The familiar Templates entry remains, but opens its own primary pane.
        await indicators.locator('.vela-ip-templates-door').click();
        const templates = page.locator('.vela-templates-panel'); await templates.waitFor({ state: 'visible' });
        assert(await indicators.isVisible() && await indicators.locator('.vela-ip-searchrow').isVisible(),
            'Opening the separate templates pane keeps a floating Indicators pane and its catalog open');
        await templates.locator('.vela-tm-save').click();
        await templates.locator('.vela-tm-input').fill('Desk');
        await templates.locator('.vela-tm-primary').click();
        await templates.locator('.vela-tm-item[data-name="Desk"]').waitFor();
        await templates.locator('.vela-tm-item[data-name="Desk"] .vela-tm-kebab').click();
        assert(await templates.isVisible() && await templates.locator('.vela-tm-chip').count() >= 3, 'Template actions stay compact inside the parent pane');
        await templates.locator('.vela-tm-chip').filter({ hasText: 'Rename' }).click();
        const rename = templates.locator('.vela-tm-input');
        assert(await rename.evaluate(el => !el.closest('button')), 'Template rename field is not nested in an interactive button');
        await rename.fill('Desk renamed'); await rename.press('Enter');
        await templates.locator('.vela-tm-item[data-name="Desk renamed"]').waitFor();
        await templates.locator('.vela-tm-item[data-name="Desk renamed"] .vela-tm-star').click();
        assert(await templates.locator('.vela-tm-item[data-name="Desk renamed"] .vela-tm-star').getAttribute('aria-pressed') === 'true', 'Template default star updates without applying');
        const selected = templates.locator('[role="tab"][aria-selected="true"]');
        await selected.focus(); await page.keyboard.press('End');
        assert(await templates.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab') === 'financial', 'Template tabs support End');
        await templates.locator('[data-tab="my"]').click();
        await templates.locator('.vela-tm-item[data-name="Desk renamed"] .vela-tm-kebab').click();
        await templates.locator('.vela-tm-chip').filter({ hasText: 'Apply to all charts' }).click();
        assert(await templates.isVisible(), 'Apply-to-all feedback keeps the template pane open');
        await templates.locator('.vela-panel-dock-toggle').click();
        await drag(page, templates.locator('.vela-panel-title'), 0, -450);
        await drag(page, templates.locator('.vela-panel-corner-resize'), -500, 500);
        const tinyTemplate = await templates.boundingBox();
        const tinyKebab = templates.locator('.vela-tm-item[data-name="Desk renamed"] .vela-tm-kebab');
        await tinyKebab.focus(); await tinyKebab.scrollIntoViewIfNeeded(); await tinyKebab.click();
        assert(tinyTemplate.width <= 162 && tinyTemplate.height <= 114 && await templates.locator('.vela-tm-chip').count() >= 3,
            'Template row actions remain reachable in a minimum-size floating pane', tinyTemplate);
        await templates.locator('.vela-panel-dock-toggle').click();
        await indicators.locator('.vela-panel-close').click();

        // Compare is bound to the active chart; Symbol Search returns to it after a choice or cancel.
        await page.locator('.vela-widget-compare').click();
        const compare = page.locator('.vela-compare-panel');
        await compare.locator('.vela-cmp-sym').click();
        const search = page.locator('.vela-symbol-panel'); await search.waitFor({ state: 'visible' });
        assert(await search.getAttribute('aria-label') === 'Compare with', 'Compare search is clearly titled');
        assert(await search.locator('.vela-sp-watch').count() === 1 && await search.locator('.vela-sp-watchall').count() === 0,
            'Compare retains the watchlist but cannot replace all primary chart markets');
        const basePair = await page.evaluate(() => window.__ws.active.symbol);
        await search.locator('.vela-sp-input').fill('BBB');
        await search.locator('.vela-sp-pick').first().click();
        await compare.waitFor({ state: 'visible' });
        assert((await compare.locator('.vela-cmp-sym-name').innerText()).includes('BBB'), 'Compare selection returns to the Compare pane');
        assert(await page.evaluate(() => window.__ws.active.symbol) === basePair, 'Compare selection does not swap the primary market');
        for (const mode of ['own-scale', 'new-pane', 'same-percent']) {
            await compare.locator(`[data-display="${mode}"]`).click();
            assert(await compare.locator(`[data-display="${mode}"]`).getAttribute('aria-pressed') === 'true', `Compare ${mode} mode works`);
        }
        await compare.locator('.vela-panel-dock-toggle').click();
        await drag(page, compare.locator('.vela-panel-title'), 0, -450);
        await drag(page, compare.locator('.vela-panel-corner-resize'), -500, 500);
        const tinyCompare = await compare.boundingBox(), ownScale = compare.locator('[data-display="own-scale"]');
        await ownScale.scrollIntoViewIfNeeded(); await ownScale.click();
        assert(tinyCompare.width <= 162 && tinyCompare.height <= 114 && await ownScale.getAttribute('aria-pressed') === 'true',
            'Compare modes remain reachable in a minimum-size floating pane', tinyCompare);
        await compare.locator('.vela-panel-dock-toggle').click();
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        assert((await compare.locator('.vela-cmp-sym-name').innerText()).includes('Choose'), 'Compare pane follows another active chart');
        await page.evaluate(() => window.__ws.setActiveCell('a'));
        assert((await compare.locator('.vela-cmp-sym-name').innerText()).includes('BBB'), 'Compare pane restores the first chart state');
        await compare.locator('.vela-cmp-sym').click();
        await search.locator('.vela-sp-input').focus(); await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        if (await search.isVisible() && !(await compare.isVisible())) await page.keyboard.press('Escape');
        await compare.waitFor({ state: 'visible' });
        await page.locator('.vela-widget-symbol').click();
        assert(await search.getAttribute('aria-label') === 'Symbol Search', 'Primary search clears a canceled compare context');
        await search.locator('.vela-sp-input').fill('CCC');
        await search.locator('.vela-sp-pick').first().click();
        await page.waitForFunction(() => window.__ws.active.symbol.endsWith('CCC'));
        assert((await page.evaluate(() => window.__ws.active.chart.indicators().filter(h => h.nativeType === 'compare').length)) === 1,
            'After cancel, a primary-symbol pick does not create another comparison');

        // Watchlist and keyboard highlighting remain independent from the search result rows.
        await page.locator('.vela-widget-symbol').click();
        await search.locator('.vela-sp-input').fill('BBB');
        const star = search.locator('.vela-sp-row[data-i="0"] .vela-sp-star');
        const pairBeforeStar = await page.evaluate(() => window.__ws.active.symbol);
        await star.click();
        assert(await page.evaluate(() => window.__ws.active.symbol) === pairBeforeStar, 'Watchlist star does not select a market');
        await search.locator('.vela-panel-close').click();
        await page.locator('.vela-widget-symbol').click();
        const watch = search.locator('.vela-sp-watch'); await watch.waitFor({ state: 'visible' });
        const rows = await search.locator('.vela-sp-row').evaluateAll(els => els.slice(0, 2).map(el => ({ index: el.dataset.i, symbol: el.dataset.ticker, highlighted: el.hasAttribute('data-highlighted') })));
        assert(rows[0]?.index === '0' && rows[0]?.symbol === 'AAA' && rows[0]?.highlighted, 'Watchlist does not displace the first result or its highlight', rows);
        assert(await search.locator('.vela-sp-watchall').count() > 0, 'Normal search retains watchlist load on all charts');
        const field = search.locator('.vela-sp-input'); await field.focus(); await page.keyboard.press('ArrowDown');
        assert(await search.locator('.vela-sp-row[data-highlighted]').getAttribute('data-i') === '1', 'Search arrow moves to the actual second result');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__ws.active.symbol.endsWith('BBB'));
        await page.locator('.vela-widget-compare').click();
        const primaryBeforeRemove = await page.evaluate(() => window.__ws.active.symbol);
        await compare.locator('.vela-cmp-remove').click();
        assert(await page.evaluate(() => window.__ws.active.chart.indicators().filter(h => h.nativeType === 'compare').length) === 0 &&
            await page.evaluate(() => window.__ws.active.symbol) === primaryBeforeRemove, 'Removing Compare leaves the primary pair unchanged');
        facts.search = { watchlist: true, firstRows: rows };
        await context.close();
    }

    // Portrait: all four doors use one bottom-attached pane, a separate resize strip, and fullscreen/restore.
    {
        const { context, page } = await boot({ width: 390, height: 844 }, true);
        const specs = [
            ['indicators', '.vela-indicator-panel', async () => page.locator('.vela-mb-indicators').click()],
            ['symbol', '.vela-symbol-panel', async () => page.locator('.vela-mb-symbol').click()],
            ['templates', '.vela-templates-panel', async () => openMore(page, 'Indicator templates')],
            ['compare', '.vela-compare-panel', async () => openMore(page, 'Compare')],
        ];
        facts.phone = {};
        for (const [name, selector, open] of specs) {
            await open(); const pane = page.locator(selector); await pane.waitFor({ state: 'visible' });
            const initial = await measure(pane);
            assert(initial.standard && near(initial.panel.bottom, initial.host.bottom) && near(initial.panel.left, initial.host.left)
                && near(initial.panel.width, initial.host.width) && near(initial.grip.bottom, initial.header.top) && initial.grip.height >= 23,
                `${name} is bottom-attached with its own grip above the heading`, initial);
            assert(initial.max.right <= initial.close.left + 1 && initial.pageW <= 1 && initial.pageH <= 1, `${name} has fullscreen left of Close and no page overflow`, initial);
            const old = initial.panel;
            await touchDrag(context, page, pane.locator('.vela-panel-title'), 0, -90);
            const afterTitle = await measure(pane);
            assert(near(afterTitle.panel.top, old.top) && near(afterTitle.panel.bottom, old.bottom), `${name} heading does not detach or resize the phone pane`, { initial, afterTitle });
            await touchDrag(context, page, pane.locator(':scope > .vela-panel-grip'), 0, -120);
            const resized = await measure(pane);
            assert(resized.panel.height > old.height + 70 && near(resized.panel.bottom, old.bottom), `${name} grip resizes upward while the bottom stays attached`, { initial, resized });
            await pane.locator('.vela-panel-max').click();
            assert((await measure(pane)).maximized, `${name} can enter fullscreen`);
            await pane.locator('.vela-panel-max').click();
            const restored = await measure(pane);
            assert(!restored.maximized && near(restored.panel.bottom, restored.host.bottom) && near(restored.panel.height, resized.panel.height, 5), `${name} restores its attached size`, restored);
            facts.phone[name] = { height: Math.round(initial.panel.height), resized: Math.round(resized.panel.height) };
            await pane.locator('.vela-panel-close').click();
        }
        await openMore(page, 'Compare');
        const compare = page.locator('.vela-compare-panel'); await compare.locator('.vela-cmp-sym').click();
        const search = page.locator('.vela-symbol-panel');
        assert(await search.isVisible() && !(await compare.isVisible()), 'Phone compare hands the single pane to symbol search');
        await search.locator('.vela-sp-input').fill('BBB');
        await search.locator('.vela-sp-pick').first().click(); await compare.waitFor({ state: 'visible' });
        assert((await compare.locator('.vela-cmp-sym-name').innerText()).includes('BBB'), 'Phone returns to Compare after selection');
        await compare.locator('.vela-panel-close').click();
        await page.locator('.vela-mb-indicators').click();
        const indicators = page.locator('.vela-indicator-panel');
        await indicators.locator('.vela-ip-row[data-instance] .vela-ip-gear').first().click();
        const settings = page.locator('.vela-ind-dialog'); await settings.waitFor({ state: 'visible' });
        assert(await indicators.isVisible(), 'Phone indicator settings preserves its parent pane');
        await settings.locator('.vela-dialog-close').click(); await settings.waitFor({ state: 'hidden' });
        assert(await indicators.isVisible(), 'Phone returns to Indicators after closing its child form');
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        assert(await indicators.isVisible() && !(await measure(indicators)).floating, 'Indicator pane survives portrait-to-landscape transition');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        const rotated = await measure(indicators);
        assert(await indicators.isVisible() && near(rotated.panel.bottom, rotated.host.bottom), 'Indicator pane remains bottom-attached after rotating back', rotated);
        await indicators.locator('.vela-panel-close').click();
        await page.locator('.vela-mb-symbol').click();
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        assert(await page.locator('.vela-symbol-panel').isVisible(), 'Symbol Search survives rotation too');
        await context.close();
    }

    // An open pane must also restore safely during synchronous workspace boot.
    {
        const { context, page } = await boot({ width: 1280, height: 800 }, false, '?persist=1');
        await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        await page.locator('.vela-widget-indicators').click();
        await page.locator('.vela-indicator-panel .vela-panel-dock-toggle').click();
        await drag(page, page.locator('.vela-indicator-panel .vela-panel-corner-resize'), -45, 60);
        const before = await measure(page.locator('.vela-indicator-panel'));
        await page.evaluate(() => window.__ws.destroy());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        const restored = page.locator('.vela-indicator-panel'); await restored.waitFor({ state: 'visible' });
        const after = await measure(restored);
        assert(after.floating && near(after.panel.width, before.panel.width, 3) && near(after.panel.height, before.panel.height, 4), 'Open indicator pane and float geometry restore on boot', { before, after });
        assert(await restored.locator('.vela-ip-row').count() > 0, 'Restored indicator pane rebinds once the active chart exists');
        facts.persist = { before: [Math.round(before.panel.width), Math.round(before.panel.height)], after: [Math.round(after.panel.width), Math.round(after.panel.height)] };
        await context.close();
    }
    assert(errors.length === 0, 'No page errors in desktop, phone or restored workspace', errors);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    report(`discovery-panels-${engine}`, { ...facts, errors });
    await browser.close();
}
