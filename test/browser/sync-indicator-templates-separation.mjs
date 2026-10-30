// R86 T11 — indicator templates are a separate panel with four categories; Manage
// layouts and Layout setup no longer carry template controls.
import { open, assert, report } from './helpers.mjs';

const desktop = await open({ viewport: { width: 1280, height: 820 }, settle: 1300 });
const d = desktop.page;
await d.locator('.vela-widget-templates').click();
await d.waitForSelector('.vela-tm', { timeout: 5000 });
const panel = await d.evaluate(() => ({
    title: document.querySelector('.vela-templates-panel .vela-panel-title')?.textContent ?? '',
    tabs: [...document.querySelectorAll('.vela-tm-tab')].map((t) => t.textContent ?? ''),
    active: document.querySelector('.vela-tm-tab[data-active]')?.dataset.tab ?? null,
}));
assert(panel.title === 'Indicator templates', 'the separate desktop panel is named correctly', panel.title);
assert(JSON.stringify(panel.tabs) === JSON.stringify(['Favorites', 'My templates', 'Technical', 'Financial']), 'all four categories exist', panel.tabs);
await d.keyboard.press('Escape');
await d.locator('button[aria-label^="Layout —"]').click();
await d.waitForSelector('.vela-layout-setup:visible', { timeout: 5000 });
const setup = await d.evaluate(() => ({
    templates: document.querySelectorAll('.vela-lp-tpl, .vela-lp-grouphead').length,
    text: document.querySelector('.vela-layout-setup')?.textContent ?? '',
}));
assert(setup.templates === 0 && !/Indicator templates|Chart templates/i.test(setup.text), 'Layout setup has no template controls', setup);
assert(desktop.errors.length === 0, 'no desktop page errors', desktop.errors.slice(0, 3));
await desktop.browser.close();

const phone = await open({ viewport: { width: 390, height: 780 }, mobile: true, settle: 1400 });
const p = phone.page;
await p.locator('.vela-mb-more').click();
await p.waitForSelector('.vela-md-row', { timeout: 5000 });
const mainRows = await p.evaluate(() => [...document.querySelectorAll('.vela-md-row')].map((r) => r.textContent?.trim() ?? ''));
assert(mainRows.some((r) => r.startsWith('Manage layouts')), 'Manage layouts is still its own door', mainRows.slice(0, 5));
assert(mainRows.some((r) => r.startsWith('Indicator templates')), 'Indicator templates has its own More row', mainRows.slice(0, 6));

await p.locator('.vela-md-row', { hasText: 'Indicator templates' }).click();
await p.waitForSelector('.vela-templates-panel .vela-tm', { timeout: 5000 });
const categories = await p.evaluate(() => [...document.querySelectorAll('.vela-tm-tab')].map((t) => t.textContent ?? ''));
assert(JSON.stringify(categories) === JSON.stringify(['Favorites', 'My templates', 'Technical', 'Financial']), 'phone panel carries the same categories', categories);
await p.locator('.vela-templates-panel [role="tab"][aria-selected="true"]').focus();
await p.keyboard.press('Escape');
await p.waitForTimeout(250);

await p.locator('.vela-mb-more').click();
await p.waitForSelector('.vela-md-row', { timeout: 5000 });
await p.locator('.vela-md-row', { hasText: 'Manage layouts' }).click();
await p.waitForSelector('.vela-lmp', { timeout: 5000 });
const manager = await p.evaluate(() => ({
    text: document.querySelector('.vela-lmp')?.textContent ?? '',
    role: document.querySelector('.vela-lmp')?.getAttribute('role'),
    dialog: !!document.querySelector('.vela-lmp-dialog'),
    overflow: document.documentElement.scrollWidth - innerWidth,
}));
assert(manager.role === 'menu' && !manager.dialog, 'Manage layouts is a floating menu, not a dialog', manager);
assert(!/Indicator templates|Chart templates|My templates|Technical|Financial/i.test(manager.text), 'Manage layouts contains no indicator-template controls', manager.text.slice(0, 200));
assert(manager.overflow <= 0, 'the phone manager does not overflow sideways', manager.overflow);
assert(phone.errors.length === 0, 'no phone page errors', phone.errors.slice(0, 3));
await phone.browser.close();

report('indicator-templates-separation', { panel, setup, categories, manager });
