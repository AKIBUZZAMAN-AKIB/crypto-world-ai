// Desktop floating panels may extend beyond the viewport, but must not enlarge or scroll
// the host page. Uses the existing offline workspace, including an embedded host case.
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [];
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
async function boot() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.waitForTimeout(350);
    return { context, page };
}
async function drag(page, locator, dx, dy) {
    const r = await locator.boundingBox();
    if (!r) throw new Error('Missing drag target');
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 15 }); await page.mouse.up();
    await page.waitForTimeout(180);
}
async function layout(page, panel) {
    const info = await panel.evaluate((el) => {
        const header = el.querySelector('.vela-panel-header,.vela-dialog-header');
        const workspace = el.closest('.vela-workspace');
        const rect = (node) => node.getBoundingClientRect().toJSON();
        return { panel: rect(el), header: rect(header), workspace: rect(workspace),
            document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
                clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
                x: window.scrollX, y: window.scrollY },
            layout: workspace.dataset.layout };
    });
    return info;
}
function insideHeader(info) {
    const h = info.header;
    return h.left >= -1 && h.right <= info.document.clientWidth + 1 && h.top >= -1 && h.bottom <= info.document.clientHeight + 1;
}
async function verifyPluginPopover(page, tree, hostName) {
    // A plugin may host a fixed popover inside a panel. Layout containment must not
    // displace it relative to its trigger, even when its containing block has an offset.
    await page.evaluate(async (fallbackUrl) => {
        const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
            .find((name) => name.includes('/src/ui/components/popover/view.ts')) ?? fallbackUrl;
        const { Popover } = await import(moduleUrl);
        const panel = document.querySelector('.vela-panel.vela-ot');
        const pop = new Popover({ trigger: panel.querySelector('.vela-panel-close'), host: panel.querySelector('.vela-panel-body'),
            gap: 8, content: (body) => { body.textContent = 'Plugin action'; body.style.cssText = 'width:100px;height:32px;'; } });
        pop.show(); window.__overflowTestPopover = pop;
    }, `/@fs${resolve('src/ui/components/popover/view.ts')}`);
    const pluginTrigger = await tree.locator('.vela-panel-close').boundingBox();
    const pluginPopover = await page.locator('.vela-popover').boundingBox();
    assert(pluginPopover && (near(pluginPopover.y, pluginTrigger.y + pluginTrigger.height + 8, 2) ||
        near(pluginPopover.y + pluginPopover.height, pluginTrigger.y - 8, 2)),
        'fixed plugin popovers remain anchored inside a layout-contained panel', { hostName, pluginTrigger, pluginPopover });
    await page.evaluate(() => { window.__overflowTestPopover.el.style.translate = '10px 12px'; window.__overflowTestPopover.reposition(); });
    const shifted = await page.locator('.vela-popover').boundingBox();
    await page.evaluate(() => window.__overflowTestPopover.reposition());
    const repeated = await page.locator('.vela-popover').boundingBox();
    assert(near(shifted.x, pluginPopover.x + 10) && near(shifted.y, pluginPopover.y + 12) &&
        near(repeated.x, shifted.x) && near(repeated.y, shifted.y),
        'reanchoring preserves a user translation without accumulating drift', { hostName, pluginPopover, shifted, repeated });
    await page.evaluate(() => { window.__overflowTestPopover.destroy(); delete window.__overflowTestPopover; });
}
try {
    {
        const { context, page } = await boot();
        const baseline = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
        await page.locator('.vela-widget-panel-objects').click();
        const tree = page.locator('.vela-panel.vela-ot'); await tree.locator('.vela-panel-dock-toggle').click();
        await page.waitForTimeout(200);
        const original = await layout(page, tree);
        await verifyPluginPopover(page, tree, 'desktop');
        await drag(page, tree.locator('.vela-panel-title'), 0, 1000);
        const moved = await layout(page, tree);
        assert(moved.layout === 'desktop' && insideHeader(moved) && moved.panel.bottom > moved.document.clientHeight + 50 &&
            near(moved.panel.height, original.panel.height), 'floating body can extend off-screen without moving or shrinking its visible header', { original, moved });
        assert(moved.document.height <= baseline.h + 1 && moved.document.width <= baseline.w + 1,
            'off-screen floating panel does not enlarge the page', { baseline, moved });
        await page.evaluate(() => window.scrollTo(200, 500)); await page.waitForTimeout(180);
        const afterScroll = await layout(page, tree);
        assert(afterScroll.document.y === 0 && afterScroll.document.x === 0 && near(afterScroll.panel.top, moved.panel.top),
            'the whole page stays still even when a scroll is requested', { moved, afterScroll });
        const savedPosition = await page.evaluate(() => JSON.stringify(window.__ws.getState().panels.floatPositions.objects));
        const treeAction = tree.locator('.vela-panel-body .vela-ot-row[tabindex]').last(); await treeAction.focus(); await page.waitForTimeout(100);
        const focusBox = await treeAction.boundingBox(), focusedPanel = await layout(page, tree);
        assert(focusBox && focusBox.y >= 0 && focusBox.y + focusBox.height <= 800 && insideHeader(focusedPanel) && focusedPanel.document.y === 0 &&
            await treeAction.evaluate((el) => document.activeElement === el) &&
            await page.evaluate(() => JSON.stringify(window.__ws.getState().panels.floatPositions.objects)) === savedPosition,
            'keyboard focus reveals an off-screen panel control without scrolling the page or saving a different position', { focusBox, focusedPanel });
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(120);
        await page.locator('.vela-widget-panel-dataWindow').click();
        const data = page.locator('.vela-panel.vela-dw'); await data.locator('.vela-panel-dock-toggle').click(); await page.waitForTimeout(160);
        await drag(page, data.locator('.vela-panel-title'), 0, 1000);
        const both = await layout(page, data);
        assert(await tree.isVisible() && await data.isVisible() && both.document.height <= baseline.h + 1 && insideHeader(both),
            'multiple floating panels remain open without adding page overflow', both);
        await tree.locator('.vela-panel-header').focus();
        const beforeKeyboard = await tree.boundingBox(); await page.keyboard.press('Shift+ArrowUp');
        assert((await tree.boundingBox()).y < beforeKeyboard.y - 30, 'the off-screen floating panel remains keyboard movable');
        facts.desktop = { baseline, original, moved, afterScroll, both };
        await context.close();
    }
    {
        const { context, page } = await boot();
        const baseline = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
        await page.locator('.vela-bb-settings').click();
        const settings = page.locator('.vela-dialog--settings'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
        const before = await layout(page, settings);
        await drag(page, settings.locator('.vela-dialog-title'), 0, 1000);
        const moved = await layout(page, settings);
        assert(insideHeader(moved) && moved.panel.bottom > moved.document.clientHeight + 50 && near(moved.panel.height, before.panel.height),
            'desktop Settings also allows the body off-screen with its entire header visible', { before, moved });
        assert(moved.document.height <= baseline.h + 1 && moved.document.width <= baseline.w + 1,
            'off-screen Settings does not enlarge the page', { baseline, moved });
        await page.mouse.move(20, 20); await page.mouse.wheel(0, 350); await page.waitForTimeout(200);
        await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(180);
        const afterScroll = await layout(page, settings);
        assert(afterScroll.document.y === 0 && near(afterScroll.panel.top, moved.panel.top), 'Settings does not scroll the page on wheel or scrollTo', { moved, afterScroll });
        const settingAction = settings.locator('.vela-sd-pane input:not([type="hidden"]), .vela-sd-pane button').first();
        await settingAction.focus(); await page.waitForTimeout(100);
        const focusBox = await settingAction.boundingBox(), focusedPanel = await layout(page, settings);
        assert(focusBox && focusBox.y >= 0 && focusBox.y + focusBox.height <= 800 && insideHeader(focusedPanel) && focusedPanel.document.y === 0 &&
            await settingAction.evaluate((el) => document.activeElement === el),
            'keyboard focus reveals an off-screen Settings control while keeping the header visible and page still', { focusBox, focusedPanel });
        await page.evaluate(() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 600 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(180);
        const zoomedPanel = await layout(page, settings), zoomedFocus = await settingAction.boundingBox();
        assert(zoomedFocus.y >= 0 && zoomedFocus.y + zoomedFocus.height <= 600 && zoomedPanel.header.bottom <= 600 && zoomedPanel.document.y === 0,
            'a reduced visual viewport keeps the focused Settings control and whole header visible without scrolling', { zoomedPanel, zoomedFocus });
        await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForTimeout(180);
        const recoveredPanel = await layout(page, settings);
        assert(near(recoveredPanel.panel.top, focusedPanel.panel.top) && recoveredPanel.document.y === 0,
            'restoring the visual viewport recovers the temporary focus placement', { focusedPanel, recoveredPanel });
        const pane = settings.locator('.vela-sd-pane'), paneBox = await pane.boundingBox();
        const paneBefore = await pane.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
        await page.mouse.move(paneBox.x + 12, Math.min(780, paneBox.y + 35)); await page.mouse.wheel(0, 240); await page.waitForTimeout(200);
        const paneAfter = await pane.evaluate((el) => ({ top: el.scrollTop, page: window.scrollY }));
        assert(paneBefore.max > 10 && paneAfter.top > paneBefore.top + 10 && paneAfter.page === 0,
            'Settings content continues to scroll independently while the page stays still', { paneBox, paneBefore, paneAfter });
        await drag(page, settings.locator('.vela-dialog-title'), 0, -500);
        const returned = await layout(page, settings);
        assert(returned.panel.top < focusedPanel.panel.top - 100 && insideHeader(returned) && returned.document.y === 0,
            'Settings can be dragged back on-screen normally', { focusedPanel, returned });
        facts.settings = { before, moved, afterScroll, focusedPanel, focusBox, paneBefore, paneAfter, returned };
        await context.close();
    }
    for (const transform of ['none', 'translateZ(0)']) {
        const { context, page } = await boot();
        await page.evaluate((value) => Object.assign(document.querySelector('#workspace').style,
            { inset: 'auto', left: '150px', top: '100px', width: '850px', height: '500px', transform: value }), transform);
        await page.waitForTimeout(300);
        const baseline = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
        await page.evaluate(() => window.__ws.topbar.openLayoutMenu());
        const layoutMenu = page.locator('.vela-lm:visible'); await layoutMenu.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
        await drag(page, layoutMenu.locator('.vela-lm-title'), 0, 1000);
        const menuOverflow = await layoutMenu.evaluate((el) => ({ panel: el.getBoundingClientRect().toJSON(),
            header: el.querySelector('.vela-lm-head').getBoundingClientRect().toJSON(), height: document.documentElement.scrollHeight,
            width: document.documentElement.scrollWidth, y: window.scrollY }));
        assert(menuOverflow.panel.bottom > 850 && menuOverflow.header.bottom <= 801 && menuOverflow.height <= baseline.h + 1 &&
            menuOverflow.width <= baseline.w + 1 && menuOverflow.y === 0,
            'a dragged layout popover does not enlarge the page even inside a transformed host', { transform, baseline, menuOverflow });
        const menuAction = layoutMenu.locator('.vela-lm-row').last(); await menuAction.focus(); await page.waitForTimeout(120);
        const menuFocused = await menuAction.boundingBox(), menuHeaderFocused = await layoutMenu.locator('.vela-lm-head').boundingBox();
        assert(menuFocused.y >= 0 && menuFocused.y + menuFocused.height <= 800 && menuHeaderFocused.y >= 0 &&
            menuHeaderFocused.y + menuHeaderFocused.height <= 800 && await menuAction.evaluate((el) => document.activeElement === el) &&
            await page.evaluate(() => window.scrollY === 0),
            'keyboard focus reveals an off-screen layout action without scrolling the page', { transform, menuFocused, menuHeaderFocused });
        await page.keyboard.press('Escape'); await page.waitForTimeout(180);
        if (await layoutMenu.isVisible()) { await page.keyboard.press('Escape'); await page.waitForTimeout(180); }
        await page.evaluate(() => { document.body.style.minHeight = '1200px'; window.scrollTo(0, 0); window.__ws.topbar.openLayoutMenu(); });
        await layoutMenu.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
        const menuBeforeScroll = await layoutMenu.boundingBox();
        await page.evaluate(() => window.scrollTo(0, 100)); await page.waitForTimeout(200);
        const menuAfterScroll = await layoutMenu.boundingBox();
        assert(await page.evaluate(() => window.scrollY) >= 90 && near(menuAfterScroll.y, menuBeforeScroll.y - 100),
            'an open layout popover follows its trigger on a genuinely scrolling host page', { transform, menuBeforeScroll, menuAfterScroll });
        await page.keyboard.press('Escape'); await page.waitForTimeout(180);
        await page.evaluate(() => { window.scrollTo(0, 0); document.body.style.minHeight = ''; }); await page.waitForTimeout(150);
        // The unified Layout setup is a real panel too; exercise its floating overflow
        // and focused content in both offset and transformed embedded hosts.
        await page.locator('button[aria-label^="Layout —"]').click();
        const setup = page.locator('.vela-layout-setup'); await setup.waitFor({ state: 'visible' });
        await setup.locator('.vela-panel-dock-toggle').click();
        await drag(page, setup.locator('.vela-panel-corner-resize'), 0, -140);
        await drag(page, setup.locator('.vela-panel-title'), 0, 700);
        const setupMoved = await layout(page, setup);
        assert(insideHeader(setupMoved) && setupMoved.panel.bottom > setupMoved.document.clientHeight + 25 &&
            setupMoved.document.height <= baseline.h + 1 && setupMoved.document.width <= baseline.w + 1,
            'embedded floating Layout setup retains its header and cannot enlarge the page', { transform, setupMoved, baseline });
        const setupAction = setup.locator('.vela-ls-manager');
        await setupAction.evaluate((el) => el.focus()); await page.waitForTimeout(180);
        const setupFocused = await setupAction.boundingBox(), setupAfterFocus = await layout(page, setup);
        assert(setupFocused.y >= 0 && setupFocused.y + setupFocused.height <= 800 && insideHeader(setupAfterFocus) &&
            setupAfterFocus.document.y === 0 && await setupAction.evaluate((el) => document.activeElement === el),
            'keyboard focus reveals an off-screen setup action without scrolling the page', { transform, setupFocused, setupAfterFocus });
        await setup.locator('.vela-panel-close').click();
        await page.locator('.vela-widget-panel-objects').click();
        const tree = page.locator('.vela-panel.vela-ot'); await tree.locator('.vela-panel-dock-toggle').click(); await page.waitForTimeout(160);
        await verifyPluginPopover(page, tree, transform);
        await drag(page, tree.locator('.vela-panel-corner-resize'), 0, -120);
        await drag(page, tree.locator('.vela-panel-title'), 0, 700);
        const moved = await layout(page, tree);
        const point = await tree.evaluate((el) => {
            const r = el.getBoundingClientRect(), ws = el.closest('.vela-workspace').getBoundingClientRect();
            const x = r.left + r.width / 2, y = ws.bottom + 40, hit = document.elementFromPoint(x, y);
            return { x, y, withinViewport: y < innerHeight, insidePanel: !!hit && el.contains(hit), hit: hit?.className };
        });
        assert(point.withinViewport && point.insidePanel && moved.panel.bottom > moved.document.clientHeight + 25 && insideHeader(moved),
            'an embedded panel remains visible outside its workspace wherever the screen has room', { moved, point });
        assert(moved.document.height <= baseline.h + 1 && moved.document.width <= baseline.w + 1,
            'an embedded off-screen panel does not grow the host page', { baseline, moved });
        await page.locator('.vela-widget-symbol').click();
        const symbol = page.locator('.vela-symbol-panel');
        await symbol.waitFor({ state: 'visible' });
        await symbol.locator('.vela-panel-dock-toggle').click(); await page.waitForTimeout(180);
        await drag(page, symbol.locator('.vela-panel-corner-resize'), 0, -120);
        await drag(page, symbol.locator('.vela-panel-title'), 0, 900);
        const embeddedSymbol = await layout(page, symbol);
        assert(insideHeader(embeddedSymbol) && embeddedSymbol.panel.bottom > embeddedSymbol.document.clientHeight + 25 &&
            embeddedSymbol.document.height <= baseline.h + 1 && embeddedSymbol.document.width <= baseline.w + 1,
            'a floating Symbol Search pane does not enlarge the page even in a transformed host', { transform, baseline, embeddedSymbol });
        await symbol.locator('.vela-panel-close').click(); await page.waitForTimeout(180);
        await page.locator('.vela-bb-settings').click();
        const settings = page.locator('.vela-dialog--settings'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
        await drag(page, settings.locator('.vela-dialog-title'), 0, 700);
        const embeddedSettings = await layout(page, settings);
        const settingsPoint = await settings.evaluate((el) => {
            const r = el.getBoundingClientRect(), ws = el.closest('.vela-workspace').getBoundingClientRect();
            const x = r.left + r.width / 2, y = ws.bottom + 40, hit = document.elementFromPoint(x, y);
            return { x, y, withinViewport: y < innerHeight, insidePanel: !!hit && el.contains(hit), hit: hit?.className };
        });
        assert(insideHeader(embeddedSettings) && embeddedSettings.header.bottom <= embeddedSettings.workspace.bottom + 1 &&
            settingsPoint.withinViewport && settingsPoint.insidePanel && embeddedSettings.panel.bottom > embeddedSettings.document.clientHeight + 25 &&
            embeddedSettings.document.height <= baseline.h + 1 && embeddedSettings.document.width <= baseline.w + 1,
            'embedded Settings keeps its header, visible overflow and page extent correct, including with transformed hosts',
            { transform, embeddedSettings, settingsPoint, baseline });
        await page.evaluate(() => { document.body.style.minHeight = '1200px'; window.scrollTo(0, 0); });
        await page.waitForTimeout(200);
        const scrollBefore = await layout(page, tree), settingsScrollBefore = await layout(page, settings);
        await page.evaluate(() => window.scrollTo(0, 100)); await page.waitForTimeout(250);
        const scrollAfter = await layout(page, tree), settingsScrollAfter = await layout(page, settings);
        assert(scrollAfter.document.y >= 90 && near(scrollAfter.panel.top, scrollBefore.panel.top - scrollAfter.document.y) &&
            near(settingsScrollAfter.panel.top, settingsScrollBefore.panel.top - scrollAfter.document.y) &&
            near(scrollAfter.workspace.top, scrollBefore.workspace.top - scrollAfter.document.y),
            'a genuinely scrollable embedding page still scrolls and both panels stay anchored to their workspace',
            { transform, scrollBefore, scrollAfter, settingsScrollBefore, settingsScrollAfter });
        facts[`embedded-${transform}`] = { baseline, moved, point, embeddedSettings, settingsPoint, scrollBefore, scrollAfter };
        await context.close();
    }
    assert(errors.length === 0, 'no uncaught browser errors', errors);
    report('panel-page-overflow', { engine, ...facts, errors });
} finally { await browser.close(); }
