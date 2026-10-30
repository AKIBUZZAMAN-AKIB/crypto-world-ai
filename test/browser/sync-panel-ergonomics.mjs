// Real-browser regression for compact, movable panels. No screenshots: measure
// geometry, selected colours, scroll positions, touch gestures and control behaviour.
import { BASE, OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};
const errors = [];

async function boot(viewport, mobile = false, base = OFFLINE) {
    const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(900);
    return { context, page };
}

async function touchMove(context, page, from, delta) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 8; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + delta.x * i / 8, y: from.y + delta.y * i / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    await cdp.detach();
}

try {
    // The layout canvas must use actual square cells and visibly paint data-on.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await page.locator('button[aria-label^="Layout —"]').click();
        await page.waitForSelector('.vela-layout-setup');
        await page.waitForTimeout(300); // measure after the entry animation, not during its scale
        const grid = await page.evaluate(() => {
            const cells = [...document.querySelectorAll('.vela-layout-setup .vela-lp-sq')];
            const read = (e) => {
                const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
                return { width: r.width, height: r.height, radius: cs.borderRadius, bg: cs.backgroundColor, pressed: e.getAttribute('aria-pressed') };
            };
            return { selected: cells.filter((e) => e.dataset.on === '1').length, on: read(cells[0]), off: read(cells.at(-1)) };
        });
        facts.desktopGrid = grid;
        assert(grid.on.width === grid.on.height && parseFloat(grid.on.radius) <= 4, 'layout cells are squares, not circles', grid);
        assert(grid.selected === 4 && grid.on.bg !== grid.off.bg && grid.on.pressed === 'true', 'selected cells are visibly and accessibly selected', grid);

        const panel = page.locator('.vela-layout-setup');
        await panel.locator('.vela-panel-dock-toggle').click();
        const head = panel.locator('.vela-panel-title');
        const before = await panel.boundingBox();
        const title = await head.boundingBox();
        await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
        await page.mouse.down();
        await page.mouse.move(title.x + title.width / 2 - 55, title.y + title.height / 2 + 55, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(180);
        const moved = await panel.boundingBox();
        facts.layoutDrag = { before, moved };
        assert(moved.x < before.x - 20 && moved.y > before.y + 20, 'layout setup moves by holding its header', facts.layoutDrag);
        assert(Math.abs(moved.width - before.width) < 2 && Math.abs(moved.height - before.height) < 2, 'dragging preserves layout panel size', facts.layoutDrag);
        // Apply a new 1×2 grid and check the still-open pane tracks the selection.
        await panel.locator('.vela-lp-sq[data-r="0"][data-c="1"]').click();
        await page.waitForTimeout(500);
        const selectedAfter = await page.locator('.vela-layout-setup .vela-lp-sq[data-on="1"]').count();
        facts.selectedAfter = selectedAfter;
        assert(selectedAfter === 2, 'selected boxes track the applied 1×2 layout', selectedAfter);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        await context.close();
    }

    // On a narrow desktop, a 16-column matrix scrolls inside its dock instead of
    // pushing the whole page sideways; every offscreen column remains reachable.
    {
        const url = new URL(BASE); url.searchParams.set('layout', 'desktop');
        const { context, page } = await boot({ width: 320, height: 660 }, false, url.toString());
        await page.evaluate(() => window.__ws.setLayout('16'));
        await page.locator('button[aria-label^="Layout —"]').click();
        const panel = page.locator('.vela-layout-setup');
        await panel.getByRole('tab', { name: 'Chart syncing' }).click();
        const wrap = panel.locator('.vela-md-matrixwrap'); await wrap.scrollIntoViewIfNeeded();
        const narrow = await wrap.evaluate(el => ({ width: el.getBoundingClientRect().width, client: el.clientWidth,
            scroll: el.scrollWidth, overflow: document.documentElement.scrollWidth - innerWidth }));
        assert(narrow.width <= 320 && narrow.scroll > narrow.client && narrow.overflow === 0,
            'narrow matrix scrolls its content without widening the page', narrow);
        await wrap.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const left = await wrap.evaluate(el => el.scrollLeft);
        facts.narrow = { ...narrow, left };
        assert(left > 0, 'overflowing layout columns can be scrolled sideways', facts.narrow);
        await context.close();
    }

    {
        const { context, page } = await boot({ width: 320, height: 660 }, true);
        await page.locator('.vela-mb-more').click();
        await page.waitForSelector('.vela-more-panel:visible');
        await page.waitForTimeout(350); // the opening transition must have settled
        const drawer = page.locator('.vela-more-panel:visible');
        const grab = await drawer.locator('.vela-panel-grip').boundingBox();
        const before = await drawer.boundingBox();
        await touchMove(context, page, { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 }, { x: 0, y: -55 });
        const after = await drawer.boundingBox();
        facts.drawerDrag = { before, after };
        assert(after.y < before.y - 20 && after.height > before.height + 20 && Math.abs((after.y + after.height) - (before.y + before.height)) < 2, 'touch-drag expands the drawer with its bottom fixed', facts.drawerDrag);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);

        // Phone layout cells are touch-sized, square and still show selection.
        await page.locator('.vela-mb-more').click();
        await page.locator('.vela-md-row', { hasText: 'Layout setup' }).click();
        await page.locator('.vela-layout-setup').waitFor({ state: 'visible' });
        await page.waitForTimeout(350);
        const phoneGrid = await page.evaluate(() => {
            const grid = [...document.querySelectorAll('.vela-layout-setup .vela-lp-grid')].find((e) => e.getBoundingClientRect().width > 0);
            const cells = [...grid.querySelectorAll('.vela-lp-sq')];
            const r = cells[0].getBoundingClientRect();
            return { width: r.width, height: r.height, radius: getComputedStyle(cells[0]).borderRadius, selected: cells.filter((e) => e.dataset.on === '1').length };
        });
        facts.phoneGrid = phoneGrid;
        assert(phoneGrid.width >= 44 && phoneGrid.width === phoneGrid.height && parseFloat(phoneGrid.radius) <= 4 && phoneGrid.selected > 0, 'phone grid retains touch-sized square selected cells', phoneGrid);
        await page.locator('.vela-layout-setup .vela-panel-close').click();
        await page.waitForTimeout(450);

        // Manage objects is a compact, square popover, not a draggable panel;
        // its horizontal mode strip keeps all three labels reachable on a 320px phone.
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const range = chart.getVisibleRange();
            const price = chart.lastBar.close;
            chart.drawings.add('trendline', { anchors: [
                { time: range.from + (range.to - range.from) * 0.3, price: price * 1.01 },
                { time: range.from + (range.to - range.from) * 0.6, price: price * 0.99 },
            ] });
        });
        await page.locator('.vela-mb-more').click();
        await page.locator('.vela-md-row', { hasText: 'Object tree' }).click();
        await page.locator('.vela-panel.vela-ot [aria-label="Manage objects"]').click();
        const dialog = page.getByRole('dialog', { name: 'Manage drawing sync' });
        await dialog.waitFor({ state: 'visible' });
        await page.waitForTimeout(350); // compare stable geometry, not an animation frame
        const dialogBefore = await dialog.boundingBox();
        const attributes = await dialog.evaluate((el) => ({ radius: getComputedStyle(el).borderRadius,
            heading: !!el.querySelector('.vela-dialog-header'), grip: !!el.querySelector('.vela-size-grip, .vela-panel-grip'),
            tree: !document.querySelector('.vela-panel.vela-ot')?.hidden }));
        const title = await dialog.locator('.vela-ot-mo-title').first().boundingBox();
        await touchMove(context, page, { x: title.x + title.width / 2, y: title.y + title.height / 2 }, { x: 0, y: -55 });
        const dialogAfter = await dialog.boundingBox();
        facts.manageDrag = { before: dialogBefore, after: dialogAfter, attributes };
        assert(attributes.radius === '0px' && !attributes.heading && !attributes.grip && attributes.tree
            && Math.abs(dialogAfter.y - dialogBefore.y) < 2 && Math.abs(dialogAfter.height - dialogBefore.height) < 2,
        'Manage objects stays square and stationary while its parent remains open', facts.manageDrag);

        const segment = dialog.locator('.vela-ot-mo-segment');
        const segBefore = await segment.evaluate((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, left: e.scrollLeft, wrap: getComputedStyle(e).flexWrap }));
        const segBox = await segment.boundingBox();
        await touchMove(context, page, { x: segBox.x + segBox.width - 25, y: segBox.y + segBox.height / 2 }, { x: -130, y: 0 });
        const segAfter = await segment.evaluate((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, left: e.scrollLeft, wrap: getComputedStyle(e).flexWrap }));
        facts.objectTabs = { before: segBefore, after: segAfter };
        assert(segBefore.scrollWidth > segBefore.width && segBefore.wrap === 'nowrap', 'object sync modes are not squashed or wrapped', facts.objectTabs);
        assert(segAfter.left > 0, 'object sync mode strip responds to a touch swipe', facts.objectTabs);
        await segment.locator('button', { hasText: 'Synced globally' }).click();
        const selectedMode = await dialog.locator('.vela-ot-mo-segment button[data-on="1"]').textContent();
        assert(selectedMode === 'Synced globally', 'the scrolled-to mode remains selectable', selectedMode);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);

        // The indicator picker has many tabs; wheel and touch must scroll its strip.
        await page.evaluate(() => window.__ws.indicatorPicker.open());
        const tabs = page.locator('.vela-ip-tabs');
        await tabs.waitFor({ state: 'visible' });
        const tabsBox = await tabs.boundingBox();
        const tabsBefore = await tabs.evaluate((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, left: e.scrollLeft }));
        await touchMove(context, page, { x: tabsBox.x + tabsBox.width - 25, y: tabsBox.y + tabsBox.height / 2 }, { x: -160, y: 0 });
        const tabsAfter = await tabs.evaluate((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth, left: e.scrollLeft }));
        facts.indicatorTabs = { before: tabsBefore, after: tabsAfter };
        assert(tabsBefore.scrollWidth > tabsBefore.width && tabsAfter.left > 0, 'indicator tabs scroll on touch', facts.indicatorTabs);

        const tile = page.locator('.vela-indicator-panel:visible .vela-panel-close');
        const dark = await tile.evaluate((e) => getComputedStyle(e).color);
        await page.evaluate(() => window.__ws.setTheme('light'));
        await page.waitForTimeout(350);
        const light = await tile.evaluate((e) => getComputedStyle(e).color);
        const neutral = (s) => { const n = (s.match(/\d+/g)?.map(Number) ?? []).slice(0, 3); return n.length === 3 && Math.max(...n) - Math.min(...n) <= 30; };
        facts.iconColours = { dark, light };
        assert(neutral(dark) && neutral(light) && dark !== light, 'standard panel header icons remain subdued and theme-adaptive', facts.iconColours);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone page has no sideways overflow');
        await context.close();
    }

    assert(errors.length === 0, 'no page errors in panel interactions', errors.slice(0, 4));
    report('sync-panel-ergonomics', facts);
} finally {
    await browser.close();
}
