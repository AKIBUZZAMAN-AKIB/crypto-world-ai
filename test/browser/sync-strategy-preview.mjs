// The optional preview executes a real Pine strategy on the deterministic offline bars.
// The ordinary offline test page has no auto-run and is checked by the tester suite.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = [];
const errors = [];
try {
    for (const [width, height, touch] of [[390, 780, true], [1280, 820, false]]) {
        const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(String(e)));
        const url = new URL(OFFLINE);
        url.searchParams.set('preview', 'strategy');
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.vela-st:visible', { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('.vela-st-view:not([hidden]) .vela-st-title')?.textContent === 'MACD Strategy (demo)', null, { timeout: 30000 });
        const tab = page.getByRole('tab', { name: 'Trades', exact: true });
        if (touch) await tab.tap(); else await tab.click();
        await page.waitForSelector('.vela-st-view:not([hidden]) .vela-st-trade-row');
        const data = await page.evaluate(() => ({ title: document.querySelector('.vela-st-view:not([hidden]) .vela-st-title')?.textContent,
            market: document.querySelector('.vela-st-view:not([hidden]) .vela-st-scope')?.textContent,
            mode: document.querySelector('.vela-workspace').dataset.layout,
            count: document.querySelector('.vela-st-trades').getAttribute('aria-rowcount'),
            rows: document.querySelectorAll('.vela-st-trade-row').length }));
        assert(data.title === 'MACD Strategy (demo)' && Number(data.count) > 1 && data.rows > 0 && data.mode === (touch ? 'mobile' : 'desktop'), 'preview opens a real strategy report for synthetic demo bars', data);
        facts.push({ viewport: [width, height], ...data });
        await context.close();
    }
    assert(errors.length === 0, 'no preview page errors', errors);
    report('strategy-preview', { facts });
} finally {
    await browser.close();
}
