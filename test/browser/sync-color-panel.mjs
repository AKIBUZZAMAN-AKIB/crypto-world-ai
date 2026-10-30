// Color picker behavior and geometry in the real offline workspace. No screenshots or
// synthetic HTML fixture. SYNC_BROWSER=webkit runs the same scenarios in WebKit.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = process.env.SYNC_BROWSER === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], resizeWarnings = [], facts = { sizes: [] };
let phase = 'boot';

async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
        const detail = `${phase}: ${String(error)}`;
        // Independently reproduced before Settings opens; see sync-chart-settings-compact.
        if (phase === 'embedded-resize' && String(error).includes('ResizeObserver loop completed with undelivered notifications')) resizeWarnings.push(detail);
        else errors.push(detail);
    });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4 && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}

async function openSettings(page, touch) {
    if (touch) await page.locator('.vela-mb-settings').tap();
    else await page.evaluate(() => window.__ws.active.chart.renderer.openSettings());
    await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    const trigger = page.locator('.vela-dialog--settings .vela-color-field:visible').first();
    if (touch) await trigger.tap(); else await trigger.click();
    await page.locator('.vela-color-field-pop').waitFor({ state: 'visible' });
    return trigger;
}

async function info(page, selector = '.vela-color-field-pop') {
    return page.locator(selector).evaluate((el) => {
        const rect = (node) => node?.getBoundingClientRect().toJSON() ?? null;
        const picker = el.querySelector('.vela-color-picker');
        const recent = picker.querySelector('[aria-label="Recent colors"]');
        const active = el.contains(document.activeElement) ? document.activeElement : null;
        const visual = window.visualViewport;
        return {
            pop: rect(el), picker: rect(picker), host: rect(document.querySelector('.vela-workspace')),
            outsideWorkspace: !document.querySelector('.vela-workspace')?.contains(el), parentChain: [el.parentElement?.tagName+'.'+el.parentElement?.className, el.parentElement?.parentElement?.tagName+'.'+el.parentElement?.parentElement?.className],
            drawingHost: rect(el.parentElement), active: rect(active),
            visual: { left: visual.offsetLeft, top: visual.offsetTop, right: visual.offsetLeft + visual.width,
                bottom: visual.offsetTop + visual.height, width: visual.width, height: visual.height },
            radius: getComputedStyle(el).borderRadius, overflowX: getComputedStyle(el).overflowX,
            overflowY: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            scrollTop: el.scrollTop, pickerScrollWidth: picker.scrollWidth, pickerClientWidth: picker.clientWidth,
            paletteCount: picker.querySelectorAll('.vela-color-palette button').length,
            recent: [...recent.querySelectorAll('button')].map((node) => node.getAttribute('aria-label')),
            recentScrollWidth: recent.scrollWidth, recentClientWidth: recent.clientWidth,
            recentText: recent.parentElement.textContent, custom: picker.querySelector('input[type=color]')?.getAttribute('aria-label'),
            opacity: picker.querySelector('[aria-label="Opacity percentage"]')?.value,
            role: el.getAttribute('role'), name: el.getAttribute('aria-label'),
            heading: !!el.querySelector('.vela-dialog-title,.vela-panel-header,.vela-size-grip'),
        };
    });
}

function inside(rect, bound, tolerance = 1.1) {
    return rect.left >= bound.left - tolerance && rect.top >= bound.top - tolerance &&
        rect.right <= bound.right + tolerance && rect.bottom <= bound.bottom + tolerance;
}

async function simulateVisualViewport(page, values) {
    await page.evaluate((values) => {
        const view = window.visualViewport;
        for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) {
            if (values) Object.defineProperty(view, key, { configurable: true, value: values[key] });
            else delete view[key];
        }
        view.dispatchEvent(new Event('resize'));
        view.dispatchEvent(new Event('scroll'));
    }, values);
    await page.waitForTimeout(150);
}

try {
    {
        phase = 'desktop';
        const { context, page } = await boot({ width: 1440, height: 900 });
        const trigger = await openSettings(page, false);
        const pop = page.locator('.vela-color-field-pop');
        const start = await info(page);
        assert(start.paletteCount === 80 && start.radius === '0px' && !start.heading &&
            start.pop.width <= 250.1 && start.pop.height <= 280 && !start.recentText.includes('+') &&
            start.custom === 'Custom color' && start.role === 'dialog' && start.name === 'Color picker',
        'picker is compact, square, labelled, and keeps all colors and the custom editor without a plus', start);
        assert(await trigger.getAttribute('aria-expanded') === 'true', 'the color field exposes its expanded state');
        const editGlyph = await pop.locator('.vela-color-custom .vela-icon').evaluate((el) => ({ mask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
            box: el.getBoundingClientRect().toJSON() }));
        assert(editGlyph.mask && editGlyph.mask !== 'none' && editGlyph.box.width > 0 && editGlyph.box.height > 0,
            'the custom-color well has a visible masked edit glyph', editGlyph);
        await pop.locator('button[data-c="#33adeb"]').click();
        assert((await info(page)).recent[0] === 'Recent color #33adeb', 'a palette pick immediately appears in recents');
        const native = pop.locator('input[type=color]');
        const nativeBefore = await native.evaluate((el) => {
            window.__colorNative = el; window.__customActivated = 0;
            // Avoid opening an OS-owned chooser in automation while verifying the hit target.
            el.addEventListener('click', (event) => { window.__customActivated++; event.preventDefault(); }, { once: true });
            return el.isConnected;
        });
        await pop.locator('.vela-color-custom').click();
        assert(await page.evaluate(() => window.__customActivated) === 1, 'the current-color well activates the native custom editor');
        await native.evaluate((el) => { el.value = '#123abc'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        const streaming = await info(page);
        assert(nativeBefore && streaming.recent[0] === 'Recent color #33adeb' &&
            await native.evaluate((el) => el === window.__colorNative && el.isConnected && el.value === '#123abc'),
        'custom input stays mounted during its native live preview and recents do not commit early', streaming);
        await native.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
        const committed = await info(page);
        assert(committed.recent[0] === 'Recent color #123abc' &&
            await native.evaluate((el) => el === window.__colorNative && el.isConnected),
        'committing the custom color immediately updates recents without replacing the input', committed);
        const pct = pop.locator('[aria-label="Opacity percentage"]');
        await pct.fill('42'); await pct.press('Enter');
        assert(await pct.inputValue() === '42%' && await pop.locator('[role="slider"]').getAttribute('aria-valuenow') === '42',
            'the compact opacity controls still update together');
        const palette = pop.locator('.vela-color-palette button');
        const paletteColors = await palette.evaluateAll((nodes) => nodes.slice(0, 12).map((node) => node.dataset.c));
        for (let i = 0; i < 12; i++) await palette.nth(i).click();
        const full = await info(page);
        assert(full.recent.length === 10 && JSON.stringify(full.recent) === JSON.stringify(paletteColors.slice(-10).reverse().map((c) => `Recent color ${c}`)) &&
            full.recentScrollWidth > full.recentClientWidth,
        'the ten newest unique colors are kept in a single scrollable row', full);
        const strip = pop.locator('[aria-label="Recent colors"]');
        await strip.hover();
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(40);
        assert(await strip.evaluate((el) => el.scrollLeft > 0), 'a mouse wheel can reach the rest of the recent-color strip');
        await strip.evaluate((el) => { el.scrollLeft = 0; });
        const recent = pop.locator('[aria-label="Recent colors"] button');
        const oldLabel = await recent.nth(9).getAttribute('aria-label');
        await recent.nth(9).focus();
        await page.waitForTimeout(30);
        const focusedRecent = await recent.nth(9).evaluate((node) => ({ item: node.getBoundingClientRect().toJSON(), strip: node.parentElement.getBoundingClientRect().toJSON() }));
        assert(inside(focusedRecent.item, focusedRecent.strip), 'keyboard focus scrolls a hidden recent color into view', focusedRecent);
        await page.keyboard.press('Enter');
        assert(await recent.first().getAttribute('aria-label') === oldLabel &&
            await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === oldLabel &&
            await native.evaluate((el) => el === window.__colorNative && el.isConnected),
        'reordering a focused recent preserves keyboard focus and the native input');
        await page.keyboard.press('Escape');
        assert(await page.locator('.vela-color-field-pop').count() === 0 && await page.locator('.vela-dialog--settings').isVisible() &&
            await trigger.getAttribute('aria-expanded') === 'false' && await trigger.evaluate((el) => document.activeElement === el),
        'Escape returns focus to the trigger and keeps Settings open');
        await page.evaluate(() => {
            const viewport = window.visualViewport, add = viewport.addEventListener, remove = viewport.removeEventListener;
            window.__colorViewportListeners = new Set();
            viewport.addEventListener = function (type, listener, options) {
                if (type === 'resize' || type === 'scroll') window.__colorViewportListeners.add(`${type}:${String(listener)}`);
                return add.call(this, type, listener, options);
            };
            viewport.removeEventListener = function (type, listener, options) {
                if (type === 'resize' || type === 'scroll') window.__colorViewportListeners.delete(`${type}:${String(listener)}`);
                return remove.call(this, type, listener, options);
            };
        });
        await trigger.press('Enter');
        const reopened = await info(page);
        assert(reopened.recent[0] === oldLabel && await page.evaluate(() => !!document.activeElement?.closest('.vela-color-field-pop')),
            'keyboard opening enters the picker and retains the shared recents', reopened);
        assert(await page.evaluate(() => window.__colorViewportListeners.size) === 2, 'the open picker watches visual-viewport changes');
        await page.keyboard.press('Escape');
        assert(await page.evaluate(() => window.__colorViewportListeners.size) === 0, 'closing the picker removes its visual-viewport listeners');
        facts.desktop = { start, committed, full, reopened };
        await context.close();
    }

    for (const size of [{ width: 390, height: 780 }, { width: 320, height: 568 }, { width: 240, height: 320 }]) {
        phase = `phone-${size.width}`;
        const { context, page } = await boot(size, true);
        await openSettings(page, true);
        const pop = page.locator('.vela-color-field-pop');
        const initial = await info(page);
        assert(inside(initial.pop, initial.visual) && initial.paletteCount === 80 &&
            initial.radius === '0px' && !initial.heading && initial.custom === 'Custom color' && !initial.recentText.includes('+'),
        'the compact phone panel fits the visible screen and may escape an embedded workspace', { size, initial });
        await pop.locator('button[data-c="#33adeb"]').tap();
        assert((await info(page)).recent[0] === 'Recent color #33adeb', 'phone picks update recents immediately', size);
        await pop.locator('input[type=color]').evaluate((el) => {
            window.__customActivated = 0;
            el.addEventListener('click', (event) => { window.__customActivated++; event.preventDefault(); }, { once: true });
        });
        await pop.locator('.vela-color-custom').tap();
        assert(await page.evaluate(() => window.__customActivated) === 1, 'the custom-color well is tappable on a phone', size);
        // Focus without browser scrolling; the viewport resize must reveal this input in the popover itself.
        await pop.locator('[aria-label="Opacity percentage"]').evaluate((el) => el.focus({ preventScroll: true }));
        const left = size.width >= 320 ? 60 : 25;
        const width = size.width >= 320 ? 190 : 150;
        await simulateVisualViewport(page, { offsetLeft: left, offsetTop: 25, width, height: 150 });
        const keyboard = await info(page);
        assert(inside(keyboard.pop, keyboard.visual) &&
            keyboard.scrollHeight > keyboard.clientHeight && keyboard.active && inside(keyboard.active, keyboard.pop),
        'a moving, keyboard-shortened visual viewport resizes the popup and reveals the focused input', { size, keyboard });
        assert(keyboard.pickerScrollWidth <= keyboard.pickerClientWidth + 1,
            'compact contents do not overflow horizontally when the panel narrows', { size, keyboard });
        const topBefore = keyboard.pop.top;
        await pop.evaluate((el) => { el.scrollTop = 0; });
        await page.waitForTimeout(80);
        assert(Math.abs((await info(page)).pop.top - topBefore) <= 1, 'scrolling inside the popup does not move its shell');
        await simulateVisualViewport(page, null);
        const restored = await info(page);
        assert(inside(restored.pop, restored.visual), 'the popup refits to the visible viewport when the keyboard closes', restored);
        const extreme = [];
        if (size.width === 390) {
            // A nearly occluded screen cannot offer usable controls, but the shell
            // must not overflow it and must recover when space returns.
            for (const [width, height] of [[100, 20], [20, 100], [10, 10]]) {
                await simulateVisualViewport(page, { offsetLeft: 80, offsetTop: 25, width, height });
                const snapshot = await page.evaluate(() => {
                    const el = document.querySelector('.vela-color-field-pop'), v = visualViewport;
                    return { pop: el.getBoundingClientRect().toJSON(), visual: { left: v.offsetLeft, top: v.offsetTop,
                        right: v.offsetLeft + v.width, bottom: v.offsetTop + v.height } };
                });
                assert(inside(snapshot.pop, snapshot.visual), 'even a nearly occluded visual viewport contains the shell', snapshot);
                extreme.push(snapshot);
            }
            await simulateVisualViewport(page, null);
            const recovered = await info(page);
            assert(inside(recovered.pop, recovered.visual) && recovered.pop.width > 200 && recovered.pop.height > 200,
                'the color panel regains its normal size after an extreme viewport change', recovered);
        }
        facts.sizes.push({ size, initial, keyboard, restored, extreme });
        await context.close();
    }

    {
        phase = 'rotation';
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await openSettings(page, true);
        await page.setViewportSize({ width: 320, height: 568 });
        await page.waitForTimeout(300);
        const resized = await info(page);
        assert(inside(resized.pop, resized.visual),
            'an open picker tracks a real portrait viewport resize', resized);
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForTimeout(400);
        assert(await page.locator('.vela-dialog--settings').isVisible(), 'rotation leaves the parent Settings open');
        if (await page.locator('.vela-color-field-pop').count() === 0) {
            await page.locator('.vela-dialog--settings .vela-color-field:visible').first().tap();
        }
        const landscape = await info(page);
        assert(inside(landscape.pop, landscape.visual),
            'the picker stays bounded in landscape after reopening if the chrome mode changed', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(400);
        assert(await page.locator('.vela-dialog--settings').isVisible(), 'rotating back also preserves Settings');
        if (await page.locator('.vela-color-field-pop').count() === 0) {
            await page.locator('.vela-dialog--settings .vela-color-field:visible').first().tap();
        }
        const portrait = await info(page);
        assert(inside(portrait.pop, portrait.visual),
            'the picker stays bounded after returning to portrait', portrait);
        facts.rotation = { resized, landscape, portrait };
        await context.close();
    }

    {
        phase = 'embedded';
        const { context, page } = await boot({ width: 1000, height: 800 }, true);
        phase = 'embedded-resize';
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style,
            { inset: 'auto', left: '100px', top: '110px', width: '240px', height: '350px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.waitForTimeout(200);
        phase = 'embedded-settings';
        await openSettings(page, true);
        const before = await info(page);
        assert(inside(before.pop, before.visual), 'Settings color panel is viewport-bounded and escapes the embedded workspace', before);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { width: '210px', height: '250px' }));
        await page.waitForTimeout(250);
        const resized = await info(page);
        assert(inside(resized.pop, resized.visual) && resized.outsideWorkspace &&
            (resized.pop.width > resized.host.width || resized.pop.height > resized.host.height),
            'an open picker remains viewport-fitted and is not resized to a smaller embedded host', resized);
        await page.locator('.vela-color-field-pop [aria-label="Opacity percentage"]').evaluate((el) => el.focus({ preventScroll: true }));
        await simulateVisualViewport(page, { offsetLeft: 130, offsetTop: 125, width: 150, height: 120 });
        const intersection = await info(page);
        assert(inside(intersection.pop, intersection.visual) &&
            intersection.active && inside(intersection.active, intersection.pop),
        'the picker follows the visible viewport even when the workspace is smaller', intersection);
        await simulateVisualViewport(page, null);
        // Tapping outside dismisses only the child. WebKit may consume Escape for
        // its simulated software-keyboard session after a visual viewport change.
        await page.touchscreen.tap(500, 500);
        await page.locator('.vela-color-field-pop').waitFor({ state: 'hidden' });
        await page.locator('.vela-dialog--settings .vela-dialog-close').tap();
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { width: '240px', height: '350px' }));
        await page.waitForTimeout(250);
        phase = 'embedded-drawing';
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }], style: { lineColor: '#e33e55' } });
            window.__colorDrawing = drawing.id;
            chart.drawings.openSettings(drawing.id);
        });
        await page.locator('.vela-dpop [aria-label="Line color, color"]').tap();
        const drawingPop = page.locator('.vela-popover:has(.vela-color-picker)');
        const drawing = await info(page, '.vela-popover:has(.vela-color-picker)');
        assert(inside(drawing.pop, drawing.visual) && drawing.pop.width >= 200 && drawing.pop.right > drawing.drawingHost.right &&
            !drawing.recentText.includes('+'),
        'drawing picker expands beyond a narrow chart cell while remaining viewport-contained', drawing);
        await drawingPop.locator('button[data-c="#33adeb"]').tap();
        assert(await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__colorDrawing).style.lineColor) === '#33adeb' &&
            (await info(page, '.vela-popover:has(.vela-color-picker)')).recent[0] === 'Recent color #33adeb',
        'a drawing color pick updates the drawing and recents while its toolbar stays open');
        const drawingPct = drawingPop.locator('[aria-label="Opacity percentage"]');
        await drawingPct.focus(); await drawingPct.fill('45'); await drawingPct.press('Enter');
        const narrowControls = await drawingPop.evaluate((el) => ({ pop: el.getBoundingClientRect().toJSON(),
            slider: el.querySelector('[role=slider]').getBoundingClientRect().toJSON(),
            pct: el.querySelector('[aria-label="Opacity percentage"]').getBoundingClientRect().toJSON(),
            pickerWidth: el.querySelector('.vela-color-picker').clientWidth, pickerScroll: el.querySelector('.vela-color-picker').scrollWidth }));
        assert(await drawingPct.inputValue() === '45%' && inside(narrowControls.pct, narrowControls.pop) &&
            inside(narrowControls.slider, narrowControls.pop) && narrowControls.pickerScroll <= narrowControls.pickerWidth + 1,
        'opacity remains reachable and usable in a very narrow drawing host', narrowControls);
        facts.embedded = { before, resized, intersection, drawing, narrowControls };
        await context.close();
    }

    {
        phase = 'drawing-mixed';
        const { context, page } = await boot({ width: 1000, height: 800 });
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const colors = ['#11335580', '#cc2222', '#449922', '#a011ab', '#343499', '#ff8111', '#6c8800', '#880d7a', '#889922', '#32afea', '#788800', '#111199'];
            const drawings = colors.map((color, i) => chart.drawings.add('hline', {
                anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + i }], style: { lineColor: color },
            }));
            chart.drawings.select(drawings.map((drawing) => drawing.id));
        });
        await page.locator('.vela-dpop [aria-label="Line color, color"]').click();
        const pop = page.locator('.vela-popover:has(.vela-color-picker)');
        const used = pop.locator('[aria-label="Colors in use"]');
        const mixed = await used.evaluate((el) => ({ count: el.querySelectorAll('button').length, width: el.clientWidth, scroll: el.scrollWidth,
            pop: el.parentElement.getBoundingClientRect().toJSON(), host: el.parentElement.parentElement.getBoundingClientRect().toJSON() }));
        assert(mixed.count === 12 && mixed.scroll > mixed.width && mixed.pop.width <= 250.1 && inside(mixed.pop, mixed.host),
            'many mixed-drawing colors remain reachable without widening the compact panel', mixed);
        await used.locator('button').last().focus();
        await page.waitForTimeout(30);
        const focused = await used.locator('button').last().evaluate((node) => ({ item: node.getBoundingClientRect().toJSON(), strip: node.parentElement.getBoundingClientRect().toJSON() }));
        assert(inside(focused.item, focused.strip), 'keyboard focus reveals a mixed-drawing color in the scrolling strip', focused);
        await used.locator('button').first().click();
        const values = await page.evaluate(() => window.__ws.active.chart.drawings.all().map((drawing) => drawing.style.lineColor));
        assert(values.every((value) => value === '#11335580'), 'an in-use choice still applies its full color and alpha to all drawings', values);
        await page.locator('.vela-dpop [aria-label="Line color, color"]').click();
        assert(await pop.locator('[aria-label="Recent colors"] button').first().getAttribute('aria-label') === 'Recent color #113355',
            'an in-use choice is also collected automatically in recents');
        facts.mixed = { mixed, values };
        await context.close();
    }
    assert(errors.length === 0, 'no unexpected browser errors', errors);
    report('color-panel', { browser: process.env.SYNC_BROWSER ?? 'chromium', ...facts, errors, resizeWarnings });
} finally {
    await browser.close();
}
