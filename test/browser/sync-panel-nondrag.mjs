// Keyboard resizing and the remaining non-drag position controls in the real workspace.
// Size controls never open a slider or numeric popup. SYNC_BROWSER=webkit selects WebKit.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
const browser = process.env.SYNC_BROWSER === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = {};
const near = (a, b, t = 2) => Math.abs(a - b) <= t;
async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}
try {
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        await page.locator('.vela-widget-panel-objects').click();
        const panel = page.locator('.vela-panel.vela-ot'), seam = panel.locator('.vela-panel-resizer');
        const initial = await panel.boundingBox();
        const semantics = await seam.evaluate((el) => ({ role: el.getAttribute('role'), orientation: el.getAttribute('aria-orientation'),
            label: el.getAttribute('aria-label'), controls: el.getAttribute('aria-controls'), targetId: el.closest('.vela-panel')?.id,
            tabIndex: el.tabIndex, value: el.getAttribute('aria-valuenow') }));
        assert(semantics.role === 'separator' && semantics.orientation === 'vertical' && semantics.tabIndex === 0 &&
            semantics.controls === semantics.targetId && Number(semantics.value) === Math.round(initial.width),
        'dock seam is a named keyboard-accessible separator', semantics);
        await seam.focus(); await page.keyboard.press('ArrowLeft');
        const widened = await panel.boundingBox();
        assert(near(widened.width, initial.width + 16), 'keyboard widens the dock', { initial, widened });
        await page.keyboard.press('Home'); const minimum = await panel.boundingBox();
        assert(near(minimum.width, Number(await seam.getAttribute('aria-valuemin'))), 'Home reaches the width minimum', minimum);
        await page.keyboard.press('End'); const maximum = await panel.boundingBox();
        assert(near(maximum.width, Number(await seam.getAttribute('aria-valuemax'))), 'End reaches the width maximum', maximum);
        await seam.click(); await seam.press('Enter');
        assert(await panel.locator('.vela-panel-position-control,.vela-panel-height-control').count() === 0,
            'seam click and Enter do not open a size popup');
        await seam.dblclick();
        assert(near((await panel.boundingBox()).width, initial.width), 'double click resets the dock width');
        await panel.locator('.vela-panel-dock-toggle').click();
        const corner = panel.locator('.vela-panel-corner-resize');
        const before = await panel.boundingBox();
        await corner.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
        const after = await panel.boundingBox();
        assert(after.width > before.width + 13 && after.height > before.height + 13,
            'keyboard independently adjusts both floating dimensions', { before, after });
        await corner.click(); await corner.press('Enter');
        assert(await panel.locator('.vela-panel-position-control,.vela-panel-height-control').count() === 0,
            'floating resize button click and Enter open no size popup');
        await panel.locator('.vela-panel-title').click({ button: 'right' });
        const position = panel.locator('.vela-panel-position-control'); await position.waitFor({ state: 'visible' });
        assert(await position.getByRole('slider', { name: 'Panel left position' }).count() === 1 &&
            await position.getByRole('slider', { name: 'Panel top position' }).count() === 1 &&
            await position.getByRole('slider', { name: 'Panel height' }).count() === 0 &&
            await position.getByRole('slider', { name: 'Panel width' }).count() === 0,
        'heading context menu offers position only, with no size controls');
        const left = position.getByRole('spinbutton', { name: 'Panel left position in pixels' });
        await left.fill('120'); await left.press('Tab'); await page.waitForTimeout(100);
        assert(near((await panel.boundingBox()).x, 120), 'exact position remains available without dragging');
        await position.locator('.vela-panel-position-close').click();
        await page.locator('button[aria-label^="Layout —"]').click();
        const setup = page.locator('.vela-layout-setup'); await setup.waitFor({ state: 'visible' });
        const grip = setup.locator('.vela-panel-resizer'); await grip.focus();
        await page.keyboard.press('Enter');
        assert(await page.locator('.vela-panel-height-control').count() === 0 && await setup.isVisible(),
            'layout dock resizer also opens no height popup');
        facts.desktop = { semantics, initial, widened, minimum, maximum, before, after };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-more').tap();
        const drawer = page.locator('.vela-more-panel:visible');
        const drawerGrip = drawer.locator('.vela-panel-grip'); await drawerGrip.tap();
        assert(await page.locator('.vela-panel-height-control').count() === 0, 'Drawer grip tap has no height popup');
        await drawerGrip.focus(); const drawerBefore = await drawer.boundingBox();
        await page.keyboard.press('ArrowUp'); const drawerAfter = await drawer.boundingBox();
        assert(drawerAfter.height > drawerBefore.height + 20, 'Drawer grip supports keyboard height resize', { drawerBefore, drawerAfter });
        await drawer.locator('.vela-md-row', { hasText: 'Object tree' }).tap();
        const panel = page.locator('.vela-panel.vela-ot'); await panel.waitFor({ state: 'visible' });
        const grip = panel.locator('.vela-panel-grip'); await grip.tap();
        assert(await panel.locator('.vela-panel-height-control').count() === 0, 'phone pane grip tap opens no height popup');
        const before = await panel.boundingBox(); await grip.focus(); await page.keyboard.press('ArrowUp');
        const after = await panel.boundingBox();
        assert(after.height > before.height + 20 && near(after.y + after.height, before.y + before.height),
            'phone grip keyboard expands while the bottom remains fixed', { before, after });
        const saved = await page.evaluate(() => window.__ws.getState().panels);
        assert(saved.heights?.objects > 0.4, 'keyboard resizing updates the saved phone geometry', saved);
        facts.phone = { drawerBefore, drawerAfter, before, after };
        await context.close();
    }
    assert(errors.length === 0, 'no uncaught browser errors', errors);
    report('panel-keyboard-no-popup', { ...facts, errors });
} finally { await browser.close(); }
