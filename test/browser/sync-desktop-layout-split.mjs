// Layout Setup is a docked, tabbed pane; saved workspaces remain in their separate
// compact floating manager. Exercise both in the real workspace.
import { open, assert, report } from './helpers.mjs';

const { page, errors, browser } = await open({ viewport: { width: 1440, height: 900 }, settle: 1400 });
try {
    await page.locator('button[aria-label^="Layout —"]').click();
    const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
    const setup = await panel.evaluate(el => ({
        label: el.getAttribute('aria-label'), standard: el.dataset.standardPane,
        grid: !!el.querySelector('.vela-lp-grid'),
        syncRows: el.querySelectorAll('.vela-ls-syncrows [role="switch"]').length,
        tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()),
        managementControls: !!el.querySelector('.vela-lp-auto,.vela-lp-save,.vela-lp-csv,.vela-lp-grouphead,.vela-lp-saved'),
        door: !!el.querySelector('.vela-ls-manager'), rect: el.getBoundingClientRect().toJSON(),
        host: el.parentElement.getBoundingClientRect().toJSON(),
    }));
    assert(setup.label === 'Layout setup' && setup.standard === '1', 'setup uses the standard titled pane', setup);
    assert(setup.grid && setup.syncRows === 7 && setup.tabs.join('|') === 'Layout|Chart syncing', 'grid and seven sync controls remain in two tabs', setup);
    assert(!setup.managementControls && setup.door, 'management controls remain separate, reachable through one door', setup);
    assert(setup.rect.width <= 700 && Math.abs(setup.rect.height - setup.host.height) < 2 && setup.rect.right <= 1441,
        'setup is a docked column rather than a fullscreen menu', setup);

    const door = panel.locator('.vela-ls-manager'); await door.scrollIntoViewIfNeeded(); await door.click();
    const menu = page.locator('.vela-lmp'); await menu.waitFor({ state: 'visible' }); await page.waitForTimeout(250);
    const manager = await menu.evaluate(el => ({
        rows: [...el.querySelectorAll('.vela-lmp-item')].map(r => r.textContent?.trim() ?? ''),
        autosave: !!el.querySelector('[data-action="autosave"]'), saved: !!el.querySelector('[data-action="saved"]'),
        popover: !!el.closest('.vela-popover'), dialog: !!document.querySelector('.vela-lmp-dialog'), rect: el.getBoundingClientRect().toJSON(),
    }));
    assert(manager.autosave && manager.saved, 'autosave and saved layouts stay in management', manager);
    assert(manager.rect.width <= 225 && manager.rect.height < 340 && manager.popover && !manager.dialog, 'manager is a compact floating menu', manager);
    assert(await panel.isVisible(), 'opening management keeps the setup pane open');
    await menu.locator('[data-action="files"]').click();
    const more = await menu.innerText();
    assert(more.includes('Export chart data') && more.includes('Import layout file'), 'file controls remain in More actions', more);
    await page.keyboard.press('Escape');
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    assert(await door.evaluate(el => el === document.activeElement), 'Escape returns focus to the manager door');
    assert(errors.length === 0, 'no page errors', errors.slice(0, 3));
    report('desktop-layout-split', { setup, manager });
} finally { await browser.close(); }
