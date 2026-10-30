import { chooseAlertOption } from './helpers.mjs';
// Build the actual standalone artifact and boot it through file:// with all HTTP and
// WebSocket access blocked. No screenshots, mock pages or live market data are required.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { assert, report } from './helpers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, ['tools/build-single-file.mjs'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
const contrast = (a, b) => {
    const luminance = (rgb) => {
        const [r, g, bl] = rgb.map((n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * r + .7152 * g + .0722 * bl;
    };
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const colorOf = async (locator) => locator.evaluate((el) => {
    const style = getComputedStyle(el), ctx = document.createElement('canvas').getContext('2d');
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    return { text: el.textContent, fg: rgb(style.color), bg: rgb(style.backgroundColor), filter: style.filter, hidden: el.hidden };
});
let blocked = 0;
await context.route('**/*', (route) => {
    if (/^https?:/.test(route.request().url())) { blocked += 1; void route.abort(); }
    else void route.continue();
});
if (context.routeWebSocket) await context.routeWebSocket('wss://**', (ws) => { blocked += 1; ws.close(); });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const sameBox = (a, b) => !!a && !!b && ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < 3);
const dragPhone = async (locator, dy, point) => {
    const r = await locator.boundingBox();
    if (!r) throw new Error('Missing phone gesture target');
    const x = r.x + (point?.x ?? r.width / 2), y = r.y + (point?.y ?? r.height / 2);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8, id: 1 }] });
        await page.waitForTimeout(18);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach(); await page.waitForTimeout(550);
};
try {
    await page.goto(pathToFileURL(resolve(root, 'single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const boot = await page.evaluate(() => ({ mode: document.querySelector('.vela-workspace')?.dataset.layout, charts: window.__ws.cells().length, overflow: document.documentElement.scrollWidth - innerWidth }));
    assert(boot.mode === 'mobile' && boot.charts === 1 && boot.overflow <= 0, 'standalone boots one portrait chart offline', boot);

    // Verify the shipped HTML, not only the Vite source: touch-resize settings and edit
    // the actual crosshair through the bundled color/opacity picker while offline.
    await page.locator('.vela-mb-settings').tap();
    const settings = page.locator('.vela-dialog--settings');
    await settings.waitFor({ state: 'visible' });
    await page.waitForTimeout(250); // opening transform must finish before comparing geometry
    const settingsBefore = await settings.boundingBox();
    const settingsGrip = await settings.locator('.vela-sd-pane-grip').boundingBox();
    const settingsCdp = await context.newCDPSession(page);
    const sx = settingsGrip.x + settingsGrip.width / 2, sy = settingsGrip.y + settingsGrip.height / 2;
    await settingsCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 8; i++) await settingsCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 100 * i / 8 }] });
    await settingsCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settingsCdp.detach();
    // Allow Chromium's synthetic touch-drag gesture to finish before a separate tap.
    await page.waitForTimeout(700);
    const settingsAfter = await settings.boundingBox();
    const settingsShape = await settings.evaluate((el) => ({ radius: getComputedStyle(el).borderRadius, modal: el.getAttribute('aria-modal'),
        footer: !!el.querySelector('.vela-dialog-footer'), headerTemplate: !!el.querySelector('.vela-dialog-header .vela-sd-tplbtn'),
        templateHeight: el.querySelector('.vela-sd-tplbtn')?.getBoundingClientRect().height }));
    assert(settingsAfter.height > settingsBefore.height + 75 && Math.abs(settingsAfter.y + settingsAfter.height - settingsBefore.y - settingsBefore.height) < 3
        && settingsShape.radius === '0px' && settingsShape.modal === 'false' && !settingsShape.footer && settingsShape.headerTemplate && settingsShape.templateHeight >= 44,
    'standalone phone settings is a square, touch-resizable pane with compact header actions and no fixed footer', { settingsBefore, settingsAfter, settingsShape });
    const settingsShell = await settings.evaluate((el) => {
        const grip = el.querySelector('.vela-sd-pane-grip'), close = el.querySelector('.vela-dialog-close');
        return { aboveHeader: grip.parentElement === el && grip.nextElementSibling === el.querySelector('.vela-dialog-header') && Math.abs(grip.getBoundingClientRect().bottom - el.querySelector('.vela-dialog-header').getBoundingClientRect().top) < 2, maxBeforeClose: close.previousElementSibling?.classList.contains('vela-dialog-max') };
    });
    assert(settingsShell.aboveHeader && settingsShell.maxBeforeClose, 'standalone phone Settings has a separate resize strip above its header and fullscreen beside Close', settingsShell);
    await dragPhone(settings.locator('.vela-dialog-title'), -75);
    assert(sameBox(await settings.boundingBox(), settingsAfter), 'standalone phone Settings heading does not detach or resize the pane');
    await dragPhone(settings.locator('.vela-dialog-max'), -65);
    assert(sameBox(await settings.boundingBox(), settingsAfter) && await settings.getAttribute('data-maximized') === null,
        'dragging the standalone fullscreen button does not move or activate Settings');
    await settings.locator('.vela-sd-pane-grip').tap();
    assert(await settings.locator('.vela-panel-height-control').count() === 0, 'standalone grip tap opens no height popup');
    const settingsMax = settings.locator('.vela-dialog-max');
    await settingsMax.tap(); const settingsFull = await settings.boundingBox();
    assert(Math.abs(settingsFull.x) < 2 && Math.abs(settingsFull.y) < 2 && Math.abs(settingsFull.width - 390) < 2 && Math.abs(settingsFull.height - 780) < 2,
        'standalone phone Settings fullscreen fills the workspace', settingsFull);
    await settingsMax.tap(); const settingsRestored = await settings.boundingBox();
    assert(Math.abs(settingsRestored.x - settingsAfter.x) < 3 && Math.abs(settingsRestored.y - settingsAfter.y) < 3 &&
        Math.abs(settingsRestored.width - settingsAfter.width) < 3 && Math.abs(settingsRestored.height - settingsAfter.height) < 3,
    'standalone Settings restores the prior size and position', { settingsAfter, settingsRestored });
    await settings.locator('.vela-sd-burger').tap();
    await page.getByRole('button', { name: 'Crosshair', exact: true }).tap();
    await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').tap();
    const colorPicker = page.locator('.vela-color-field-pop');
    const pickerRadius = await colorPicker.evaluate((el) => getComputedStyle(el).borderRadius);
    await colorPicker.locator('[aria-label="Opacity percentage"]').fill('45');
    await colorPicker.locator('[aria-label="Opacity percentage"]').press('Enter');
    await colorPicker.locator('button[data-c="#33adeb"]').tap();
    const bundledCrosshair = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair);
    assert(pickerRadius === '0px' && bundledCrosshair.color === '#33adeb' && Math.abs(bundledCrosshair.opacity - .45) < .005,
        'standalone square color picker changes crosshair hue and opacity', { pickerRadius, bundledCrosshair });
    const bundledColorPanel = await colorPicker.evaluate((el) => {
        const recent = el.querySelector('[aria-label="Recent colors"]');
        return { recent: recent.querySelector('button')?.getAttribute('aria-label'), text: recent.parentElement.textContent,
            custom: el.querySelector('input[type=color]')?.getAttribute('aria-label'), palette: el.querySelectorAll('.vela-color-palette button').length,
            rect: el.getBoundingClientRect().toJSON() };
    });
    assert(bundledColorPanel.recent === 'Recent color #33adeb' && !bundledColorPanel.text.includes('+') &&
        bundledColorPanel.custom === 'Custom color' && bundledColorPanel.palette === 80 && bundledColorPanel.rect.width <= 250.1,
    'standalone immediately collects recent colors without a separate plus and keeps the custom editor', bundledColorPanel);
    await page.evaluate(() => {
        for (const [key, value] of Object.entries({ offsetLeft: 80, offsetTop: 25, width: 190, height: 150 }))
            Object.defineProperty(visualViewport, key, { configurable: true, value });
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(100);
    const bundledViewport = await colorPicker.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(),
        left: visualViewport.offsetLeft, top: visualViewport.offsetTop, right: visualViewport.offsetLeft + visualViewport.width,
        bottom: visualViewport.offsetTop + visualViewport.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    assert(bundledViewport.rect.left >= bundledViewport.left && bundledViewport.rect.top >= bundledViewport.top &&
        bundledViewport.rect.right <= bundledViewport.right && bundledViewport.rect.bottom <= bundledViewport.bottom &&
        bundledViewport.scrollHeight > bundledViewport.clientHeight, 'standalone picker fits and scrolls in a shortened visible viewport', bundledViewport);
    await page.evaluate(() => {
        for (const key of ['offsetLeft', 'offsetTop', 'width', 'height']) delete visualViewport[key];
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await settings.locator('.vela-dialog-close').tap();
    await page.waitForTimeout(200);

    await page.locator('.vela-mb-more').tap();
    const moreDrawer = page.locator('.vela-more-panel:visible');
    await moreDrawer.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
    const moreBefore = await moreDrawer.boundingBox();
    assert(await moreDrawer.getAttribute('role') === 'region' && await moreDrawer.getAttribute('aria-label') === 'More'
        && await moreDrawer.locator('.vela-md-search').count() === 0 && await moreDrawer.locator('.vela-panel-max').isVisible(),
        'standalone More is the unfiltered standard pane with fullscreen control');
    await moreDrawer.locator('.vela-panel-max').tap();
    assert(await moreDrawer.getAttribute('data-maximized') !== null, 'standalone More maximizes');
    await moreDrawer.locator('.vela-panel-max').tap();
    assert(await moreDrawer.getAttribute('data-maximized') === null, 'standalone More restores');
    await page.waitForTimeout(250);
    await dragPhone(moreDrawer.locator('.vela-panel-header'), -70, { x: 10, y: 12 });
    assert(sameBox(await moreDrawer.boundingBox(), moreBefore), 'standalone More heading does not detach the pane');
    const moreStrip = await moreDrawer.evaluate((el) => {
        const grip = el.querySelector('.vela-panel-grip'), head = el.querySelector('.vela-panel-header');
        return grip.parentElement === el && grip.nextElementSibling === head && Math.abs(grip.getBoundingClientRect().bottom - head.getBoundingClientRect().top) < 2;
    });
    assert(moreStrip, 'standalone phone drawer places its resize grip above the heading');
    await page.locator('.vela-md-row', { hasText: 'Object tree' }).tap();
    const tree = page.locator('.vela-panel.vela-ot');
    await tree.waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    const treeStrip = await tree.evaluate((el) => {
        const grip = el.querySelector('.vela-panel-grip'), head = el.querySelector('.vela-panel-header');
        return grip.parentElement === el && grip.nextElementSibling === head && Math.abs(grip.getBoundingClientRect().bottom - head.getBoundingClientRect().top) < 2;
    });
    assert(treeStrip, 'standalone Object Tree has a separate resize strip above the heading');
    const before = await tree.boundingBox(), grip = await tree.locator('.vela-panel-grip').boundingBox();
    const cdp = await context.newCDPSession(page);
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(600);
    const after = await tree.boundingBox();
    assert(after.height > before.height + 55 && Math.abs(after.y + after.height - before.y - before.height) < 3, 'standalone Object Tree resizes continuously with a fixed bottom', { before, after });
    await dragPhone(tree.locator('.vela-panel-title'), -80);
    assert(sameBox(await tree.boundingBox(), after), 'standalone Object Tree heading does not move the phone pane');

    await tree.locator('.vela-panel-close').tap();
    await page.waitForTimeout(250);
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Data window' }).tap();
    const dataWindow = page.locator('.vela-panel.vela-dw');
    await dataWindow.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const empty = await dataWindow.evaluate((el) => ({
        message: el.querySelector('.vela-dw-empty').textContent,
        copyDisabled: el.querySelector('.vela-dw-copy').disabled,
        hold: !!el.querySelector('.vela-dw-hold'),
        max: getComputedStyle(el.querySelector('.vela-panel-max')).display !== 'none',
        sourceHidden: el.querySelector('.vela-dw-source').hidden,
        radius: getComputedStyle(el).borderRadius,
    }));
    assert(['No chart data', 'Loading chart data…'].includes(empty.message) && empty.copyDisabled && !empty.hold && empty.max && empty.sourceHidden && empty.radius === '0px', 'standalone Data Window reports blocked-network data honestly and uses a square pane', empty);
    // Inject explicit deterministic bars into the real standalone chart (no network).
    await page.evaluate(async () => {
        const bars = Array.from({ length: 5 }, (_, i) => ({ time: 1700000000000 + i * 3600000, open: 100 + i, high: 103 + i, low: 99 + i, close: 102 + i, volume: 1000 + i }));
        await window.__ws.active.chart.setMarket({ data: bars });
    });
    await dataWindow.getByRole('tab', { name: 'Table' }).tap();
    await page.waitForTimeout(200);
    const table = await dataWindow.evaluate((el) => {
        const t = el.querySelector('.vela-dw-table'), first = t.querySelector('tbody tr:not(.vela-dw-table-spacer)');
        return { count: t.getAttribute('aria-rowcount'), first: [...first.cells].map((cell) => cell.textContent), time: first.dataset.timestamp, scope: el.querySelector('.vela-dw-table-scope').textContent };
    });
    assert(table.count === '6' && table.time === String(1700000000000 + 4 * 3600000) && Number(table.first[4]) === 106 && table.first[5] === '1004' && table.scope.includes('5 loaded'), 'standalone table renders injected candles newest first', table);
    const beforeNav = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer, vp = r.coords.getViewport();
        return { initial: vp.barSpacing, effective: r.clampViewport(vp.barSpacing, vp.rightOffset).barSpacing };
    });
    await dataWindow.locator('.vela-dw-table tr[data-offset="4"] button').tap();
    await page.waitForTimeout(700);
    const nav = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer, marker = r.plot.querySelector('.vela-candle-locator');
        return { x: r.coords.logicalToX(0), width: r.coords.width, spacing: r.coords.getViewport().barSpacing, timestamp: Number(marker?.dataset.timestamp), visible: marker?.dataset.visible === 'true' };
    });
    assert(nav.timestamp === 1700000000000 && nav.visible && Math.abs(nav.x - nav.width / 2) < 10 && nav.spacing === beforeNav.effective && await dataWindow.isVisible(), 'standalone touch navigation marks the candle at the valid zoom without closing the pane', { beforeNav, nav });
    await dataWindow.locator('.vela-panel-close').tap();
    await page.waitForTimeout(250);

    // Real CDP touch against the delivered renderer and injected candles, with the
    // network blocked: a non-line cursor must still paint and re-grab relatively.
    const touchSetup = await page.evaluate(() => {
        const chart = window.__ws.active.chart, r = chart.renderer.renderer;
        const oldCursor = r.scene.cursorStyle;
        chart.renderer.set('cursorStyle', 'none');
        window.__standaloneTouch = null;
        chart.renderer.onCrosshairMove(e => { window.__standaloneTouch = { time: e.time, price: e.price, ohlc: e.ohlc }; });
        const rect = r.dataCanvas.getBoundingClientRect(), pane = [...r.scene.panes.values()].find(p => p.kind === 'price');
        return { oldCursor, x: rect.x + r.coords.logicalToX(1), y: rect.y + pane.bounds.top + pane.bounds.height * .55,
            axisX: rect.x + r.coords.width + (rect.width - r.coords.width) / 2, axisY: rect.y + pane.bounds.top + pane.bounds.height * .55 };
    });
    const touchCdp = await context.newCDPSession(page);
    const sendTouch = (type, x, y) => touchCdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 7 }],
    });
    const touchSnapshot = () => page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer, ch = r.scene.crosshair;
        const idx = ch ? Math.round(r.coords.xToLogical(ch.x)) : -1;
        const px = r.cursorCanvas.getContext('2d').getImageData(0, 0, r.cursorCanvas.width, r.cursorCanvas.height).data;
        let pixels = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) pixels++;
        return { tracking: r.input.isTracking, ch, bar: r.bars[idx], event: window.__standaloneTouch, pixels, view: r.coords.getViewport(), cursor: r.scene.cursorStyle };
    });
    await sendTouch('touchStart', touchSetup.x, touchSetup.y); await page.waitForTimeout(460); await sendTouch('touchEnd'); await page.waitForTimeout(120);
    const standaloneTracking = await touchSnapshot();
    assert(standaloneTracking.tracking && standaloneTracking.pixels > 500 && standaloneTracking.cursor === 'none'
        && standaloneTracking.event?.time === standaloneTracking.bar?.time && standaloneTracking.event?.ohlc?.close === standaloneTracking.bar?.close,
        'standalone None cursor paints tracking and reads the actual selected candle', standaloneTracking);
    await sendTouch('touchStart', touchSetup.x - 48, touchSetup.y - 24); await page.waitForTimeout(80);
    await sendTouch('touchMove', touchSetup.x - 30, touchSetup.y - 12); await page.waitForTimeout(120);
    const standaloneRegrab = await touchSnapshot();
    assert(Math.abs(standaloneRegrab.ch.x - standaloneTracking.ch.x - 18) < 1 && Math.abs(standaloneRegrab.ch.y - standaloneTracking.ch.y - 12) < 1
        && Math.abs(standaloneRegrab.view.rightOffset - standaloneTracking.view.rightOffset) < 1e-8,
        'standalone re-grab moves relatively without panning', { standaloneTracking, standaloneRegrab });
    await sendTouch('touchEnd');
    await sendTouch('touchStart', touchSetup.x, touchSetup.y); await page.waitForTimeout(35); await sendTouch('touchEnd'); await page.waitForTimeout(100);
    assert(!(await touchSnapshot()).tracking, 'standalone chart tap exits tracking');
    await page.evaluate((old) => window.__ws.active.chart.renderer.set('cursorStyle', old), touchSetup.oldCursor);

    const axisLabels = await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels'));
    await sendTouch('touchStart', touchSetup.axisX, touchSetup.axisY); await page.waitForTimeout(460); await sendTouch('touchEnd');
    const scaleMenu = page.locator('.vela-price-scale-menu:visible'); await scaleMenu.waitFor({ state: 'visible' });
    const scaleSize = await scaleMenu.boundingBox();
    assert(scaleSize.width <= 241 && scaleSize.height < 500 && await page.locator('.vela-psd-list:visible').count() === 0,
        'standalone price hold uses the compact menu instead of the legacy sheet', scaleSize);
    await scaleMenu.locator('[data-vei-id="labels"]').tap();
    const scaleLabels = page.locator('.vela-price-scale-submenu:visible'); await scaleLabels.waitFor({ state: 'visible' });
    assert(await scaleLabels.locator('[data-vei-id="toggle:axisLabels"]').getAttribute('role') === 'menuitemcheckbox', 'standalone nested scale toggle is accessible');
    await scaleLabels.locator('[data-vei-id="toggle:axisLabels"]').tap();
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('axisLabels')) === !axisLabels, 'standalone nested scale option updates the chart');
    await page.evaluate((old) => window.__ws.active.chart.renderer.set('axisLabels', old), axisLabels);
    await touchCdp.detach(); await page.waitForTimeout(200);

    // Open the actual bundled Alerts pane and trigger a price alert on injected bars.
    const alertsButton = page.locator('.vela-mb-alerts');
    assert(await alertsButton.isVisible(), 'standalone has a visible phone Alerts entry');
    await alertsButton.tap();
    const alertPane = page.locator('.vela-ap:visible');
    await alertPane.waitFor({ state: 'visible' });
    const alertShell = await alertPane.evaluate((el) => ({ standard: el.dataset.standardPane, radius: getComputedStyle(el).borderRadius,
        max: getComputedStyle(el.querySelector('.vela-panel-max')).display !== 'none', width: el.getBoundingClientRect().width,
        tabs: [...el.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-label') || tab.textContent.trim()),
        level: Number(el.querySelector('.vela-ac-input').value) }));
    assert(alertShell.standard === '1' && alertShell.radius === '0px' && alertShell.max && alertShell.width === 390
        && alertShell.tabs.join(',') === 'Create,Alerts,Log' && alertShell.level === 106, 'standalone Alerts uses a real, accurate three-tab phone pane', alertShell);
    const buttonInk = await alertPane.locator('.vela-ac-create').evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    assert(buttonInk.color !== buttonInk.background, 'bundled Create button has visible text and fill', buttonInk);
    await chooseAlertOption(alertPane.locator('.vela-ac-select'), 'cross-up');
    await alertPane.getByLabel('Alert level').fill('107');
    await alertPane.locator('.vela-ac-create').tap();
    await alertPane.getByRole('tab', { name: /^Alerts/ }).tap();
    await alertPane.getByRole('button', { name: /^Pause alert/ }).tap();
    const alertTick = async (close) => page.evaluate((close) => { const c = window.__ws.active.chart, last = c.lastBar; c.orchestrator.applyBar({ time: last.time + 3600000, open: close, high: close + 1, low: close - 1, close, volume: 10 }); }, close);
    await alertTick(108);
    assert((await page.evaluate(() => window.__ws.getState().priceAlerts[0].state)) === 'paused' && (await page.evaluate(() => window.__ws.alertEntries().length)) === 0,
        'standalone pause suppresses an offline crossing');
    await page.waitForTimeout(250);
    await alertPane.getByRole('button', { name: /^Resume alert/ }).tap();
    await alertTick(106); await alertTick(108);
    await page.waitForTimeout(250);
    await alertPane.getByRole('button', { name: /^Edit alert/ }).tap();
    await alertPane.locator('.vela-ap-editor').getByLabel('Alert level').fill('109');
    await alertPane.getByRole('button', { name: 'Save changes' }).tap();
    await page.waitForTimeout(250);
    const savedAlert = await page.evaluate(() => window.__ws.getState().priceAlerts[0]);
    assert(savedAlert.value === 109 && savedAlert.state === 'fired' && savedAlert.fires === 1, 'standalone edit keeps the stopped state and history', savedAlert);
    await alertPane.getByRole('button', { name: /^Re-arm alert/ }).tap();
    await alertTick(110);
    await alertPane.getByRole('tab', { name: /^Log/ }).tap();
    // A touch release can defer repaint briefly to preserve the user's gesture.
    await alertPane.locator('.vela-ap-log-row').first().waitFor({ state: 'visible', timeout: 2000 });
    await page.waitForTimeout(250);
    const standaloneAlerts = await page.evaluate(() => ({ armed: window.__ws.getState().priceAlerts, log: window.__ws.alertEntries(), rows: document.querySelectorAll('.vela-ap-log-row').length }));
    assert(standaloneAlerts.armed[0]?.condition === 'cross-up' && standaloneAlerts.armed[0]?.state === 'fired' && standaloneAlerts.armed[0]?.fires === 2
        && standaloneAlerts.log.length === 2 && standaloneAlerts.rows === 2, 'standalone edit and re-arm trigger and log a new crossing offline', standaloneAlerts);
    const phoneAlertBadges = [];
    for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => window.__ws.setTheme(theme), theme); await page.waitForTimeout(160);
        const badge = await colorOf(page.locator('.vela-mb-alerts .vela-mb-badge'));
        phoneAlertBadges.push({ theme, ...badge });
        assert(badge.text === '2' && !badge.hidden && Math.max(...badge.bg) - Math.min(...badge.bg) > 25
            && contrast(badge.fg, badge.bg) >= 4.5, 'bundled phone alert count is colored and legible', { theme, badge });
    }
    await page.evaluate(() => window.__ws.setTheme('dark'));
    await alertPane.locator('.vela-panel-close').tap();
    await page.waitForTimeout(250);

    // Exercise the real bundled tester with deterministic trades; no broker feed is implied.
    await page.evaluate(() => {
        const ws = window.__ws, chart = ws.active.chart;
        const trades = Array.from({ length: 150 }, (_, i) => ({ id: `offline-${i}`, side: 'long', qty: 1,
            entry: { id: 'E', time: 1700000000000 + i * 7200000, price: 100 + i },
            exit: { id: 'X', time: 1700003600000 + i * 7200000, price: 101 + i }, pnl: 1, open: false }));
        const strategy = { position: 0, avgPrice: 0, equity: 10150, openPnl: 0, netPnl: 150, grossProfit: 150,
            grossLoss: 0, wins: 150, losses: 0, even: 0, maxDrawdown: 0, maxRunup: 0, initialCapital: 10000 };
        ws.strategyTester.setRun(chart, { id: 'offline-tester', title: 'Offline tester', kind: 'strategy',
            cause: 'history', complete: true, bar: 4, time: 1700000000000, forming: false, first: true,
            plots: {}, vars: {}, strategy, warnings: [], trades: async () => trades, series: async () => [] });
    });
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Strategy tester' }).tap();
    const tester = page.locator('.vela-st:visible');
    await tester.waitFor({ state: 'visible' });
    await tester.getByRole('tab', { name: 'Trades' }).tap();
    const standaloneTester = await tester.evaluate((el) => ({ standard: el.dataset.standardPane,
        radius: getComputedStyle(el).borderRadius, max: getComputedStyle(el.querySelector('.vela-panel-max')).display !== 'none',
        width: el.getBoundingClientRect().width, count: el.querySelector('.vela-st-trades').getAttribute('aria-rowcount'),
        mounted: el.querySelectorAll('.vela-st-trade-row').length }));
    assert(standaloneTester.standard === '1' && standaloneTester.radius === '0px' && standaloneTester.max
        && standaloneTester.width === 390 && standaloneTester.count === '151' && standaloneTester.mounted < 30,
    'standalone tester uses the portrait pane and a bounded trade table', standaloneTester);
    await tester.locator('.vela-st-trade-toggle').first().tap();
    assert((await tester.locator('.vela-st-trade-details').innerText()).includes('Entry time (UTC)'), 'standalone tester exposes touch trade details');
    await tester.locator('.vela-panel-close').tap();
    await page.waitForTimeout(250);

    // Exercise the NEW Object Tree template/sync path in the bundled file too, not
    // just the development workspace. A one-chart layout can opt in for future cells.
    const studyId = await page.evaluate(() => window.__ws.active.chart.addNativeIndicator('rsi').id);
    await page.waitForTimeout(650);
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Object tree' }).tap();
    await page.waitForTimeout(300);
    const studyRow = page.locator(`.vela-ot-row[data-id="${studyId}"]`);
    await studyRow.scrollIntoViewIfNeeded();
    await studyRow.getByRole('button', { name: 'More actions' }).tap();
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Indicator templates$/ }).tap();
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Save as new template…$/ }).tap();
    const indicatorForm = page.getByRole('dialog', { name: 'Save indicator template' });
    await indicatorForm.getByLabel('Indicator template name').fill('Standalone RSI');
    await indicatorForm.getByRole('button', { name: 'Save' }).tap();
    assert(await page.evaluate(() => !!window.__ws.getState().templates['Standalone RSI'] && !document.querySelector('.vela-panel.vela-ot').hidden), 'standalone saves the selected study without closing Object tree');
    await studyRow.getByRole('button', { name: 'More actions' }).tap();
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Indicator live sync$/ }).tap();
    await page.locator('.vela-menu-item:visible').filter({ hasText: /Live sync in layout$/ }).tap();
    const standaloneSync = await page.evaluate((id) => window.__ws.indicatorSyncStatus(id), studyId);
    assert(standaloneSync.mode === 'layout', 'standalone can opt into future layout-wide indicator synchronization', standaloneSync);
    await tree.locator('.vela-panel-close').tap();
    await page.waitForTimeout(250);

    await page.evaluate(() => window.__ws.active.chart.renderer.set('autoScale', false));
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Chart actions' }).tap();
    const chartMenu = page.locator('.vela-chart-actions[data-state="open"]');
    await chartMenu.waitFor({ state: 'visible' });
    await page.waitForTimeout(320);
    const chartMenuBox = await chartMenu.boundingBox();
    assert(chartMenuBox && chartMenuBox.width <= 225 && chartMenuBox.x >= 0 && chartMenuBox.y >= 0 && chartMenuBox.x + chartMenuBox.width <= 390 && chartMenuBox.y + chartMenuBox.height <= 780 && await page.locator('.vela-cmd-list').count() === 0, 'standalone Chart actions is a compact floating menu', chartMenuBox);
    await chartMenu.locator('[data-vei-id="reset-view"]').tap();
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.__ws.active.chart.renderer.get('autoScale') === true) && await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'standalone floating action resets the real chart and dismisses');

    const drawer = page.locator('.vela-more-panel:visible');
    await drawer.waitFor({ state: 'visible' });
    assert(await drawer.isVisible(), 'the chart action dismisses only its child and leaves More open');
    await drawer.locator('.vela-md-row', { hasText: 'Manage layouts' }).tap();
    await page.waitForTimeout(350);
    const menu = page.locator('.vela-lmp:visible'), phoneMenu = await menu.boundingBox();
    assert(phoneMenu && phoneMenu.x >= 0 && phoneMenu.y >= 0 && phoneMenu.x + phoneMenu.width <= 390 && phoneMenu.y + phoneMenu.height <= 780 && phoneMenu.width <= 225 && await page.locator('.vela-lmp-dialog').count() === 0, 'standalone phone menu is compact and bounded', phoneMenu);
    await menu.locator('[data-action="copy"]').tap();
    const copy = await page.evaluate(() => window.__ws.activeLayoutName());
    await menu.locator('[data-action="rename"]').tap();
    await menu.locator('[aria-label="Layout name"]').fill('Offline test');
    await menu.locator('[data-action="submit"]').tap();
    assert(copy?.includes('copy') && await page.evaluate(() => window.__ws.activeLayoutName()) === 'Offline test', 'standalone menu performs copy and rename');

    await page.setViewportSize({ width: 780, height: 390 });
    await page.waitForTimeout(500);
    const rotation = await page.evaluate(() => {
        const menu = document.querySelector('.vela-lmp'), more = document.querySelector('.vela-more-panel');
        return { mode: document.querySelector('.vela-workspace')?.dataset.layout, menu: menu?.getBoundingClientRect().toJSON() ?? null,
            moreVisible: !!more?.getClientRects().length, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(rotation.mode === 'desktop' && rotation.overflow <= 0 && (!rotation.menu || (rotation.moreVisible && rotation.menu.left >= 0 && rotation.menu.right <= 780 && rotation.menu.top >= 0 && rotation.menu.bottom <= 390)),
        'rotation switches chrome and keeps any retained child anchored and in bounds', rotation);
    await page.locator('.vela-widget-layoutname').click();
    await page.waitForTimeout(250);
    const desktopMenu = await page.locator('.vela-lmp:visible').boundingBox();
    assert(desktopMenu && desktopMenu.width <= 225 && desktopMenu.y >= 0 && desktopMenu.y + desktopMenu.height <= 390, 'landscape menu stays in bounds', desktopMenu);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const landscapeAlertBadges = [], editorActions = [];
    await page.evaluate(() => window.__ws.openEditor());
    await page.locator('.vela-pe-act.primary:visible').waitFor(); await page.waitForTimeout(200);
    for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => window.__ws.setTheme(theme), theme); await page.waitForTimeout(160);
        const badge = await colorOf(page.locator('.vela-widget-alerts .vela-alerts-badge'));
        landscapeAlertBadges.push({ theme, ...badge });
        assert(badge.text === '2' && Math.max(...badge.bg) - Math.min(...badge.bg) > 25 && contrast(badge.fg, badge.bg) >= 4.5,
            'landscape alert count is colored and legible', { theme, badge });
        await page.mouse.move(3, 3); await page.waitForTimeout(140);
        const normal = await colorOf(page.locator('.vela-pe-act.primary'));
        await page.locator('.vela-pe-act.primary').hover(); await page.waitForTimeout(160);
        const hover = await colorOf(page.locator('.vela-pe-act.primary'));
        editorActions.push({ theme, normal, hover });
        assert(contrast(normal.fg, normal.bg) >= 4.5 && hover.filter === 'none' && contrast(hover.fg, hover.bg) >= 4.5,
            'bundled editor action remains readable on its colored fill and hover', { theme, normal, hover });
    }
    await page.locator('.vela-pe .vela-panel-close').click(); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(350);
    await page.evaluate(() => {
        const ws = window.__ws;
        ws.setActiveCell('btc'); ws.setLayout('4'); ws.setActiveCell('btc');
        for (const cell of ws.cells()) cell.chart.renderer.applyConfig({ crosshair: { color: cell.id === 'btc' ? '#bc2345' : '#2345bc' } });
    });
    await page.waitForTimeout(350);
    // Verify that the delivered file contains the unified workspace panel too.
    if (!(await page.locator('.vela-more-panel').isVisible())) await page.locator('.vela-mb-more').tap();
    const setupEntries = await page.locator('.vela-more-panel:visible .vela-md-row').allTextContents();
    assert(setupEntries.filter(x => /Layout setup|Chart syncing/.test(x)).length === 1 && setupEntries.some(x => x.includes('Layout setup')),
        'standalone phone More has one Layout setup entry');
    await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Layout setup' }).tap();
    const setup = page.locator('.vela-layout-setup'); await setup.waitFor({ state: 'visible' });
    const standaloneSetup = await setup.evaluate(el => ({
        standard: el.dataset.standardPane, width: el.getBoundingClientRect().width,
        tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()),
        square: el.querySelector('.vela-lp-sq')?.getBoundingClientRect().toJSON(),
        selected: el.querySelectorAll('.vela-lp-sq[data-on]').length,
    }));
    assert(standaloneSetup.standard === '1' && standaloneSetup.width === 390 && standaloneSetup.tabs.join('|') === 'Layout|Chart syncing'
        && standaloneSetup.selected === 4 && Math.abs(standaloneSetup.square.width - standaloneSetup.square.height) < 1,
        'standalone phone opens the unified square-grid pane', standaloneSetup);
    await setup.getByRole('tab', { name: 'Chart syncing' }).tap();
    const link = setup.getByRole('switch', { name: 'Symbol sync' });
    const linkBefore = await link.getAttribute('aria-checked'); await link.tap();
    assert(await link.getAttribute('aria-checked') !== linkBefore && await setup.locator('.vela-md-matrix-head[data-cell]').count() === 4,
        'standalone phone sync tab controls the live four-chart matrix');
    await link.tap();
    await setup.locator('.vela-panel-close').tap();
    await page.locator('.vela-mb-settings').tap();
    await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
    await page.locator('.vela-sd-tplbtn').tap();
    await page.locator('.vela-sd-tpl .vela-sd-applyall').tap();
    const standaloneApply = await page.evaluate(() => window.__ws.cells().map((cell) => ({ id: cell.id, color: cell.chart.renderer.getConfig().crosshair.color })));
    assert(standaloneApply.length === 4 && standaloneApply.every((cell) => cell.color === '#bc2345') &&
        await page.locator('.vela-dialog--settings').isVisible(), 'standalone phone Apply to all really copies settings to the four charts', standaloneApply);
    await page.locator('.vela-dialog-close').tap();
    await page.evaluate(() => { window.__ws.setActiveCell('btc'); window.__ws.setLayout('1'); });
    await page.waitForTimeout(350);
    const hiddenBadges = [];
    for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => window.__ws.setTheme(theme), theme); await page.waitForTimeout(160);
        const badge = await colorOf(page.locator('.vela-mb-more .vela-mb-badge'));
        hiddenBadges.push({ theme, ...badge });
        assert(badge.text === '3' && !badge.hidden && Math.max(...badge.bg) - Math.min(...badge.bg) > 25 && contrast(badge.fg, badge.bg) >= 4.5,
            'bundled hidden-chart count is colored and legible after a real layout shrink', { theme, badge });
    }
    await page.evaluate(() => window.__ws.setTheme('dark'));
    // This file's real playground adapter uses localStorage. Reload the same file with
    // networking still blocked, rather than only testing getState/applyState in memory.
    await page.waitForTimeout(800);
    const beforeReload = await page.evaluate(() => ({ alert: window.__ws.getState().priceAlerts?.[0], stored: !!localStorage.getItem('vela-play:vela-workspace') }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0);
    await page.waitForTimeout(700);
    const afterReload = await page.evaluate(() => ({ alert: window.__ws.getState().priceAlerts?.[0], logs: window.__ws.alertEntries().length,
        drawingExists: window.__ws.active.chart.drawings.all().some((d) => d.id === window.__ws.getState().priceAlerts?.[0]?.lineId) }));
    assert(beforeReload.stored && afterReload.alert?.value === 109 && afterReload.alert?.state === 'fired' && afterReload.alert?.fires === 2
        && afterReload.alert?.lineOwned === true && afterReload.drawingExists && afterReload.logs === 0,
    'standalone restores edited alert, stopped state, trigger count and owned line on reload; the log remains session-only', { beforeReload, afterReload });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopFacts = { tips: [] };
    try {
        await desktop.route('**/*', (route) => {
            if (/^https?:/.test(route.request().url())) void route.abort();
            else void route.continue();
        });
        if (desktop.routeWebSocket) await desktop.routeWebSocket('wss://**', (ws) => ws.close());
        const dp = await desktop.newPage();
        dp.on('pageerror', (e) => errors.push(String(e)));
        await dp.goto(pathToFileURL(resolve(root, 'single/vela-workspace.html')).href, { waitUntil: 'domcontentloaded' });
        await dp.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 30000 });
        await dp.locator('button[aria-label^="Layout —"]').click();
        const desktopSetup = dp.locator('.vela-layout-setup'); await desktopSetup.waitFor({ state: 'visible' });
        desktopFacts.layoutSetup = await desktopSetup.evaluate(el => ({
            standard: el.dataset.standardPane, floating: el.dataset.freeFloating ?? null,
            tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()),
            rect: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON(),
        }));
        assert(desktopFacts.layoutSetup.standard === '1' && desktopFacts.layoutSetup.floating === null
            && desktopFacts.layoutSetup.tabs.join('|') === 'Layout|Chart syncing'
            && Math.abs(desktopFacts.layoutSetup.rect.height - desktopFacts.layoutSetup.host.height) < 2,
            'standalone desktop opens the real docked Layout setup pane', desktopFacts.layoutSetup);
        await desktopSetup.getByRole('tab', { name: 'Chart syncing' }).click();
        assert(await desktopSetup.locator('.vela-ls-syncrows [role="switch"]').count() === 7,
            'standalone desktop retains all seven sync controls');
        await desktopSetup.locator('.vela-panel-close').click();
        for (const [selector, label] of [['.vela-widget-indicators', 'Indicators'], ['.vela-widget-templates', 'Indicator templates']]) {
            const target = dp.locator(selector);
            await target.hover();
            await dp.waitForTimeout(100);
            const info = await dp.evaluate((selector) => {
                const button = document.querySelector(selector), tip = document.querySelector('.vela-tooltip[data-state="open"]');
                return { text: tip?.textContent, background: tip && getComputedStyle(tip).backgroundColor,
                    nativeTitle: button?.getAttribute('title'), describedBy: button?.getAttribute('aria-describedby') };
            }, selector);
            assert(info.text === label && info.background && !info.background.startsWith('rgba(0, 0, 0, 0)') && !info.nativeTitle && info.describedBy,
                'standalone desktop shows the shared themed indicator tooltip', { selector, info });
            desktopFacts.tips.push(info);
            await dp.mouse.move(30, 400); await dp.waitForTimeout(350);
        }
        await dp.evaluate(() => window.__ws.active.chart.renderer.openSettings());
        const card = dp.locator('.vela-dialog--settings');
        await card.waitFor({ state: 'visible' });
        await dp.waitForTimeout(250);
        const originalCard = await card.boundingBox();
        const desktopSettingsShape = await card.evaluate((el) => ({ grip: !!el.querySelector('.vela-size-grip'), footer: !!el.querySelector('.vela-dialog-footer'),
            resizeAfterClose: el.querySelector('.vela-dialog-corner-resize')?.previousElementSibling === el.querySelector('.vela-dialog-close') }));
        assert(!desktopSettingsShape.grip && desktopSettingsShape.footer && desktopSettingsShape.resizeAfterClose,
            'standalone desktop Settings has its direct resize button after Close and keeps the footer', desktopSettingsShape);
        const header = await card.locator('.vela-dialog-header').boundingBox();
        await dp.mouse.move(header.x + header.width * .45, header.y + header.height / 2);
        await dp.mouse.down();
        await dp.mouse.move(header.x + header.width * .45 + 80, header.y + header.height / 2 + 55, { steps: 8 });
        await dp.mouse.up();
        const movedCard = await card.boundingBox();
        assert(movedCard.x > originalCard.x + 60 && movedCard.y > originalCard.y + 40,
            'standalone desktop settings remains draggable', { originalCard, movedCard });
        const settingsResize = card.locator('.vela-dialog-corner-resize');
        const sizeButton = await settingsResize.boundingBox(), sizeX = sizeButton.x + sizeButton.width / 2, sizeY = sizeButton.y + sizeButton.height / 2;
        await dp.mouse.move(sizeX, sizeY); await dp.mouse.down(); await dp.mouse.move(sizeX - 100, sizeY + 110, { steps: 8 }); await dp.mouse.up();
        const resizedCard = await card.boundingBox();
        assert(resizedCard.width < movedCard.width - 80 && resizedCard.height < movedCard.height - 90 &&
            Math.abs(resizedCard.x - movedCard.x) < 3 && Math.abs(resizedCard.y + resizedCard.height - movedCard.y - movedCard.height) < 3,
        'standalone Settings resize button directly changes both dimensions', { movedCard, resizedCard });
        await settingsResize.click();
        assert(await card.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0,
            'standalone Settings resize click opens no size popup');
        desktopFacts.originalCard = originalCard;
        desktopFacts.movedCard = movedCard;
        desktopFacts.resizedCard = resizedCard;
        const moveSettings = await card.locator('.vela-dialog-title').boundingBox();
        await dp.mouse.move(moveSettings.x + moveSettings.width / 2, moveSettings.y + moveSettings.height / 2);
        await dp.mouse.down(); await dp.mouse.move(moveSettings.x + moveSettings.width / 2, moveSettings.y + moveSettings.height / 2 + 1000, { steps: 12 }); await dp.mouse.up();
        await dp.evaluate(() => window.scrollTo(0, 400)); await dp.waitForTimeout(150);
        const settingsOverflow = await card.evaluate((el) => ({ panel: el.getBoundingClientRect().toJSON(),
            header: el.querySelector('.vela-dialog-header').getBoundingClientRect().toJSON(),
            pageHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, y: window.scrollY }));
        assert(settingsOverflow.panel.bottom > settingsOverflow.clientHeight + 50 && settingsOverflow.header.bottom <= settingsOverflow.clientHeight + 1 &&
            settingsOverflow.pageHeight <= settingsOverflow.clientHeight + 1 && settingsOverflow.y === 0,
            'standalone Settings can extend off-screen without scrolling the page', settingsOverflow);
        desktopFacts.settingsOverflow = settingsOverflow;
        await card.locator('.vela-dialog-close').click();
        await dp.locator('.vela-widget-panel-objects').click();
        const tree = dp.locator('.vela-panel.vela-ot');
        const seam = tree.locator('.vela-panel-resizer');
        const originalWidth = (await tree.boundingBox()).width;
        await seam.focus();
        await dp.keyboard.press('ArrowLeft');
        const keyboardWidth = (await tree.boundingBox()).width;
        await dp.keyboard.press('Enter');
        const widthControl = tree.locator('.vela-panel-position-control');
        assert(keyboardWidth > originalWidth + 10 && await widthControl.count() === 0 &&
            await tree.locator('.vela-panel-height-control').count() === 0,
            'standalone seam has keyboard resizing and opens no size popup', { originalWidth, keyboardWidth });
        await seam.dblclick();
        const sideWidth = await dp.locator('.vela-ws-grid').evaluate((el) => el.getBoundingClientRect().width);
        await tree.locator('.vela-panel-dock-toggle').click();
        const floatingTree = await tree.boundingBox();
        const expandedWidth = await dp.locator('.vela-ws-grid').evaluate((el) => el.getBoundingClientRect().width);
        const title = await tree.locator('.vela-panel-title').boundingBox();
        await dp.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
        await dp.mouse.down();
        await dp.mouse.move(title.x + title.width / 2 - 80, title.y + title.height / 2 - 40, { steps: 8 });
        await dp.mouse.up();
        const movedTree = await tree.boundingBox();
        assert(expandedWidth > sideWidth + 200 && movedTree.x < floatingTree.x - 60 && movedTree.y < floatingTree.y - 25,
            'standalone Float releases chart width and its title really drags', { sideWidth, expandedWidth, floatingTree, movedTree });
        const corner = tree.locator('.vela-panel-corner-resize');
        assert(!await tree.locator('.vela-panel-grip').isVisible() && !await seam.isVisible() &&
            await corner.evaluate((el) => el.previousElementSibling?.className) === 'vela-panel-close',
        'standalone floating resize button follows Close with no extra handles');
        const cornerRect = await corner.boundingBox();
        const cx = cornerRect.x + cornerRect.width / 2, cy = cornerRect.y + cornerRect.height / 2;
        await dp.mouse.move(cx, cy); await dp.mouse.down(); await dp.mouse.move(cx - 70, cy + 90, { steps: 8 }); await dp.mouse.up();
        const smallTree = await tree.boundingBox();
        assert(smallTree.width < movedTree.width - 50 && smallTree.height < movedTree.height - 65 &&
            Math.abs(smallTree.x - movedTree.x) < 2 && Math.abs(smallTree.y + smallTree.height - movedTree.y - movedTree.height) < 3,
        'standalone resize button directly changes both dimensions', { movedTree, smallTree });
        const moveTree = await tree.locator('.vela-panel-title').boundingBox();
        await dp.mouse.move(moveTree.x + moveTree.width / 2, moveTree.y + moveTree.height / 2);
        await dp.mouse.down(); await dp.mouse.move(moveTree.x + moveTree.width / 2, moveTree.y + moveTree.height / 2 + 1000, { steps: 12 }); await dp.mouse.up();
        await dp.evaluate(() => window.scrollTo(0, 400)); await dp.waitForTimeout(150);
        const treeOverflow = await tree.evaluate((el) => ({ panel: el.getBoundingClientRect().toJSON(),
            header: el.querySelector('.vela-panel-header').getBoundingClientRect().toJSON(),
            pageHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, y: window.scrollY }));
        assert(treeOverflow.panel.bottom > treeOverflow.clientHeight + 50 && treeOverflow.header.bottom <= treeOverflow.clientHeight + 1 &&
            treeOverflow.pageHeight <= treeOverflow.clientHeight + 1 && treeOverflow.y === 0,
            'standalone floating panels can extend off-screen without scrolling the page', treeOverflow);
        desktopFacts.treeOverflow = treeOverflow;
        const returnTree = await tree.locator('.vela-panel-title').boundingBox();
        await dp.mouse.move(returnTree.x + returnTree.width / 2, returnTree.y + returnTree.height / 2);
        await dp.mouse.down(); await dp.mouse.move(returnTree.x + returnTree.width / 2, returnTree.y + returnTree.height / 2 - 600, { steps: 12 }); await dp.mouse.up();
        await corner.click();
        assert(await widthControl.count() === 0 && await tree.locator('.vela-panel-height-control').count() === 0,
            'standalone resize button opens no width or height popup');
        await tree.locator('.vela-panel-title').click({ button: 'right' });
        await widthControl.waitFor({ state: 'visible' });
        assert(await widthControl.getByRole('slider', { name: 'Panel left position' }).count() === 1 &&
            await widthControl.getByRole('slider', { name: 'Panel height' }).count() === 0,
            'standalone position alternative remains available without size controls');
        await widthControl.locator('.vela-panel-position-close').click();
        await dp.locator('.vela-widget-panel-dataWindow').click();
        const data = dp.locator('.vela-panel.vela-dw');
        await data.locator('.vela-panel-dock-toggle').click();
        await dp.locator('.vela-widget-alerts').click();
        assert(await tree.isVisible() && await data.isVisible() && await dp.locator('.vela-ap').isVisible() &&
            await tree.getAttribute('data-free-floating') === '1' && await data.getAttribute('data-free-floating') === '1',
        'standalone retains two floating panels with one dock while networking is blocked');
        // The newly floated Data Window can overlap the first card's controls. Focusing the
        // named header raises that card without remounting it, just like a keyboard user.
        await tree.locator('.vela-panel-header').focus();
        assert(await tree.getAttribute('data-floating-front') === '1', 'standalone focus raises an overlapped floating card');
        await tree.locator('.vela-panel-dock-toggle').click();
        assert(await tree.isVisible() && await data.isVisible() && !await dp.locator('.vela-ap').isVisible() &&
            await tree.getAttribute('data-free-floating') === null,
        'standalone Dock returns the selected panel without closing the other card');
        desktopFacts.floatingPanels = { sideWidth, expandedWidth, floatingTree, movedTree,
            state: await dp.evaluate(() => window.__ws.getState().panels) };
        await dp.evaluate(() => { document.querySelector('#workspace').style.transform = 'translateZ(0)'; window.__ws.topbar.openLayoutMenu(); });
        const layouts = dp.locator('.vela-lm:visible'); await layouts.waitFor({ state: 'visible' }); await dp.waitForTimeout(180);
        const layoutTitle = await layouts.locator('.vela-lm-title').boundingBox();
        await dp.mouse.move(layoutTitle.x + layoutTitle.width / 2, layoutTitle.y + layoutTitle.height / 2);
        await dp.mouse.down(); await dp.mouse.move(layoutTitle.x + layoutTitle.width / 2, layoutTitle.y + layoutTitle.height / 2 + 1000, { steps: 12 }); await dp.mouse.up();
        await dp.evaluate(() => window.scrollTo(0, 400)); await dp.waitForTimeout(150);
        const layoutOverflow = await layouts.evaluate((el) => ({ panel: el.getBoundingClientRect().toJSON(),
            header: el.querySelector('.vela-lm-head').getBoundingClientRect().toJSON(),
            pageHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, y: window.scrollY }));
        assert(layoutOverflow.panel.bottom > layoutOverflow.clientHeight + 50 && layoutOverflow.header.bottom <= layoutOverflow.clientHeight + 1 &&
            layoutOverflow.pageHeight <= layoutOverflow.clientHeight + 1 && layoutOverflow.y === 0,
            'standalone transformed hosts also keep dragged layout popovers from scrolling the page', layoutOverflow);
        desktopFacts.layoutOverflow = layoutOverflow;
        await dp.keyboard.press('Escape');
    } finally {
        await desktop.close();
    }
    assert(errors.length === 0, 'no standalone page errors', errors);
    report('single-file', { boot, settingsBefore, settingsAfter, settingsShape, pickerRadius, bundledCrosshair, bundledColorPanel, bundledViewport, desktopFacts, before, after, empty, table, standaloneTracking, standaloneRegrab, scaleSize, alertShell, standaloneAlerts, phoneAlertBadges, standaloneTester, standaloneSync, standaloneSetup, chartMenuBox, phoneMenu, copy, rotation, desktopMenu, landscapeAlertBadges, editorActions, standaloneApply, hiddenBadges, beforeReload, afterReload, blocked, errors });
} finally {
    await context.close();
    await browser.close();
}
