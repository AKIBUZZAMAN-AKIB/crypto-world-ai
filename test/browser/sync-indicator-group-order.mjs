// Real drag and z-order regression for organizational cross-pane groups.
import { open, assert, report, OFFLINE } from './helpers.mjs';
const { browser, page, errors } = await open({ base: OFFLINE, settle: 900 });
try {
    const data = await page.evaluate(() => {
        const ws = window.__ws, c = ws.active.chart, h = c.addNativeIndicator('rsi');
        const r = c.getVisibleRange(), p = c.lastBar.close;
        const anchors = [{ time: r.from, price: p * .99 }, { time: r.to, price: p * 1.01 }];
        for (let i = 0; i < 3; i++) c.drawings.add('box', { anchors });
        const drawings = c.drawings.all().map((d) => d.id);
        // Start with a drawing-only folder; the indicator is filed via a real drag.
        ws.objectTree.setGroupsFor(c, [{ id: 'folder', name: 'Cross-pane folder', ids: [drawings[0], drawings[2]] }]);
        return { indicator: h.id, drawings };
    });
    await page.waitForTimeout(1100);
    await page.locator('button[aria-label="Object tree"]').click();
    await page.waitForTimeout(300);
    const snapshot = () => page.evaluate(() => {
        const c = window.__ws.active.chart;
        return { panes: c.panes.list().map((p) => ({ id: p.id, indicators: p.indicators.map((i) => i.id) })), drawings: c.drawings.all().map((d) => ({ id: d.id, pane: d.paneId, z: d.zIndex })), order: c.renderer.get('seriesOrder') };
    });
    const before = await snapshot();
    const from = await page.locator(`.vela-ot-row[data-id="${data.indicator}"]`).boundingBox();
    const to = await page.locator('.vela-ot-row[data-id="folder"]').boundingBox();
    await page.mouse.move(from.x + 45, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 65, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const grouped = await snapshot();
    const group = await page.evaluate(() => window.__ws.objectTree.groupsFor(window.__ws.active.chart)[0]);
    assert(group.indicators.includes(data.indicator) && JSON.stringify(grouped) === JSON.stringify(before), 'drag files an indicator into a folder without moving or restacking members', { group, before, grouped });
    assert(await page.locator(`.vela-ot-row[data-id="${data.indicator}"]`).count() === 1, 'the grouped indicator is displayed only once');

    // A loose drawing is between two grouped drawings. Restacking the loose one must
    // not implicitly collapse or omit the invisible logical-folder members.
    const loose = page.locator(`.vela-ot-row[data-id="${data.drawings[1]}"]`);
    await loose.click({ button: 'right' });
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Visual order$/ }).hover();
    await page.waitForTimeout(200);
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Bring to front$/ }).click();
    await page.waitForTimeout(300);
    const ordered = await snapshot();
    const z = Object.fromEntries(ordered.drawings.map((d) => [d.id, d.z]));
    assert(z[data.drawings[1]] > z[data.drawings[2]] && z[data.drawings[2]] > z[data.drawings[0]], 'restacking a loose drawing preserves all other logical members and their relative order', { z, ordered });
    assert(JSON.stringify(ordered.panes) === JSON.stringify(before.panes), 'visual order never changes physical panes', ordered.panes);

    // Nest a second group using the real pointer and verify the workspace's
    // document-history undo/redo restores membership without restacking anything.
    await loose.click({ button: 'right' });
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^New group/ }).click();
    await page.waitForTimeout(600);
    const childId = await page.evaluate((drawing) => window.__ws.objectTree.groupsFor(window.__ws.active.chart).find((g) => g.ids.includes(drawing)).id, data.drawings[1]);
    const prior = await snapshot();
    const childBox = await page.locator(`.vela-ot-row[data-id="${childId}"]`).boundingBox();
    const parentBox = await page.locator('.vela-ot-row[data-id="folder"]').boundingBox();
    await page.mouse.move(childBox.x + 50, childBox.y + childBox.height / 2); await page.mouse.down();
    await page.mouse.move(parentBox.x + 65, parentBox.y + parentBox.height / 2, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(600);
    const nested = await page.evaluate((child) => window.__ws.objectTree.groupsFor(window.__ws.active.chart).find((g) => g.id === child), childId);
    assert(nested?.parent === 'folder' && JSON.stringify(await snapshot()) === JSON.stringify(prior), 'nested drag preserves the physical stack and panes', nested);
    await page.evaluate(() => window.__ws.undo()); await page.waitForTimeout(600);
    const undone = await page.evaluate((child) => window.__ws.objectTree.groupsFor(window.__ws.active.chart).find((g) => g.id === child), childId);
    assert(undone && !undone.parent, 'undo restores the prior group hierarchy', undone);
    await page.evaluate(() => window.__ws.redo()); await page.waitForTimeout(600);
    const redone = await page.evaluate((child) => window.__ws.objectTree.groupsFor(window.__ws.active.chart).find((g) => g.id === child), childId);
    assert(redone?.parent === 'folder', 'redo restores the nested group hierarchy', redone);
    assert(errors.length === 0, 'no browser errors', errors);
    report('indicator-group-order', { before, grouped, ordered, group, nested, undone, redone });
} finally { await browser.close(); }
