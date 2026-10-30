// Real Object Tree interaction: type-specific groups, cross-pane order, template shortcuts,
// live indicator links and compact child surfaces. No screenshots or mock HTML.
import { open, assert, report, OFFLINE } from './helpers.mjs';

const { browser, page, errors } = await open({ base: OFFLINE, settle: 1200 });
const facts = {};
try {
    const setup = await page.evaluate(() => {
        const ws = window.__ws, chart = ws.active.chart;
        const rsi = chart.addNativeIndicator('rsi');
        const sma = chart.addNativeIndicator('sma');
        const range = chart.getVisibleRange(), p = chart.lastBar.close;
        const anchors = [{ time: range.from, price: p * .99 }, { time: range.to, price: p * 1.01 }];
        chart.drawings.add('box', { anchors });
        chart.drawings.add('box', { anchors });
        const draws = chart.drawings.all().map((d) => d.id);
        return { rsi: rsi.id, sma: sma.id, draws };
    });
    await page.waitForTimeout(900);
    await page.locator('button[aria-label="Object tree"]').click();
    await page.waitForSelector('.vela-panel.vela-ot:not([hidden])');
    const before = await page.evaluate(() => {
        const c = window.__ws.active.chart;
        return { panes: c.panes.list().map((p) => ({ id: p.id, members: p.indicators.map((i) => i.id) })), drawings: c.drawings.all().map((d) => ({ id: d.id, pane: d.paneId, z: d.zIndex })), order: c.renderer.get('seriesOrder') };
    });
    await page.evaluate(({ rsi, sma, draws }) => {
        const ws = window.__ws, chart = ws.active.chart;
        ws.objectTree.setGroupsFor(chart, [
            { id: 'gd', name: 'Drawing folder', ids: [draws[0]] },
            { id: 'gi', name: 'Indicator folder', ids: [], indicators: [rsi] },
            { id: 'gm', name: 'Mixed folder', ids: [draws[1]], indicators: [sma] },
        ]);
    }, setup);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
        const c = window.__ws.active.chart;
        return { panes: c.panes.list().map((p) => ({ id: p.id, members: p.indicators.map((i) => i.id) })), drawings: c.drawings.all().map((d) => ({ id: d.id, pane: d.paneId, z: d.zIndex })), order: c.renderer.get('seriesOrder') };
    });
    assert(JSON.stringify(after) === JSON.stringify(before), 'organizing across panes does not change the renderer or z-order', { before, after });
    const visible = await page.evaluate(() => [...document.querySelectorAll('.vela-ot-row[data-id]')].map((e) => ({ id: e.dataset.id, kind: e.dataset.rowKind })));
    assert(visible.filter((x) => x.id === setup.rsi).length === 1 && visible.filter((x) => x.id === setup.draws[1]).length === 1, 'each logical member appears once', visible);

    async function menu(id) {
        const row = page.locator(`.vela-ot-row[data-row-kind="group"][data-id="${id}"]`);
        await row.click({ button: 'right' });
        await page.waitForTimeout(180);
        return page.locator('.vela-menu-item:visible').allTextContents();
    }
    async function submenu(label) {
        await page.locator('.vela-menu-item:visible').filter({ hasText: new RegExp(`^${label}$`) }).first().hover();
        await page.waitForTimeout(200);
    }
    async function choose(label) {
        await page.locator('.vela-menu-item:visible').filter({ hasText: new RegExp(`^${label}$`) }).first().click();
        await page.waitForTimeout(220);
    }
    const drawingMenu = (await menu('gd')).map((s) => s.trim());
    assert(drawingMenu.includes('Drawing templates') && drawingMenu.includes('Sync objects') && drawingMenu.includes('Lock all') && !drawingMenu.includes('Indicator templates') && !drawingMenu.includes('Indicator live sync'), 'drawing-only menu contains drawing actions only', drawingMenu);
    await page.keyboard.press('Escape');
    const indicatorMenu = (await menu('gi')).map((s) => s.trim());
    assert(indicatorMenu.includes('Indicator templates') && indicatorMenu.includes('Indicator live sync') && !indicatorMenu.includes('Drawing templates') && !indicatorMenu.some((s) => s.includes('Lock')), 'indicator-only menu contains indicator actions only', indicatorMenu);
    await submenu('Indicator templates');
    await choose('Save as new template…');
    const form = page.getByRole('dialog', { name: 'Save indicator template' });
    await form.waitFor({ state: 'visible' });
    const mini = await form.evaluate((e) => ({ radius: getComputedStyle(e).borderRadius, focus: document.activeElement?.getAttribute('aria-label'), heading: !!e.querySelector('h1,h2,h3,.vela-panel-header,.vela-dialog-header'), grip: !!e.querySelector('[data-panel-grip],.vela-panel-grip'), tree: !document.querySelector('.vela-panel.vela-ot')?.hidden }));
    assert(mini.radius === '0px' && mini.focus === 'Indicator template name' && !mini.heading && !mini.grip && mini.tree, 'indicator save form is square, focused, minimal and keeps the tree open', mini);
    await form.getByLabel('Indicator template name').fill('Chosen indicators');
    await form.getByRole('button', { name: 'Save' }).click();
    await form.waitFor({ state: 'hidden' });
    const mixedMenu = (await menu('gm')).map((s) => s.trim());
    assert(mixedMenu.includes('Drawing templates') && mixedMenu.includes('Indicator templates') && mixedMenu.includes('Sync objects') && mixedMenu.includes('Indicator live sync') && mixedMenu.includes('Lock drawings'), 'mixed menu has separate actions for each member type', mixedMenu);
    await submenu('Indicator templates');
    await submenu('Add to existing template');
    const append = page.locator('.vela-menu-item:visible').filter({ hasText: /^Chosen indicators \(1\)$/ }).first();
    await append.click();
    await page.waitForTimeout(250);
    const template = await page.evaluate(() => window.__ws.getState().templates['Chosen indicators']);
    assert(template?.indicators?.length === 2, 'mixed-group indicator is appended to the existing template', template);

    await menu('gm');
    await choose('Hide all');
    const hidden = await page.evaluate(({ sma, draws }) => {
        const c = window.__ws.active.chart;
        return { indicator: c.indicators().find((h) => h.id === sma)?.visible, drawing: c.drawings.all().find((d) => d.id === draws[1])?.visible };
    }, setup);
    assert(hidden.indicator === false && hidden.drawing === false, 'mixed hide applies to both types without moving them', hidden);
    await menu('gm');
    await choose('Show all');

    await menu('gd');
    await submenu('Drawing templates');
    await choose('Save as template…');
    const drawingForm = page.getByRole('dialog', { name: 'Save drawing template' });
    await drawingForm.waitFor({ state: 'visible' });
    const drawingMini = await drawingForm.evaluate((e) => ({ radius: getComputedStyle(e).borderRadius, heading: !!e.querySelector('h1,h2,h3,.vela-dialog-header'), parent: !document.querySelector('.vela-panel.vela-ot')?.hidden }));
    assert(drawingMini.radius === '0px' && !drawingMini.heading && drawingMini.parent, 'drawing save form is compact and keeps Object Tree open', drawingMini);
    await drawingForm.getByLabel('Drawing template name').fill('Drawing one');
    await drawingForm.getByRole('button', { name: 'Save' }).click();
    await drawingForm.waitFor({ state: 'hidden' });

    // The actual Object Tree menu is used to opt into a specific live peer.
    await menu('gi');
    await submenu('Indicator live sync');
    await submenu('Live sync to specific charts');
    const targetLabels = (await page.locator('.vela-menu-item:visible').allTextContents()).map((s) => s.trim());
    const target = page.locator('.vela-menu-item:visible').filter({ hasText: /^Chart 2/ }).first();
    if (await target.count() === 0) throw new Error(`Chart 2 missing from target menu: ${targetLabels}`);
    await target.click();
    await page.waitForTimeout(350);
    const sync = await page.evaluate(({ rsi }) => {
        const ws = window.__ws, a = ws.cell('a').chart, b = ws.cell('b').chart;
        const source = a.indicators().find((h) => h.id === rsi), peer = b.indicators().find((h) => h.nativeType === 'rsi');
        source.setInputs({ length: 8, color: '#abcdef' });
        const forward = peer?.inputValues();
        peer?.setInput('length', 19);
        return { forward, back: source.inputValues(), status: ws.indicatorSyncStatus(rsi), other: ws.cell('c').chart.indicators().filter((h) => h.nativeType === 'rsi').length };
    }, setup);
    assert(sync.forward?.length === 8 && sync.forward?.color === '#abcdef' && sync.back.length === 19 && sync.status.mode === 'charts' && sync.other === 0, 'selected-chart settings and style propagate in both directions only to selected peers', sync);

    const removedManager = await page.locator('[aria-label="Manage layout drawings"], [title="Manage layout drawings"]').count();
    assert(removedManager === 0, 'Manage layout drawings is absent');
    const manage = page.locator('button[aria-label="Manage objects"]');
    if (await manage.count()) {
        await manage.click();
        const surface = page.getByRole('dialog', { name: 'Manage drawing sync' });
        await surface.waitFor({ state: 'visible' });
        const m = await surface.evaluate((e) => ({ radius: getComputedStyle(e).borderRadius, parent: !document.querySelector('.vela-panel.vela-ot')?.hidden, heading: !!e.querySelector('.vela-dialog-header,.vela-panel-header') }));
        assert(m.radius === '0px' && m.parent && !m.heading, 'Manage objects is a square child popover', m);
        await page.keyboard.press('Escape');
    }
    facts.groups = { drawingMenu, indicatorMenu, mixedMenu, mini, drawingMini, sync, template };
    assert(errors.length === 0, 'browser has no page errors', errors);
    report('indicator-groups', facts);
} finally { await browser.close(); }
