// Phone price-axis hold shares the desktop scale model in a compact nested menu.
// Chromium uses trusted CDP touch; WebKit exercises the same pointer path and real canvas.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {}, errors = [];
const near = (a, b, t = 3) => Math.abs(a - b) <= t;
async function boot(viewport = { width: 390, height: 780 }) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    await page.evaluate(() => window.__ws.setLayout('1')); await page.waitForTimeout(600);
    return { context, page };
}
async function hold(context, page, pos) {
    const x = Math.round(pos.x), y = Math.round(pos.y);
    if (engine === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await page.waitForTimeout(460);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    } else {
        await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            window.__priceTouchTarget = el;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 91, isPrimary: true, clientX: x, clientY: y, button: 0 }));
        }, { x, y });
        await page.waitForTimeout(460);
        await page.evaluate(({ x, y }) => window.__priceTouchTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 91, isPrimary: true, clientX: x, clientY: y, button: 0 })), { x, y });
    }
    const root = page.locator('.vela-price-scale-menu'); await root.waitFor({ state: 'visible' }); await page.waitForTimeout(200);
    return root;
}
const axisPoint = (page, paneKind = 'price', cellId = null) => page.evaluate(({ paneKind, cellId }) => {
    const cell = cellId ? window.__ws.cell(cellId) : window.__ws.active;
    const r = cell.chart.renderer.renderer, rect = r.dataCanvas.getBoundingClientRect();
    const pane = [...r.scene.panes.values()].find(p => p.kind === paneKind);
    return { x: rect.x + r.coords.width + (rect.width - r.coords.width) / 2,
        y: rect.y + pane.bounds.top + pane.bounds.height * 0.55, pane: pane.id, cell: cell.id };
}, { paneKind, cellId });
const measure = (menu) => menu.evaluate(el => {
    const box = n => n.getBoundingClientRect().toJSON();
    const root = el.closest('.vela-ui');
    return { menu: box(el), host: box(root), role: el.getAttribute('role'), label: el.getAttribute('aria-label'),
        radius: getComputedStyle(el).borderRadius, rows: [...el.querySelectorAll(':scope > .vela-menu-item')].map(n => ({ label: n.textContent, height: box(n).height })),
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
        pageOverflow: [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.documentElement.scrollHeight - document.documentElement.clientHeight] };
});
async function close(page, menu) { await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); }
const item = (menu, id) => menu.locator(`.vela-menu-item[data-vei-id="${id}"]`);
try {
    const { context, page } = await boot();
    let p = await axisPoint(page);
    let menu = await hold(context, page, p);
    const first = await measure(menu);
    assert(first.role === 'menu' && first.label === 'Price scale' && first.radius === '0px' && first.menu.width <= 241 && first.menu.height < 500, 'compact, square, named menu rather than a sheet', first);
    assert(first.rows.length >= 9 && first.rows.every(r => r.height >= 43), 'all desktop scale options have touch-sized rows', first.rows);
    assert(first.pageOverflow.every(n => n <= 1), 'menu causes no page overflow', first);
    assert(await page.locator('.vela-psd-list:visible').count() === 0, 'no legacy full-width price drawer');
    await item(menu, 'scale:percent').tap(); await menu.waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('scaleMode')) === 'percent', 'Percent applies to the price scale');
    menu = await hold(context, page, p);
    assert(await item(menu, 'scale:percent').getAttribute('data-checkmark') === '1' && await item(menu, 'scale:percent').getAttribute('role') === 'menuitemradio' && await item(menu, 'scale:percent').getAttribute('aria-checked') === 'true', 'current scale choice is marked and announced on reopen');
    const oldLabels = await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels'));
    await item(menu, 'labels').tap();
    const submenu = page.locator('.vela-price-scale-submenu:visible'); await submenu.waitFor({ state: 'visible' });
    const sub = await measure(submenu);
    assert(sub.menu.left >= sub.host.left - 1 && sub.menu.right <= sub.host.right + 1 && sub.menu.top >= sub.host.top - 1 && sub.menu.bottom <= sub.host.bottom + 1, 'Labels submenu fits the workspace', sub);
    assert(sub.rows.every(r => r.height >= 43), 'nested label options remain touch sized', sub.rows);
    assert(await item(submenu, 'toggle:axisLabels').getAttribute('role') === 'menuitemcheckbox', 'label toggle announces its checked state');
    await item(submenu, 'toggle:axisLabels').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels')) === !oldLabels, 'Labels suboption changes its actual setting');
    await menu.waitFor({ state: 'hidden' });
    menu = await hold(context, page, p);
    const oldLine = await page.evaluate(() => window.__ws.active.chart.renderer.get('currentPriceLine'));
    await item(menu, 'levels').tap();
    const levels = page.locator('.vela-price-scale-submenu:visible'); await levels.waitFor({ state: 'visible' });
    await item(levels, 'toggle:currentPriceLine').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('currentPriceLine')) === !oldLine, 'Levels suboption changes the current-price line');
    await menu.waitFor({ state: 'hidden' });

    // Separate study-pane scale: choose its axis and never change the main pane's scale.
    await page.evaluate(() => {
        const chart = window.__ws.active.chart;
        const vol = chart.panes.list().flatMap(pane => pane.indicators).find(i => i.title === 'Volume');
        chart.panes.moveIndicator(vol.id, { newPane: true });
    });
    await page.waitForTimeout(650);
    p = await axisPoint(page, 'study');
    const scalesBefore = await page.evaluate(() => window.__ws.active.chart.renderer.get('paneScales'));
    menu = await hold(context, page, p);
    await item(menu, 'invert').tap(); await menu.waitFor({ state: 'hidden' });
    const scalesAfter = await page.evaluate(() => window.__ws.active.chart.renderer.get('paneScales'));
    const beforeStudy = scalesBefore.find(v => v.id === p.pane), afterStudy = scalesAfter.find(v => v.id === p.pane);
    const beforeMain = scalesBefore.find(v => v.kind === 'price'), afterMain = scalesAfter.find(v => v.kind === 'price');
    assert(afterStudy?.invert !== beforeStudy?.invert && afterMain?.invert === beforeMain?.invert, 'Invert targets the touched study pane only', { p, scalesBefore, scalesAfter });
    menu = await hold(context, page, p);
    await item(menu, 'scale:indexed').tap(); await menu.waitFor({ state: 'hidden' });
    const indexed = await page.evaluate(() => window.__ws.active.chart.renderer.get('paneScales'));
    assert(indexed.find(v => v.id === p.pane)?.mode === 'indexed' && indexed.find(v => v.kind === 'price')?.mode === beforeMain?.mode, 'Indexed targets the touched pane only', indexed);
    facts.phone = { first, sub, p, scalesBefore, scalesAfter, indexed };
    await context.close();

    // The shared menu change must not break desktop hover, keyboard navigation or
    // checkable semantics. Right-click the actual price axis, not a mock component.
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const desktop = await desktopContext.newPage();
    desktop.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
    await desktop.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await desktop.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    await desktop.evaluate(() => window.__ws.setLayout('1')); await desktop.waitForTimeout(600);
    const dp = await axisPoint(desktop);
    const openDesktop = async () => {
        await desktop.mouse.click(dp.x, dp.y, { button: 'right' });
        const root = desktop.locator('.vela-menu:visible').filter({ has: desktop.locator('[data-vei-id="labels"]') });
        await root.waitFor({ state: 'visible' }); return root;
    };
    let dm = await openDesktop();
    assert(await item(dm, 'scale:regular').getAttribute('role') === 'menuitemradio', 'desktop scale choices retain radio semantics');
    const desktopBefore = await desktop.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels'));
    await item(dm, 'labels').hover();
    let ds = desktop.locator('.vela-menu:visible').filter({ has: desktop.locator('[data-vei-id="toggle:axisLabels"]') });
    await ds.waitFor({ state: 'visible' });
    assert(await item(ds, 'toggle:axisLabels').getAttribute('role') === 'menuitemcheckbox', 'desktop submenu retains checkbox semantics');
    await item(ds, 'toggle:axisLabels').click();
    assert(await desktop.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels')) === !desktopBefore, 'desktop hover and click select the nested setting');
    await dm.waitFor({ state: 'hidden' });
    dm = await openDesktop();
    await dm.focus(); await desktop.keyboard.press('Home');
    for (let i = 0; i < 7; i++) await desktop.keyboard.press('ArrowDown');
    assert((await dm.getAttribute('aria-activedescendant'))?.includes('--levels:trigger'), 'keyboard reaches Levels through menu roving highlight');
    await desktop.keyboard.press('ArrowRight');
    ds = desktop.locator('.vela-menu:visible').filter({ has: desktop.locator('[data-vei-id="toggle:currentPriceLine"]') });
    await ds.waitFor({ state: 'visible' });
    await ds.focus(); await desktop.keyboard.press('ArrowLeft'); await ds.waitFor({ state: 'hidden' });
    await desktop.keyboard.press('Escape'); await dm.waitFor({ state: 'hidden' });
    facts.desktop = { hovered: true, keyboard: true, labelsBefore: desktopBefore };
    await desktopContext.close();

    // A small embedded host forces internal scrolling and nested repositioning.
    const embedded = await boot({ width: 800, height: 700 });
    await embedded.page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
    await embedded.page.waitForFunction(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
    await embedded.page.waitForTimeout(500);
    const ep = await axisPoint(embedded.page);
    const em = await hold(embedded.context, embedded.page, ep);
    const embeddedRoot = await measure(em);
    assert(embeddedRoot.menu.left >= embeddedRoot.host.left - 1 && embeddedRoot.menu.right <= embeddedRoot.host.right + 1 && embeddedRoot.menu.top >= embeddedRoot.host.top - 1 && embeddedRoot.menu.bottom <= embeddedRoot.host.bottom + 1, 'compact root menu stays inside embedded workspace', embeddedRoot);
    assert(embeddedRoot.scrollHeight > embeddedRoot.clientHeight, 'short host scrolls its menu instead of expanding the page', embeddedRoot);
    await em.evaluate(el => { el.scrollTop = el.scrollHeight; }); await embedded.page.waitForTimeout(300);
    assert(await em.isVisible(), 'scrolling inside the menu does not dismiss it');
    const branch = item(em, 'labels');
    const branchRect = await branch.boundingBox();
    const scrolledBefore = await em.evaluate(el => el.scrollTop);
    if (engine === 'chromium') {
        const cdp = await embedded.context.newCDPSession(embedded.page);
        const x = Math.round(branchRect.x + branchRect.width * 0.5), y = Math.round(branchRect.y + branchRect.height * 0.5);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
        for (let i = 1; i <= 6; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 8, id: 2 }] });
            await embedded.page.waitForTimeout(15);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
        await embedded.page.waitForTimeout(180);
        assert(await em.evaluate(el => el.scrollTop) < scrolledBefore, 'a touch swipe starting on a submenu trigger scrolls the menu');
    } else {
        // WebKit Playwright has no touch-drag primitive; verify its cancel/move path
        // separately from the real WebKit tap used below (not a physical iOS claim).
        await branch.evaluate(el => {
            const opts = { bubbles: true, pointerType: 'touch', pointerId: 96, isPrimary: true, clientX: 100, clientY: 100 };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientY: 140 }));
            el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientY: 140 }));
        });
        await embedded.page.waitForTimeout(100);
    }
    assert(await embedded.page.locator('.vela-price-scale-submenu:visible').count() === 0, 'a swipe over a branch does not accidentally open its submenu');
    await em.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await item(em, 'labels').tap();
    const es = embedded.page.locator('.vela-price-scale-submenu:visible'); await es.waitFor({ state: 'visible' });
    // Zag/Floating UI computes the submenu position asynchronously after mounting it.
    // Record the first paint as well as the settled geometry, so a failed placement is
    // not confused with the initial pre-placement frame.
    const embeddedSubInitial = await measure(es);
    await embedded.page.waitForTimeout(180);
    const embeddedSub = await measure(es);
    assert(embeddedSub.menu.left >= embeddedSub.host.left - 1 && embeddedSub.menu.right <= embeddedSub.host.right + 1 && embeddedSub.menu.top >= embeddedSub.host.top - 1 && embeddedSub.menu.bottom <= embeddedSub.host.bottom + 1, 'nested menu stays within embedded workspace', embeddedSub);
    assert(embeddedSub.pageOverflow.every(n => n <= 1), 'embedded nested menu never expands the document', embeddedSub);
    await close(embedded.page, em);
    facts.embedded = { root: embeddedRoot, initialSubmenu: embeddedSubInitial, submenu: embeddedSub };
    await embedded.context.close();
    assert(errors.length === 0, 'no uncaught page errors', errors);
    report('price-scale-menu', { engine, ...facts, errors });
} finally { await browser.close(); }
