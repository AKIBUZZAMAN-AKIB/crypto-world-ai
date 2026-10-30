// Real direct resizing, off-screen movement and mobile fullscreen/restore.
// Exercises the existing offline workspace, not a purpose-built HTML fixture.
// SYNC_BROWSER=webkit selects WebKit; Chromium additionally runs real touch gestures.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
const bottom = (r) => r.y + r.height;
async function boot(viewport, touch = false, params = '') {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(`${OFFLINE}${params}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}
async function mouseDrag(page, target, dx, dy) {
    const r = await target.boundingBox();
    if (!r) throw new Error('Missing drag target');
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(120);
}
async function touchDrag(context, page, target, dx, dy, point = null) {
    if (engine === 'webkit' && !point) return mouseDrag(page, target, dx, dy);
    const r = await target.boundingBox();
    if (!r) throw new Error('Missing touch drag target');
    const x = r.x + (point?.x ?? r.width / 2), y = r.y + (point?.y ?? r.height / 2);
    if (engine === 'webkit') {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(120); return;
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach(); await page.waitForTimeout(600);
}
async function cancelResize(context, page, target, dy) {
    if (engine === 'webkit') {
        const r = await target.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x, y + dy, { steps: 6 });
        await target.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
        await page.mouse.up(); await page.waitForTimeout(150);
        return;
    }
    const r = await target.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 6, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await cdp.detach(); await page.waitForTimeout(600);
}
async function visualViewport(page, size) {
    await page.evaluate((next) => {
        const view = window.visualViewport;
        for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) {
            if (next) Object.defineProperty(view, key, { configurable: true, value: next[key] });
            else delete view[key];
        }
        view.dispatchEvent(new Event('resize'));
        view.dispatchEvent(new Event('scroll'));
    }, size);
    await page.waitForTimeout(200);
}
function gripInsideRect(info, rect) {
    const grip = info.grip;
    return !grip || !grip.width || !grip.height || (grip.left >= rect.left - 2 && grip.right <= rect.right + 2 &&
        grip.top >= rect.top - 2 && grip.bottom <= rect.bottom + 2);
}
function headerInsideRect(info, rect) {
    return info.header.left >= rect.left - 2 && info.header.right <= rect.right + 2 &&
        info.header.top >= rect.top - 2 && info.header.bottom <= rect.bottom + 2 &&
        info.close.left >= rect.left - 2 && info.close.right <= rect.right + 2 && gripInsideRect(info, rect);
}
async function measure(panel) {
    return panel.evaluate((el) => {
        const rect = (node) => node?.getBoundingClientRect().toJSON();
        const header = el.querySelector('.vela-panel-header,.vela-dialog-header');
        const grip = el.querySelector('.vela-panel-grip,.vela-sd-pane-grip');
        const close = el.querySelector('.vela-panel-close,.vela-dialog-close');
        const max = el.querySelector('.vela-panel-max,.vela-dialog-max');
        const root = el.closest('[data-layout]');
        const visible = [...header.children].filter((child) => getComputedStyle(child).display !== 'none');
        return { panel: rect(el), header: rect(header), host: rect(el.parentElement), root: rect(root), grip: rect(grip),
            close: rect(close), max: rect(max), maxBeforeClose: visible[visible.indexOf(close) - 1] === max,
            gripInHeader: !!grip && grip.parentElement === header,
            gripAboveHeader: !!grip && grip.parentElement === el && grip.nextElementSibling === header &&
                Math.abs(grip.getBoundingClientRect().bottom - header.getBoundingClientRect().top) <= 2,
            maximized: el.hasAttribute('data-maximized'),
            pressed: max?.getAttribute('aria-pressed'), overflow: document.documentElement.scrollWidth - innerWidth };
    });
}
function headerInside(info) {
    return info.header.left >= info.host.left - 2 && info.header.right <= info.host.right + 2 &&
        info.header.top >= info.host.top - 2 && info.header.bottom <= info.host.bottom + 2 &&
        gripInsideRect(info, info.host);
}
function sameRect(a, b, tolerance = 3) {
    return near(a.x, b.x, tolerance) && near(a.y, b.y, tolerance) &&
        near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
}
function fillsWorkspace(info) {
    return sameRect(info.panel, info.root, 2) && info.close.width >= 24 && info.max.width >= 24 && info.maxBeforeClose;
}
async function noSizePopup(panel) {
    return await panel.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0;
}
async function openPhonePanel(page, name) {
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-md-row').filter({ hasText: new RegExp(`^${name}$`, 'i') }).first().tap();
}
try {
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        await page.locator('.vela-bb-settings').click();
        const settings = page.locator('.vela-dialog--settings');
        await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(200);
        const corner = settings.locator('.vela-dialog-corner-resize');
        const init = await measure(settings);
        assert(await corner.count() === 1 && await corner.evaluate((el) => el.previousElementSibling?.className) === 'vela-dialog-close',
            'Settings has the Close-adjacent direct resize button');
        assert(await corner.getAttribute('aria-controls') === await settings.getAttribute('id'), 'Settings resize button names its controlled panel');
        await mouseDrag(page, corner, -200, 160);
        const sized = await measure(settings);
        assert(sized.panel.width < init.panel.width - 180 && sized.panel.height < init.panel.height - 140 &&
            near(sized.panel.left, init.panel.left) && near(sized.panel.bottom, init.panel.bottom),
        'Settings resizes in two dimensions with its opposite corner fixed', { init, sized });
        await corner.click(); await corner.press('Enter');
        assert(await noSizePopup(settings), 'Settings resize click and Enter open no size popup');
        const beforeKeys = await settings.boundingBox();
        await corner.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
        const keyed = await settings.boundingBox();
        assert(keyed.width > beforeKeys.width + 13 && keyed.height > beforeKeys.height + 13,
            'Settings resize button supports both keyboard axes', { beforeKeys, keyed });
        // Cancellation must undo only the incomplete gesture.
        const buttonBox = await corner.boundingBox(), x = buttonBox.x + buttonBox.width / 2, y = buttonBox.y + buttonBox.height / 2;
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 80, y - 70, { steps: 5 });
        await corner.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
        await page.mouse.up(); await page.waitForTimeout(100);
        assert(sameRect(await settings.boundingBox(), keyed), 'cancelled Settings resize returns to its previous geometry', { keyed, cancel: await settings.boundingBox() });
        await mouseDrag(page, corner, -500, 400);
        const tiny = await measure(settings);
        assert(tiny.panel.width <= 163 && tiny.header.width >= tiny.close.width + 26 &&
            await settings.locator('.vela-sd-rail').isVisible() && await settings.locator('.vela-sd-pane').isVisible(),
        'compact Settings keeps the header, sections and scrollable settings pane', tiny);
        const compact = await settings.evaluate((el) => {
            const footer = el.querySelector('.vela-dialog-footer'), rail = el.querySelector('.vela-sd-rail'), pane = el.querySelector('.vela-sd-pane');
            return { footerWidth: footer.clientWidth, footerScrollWidth: footer.scrollWidth, footerHeight: footer.clientHeight,
                railHeight: rail.clientHeight, railScrollHeight: rail.scrollHeight, paneHeight: pane.clientHeight, paneScrollHeight: pane.scrollHeight };
        });
        assert(compact.footerScrollWidth > compact.footerWidth && compact.footerHeight >= 30 &&
            compact.railScrollHeight > compact.railHeight && compact.paneScrollHeight > compact.paneHeight,
        'minimum-size Settings keeps independently scrollable sections, content and footer actions', compact);
        const footer = settings.locator('.vela-dialog-footer');
        const template = footer.locator('.vela-sd-tplbtn'); await template.scrollIntoViewIfNeeded(); await template.click();
        await page.locator('.vela-sd-tpl').waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
        const apply = footer.locator('.vela-sd-applyall'); await apply.scrollIntoViewIfNeeded();
        assert(await footer.evaluate((el) => el.scrollLeft > 0), 'the compact footer scrolls to the Apply to all action');
        await apply.click();
        assert(await settings.isVisible(), 'Templates and Apply to all remain actionable in minimum-size Settings');
        await mouseDrag(page, settings.locator('.vela-dialog-title'), 0, 1000);
        const offscreen = await measure(settings);
        assert(headerInside(offscreen) && offscreen.panel.bottom > offscreen.host.bottom + 30,
            'Settings body can extend below the screen while the whole header remains visible', offscreen);
        await mouseDrag(page, settings.locator('.vela-dialog-title'), 0, -400);
        await settings.locator('.vela-dialog-close').click();
        await page.locator('.vela-widget-panel-objects').click();
        const tree = page.locator('.vela-panel.vela-ot');
        await tree.locator('.vela-panel-dock-toggle').click(); await page.waitForTimeout(160);
        const resize = tree.locator('.vela-panel-corner-resize');
        await resize.click(); await resize.press('Enter');
        assert(await noSizePopup(tree), 'floating panel resize click opens no size popup');
        await mouseDrag(page, tree.locator('.vela-panel-title'), 0, 1000);
        const floating = await measure(tree);
        assert(headerInside(floating) && floating.panel.bottom > floating.host.bottom + 30,
            'floating panel body may move off-screen but the entire header stays visible', floating);
        const state = await page.evaluate(() => window.__ws.getState().panels);
        assert(state.floatPositions?.objects?.y > 0.6, 'off-screen-body position is persisted', state);
        await tree.locator('.vela-panel-header').focus(); await page.keyboard.press('ArrowUp');
        assert((await tree.boundingBox()).y < floating.panel.y - 10, 'keyboard can move an off-screen panel back');
        facts.desktop = { sized, tiny, compact, offscreen, floating };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-drawings').tap();
        const drawer = page.locator('.vela-drawer:visible');
        await drawer.waitFor({ state: 'visible' }); await page.waitForTimeout(350);
        const drawerNode = await drawer.elementHandle();
        const shape = async () => drawerNode.evaluate((el) => {
            const grip = el.querySelector('.vela-drawer-grab');
            const head = el.querySelector('.vela-drawer-top');
            const rect = (node) => node.getBoundingClientRect().toJSON();
            return { panel: rect(el), grip: rect(grip), head: rect(head), host: rect(el.parentElement),
                title: el.querySelector('.vela-drawer-title').textContent,
                inHead: grip.parentElement === head,
                above: grip.parentElement === el && grip.nextElementSibling === head &&
                    Math.abs(grip.getBoundingClientRect().bottom - head.getBoundingClientRect().top) < 2 };
        });
        const before = await shape();
        assert(before.title === 'Drawings' && before.above && before.grip.height >= 24 &&
            before.grip.width >= before.panel.width - 2, 'phone drawer has a separate full-width resize row above its heading', before);
        await drawer.locator('.vela-drawer-grab').tap();
        assert(await noSizePopup(drawer), 'drawer resize strip tap does not open a size popup');
        await touchDrag(context, page, drawer.locator('.vela-drawer-grab'), 0, 80);
        const resized = await shape();
        assert(resized.panel.height < before.panel.height - 50 && near(resized.panel.bottom, before.panel.bottom),
            'drawer top strip directly resizes while keeping the bottom fixed', { before, resized });
        await touchDrag(context, page, drawer.locator('.vela-drawer-title'), 0, 470);
        const moved = await shape();
        assert(sameRect(moved.panel, resized.panel) && near(moved.panel.bottom, moved.host.bottom),
            'a phone drawer heading cannot detach or resize the bottom-attached sheet', { resized, moved });
        await drawer.locator('.vela-drawer-top').focus(); await page.keyboard.press('ArrowUp');
        const keyboard = await shape();
        assert(sameRect(keyboard.panel, moved.panel),
            'drawer header arrow keys do not move the phone sheet', { moved, keyboard });
        await visualViewport(page, { offsetLeft: 0, offsetTop: 80, width: 390, height: 300 });
        const clipped = await shape();
        assert(clipped.grip.top >= 78 && clipped.grip.bottom <= 382 && clipped.head.top >= 78 && clipped.head.bottom <= 382 && near(clipped.panel.bottom, 380),
            'a reduced visual viewport keeps the drawer attached with the strip and header visible', clipped);
        await visualViewport(page, null);
        await page.setViewportSize({ width: 780, height: 390 }); await page.waitForTimeout(400);
        const landscape = await shape();
        assert(landscape.inHead && !landscape.above, 'landscape drawer returns to the previous desktop inline grip', landscape);
        await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(400);
        await page.locator('.vela-mb-drawings').tap(); await drawer.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
        const portrait = await shape();
        assert(portrait.above && !portrait.inHead, 'rotating back restores the separate phone drawer strip', portrait);
        facts.phoneDrawer = { before, resized, moved, keyboard, clipped, landscape, portrait };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-settings').tap();
        const settings = page.locator('.vela-dialog--settings');
        await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(220);
        const grip = settings.locator('.vela-sd-pane-grip'), max = settings.locator('.vela-dialog-max');
        const initial = await measure(settings);
        assert(initial.gripAboveHeader && initial.grip.height >= 24 && initial.grip.width >= initial.panel.width - 2 && initial.header.height <= 48 && initial.maxBeforeClose,
            'Settings grip is in a separate full-width row above the heading and maximize is immediately before Close', initial);
        await grip.tap();
        assert(await noSizePopup(settings), 'tapping Settings grip opens no size popup');
        await touchDrag(context, page, grip, 0, -95);
        const resized = await measure(settings);
        assert(resized.panel.height > initial.panel.height + 70 && near(resized.panel.bottom, initial.panel.bottom),
            'touch directly resizes the Settings top edge', { initial, resized });
        await cancelResize(context, page, grip, 70);
        const settingsCancel = await measure(settings);
        assert(sameRect(settingsCancel.panel, resized.panel), 'cancelled Settings touch resize restores the previous geometry', { resized, settingsCancel });
        await settings.locator('.vela-dialog-close').tap();
        await page.locator('.vela-mb-settings').tap(); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(220);
        assert(near((await measure(settings)).panel.height, resized.panel.height),
            'a cancelled Settings resize also restores the remembered height when reopened');
        await touchDrag(context, page, settings.locator('.vela-dialog-title'), 0, 330);
        const moved = await measure(settings);
        assert(headerInside(moved) && sameRect(moved.panel, resized.panel) && near(moved.panel.bottom, moved.host.bottom),
            'dragging the phone Settings heading keeps the pane attached and unchanged', { resized, moved });
        const visible = { left: 30, top: 40, right: 350, bottom: 520 };
        await visualViewport(page, { offsetLeft: visible.left, offsetTop: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top });
        const settingsZoom = await measure(settings);
        assert(headerInsideRect(settingsZoom, visible) && near(settingsZoom.panel.bottom, visible.bottom), 'a narrowed visual viewport keeps Settings attached with its header and Close reachable', settingsZoom);
        await visualViewport(page, null);
        const settingsRecovered = await measure(settings);
        assert(sameRect(settingsRecovered.panel, moved.panel), 'temporary viewport clamping does not change the preferred Settings geometry', { moved, settingsRecovered });
        await max.tap(); const full = await measure(settings);
        assert(full.maximized && full.pressed === 'true' && fillsWorkspace(full) && !await grip.isVisible(), 'phone Settings fills its workspace without a resize strip', full);
        await visualViewport(page, { offsetLeft: visible.left, offsetTop: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top });
        const settingsFullZoom = await measure(settings);
        assert(near(settingsFullZoom.panel.left, visible.left) && near(settingsFullZoom.panel.top, visible.top) &&
            near(settingsFullZoom.panel.right, visible.right) && near(settingsFullZoom.panel.bottom, visible.bottom) && headerInsideRect(settingsFullZoom, visible),
        'maximized Settings follows the visible viewport', settingsFullZoom);
        await max.tap(); const settingsZoomRestored = await measure(settings);
        assert(headerInsideRect(settingsZoomRestored, visible), 'restoring Settings while zoomed keeps its entire header reachable', settingsZoomRestored);
        await visualViewport(page, null);
        assert(sameRect((await measure(settings)).panel, moved.panel), 'Settings recovers its original geometry after zoomed restore');
        await max.tap();
        assert(fillsWorkspace(await measure(settings)), 'maximized Settings expands again after the viewport recovers');
        await max.tap(); const restored = await measure(settings);
        assert(!restored.maximized && restored.pressed === 'false' && sameRect(restored.panel, moved.panel),
            'phone Settings restores both the exact position and size', { moved, restored });
        await settings.locator('.vela-dialog-close').tap();
        await openPhonePanel(page, 'Data window');
        const data = page.locator('.vela-panel.vela-dw'); await data.waitFor({ state: 'visible' });
        const d0 = await measure(data);
        assert(d0.gripAboveHeader && d0.grip.height >= 24 && d0.grip.width >= d0.panel.width - 2 && d0.maxBeforeClose && near(d0.panel.bottom, d0.host.bottom),
            'Data Window starts bottom-attached with a separate top resize row and phone maximize', d0);
        await data.locator('.vela-panel-grip').tap();
        assert(await noSizePopup(data), 'tapping a panel grip opens no size popup');
        await touchDrag(context, page, data.locator('.vela-panel-grip'), 0, -80);
        const d1 = await measure(data);
        assert(d1.panel.height > d0.panel.height + 60 && near(d1.panel.bottom, d0.panel.bottom),
            'Data Window remains directly height-resizable', { d0, d1 });
        const beforeCancelState = await page.evaluate(() => structuredClone(window.__ws.getState().panels));
        await cancelResize(context, page, data.locator('.vela-panel-grip'), 65);
        const dataCancel = await measure(data);
        assert(sameRect(dataCancel.panel, d1.panel) && JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(beforeCancelState),
            'cancelled Data Window touch resize restores geometry without changing saved state', { d1, dataCancel });
        await touchDrag(context, page, data.locator('.vela-panel-title'), 0, 330);
        const d2 = await measure(data);
        assert(headerInside(d2) && sameRect(d2.panel, d1.panel) && near(d2.panel.bottom, d2.host.bottom),
            'a standard phone pane stays attached when its heading is dragged', { d1, d2 });
        const savedBeforeViewport = await page.evaluate(() => structuredClone(window.__ws.getState().panels));
        await visualViewport(page, { offsetLeft: visible.left, offsetTop: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top });
        const dataZoom = await measure(data);
        assert(headerInsideRect(dataZoom, visible) && near(dataZoom.panel.bottom, visible.bottom), 'a narrowed visual viewport keeps Data Window attached with its header and Close reachable', dataZoom);
        assert(JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(savedBeforeViewport),
            'the temporary viewport does not rewrite saved panel geometry');
        await visualViewport(page, null);
        assert(sameRect((await measure(data)).panel, d2.panel), 'Data Window returns to its preferred geometry after viewport recovery');
        await data.locator('.vela-panel-max').tap(); const dFull = await measure(data);
        assert(dFull.maximized && dFull.pressed === 'true' && fillsWorkspace(dFull) && !await data.locator('.vela-panel-grip').isVisible(), 'Data Window fullscreen covers the workspace without a resize strip', dFull);
        await visualViewport(page, { offsetLeft: visible.left, offsetTop: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top });
        const dataFullZoom = await measure(data);
        assert(near(dataFullZoom.panel.left, visible.left) && near(dataFullZoom.panel.top, visible.top) &&
            near(dataFullZoom.panel.right, visible.right) && near(dataFullZoom.panel.bottom, visible.bottom) && headerInsideRect(dataFullZoom, visible),
        'maximized Data Window follows the visible viewport', dataFullZoom);
        await data.locator('.vela-panel-max').tap(); const dataZoomRestored = await measure(data);
        assert(headerInsideRect(dataZoomRestored, visible), 'restoring Data Window while zoomed keeps its entire header reachable', dataZoomRestored);
        await visualViewport(page, null);
        assert(sameRect((await measure(data)).panel, d2.panel), 'Data Window recovers its original geometry after zoomed restore');
        await data.locator('.vela-panel-max').tap();
        assert(fillsWorkspace(await measure(data)), 'maximized Data Window expands again after viewport recovery');
        await data.locator('.vela-panel-max').tap(); const dRestore = await measure(data);
        assert(sameRect(dRestore.panel, d2.panel) && !dRestore.maximized, 'Data Window restores its attached geometry', { d2, dRestore });
        // A maxed phone pane cannot get stranded when the phone rotates into desktop chrome.
        await data.locator('.vela-panel-max').tap();
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'desktop');
        await page.waitForTimeout(220);
        assert(await data.getAttribute('data-maximized') === null && !await data.locator('.vela-panel-max').isVisible(),
            'rotation restores a phone-only fullscreen panel before hiding its toggle');
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
        await page.waitForTimeout(220);
        const afterRotation = await measure(data);
        assert(sameRect(afterRotation.panel, d2.panel, 4), 'rotation preserves the phone pane position and size', { d2, afterRotation });
        facts.phone = { initial, resized, moved, full, restored, d0, d1, d2, dFull, dRestore, afterRotation };
        await context.close();
    }
    {
        // Resizing is one history change; heading gestures never create a detached position.
        const { context, page } = await boot({ width: 390, height: 780 }, true, '?persist=1');
        await page.waitForTimeout(500);
        await openPhonePanel(page, 'Data window');
        const panel = page.locator('.vela-panel.vela-dw'); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(400);
        const beforeResize = await measure(panel);
        await touchDrag(context, page, panel.locator('.vela-panel-grip'), 0, -70);
        const afterResize = await measure(panel); await page.waitForTimeout(500);
        const saved = await page.evaluate(() => structuredClone(window.__ws.getState().panels));
        await touchDrag(context, page, panel.locator('.vela-panel-title'), 0, 180);
        const afterMove = await measure(panel); await page.waitForTimeout(500);
        assert(sameRect(afterMove.panel, afterResize.panel) && near(afterMove.panel.bottom, afterMove.host.bottom),
            'phone heading gestures preserve the chosen bottom-attached size', { afterResize, afterMove });
        assert(JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(saved),
            'a phone heading gesture does not create persisted geometry');
        await panel.locator('.vela-panel-max').tap(); await panel.locator('.vela-panel-max').tap();
        assert(JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(saved),
            'temporary fullscreen/restore does not change saved panel geometry');
        await page.evaluate(() => window.__ws.undo()); await page.waitForTimeout(250);
        const undone = await measure(panel);
        assert(sameRect(undone.panel, beforeResize.panel, 4), 'undo restores the previous attached phone height', { beforeResize, undone });
        await page.evaluate(() => window.__ws.redo()); await page.waitForTimeout(300);
        const redone = await measure(panel);
        assert(sameRect(redone.panel, afterResize.panel, 4), 'redo restores the resized attached pane', { afterResize, redone });
        await page.waitForTimeout(800); await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
        const reloaded = await measure(panel);
        assert(sameRect(reloaded.panel, afterResize.panel, 4), 'the attached phone height survives reload', { afterResize, reloaded });
        facts.phonePersistence = { beforeResize: beforeResize.panel, afterResize: afterResize.panel, afterMove: afterMove.panel, undone: undone.panel, redone: redone.panel, reloaded: reloaded.panel };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true, '?preview=editor');
        const panels = {};
        for (const [id, selector] of [['objects', '.vela-ot'], ['alerts', '.vela-ap'],
            ['strategyTester', '.vela-st'], ['pineEditor', '.vela-pe']]) {
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, true), id);
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
            const previous = await measure(panel);
            assert(previous.gripAboveHeader && previous.grip.height >= 24 && previous.maxBeforeClose && previous.max.width >= 24,
                `${id} has a separate resize row above the header and phone maximize beside Close`, previous);
            await panel.locator('.vela-panel-max').tap(); const full = await measure(panel);
            assert(fillsWorkspace(full) && full.maximized, `${id} fills the workspace`, full);
            await panel.locator('.vela-panel-max').tap(); const restored = await measure(panel);
            assert(sameRect(restored.panel, previous.panel) && !restored.maximized,
                `${id} restores its previous size and position`, { previous, restored });
            if (id === 'pineEditor') assert(await panel.locator('.monaco-editor').count() === 1,
                'Pine keeps its Monaco editor across fullscreen and restore');
            panels[id] = { previous: previous.panel, full: full.panel };
        }
        facts.builtins = panels;
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 1000, height: 800 }, true);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style,
            { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
        await page.locator('.vela-mb-settings').tap();
        const settings = page.locator('.vela-dialog--settings'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
        const previous = await measure(settings);
        await settings.locator('.vela-dialog-max').tap(); const full = await measure(settings);
        assert(fillsWorkspace(full) && full.panel.left >= 100 && full.panel.top >= 110,
            'embedded fullscreen fills only its workspace, not the surrounding page', full);
        await settings.locator('.vela-dialog-max').tap();
        assert(sameRect((await measure(settings)).panel, previous.panel), 'embedded Settings restores its original geometry');
        facts.embedded = { previous, full };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 200, height: 320 }, true);
        await page.locator('.vela-mb-settings').tap();
        const settings = page.locator('.vela-dialog--settings'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(180);
        const initial = await measure(settings);
        assert(initial.gripAboveHeader && initial.max.width >= 24 && initial.close.width >= 24 && initial.maxBeforeClose && initial.close.right <= initial.header.right + 1 && initial.overflow <= 0,
            'very narrow phone keeps its grip, maximize and close reachable', initial);
        const actions = await settings.locator('.vela-dialog-header').evaluate((header) => {
            const bounds = header.getBoundingClientRect();
            return [...header.children].filter((el) => el.matches('button,[role="separator"]') && getComputedStyle(el).display !== 'none')
                .map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label'), width: r.width, left: r.left, right: r.right, inside: r.left >= bounds.left && r.right <= bounds.right }; });
        });
        assert(actions.length >= 4 && actions.every((action) => action.width >= 24 && action.inside),
            'all narrow Settings header actions stay inside and retain usable hit targets', actions);
        await settings.locator('.vela-sd-tplbtn').tap(); await page.locator('.vela-sd-tpl').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await settings.locator('.vela-sd-burger').tap();
        assert(await settings.locator('.vela-sd-burger').getAttribute('aria-expanded') === 'true', 'narrow Settings sections control still opens');
        await settings.locator('.vela-sd-burger').tap();
        await touchDrag(context, page, settings.locator('.vela-dialog-title'), 0, 130);
        const moved = await measure(settings);
        assert(headerInside(moved) && sameRect(moved.panel, initial.panel) && near(moved.panel.bottom, moved.host.bottom) && moved.close.right <= moved.header.right,
            'a narrow Settings pane stays bottom-attached with its full header visible', { initial, moved });
        await settings.locator('.vela-dialog-max').tap(); const full = await measure(settings);
        assert(fillsWorkspace(full) && full.overflow <= 0, 'very narrow phone can enter fullscreen without horizontal overflow', full);
        await settings.locator('.vela-dialog-max').tap();
        assert(sameRect((await measure(settings)).panel, moved.panel), 'very narrow phone can restore the attached panel');
        facts.narrow = { initial, moved, full, actions };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 200, height: 320 }, true, '?preview=editor');
        const panels = {};
        for (const [id, selector] of [['objects', '.vela-ot'], ['dataWindow', '.vela-dw'], ['alerts', '.vela-ap'],
            ['strategyTester', '.vela-st'], ['pineEditor', '.vela-pe']]) {
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, true), id);
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(220);
            const initial = await measure(panel);
            // Pine's visible name/actions live in its slot; its own title node is intentionally empty.
            if (id === 'pineEditor') await touchDrag(context, page, panel.locator('.vela-panel-header'), 0, 150, { x: 12, y: 12 });
            else await touchDrag(context, page, panel.locator('.vela-panel-title'), 0, 150);
            const moved = await measure(panel);
            assert(headerInside(moved) && sameRect(moved.panel, initial.panel) && near(moved.panel.bottom, moved.host.bottom) &&
                moved.max.width >= 24 && moved.close.width >= 24 && moved.max.left >= moved.header.left && moved.close.right <= moved.header.right + 1,
            `${id} stays attached and keeps its complete header visible on a narrow phone`, { initial, moved });
            await panel.locator('.vela-panel-max').tap(); const full = await measure(panel);
            assert(fillsWorkspace(full), `${id} can maximize on a narrow phone`, full);
            await panel.locator('.vela-panel-max').tap();
            assert(sameRect((await measure(panel)).panel, moved.panel, 4), `${id} restores its narrow attached geometry`);
            panels[id] = { moved: moved.panel, header: moved.header, full: full.panel };
        }
        facts.narrowPanels = panels;
        await context.close();
    }
    assert(errors.length === 0, 'no uncaught browser errors', errors);
    report('panel-direct-resize', { engine, ...facts, errors });
} finally { await browser.close(); }
