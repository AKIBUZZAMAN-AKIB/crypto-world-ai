// Phone rotation must update the existing workspace without a reload: portrait has
// the phone bar; a wider-than-tall touch viewport has the desktop topbar. Its tools
// scroll while the pair stays fixed, and the same chart survives the round trip.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const snap = () => page.evaluate(() => {
    const root = document.querySelector('.vela-workspace');
    const bar = root?.querySelector('.vela-widget-topbar');
    const mobile = root?.querySelector('.vela-mobilebar');
    const br = bar?.getBoundingClientRect();
    const sym = bar?.querySelector('.vela-widget-symbol')?.getBoundingClientRect();
    const cluster = bar?.querySelector('.vela-topbar-right')?.getBoundingClientRect();
    const cs = (el) => el && getComputedStyle(el).display !== 'none';
    return {
        mode: root?.dataset.layout,
        top: !!br && cs(bar),
        mobile: !!mobile && cs(mobile),
        symbol: window.__ws.active.symbol,
        scroll: bar?.scrollLeft ?? 0,
        max: bar ? bar.scrollWidth - bar.clientWidth : 0,
        barLeft: br?.left ?? null,
        pairLeft: sym?.left ?? null,
        clusterLeft: cluster?.left ?? null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
});

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const portrait = await snap();
    assert(portrait.mode === 'mobile' && portrait.mobile && !portrait.top, 'portrait uses phone bottom bar', portrait);

    await page.setViewportSize({ width: 780, height: 390 });
    await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop', null, { timeout: 8000 });
    await page.evaluate(() => window.__ws.topbar.setTimeframeFavorites?.(['1', '5', '15', '60', '240', 'D', 'W']));
    await page.waitForTimeout(450);
    const landscape = await snap();
    assert(landscape.mode === 'desktop' && landscape.top && !landscape.mobile, 'rotation replaces the bottom bar with desktop chrome', landscape);
    assert(landscape.symbol === portrait.symbol, 'rotation retains the active pair', { portrait, landscape });
    assert(landscape.max > 0 && landscape.overflow === 0, 'landscape toolbar scrolls without page overflow', landscape);

    // Use actual Chromium touch events, not just scrollLeft assignment.
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 580, y: 20 }] });
    for (const x of [550, 500, 450, 400, 350, 300, 250]) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 20 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    const swiped = await snap();
    assert(swiped.scroll > 20, 'a touch swipe scrolls toolbar buttons', swiped);
    assert(Math.abs(swiped.pairLeft - landscape.pairLeft) < 2, 'pair stays pinned during the swipe', { landscape, swiped });
    assert(swiped.clusterLeft < landscape.clusterLeft, 'right-hand actions scroll with the strip', { landscape, swiped });

    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile', null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const restored = await snap();
    assert(restored.mobile && !restored.top, 'rotating back restores the phone bar', restored);
    assert(restored.symbol === portrait.symbol, 'the same pair survives both transitions', { portrait, restored });
    assert(restored.overflow === 0, 'rotation does not introduce horizontal page overflow', restored);
    assert(errors.length === 0, 'no page errors on rotation', errors.slice(0, 3));
    report('sync-phone-rotation', { portrait, landscape, swiped, restored });
} finally {
    await browser.close();
}
