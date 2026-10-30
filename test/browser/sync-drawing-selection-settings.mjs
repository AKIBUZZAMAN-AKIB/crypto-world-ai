// Reproduce the user path: select a drawing on the chart, then use its Settings control.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const cases = [
    { width: 390, height: 780, mobile: true, layout: '1', tool: 'hline' },
    { width: 390, height: 780, mobile: true, layout: '4', tool: 'highlighter' },
    { width: 190, height: 640, mobile: true, layout: '1', tool: 'highlighter' },
];
const results = [], errors = [];
try {
    for (const size of cases) {
        const context = await browser.newContext({
            viewport: { width: size.width, height: size.height },
            isMobile: size.mobile,
            hasTouch: size.mobile,
            deviceScaleFactor: size.mobile ? 2 : 1,
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 60000 });
        await page.evaluate((layout) => {
            window.__ws.setActiveCell('a');
            window.__ws.setLayout(layout);
        }, size.layout);
        await page.waitForTimeout(250);
        const target = await page.evaluate((tool) => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add(tool, {
                anchors: tool === 'highlighter'
                    ? [{ time: chart.lastBar.time - 3600000, price: chart.lastBar.close - 3 }, { time: chart.lastBar.time, price: chart.lastBar.close - 5 }]
                    : [{ time: chart.lastBar.time, price: chart.lastBar.close - 20 }],
                ...(tool === 'highlighter' ? { text: { value: 'Before' } } : {}),
            });
            window.__settingsRegressionId = drawing.id;
            return {
                ...drawing.bounds(chart.renderer.renderer.drawingProjector()),
                plot: chart.renderer.renderer.plot.getBoundingClientRect().toJSON(),
            };
        }, size.tool);
        assert(target && target.y > 40 && target.y < size.height - 90, 'test line is inside the visible plot', { size, target });
        const screenPoint = { x: target.plot.left + target.x + target.w / 2, y: target.plot.top + target.y + target.h / 2 };
        if (size.mobile) await page.touchscreen.tap(screenPoint.x, screenPoint.y);
        else await page.mouse.click(screenPoint.x, screenPoint.y);
        const toolbar = page.locator('.vela-dpop'); await toolbar.waitFor({ state: 'visible' });
        const selected = await toolbar.evaluate((el) => ({
            settingsVisible: [...el.querySelectorAll('[data-tip="Settings"]')].some((button) => getComputedStyle(button).display !== 'none'),
            settingsButtonCount: el.querySelectorAll('[data-tip="Settings"]').length,
            toolbarBox: el.getBoundingClientRect().toJSON(),
        }));
        const gear = toolbar.locator('[data-tip="Settings"]');
        const settingsRoute = await gear.isVisible() ? 'direct button' : 'More overflow';
        if (settingsRoute === 'direct button') await gear.tap();
        else {
            await toolbar.locator('[data-tip="More"]').tap();
            await page.getByRole('menuitem', { name: 'Settings', exact: true }).tap();
        }
        const panel = page.locator('.vela-dialog.vela-dsp'); await panel.waitFor({ state: 'visible' });
        await page.waitForTimeout(220);
        const geometry = await panel.evaluate((el) => {
            const content = el.querySelector('.vela-dsp-scroll');
            return {
                rect: el.getBoundingClientRect().toJSON(),
                state: el.dataset.state,
                mobilePane: el.classList.contains('vela-dsp-mobile'),
                title: el.querySelector('.vela-dialog-title')?.textContent,
                content: content ? { visible: content.getBoundingClientRect().height > 0, region: content.getAttribute('role'), label: content.getAttribute('aria-label') } : null,
            };
        });
        assert(geometry.state === 'open' && geometry.title && geometry.rect.width > 0 && geometry.rect.height > 0 &&
            geometry.content?.visible && geometry.content.region === 'region',
            'Settings opens with its title and scrollable content after a real chart selection and touch activation', { size, selected, settingsRoute, geometry });
        await panel.locator('.vela-dialog-close').click();
        assert(!(await panel.isVisible()), 'Settings closes cleanly after chart selection', size);
        results.push({ size, target, selected, settingsRoute, geometry });
        await context.close();
    }
    assert(errors.length === 0, 'no uncaught browser errors', errors);
    report('drawing-selection-settings', { results, errors });
} finally { await browser.close(); }
