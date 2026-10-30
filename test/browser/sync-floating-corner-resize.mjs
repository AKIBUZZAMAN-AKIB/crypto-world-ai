// Real floating-button resize, accessibility, persistence and tiny-content checks.
// Uses the existing offline workspace; no screenshots or hand-built preview fixtures.
// SYNC_BROWSER=webkit runs the same mouse, keyboard, tap and rotation cases in WebKit.
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [], warnings = [];
let phase = 'boot';

async function boot(viewport = { width: 1280, height: 800 }, touch = false, editor = false, persist = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
        const text = `${phase}: ${String(error)}`;
        if (String(error).includes('ResizeObserver loop completed with undelivered notifications')) warnings.push(text);
        else errors.push(text);
    });
    const url = new URL(OFFLINE);
    if (editor) url.searchParams.set('preview', 'editor');
    if (persist) url.searchParams.set('persist', '1');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4 && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}
async function drag(page, target, dx, dy) {
    const box = await target.boundingBox();
    if (!box) throw new Error('Missing resize target');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(180);
}
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
const bottom = (r) => r.y + r.height;
function inside(r, outer, tolerance = 1.5) {
    return r.left >= outer.left - tolerance && r.top >= outer.top - tolerance &&
        r.right <= outer.right + tolerance && r.bottom <= outer.bottom + tolerance;
}
async function cardInfo(panel) {
    return panel.evaluate((el) => {
        const rect = (node) => node.getBoundingClientRect().toJSON();
        const header = el.querySelector('.vela-panel-header'), slot = el.querySelector('.vela-panel-header-slot');
        const body = el.querySelector('.vela-panel-body'), host = el.parentElement;
        return { panel: rect(el), header: rect(header), body: rect(body), host: rect(host),
            compact: [el.dataset.compactWidth, el.dataset.compactHeight],
            slot: { rect: rect(slot), client: slot.clientWidth, scroll: slot.scrollWidth },
            bodyScroll: { client: body.clientHeight, scroll: body.scrollHeight },
            buttons: [...header.querySelectorAll(':scope > button')].filter((b) => getComputedStyle(b).display !== 'none')
                .map((b) => ({ className: b.className, rect: rect(b) })) };
    });
}

try {
    {
        phase = 'desktop';
        const { context, page } = await boot();
        await page.locator('.vela-widget-panel-objects').click();
        const panel = page.locator('.vela-panel.vela-ot');
        await panel.locator('.vela-panel-dock-toggle').click();
        await page.waitForTimeout(350);
        const grip = panel.locator('.vela-panel-grip'), seam = panel.locator('.vela-panel-resizer');
        const resize = panel.locator('.vela-panel-corner-resize');
        assert(!await grip.isVisible() && !await seam.isVisible(), 'floating panels have no extra top or perimeter resize handles');
        assert(await resize.count() === 1, 'a floating resize button is present');
        const info = await resize.evaluate((el) => ({ previous: el.previousElementSibling?.className, rect: el.getBoundingClientRect().toJSON(),
            label: el.getAttribute('aria-label'), controls: el.getAttribute('aria-controls'), panelId: el.closest('.vela-panel').id,
            mask: getComputedStyle(el.firstElementChild).maskImage }));
        assert(info.previous === 'vela-panel-close' && info.rect.width >= 24 && info.rect.height >= 24 && info.label &&
            info.controls === info.panelId && info.mask !== 'none',
            'the accessible masked resize button immediately follows Close', info);
        await resize.hover();
        await page.locator('.vela-tooltip[data-state="open"]').waitFor({ state: 'visible', timeout: 3000 });
        assert((await page.locator('.vela-tooltip[data-state="open"]').innerText()).includes('resize'),
            'the resize button uses the shared themed tooltip');
        const before = await panel.boundingBox();
        await drag(page, resize, -140, 345);
        const small = await panel.boundingBox(), compact = await cardInfo(panel);
        assert(small.width <= 162 && small.height < 140 && near(small.x, before.x) && near(bottom(small), bottom(before)),
            'dragging the button changes both dimensions with the opposite corner fixed', { before, small });
        assert(compact.compact[0] === '1' && compact.compact[1] === '1' && inside(compact.panel, compact.host) &&
            compact.buttons.every((b) => b.rect.width >= 24 && b.rect.height >= 24 && inside(b.rect, compact.header)),
        'the tiny panel stays on screen with every header control fully reachable', compact);
        assert(await panel.locator('.vela-panel-header-slot .vela-ot-headerbtn').count() === 2 &&
            await panel.locator('.vela-panel-body').evaluate((el) => el.scrollHeight > el.clientHeight),
        'Object tree header actions remain available and its body scrolls');
        const saved = await page.evaluate(() => window.__ws.getState().panels);
        assert(saved.widths?.objects === 160 && saved.desktopHeights?.objects > 0 && saved.floatPositions?.objects,
            'one two-axis resize saves width, height and position', saved);
        await page.evaluate(() => window.__ws.undo()); await page.waitForTimeout(250);
        const undo = await panel.boundingBox();
        assert(near(undo.width, before.width) && near(undo.height, before.height) && near(undo.x, before.x) && near(undo.y, before.y),
            'one undo restores both dimensions and position', { before, undo });
        await page.evaluate(() => window.__ws.redo()); await page.waitForTimeout(250);
        const redo = await panel.boundingBox();
        assert(near(redo.width, small.width) && near(redo.height, small.height) && near(redo.x, small.x) && near(redo.y, small.y),
            'redo restores both dimensions and position', { small, redo });
        const back = await resize.boundingBox(), bx = back.x + back.width / 2, by = back.y + back.height / 2;
        await page.mouse.move(bx, by); await page.mouse.down();
        await page.mouse.move(bx + 65, by - 60, { steps: 5 }); await page.mouse.move(bx, by, { steps: 5 }); await page.mouse.up();
        await page.waitForTimeout(160);
        assert(JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(saved),
            'dragging away and back does not create a saved geometry change');
        // Cancel a captured mouse drag without committing an intermediate size.
        const cb = await resize.boundingBox(), x = cb.x + cb.width / 2, y = cb.y + cb.height / 2;
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 70, y - 70, { steps: 5 });
        await resize.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
        await page.mouse.up(); await page.waitForTimeout(160);
        const cancelled = await panel.boundingBox();
        assert(near(cancelled.width, small.width) && near(cancelled.height, small.height) && near(cancelled.y, small.y) &&
            JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(saved),
        'pointer cancellation restores the geometry and does not persist a partial resize', { small, cancelled });
        if (await panel.locator('.vela-panel-position-control').count()) await panel.locator('.vela-panel-position-close').click();
        await resize.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
        const keyboard = await panel.boundingBox();
        assert(keyboard.width >= small.width + 14 && keyboard.height >= small.height + 14,
            'keyboard arrows resize both dimensions without dragging', { small, keyboard });
        await resize.click();
        await resize.press('Enter');
        assert(await panel.locator('.vela-panel-position-control,.vela-panel-height-control').count() === 0,
            'click and Enter on the resize button never open a size popup');
        const afterClick = await panel.boundingBox();
        assert(near(afterClick.width, keyboard.width) && near(afterClick.height, keyboard.height),
            'clicking the resize button does not change its dimensions', { keyboard, afterClick });
        facts.desktop = { before, small, undo, redo, cancelled, keyboard, afterClick };
        await context.close();
    }
    {
        phase = 'built-in-compact';
        const { context, page } = await boot(undefined, false, true);
        await page.locator('.vela-pe .monaco-editor').waitFor({ state: 'visible', timeout: 60000 });
        const results = {};
        for (const [id, selector] of [['pineEditor', '.vela-pe'], ['objects', '.vela-ot'], ['dataWindow', '.vela-dw'],
            ['alerts', '.vela-ap'], ['strategyTester', '.vela-st']]) {
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, true), id);
            const panel = page.locator(selector); await panel.waitFor({ state: 'visible' });
            if (id === 'pineEditor') await page.evaluate(() => { window.__tinyMonaco = document.querySelector('.vela-pe .monaco-editor'); });
            await panel.locator('.vela-panel-dock-toggle').click();
            await drag(page, panel.locator('.vela-panel-corner-resize'), -500, 600);
            const compact = await cardInfo(panel);
            assert(compact.panel.width <= 162 && compact.panel.height <= 120 && inside(compact.panel, compact.host) &&
                compact.buttons.every((b) => b.rect.width >= 24 && b.rect.height >= 24 && inside(b.rect, compact.header)),
            `${id} can shrink to a small usable card`, compact);
            if (id === 'pineEditor') {
                const slot = panel.locator('.vela-panel-header-slot');
                const slotInfo = await slot.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth,
                    name: el.querySelector('.vela-pe-name').getBoundingClientRect().width,
                    more: el.querySelector('.vela-pe-icon').getBoundingClientRect().width }));
                assert(slotInfo.scroll > slotInfo.client && slotInfo.name >= 24 && slotInfo.more >= 24 &&
                    await page.evaluate(() => window.__tinyMonaco === document.querySelector('.vela-pe .monaco-editor')),
                'Pine keeps its original Monaco instance and horizontally scrollable name/actions', slotInfo);
                const more = panel.locator('.vela-pe-icon[aria-label="More actions"]');
                await more.scrollIntoViewIfNeeded(); await more.hover(); await page.waitForTimeout(150);
                const tooltipGeometry = await more.evaluate((el) => ({ trigger: el.getBoundingClientRect().toJSON(),
                    tip: document.querySelector('.vela-tooltip[data-state="open"]')?.getBoundingClientRect().toJSON() }));
                assert(tooltipGeometry.tip && (tooltipGeometry.tip.bottom <= tooltipGeometry.trigger.top - 5 ||
                    tooltipGeometry.tip.top >= tooltipGeometry.trigger.bottom + 5),
                    'the Pine tooltip stays beside its control inside a layout-contained panel', tooltipGeometry);
                await more.click();
                const pop = panel.locator('.vela-pe-pop');
                const popInfo = await pop.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), panel: el.closest('.vela-panel').getBoundingClientRect().toJSON(),
                    client: el.clientHeight, scroll: el.scrollHeight }));
                assert(await pop.isVisible() && inside(popInfo.rect, popInfo.panel) && popInfo.scroll > popInfo.client,
                    'Pine more actions stay inside the tiny card and scroll', popInfo);
                await page.keyboard.press('Escape');
                const body = panel.locator('.vela-panel-body');
                assert(await body.evaluate((el) => el.scrollHeight > el.clientHeight) &&
                    await panel.locator('.vela-pe-wrap').evaluate((el) => el.getBoundingClientRect().height >= 70),
                'the real Monaco editor has a usable viewport while status actions can scroll');
                await body.evaluate((el) => { el.scrollTop = 0; });
                const textArea = panel.locator('.monaco-editor textarea.inputarea');
                await textArea.focus();
                assert(await textArea.evaluate((el) => document.activeElement === el), 'Monaco can still receive keyboard input at the minimum size');
                await page.keyboard.press('Control+End');
                await page.keyboard.insertText('\n// compact-resize-draft');
                await page.waitForTimeout(400);
                const code = await page.evaluate(() => {
                    const library = JSON.parse(localStorage.getItem('vela-pine-library'));
                    return library.scripts.find((script) => script.id === library.activeId)?.code;
                });
                assert(code?.includes('// compact-resize-draft'), 'Pine still saves edits made in the tiny Monaco viewport');
            } else if (id === 'objects') {
                assert(await panel.locator('.vela-ot-headerbtn').count() === 2 && compact.bodyScroll.scroll > compact.bodyScroll.client,
                    'Object tree actions and scrolling remain available at minimum size');
                const button = panel.locator('.vela-panel-corner-resize');
                await button.click();
                assert(await panel.locator('.vela-panel-position-control,.vela-panel-height-control').count() === 0,
                    'the minimum-size card does not open a size popup');
                const beforeKeys = await panel.boundingBox();
                await button.focus(); await page.keyboard.press('ArrowUp');
                assert((await panel.boundingBox()).height >= beforeKeys.height + 14,
                    'keyboard resizing remains reachable on a minimum-size card');
            } else if (id === 'dataWindow') {
                await panel.getByRole('tab', { name: 'Table', exact: true }).click();
                const body = panel.locator('.vela-panel-body');
                await body.evaluate((el) => { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); });
                const table = panel.locator('.vela-dw-table-scroll');
                const data = await table.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), scroll: el.scrollHeight,
                    body: el.closest('.vela-panel-body').getBoundingClientRect().toJSON() }));
                assert(data.rect.height >= 40 && data.scroll > data.rect.height && data.rect.top < data.body.bottom && data.rect.bottom > data.body.top,
                    'Data table remains reachable and scrollable below metadata in the tiny card', data);
            } else if (id === 'alerts') {
                await panel.getByRole('tab', { name: /Log/ }).click();
                assert(await panel.getByRole('tab', { name: /Log/ }).getAttribute('aria-selected') === 'true',
                    'the narrow Alerts tab bar scrolls to Log');
                await panel.getByRole('tab', { name: 'Create', exact: true }).click();
                const create = panel.locator('.vela-ac-create');
                await create.scrollIntoViewIfNeeded();
                assert(await create.isVisible() && await panel.locator('.vela-panel-body').evaluate((el) => el.scrollTop > 0),
                    'the full alert form and Create action are reachable by scrolling');
            } else if (id === 'strategyTester') {
                const properties = panel.getByRole('tab', { name: 'Properties', exact: true });
                await properties.click();
                assert(await properties.getAttribute('aria-selected') === 'true', 'strategy tabs scroll to Properties in a tiny card');
                const view = panel.locator('.vela-st-view:not([hidden])');
                assert((await view.boundingBox()).height >= 150 &&
                    await panel.locator('.vela-panel-body').evaluate((el) => el.scrollHeight > el.clientHeight),
                'strategy report retains its own scrollable reading area');
            }
            results[id] = { panel: compact.panel, body: compact.body, slot: compact.slot };
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, false), id);
            await page.waitForTimeout(260);
        }
        facts.builtIns = results;
        await context.close();
    }
    {
        phase = 'watchlist';
        const { context, page } = await boot();
        await page.evaluate(async (url) => {
            const { WatchlistPanel } = await import(url);
            const panel = new WatchlistPanel(document.querySelector('.vela-ws-main'), {
                symbols: () => ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT'],
                quote: () => ({ load: async () => [], subscribe: () => () => {} }),
                onPick: (symbol) => { window.__pickedTinySymbol = symbol; }, onAdd: () => {}, onRemove: () => {},
            });
            window.__ws.dock.addBuiltIn({ id: 'watchProbe', title: 'Watchlist', icon: 'tester', order: 91, panel });
            window.__ws.dock.toggle('watchProbe', true);
        }, `/@fs${resolve('src/widget/watchlist-panel.ts')}`);
        const panel = page.locator('.vela-wl'); await panel.waitFor({ state: 'visible' });
        await panel.locator('.vela-panel-dock-toggle').click();
        await drag(page, panel.locator('.vela-panel-corner-resize'), -400, 600);
        const compact = await cardInfo(panel);
        const options = panel.getByRole('button', { name: 'Watchlist options' });
        assert(compact.panel.width <= 162 && compact.panel.height <= 120 &&
            (await options.boundingBox()).width >= 24 && compact.bodyScroll.scroll > compact.bodyScroll.client,
        'the real Watchlist has reachable header and body controls at the smallest size', compact);
        await options.click();
        const menu = panel.locator('.vela-wl-sortmenu');
        const menuInfo = await menu.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), panel: el.closest('.vela-panel').getBoundingClientRect().toJSON(),
            scroll: el.scrollHeight, client: el.clientHeight, radius: getComputedStyle(el).borderRadius }));
        assert(inside(menuInfo.rect, menuInfo.panel) && menuInfo.scroll > menuInfo.client && menuInfo.radius === '0px',
            'Watchlist options fit in the tiny panel and scroll', menuInfo);
        await options.focus(); await page.mouse.move(5, 5); await page.waitForTimeout(350); await page.keyboard.press('Escape');
        assert(!await menu.isVisible() && await options.getAttribute('aria-expanded') === 'false',
            'Watchlist options close with Escape and report their state');
        await panel.getByLabel('Filter the watchlist').fill('ETH');
        const row = panel.locator('.vela-wl-row:visible');
        assert(await row.count() === 1, 'filtering hides the nonmatching Watchlist rows');
        await row.scrollIntoViewIfNeeded(); await row.click();
        assert(await page.evaluate(() => window.__pickedTinySymbol) === 'BINANCE:ETHUSDT',
            'a filtered Watchlist row remains clickable after scrolling');
        await panel.locator('.vela-panel-max').click();
        assert(!await panel.locator('.vela-panel-corner-resize').isVisible(), 'maximize temporarily hides the floating resize button');
        await panel.locator('.vela-panel-max').click(); await page.waitForTimeout(120);
        assert(await panel.locator('.vela-panel-corner-resize').isVisible() && near((await panel.boundingBox()).width, compact.panel.width),
            'restore returns the previously resized floating card');
        facts.watchlist = { panel: compact.panel, menu: menuInfo.rect };
        await context.close();
    }
    {
        phase = 'contributed';
        const { context, page } = await boot();
        const modulePath = `/@fs${resolve('src/widget/contributions.ts')}`;
        await page.evaluate(async (fallback) => {
            const url = performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((name) => name.includes('/src/widget/contributions.ts')) ?? fallback;
            const { registerSidePanel } = await import(url);
            for (const desc of [
                { id: 'fixedTiny', title: 'Fixed plugin', width: 300 },
                { id: 'boundedTiny', title: 'Bounded plugin', width: 300, resizable: true, minWidth: 240, maxWidth: 450 },
            ]) registerSidePanel({ ...desc, icon: 'tester', mount: (_ctx, body, header) => {
                for (let i = 0; i < 6; i++) {
                    const button = document.createElement('button'); button.textContent = `Header ${i}`; header.slot.appendChild(button);
                }
                for (let i = 0; i < 10; i++) {
                    const button = document.createElement('button'); button.textContent = `Action ${i}`;
                    button.style.cssText = 'display:block;min-height:30px'; body.appendChild(button);
                }
            } });
            window.__ws.refreshActions();
        }, modulePath);
        for (const [id, minimum] of [['fixedTiny', 160], ['boundedTiny', 240]]) {
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, true), id);
            const panel = page.locator(`.vela-panel-${id}`); await panel.waitFor({ state: 'visible' });
            await panel.locator('.vela-panel-dock-toggle').click();
            await drag(page, panel.locator('.vela-panel-corner-resize'), -500, 500);
            const compact = await cardInfo(panel);
            assert(near(compact.panel.width, minimum) && compact.panel.height <= 135 && compact.slot.scroll > compact.slot.client &&
                compact.bodyScroll.scroll > compact.bodyScroll.client,
            `${id} resizes while honoring its declared minimum and preserving scrollable controls`, compact);
            const last = panel.getByRole('button', { name: 'Action 9' });
            await last.scrollIntoViewIfNeeded();
            assert(await last.isVisible(), `${id} body actions remain reachable`);
            await page.evaluate((panelId) => window.__ws.dock.toggle(panelId, false), id);
            await page.waitForTimeout(250);
            facts[id] = { width: compact.panel.width, height: compact.panel.height };
        }
        await context.close();
    }
    {
        phase = 'tiny-landscape';
        const { context, page } = await boot({ width: 240, height: 160 }, true);
        await page.evaluate(() => window.__ws.dock.toggle('objects', true));
        const panel = page.locator('.vela-ot'); await panel.waitFor({ state: 'visible' });
        await panel.locator('.vela-panel-dock-toggle').tap();
        await drag(page, panel.locator('.vela-panel-corner-resize'), -200, 80);
        const compact = await cardInfo(panel);
        assert(inside(compact.panel, compact.host) && compact.body.height >= 25 && compact.slot.client >= 34 &&
            compact.slot.scroll > compact.slot.client && compact.buttons.every((b) => inside(b.rect, compact.header)),
        'a very short landscape host keeps a scrollable body and reachable header controls', compact);
        const manage = panel.getByRole('button', { name: 'Manage objects' });
        await manage.scrollIntoViewIfNeeded(); await manage.tap();
        assert(await page.locator('.vela-ot-mo').isVisible() && await panel.isVisible(),
            'the second header action remains tappable after horizontal scrolling');
        facts.tinyLandscape = { panel: compact.panel, body: compact.body, slot: compact.slot };
        await context.close();
    }
    {
        phase = 'embedded-and-viewport';
        const { context, page } = await boot();
        await page.locator('#workspace').evaluate((el) => Object.assign(el.style,
            { left: '150px', top: '80px', right: 'auto', bottom: 'auto', width: '820px', height: '550px' }));
        await page.waitForTimeout(200);
        await page.locator('.vela-widget-panel-dataWindow').click();
        const panel = page.locator('.vela-dw'); await panel.locator('.vela-panel-dock-toggle').click();
        await drag(page, panel.locator('.vela-panel-title'), -500, -400);
        await page.evaluate(() => {
            const v = window.visualViewport;
            for (const [key, value] of Object.entries({ offsetLeft: 200, offsetTop: 140, width: 400, height: 240 }))
                Object.defineProperty(v, key, { configurable: true, value });
            v.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(200);
        const button = panel.locator('.vela-panel-corner-resize');
        const before = await cardInfo(panel);
        await drag(page, button, 250, -80);
        const after = await cardInfo(panel);
        const visual = { left: 200, top: 140, right: 600, bottom: 380 };
        assert(inside(after.panel, after.host) && inside(after.panel, visual) && after.panel.width >= before.panel.width - 2,
            'embedded resize respects both offset host and constrained visual viewport', { before, after, visual });
        await page.evaluate(() => {
            const v = window.visualViewport;
            for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) delete v[key];
            v.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(180);
        assert(inside((await cardInfo(panel)).panel, (await cardInfo(panel)).host),
            'the resized card stays in the embedded host when the visual viewport recovers');
        facts.embedded = { before: before.panel, after: after.panel };
        await context.close();
    }
    {
        phase = 'mode-during-drag';
        const { context, page } = await boot();
        await page.locator('.vela-widget-panel-objects').click();
        const panel = page.locator('.vela-ot'); await panel.locator('.vela-panel-dock-toggle').click();
        await page.waitForTimeout(250);
        const before = await panel.boundingBox();
        const state = await page.evaluate(() => window.__ws.getState().panels);
        const button = panel.locator('.vela-panel-corner-resize'), box = await button.boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 60, y + 80, { steps: 5 });
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.mouse.up(); await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(250);
        const restored = await panel.boundingBox();
        assert(near(restored.width, before.width) && near(restored.height, before.height) && near(restored.x, before.x) && near(restored.y, before.y) &&
            JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(state),
        'switching to portrait during a drag cancels the unfinished resize', { before, restored, state });
        facts.modeDuringDrag = { before, restored };
        await context.close();
    }
    {
        phase = 'persist';
        const { context, page } = await boot(undefined, false, false, true);
        await page.locator('.vela-widget-panel-objects').click();
        const panel = page.locator('.vela-ot'); await panel.locator('.vela-panel-dock-toggle').click();
        await drag(page, panel.locator('.vela-panel-corner-resize'), -120, 230);
        const before = await panel.boundingBox(); await page.waitForTimeout(750);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length === 4 && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
        await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(200);
        const restored = await panel.boundingBox();
        assert(await panel.getAttribute('data-free-floating') === '1' && near(restored.width, before.width) && near(restored.height, before.height) &&
            near(restored.x, before.x) && near(restored.y, before.y), 'floating two-axis size survives a real reload', { before, restored });
        facts.persist = { before, restored };
        await context.close();
    }
    {
        phase = 'touch-and-rotation';
        const { context, page } = await boot({ width: 780, height: 390 }, true);
        await page.locator('.vela-widget-panel-objects').tap();
        const panel = page.locator('.vela-ot'); await panel.locator('.vela-panel-dock-toggle').tap();
        const button = panel.locator('.vela-panel-corner-resize');
        await button.tap();
        assert(await panel.locator('.vela-panel-position-control,.vela-panel-height-control').count() === 0,
            'a touch on the resize button never opens a size popup');
        const before = await panel.boundingBox();
        if (engine !== 'webkit') {
            const box = await button.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
            const cdp = await context.newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
                touchPoints: [{ x: x - 80 * i / 8, y: y + 65 * i / 8, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(220);
            const after = await panel.boundingBox();
            assert(after.width < before.width - 55 && after.height < before.height - 40 && near(bottom(after), bottom(before)),
                'a real touch drag of the button changes both dimensions', { before, after });
            const cancelledStart = await button.boundingBox();
            const tx = cancelledStart.x + cancelledStart.width / 2, ty = cancelledStart.y + cancelledStart.height / 2;
            const saved = await page.evaluate(() => window.__ws.getState().panels);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 2 }] });
            for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
                touchPoints: [{ x: tx + 50 * i / 5, y: ty - 40 * i / 5, id: 2 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
            await cdp.detach(); await page.waitForTimeout(180);
            const cancelled = await panel.boundingBox();
            assert(near(cancelled.width, after.width) && near(cancelled.height, after.height) && near(cancelled.y, after.y) &&
                JSON.stringify(await page.evaluate(() => window.__ws.getState().panels)) === JSON.stringify(saved),
            'real touch cancellation rolls back without creating a saved resize', { after, cancelled });
            facts.realTouch = { before, after, cancelled };
        }
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        assert(await panel.locator('.vela-panel-grip').isVisible() && !await button.isVisible(),
            'portrait keeps its original bottom-sheet height grip and hides the desktop button');
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(200);
        assert(await panel.getAttribute('data-free-floating') === '1' && await button.isVisible() &&
            !await panel.locator('.vela-panel-grip').isVisible(), 'rotation restores the floating button without the old height strip');
        facts.rotation = { landscape: before, restored: await panel.boundingBox() };
        await context.close();
    }
    assert(errors.length === 0, 'no unexpected browser page errors', errors);
    report('floating-corner-resize', { browser: engine, ...facts, errors, warnings });
} catch (error) {
    console.error(`FAIL ${phase}:`, error);
    process.exitCode = 1;
} finally { await browser.close(); }
