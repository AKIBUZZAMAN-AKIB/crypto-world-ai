// A phone must be able to open the compact Visual order submenu for drawings without
// a right-click, and the command must actually change both z-order and tree order.
import { OFFLINE, open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ base: OFFLINE, viewport: { width: 390, height: 780 }, mobile: true, settle: 1200 });
try {
    await page.evaluate(() => {
        const chart = window.__ws.active.chart;
        const range = chart.getVisibleRange();
        const price = chart.lastBar.close;
        const anchors = [
            { time: range.from + (range.to - range.from) * 0.35, price: price * 0.99 },
            { time: range.from + (range.to - range.from) * 0.65, price: price * 1.01 },
        ];
        chart.drawings.add('box', { anchors });
        chart.drawings.add('box', { anchors });
    });
    await page.locator('.vela-mb-more').tap();
    await page.locator('.vela-md-row', { hasText: 'Object tree' }).tap();
    await page.waitForSelector('.vela-ot-row[data-row-kind="drawing"]');
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.vela-ot-row[data-row-kind="drawing"]')].map((e) => e.dataset.id));
    const before = await rows();
    assert(before.length >= 2, 'both drawings are present', before);
    const target = before[0];
    await page.locator(`.vela-ot-row[data-id="${target}"] .vela-ot-btn[data-icon="more"]`).tap();
    const parent = page.locator('.vela-menu-item:visible', { hasText: /^Visual order$/ }).first();
    await parent.waitFor({ state: 'visible' });
    const rootLabels = await page.locator('.vela-menu-item:visible').allTextContents();
    assert(!rootLabels.includes('Bring to front'), 'the four verbs do not crowd the root menu', rootLabels);
    await parent.tap();
    const back = page.locator('.vela-menu-item:visible', { hasText: /^Send to back$/ }).first();
    await back.waitFor({ state: 'visible', timeout: 5000 });
    await back.tap();
    await page.waitForTimeout(350);
    const after = await rows();
    assert(after.at(-1) === target, 'touch Send to back actually restacks the drawing', { before, after });
    assert(errors.length === 0, 'no page errors', errors.slice(0, 3));
    report('object-tree-touch-order', { before, after, rootLabels });
} finally {
    await browser.close();
}
