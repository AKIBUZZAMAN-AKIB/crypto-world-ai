// R60 — the desktop topbar when the window is NARROWER than the chrome.
//
// Favourite intervals, a long layout name and the docked-panel toggles add up; the bar
// used to push its last tools (and the page) off the right edge with nothing to grab, so
// a tool could simply not be reached and the page itself scrolled sideways. Now it is ONE
// scrollable strip: it never wraps, never widens the page, keeps the pair pinned at the
// start and the tools pinned at the end, and can be dragged, wheeled or tabbed through.
// Measured on the live workspace page, with chrome loaded to make it overflow.
import { BASE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};

/** Load the page and make the bar genuinely crowded: 7 favourite intervals + every panel. */
const boot = async (width, height) => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${width}: ${e}`));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
        const ws = window.__ws;
        ws.topbar.setTimeframeFavorites?.(['1', '5', '15', '60', '240', 'D', 'W']);
        for (const p of ws.dock?.list?.() ?? []) {
            try {
                ws.dock.toggle(p.id);
            } catch {
                /* a panel that refuses to dock is not this check's subject */
            }
        }
    });
    await page.waitForTimeout(900);
    return { context, page };
};

const read = (page) =>
    page.evaluate(() => {
        const bar = document.querySelector('.vela-widget-topbar');
        if (!bar) return { shell: 'phone' };
        const r = bar.getBoundingClientRect();
        const right = bar.querySelector('.vela-topbar-right')?.getBoundingClientRect() ?? null;
        const sym = bar.querySelector('.vela-widget-symbol')?.getBoundingClientRect() ?? null;
        const label = (b) => (b.getAttribute('aria-label') || b.title || b.textContent || '?').trim().slice(0, 20);
        const pastRight = [...bar.querySelectorAll('button')]
            .filter((b) => {
                const q = b.getBoundingClientRect();
                return q.width > 0 && q.right > innerWidth + 0.5;
            })
            .map(label);
        return {
            shell: 'desktop',
            scroll: bar.dataset.scroll,
            edgeStart: bar.dataset.edgeStart,
            edgeEnd: bar.dataset.edgeEnd,
            left: Math.round(bar.scrollLeft),
            max: Math.round(bar.scrollWidth - bar.clientWidth),
            pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            barOver: Math.round(r.right - innerWidth),
            rightVisible: !!right && right.right <= innerWidth + 0.5 && right.left >= -0.5,
            symVisible: !!sym && sym.left >= -0.5,
            pastRight,
            pastLeft: [...bar.querySelectorAll('button')]
                .filter((b) => {
                    const q = b.getBoundingClientRect();
                    return q.width > 0 && q.left < -0.5;
                })
                .map(label),
            dragging: bar.dataset.dragging ?? null,
        };
    });

const stripY = (page) =>
    page.evaluate(() => {
        const r = document.querySelector('.vela-widget-topbar').getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
    });

try {
    // ── 1. a narrow desktop: the strip scrolls, nothing is lost off the edge ──────
    {
        const { context, page } = await boot(940, 800);
        const m = await read(page);
        facts.narrow = m;
        assert(m.shell === 'desktop', 'the 940px window keeps the desktop shell', m.shell);
        assert(m.max > 0 && m.scroll === '1', 'the crowded bar is a scrollable strip', m);
        assert(m.rightVisible && m.symVisible, 'the pair stays pinned left and the tools pinned right', m);
        assert(m.pastRight.length === 0, 'no tool sits past the right edge of the window', m.pastRight);
        assert(m.pageOver === 0 && m.barOver <= 0, 'the bar never widens the page', { pageOver: m.pageOver, barOver: m.barOver });
        assert(m.edgeEnd === '1' && m.edgeStart === '0', 'at rest the fade marks the end that has more', m);

        // …dragging the strip slides it (press, move past the 4px threshold, release)
        const y = await stripY(page);
        await page.mouse.move(320, y);
        await page.mouse.down();
        await page.mouse.move(140, y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const dragged = await read(page);
        facts.narrowDragged = dragged;
        assert(dragged.left > 0, 'a press-and-drag on the strip scrolls it', dragged.left);
        assert(dragged.pastRight.length === 0, '…and nothing escapes past the right edge while it slides', dragged.pastRight);
        assert(dragged.rightVisible && dragged.symVisible, 'the pinned ends hold while it scrolls', dragged);
        assert(dragged.edgeStart === '1', 'both ends now have content scrolled away', dragged);
        assert(dragged.dragging === null, 'releasing clears the dragging state', dragged.dragging);

        // …the wheel moves the strip, not the page
        await page.mouse.move(400, y);
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(300);
        const wheeled = await read(page);
        facts.narrowWheeled = wheeled;
        assert(wheeled.left < dragged.left, 'the wheel slides the strip back', { before: dragged.left, after: wheeled.left });
        assert(wheeled.pageOver === 0, 'and does not pan the page', wheeled.pageOver);

        // …and scrolled to the very end, the LAST middle tool clears the pinned cluster:
        // the strip reserves the cluster's width at its own end, so no tool can hide under
        // it for good (it used to: the scroll range ended exactly at the pinned edge).
        const reach = await page.evaluate(() => {
            const bar = document.querySelector('.vela-widget-topbar');
            bar.scrollLeft = bar.scrollWidth;
            const cluster = document.querySelector('.vela-topbar-right').getBoundingClientRect();
            const mids = [...bar.querySelectorAll('button')].filter((b) => !b.closest('.vela-topbar-right') && !b.closest('.vela-widget-symbol'));
            const last = mids[mids.length - 1];
            const r = last.getBoundingClientRect();
            const out = {
                last: (last.getAttribute('aria-label') || last.className).slice(0, 40),
                lastRight: Math.round(r.right),
                clusterLeft: Math.round(cluster.left),
                clear: r.right <= cluster.left + 0.5,
                pad: Math.round(document.querySelector('.vela-topbar-endpad').getBoundingClientRect().width),
            };
            bar.scrollLeft = 0;
            return out;
        });
        facts.narrowReach = reach;
        assert(reach.clear, 'at full scroll the last tool is clear of the pinned cluster (every tool is reachable)', reach);

        // …and a plain CLICK still presses its button (the drag threshold keeps clicks alive)
        await page.evaluate(() => {
            document.querySelector('.vela-widget-topbar').scrollLeft = 0;
        });
        await page.waitForTimeout(150);
        await page.click('.vela-widget-templates');
        await page.waitForTimeout(400);
        // The Templates dropdown is a popover with its own card (`.vela-tm`), not a kit menu —
        // a `.vela-menu` check would have passed on any other menu's leftover layer.
        const opened = await page.evaluate(() => !!document.querySelector('.vela-tm'));
        facts.narrowClick = { opened };
        assert(opened, 'a click on a tool opens it (a drag would have swallowed it)', opened);
        await context.close();
    }

    // ── 2. a wide desktop: nothing scrolls, nothing fades ────────────────────────
    {
        const { context, page } = await boot(1600, 900);
        const m = await read(page);
        facts.wide = m;
        assert(m.scroll === '0' && m.max === 0, 'a wide window has nothing to scroll', m);
        assert(m.edgeStart === '0' && m.edgeEnd === '0', 'no fade when there is no overflow', m);
        assert(m.pastRight.length === 0 && m.pastLeft.length === 0 && m.pageOver === 0, 'and nothing is displaced', m);
        await context.close();
    }

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-topbar-overflow', facts);
} finally {
    await browser.close();
}
