// Real pointer/touch regression for resizable panels; no screenshot fixtures or mock HTML.
// The grip changes height continuously; phone headings stay still and content keeps scrolling.
import { chromium } from 'playwright';
import { OFFLINE, assert, report, installMovablePanel } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};
const errors = [];

async function boot(viewport, mobile = false) {
    const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    return { context, page };
}
const bottom = (r) => r.y + r.height;
const fixed = (a, b) => Math.abs(bottom(a) - bottom(b)) < 3;

async function drag(page, context, target, dy, touch = false) {
    const r = await target.boundingBox();
    if (!r) throw new Error('Missing drag target');
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    let mid;
    if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i += 1) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8 }] });
            if (i === 4) mid = await target.evaluate((e) => e.closest('.vela-panel, .vela-dialog, .vela-drawer, .vela-lp, .vela-lm, .vela-tm').getBoundingClientRect().height);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i += 1) {
            await page.mouse.move(x, y + dy * i / 8);
            if (i === 4) mid = await target.evaluate((e) => e.closest('.vela-panel, .vela-dialog, .vela-drawer, .vela-lp, .vela-lm, .vela-tm').getBoundingClientRect().height);
        }
        await page.mouse.up();
    }
    await page.waitForTimeout(240);
    return mid;
}

try {
    // Desktop dock, float, undo/redo, layout setup and independently rendered popovers.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await installMovablePanel(page);
        await page.evaluate(() => window.__ws.dock.toggle('resizeProbe', true));
        const tester = page.locator('.vela-panel.vela-panel-resizeProbe');
        const grip = tester.locator('.vela-panel-grip');
        await tester.waitFor({ state: 'visible' });
        await page.waitForTimeout(450); // separate the opening and resizing history steps
        const before = await tester.boundingBox();
        assert(await grip.evaluate((el) => el.parentElement?.classList.contains('vela-panel-header')),
            'desktop contributed dock keeps its existing inline grip');
        const mid = await drag(page, context, grip, 140);
        const after = await tester.boundingBox();
        const state = await page.evaluate(() => window.__ws.getState().panels);
        assert(after.height < mid - 40 && mid < before.height - 40 && fixed(before, after), 'desktop dock resizes continuously and keeps the bottom fixed', { before, mid, after });
        assert(state.desktopHeights?.resizeProbe > 0 && state.desktopHeights.resizeProbe < 1, 'desktop size is persisted as a fraction', state);
        await page.evaluate(() => window.__ws.undo());
        await page.waitForTimeout(300);
        const undo = await tester.boundingBox();
        await page.evaluate(() => window.__ws.redo());
        await page.waitForTimeout(300);
        const redo = await tester.boundingBox();
        assert(Math.abs(undo.height - before.height) < 3 && Math.abs(redo.height - after.height) < 3, 'undo/redo restore the side-panel size', { before, after, undo, redo });

        const title = tester.locator('.vela-panel-title');
        const titleBox = await title.boundingBox();
        await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(titleBox.x + titleBox.width / 2 - 80, titleBox.y + titleBox.height / 2 - 35, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(240);
        const floatBefore = await tester.boundingBox();
        assert(await tester.getAttribute('data-free-floating') === '1', 'title drag undocks the desktop panel');
        assert(!await grip.isVisible(), 'a freely floating panel no longer shows the top height strip');
        await drag(page, context, tester.locator('.vela-panel-corner-resize'), 75);
        const floatAfter = await tester.boundingBox();
        assert(floatAfter.height < floatBefore.height - 50 && fixed(floatBefore, floatAfter),
            'the floating resize button adjusts height while the bottom stays fixed', { floatBefore, floatAfter });

        facts.desktopMovable = { before, mid, after, state, undo, redo, floatBefore, floatAfter };
        await tester.locator('.vela-panel-close').click();
        await page.waitForTimeout(250);
        await page.locator('button[aria-label="Object tree"]').click();
        const tree = page.locator('.vela-panel.vela-ot');
        await tree.waitFor({ state: 'visible' });
        await page.waitForTimeout(250);

        await page.evaluate(() => {
            const c = window.__ws.active.chart;
            const r = c.getVisibleRange();
            const price = c.lastBar.close;
            for (let i = 0; i < 22; i++) c.drawings.add('box', { anchors: [
                { time: r.from + (r.to - r.from) * 0.3, price: price * 0.99 },
                { time: r.from + (r.to - r.from) * 0.6, price: price * 1.01 },
            ] });
        });
        await page.waitForTimeout(300);
        const body = tree.locator('.vela-panel-body');
        const bodyBox = await body.boundingBox();
        const scrollBefore = await body.evaluate((e) => ({ top: e.scrollTop, client: e.clientHeight, scroll: e.scrollHeight }));
        await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
        await page.mouse.wheel(0, 280);
        await page.waitForTimeout(200);
        const scrollAfter = await body.evaluate((e) => e.scrollTop);
        assert(scrollBefore.scroll > scrollBefore.client && scrollAfter > scrollBefore.top, 'Object Tree content scrolls independently after resize', { scrollBefore, scrollAfter });
        facts.desktopTree = { scrollBefore, scrollAfter };
        await tree.locator('.vela-panel-close').click();
        await page.waitForTimeout(300);
        await page.locator('button[aria-label="Data window"]').click();
        const dataPanel = page.locator('.vela-panel.vela-dw:visible');
        await dataPanel.waitFor({ state: 'visible' });
        const dataGeometry = await dataPanel.evaluate((el) => ({
            panel: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON(),
            grip: getComputedStyle(el.querySelector('.vela-panel-grip')).display,
            max: getComputedStyle(el.querySelector('.vela-panel-max')).display !== 'none', standard: el.dataset.standardPane,
        }));
        assert(dataGeometry.standard === '1' && !dataGeometry.max && dataGeometry.grip === 'none' && Math.abs(dataGeometry.panel.height - dataGeometry.host.height) < 2, 'Data Window stays a full-height standard dock', dataGeometry);
        facts.dataGeometry = dataGeometry;
        await dataPanel.locator('.vela-panel-close').click();
        await page.waitForTimeout(200);

        await page.locator('button[aria-label^="Layout —"]').click();
        const setup = page.locator('.vela-layout-setup');
        await setup.waitFor({ state: 'visible' });
        await setup.locator('.vela-panel-dock-toggle').click();
        await page.waitForTimeout(350);
        const setupBefore = await setup.boundingBox();
        await drag(page, context, setup.locator('.vela-panel-corner-resize'), 115);
        const setupAfter = await setup.boundingBox();
        assert(setupAfter.height < setupBefore.height - 70 && fixed(setupBefore, setupAfter), 'floating layout setup resizes', { setupBefore, setupAfter });
        await setup.locator('.vela-ls-layout-view').evaluate((e) => { e.scrollTop = e.scrollHeight; });
        await page.waitForTimeout(100);
        const sticky = await setup.locator('.vela-panel-corner-resize').boundingBox();
        assert(sticky && sticky.y >= setupAfter.y - 2 && sticky.y < setupAfter.y + 60, 'layout resize button remains reachable while content scrolls', { setupAfter, sticky });
        await setup.locator('.vela-panel-close').click();
        await page.waitForTimeout(250);

        await page.evaluate(() => window.__ws.topbar.openTemplatesMenu());
        const templates = page.locator('.vela-templates-panel:visible');
        await templates.waitFor({ state: 'visible' });
        await templates.locator('.vela-panel-dock-toggle').click();
        await page.waitForTimeout(300);
        const tmBefore = await templates.boundingBox();
        await drag(page, context, templates.locator('.vela-panel-corner-resize'), 65);
        const tmAfter = await templates.boundingBox();
        assert(tmAfter.height < tmBefore.height - 40 && fixed(tmBefore, tmAfter), 'floating templates pane resizes directly', { tmBefore, tmAfter });
        await templates.locator('.vela-tm-tab', { hasText: 'Technical' }).click(); // re-renders its content
        await page.waitForTimeout(150);
        const newGrip = templates.locator('.vela-panel-corner-resize');
        await newGrip.focus();
        await page.keyboard.press('Shift+ArrowDown');
        const tmAgain = await templates.boundingBox();
        assert(tmAgain.height < tmAfter.height - 20, 'pane resize button remains keyboard-operable after a content rerender', { tmAfter, tmAgain });
        await templates.locator('.vela-panel-close').click();
        await page.waitForTimeout(200);
        const menuMetrics = async () => page.locator('.vela-lm:visible').evaluate((e) => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, display: getComputedStyle(e).display, rowHeight: e.querySelector('.vela-lm-row').getBoundingClientRect().height }));
        await page.evaluate(() => window.__ws.topbar.openLayoutMenu());
        await page.locator('.vela-lm:visible').waitFor();
        await page.waitForTimeout(250);
        const menuBefore = await menuMetrics();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => window.__ws.openLayoutManager());
        await page.locator('.vela-lmp:visible').waitFor();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        await page.evaluate(() => window.__ws.topbar.openLayoutMenu());
        await page.locator('.vela-lm:visible').waitFor();
        await page.waitForTimeout(250);
        const menuAfter = await menuMetrics();
        assert(JSON.stringify(menuBefore) === JSON.stringify(menuAfter), 'Manage layouts CSS does not alter the separate desktop layout menu', { menuBefore, menuAfter });
        facts.desktopSurfaces = { setupBefore, setupAfter, sticky, tmBefore, tmAfter, tmAgain, menuBefore, menuAfter };
        await page.keyboard.press('Escape');
        await context.close();
    }

    // Touch: drawer and Object Tree; separate gestures and persisted mobile geometry.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-more').tap();
        const drawer = page.locator('.vela-more-panel:visible');
        await drawer.waitFor({ state: 'visible' });
        await page.waitForTimeout(350);
        const drawerBefore = await drawer.boundingBox();
        const drawerStrip = await drawer.evaluate((el) => {
            const grip = el.querySelector('.vela-panel-grip'), head = el.querySelector('.vela-panel-header');
            return { separate: grip.parentElement === el && grip.nextElementSibling === head,
                grip: grip.getBoundingClientRect().toJSON(), head: head.getBoundingClientRect().toJSON() };
        });
        assert(drawerStrip.separate && drawerStrip.grip.height >= 24 && Math.abs(drawerStrip.grip.bottom - drawerStrip.head.top) < 2,
            'More pane keeps a separate top resize strip', drawerStrip);
        const drawerMid = await drag(page, context, drawer.locator('.vela-panel-grip'), -100, true);
        const drawerAfter = await drawer.boundingBox();
        assert(drawerMid > drawerBefore.height + 30 && drawerAfter.height > drawerMid + 30 && fixed(drawerBefore, drawerAfter), 'touch resizes the More drawer continuously without dismissing it', { drawerBefore, drawerMid, drawerAfter });
        // Phone More headings stay still beneath the separate resize strip.
        const rail = await drawer.locator('.vela-panel-header').boundingBox();
        const moveTouch = await context.newCDPSession(page);
        const moveX = rail.x + rail.width - 20, moveY = rail.y + rail.height / 2;
        await moveTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: moveX, y: moveY }] });
        for (let i = 1; i <= 8; i++) await moveTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: moveX, y: moveY - 45 * i / 8 }] });
        await moveTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await moveTouch.detach();
        await page.waitForTimeout(180);
        const movedDrawer = await drawer.boundingBox();
        assert(Math.abs(movedDrawer.y - drawerAfter.y) < 2 && Math.abs(movedDrawer.height - drawerAfter.height) < 2 && fixed(drawerAfter, movedDrawer), 'phone More header neither moves nor resizes the pane', { drawerAfter, movedDrawer });
        // The actual list remains scrollable after the shrink.
        const drawerBody = drawer.locator('.vela-panel-body');
        const cancelBody = await drawerBody.boundingBox();
        const cancelCdp = await context.newCDPSession(page);
        const cancelX = cancelBody.x + 20, cancelY = cancelBody.y + 70;
        await cancelCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancelX, y: cancelY }] });
        for (let i = 1; i <= 8; i++) await cancelCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cancelX, y: cancelY + 160 * i / 8 }] });
        await cancelCdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await cancelCdp.detach();
        await page.waitForTimeout(180);
        assert(await drawer.isVisible(), 'a cancelled touch does not accidentally dismiss the drawer');
        const bodyBefore = await drawerBody.evaluate((e) => ({ top: e.scrollTop, height: e.clientHeight, scroll: e.scrollHeight }));
        const db = await drawerBody.boundingBox();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: db.x + db.width * 0.75, y: db.y + db.height * 0.78 }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: db.x + db.width * 0.75, y: db.y + db.height * 0.78 - 160 * i / 8 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForTimeout(200);
        const bodyAfter = await drawerBody.evaluate((e) => e.scrollTop);
        assert(bodyBefore.scroll > bodyBefore.height && bodyAfter > bodyBefore.top, 'touch scrolling remains independent inside a resized drawer', { bodyBefore, bodyAfter });
        // Return to the top to reach Object Tree and keep its existing route.
        await drawerBody.evaluate((e) => { e.scrollTop = 0; });
        await drawer.locator('.vela-md-row', { hasText: 'Object tree' }).tap();
        const tree = page.locator('.vela-panel.vela-ot');
        await tree.waitFor({ state: 'visible' });
        await page.waitForTimeout(350);
        const before = await tree.boundingBox();
        const mid = await drag(page, context, tree.locator('.vela-panel-grip'), -110, true);
        const after = await tree.boundingBox();
        const state = await page.evaluate(() => window.__ws.getState().panels);
        assert(after.height > mid + 35 && mid > before.height + 35 && fixed(before, after), 'touch continuously grows Object Tree from its top grip', { before, mid, after });
        assert(state.heights?.objects > 0.4 && state.tops?.objects < 0.55, 'mobile resize saves top and height atomically', state);
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__ws.undo());
        await page.waitForTimeout(300);
        const undo = await tree.boundingBox();
        await page.evaluate(() => window.__ws.redo());
        await page.waitForTimeout(300);
        const redo = await tree.boundingBox();
        assert(Math.abs(undo.height - before.height) < 3 && Math.abs(redo.height - after.height) < 3, 'mobile resize is one undoable change', { before, after, undo, redo });

        // The grip never opens height controls; arrows continue to resize the pane.
        await tree.locator('.vela-panel-grip').tap();
        assert(await tree.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0,
            'touching the grip opens no size popup');
        await tree.locator('.vela-panel-grip').focus();
        await page.keyboard.press('ArrowDown');
        const keyboardSized = await tree.boundingBox();
        assert(keyboardSized.height < redo.height - 20 && fixed(keyboardSized, redo),
            'keyboard adjusts the height while holding the bottom', { redo, keyboardSized });
        // Simulate a shrunken visual viewport, without rewriting the saved geometry.
        const geometryBeforeKeyboard = await page.evaluate(() => JSON.stringify(window.__ws.getState().panels));
        await page.evaluate(() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 380 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(150);
        const keyboardPanel = await tree.boundingBox();
        const keyboardHead = await tree.locator('.vela-panel-header').boundingBox();
        const geometryDuringKeyboard = await page.evaluate(() => JSON.stringify(window.__ws.getState().panels));
        assert(keyboardHead.y >= 0 && bottom(keyboardHead) <= 380 && geometryDuringKeyboard === geometryBeforeKeyboard,
            'visual viewport shrink keeps the header reachable without changing saved geometry', { keyboardPanel, keyboardHead });
        await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForTimeout(150);
        const keyboardRestored = await tree.boundingBox();
        assert(Math.abs(keyboardRestored.height - keyboardSized.height) < 2 && fixed(keyboardSized, keyboardRestored),
            'the previous height and position return after visual viewport restoration', { keyboardSized, keyboardRestored });
        const beforeRotate = await tree.boundingBox();
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForTimeout(500);
        const landscape = await page.evaluate(() => ({ mode: document.querySelector('[data-layout]')?.getAttribute('data-layout'), panel: document.querySelector('.vela-panel.vela-ot').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth - innerWidth }));
        assert(landscape.mode === 'desktop' && landscape.panel.bottom <= 390 + 1 && landscape.overflow <= 0, 'landscape mode keeps the panel inside the viewport', landscape);
        assert(await tree.locator('.vela-panel-grip').evaluate((el) => el.parentElement?.classList.contains('vela-panel-header')),
            'rotating to desktop returns the grip to its original desktop location');
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(500);
        const portrait = await tree.boundingBox();
        assert(await tree.locator('.vela-panel-grip').evaluate((el) => el.parentElement?.classList.contains('vela-panel') && el.nextElementSibling?.classList.contains('vela-panel-header')),
            'rotating to phone restores the separate resize row above the heading');
        assert(Math.abs(portrait.height - beforeRotate.height) < 3 && portrait.y >= 0 && bottom(portrait) <= 780, 'rotating back restores the chosen mobile height', { beforeRotate, portrait });
        // More is a persistent pane, not a modal drawer: content swipes do not dismiss it.
        await page.locator('.vela-mb-more').tap();
        const reopened = page.locator('.vela-more-panel:visible');
        await reopened.waitFor({ state: 'visible' });
        await page.waitForTimeout(350);
        const reopenedBody = reopened.locator('.vela-panel-body');
        await reopenedBody.evaluate((e) => { e.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.waitForTimeout(120);
        const dismissBox = await reopenedBody.boundingBox();
        const dismiss = await context.newCDPSession(page);
        const dismissX = dismissBox.x + 20, dismissY = dismissBox.y + 70;
        const dismissPoint = await page.evaluate(({ x, y }) => {
            const e = document.elementFromPoint(x, y);
            return { tag: e?.tagName, cls: e?.className, path: [...(function* () { for (let n = e; n; n = n.parentElement) yield [n.className, n.scrollTop]; })()].slice(0, 6) };
        }, { x: dismissX, y: dismissY });
        await dismiss.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dismissX, y: dismissY }] });
        for (let i = 1; i <= 8; i++) await dismiss.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dismissX, y: dismissY + 145 * i / 8 }] });
        await dismiss.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await dismiss.detach();
        await page.waitForTimeout(350);
        assert(await reopened.isVisible(), 'content pull does not dismiss the standard More pane', { dismissBox, dismissPoint });
        await reopened.locator('.vela-panel-close').tap();
        facts.phone = { drawerBefore, drawerMid, drawerAfter, movedDrawer, bodyBefore, bodyAfter, before, mid, after, state, undo, redo, keyboardSized, keyboardPanel, keyboardHead, keyboardRestored, landscape, portrait };
        await context.close();
    }

    // A saved minimum height still has usable header controls in a very short host.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-more').tap();
        await page.locator('.vela-md-row', { hasText: 'Object tree' }).tap();
        const tree = page.locator('.vela-panel.vela-ot');
        await tree.waitFor({ state: 'visible' });
        await page.waitForTimeout(300);
        await tree.locator('.vela-panel-grip').focus();
        await page.keyboard.press('Home');
        await page.setViewportSize({ width: 280, height: 350 });
        await page.waitForTimeout(400);
        const first = await tree.boundingBox();
        const head = await tree.locator('.vela-panel-title').boundingBox();
        const cdp = await context.newCDPSession(page);
        const x = head.x + head.width / 2, y = head.y + head.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 50 * i / 8 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForTimeout(200);
        const moved = await tree.boundingBox();
        assert(first.height >= 111 && bottom(first) <= 350 && Math.abs(moved.y - first.y) < 2 && Math.abs(moved.height - first.height) < 2 && fixed(first, moved), 'a short-host Object Tree stays attached when its heading is dragged', { first, moved });
        facts.shortHost = { first, moved };
        await context.close();
    }

    // Manage layouts is intentionally a compact menu, not a resizable panel; its
    // bounds, actions, dismissal and rotation are covered by sync-floating-layout-manager.mjs.
    assert(errors.length === 0, 'no page errors in resize probes', errors.slice(0, 5));
    report('panel-resize', { ...facts, errors });
} finally {
    await browser.close();
}
