// Real dock/float interactions in the existing offline workspace, without screenshots.
// SYNC_BROWSER=webkit exercises the same desktop and landscape/portrait paths in WebKit.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = process.env.SYNC_BROWSER === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], warnings = [], facts = {};
let phase = 'boot';

async function boot(viewport, touch = false, editor = false, persist = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
        const detail = `${phase}: ${String(error)}`;
        if (phase === 'embedded' && String(error).includes('ResizeObserver loop completed with undelivered notifications')) warnings.push(detail);
        else errors.push(detail);
    });
    const url = new URL(OFFLINE);
    if (editor) url.searchParams.set('preview', 'editor');
    if (persist) url.searchParams.set('persist', '1');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4 && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
    return { context, page };
}

async function geometry(page) {
    return page.evaluate(() => {
        const rect = (el) => el?.getBoundingClientRect().toJSON() ?? null;
        const panel = (selector) => {
            const el = document.querySelector(selector);
            return el ? { rect: rect(el), header: rect(el.querySelector('.vela-panel-header')), visible: !el.hidden && !!el.getBoundingClientRect().width,
                floating: el.dataset.freeFloating === '1', front: el.dataset.floatingFront === '1', dockFront: el.dataset.dockFront === '1',
                radius: getComputedStyle(el).borderRadius, position: getComputedStyle(el).position,
                toggleDisplay: getComputedStyle(el.querySelector('.vela-panel-dock-toggle')).display,
                z: getComputedStyle(el).zIndex } : null;
        };
        const v = window.visualViewport;
        return { layout: document.querySelector('.vela-workspace').dataset.layout, host: rect(document.querySelector('.vela-ws-main')),
            grid: rect(document.querySelector('.vela-ws-grid')), tree: panel('.vela-ot'), data: panel('.vela-dw'),
            alerts: panel('.vela-ap'), pine: panel('.vela-pe'), tester: panel('.vela-st'),
            state: window.__ws.getState().panels ?? null,
            visual: { left: v.offsetLeft, top: v.offsetTop, right: v.offsetLeft + v.width, bottom: v.offsetTop + v.height } };
    });
}

function inside(rect, bound, tolerance = 1.5) {
    return rect.left >= bound.left - tolerance && rect.top >= bound.top - tolerance &&
        rect.right <= bound.right + tolerance && rect.bottom <= bound.bottom + tolerance;
}

async function drag(page, locator, dx, dy) {
    const r = await locator.boundingBox();
    if (!r) throw new Error('Missing drag target');
    const x = r.x + Math.min(r.width / 2, 30), y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(100);
}

async function visualViewport(page, size) {
    await page.evaluate((next) => {
        const v = window.visualViewport;
        for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) {
            if (next) Object.defineProperty(v, key, { configurable: true, value: next[key] });
            else delete v[key];
        }
        v.dispatchEvent(new Event('resize'));
        v.dispatchEvent(new Event('scroll'));
    }, size);
    await page.waitForTimeout(180);
}

try {
    {
        phase = 'desktop';
        const { context, page } = await boot({ width: 1440, height: 900 });
        await page.waitForTimeout(500); // baseline history after workspace boot
        await page.locator('.vela-widget-panel-objects').click();
        const tree = page.locator('.vela-panel.vela-ot');
        await tree.waitFor({ state: 'visible' });
        await page.waitForTimeout(200);
        await page.evaluate(() => window.__ws.undo());
        await page.waitForTimeout(200);
        assert(!await tree.isVisible(), 'undo of the first panel opening restores the empty dock');
        await page.evaluate(() => window.__ws.redo());
        await tree.waitFor({ state: 'visible' });
        await page.waitForTimeout(200);
        const original = await geometry(page);
        const toggle = tree.locator('.vela-panel-dock-toggle');
        const button = await toggle.evaluate((el) => ({ name: el.getAttribute('aria-label'), next: el.nextElementSibling?.className,
            mask: getComputedStyle(el.firstElementChild).maskImage, size: el.getBoundingClientRect().toJSON() }));
        assert(button.name === 'Float panel' && button.next === 'vela-panel-close' && button.mask !== 'none' && button.size.width >= 24,
            'an accessible masked Float button sits immediately next to Close', button);
        await toggle.hover();
        await page.locator('.vela-tooltip[data-state="open"]').waitFor({ state: 'visible', timeout: 3000 });
        assert((await page.locator('.vela-tooltip[data-state="open"]').innerText()).includes('Float panel'), 'Float uses the themed tooltip');
        await page.evaluate(() => { window.__treeNode = document.querySelector('.vela-ot'); });
        await toggle.click();
        await page.waitForTimeout(200);
        await page.evaluate(() => window.__ws.undo());
        await page.waitForTimeout(200);
        assert(!(await geometry(page)).tree.floating, 'undo restores the docked mode');
        await page.evaluate(() => window.__ws.redo());
        await page.waitForTimeout(200);
        const floated = await geometry(page);
        assert(floated.tree.visible && floated.tree.floating && floated.tree.position === 'absolute' && floated.tree.radius === '0px' &&
            floated.grid.width > original.grid.width + 250 && inside(floated.tree.rect, floated.host),
        'floating the square panel returns its column to the chart and stays inside the host', { original, floated });
        assert(await toggle.getAttribute('aria-label') === 'Dock panel beside chart' &&
            await page.evaluate(() => window.__treeNode === document.querySelector('.vela-ot')),
        'the same mounted panel and button now offer Dock');
        const beforeDrag = floated.tree.rect;
        await drag(page, tree.locator('.vela-panel-title'), -120, -75);
        const dragged = await geometry(page);
        assert(dragged.tree.rect.x < beforeDrag.x - 90 && dragged.tree.rect.y < beforeDrag.y - 50 &&
            Math.abs(dragged.tree.rect.width - beforeDrag.width) < 2 && inside(dragged.tree.rect, dragged.host),
        'dragging the floating title changes position without resizing', { beforeDrag, dragged });
        const corner = tree.locator('.vela-panel-corner-resize');
        const beforeWidth = dragged.tree.rect;
        assert(!await tree.locator('.vela-panel-resizer').isVisible() && !await tree.locator('.vela-panel-grip').isVisible(),
            'the floating card has no separate width seam or top height strip');
        await drag(page, corner, 60, 0);
        const widened = await geometry(page);
        assert(widened.tree.rect.width > beforeWidth.width + 40 && Math.abs(widened.tree.rect.left - beforeWidth.left) < 3,
            'the floating resize button follows the pointer and keeps the left edge stable', { beforeWidth, widened });
        await page.evaluate(() => window.__ws.undo());
        await page.waitForTimeout(200);
        const widthUndone = await geometry(page);
        assert(Math.abs(widthUndone.tree.rect.width - beforeWidth.width) < 2 && Math.abs(widthUndone.tree.rect.x - beforeWidth.x) < 2,
            'undo restores the default width and previous position', widthUndone);
        await page.evaluate(() => window.__ws.redo());
        await page.waitForTimeout(200);
        const widthRedone = await geometry(page);
        assert(Math.abs(widthRedone.tree.rect.width - widened.tree.rect.width) < 2 && Math.abs(widthRedone.tree.rect.x - widened.tree.rect.x) < 2,
            'redo reapplies the floating width and position', widthRedone);
        const beforeHeight = widthRedone.tree.rect;
        await drag(page, corner, 0, 55);
        const shortened = await geometry(page);
        assert(shortened.tree.rect.height < beforeHeight.height - 35 && Math.abs(shortened.tree.rect.bottom - beforeHeight.bottom) < 3,
            'the floating resize button changes height while keeping the bottom stable', { beforeHeight, shortened });
        await tree.locator('.vela-panel-title').click({ button: 'right' });
        const position = tree.locator('.vela-panel-position-control');
        await position.waitFor({ state: 'visible' });
        const slider = position.locator('[aria-label="Panel left position"]');
        const track = await slider.boundingBox();
        const beforeClickMove = await tree.boundingBox();
        await page.mouse.click(track.x + track.width * 0.18, track.y + track.height / 2);
        await page.waitForTimeout(100);
        const afterClickMove = await tree.boundingBox();
        assert(Math.abs(afterClickMove.x - beforeClickMove.x) > 50, 'the context position control moves by a single track click', { beforeClickMove, afterClickMove });
        await position.locator('[aria-label="Close position controls"]').click();
        await tree.locator('.vela-panel-header').focus();
        const keyBefore = await tree.boundingBox();
        await page.keyboard.press('ArrowRight');
        const keyAfter = await tree.boundingBox();
        assert(keyAfter.x >= keyBefore.x + 12, 'keyboard arrows move the focused floating header', { keyBefore, keyAfter });
        await page.keyboard.press('Shift+F10');
        await position.waitFor({ state: 'visible' });
        assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Panel left position',
            'keyboard context menu focuses the non-drag position control');
        // Escape dismisses an open shared tooltip first; let the previous mouse hover's
        // bridge settle so this assertion isolates the keyboard position control.
        await page.mouse.move(5, 5);
        await page.waitForTimeout(350);
        await page.keyboard.press('Escape');
        await position.waitFor({ state: 'detached', timeout: 3000 });
        assert(await position.count() === 0, 'Escape closes the position controls');

        await page.locator('.vela-widget-panel-dataWindow').click();
        const data = page.locator('.vela-panel.vela-dw');
        await data.waitFor({ state: 'visible' });
        const sideAndFloat = await geometry(page);
        assert(sideAndFloat.tree.visible && sideAndFloat.tree.floating && sideAndFloat.data.visible && !sideAndFloat.data.floating && sideAndFloat.data.dockFront,
            'opening a docked panel keeps the first floating panel live and raises the new dock', sideAndFloat);
        await data.getByRole('tab', { name: 'Table', exact: true }).click();
        await page.evaluate(() => { window.__dataNode = document.querySelector('.vela-dw'); });
        await data.locator('.vela-panel-dock-toggle').click();
        const floats = await geometry(page);
        assert(floats.tree.visible && floats.data.visible && floats.tree.floating && floats.data.floating &&
            Math.abs(floats.tree.rect.y - floats.data.rect.y) > 25 && floats.grid.width > sideAndFloat.grid.width + 200,
        'two floating panels coexist with staggered titles and the chart recovers the side column', { sideAndFloat, floats });
        assert(await data.getByRole('tab', { name: 'Table', exact: true }).getAttribute('aria-selected') === 'true' &&
            await page.evaluate(() => window.__dataNode === document.querySelector('.vela-dw')),
        'switching placement preserves the selected data tab and DOM');
        await page.locator('.vela-widget-alerts').click();
        const alerts = page.locator('.vela-panel.vela-ap');
        await alerts.waitFor({ state: 'visible' });
        const three = await geometry(page);
        assert(three.tree.visible && three.data.visible && three.alerts.visible && !three.alerts.floating && three.alerts.dockFront,
            'two floating windows and one side dock remain open together', three);
        assert(await page.locator('.vela-widget-panel-objects').getAttribute('aria-pressed') === 'true' &&
            await page.locator('.vela-widget-panel-dataWindow').getAttribute('aria-pressed') === 'true' &&
            await page.locator('.vela-widget-alerts').getAttribute('aria-pressed') === 'true',
        'each open panel keeps its own active topbar state');
        assert(await alerts.locator('.vela-panel-dock-toggle').isVisible(), 'the raised side panel toggle remains usable');
        await alerts.locator('.vela-ap-create-view').getByLabel('Alert level').fill('123.45');
        await page.evaluate(() => { window.__alertInput = document.querySelector('.vela-ap-create-view .vela-ac-input'); });
        await alerts.locator('.vela-panel-dock-toggle').click();
        await alerts.locator('.vela-panel-dock-toggle').click();
        assert(await alerts.locator('.vela-ap-create-view').getByLabel('Alert level').inputValue() === '123.45' &&
            await page.evaluate(() => window.__alertInput === document.querySelector('.vela-ap-create-view .vela-ac-input')),
        'a partly filled Alerts form survives a float and dock round trip');
        await data.locator('.vela-panel-title').click();
        const raised = await geometry(page);
        assert(raised.data.front && !raised.alerts.dockFront, 'clicking a floating title raises it without remounting');
        await tree.locator('.vela-panel-dock-toggle').click();
        const redocked = await geometry(page);
        assert(redocked.tree.visible && !redocked.tree.floating && redocked.data.visible && redocked.data.floating && !redocked.alerts.visible &&
            Math.abs(redocked.tree.rect.height - redocked.host.height) < 2,
        'Dock returns to the chart side and replaces only the previous dock, leaving other floats', redocked);
        await data.getByRole('tab', { name: 'Data', exact: true }).click();
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        await page.waitForTimeout(200);
        assert((await data.locator('.vela-dw-symbol').innerText()).includes('BBB'), 'a floating Data Window still follows the active chart');
        const saved = await page.evaluate(() => structuredClone(window.__ws.getState().panels));
        await data.locator('.vela-panel-close').click();
        assert(!await data.isVisible() && await tree.isVisible(), 'closing one floating window does not close the dock');
        await page.evaluate((state) => window.__ws.dock.applyState(state), saved);
        const restored = await geometry(page);
        assert(restored.data.visible && restored.data.floating && restored.tree.visible && !restored.tree.floating && restored.tree.dockFront &&
            restored.state.floatingOpen.includes('dataWindow') && restored.state.floatPositions.dataWindow,
        'saved mode, open windows and positions restore through the real dock state', restored);
        await page.locator('.vela-bb-settings').click();
        const settings = page.locator('.vela-dialog--settings');
        await settings.waitFor({ state: 'visible' });
        await settings.locator('.vela-color-field:visible').first().click();
        const palette = page.locator('.vela-color-field-pop');
        await palette.waitFor({ state: 'visible' });
        await palette.locator('.vela-color-palette button[data-c]').first().click();
        assert(await settings.isVisible() && await data.isVisible(), 'Settings and its color popover remain interactive above floating panels');
        await settings.locator('.vela-dialog-close').click();
        assert(await data.isVisible() && await tree.isVisible(), 'closing Settings keeps the panel arrangement open');
        await page.setViewportSize({ width: 900, height: 600 });
        await page.waitForTimeout(250);
        const smaller = await geometry(page);
        assert(smaller.data.visible && inside(smaller.data.rect, smaller.host) && inside(smaller.data.rect, smaller.visual),
            'a desktop resize keeps the floating card in its visible host', smaller);
        await visualViewport(page, { offsetLeft: 80, offsetTop: 50, width: 560, height: 320 });
        const zoomed = await geometry(page);
        assert(inside(zoomed.data.header, zoomed.host) && inside(zoomed.data.header, zoomed.visual),
            'a shortened visual viewport keeps the whole floating header reachable without changing saved position', zoomed);
        assert(JSON.stringify(zoomed.state.floatPositions.dataWindow) === JSON.stringify(smaller.state.floatPositions.dataWindow),
            'viewport-only clamping does not overwrite the remembered position');
        await visualViewport(page, null);
        const recovered = await geometry(page);
        assert(Math.abs(recovered.data.rect.left - smaller.data.rect.left) < 3 && Math.abs(recovered.data.rect.top - smaller.data.rect.top) < 3,
            'the preferred position recovers after the viewport expands', { smaller, recovered });
        facts.desktop = { button, original: original.tree.rect, floated: floated.tree.rect, dragged: dragged.tree.rect,
            widened: widened.tree.rect, shortened: shortened.tree.rect, floats: [floats.tree.rect, floats.data.rect], redocked: redocked.state, smaller: smaller.data.rect };
        await context.close();
    }

    {
        phase = 'rotation';
        const { context, page } = await boot({ width: 780, height: 390 }, true);
        await page.locator('.vela-widget-panel-objects').tap();
        await page.locator('.vela-ot .vela-panel-dock-toggle').tap();
        await page.locator('.vela-widget-panel-dataWindow').tap();
        await page.locator('.vela-dw .vela-panel-dock-toggle').tap();
        await page.locator('.vela-widget-alerts').tap();
        const landscape = await geometry(page);
        assert(landscape.layout === 'desktop' && landscape.tree.visible && landscape.data.visible && landscape.alerts.visible,
            'landscape can show two cards and a dock', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.waitForTimeout(200);
        const portrait = await geometry(page);
        assert(portrait.alerts.visible && !portrait.tree.visible && !portrait.data.visible && portrait.alerts.toggleDisplay === 'none' &&
            Math.abs(portrait.alerts.rect.width - portrait.host.width) < 2 && Math.abs(portrait.alerts.rect.bottom - portrait.host.bottom) < 2 &&
            portrait.state.floatingOpen.length === 2,
        'portrait keeps one full-width bottom pane while suspending desktop floats', portrait);
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(200);
        const rotatedBack = await geometry(page);
        assert(rotatedBack.tree.visible && rotatedBack.data.visible && rotatedBack.alerts.visible && rotatedBack.alerts.dockFront,
            'rotation back restores both floats and an actionable dock', rotatedBack);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.locator('.vela-mb-more').tap();
        await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Data window' }).tap();
        await page.locator('.vela-dw').waitFor({ state: 'visible' });
        const selectedOnPhone = await geometry(page);
        assert(selectedOnPhone.data.visible && !selectedOnPhone.alerts.visible && !selectedOnPhone.tree.visible && selectedOnPhone.state.floatingOpen.length === 2,
            'selecting a suspended floating panel on phone still keeps one pane visible', selectedOnPhone);
        await page.locator('.vela-dw .vela-panel-close').tap();
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(200);
        const afterClose = await geometry(page);
        assert(afterClose.tree.visible && !afterClose.data.visible && afterClose.state.floatingOpen.includes('objects') &&
            !afterClose.state.floatingOpen.includes('dataWindow'),
        'a panel explicitly closed on phone is not resurrected on return', afterClose);
        facts.rotation = { landscape: landscape.state, portrait: portrait.alerts.rect, restored: rotatedBack.state, afterClose: afterClose.state };
        await context.close();
    }

    {
        phase = 'persisted-mobile-boot';
        const { context, page } = await boot({ width: 780, height: 390 }, true, false, true);
        await page.locator('.vela-widget-panel-objects').tap();
        await page.locator('.vela-ot .vela-panel-dock-toggle').tap();
        await page.locator('.vela-widget-panel-dataWindow').tap();
        await page.locator('.vela-dw .vela-panel-dock-toggle').tap();
        await page.locator('.vela-widget-alerts').tap();
        await page.waitForFunction(() => {
            const raw = localStorage.getItem('vela-offline-panel-test');
            const state = raw && JSON.parse(raw).panels;
            return state?.open === 'alerts' && state?.floatingOpen?.length === 2;
        }, null, { timeout: 10000 });
        await page.setViewportSize({ width: 390, height: 780 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length === 4 && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
        const firstPhone = await geometry(page);
        assert(firstPhone.layout === 'mobile' && firstPhone.alerts.visible && !firstPhone.tree.visible && !firstPhone.data.visible &&
            firstPhone.state.floatingOpen.length === 2,
        'a synchronously restored phone boots with one pane, not overlapping desktop floats', firstPhone);
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(200);
        const restoredDesktop = await geometry(page);
        assert(restoredDesktop.alerts.visible && restoredDesktop.tree.visible && restoredDesktop.data.visible &&
            restoredDesktop.tree.floating && restoredDesktop.data.floating,
        'desktop cards return after a phone-first persistent boot', restoredDesktop);
        facts.persistedBoot = { phone: firstPhone.state, desktop: restoredDesktop.state };
        await context.close();
    }

    {
        phase = 'embedded';
        const { context, page } = await boot({ width: 1280, height: 800 });
        await page.locator('#workspace').evaluate((el) => Object.assign(el.style,
            { left: '150px', top: '80px', right: 'auto', bottom: 'auto', width: '820px', height: '550px' }));
        await page.waitForTimeout(250);
        await page.locator('.vela-widget-panel-dataWindow').click();
        const data = page.locator('.vela-panel.vela-dw');
        await data.locator('.vela-panel-dock-toggle').click();
        const before = await geometry(page);
        await drag(page, data.locator('.vela-panel-title'), -900, -600);
        const constrained = await geometry(page);
        assert(before.layout === 'desktop' && before.host.x >= 149 && before.host.width === 820 && inside(constrained.data.rect, constrained.host) &&
            Math.abs(constrained.data.rect.left - constrained.host.left) <= 5 && Math.abs(constrained.data.rect.top - constrained.host.top) <= 5,
        'an embedded card uses its offset host, not the full browser window, as drag bounds', { before, constrained });
        await page.locator('#workspace').evaluate((el) => { el.style.width = '660px'; el.style.height = '340px'; });
        await page.waitForTimeout(250);
        const narrowed = await geometry(page);
        assert(narrowed.layout === 'desktop' && narrowed.data.visible && inside(narrowed.data.rect, narrowed.host),
            'a resized but desktop-width embedded workspace clamps its floating card', narrowed);
        await page.locator('#workspace').evaluate((el) => { el.style.width = '520px'; el.style.height = '600px'; });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        const phone = await geometry(page);
        assert(phone.data.visible && phone.data.toggleDisplay === 'none' && Math.abs(phone.data.rect.width - phone.host.width) < 2,
            'a narrow embedded workspace presents the floating card as a phone pane', phone);
        await page.locator('#workspace').evaluate((el) => { el.style.width = '820px'; el.style.height = '550px'; });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(200);
        const expanded = await geometry(page);
        assert(expanded.data.visible && expanded.data.floating && inside(expanded.data.rect, expanded.host),
            'widening the embedded host restores the floating mode', expanded);
        facts.embedded = { before: before.host, constrained: constrained.data.rect, narrowed: narrowed.data.rect, phone: phone.data.rect, expanded: expanded.data.rect };
        await page.evaluate(() => window.__ws.destroy());
        await context.close();
    }

    {
        phase = 'pine';
        const { context, page } = await boot({ width: 1440, height: 900 }, false, true);
        const pine = page.locator('.vela-panel.vela-pe');
        await pine.locator('.monaco-editor').waitFor({ state: 'visible', timeout: 60000 });
        const code = '//@version=6\nindicator("Float draft")\nplot(close)';
        await pine.locator('.view-lines').click({ position: { x: 120, y: 25 } });
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(code);
        await page.waitForTimeout(180);
        const draftBefore = await page.evaluate(() => {
            const library = JSON.parse(localStorage.getItem('vela-pine-library'));
            return library.scripts.find((script) => script.id === library.activeId)?.code;
        });
        assert(draftBefore?.includes('Float draft'), 'the Pine draft was actually edited before moving the panel', draftBefore);
        await page.evaluate(() => { window.__pineEditorNode = document.querySelector('.vela-pe .monaco-editor'); });
        await pine.locator('.vela-panel-dock-toggle').click();
        await page.locator('.vela-widget-panel-strategyTester').click();
        const current = await geometry(page);
        const draft = await page.evaluate(() => {
            const library = JSON.parse(localStorage.getItem('vela-pine-library'));
            return library.scripts.find((script) => script.id === library.activeId)?.code;
        });
        assert(current.pine.visible && current.pine.floating && current.tester.visible && draft === draftBefore &&
            await page.evaluate(() => window.__pineEditorNode === document.querySelector('.vela-pe .monaco-editor')),
        'the Monaco draft and editor instance survive floating while another panel opens', { current, draft });
        await pine.locator('.vela-panel-dock-toggle').click();
        assert(await pine.isVisible() && !await page.locator('.vela-st').isVisible() &&
            await page.evaluate(() => window.__pineEditorNode === document.querySelector('.vela-pe .monaco-editor')),
        'redocking Pine preserves Monaco and replaces the docked strategy tester');
        facts.pine = { savedDraft: draft, floated: current.pine.rect };
        await context.close();
    }

    phase = 'done';
    assert(errors.length === 0, 'no browser page errors', errors);
    report('floating-side-panels', { browser: process.env.SYNC_BROWSER || 'chromium', ...facts, errors, warnings });
} finally { await browser.close(); }
