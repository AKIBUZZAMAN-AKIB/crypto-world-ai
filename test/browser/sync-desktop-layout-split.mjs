// R86 T9 — desktop Layout setup and Manage layouts are two separate surfaces.
// The grid picker keeps grid/sync/tab-link controls; save, autosave, files,
// templates and saved layouts live in the layout-name management popover.
import { open, assert, report } from './helpers.mjs';

const { page, errors, browser } = await open({ viewport: { width: 1440, height: 900 }, settle: 1400 });

await page.locator('button[aria-label^="Layout —"]').click();
await page.waitForSelector('.vela-lp[data-setup-only]', { timeout: 5000 });
const setup = await page.evaluate(() => {
    const panel = document.querySelector('.vela-lp');
    return {
        label: panel?.getAttribute('aria-label'),
        grid: !!panel?.querySelector('.vela-lp-grid'),
        syncRows: panel?.querySelectorAll('.vela-lp-sync-row').length ?? 0,
        autosave: !!panel?.querySelector('.vela-lp-auto'),
        save: !!panel?.querySelector('.vela-lp-save'),
        csv: !!panel?.querySelector('.vela-lp-csv'),
        templates: !!panel?.querySelector('.vela-lp-grouphead'),
        savedRows: panel?.querySelectorAll('.vela-lp-saved').length ?? 0,
        door: !!panel?.querySelector('.vela-lp-managerdoor'),
        rect: panel?.getBoundingClientRect().toJSON(),
    };
});
assert(setup.label === 'Layout setup', 'the grid panel is labelled Layout setup', setup.label);
assert(setup.grid && setup.syncRows > 0, 'grid and sync controls remain in Layout setup', setup);
assert(!setup.autosave && !setup.save && !setup.csv && !setup.templates && setup.savedRows === 0, 'management controls are not mixed into Layout setup', setup);
assert(setup.door, 'Layout setup has one Manage layouts door', setup);
assert(setup.rect && setup.rect.width < 700 && setup.rect.height < 600, 'setup panel is compact, not fullscreen', setup.rect);

await page.locator('.vela-lp-managerdoor').click();
await page.waitForSelector('.vela-lm', { timeout: 5000 });
await page.waitForTimeout(450); // let the setup panel's exit animation finish
const manager = await page.evaluate(() => {
    const panel = document.querySelector('.vela-lm');
    const setupPanel = document.querySelector('.vela-lp');
    return {
        rows: [...(panel?.querySelectorAll('.vela-lm-row') ?? [])].map((r) => r.textContent?.trim() ?? ''),
        autosave: !!panel?.querySelector('.vela-lm-switch'),
        openLayout: [...(panel?.querySelectorAll('.vela-lm-sect') ?? [])].some((s) => s.textContent?.includes('Open layout')),
        setupVisible: !!setupPanel && setupPanel.offsetParent !== null,
        rect: panel?.getBoundingClientRect().toJSON(),
    };
});
assert(manager.autosave, 'autosave is in the separate management panel', manager);
assert(manager.rows.some((r) => r.includes('Export chart data')), 'export chart data moved to management', manager.rows);
assert(manager.rows.some((r) => r.includes('Import layout file')), 'layout import moved to management', manager.rows);
assert(manager.openLayout, 'open-layout list remains in management', manager);
assert(manager.rect && manager.rect.width <= 360 && manager.rect.height <= 620, 'manager is a compact separate panel', manager.rect);
assert(!manager.setupVisible, 'grid setup closes when management opens', manager);
assert(errors.length === 0, 'no page errors', errors.slice(0, 3));

await browser.close();
report('desktop-layout-split', { setup, manager });
