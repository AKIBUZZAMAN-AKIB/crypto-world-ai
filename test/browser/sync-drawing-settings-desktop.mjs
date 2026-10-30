// Desktop drawing Settings stays a floating, directly resizable card and never leaves the viewport.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => { if (!String(error).includes('ResizeObserver loop completed')) errors.push(String(error)); });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    await page.evaluate(() => {
        const chart = window.__ws.active.chart;
        const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }] });
        chart.drawings.openSettings(drawing.id);
    });
    const bar = page.locator('.vela-dpop');
    const settingsButton = bar.locator('[data-tip="Settings"]');
    if (await settingsButton.isVisible()) await settingsButton.click();
    else { await bar.locator('[data-tip="More"]').click(); await page.locator('.vela-dpop-more [data-overflow="1"]', { hasText: 'Settings' }).click(); }
    const panel = page.locator('.vela-dialog.vela-dsp'); await panel.waitFor({ state: 'visible' });
    const corner = panel.locator('.vela-dialog-corner-resize'); await corner.waitFor({ state: 'visible' });
    const initial = await panel.boundingBox();
    const controls = await page.evaluate(() => ({ close: !!document.querySelector('.vela-dsp .vela-dialog-close'),
        resizeLabel: document.querySelector('.vela-dsp .vela-dialog-corner-resize')?.getAttribute('aria-label'),
        scrollX: getComputedStyle(document.querySelector('.vela-dsp-scroll')).overflowX,
        scrollY: getComputedStyle(document.querySelector('.vela-dsp-scroll')).overflowY,
        region: document.querySelector('.vela-dsp-scroll')?.getAttribute('role'),
        scrollLabel: document.querySelector('.vela-dsp-scroll')?.getAttribute('aria-label'),
        scrollTabIndex: document.querySelector('.vela-dsp-scroll')?.tabIndex }));
    assert(initial.width > 300 && initial.height > 200 && controls.close && controls.resizeLabel?.startsWith('Resize') &&
        ['auto', 'scroll'].includes(controls.scrollX) && ['auto', 'scroll'].includes(controls.scrollY) &&
        controls.region === 'region' && controls.scrollLabel === 'Drawing settings content' && controls.scrollTabIndex === 0,
        'desktop Settings is a floating card with its own resize control and two-axis content scrolling', { initial, controls });

    const grip = await corner.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down(); await page.mouse.move(grip.x + grip.width / 2 + 70, grip.y + grip.height / 2 - 45, { steps: 6 }); await page.mouse.up();
    const resized = await panel.boundingBox();
    assert(resized.width > initial.width + 30 && resized.height > initial.height + 20 && resized.x >= -1 && resized.y >= -1 &&
        resized.x + resized.width <= 1441 && resized.y + resized.height <= 901,
        'the header resize button grows both axes while keeping the entire card on-screen', { initial, resized });

    const title = await panel.locator('.vela-dialog-title').boundingBox();
    await page.mouse.move(title.x + 30, title.y + title.height / 2);
    await page.mouse.down(); await page.mouse.move(2000, 1400, { steps: 10 }); await page.mouse.up();
    const moved = await panel.boundingBox();
    assert(moved.x >= -1 && moved.y >= -1 && moved.x + moved.width <= 1441 && moved.y + moved.height <= 901,
        'dragging clamps the complete desktop card to the viewport, not just its header', { resized, moved });
    await panel.locator('.vela-dialog-close').click();
    assert(!(await panel.isVisible()) && errors.length === 0, 'Close works after moving/resizing and no browser errors occur', errors);
    await context.close();
    report('drawing-settings-desktop', { engine, initial, moved, resized, controls, errors });
} finally { await browser.close(); }
