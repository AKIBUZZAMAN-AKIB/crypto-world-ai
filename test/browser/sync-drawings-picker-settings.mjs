// Exercise the actual phone path: bottom Drawings tab → choose a tool → draw → Settings.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
    await page.evaluate(() => window.__ws.setLayout('1'));
    await page.waitForTimeout(250);

    await page.locator('.vela-mb-drawings').tap();
    const picker = page.locator('.vela-drawings-panel'); await picker.waitFor({ state: 'visible' });
    await page.locator('.vela-dd-search input').fill('Horizontal Line');
    await page.locator('.vela-dd-row').first().tap();
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.__ws.active.chart.drawings.getTool()) === 'hline' && !(await picker.isVisible()),
        'the bottom Drawings pane arms the chosen tool and closes');

    await page.touchscreen.tap(130, 300);
    const toolbar = page.locator('.vela-dpop'); await toolbar.waitFor({ state: 'visible' });
    const drawingCount = await page.evaluate(() => window.__ws.active.chart.drawings.all().length);
    assert(drawingCount === 1, 'the selected tool creates one drawing on the chart', drawingCount);
    const settingsButton = toolbar.locator('[data-tip="Settings"]');
    await settingsButton.tap();
    const panel = page.locator('.vela-dialog.vela-dsp'); await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(220);
    const details = await panel.evaluate((el) => {
        const title = el.querySelector('.vela-dialog-title');
        const body = el.querySelector('.vela-dsp-scroll');
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(title.getBoundingClientRect().left + 8, title.getBoundingClientRect().top + 8);
        return {
            rect: rect.toJSON(), state: el.dataset.state, title: title.textContent,
            contentHeight: body.getBoundingClientRect().height,
            contentName: body.getAttribute('aria-label'), titleActuallyVisible: !!hit && (hit === title || title.contains(hit)),
        };
    });
    assert(details.state === 'open' && details.title === 'Horizontal Line' && details.contentHeight > 0 &&
        details.contentName === 'Drawing settings content' && details.titleActuallyVisible && details.rect.bottom <= 781,
        'Settings is visibly on top of the chart with its content, not merely mounted behind another surface', details);
    await panel.locator('.vela-dialog-close').tap();
    assert(!(await panel.isVisible()) && errors.length === 0, 'the Settings pane closes and produces no page errors', errors);
    await context.close();
    report('drawings-picker-settings', { details, errors });
} finally { await browser.close(); }
