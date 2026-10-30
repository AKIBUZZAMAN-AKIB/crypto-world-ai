// Desktop/landscape toolbar: the pair alone is pinned and all remaining controls,
// including the old right-hand cluster, can scroll into view without clipping the page.
import { BASE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};

async function boot(width, height) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${width}: ${e}`));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__ws.topbar.setTimeframeFavorites?.(['1', '5', '15', '60', '240', 'D', 'W']));
    await page.waitForTimeout(600);
    return { context, page };
}

async function read(page) {
    return page.evaluate(() => {
        const bar = document.querySelector('.vela-widget-topbar');
        if (!bar) return null;
        const bounds = bar.getBoundingClientRect();
        const symbol = bar.querySelector('.vela-widget-symbol')?.getBoundingClientRect();
        const right = bar.querySelector('.vela-topbar-right');
        const items = [...(right?.querySelectorAll('button') ?? [])].filter((b) => !b.hidden);
        const last = items.at(-1)?.getBoundingClientRect();
        return {
            left: bar.scrollLeft,
            max: bar.scrollWidth - bar.clientWidth,
            scroll: bar.dataset.scroll,
            edgeStart: bar.dataset.edgeStart,
            edgeEnd: bar.dataset.edgeEnd,
            barLeft: bounds.left,
            barRight: bounds.right,
            symbolLeft: symbol?.left,
            symbolRight: symbol?.right,
            rightPosition: right ? getComputedStyle(right).position : null,
            rightLeft: right?.getBoundingClientRect().left,
            lastRight: last?.right,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
}

try {
    const { context, page } = await boot(940, 800);
    const before = await read(page);
    facts.before = before;
    assert(before?.max > 0 && before.scroll === '1', 'narrow toolbar overflows horizontally', before);
    assert(before.rightPosition !== 'sticky', 'the right-hand controls are not pinned', before);
    assert(before.pageOverflow === 0, 'toolbar overflow does not widen the page', before);

    const y = await page.evaluate(() => {
        const r = document.querySelector('.vela-widget-topbar').getBoundingClientRect();
        return r.top + r.height / 2;
    });
    await page.mouse.move(420, y);
    await page.mouse.down();
    await page.mouse.move(220, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const dragged = await read(page);
    facts.dragged = dragged;
    assert(dragged.left > before.left + 50, 'dragging scrolls the tools', { before, dragged });
    assert(Math.abs(dragged.symbolLeft - before.symbolLeft) < 2, 'pair stays pinned while dragging', { before, dragged });

    await page.mouse.move(400, y);
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(200);
    const wheeled = await read(page);
    facts.wheeled = wheeled;
    assert(wheeled.left < dragged.left, 'wheel scrolls the strip back', { dragged, wheeled });

    // Symbol wheel is reserved for symbol selection, not toolbar scrolling.
    const pairWheel = await page.evaluate(() => {
        const bar = document.querySelector('.vela-widget-topbar');
        const pair = bar.querySelector('.vela-widget-symbol');
        const left = bar.scrollLeft;
        pair.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        return { before: left, after: bar.scrollLeft };
    });
    facts.pairWheel = pairWheel;
    assert(pairWheel.before === pairWheel.after, 'the pair wheel does not scroll the toolbar', pairWheel);

    await page.evaluate(() => { const bar = document.querySelector('.vela-widget-topbar'); bar.scrollLeft = bar.scrollWidth; });
    await page.waitForTimeout(150);
    const end = await read(page);
    facts.end = end;
    assert(end.left >= end.max - 2, 'the strip reaches its end', end);
    assert(end.lastRight <= end.barRight + 1, 'the last right-hand button is reachable', end);
    assert(end.rightLeft < before.rightLeft - 20, 'right-hand buttons travel with the strip', { before, end });
    assert(Math.abs(end.symbolLeft - before.symbolLeft) < 2, 'pair stays pinned at the end', { before, end });
    assert(end.pageOverflow === 0, 'scrolling the strip never scrolls the page sideways', end);

    await page.evaluate(() => { document.querySelector('.vela-widget-topbar').scrollLeft = 0; });
    await page.waitForTimeout(120);
    await page.locator('.vela-widget-templates').click();
    await page.waitForSelector('.vela-tm', { timeout: 5000 });
    facts.buttonOpens = true;
    assert(errors.length === 0, 'no page errors', errors.slice(0, 3));
    await context.close();

    const wide = await boot(1600, 900);
    const roomy = await read(wide.page);
    facts.wide = roomy;
    assert(roomy.scroll === '0' && roomy.max <= 1, 'wide toolbar fits without scrolling', roomy);
    assert(roomy.pageOverflow === 0, 'wide page has no horizontal overflow', roomy);
    await wide.context.close();
    report('sync-topbar-overflow', facts);
} finally {
    await browser.close();
}
