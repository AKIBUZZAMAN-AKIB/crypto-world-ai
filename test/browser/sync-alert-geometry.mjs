// Real responsive dock geometry and entry points on the existing offline workspace.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = [];
const errors = [];
try {
    for (const [width, height, touch] of [[240, 320, true], [320, 568, true], [390, 780, true], [568, 320, true], [844, 390, true], [1280, 820, false]]) {
        const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length >= 1);
        await page.waitForTimeout(350);
        const portrait = touch && height > width;
        const button = page.locator(portrait ? '.vela-mb-alerts' : '.vela-widget-alerts');
        const entry = await button.evaluate((el) => {
            const box = el.getBoundingClientRect(), glyph = el.querySelector('.vela-icon');
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return { x: box.x, right: box.right, w: box.width, h: box.height, hit: hit === el || el.contains(hit), mask: glyph ? getComputedStyle(glyph).maskImage : 'none', scroll: el.closest('.vela-widget-topbar, .vela-mb-scroll')?.scrollLeft };
        });
        assert(entry.x >= 0 && entry.right <= width && entry.hit && entry.mask !== 'none' && entry.scroll === 0, 'visible, hit-testable bell with a real glyph at the initial scroll position', { width, height, entry });
        if (touch) await button.tap(); else await button.click();
        await page.waitForSelector('.vela-ap:not([hidden])');
        const geometry = await page.evaluate(() => {
            const panel = document.querySelector('.vela-ap'), host = panel.parentElement, view = panel.querySelector('.vela-ap-create-view');
            const r = panel.getBoundingClientRect(), h = host.getBoundingClientRect(), s = getComputedStyle(panel);
            return { panel: [r.x, r.y, r.width, r.height, r.bottom], host: [h.x, h.y, h.width, h.height, h.bottom], radius: s.borderRadius,
                layout: document.querySelector('.vela-workspace').dataset.layout, standard: panel.dataset.standardPane, free: panel.dataset.freeFloating ?? null,
                maximize: getComputedStyle(panel.querySelector('.vela-panel-max')).display !== 'none', scroll: [view.clientHeight, view.scrollHeight],
                pageWidth: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
                tabs: [...panel.querySelectorAll('[role="tab"]')].map((e) => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), selected: e.getAttribute('aria-selected'), controls: e.getAttribute('aria-controls') })) };
        });
        assert(geometry.standard === '1' && geometry.maximize === portrait && !geometry.free && geometry.radius === '0px', 'square standard pane has a phone-only maximize toggle', { width, height, geometry });
        assert(geometry.layout === (portrait ? 'mobile' : 'desktop'), 'portrait and touch landscape choose the correct chrome', { width, height, geometry });
        assert(geometry.tabs.length === 3 && geometry.tabs.map((tab) => tab.label).join(',') === 'Create,Alerts,Log' && geometry.tabs[0].selected === 'true', 'Create, Alerts and Log tabs', geometry.tabs);
        assert(geometry.panel[0] >= geometry.host[0] - 1 && geometry.panel[0] + geometry.panel[2] <= geometry.host[0] + geometry.host[2] + 1 && geometry.panel[1] >= geometry.host[1] - 1 && geometry.panel[4] <= geometry.host[4] + 1, 'pane stays inside its dock host', geometry);
        assert(geometry.pageWidth[0] === geometry.pageWidth[1], 'no horizontal page overflow', geometry.pageWidth);
        if (portrait) assert(Math.abs(geometry.panel[2] - geometry.host[2]) < 1 && Math.abs(geometry.panel[4] - geometry.host[4]) < 1 && geometry.scroll[0] > 50 && geometry.scroll[1] > geometry.scroll[0], 'phone pane is bottom-attached, full width and internally scrollable', geometry);
        await page.getByRole('tab', { name: 'Create', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        assert(await page.getByRole('tab', { name: 'Alerts', exact: true }).getAttribute('aria-selected') === 'true', 'arrow key activates Alerts');
        await page.keyboard.press('ArrowRight');
        assert(await page.getByRole('tab', { name: 'Log', exact: true }).getAttribute('aria-selected') === 'true', 'second arrow key activates Log');
        await page.keyboard.press('Home');
        assert(await page.getByRole('tab', { name: 'Create', exact: true }).getAttribute('aria-selected') === 'true', 'Home restores Create');
        assert(await button.getAttribute('aria-pressed') === 'true', 'bell reports pane open');
        if (width === 1280) {
            const panel = page.locator('.vela-ap');
            const before = await panel.boundingBox(), edge = await panel.locator('.vela-panel-resizer').boundingBox();
            const x = edge.x + edge.width / 2, y = edge.y + edge.height / 2;
            await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 80, y, { steps: 8 }); await page.mouse.up();
            await page.waitForTimeout(300);
            const after = await panel.boundingBox();
            assert(after.width > before.width + 60 && Math.abs((after.x + after.width) - (before.x + before.width)) < 3,
                'desktop width grip resizes while keeping the pane docked', { before, after });
            const head = await panel.locator('.vela-panel-header').boundingBox();
            await page.mouse.move(head.x + 70, head.y + head.height / 2); await page.mouse.down();
            await page.mouse.move(head.x - 50, head.y + 100, { steps: 8 }); await page.mouse.up();
            const dragged = await panel.boundingBox();
            assert(Math.abs(dragged.x - after.x) < 3 && Math.abs(dragged.y - after.y) < 3 && await panel.getAttribute('data-floating') !== '1',
                'standard dock heading cannot detach into a floating pane', { after, dragged });
            facts.push({ desktopResize: { before, after, dragged } });
        }
        facts.push({ viewport: [width, height], entry: [Math.round(entry.x), Math.round(entry.right)], panel: geometry.panel.map(Math.round), scroll: geometry.scroll });
        await context.close();
    }
    // A real touch drag resizes the top edge, not the bottom edge or pane position.
    {
        const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 1);
        await page.locator('.vela-mb-alerts').tap();
        const panel = page.locator('.vela-ap');
        const before = await panel.boundingBox();
        const grip = await panel.locator('.vela-panel-grip').boundingBox();
        const cdp = await context.newCDPSession(page);
        const x = Math.round(grip.x + grip.width / 2), y = Math.round(grip.y + grip.height / 2);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 10, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(200);
        const after = await panel.boundingBox();
        assert(after.height > before.height + 40 && Math.abs((after.y + after.height) - (before.y + before.height)) < 2, 'touch grip grows the phone pane while its bottom remains attached', { before, after });
        const saved = await page.evaluate(() => window.__ws.getState().panels);
        assert(saved?.heights?.alerts > 0, 'phone Alerts height persists in dock state', saved);
        await panel.locator('.vela-panel-grip').focus(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
        const keyboard = await panel.boundingBox();
        assert(keyboard.height >= after.height + 25 && Math.abs(keyboard.y + keyboard.height - after.y - after.height) < 3,
            'phone pane also supports keyboard height adjustment', { after, keyboard });
        // Orientation changes retain the same open pane and move the active indication to
        // the chrome for that orientation; landscape retains the only-pair-pinned rule.
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        assert(await page.locator('.vela-ap').isVisible() && await page.locator('.vela-widget-alerts').getAttribute('aria-pressed') === 'true', 'open pane and desktop bell survive rotation');
        const sticky = await page.evaluate(() => {
            const top = document.querySelector('.vela-widget-topbar'), symbol = top.querySelector('.vela-widget-symbol'), bell = top.querySelector('.vela-widget-alerts');
            const before = symbol.getBoundingClientRect().x; top.scrollLeft = 100;
            return { symbolBefore: before, symbolAfter: symbol.getBoundingClientRect().x, symbolPosition: getComputedStyle(symbol).position, bellPosition: getComputedStyle(bell).position };
        });
        assert(sticky.symbolPosition === 'sticky' && sticky.bellPosition !== 'sticky' && Math.abs(sticky.symbolAfter - sticky.symbolBefore) < 1, 'only the pair is pinned in landscape', sticky);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        assert(await page.locator('.vela-ap').isVisible() && await page.locator('.vela-mb-alerts').getAttribute('aria-pressed') === 'true', 'portrait restores the same open pane');
        facts.push({ resize: { before, after, keyboard, saved }, rotation: sticky });
        await context.close();
    }
    // An embedded portrait-sized host must use its own bounds, not the browser viewport.
    {
        const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 1);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '8px', top: '8px', width: '280px', height: '350px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.locator('.vela-mb-alerts').click();
        const embedded = await page.evaluate(() => {
            const panel = document.querySelector('.vela-ap').getBoundingClientRect(), host = document.querySelector('.vela-ap').parentElement.getBoundingClientRect();
            return { panel: [panel.x, panel.y, panel.width, panel.height, panel.bottom], host: [host.x, host.y, host.width, host.height, host.bottom] };
        });
        assert(Math.abs(embedded.panel[2] - 280) < 1 && Math.abs(embedded.panel[4] - embedded.host[4]) < 1 && embedded.panel[1] >= embedded.host[1], 'embedded host owns pane geometry', embedded);
        facts.push({ embedded });
        await context.close();
    }
    assert(errors.length === 0, 'no page errors', errors);
    report('alerts-geometry', { facts, errors });
} finally { await browser.close(); }
