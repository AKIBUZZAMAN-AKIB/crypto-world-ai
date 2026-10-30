// Real offline workspace: parent-preserving compact menus, drawing overflow and alert
// selects. Run in Chromium and WebKit; no screenshots or synthetic HTML fixtures.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = { menus: [], drawing: {}, alerts: [] };
const near = (a, b) => Math.abs(a - b) < 2;
const inside = (r, b) => r.left >= b.left - 2 && r.top >= b.top - 2 && r.right <= b.right + 2 && r.bottom <= b.bottom + 2;
async function boot(width, height, touch = true) {
    const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    return { context, page };
}
// Real Chromium touch stream; Playwright WebKit lacks a touch-drag API, so the
// WebKit run sends the equivalent pointer path without claiming physical-device proof.
async function dragTouch(context, page, from, to) {
    if (engine === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 4 }] });
        for (let i = 1; i <= 10; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(from.x + (to.x - from.x) * i / 10), y: Math.round(from.y + (to.y - from.y) * i / 10), id: 4 }] });
            await page.waitForTimeout(15); // a real finger moves over time, not an instant fling
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    } else {
        await page.evaluate(({ from, to }) => {
            const target = document.elementFromPoint(from.x, from.y);
            const opts = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 95, isPrimary: true, button: 0 };
            target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: from.x, clientY: from.y }));
            for (let i = 1; i <= 10; i++) target.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: from.x + (to.x - from.x) * i / 10, clientY: from.y + (to.y - from.y) * i / 10 }));
            target.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: to.x, clientY: to.y }));
        }, { from, to });
    }
}
const stateOf = (panel) => panel.evaluate((el) => ({ box: el.getBoundingClientRect().toJSON(), scroll: el.querySelector('.vela-panel-body').scrollTop, title: el.querySelector('.vela-panel-title').textContent, max: el.hasAttribute('data-maximized') }));
const sameState = (a, b) => near(a.box.x, b.box.x) && near(a.box.y, b.box.y) && near(a.box.width, b.box.width) && near(a.box.height, b.box.height) && near(a.scroll, b.scroll) && a.title === b.title && a.max === b.max;

try {
    for (const size of [{ width: 240, height: 500 }, { width: 320, height: 640 }, { width: 390, height: 780 }]) {
        const { context, page } = await boot(size.width, size.height);
        await page.locator('.vela-mb-more').tap();
        const more = page.locator('.vela-more-panel'); await more.waitFor({ state: 'visible' });
        assert(await more.locator('.vela-md-search, .vela-md-search-clear').count() === 0, 'More has no search box, icon or clear button', size);
        for (const [name, selector] of [['Manage layouts', '.vela-lmp'], ['Cursor', '.vela-cursor-menu'], ['Time zone', '.vela-tzd-menu'], ['Chart actions', '.vela-chart-actions[data-state="open"]']]) {
            const row = more.locator('.vela-md-row', { hasText: name }).first();
            await row.scrollIntoViewIfNeeded();
            const before = await stateOf(more);
            await row.tap();
            const child = page.locator(selector); await child.waitFor({ state: 'visible' });
            await page.waitForTimeout(120);
            const after = await stateOf(more);
            const geometry = await child.evaluate((el) => {
                const root = el.closest('.vela-workspace');
                const view = window.visualViewport;
                return { rect: el.getBoundingClientRect().toJSON(), host: root?.getBoundingClientRect().toJSON(),
                    visual: { left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0, right: (view?.offsetLeft ?? 0) + (view?.width ?? innerWidth), bottom: (view?.offsetTop ?? 0) + (view?.height ?? innerHeight) },
                    grip: !!el.querySelector('.vela-panel-grip, .vela-size-grip, .vela-drawer-grab'),
                    modal: !!el.closest('[aria-modal="true"]'), overflow: document.documentElement.scrollWidth - innerWidth };
            });
            assert(await more.isVisible() && sameState(before, after), 'child opens without changing the parent pane or its scroll', { size, name, before, after });
            assert(geometry.rect.width <= 241 && geometry.rect.height <= 325 && inside(geometry.rect, geometry.host) && inside(geometry.rect, geometry.visual) && !geometry.grip && !geometry.modal && geometry.overflow <= 0,
                'child is compact, non-modal and bounded to the visible workspace', { size, name, geometry });
            assert(await row.getAttribute('aria-expanded') === 'true' && !!await row.getAttribute('aria-controls'), 'actual parent row exposes its open child', { size, name });
            await page.keyboard.press('Escape'); await page.waitForTimeout(170);
            assert(!(await child.isVisible()) && await more.isVisible() && await row.getAttribute('aria-expanded') === 'false', 'Escape dismisses only the child', { size, name });
        }
        const cursorRow = more.locator('.vela-md-row', { hasText: 'Cursor' }); await cursorRow.tap();
        await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        assert(await page.evaluate(() => window.__ws.getCursorStyle()) === 'dot' && (await cursorRow.textContent()).includes('Dot') && await more.isVisible(), 'cursor keyboard choice updates the chart and parent in place');
        const zone = more.locator('.vela-md-row', { hasText: 'Time zone' }); await zone.tap();
        await page.getByLabel('Search time zone').fill('dhaka');
        await page.locator('.vela-tzd-menu .vela-choice-row:visible').first().tap();
        assert(await page.evaluate(() => window.__ws.getState().timezone) === 'Asia/Dhaka' && (await zone.textContent()).includes('Asia/Dhaka') && await more.isVisible(), 'time-zone search and actual selection work without closing More');
        facts.menus.push({ ...size, zone: 'Asia/Dhaka', cursor: 'dot' });
        const moreDrawings = more.locator('.vela-md-row', { hasText: /^Drawings/ });
        assert(await moreDrawings.count() === 1 &&
            await more.locator('.vela-md-row', { hasText: 'Object tree' }).count() === 1,
            'More has a separate Drawings picker action while Object tree remains its own panel');
        await moreDrawings.tap();
        const drawingsFromMore = page.locator('.vela-drawings-panel:visible');
        await drawingsFromMore.waitFor({ state: 'visible' });
        await drawingsFromMore.locator('.vela-dd-close').tap();
        await page.locator('.vela-mb-drawings').tap();
        const drawingsPane = page.locator('.vela-drawings-panel:visible'); await drawingsPane.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
        const drawingsBox = await drawingsPane.boundingBox(), workspaceBox = await page.locator('.vela-workspace').boundingBox();
        const drawerControls = { max: await drawingsPane.locator('.vela-dd-max').getAttribute('aria-label'),
            close: await drawingsPane.locator('.vela-dd-close').getAttribute('aria-label'),
            radius: await drawingsPane.evaluate((el) => getComputedStyle(el).borderRadius) };
        assert(inside({ left: drawingsBox.x, top: drawingsBox.y, right: drawingsBox.x + drawingsBox.width, bottom: drawingsBox.y + drawingsBox.height },
            { left: workspaceBox.x, top: workspaceBox.y, right: workspaceBox.x + workspaceBox.width, bottom: workspaceBox.y + workspaceBox.height }) &&
            drawerControls.max === 'Maximize Drawings panel' && drawerControls.close === 'Close Drawings panel' && drawerControls.radius === '0px',
            'the bottom Drawings tab opens a square, bounded, resizable picker pane with standard controls', { drawingsBox, workspaceBox, drawerControls });
        await drawingsPane.locator('.vela-dd-max').tap(); await page.waitForTimeout(80);
        const expandedDrawings = await drawingsPane.boundingBox();
        assert(near(expandedDrawings.y, workspaceBox.y) && near(expandedDrawings.height, workspaceBox.height) &&
            await drawingsPane.locator('.vela-dd-max').getAttribute('aria-label') === 'Restore Drawings panel',
            'Drawings picker maximizes and offers Restore', { expandedDrawings, workspaceBox });
        await drawingsPane.locator('.vela-dd-max').tap();
        await drawingsPane.locator('.vela-dd-close').tap(); await page.waitForTimeout(200);
        assert(!(await drawingsPane.isVisible()), 'Drawings panel closes from its header action');
        await page.locator('.vela-mb-style').tap();
        const types = page.locator('.vela-cts:visible'); await types.waitFor();
        const corner = await types.evaluate((el) => ({ corners: [getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderTopRightRadius, getComputedStyle(el).borderBottomRightRadius, getComputedStyle(el).borderBottomLeftRadius], count: el.querySelectorAll('.vela-cts-tile').length }));
        assert(corner.corners.every((r) => r === '0px') && corner.count >= 10, 'chart-type surface is square and retains all tiles', { size, corner });
        const firstTile = types.locator('.vela-cts-tile[data-id="candles"]');
        const grid = await firstTile.evaluate((tile) => {
            const group = tile.closest('.vela-cts-grid'), tracks = getComputedStyle(group).gridTemplateColumns;
            const columns = /^repeat\((\d+)/.test(tracks) ? Number(tracks.match(/^repeat\((\d+)/)[1]) : tracks.trim().split(/\s+/).length;
            const tiles = [...group.querySelectorAll('.vela-cts-tile')], index = tiles.indexOf(tile);
            return { columns, next: tiles[index + columns]?.dataset.id };
        });
        await firstTile.focus(); await page.keyboard.press('ArrowDown');
        assert(!grid.next || await page.evaluate(() => document.activeElement?.dataset.id) === grid.next, 'chart-type keyboard follows the actual responsive column count', { size, grid });
        await types.locator('.vela-cts-cell[data-id="line"] .vela-cts-star').tap();
        assert(await types.locator('.vela-cts-cell[data-id="line"] .vela-cts-star').getAttribute('aria-pressed') === 'true', 'chart-type favorites remain usable');
        await types.locator('.vela-cts-tile[data-id="line"]').tap();
        assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('priceStyle')) === 'line', 'chart-type tile still changes the chart');
        await context.close();
    }

    {
        const { context, page } = await boot(320, 640);
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }] });
            window.__polishDrawing = drawing.id; chart.drawings.openSettings(drawing.id);
        });
        const bar = page.locator('.vela-dpop'); await bar.waitFor({ state: 'visible' });
        const inspect = () => bar.evaluate((el) => {
            const bar = el.querySelector('.vela-dpop-bar'), children = [...bar.children].filter((c) => getComputedStyle(c).display !== 'none');
            return { rect: el.getBoundingClientRect().toJSON(), chart: el.parentElement.getBoundingClientRect().toJSON(), wrap: getComputedStyle(bar).flexWrap,
                tops: children.map((c) => Math.round(c.getBoundingClientRect().top)), hidden: [...bar.querySelectorAll('[data-overflowed]')].map((c) => c.dataset.tip),
                overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const initial = await inspect();
        assert(initial.wrap === 'nowrap' && new Set(initial.tops).size <= 2 && initial.hidden.length > 1 && initial.overflow <= 0, 'drawing toolbar is one line and defers excess actions', initial);
        const kebab = bar.locator('[data-tip="More"]'); await kebab.tap();
        const menu = page.locator('.vela-dpop-more'); await menu.waitFor({ state: 'visible' });
        const geometry = await menu.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), host: el.parentElement.className, radius: getComputedStyle(el).borderRadius,
            role: el.getAttribute('role'), height: el.clientHeight, scrollHeight: el.querySelector('.vela-dpop-more-content').scrollHeight,
            horizontal: { client: el.clientWidth, scroll: el.scrollWidth, overflowX: getComputedStyle(el).overflowX },
            icons: [...el.querySelectorAll('[role="menuitem"] > span:first-child')].filter((node) => node.innerHTML.trim()).length,
            overflowed: [...el.querySelectorAll('[data-overflow]')].map((item) => item.dataset.menuLabel), actions: [...el.querySelectorAll('button')].map((item) => item.dataset.menuLabel) }));
        assert(geometry.host.includes('vela-workspace') && geometry.radius === '0px' && geometry.role === 'menu' && geometry.rect.bottom > initial.chart.bottom && geometry.height <= 325 && geometry.scrollHeight > geometry.height &&
            geometry.horizontal.overflowX === 'hidden' && geometry.horizontal.scroll <= geometry.horizontal.client + 1 && geometry.icons > 0,
            'existing ellipsis menu is icon-led, vertically scrollable, cannot pan sideways and can escape the chart cell', { initial, geometry });
        assert(initial.hidden.every((name) => geometry.overflowed.includes(name)) && geometry.actions.includes('Duplicate') && geometry.actions.includes('Reset settings'), 'overflow retains every hidden schema control and existing actions', { initial, geometry });
        await menu.locator('[data-overflow="1"]', { hasText: 'Line style' }).tap();
        await page.locator('.vela-dpop-item:visible', { hasText: 'Dashed' }).tap();
        assert(await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineStyle) === 'dashed', 'overflowed dropdown opens and changes the real drawing');
        await kebab.tap(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Lock' }).tap();
        assert(await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).locked), 'overflowed toggle still changes the drawing');
        await page.evaluate(() => { document.querySelector('#workspace').style.width = '240px'; });
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__ws.active.chart.drawings.openSettings(window.__polishDrawing));
        const narrow = await inspect();
        assert(narrow.wrap === 'nowrap' && narrow.hidden.length >= initial.hidden.length && narrow.overflow <= 0, 'toolbar recomputes overflow when reselected on a smaller chart', { initial, narrow });
        await page.evaluate(() => { document.querySelector('#workspace').style.width = '100%'; });
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__ws.active.chart.drawings.openSettings(window.__polishDrawing));
        assert((await inspect()).wrap === 'nowrap', 'toolbar remains one line after expansion');
        const gear = bar.locator('[data-tip="Settings"]');
        if (await gear.isVisible()) await gear.tap();
        else { await kebab.tap(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Settings' }).tap(); }
        const settings = page.locator('.vela-dialog.vela-dsp'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
        const panel = await settings.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), header: el.querySelector('.vela-dialog-header').getBoundingClientRect().toJSON(),
            grip: el.querySelector('.vela-dsp-pane-grip').getBoundingClientRect().toJSON(), host: el.closest('.vela-workspace').getBoundingClientRect().toJSON(),
            positioner: el.closest('.vela-dialog-positioner').parentElement.className, radius: getComputedStyle(el).borderRadius }));
        assert(panel.positioner.includes('vela-workspace') && panel.radius === '0px' && inside(panel.rect, panel.host) &&
            near(panel.rect.bottom, panel.host.bottom) && panel.grip.y < panel.header.y,
            'drawing settings uses a bottom-attached Data Window-style phone pane inside the workspace', { initial, panel });
        // Simulate the visual viewport shrinking for a software keyboard/pinch. The
        // fixed header and footer remain reachable while the body scrolls internally.
        await page.evaluate(() => {
            const view = window.visualViewport;
            for (const [key, value] of Object.entries({ offsetLeft: 20, offsetTop: 30, width: 260, height: 230 })) Object.defineProperty(view, key, { configurable: true, value });
            view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(160);
        const constrained = await settings.evaluate((el) => ({ panel: el.getBoundingClientRect().toJSON(), header: el.querySelector('.vela-dialog-header').getBoundingClientRect().toJSON(),
            ok: [...el.querySelectorAll('.vela-dialog-footer button')].at(-1).getBoundingClientRect().toJSON(), body: el.querySelector('.vela-dsp-scroll').getBoundingClientRect().toJSON() }));
        const visual = { left: 20, top: 30, right: 280, bottom: 260 };
        assert(inside(constrained.panel, visual) && inside(constrained.header, visual) && inside(constrained.ok, visual),
            'drawing settings fits a shortened visual viewport with header and actions accessible', constrained);
        await page.evaluate(() => {
            const view = window.visualViewport; for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) delete view[key];
            view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(160);
        const recovered = await settings.boundingBox();
        assert(recovered.width > constrained.panel.width && recovered.height > constrained.panel.height, 'drawing settings recovers its full size after the visual viewport returns', { constrained, recovered });
        await settings.locator('.vela-dsp-style').tap();
        assert(await page.locator('.vela-dsp-menu').isVisible() && await settings.isVisible(), 'drawing settings templates remain reachable outside the cell');
        await page.keyboard.press('Escape');
        assert(!(await page.locator('.vela-dsp-menu').isVisible()) && await settings.isVisible(), 'Escape dismisses the settings child before its parent');
        const original = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineColor);
        await page.evaluate(() => window.__ws.active.chart.drawings.update(window.__polishDrawing, { style: { lineColor: '#12abef' } }));
        await settings.getByRole('button', { name: 'Cancel' }).tap();
        const restored = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__polishDrawing).style.lineColor);
        assert(restored === original, 'Cancel still restores the panel-opening drawing snapshot', { original, restored });
        facts.drawing = { initial, geometry, panel, constrained, recovered, restored };
        await context.close();
    }

    {
        const { context, page } = await boot(390, 780);
        await page.evaluate(() => window.__ws.openAlertCreate());
        const panel = page.locator('.vela-ap'); await panel.waitFor({ state: 'visible' });
        const condition = panel.getByRole('combobox', { name: 'Condition' });
        for (const theme of ['dark', 'light']) {
            await page.evaluate((value) => window.__ws.setTheme(value), theme);
            await condition.tap(); const list = page.locator('.vela-alert-select-pop'); await list.waitFor({ state: 'visible' });
            const appearance = await list.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor,
                radius: getComputedStyle(el).borderRadius, listbox: !!el.querySelector('[role="listbox"]'), options: el.querySelectorAll('[role="option"]').length }));
            assert(appearance.radius === '0px' && appearance.rect.width <= 260 && appearance.rect.height <= 310 && appearance.listbox && appearance.options === 9 && await panel.isVisible(), 'alert condition uses a compact themed accessible menu without closing the panel', { theme, appearance });
            facts.alerts.push({ theme, ...appearance });
            await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
            assert(await page.locator('.vela-ac-select').inputValue() === 'cross-up' && await condition.getAttribute('aria-expanded') === 'false', 'combobox keyboard commits the same native value and closes');
        }
        await panel.getByLabel('Alert level').fill('120'); await panel.locator('.vela-ac-create').tap();
        await panel.getByRole('tab', { name: /^Alerts/ }).tap();
        const filter = panel.getByRole('combobox', { name: 'Filter alerts by status' }); await filter.tap();
        await page.locator('.vela-alert-select-option[data-value="paused"]').tap();
        assert(await page.locator('.vela-ap-filter').inputValue() === 'paused' && (await filter.textContent()).includes('Paused'), 'custom status filter changes the real filter');
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const line = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: 150 }] });
            chart.orchestrator.events.emit('drawing:alert-request', { id: line.id });
        });
        await condition.tap();
        const disabled = await page.locator('.vela-alert-select-pop [data-value^="move-"]').evaluateAll((items) => items.map((item) => item.disabled));
        assert(disabled.length === 4 && disabled.every(Boolean), 'drawing-backed moving conditions remain disabled');
        await page.keyboard.press('End');
        const active = await condition.getAttribute('aria-activedescendant');
        const activeDisabled = await page.locator(`#${active}`).isDisabled();
        assert(!activeDisabled, 'keyboard navigation skips disabled options');
        await page.keyboard.press('Escape');
        assert(await condition.getAttribute('aria-expanded') === 'false' && await panel.isVisible(), 'Escape returns from the select without dismissing Alerts');
        await context.close();
    }

    // Even on a 240px phone there is a usable header area to move the drawing card,
    // separate from its adjacent templates and close buttons.
    {
        const { context, page } = await boot(240, 500);
        await page.evaluate(() => window.__ws.setLayout('1')); await page.waitForTimeout(500);
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }] });
            chart.drawings.openSettings(drawing.id);
        });
        const bar = page.locator('.vela-dpop'), gear = bar.locator('[data-tip="Settings"]');
        if (await gear.isVisible()) await gear.tap();
        else { await bar.locator('[data-tip="More"]').tap(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Settings' }).tap(); }
        const panel = page.locator('.vela-dialog.vela-dsp'); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
        const before = await panel.boundingBox(), grip = await panel.locator('.vela-dsp-pane-grip').boundingBox();
        const from = { x: Math.round(grip.x + grip.width / 2), y: Math.round(grip.y + grip.height / 2) };
        await dragTouch(context, page, from, { x: from.x, y: from.y - 80 });
        const after = await panel.boundingBox(), host = await page.locator('.vela-workspace').boundingBox();
        assert(after.height > before.height + 30 && near(after.y + after.height, host.y + host.height) &&
            inside({ left: after.x, top: after.y, right: after.x + after.width, bottom: after.y + after.height },
                { left: host.x, top: host.y, right: host.x + host.width, bottom: host.y + host.height }),
            'the phone pane grip resizes upward while keeping its bottom attached and bounds intact', { before, after, grip, from, host });
        await page.waitForTimeout(220); await panel.locator('.vela-dialog-close').tap(); await page.waitForTimeout(250);
        assert(!(await panel.isVisible()), 'narrow bottom-pane drawing settings can still be closed');
        facts.drawing.narrowTouch = { before, after, grip }; await context.close();
    }

    // A genuinely embedded workspace: the panel may leave even the whole layout,
    // while direct header dragging keeps its full header inside the browser viewport.
    {
        const { context, page } = await boot(1000, 700, true);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '320px', height: '360px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }] });
            chart.drawings.openSettings(drawing.id);
        });
        const bar = page.locator('.vela-dpop'); const gear = bar.locator('[data-tip="Settings"]');
        if (await gear.isVisible()) await gear.click();
        else { await bar.locator('[data-tip="More"]').click(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Settings' }).click(); }
        const settings = page.locator('.vela-dialog.vela-dsp'); await settings.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
        const initial = await settings.boundingBox(), root = await page.locator('.vela-workspace').boundingBox();
        const grip = await settings.locator('.vela-dsp-pane-grip').boundingBox();
        const header = await settings.locator('.vela-dialog-header').boundingBox();
        assert(near(initial.x, root.x) && near(initial.width, root.width) && near(initial.y + initial.height, root.y + root.height) &&
            inside({ left: initial.x, top: initial.y, right: initial.x + initial.width, bottom: initial.y + initial.height },
                { left: root.x, top: root.y, right: root.x + root.width, bottom: root.y + root.height }) &&
            grip.y < header.y && await settings.locator('.vela-dialog-max').count() === 1,
            'phone drawing settings is a Data Window-style bottom pane with separate grip and maximize control', { initial, root, grip, header, maximize: await settings.locator('.vela-dialog-max').count() });
        const max = settings.locator('.vela-dialog-max');
        await max.tap(); await page.waitForTimeout(80);
        const full = await settings.boundingBox();
        assert(near(full.y, root.y) && near(full.height, root.height) && await max.getAttribute('aria-label') === 'Restore',
            'maximize fills the pane host and changes to Restore', { full, root });
        await max.tap(); await page.waitForTimeout(80);
        const beforeResize = await settings.boundingBox(), gripBefore = await settings.locator('.vela-dsp-pane-grip').boundingBox();
        const from = { x: Math.round(gripBefore.x + gripBefore.width / 2), y: Math.round(gripBefore.y + gripBefore.height / 2) };
        const to = { x: from.x, y: Math.max(root.y + 2, from.y - 52) };
        await dragTouch(context, page, from, to);
        const resized = await settings.boundingBox(), gripAfter = await settings.locator('.vela-dsp-pane-grip').boundingBox();
        const scroll = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
        assert(resized.height > beforeResize.height + 20 && near(resized.y + resized.height, root.y + root.height) && near(gripAfter.y, resized.y) &&
            inside({ left: resized.x, top: resized.y, right: resized.x + resized.width, bottom: resized.y + resized.height },
                { left: root.x, top: root.y, right: root.x + root.width, bottom: root.y + root.height }) && scroll.every((n) => n <= 0),
            'the separate phone grip directly resizes upward while the pane stays bottom-attached and in bounds', { beforeResize, resized, gripAfter, root, from, to, scroll });
        await settings.locator('.vela-dialog-close').click();
        assert(!(await settings.isVisible()), 'bottom-pane drawing settings retains a working Close control');
        facts.drawing.embedded = { initial, root, grip, header, full, beforeResize, resized, gripAfter, touchMethod: engine === 'chromium' ? 'CDP' : 'synthetic pointer', scroll };
        await context.close();
    }

    // Closing the parent through the dock API also disposes every anchored child.
    {
        const { context, page } = await boot(390, 780);
        for (const [name, selector] of [['Manage layouts', '.vela-lmp'], ['Cursor', '.vela-cursor-menu'], ['Time zone', '.vela-tzd-menu'], ['Chart actions', '.vela-chart-actions[data-state="open"]']]) {
            await page.locator('.vela-mb-more').tap();
            await page.locator('.vela-more-panel .vela-md-row', { hasText: name }).tap();
            await page.locator(selector).waitFor({ state: 'visible' });
            await page.evaluate(() => window.__ws.dock.toggle('more', false));
            await page.waitForTimeout(220);
            assert(!(await page.locator(selector).isVisible()) && !(await page.locator('.vela-more-panel').isVisible()), 'programmatic parent close removes the child', name);
        }
        await context.close();
    }

    assert(errors.length === 0, 'no uncaught page errors', errors);
    report('phone-polish', { engine, ...facts, errors });
} finally { await browser.close(); }
