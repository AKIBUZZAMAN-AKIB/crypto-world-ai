// The preview uses the real pane on the deterministic offline bars; no fake alerts are seeded.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = [], errors = [];
try {
    for (const [width, height, touch] of [[390, 780, true], [1280, 820, false]]) {
        const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
        const page = await context.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
        const url = new URL(OFFLINE); url.searchParams.set('preview', 'alerts');
        await page.goto(url.href); await page.waitForSelector('.vela-ap:visible');
        const info = await page.evaluate(() => ({ title: document.title, symbol: document.querySelector('.vela-ac-target-title')?.textContent,
            level: document.querySelector('.vela-ac-input')?.value, tabs: [...document.querySelectorAll('.vela-ap [role="tab"]')].map((e) => e.getAttribute('aria-label') || e.textContent.trim()),
            alerts: window.__ws.getState().priceAlerts?.length ?? 0, log: window.__ws.alertEntries().length,
            layout: document.querySelector('.vela-workspace').dataset.layout }));
        assert(info.title.includes('synthetic') && info.symbol.includes('AAA') && Number.isFinite(Number(info.level)) && info.tabs.join(',') === 'Create,Alerts,Log' && info.alerts === 0 && info.log === 0 && info.layout === (touch ? 'mobile' : 'desktop'), 'preview opens the actual form without invented demo alerts', info);
        facts.push({ viewport: [width, height], ...info });
        await context.close();
    }
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(OFFLINE); await page.waitForFunction(() => window.__ws?.cells().length >= 1); await page.waitForTimeout(350);
    assert(await page.locator('.vela-ap:visible').count() === 0, 'ordinary offline fixture remains unchanged');
    await context.close();
    assert(errors.length === 0, 'no browser page errors', errors);
    report('alerts-preview', { facts, errors });
} finally { await browser.close(); }
