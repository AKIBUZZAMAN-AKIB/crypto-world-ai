// Strategy Tester: large ledger virtualization, detail-row geometry, keyboard and rotation.
import { chromium } from 'playwright';
import { assert, report } from './helpers.mjs';
import { strategyTesterFixtures } from './fixtures/strategy-tester.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};
const { wait, boot, openTester, seed, select } = strategyTesterFixtures(browser, errors);
try {
    // Large ledgers remain bounded and navigable, including an expanded variable-height row.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await openTester(page, false);
        await seed(page, { n: 20_000, amount: 1_234_567_890_123.45 });
        await select(page, 'Trades');
        const scroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        const table = page.locator('.vela-st-view:not([hidden]) .vela-st-trades');
        const initial = await table.evaluate((el) => ({ total: el.getAttribute('aria-rowcount'), mounted: el.querySelectorAll('.vela-st-trade-row').length,
            rowHeight: el.querySelector('.vela-st-trade-row').getBoundingClientRect().height }));
        assert(initial.total === '20001' && initial.mounted < 50 && Math.abs(initial.rowHeight - 36) < 1, '20,000 trades keep a semantic total but only a bounded DOM slice', initial);
        await scroll.evaluate((el) => el.scrollTo({ top: 10_000 * 36, left: 0, behavior: 'instant' }));
        await wait(page, 250);
        const midRow = table.locator('.vela-st-trade-row[data-trade-index="10000"]');
        await midRow.waitFor({ state: 'attached' });
        const middle = await midRow.evaluate((row) => ({ index: row.getAttribute('aria-rowindex'), text: row.textContent,
            bounds: row.getBoundingClientRect().toJSON(), cells: [...row.cells].map((cell) => { const r = document.createRange(); r.selectNodeContents(cell); return { width: cell.getBoundingClientRect().width, text: r.getBoundingClientRect().width }; }) }));
        assert(middle.index === '10002' && middle.text.includes('10001') && middle.cells.slice(1).every((cell) => cell.width >= cell.text + 14), 'deep virtual row has the correct identity and unclipped large values', middle);
        const midButton = midRow.locator('button');
        await midButton.click();
        await wait(page);
        const expanded = await table.evaluate((el) => ({ total: el.getAttribute('aria-rowcount'), mounted: el.querySelectorAll('.vela-st-trade-row').length,
            detailIndex: el.querySelector('.vela-st-trade-details')?.getAttribute('aria-rowindex'), detail: el.querySelector('.vela-st-trade-details')?.textContent }));
        assert(expanded.total === '20002' && expanded.detailIndex === '10003' && expanded.detail?.includes('Size10001') && expanded.mounted < 50, 'deep trade details belong to the correct row and remain virtualized', expanded);
        const previous = await scroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        await seed(page, { n: 20_001, amount: 1_234_567_890_123.45 });
        const live = await table.evaluate((el) => ({ total: el.getAttribute('aria-rowcount'), detail: el.querySelector('.vela-st-trade-details')?.textContent,
            focused: document.activeElement?.getAttribute('aria-label'), mounted: el.querySelectorAll('.vela-st-trade-row').length }));
        const currentScroll = await scroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        assert(live.total === '20003' && live.detail?.includes('Size10001') && live.focused === 'Trade 10001 details' && live.mounted < 50 && Math.abs(currentScroll.top - previous.top) < 2, 'live updates preserve a deep expanded row, focus and scroll', { previous, currentScroll, live });
        const detailHeight = await table.locator('.vela-st-trade-details').evaluate((el) => el.getBoundingClientRect().height);
        await scroll.evaluate((el, h) => el.scrollTo({ top: 10_040 * 36 + h, behavior: 'instant' }), detailHeight);
        await wait(page, 200);
        const below = table.locator('.vela-st-trade-row[data-trade-index="10040"]');
        await below.waitFor({ state: 'attached' });
        const alignment = await below.evaluate((row) => {
            const scroll = row.closest('.vela-st-scroll'), head = scroll.querySelector('thead th').getBoundingClientRect();
            return { row: row.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON(), head: head.toJSON(), index: row.getAttribute('aria-rowindex') };
        });
        assert(Math.abs(alignment.row.top - alignment.head.bottom) < 2 && alignment.index === '10043', 'variable-height expanded details do not displace or misnumber later rows', { detailHeight, alignment });
        await below.locator('button').focus();
        await page.keyboard.press('End');
        await wait(page);
        const end = await page.evaluate(() => ({ focus: document.activeElement?.getAttribute('aria-label'),
            last: document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-row[data-trade-index="20000"]')?.getAttribute('aria-rowindex'),
            mounted: document.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row').length }));
        assert(end.focus === 'Trade 20001 details' && end.last === '20003' && end.mounted < 50, 'End reaches the final virtual trade by keyboard', end);
        await page.keyboard.press('ArrowUp');
        assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Trade 20000 details', 'arrow keys navigate between virtual trades');
        facts.scale = { initial, middle: { index: middle.index }, expanded: { total: expanded.total, detailIndex: expanded.detailIndex }, live, end };
        await context.close();
    }

    // A long phone ledger retains an expanded middle trade through orientation changes.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await openTester(page, true);
        await seed(page, { n: 500 });
        await select(page, 'Trades', true);
        const scroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        // A live result arriving after touch release must not kill the native momentum.
        await scroll.evaluate((el) => { window.__swipeScroller = el; });
        const bounds = await scroll.boundingBox(), x = bounds.x + bounds.width * 0.7, y = bounds.y + bounds.height * 0.82;
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 100 * i / 8 }] });
            await wait(page, 10);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await wait(page, 30);
        await seed(page, { n: 501 }, 0);
        const duringSwipe = await scroll.evaluate((el) => ({ same: el === window.__swipeScroller, top: el.scrollTop }));
        await wait(page, 700);
        const settledSwipe = await scroll.evaluate((el) => ({ same: el === window.__swipeScroller, top: el.scrollTop,
            count: el.querySelector('.vela-st-trades').getAttribute('aria-rowcount') }));
        assert(duringSwipe.same && !settledSwipe.same && settledSwipe.top > duringSwipe.top + 2 && settledSwipe.count === '502', 'live results wait for a real touch flick to finish before repainting', { duringSwipe, settledSwipe });
        await seed(page, { n: 5_000 });
        await wait(page, 250);
        await scroll.evaluate((el) => el.scrollTo({ top: 2_500 * 44, behavior: 'instant' }));
        await wait(page, 250);
        const button = page.locator('.vela-st-view:not([hidden]) .vela-st-trade-row[data-trade-index="2500"] button');
        await button.tap();
        await wait(page, 200);
        const before = await page.evaluate(() => ({ text: document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-details')?.textContent,
            count: document.querySelector('.vela-st-view:not([hidden]) .vela-st-trades')?.getAttribute('aria-rowcount'),
            mounted: document.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row').length }));
        assert(before.count === '5002' && before.text?.includes('Size2501') && before.mounted < 40, 'deep phone trade can be tapped with a bounded number of rows', before);
        await page.setViewportSize({ width: 780, height: 390 });
        await wait(page, 500);
        const rotated = await page.evaluate(() => ({ mode: document.querySelector('.vela-workspace').dataset.layout,
            text: document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-details')?.textContent,
            mounted: document.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row').length }));
        assert(rotated.mode === 'desktop' && rotated.text?.includes('Size2501') && rotated.mounted < 40, 'landscape keeps the correct expanded trade', rotated);
        await page.setViewportSize({ width: 390, height: 780 });
        await wait(page, 500);
        const restored = await page.evaluate(() => ({ mode: document.querySelector('.vela-workspace').dataset.layout,
            text: document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-details')?.textContent,
            mounted: document.querySelectorAll('.vela-st-view:not([hidden]) .vela-st-trade-row').length }));
        assert(restored.mode === 'mobile' && restored.text?.includes('Size2501') && restored.mounted < 40, 'portrait restores the same detail without loading all trades', restored);
        facts.phoneScale = { duringSwipe, settledSwipe, before: { count: before.count, mounted: before.mounted }, rotated: { mode: rotated.mode, mounted: rotated.mounted }, restored: { mode: restored.mode, mounted: restored.mounted } };
        await context.close();
    }

    assert(errors.length === 0, 'no browser page errors', errors);
    report('strategy-tester-scale', facts);
} finally {
    await browser.close();
}
