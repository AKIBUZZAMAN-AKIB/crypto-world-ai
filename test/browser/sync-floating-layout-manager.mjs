// Real user doors and actions for the compact floating Manage layouts menu.
// No screenshot fixtures, preview harnesses or network data are required.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { sizes: [] };

async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1100);
    return { context, page };
}
async function openMenu(page, portrait) {
    if (portrait) {
        if (!await page.locator('.vela-more-panel').isVisible()) await page.locator('.vela-mb-more').click();
        await page.locator('.vela-more-panel .vela-md-row', { hasText: 'Manage layouts' }).click();
    } else {
        await page.locator('.vela-widget-layoutname').click();
    }
    await page.locator('.vela-lmp:visible').waitFor();
    await page.waitForTimeout(330);
}
const action = (page, name) => page.locator(`.vela-lmp [data-action="${name}"]`);
const pageName = (page) => page.locator('.vela-lmp').getAttribute('data-page');
const names = (page) => page.evaluate(() => window.__ws.savedLayoutList().map((entry) => entry.name));

try {
    // Bounds, anchored placement and keyboard dismissal on narrow phones, touch
    // landscape and desktop. The user's real opening controls are used throughout.
    for (const spec of [
        { width: 280, height: 350, touch: true, portrait: true },
        { width: 320, height: 640, touch: true, portrait: true },
        { width: 390, height: 780, touch: true, portrait: true },
        { width: 780, height: 390, touch: true, portrait: false },
        { width: 1440, height: 900, touch: false, portrait: false },
    ]) {
        const { context, page } = await boot({ width: spec.width, height: spec.height }, spec.touch);
        await openMenu(page, spec.portrait);
        const info = await page.evaluate((portrait) => {
            const el = document.querySelector('.vela-lmp');
            const trigger = portrait ? [...document.querySelectorAll('.vela-more-panel .vela-md-row')].find((r) => r.textContent.includes('Manage layouts')) : document.querySelector('.vela-widget-layoutname');
            const r = el.getBoundingClientRect(), a = trigger.getBoundingClientRect();
            return {
                rect: r.toJSON(), anchor: a.toJSON(), role: el.getAttribute('role'),
                popover: !!el.closest('.vela-popover'), dialog: !!document.querySelector('.vela-lmp-dialog'),
                modal: !!el.closest('[aria-modal="true"]'), overflow: document.documentElement.scrollWidth - innerWidth,
                active: document.activeElement?.getAttribute('data-action'),
                expanded: trigger.getAttribute('aria-expanded'), controls: trigger.getAttribute('aria-controls'),
                grip: !!el.querySelector('.vela-size-grip, .vela-panel-grip'),
            };
        }, spec.portrait);
        assert(info.rect.left >= -1 && info.rect.right <= spec.width + 1 && info.rect.top >= -1 && info.rect.bottom <= spec.height + 1 && info.overflow <= 0, 'floating menu fits the visible viewport', { spec, info });
        assert(info.rect.width <= 225 && info.rect.height <= 320 && info.popover && info.role === 'menu' && !info.dialog && !info.modal && !info.grip, 'management is a small non-modal menu rather than a resizable panel', { spec, info });
        assert(spec.portrait ? info.rect.bottom <= info.anchor.top + 2 : info.rect.top >= info.anchor.bottom - 2, 'menu stays next to its visible opener', { spec, info });
        assert(info.active === 'save', 'opening the menu places focus on its first item', { spec, active: info.active });
        assert(info.expanded === 'true' && info.controls, 'the actual opener reports the expanded menu', info);
        await page.keyboard.press('ArrowDown');
        assert(await page.evaluate(() => document.activeElement?.getAttribute('data-action')) === 'autosave', 'arrow key moves between actions');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        const closed = await page.evaluate((portrait) => ({
            menu: !!document.querySelector('.vela-lmp'),
            focused: document.activeElement?.className ?? '',
            expanded: (portrait ? [...document.querySelectorAll('.vela-more-panel .vela-md-row')].find((r) => r.textContent.includes('Manage layouts')) : document.querySelector('.vela-widget-layoutname'))?.getAttribute('aria-expanded'),
        }), spec.portrait);
        assert(!closed.menu && closed.focused.includes(spec.portrait ? 'vela-md-row' : 'vela-widget-layoutname'), 'Escape dismisses and returns focus', { spec, closed });
        assert(closed.expanded === 'false', 'opener expanded state clears on close', closed);
        facts.sizes.push({ viewport: [spec.width, spec.height], menu: [info.rect.x, info.rect.y, info.rect.width, info.rect.height] });
        await context.close();
    }

    // If a scrolling topbar carries its opener behind the pinned pair, the menu
    // cannot remain detached at the edge of the screen.
    {
        const { context, page } = await boot({ width: 310, height: 240 }, true);
        await openMenu(page, false);
        const scrolling = await page.evaluate(() => {
            const bar = document.querySelector('.vela-widget-topbar');
            const before = bar.scrollLeft;
            bar.scrollLeft = bar.scrollWidth;
            const anchor = document.querySelector('.vela-widget-layoutname').getBoundingClientRect();
            const pair = bar.querySelector('.vela-widget-symbol').getBoundingClientRect();
            return { before, after: bar.scrollLeft, max: bar.scrollWidth - bar.clientWidth, anchorRight: anchor.right, pairRight: pair.right };
        });
        await page.waitForTimeout(180);
        assert(scrolling.max > 0 && scrolling.anchorRight <= scrolling.pairRight && await page.locator('.vela-lmp').count() === 0,
            'menu closes when its scrolled opener is no longer reachable', scrolling);
        facts.scrolledAnchor = scrolling;
        await context.close();
    }
    // A partly visible opener can still be tapped, so it must not be treated as hidden.
    {
        const { context, page } = await boot({ width: 350, height: 240 }, true);
        await openMenu(page, false);
        const anchor = await page.evaluate(() => {
            const bar = document.querySelector('.vela-widget-topbar'); bar.scrollLeft = bar.scrollWidth;
            const r = document.querySelector('.vela-widget-layoutname').getBoundingClientRect();
            const pair = bar.querySelector('.vela-widget-symbol').getBoundingClientRect();
            const hit = document.elementFromPoint(r.right - 3, (r.top + r.bottom) / 2);
            return { right: r.right, pairRight: pair.right, reachable: !!hit?.closest('.vela-widget-layoutname') };
        });
        await page.waitForTimeout(180);
        assert(anchor.right > anchor.pairRight && anchor.reachable && await page.locator('.vela-lmp').count() === 1,
            'menu stays open while part of its scrolled opener remains reachable', anchor);
        facts.partlyVisibleAnchor = anchor;
        await context.close();
    }

    // A workspace embedded inside a larger browser window is also a hard boundary.
    {
        const { context, page } = await boot({ width: 1000, height: 750 }, true);
        await page.evaluate(() => {
            Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' });
        });
        await page.waitForTimeout(400);
        await openMenu(page, true);
        const box = await page.locator('.vela-lmp').boundingBox();
        assert(box.x >= 100 && box.x + box.width <= 380 && box.y >= 110 && box.y + box.height <= 460, 'menu stays inside an offset, short embedded workspace', box);
        facts.embedded = box;
        await context.close();
    }

    // Full phone workflow through More, including real workspace state and file APIs.
    {
        const { context, page } = await boot({ width: 320, height: 640 }, true);
        await openMenu(page, true);
        const menu = page.locator('.vela-lmp');
        await action(page, 'autosave').click();
        assert(await page.evaluate(() => window.__ws.autosaveEnabled()) && await action(page, 'autosave').getAttribute('aria-checked') === 'true', 'autosave updates actual state and the menu check');
        await action(page, 'copy').click();
        const made = await page.evaluate(() => window.__ws.activeLayoutName());
        assert(typeof made === 'string' && made.includes('copy'), 'Make a copy creates an active snapshot', made);
        await action(page, 'rename').click();
        await menu.locator('[aria-label="Layout name"]').fill('Phone layout');
        await action(page, 'submit').click();
        assert(await page.evaluate(() => window.__ws.activeLayoutName()) === 'Phone layout', 'Rename updates the real workspace');
        await action(page, 'sharing').click();
        await action(page, 'sharing-toggle').click();
        assert(await page.evaluate(() => window.__ws.layoutSharingEnabled()), 'sharing preference updates real state');
        await action(page, 'share-copy').click();
        await page.waitForFunction(() => document.querySelector('.vela-lmp [role="status"]')?.textContent?.includes('Link copied'), null, { timeout: 10000 });
        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        assert(/^https?:/.test(clipboard) && /#(?:s0|s1|l1)=/.test(clipboard), 'Copy link puts a real URL on the clipboard', clipboard.slice(0, 80));
        await action(page, 'share-view').click();
        await page.waitForFunction(() => (document.querySelector('.vela-lmp [aria-label="Workspace sharing link"]')?.value ?? '').length > 0, null, { timeout: 10000 });
        const shared = await menu.locator('[aria-label="Workspace sharing link"]').inputValue();
        assert(shared.startsWith('http') && shared.length > 100, 'view link is populated and selectable', shared.slice(0, 50));
        await action(page, 'back').click();
        await action(page, 'open-link').click();
        await menu.locator('[aria-label="Shared link to open"]').fill('not-a-workspace-link');
        await action(page, 'submit').click();
        await page.waitForTimeout(180);
        assert(/could not be opened/i.test(await menu.locator('[role="status"]').innerText()), 'bad link shows an error');
        await action(page, 'back').click();
        await action(page, 'back').click();
        await action(page, 'files').click();
        await action(page, 'save-as').click();
        await menu.locator('[aria-label="Layout name"]').fill('Phone layout');
        await action(page, 'submit').click();
        assert(/already used/i.test(await menu.locator('[role="status"]').innerText()), 'Save as refuses a collision');
        await menu.locator('[aria-label="Layout name"]').fill('Alpha');
        await action(page, 'submit').click();
        assert(await page.evaluate(() => window.__ws.activeLayoutName()) === 'Alpha', 'Save as creates and activates a new layout', await names(page));
        await action(page, 'saved').click();
        await menu.locator('[data-saved-name="Phone layout"]').click();
        await action(page, 'saved-rename').click();
        await menu.locator('[aria-label="Layout name"]').fill('Alpha');
        await action(page, 'submit').click();
        assert(/already used/i.test(await menu.locator('[role="status"]').innerText()), 'saved-layout rename refuses a collision');
        await menu.locator('[aria-label="Layout name"]').fill('Beta');
        await action(page, 'submit').click();
        assert((await names(page)).includes('Beta'), 'saved layout renames without overwriting');
        await action(page, 'saved-copy').click();
        await menu.locator('[aria-label="Name the copy"]').fill('Gamma');
        await action(page, 'submit').click();
        assert((await names(page)).includes('Gamma') && await page.evaluate(() => window.__ws.activeLayoutName()) === 'Alpha', 'saved copy uses the requested name without opening it', await names(page));
        await menu.locator('[data-saved-name="Beta"]').click();
        await action(page, 'saved-share').click();
        await page.waitForFunction(() => document.querySelector('.vela-lmp [role="status"]')?.textContent?.includes('Link copied'), null, { timeout: 10000 });
        const savedLink = await page.evaluate(() => navigator.clipboard.readText());
        assert(savedLink.includes('#l1='), 'a saved layout shares as a layout-specific link', savedLink.slice(0, 50));
        const [download] = await Promise.all([page.waitForEvent('download'), action(page, 'saved-export').click()]);
        assert(download.suggestedFilename().endsWith('.vela-layout.json'), 'saved layout exports JSON', download.suggestedFilename());
        const savedJson = await page.evaluate(() => window.__ws.exportLayout('Beta'));
        await action(page, 'saved-delete').click();
        assert((await names(page)).includes('Beta'), 'first Delete opens confirmation without deleting');
        await action(page, 'cancel-delete').click();
        assert((await names(page)).includes('Beta'), 'Cancel preserves the saved layout');
        await action(page, 'saved-delete').click();
        await action(page, 'confirm-delete').click();
        assert(!(await names(page)).includes('Beta'), 'confirming Delete removes only that layout', await names(page));
        await action(page, 'back').click();
        await action(page, 'files').click();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), action(page, 'import-layout').click()]);
        await chooser.setFiles({ name: 'Beta.vela-layout.json', mimeType: 'application/json', buffer: Buffer.from(savedJson) });
        await page.waitForFunction(() => window.__ws.savedLayoutList().some((entry) => entry.name === 'Beta'), null, { timeout: 10000 });
        const [csv] = await Promise.all([page.waitForEvent('download'), action(page, 'export-data').click()]);
        assert(csv.suggestedFilename().endsWith('.csv'), 'chart data exports as CSV', csv.suggestedFilename());
        await action(page, 'back').click();
        await page.evaluate(() => { for (let i = 0; i < 18; i++) window.__ws.saveLayout(`Filter ${i}`); });
        await action(page, 'saved').click();
        const beforeScroll = await menu.boundingBox();
        const scroll = await menu.evaluate((el) => { el.scrollTop = 200; return { top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }; });
        await page.waitForTimeout(120);
        const afterScroll = await menu.boundingBox();
        assert(scroll.total > scroll.height && scroll.top > 0 && Math.abs(beforeScroll.y - afterScroll.y) < 1, 'a long saved list scrolls inside its anchored menu', { scroll, beforeScroll, afterScroll });
        const filter = menu.locator('[aria-label="Filter saved layouts"]');
        await filter.fill('Filter 8');
        const filterResult = await menu.locator('[data-saved-name]').evaluateAll((els) => els.map((e) => ({ name: e.dataset.savedName, hidden: e.hidden, display: getComputedStyle(e).display })));
        assert(filterResult.filter((e) => e.display !== 'none').length === 1 && filterResult.find((e) => e.name === 'Filter 8')?.display !== 'none', 'search hides nonmatching saved rows visually and semantically', filterResult);
        await filter.fill('Beta');
        await menu.locator('[data-saved-name="Beta"]').click();
        await action(page, 'saved-open').click();
        assert(await page.evaluate(() => window.__ws.activeLayoutName()) === 'Beta' && await page.locator('.vela-lmp').count() === 0, 'Open loads the selected saved layout and closes the menu');
        await openMenu(page, true);
        await action(page, 'sharing').click();
        await action(page, 'open-link').click();
        await menu.locator('[aria-label="Shared link to open"]').fill(savedLink);
        await action(page, 'submit').click();
        await page.waitForFunction(() => window.__ws.activeLayoutName()?.includes('(shared)'), null, { timeout: 10000 });
        assert(await page.locator('.vela-lmp').count() === 0, 'a valid saved-layout link opens a new shared layout');
        facts.actions = { copy: made, sharingLength: shared.length, json: download.suggestedFilename(), csv: csv.suggestedFilename(), filterVisible: filterResult.filter((e) => e.display !== 'none').map((e) => e.name), openedShare: await page.evaluate(() => window.__ws.activeLayoutName()) };
        await context.close();
    }

    // Menu dismisses on outside click; a second tap on More opens the drawer rather
    // than leaving two surfaces; rotation removes an opener that is no longer visible.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await openMenu(page, true);
        await page.mouse.click(20, 180);
        await page.waitForTimeout(150);
        assert(await page.locator('.vela-lmp').count() === 0, 'outside click dismisses the menu');
        await openMenu(page, true);
        await page.locator('.vela-mb-more').click();
        await page.waitForTimeout(300);
        assert(await page.locator('.vela-lmp').count() === 0 && await page.locator('.vela-more-panel:visible').count() === 0, 'the More toggle closes both the parent and its child menu');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        await openMenu(page, true);
        await action(page, 'rename').click();
        await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 380 }); window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForTimeout(200);
        const keyboard = await page.locator('.vela-lmp').boundingBox();
        const field = await page.locator('.vela-lmp input').boundingBox();
        assert(keyboard.y >= 0 && keyboard.y + keyboard.height <= 381 && field.y + field.height <= 381, 'simulated keyboard viewport keeps the menu and text field reachable', { keyboard, field });
        await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForTimeout(500);
        assert(await page.locator('.vela-lmp').count() === 0, 'rotation dismisses a menu whose More anchor disappeared');
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(450);
        const drawingSeed = await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const bar = chart.lastBar;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: bar.time, price: bar.close }] });
            return { saved: window.__ws.saveDrawingSetTemplate('Breakout', [drawing.id]), count: chart.drawings.all().length };
        });
        await openMenu(page, true);
        await action(page, 'files').click();
        await action(page, 'drawing-templates').click();
        await page.waitForSelector('.vela-md-drawing-library', { timeout: 5000 });
        const library = await page.locator('.vela-more-panel:visible').innerText();
        assert(await page.locator('.vela-lmp').count() === 0 && /drawing templates/i.test(library) && !/manage layouts/i.test(library), 'Drawing templates opens its own library after closing the menu', library);
        await page.locator('button[aria-label="Insert drawing template Breakout"]').click();
        const drawingCount = await page.evaluate(() => window.__ws.active.chart.drawings.all().length);
        assert(drawingSeed.saved && drawingCount === drawingSeed.count + 1, 'the drawing library still inserts a real saved drawing set', { drawingSeed, drawingCount });
        facts.dismissal = { keyboard, field, drawingLibrary: true, drawingCount };
        await context.close();
    }
    assert(errors.length === 0, 'no page errors', errors.slice(0, 5));
    report('floating-layout-manager', { ...facts, errors });
} finally {
    await browser.close();
}
