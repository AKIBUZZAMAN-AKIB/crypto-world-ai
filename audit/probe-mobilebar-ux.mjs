// Sandbox-only visual probe: phone-size screenshots of the mobile bar + chart-type sheet.
import { chromium } from 'playwright';

const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:5190/offline.html';
const OUT = process.env.PROBE_OUT ?? '/home/user/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const facts = {};
facts.bar = await page.evaluate(() => {
    const bar = document.querySelector('.vela-mobilebar');
    const r = bar?.getBoundingClientRect();
    const stops = [...(bar?.children ?? [])].map((el) => {
        const b = el.getBoundingClientRect();
        return { cls: el.className, w: Math.round(b.width), label: el.getAttribute('aria-label') };
    });
    return { h: r ? Math.round(r.height) : 0, stops };
});
await page.screenshot({ path: `${OUT}/01-bar.png`, clip: { x: 0, y: 700, width: 390, height: 144 } });

await page.locator('.vela-mb-style').tap();
await page.waitForTimeout(450);
facts.sheet = await page.evaluate(() => {
    const el = document.querySelector('.vela-cts');
    const r = el?.getBoundingClientRect();
    return {
        rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        bg: el ? getComputedStyle(el).backgroundColor : null,
        z: el ? getComputedStyle(el).zIndex : null,
        parent: el?.parentElement?.className ?? null,
        tiles: el?.querySelectorAll('.vela-cts-tile').length ?? 0,
        layoutRow: !!el?.querySelector('.vela-cts-layout'),
    };
});
await page.screenshot({ path: `${OUT}/02-sheet.png` });

await page.locator('.vela-cts-layout').tap().catch(() => {});
await page.waitForTimeout(700);
facts.layoutDoor = await page.evaluate(() => {
    const sheet = document.querySelector('.vela-md-sheet, .vela-md, .vela-drawer');
    const r = sheet?.getBoundingClientRect();
    return { present: !!sheet, rect: r ? { y: Math.round(r.y), h: Math.round(r.height) } : null };
});
await page.screenshot({ path: `${OUT}/03-layout-door.png` });

// A drawing tool armed: does it stay armed after one gesture?
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.evaluate(() => window.__ws.active.chart.drawings.setTool('trendline'));
await page.waitForTimeout(300);
facts.stayDefault = await page.evaluate(() => ({
    stay: window.__ws.active.chart.drawings.getStayMode(),
    tool: window.__ws.active.chart.drawings.getTool(),
}));
facts.drawLabel = await page.evaluate(() => document.querySelector('.vela-mb-drawings')?.getAttribute('aria-label'));
await page.screenshot({ path: `${OUT}/04-armed.png`, clip: { x: 0, y: 700, width: 390, height: 144 } });

facts.errors = errors.slice(0, 3);
console.log(JSON.stringify(facts, null, 1));
await browser.close();
