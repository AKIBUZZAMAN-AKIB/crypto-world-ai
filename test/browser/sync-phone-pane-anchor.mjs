// Portrait phone panels remain bottom-attached: headers never move them, and only the
// separate strip resizes them. Exercise real workspace surfaces without screenshots.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report, installMovablePanel } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
const same = (a, b, tolerance = 3) => near(a.x, b.x, tolerance) && near(a.y, b.y, tolerance) &&
    near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
const snapshot = (panel) => panel.evaluate((el) => {
    const rect = (node) => node?.getBoundingClientRect().toJSON();
    return { panel: rect(el), host: rect(el.parentElement),
        header: rect(el.querySelector('.vela-panel-header,.vela-dialog-header,.vela-drawer-top')),
        grip: rect(el.querySelector('.vela-panel-grip,.vela-sd-pane-grip,.vela-drawer-grab')),
        maximized: el.hasAttribute('data-maximized') };
});
async function drag(context, page, target, dy, point) {
    const r = await target.boundingBox();
    if (!r) throw new Error('Gesture target not visible');
    const x = r.x + (point?.x ?? r.width / 2), y = r.y + (point?.y ?? r.height / 2);
    if (engine === 'webkit') {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x, y + dy, { steps: 8 }); await page.mouse.up();
        await page.waitForTimeout(160); return;
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach(); await page.waitForTimeout(550);
}
async function checkHeader(context, page, panel, label, header, point) {
    const before = await snapshot(panel);
    const stateBefore = await page.evaluate(() => JSON.stringify(window.__ws.getState().panels));
    assert(near(before.panel.bottom, before.host.bottom), `${label}: pane begins attached to its host bottom`, before);
    await drag(context, page, header, -90, point);
    const after = await snapshot(panel);
    assert(same(before.panel, after.panel) && near(after.panel.bottom, after.host.bottom),
        `${label}: dragging its heading upward leaves the pane and bottom edge in place`, { before, after });
    assert(await page.evaluate(() => JSON.stringify(window.__ws.getState().panels)) === stateBefore,
        `${label}: a heading gesture does not add a persisted geometry change`);
    return { before, after, unchanged: same(before.panel, after.panel) };
}
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(`${OFFLINE}?preview=editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    await installMovablePanel(page);
    const panels = {};
    for (const [id, selector] of [['dataWindow', '.vela-dw'], ['objects', '.vela-ot'], ['layoutSetup', '.vela-layout-setup'],
        ['alerts', '.vela-ap'], ['strategyTester', '.vela-st'], ['pineEditor', '.vela-pe'], ['resizeProbe', '.vela-panel-resizeProbe']]) {
        await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, true), id);
        const panel = page.locator(selector); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(220);
        const header = panel.locator('.vela-panel-header');
        const result = await checkHeader(context, page, panel, id, header, { x: 4, y: 14 });
        panels[id] = result;
        if (!result.unchanged) throw new Error(`${id}: phone heading detached the pane`);
        await drag(context, page, header, 80, { x: 4, y: 14 });
        const down = await snapshot(panel);
        assert(same(result.before.panel, down.panel), `${id}: dragging the heading down does not move the pane`, down);
        for (const [action, label] of [['.vela-panel-max', 'fullscreen'], ['.vela-panel-close', 'Close']]) {
            await drag(context, page, panel.locator(action), -65);
            const afterButtonDrag = await snapshot(panel);
            assert(await panel.isVisible() && !afterButtonDrag.maximized && same(afterButtonDrag.panel, down.panel),
                `${id}: dragging ${label} does not move the pane or accidentally activate the button`, { down, afterButtonDrag });
        }
        await header.evaluate((el) => el.focus()); await page.keyboard.press('ArrowUp');
        assert(same((await snapshot(panel)).panel, down.panel), `${id}: heading arrow keys do not move the phone pane`);
        const grip = panel.locator('.vela-panel-grip');
        const separate = await grip.evaluate((el) => el.parentElement?.classList.contains('vela-panel') && el.nextElementSibling?.classList.contains('vela-panel-header'));
        assert(separate && down.grip.height >= 24 && near(down.grip.width, down.panel.width), `${id}: resize strip stays above the header`, down);
        await drag(context, page, grip, -80);
        const resized = await snapshot(panel);
        assert(resized.panel.height > down.panel.height + 50 && near(resized.panel.bottom, down.panel.bottom),
            `${id}: dragging the strip expands while the bottom edge stays fixed`, { down, resized });
        await grip.focus(); await page.keyboard.press('ArrowDown');
        const keyboard = await snapshot(panel);
        assert(keyboard.panel.height < resized.panel.height - 15 && near(keyboard.panel.bottom, resized.panel.bottom),
            `${id}: keyboard resizes from the strip without moving the bottom`, { resized, keyboard });
        await grip.tap();
        assert(await panel.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0,
            `${id}: tapping the grip does not open a size popup`);
        await panel.locator('.vela-panel-max').tap(); const full = await snapshot(panel);
        assert(full.maximized, `${id}: fullscreen still opens`, full);
        await drag(context, page, header, 75, { x: 4, y: 14 });
        assert(same((await snapshot(panel)).panel, full.panel), `${id}: fullscreen cannot be dragged out of place`);
        await panel.locator('.vela-panel-max').tap(); const restored = await snapshot(panel);
        assert(!restored.maximized && same(restored.panel, keyboard.panel) && near(restored.panel.bottom, restored.host.bottom),
            `${id}: fullscreen restores the anchored pane and previous size`, { keyboard, restored });
        panels[id] = { ...result, resized, keyboard, full, restored };
    }
    await page.evaluate(() => window.__ws.dock.toggle('resizeProbe', false));
    await page.locator('.vela-mb-settings').tap();
    const settings = page.locator('.vela-dialog--settings'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
    const settingsResult = await checkHeader(context, page, settings, 'Settings', settings.locator('.vela-dialog-title'));
    if (!settingsResult.unchanged) throw new Error('Settings heading detached the pane');
    {
        for (const action of ['.vela-dialog-max', '.vela-dialog-close']) {
            await drag(context, page, settings.locator(action), -65);
            const afterButtonDrag = await snapshot(settings);
            assert(await settings.isVisible() && !afterButtonDrag.maximized && same(afterButtonDrag.panel, settingsResult.before.panel),
                'Settings: dragging a header action does not move or accidentally activate the pane', afterButtonDrag);
        }
        const grip = settings.locator('.vela-sd-pane-grip');
        await drag(context, page, grip, -80); const resized = await snapshot(settings);
        assert(resized.panel.height > settingsResult.before.panel.height + 50 && near(resized.panel.bottom, settingsResult.before.panel.bottom),
            'Settings: the separate strip resizes from the top with the bottom fixed', { settingsResult, resized });
        await settings.locator('.vela-dialog-max').tap(); await settings.locator('.vela-dialog-max').tap();
        const restored = await snapshot(settings);
        assert(same(restored.panel, resized.panel), 'Settings: fullscreen restores the attached previous size', { resized, restored });
        facts.settingsResize = { resized, restored };
    }
    facts.settings = settingsResult;
    await settings.locator('.vela-dialog-close').tap(); await page.waitForTimeout(200);
    await page.locator('.vela-mb-more').tap();
    const drawer = page.locator('.vela-more-panel:visible'); await drawer.waitFor({ state: 'visible' });
    await drawer.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
    const drawerResult = await checkHeader(context, page, drawer, 'More drawer', drawer.locator('.vela-panel-header'), { x: 10, y: 12 });
    if (!drawerResult.unchanged) throw new Error('Drawer heading detached the pane');
    {
        await drag(context, page, drawer.locator('.vela-panel-grip'), 75); const resized = await snapshot(drawer);
        assert(resized.panel.height < drawerResult.before.panel.height - 45 && near(resized.panel.bottom, drawerResult.before.panel.bottom),
            'More drawer: its top strip resizes while the bottom stays attached', { drawerResult, resized });
        facts.drawerResize = resized;
    }
    facts.drawer = drawerResult;
    await drawer.locator('.vela-panel-close').focus(); await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
    // A keyboard/zoom can already have reduced the visual viewport before opening.
    await page.evaluate(() => {
        for (const [key, value] of Object.entries({ offsetLeft: 0, offsetTop: 80, width: 390, height: 300 }))
            Object.defineProperty(visualViewport, key, { configurable: true, value });
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
    });
    await page.locator('.vela-mb-more').tap(); await drawer.waitFor({ state: 'visible' });
    await drawer.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
    const narrowedAtOpen = await snapshot(drawer);
    assert(near(narrowedAtOpen.panel.bottom, 380) && narrowedAtOpen.panel.top >= 78 && narrowedAtOpen.panel.height <= 300,
        'a drawer opened into an already narrowed viewport remains at the visible bottom', narrowedAtOpen);
    await page.evaluate(() => {
        for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) delete visualViewport[key];
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
    });
    const recovered = await snapshot(drawer);
    assert(near(recovered.panel.bottom, recovered.host.bottom) && near(recovered.panel.height, facts.drawerResize.panel.height),
        'the drawer returns to its chosen height and host bottom when the viewport recovers', { narrowedAtOpen, recovered });
    facts.drawerViewport = { narrowedAtOpen, recovered };
    await drawer.locator('.vela-panel-close').tap(); await drawer.waitFor({ state: 'hidden' });
    // Layouts saved before this change may contain a separately dragged phone top.
    // Keep their height, but never recreate a detached pane when restoring one.
    await page.evaluate(() => window.__ws.dock.applyState({
        open: 'dataWindow', tops: { dataWindow: 0.18 }, heights: { dataWindow: 0.48 },
    }));
    const legacyPanel = page.locator('.vela-panel.vela-dw'); await legacyPanel.waitFor({ state: 'visible' });
    const legacy = await snapshot(legacyPanel);
    assert(near(legacy.panel.bottom, legacy.host.bottom) && near(legacy.panel.height, legacy.host.height * 0.48, 4),
        'legacy detached top offsets are ignored while preserving the saved height', legacy);
    await drag(context, page, legacyPanel.locator('.vela-panel-grip'), -60);
    const legacyResized = await snapshot(legacyPanel);
    const savedGeometry = await page.evaluate(() => window.__ws.getState().panels);
    assert(near(legacyResized.panel.bottom, legacyResized.host.bottom) && legacyResized.panel.height > legacy.panel.height + 40 &&
        near(savedGeometry.tops.dataWindow + savedGeometry.heights.dataWindow, 1, 0.003),
    'resizing a restored legacy pane saves a bottom-attached top and height together', { legacy, legacyResized, savedGeometry });
    facts.legacy = { legacy, legacyResized, savedGeometry };
    facts.panels = panels;
    await context.close();

    // A phone-sized workspace embedded in a larger host has a nonzero origin and
    // can be narrower than the surrounding browser window.
    const embeddedContext = await browser.newContext({ viewport: { width: 1000, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const embeddedPage = await embeddedContext.newPage();
    embeddedPage.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await embeddedPage.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await embeddedPage.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    await embeddedPage.evaluate(() => Object.assign(document.querySelector('#workspace').style,
        { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
    await embeddedPage.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
    await embeddedPage.evaluate(() => window.__ws.dock.toggle('dataWindow', true));
    const embeddedPanel = embeddedPage.locator('.vela-panel.vela-dw'); await embeddedPanel.waitFor({ state: 'visible' });
    const embeddedBefore = await snapshot(embeddedPanel);
    await drag(embeddedContext, embeddedPage, embeddedPanel.locator('.vela-panel-title'), -65);
    const embeddedAfterHead = await snapshot(embeddedPanel);
    assert(embeddedBefore.host.left >= 100 && embeddedBefore.host.top >= 110 &&
        near(embeddedAfterHead.panel.bottom, embeddedAfterHead.host.bottom) && same(embeddedBefore.panel, embeddedAfterHead.panel),
        'embedded phone-pane heading stays still at the host bottom', { embeddedBefore, embeddedAfterHead });
    await drag(embeddedContext, embeddedPage, embeddedPanel.locator('.vela-panel-grip'), -50);
    const embeddedResized = await snapshot(embeddedPanel);
    assert(embeddedResized.panel.height > embeddedBefore.panel.height + 25 && near(embeddedResized.panel.bottom, embeddedBefore.panel.bottom),
        'embedded phone pane resizes without losing its host bottom', { embeddedBefore, embeddedResized });
    await embeddedPanel.locator('.vela-panel-close').tap();
    await embeddedPage.locator('.vela-mb-more').tap();
    await embeddedPage.locator('.vela-md-row', { hasText: 'Layout setup' }).tap();
    const embeddedSetup = embeddedPage.locator('.vela-layout-setup'); await embeddedSetup.waitFor({ state: 'visible' });
    const setupBefore = await snapshot(embeddedSetup);
    await drag(embeddedContext, embeddedPage, embeddedSetup.locator('.vela-panel-title'), -45);
    const setupAfterHead = await snapshot(embeddedSetup);
    assert(same(setupBefore.panel, setupAfterHead.panel) && near(setupAfterHead.panel.bottom, setupAfterHead.host.bottom),
        'embedded Layout setup remains bottom-attached when its heading is dragged', { setupBefore, setupAfterHead });
    await drag(embeddedContext, embeddedPage, embeddedSetup.locator('.vela-panel-grip'), -50);
    const setupResized = await snapshot(embeddedSetup);
    assert(setupResized.panel.height > setupBefore.panel.height + 25 && near(setupResized.panel.bottom, setupBefore.panel.bottom),
        'embedded Layout setup resizes from its top strip without detaching', { setupBefore, setupResized });
    await embeddedSetup.getByRole('tab', { name: 'Chart syncing' }).tap();
    assert(await embeddedPage.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth &&
        document.documentElement.scrollHeight === document.documentElement.clientHeight),
        'embedded sync tab scrolls internally without enlarging the host document');
    await embeddedSetup.locator('.vela-panel-close').tap();
    await embeddedPage.locator('.vela-mb-more').tap();
    const embeddedDrawer = embeddedPage.locator('.vela-more-panel:visible'); await embeddedDrawer.waitFor({ state: 'visible' });
    await embeddedDrawer.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
    const embeddedDrawerBefore = await snapshot(embeddedDrawer);
    await drag(embeddedContext, embeddedPage, embeddedDrawer.locator('.vela-panel-header'), -45, { x: 10, y: 12 });
    const embeddedDrawerAfter = await snapshot(embeddedDrawer);
    assert(near(embeddedDrawerBefore.panel.width, embeddedDrawerBefore.host.width) &&
        near(embeddedDrawerBefore.panel.bottom, embeddedDrawerBefore.host.bottom) && same(embeddedDrawerBefore.panel, embeddedDrawerAfter.panel),
    'embedded phone drawer fills its host width and stays attached when its heading is dragged', { embeddedDrawerBefore, embeddedDrawerAfter });
    facts.embedded = { embeddedBefore, embeddedAfterHead, embeddedResized, setupBefore, setupAfterHead, setupResized, embeddedDrawerBefore, embeddedDrawerAfter };
    await embeddedContext.close();
    assert(errors.length === 0, 'no uncaught browser errors', errors);
    report('phone-pane-anchor', { engine, ...facts, errors });
} finally { await browser.close(); }
