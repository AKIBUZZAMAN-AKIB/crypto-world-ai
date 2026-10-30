// One professional Layout Setup pane for desktop and phone, exercised through the
// real deterministic workspace (no artificial HTML harness). Run with SYNC_BROWSER=webkit
// to repeat the same scenarios in WebKit; Chromium also uses real touch injection.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [];
const near = (a, b, n = 3) => Math.abs(a - b) <= n;
async function boot(viewport, phone = false, query = '') {
    const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}
async function mouseDrag(page, target, dx, dy, point) {
    const r = await target.boundingBox();
    if (!r) throw new Error('No drag target');
    const x = r.x + (point?.x ?? r.width / 2), y = r.y + (point?.y ?? r.height / 2);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(160);
}
async function touchDrag(context, page, target, dx, dy, point) {
    if (engine === 'webkit') return mouseDrag(page, target, dx, dy, point);
    const r = await target.boundingBox();
    if (!r) throw new Error('No touch target');
    const x = r.x + (point?.x ?? r.width / 2), y = r.y + (point?.y ?? r.height / 2);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach(); await page.waitForTimeout(550);
}
async function boxInfo(page) {
    return page.locator('.vela-layout-setup').evaluate(el => ({
        pane: el.getBoundingClientRect().toJSON(),
        host: el.parentElement.getBoundingClientRect().toJSON(),
        header: el.querySelector('.vela-panel-header').getBoundingClientRect().toJSON(),
        grip: el.querySelector('.vela-panel-grip').getBoundingClientRect().toJSON(),
        floating: el.dataset.freeFloating === '1',
        max: el.hasAttribute('data-maximized'),
        radius: getComputedStyle(el).borderRadius,
        pageW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pageH: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
}
try {
    {
        const { context, page } = await boot({ width: 1280, height: 800 });
        const trigger = page.locator('button[aria-label^="Layout —"]');
        await trigger.click();
        const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
        facts.desktop = await boxInfo(page);
        facts.desktopControls = await panel.evaluate(el => ({
            standard: el.hasAttribute('data-standard-pane'),
            oldPicker: !!document.querySelector('.vela-lp[data-setup-only]'),
            headerOrder: [...el.querySelector('.vela-panel-header').children].map(x => x.className),
            tabs: [...el.querySelectorAll('[role="tab"]')].map(x => ({ label: x.textContent.trim(), selected: x.getAttribute('aria-selected'), controls: x.getAttribute('aria-controls'), tabIndex: x.tabIndex })),
            gridCount: el.querySelectorAll('.vela-lp-grid .vela-lp-sq').length,
            gridSelected: el.querySelectorAll('.vela-lp-grid .vela-lp-sq[data-on]').length,
            presetCount: el.querySelectorAll('.vela-ls-preset').length,
            squares: [...el.querySelectorAll('.vela-lp-grid .vela-lp-sq')].slice(0, 1).map(x => { const r = x.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(x).borderRadius]; }),
        }));
        assert(facts.desktopControls.standard && !facts.desktopControls.oldPicker && !facts.desktop.floating,
            'desktop opens the standard docked pane instead of the old popover', { box: facts.desktop, controls: facts.desktopControls });
        assert(near(facts.desktop.pane.bottom, facts.desktop.host.bottom) && near(facts.desktop.pane.top, facts.desktop.host.top) && facts.desktop.radius === '0px',
            'desktop dock has Data Window geometry and square corners', facts.desktop);
        assert(facts.desktop.pageW === 0 && facts.desktop.pageH === 0, 'the pane does not grow the document', facts.desktop);
        assert(await trigger.getAttribute('aria-expanded') === 'true', 'toolbar reflects its open state');
        assert(facts.desktopControls.headerOrder.findIndex(x => String(x).includes('dock-toggle')) + 1 === facts.desktopControls.headerOrder.findIndex(x => String(x).includes('panel-close')),
            'Float/Dock sits immediately before Close', facts.desktopControls.headerOrder);
        assert(facts.desktopControls.tabs.map(x => x.label).join('|') === 'Layout|Chart syncing'
            && facts.desktopControls.tabs[0].selected === 'true' && facts.desktopControls.tabs[1].selected === 'false'
            && facts.desktopControls.tabs[0].tabIndex === 0 && facts.desktopControls.tabs[1].tabIndex === -1,
            'the pane starts on Layout with a proper roving tablist', facts.desktopControls.tabs);
        assert(await panel.evaluate(el => [...el.querySelectorAll('[role="tab"]')].every(tab => {
            const view = el.querySelector(`#${tab.getAttribute('aria-controls')}`);
            return view?.getAttribute('role') === 'tabpanel' && view.getAttribute('aria-labelledby') === tab.id;
        })), 'tabs are linked to their tab panels');
        assert(facts.desktopControls.gridCount === 16 && facts.desktopControls.gridSelected === 4 && facts.desktopControls.presetCount > 10
            && near(facts.desktopControls.squares[0][0], facts.desktopControls.squares[0][1], 0.5) && facts.desktopControls.squares[0][2] === '0px',
            'the selected 2×2 grid is square and preset choices remain', facts.desktopControls);
        const help = panel.getByRole('button', { name: 'How to choose a layout' });
        await help.click();
        assert(await help.getAttribute('aria-expanded') === 'true' && await panel.locator('.vela-ls-helptext').isVisible(),
            'layout instructions remain accessible by click or tap');
        await help.click();
        await panel.getByRole('tab', { name: 'Layout', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        assert(await panel.getByRole('tab', { name: 'Chart syncing' }).getAttribute('aria-selected') === 'true'
            && await panel.getByRole('tab', { name: 'Chart syncing' }).evaluate(e => e === document.activeElement),
            'keyboard arrow activates and focuses the second tab');
        const syncView = panel.locator('.vela-ls-sync-view');
        const labels = await syncView.locator('.vela-ls-syncrows [role="switch"]').allTextContents();
        facts.syncLabels = labels.map(x => x.trim());
        assert(facts.syncLabels.join('|') === 'Date range|Time|Symbol|Interval|Crosshair|Drawings|Style', 'all sync switches are present', facts.syncLabels);
        assert(await syncView.locator('.vela-md-matrix-head[data-cell]').count() === 4, 'matrix has all four chart columns');
        const fields = [['Date range', 'viewport'], ['Time', 'time'], ['Symbol', 'symbol'], ['Interval', 'timeframe'],
            ['Crosshair', 'crosshair'], ['Drawings', 'drawings'], ['Style', 'style']];
        for (const [label, field] of fields) {
            const control = syncView.getByRole('switch', { name: `${label} sync` });
            const wasOn = await control.getAttribute('aria-checked') === 'true';
            await control.click();
            assert(await control.getAttribute('aria-checked') === String(!wasOn)
                && await page.evaluate(k => Boolean(window.__ws.sync.state()[k]), field) === !wasOn,
                `${label} switch updates both its visual and model state`);
            await control.click();
            assert(await control.getAttribute('aria-checked') === String(wasOn), `${label} switch restores its original state`);
        }
        const symbol = syncView.getByRole('switch', { name: 'Symbol sync' });
        const beforePairs = await page.evaluate(() => window.__ws.getState().charts.map(c => c.symbol));
        await symbol.click();
        assert(await symbol.getAttribute('aria-checked') === 'true', 'Symbol switch turns on and reports its state');
        assert(JSON.stringify(await page.evaluate(() => window.__ws.getState().charts.map(c => c.symbol))) === JSON.stringify(beforePairs),
            'enabling a link does not rewrite existing markets');
        await page.evaluate(() => window.__ws.cell('b').setSymbol('ZZZ'));
        await page.waitForFunction(() => window.__ws.getState().charts.every(c => c.symbol === 'ZZZ'), null, { timeout: 12000 });
        assert(await symbol.evaluate(e => e === document.activeElement), 'live repaint does not discard the focused switch');
        // Group B and C together. They follow changes in both directions; A and D stay independent.
        await syncView.locator('.vela-md-chip[data-kind="symbol"][data-cell="b"]').click();
        await syncView.locator('.vela-md-chip[data-kind="symbol"][data-cell="c"]').click({ button: 'right' });
        await page.locator('.vela-menu-item[data-vei-id="mark:red"]').click();
        await page.evaluate(() => window.__ws.cell('b').setSymbol('YYY'));
        await page.waitForFunction(() => window.__ws.cell('b').symbol === 'YYY' && window.__ws.cell('c').symbol === 'YYY', null, { timeout: 12000 });
        await page.evaluate(() => window.__ws.cell('c').setSymbol('AAA'));
        await page.waitForFunction(() => window.__ws.cell('b').symbol === 'AAA' && window.__ws.cell('c').symbol === 'AAA', null, { timeout: 12000 });
        facts.grouped = await page.evaluate(() => ({ symbols: window.__ws.getState().charts.map(c => c.symbol), state: window.__ws.sync.state().symbol }));
        assert(facts.grouped.symbols.join('|') === 'ZZZ|AAA|AAA|ZZZ', 'selected chart sync remains bidirectional without changing other groups', facts.grouped);
        await symbol.click();
        assert(await symbol.getAttribute('aria-checked') === 'false' && !await page.evaluate(() => window.__ws.sync.state().symbol),
            'turning off a grouped link is a visible, real state change');
        await symbol.click();
        assert(JSON.stringify(await page.evaluate(() => window.__ws.sync.state().symbol)) === JSON.stringify(facts.grouped.state),
            'reenabling a link restores its previous chart groups');
        const groupName = syncView.locator('.vela-ls-group[data-group="red"] .vela-ls-group-name');
        await groupName.click();
        const nameInput = syncView.locator('.vela-ls-group[data-group="red"] input');
        await nameInput.fill('Review'); await nameInput.press('Enter');
        assert(await syncView.locator('.vela-ls-group[data-group="red"] .vela-ls-group-name').textContent() === 'Review', 'group names can be edited in place');
        await syncView.locator('.vela-ls-group[data-group="red"] .vela-ls-group-mark').click();
        const markInput = syncView.locator('.vela-ls-group[data-group="red"] input');
        await markInput.fill('★'); await markInput.press('Enter');
        assert(await page.evaluate(() => window.__ws.groupMark('red')) === '★', 'group marks remain editable');
        const scope = syncView.locator('.vela-ls-row', { hasText: 'Drawing scope' });
        const drawBefore = await syncView.getByRole('switch', { name: 'Drawings sync' }).getAttribute('aria-checked');
        await scope.click();
        assert(await scope.innerText().then(x => x.includes('Global')) && await syncView.getByRole('switch', { name: 'Drawings sync' }).getAttribute('aria-checked') === drawBefore,
            'drawing scope changes independently of the Drawings switch');
        await syncView.locator('.vela-md-chip-all[data-kind="symbol"]').click();
        assert(await page.evaluate(() => window.__ws.sync.state().symbol === true), 'ALL returns a link to one common group');
        await panel.getByRole('tab', { name: 'Layout', exact: true }).click();
        const grid = panel.locator('.vela-lp-grid');
        await grid.locator('.vela-lp-sq[data-r="0"][data-c="1"]').click();
        await page.waitForFunction(() => window.__ws.cells().length === 2);
        assert(await panel.isVisible() && await grid.locator('.vela-lp-sq[data-on]').count() === 2,
            'choosing 1×2 updates the selected squares and keeps the pane open');
        assert(await panel.locator('.vela-ls-row', { hasText: 'Apply settings to all charts' }).count() === 1
            && await panel.locator('.vela-ls-row', { hasText: 'Apply indicators to all charts' }).count() === 1,
            'layout-wide settings and indicator actions remain available');
        const pool = panel.locator('.vela-ls-row', { hasText: 'Remove 2 hidden charts' });
        await pool.click();
        assert(await panel.locator('.vela-ls-row[data-danger="1"]', { hasText: 'confirm' }).isVisible(), 'hidden chart removal asks for confirmation');
        await panel.locator('.vela-ls-row[data-danger="1"]').click();
        assert(await page.evaluate(() => window.__ws.hiddenChartCount) === 0 && await panel.locator('.vela-ls-row', { hasText: 'Undo — restore 2 hidden charts' }).isVisible(),
            'hidden charts are removed only on confirmation, with Undo');
        await panel.locator('.vela-ls-row', { hasText: 'Undo — restore 2 hidden charts' }).click();
        assert(await page.evaluate(() => window.__ws.hiddenChartCount) === 2, 'hidden-chart Undo restores the pool');
        const preset = panel.locator('.vela-ls-preset[data-preset="1-2"]');
        await preset.scrollIntoViewIfNeeded(); await preset.click();
        assert(await page.evaluate(() => window.__ws.getState().layout) === '1-2' && await preset.getAttribute('aria-checked') === 'true',
            'asymmetric presets apply and announce the selected choice');
        await grid.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
        assert((await grid.getAttribute('aria-label')).includes('2 by 2'), 'grid arrows preview one layout size');
        await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__ws.cells().length === 4);
        assert(await page.evaluate(() => window.__ws.getState().layout) === '4', 'Enter applies the keyboard grid choice');
        await grid.evaluate(el => el.setAttribute('dir', 'rtl')); await grid.focus(); await page.keyboard.press('ArrowRight');
        assert((await grid.getAttribute('aria-label')).includes('1 by 2'), 'grid arrows respect RTL reading direction');
        await grid.evaluate(el => el.removeAttribute('dir'));
        // Exercise the migrated layout-wide verbs through the actual pane, not only the APIs.
        await page.evaluate(() => {
            const ws = window.__ws;
            ws.setActiveCell('a'); ws.sync.set('style', false);
            for (const cell of ws.cells()) cell.chart.renderer.set('axisLabels', cell.id !== 'a');
            const source = ws.cell('a').chart;
            for (const indicator of source.indicators()) indicator.remove();
            source.addNativeIndicator('rsi').setInput('length', 11);
        });
        await panel.getByRole('button', { name: 'Apply settings to all charts' }).click();
        assert((await page.evaluate(() => window.__ws.cells().map(c => c.chart.renderer.get('axisLabels')))).every(x => x === false),
            'pane action applies the active chart settings across the layout');
        await panel.getByRole('button', { name: 'Apply indicators to all charts' }).click();
        await page.waitForFunction(() => window.__ws.cells().every(c => c.chart.indicators().some(h => h.nativeType === 'rsi' && h.inputValues().length === 11)), null, { timeout: 12000 });
        assert(true, 'pane action applies the active indicator set to every chart');
        await panel.getByRole('radio', { name: 'Set 2' }).click();
        assert(await panel.getByRole('radio', { name: 'Set 2' }).getAttribute('aria-checked') === 'true'
            && await page.evaluate(() => window.__ws.getState().linkedGroup) === 'green', 'link-tabs picker updates its live model');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
        await panel.getByRole('button', { name: 'Share' }).click();
        await page.waitForFunction(() => document.querySelector('.vela-ls-message')?.textContent.includes('Could not copy'));
        assert(await panel.locator('.vela-ls-message').isVisible(), 'clipboard denial is reported instead of claiming a copy');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window.__copiedLayoutLink = text; return Promise.resolve(); } } }));
        await panel.getByRole('button', { name: 'Share' }).click();
        await page.waitForFunction(() => document.querySelector('.vela-ls-message')?.textContent.includes('Workspace link copied'));
        assert(await page.evaluate(() => typeof window.__copiedLayoutLink === 'string' && window.__copiedLayoutLink.includes('#')),
            'Share copies a real workspace link on success');
        const manager = panel.locator('.vela-ls-manager'); await manager.scrollIntoViewIfNeeded(); await manager.click();
        const managerMenu = page.locator('.vela-lmp'); await managerMenu.waitFor({ state: 'visible' });
        facts.manager = await managerMenu.evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), popover: !!el.closest('.vela-popover'), autosave: !!el.querySelector('[data-action="autosave"]') }));
        assert(facts.manager.popover && facts.manager.autosave && facts.manager.rect.width <= 225 && facts.manager.rect.height < 340,
            'Manage layouts remains a separate compact floating menu', facts.manager);
        assert(await panel.isVisible(), 'the setup pane remains mounted behind its manager');
        await page.keyboard.press('Escape');
        if (await managerMenu.isVisible()) await page.keyboard.press('Escape');
        await managerMenu.waitFor({ state: 'hidden' });
        const dockBefore = await boxInfo(page);
        await mouseDrag(page, panel.locator('.vela-panel-resizer'), -55, 0);
        const dockAfter = await boxInfo(page);
        assert(dockAfter.pane.width > dockBefore.pane.width + 35 && near(dockAfter.pane.bottom, dockBefore.pane.bottom),
            'the docked pane resizes directly at its left seam', { dockBefore, dockAfter });
        await panel.locator('.vela-panel-dock-toggle').click();
        const floated = await boxInfo(page);
        await page.locator('.vela-widget-panel-dataWindow').click();
        assert(floated.floating && await panel.isVisible() && await page.locator('.vela-dw').isVisible(),
            'a floating Layout Setup coexists with a docked Data Window', floated);
        const close = panel.locator('.vela-panel-close'), resize = panel.locator('.vela-panel-corner-resize');
        assert(await close.evaluate(el => el.nextElementSibling?.classList.contains('vela-panel-corner-resize')),
            'direct resize button is immediately after Close');
        const floatBefore = await boxInfo(page);
        await resize.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
        const floatAfter = await boxInfo(page);
        assert(Math.abs(floatAfter.pane.width - floatBefore.pane.width) > 5 && Math.abs(floatAfter.pane.height - floatBefore.pane.height) > 5,
            'floating size button supports direct keyboard resizing in both dimensions', { floatBefore, floatAfter });
        await mouseDrag(page, panel.locator('.vela-panel-header'), -70, 35, { x: 12, y: 15 });
        const moved = await boxInfo(page);
        assert(moved.pane.x < floatAfter.pane.x - 25 && moved.pageW === 0 && moved.pageH === 0,
            'floating header moves without growing the document', moved);
        await panel.locator('.vela-panel-dock-toggle').click();
        assert(!await panel.evaluate(el => el.dataset.freeFloating === '1') && !await page.locator('.vela-dw').isVisible(),
            'docking restores one docked column');
        await panel.locator('.vela-panel-close').click();
        assert(await trigger.getAttribute('aria-expanded') === 'false', 'closing the pane resets toolbar state');
        await trigger.focus(); await page.keyboard.press('Enter');
        assert(await panel.getByRole('tab', { name: 'Layout', exact: true }).evaluate(el => el === document.activeElement),
            'keyboard opening focuses the active tab');
        await page.keyboard.press('Escape');
        // A tooltip can own the first Escape; dismiss it before the underlying pane.
        if (await trigger.getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
        assert(await trigger.evaluate(el => el === document.activeElement) && await trigger.getAttribute('aria-expanded') === 'false',
            'Escape closes the focused pane and returns focus to its toolbar door',
            await page.evaluate(() => ({ focus: document.activeElement?.outerHTML.slice(0, 200), expanded: document.querySelector('button[aria-label^="Layout —"]')?.getAttribute('aria-expanded') })));
        // A real status-line badge, not a second sync surface, opens on its own chart.
        await page.waitForTimeout(250);
        await page.locator('.vela-cell').nth(2).locator('.vela-sl-marks').click();
        await panel.waitFor({ state: 'visible' });
        assert(await panel.getByRole('tab', { name: 'Chart syncing' }).getAttribute('aria-selected') === 'true'
            && await panel.locator('.vela-md-matrix-head[data-cell="c"]').getAttribute('data-focus') !== null,
            'the chart status badge opens the shared syncing tab at that chart');
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true, '?persist=1');
        await page.locator('.vela-mb-more').tap();
        const entries = await page.locator('.vela-md-row').allTextContents();
        facts.phoneEntries = entries.filter(s => /Layout setup|Chart syncing/.test(s));
        assert(facts.phoneEntries.length === 1 && facts.phoneEntries[0].includes('Layout setup'), 'phone More offers one Layout setup entry', facts.phoneEntries);
        await page.locator('.vela-md-row', { hasText: 'Layout setup' }).tap();
        const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(550);
        const before = await boxInfo(page); facts.phone = before;
        assert(near(before.pane.bottom, before.host.bottom) && near(before.pane.width, before.host.width) && before.radius === '0px',
            'phone pane is full-width, square and bottom-attached', before);
        assert(near(before.grip.width, before.pane.width) && before.grip.height >= 24 && near(before.grip.bottom, before.header.top),
            'phone resize strip is above the heading', before);
        const phoneSquare = await panel.locator('.vela-lp-sq').first().boundingBox();
        facts.phoneSquare = phoneSquare;
        assert(phoneSquare.width >= 44 && phoneSquare.height >= 44 && near(phoneSquare.width, phoneSquare.height, 0.5),
            'ordinary phone grid choices have square 44-pixel touch targets', phoneSquare);
        const phoneHelp = panel.getByRole('button', { name: 'How to choose a layout' });
        await phoneHelp.tap();
        assert(await phoneHelp.getAttribute('aria-expanded') === 'true' && await panel.locator('.vela-ls-helptext').isVisible(),
            'grid help is available by touch');
        await phoneHelp.tap();
        await touchDrag(context, page, panel.locator('.vela-panel-header'), 0, -75, { x: 5, y: 15 });
        const afterHead = await boxInfo(page);
        assert(near(afterHead.pane.top, before.pane.top) && near(afterHead.pane.bottom, before.pane.bottom), 'phone heading drag never detaches the pane', { before, afterHead });
        await touchDrag(context, page, panel.locator('.vela-panel-grip'), 0, -75);
        const afterGrip = await boxInfo(page);
        assert(afterGrip.pane.height > before.pane.height + 40 && near(afterGrip.pane.bottom, before.pane.bottom), 'only the strip changes height and keeps the bottom attached', { before, afterGrip });
        await panel.locator('.vela-panel-max').tap();
        const full = await boxInfo(page); assert(full.max, 'phone fullscreen opens', full);
        await panel.locator('.vela-panel-max').tap();
        const restored = await boxInfo(page);
        assert(!restored.max && near(restored.pane.height, afterGrip.pane.height) && near(restored.pane.bottom, afterGrip.pane.bottom),
            'phone fullscreen restores the chosen size and attachment', { afterGrip, restored });
        await page.waitForTimeout(900); await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
        const phoneReload = await boxInfo(page);
        assert(near(phoneReload.pane.height, restored.pane.height, 4) && near(phoneReload.pane.bottom, phoneReload.host.bottom),
            'the bottom-attached phone pane and chosen height survive reload', { restored, phoneReload });
        const layoutTab = panel.getByRole('tab', { name: 'Layout', exact: true });
        const syncTab = panel.getByRole('tab', { name: 'Chart syncing' });
        await syncTab.tap();
        assert(await syncTab.getAttribute('aria-selected') === 'true' && await panel.locator('.vela-ls-sync-view').isVisible()
            && !await panel.locator('.vela-ls-layout-view').isVisible(), 'phone switches between the same two actual tab panels');
        const syncBox = await boxInfo(page);
        assert(syncBox.pageW === 0 && syncBox.pageH === 0, 'the tall sync matrix never makes the phone document scroll', syncBox);
        const rows = await panel.locator('.vela-ls-syncrows [role="switch"]').count();
        assert(rows === 7 && await panel.locator('.vela-md-matrixwrap[data-shell="phone"]').count() === 1,
            'phone sync tab retains all links and the chart grouping matrix', { rows });
        await panel.getByRole('switch', { name: 'Interval sync' }).tap();
        assert(await page.evaluate(() => window.__ws.sync.state().timeframe === true), 'phone switch changes the shared sync model');
        await layoutTab.tap();
        assert(await panel.locator('.vela-lp-grid .vela-lp-sq[data-on]').count() === 4, 'phone returns to the selected layout without opening a new panel');
        await panel.locator('.vela-panel-close').tap();
        await page.evaluate(() => window.__ws.openSyncDrawer('c'));
        await panel.waitFor({ state: 'visible' });
        assert(await syncTab.getAttribute('aria-selected') === 'true'
            && await panel.locator('.vela-md-matrix-head[data-cell="c"]').getAttribute('data-focus') !== null,
            'a chart-specific syncing entry opens the same pane on its chart column');
        await page.setViewportSize({ width: 850, height: 390 }); await page.waitForTimeout(500);
        const landscape = await boxInfo(page);
        assert(await page.locator('.vela-workspace').getAttribute('data-layout') === 'desktop' && near(landscape.pane.top, landscape.host.top),
            'landscape rotates to desktop-like dock chrome', landscape);
        await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(500);
        const portrait = await boxInfo(page);
        assert(await page.locator('.vela-workspace').getAttribute('data-layout') === 'mobile' && near(portrait.pane.bottom, portrait.host.bottom)
            && portrait.pageW === 0 && portrait.pageH === 0,
            'returning to portrait keeps the pane bottom-attached without growing the page', portrait);
        facts.phoneRestored = restored; facts.landscape = landscape; facts.portrait = portrait;
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 200, height: 320 }, true);
        await page.evaluate(() => window.__ws.openSyncDrawer('d'));
        const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
        const narrow = await boxInfo(page);
        const matrix = panel.locator('.vela-md-matrixwrap');
        const geometry = await matrix.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, left: el.scrollLeft }));
        const focused = panel.locator('.vela-md-matrix-head[data-cell="d"]');
        assert(await focused.getAttribute('data-focus') !== null && geometry.scroll > geometry.client,
            'narrow phone retains the horizontally scrollable matrix and chart-specific focus', geometry);
        await matrix.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        assert(await matrix.evaluate(el => el.scrollLeft > 0), 'overflowing matrix columns remain reachable at 200 pixels');
        await panel.getByRole('tab', { name: 'Layout', exact: true }).tap();
        const squares = await panel.locator('.vela-lp-sq').evaluateAll(list => list.slice(0, 1).map(el => {
            const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
        }));
        assert(near(squares[0].width, squares[0].height, 0.5) && squares[0].left >= -1 && squares[0].right <= 201,
            'narrow phone grid remains square and within the pane', squares);
        const after = await boxInfo(page);
        assert(after.pageW === 0 && after.pageH === 0 && near(after.pane.bottom, after.host.bottom),
            'narrow phone content scrolls inside its pane instead of the page', { narrow, after });
        facts.narrowPhone = { box: after.pane, matrix: geometry, square: squares[0] };
        await context.close();
    }
    {
        const { context, page } = await boot({ width: 1100, height: 720 }, false, '?persist=1');
        await page.locator('button[aria-label^="Layout —"]').click();
        const panel = page.locator('.vela-layout-setup');
        await panel.locator('.vela-panel-dock-toggle').click();
        await panel.locator('.vela-panel-corner-resize').focus();
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
        await mouseDrag(page, panel.locator('.vela-panel-header'), -90, 40, { x: 12, y: 15 });
        const savedBox = await boxInfo(page);
        const savedState = await page.evaluate(() => structuredClone(window.__ws.getState().panels));
        assert(savedState.floatingOpen?.includes('layoutSetup') && savedState.floatPositions?.layoutSetup,
            'Layout Setup participates in normal floating-panel persistence', savedState);
        await page.waitForTimeout(900); await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60000 });
        await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(300);
        const restoredBox = await boxInfo(page);
        assert(restoredBox.floating && near(restoredBox.pane.x, savedBox.pane.x, 4) && near(restoredBox.pane.y, savedBox.pane.y, 4)
            && near(restoredBox.pane.width, savedBox.pane.width, 4) && near(restoredBox.pane.height, savedBox.pane.height, 4),
            'floating mode, size, and position survive reload', { savedBox, restoredBox });
        facts.desktopPersistence = { saved: savedBox.pane, restored: restoredBox.pane };
        await context.close();
    }
    assert(errors.length === 0, 'no page errors', errors.slice(0, 5));
} finally { await browser.close(); }
report('layout-setup-pane', { engine, ...facts, errors });
