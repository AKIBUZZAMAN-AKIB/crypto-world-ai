// Gaps 12 + 17 — touch targets and the widths nobody measured. The table/popover were
// only ever checked at 1440 and at phone sizes; the 560–720 band (a small laptop window,
// a tablet in portrait with a sidebar) was a hole, and a coarse pointer changes both the
// cell size and the chip height. Measured on the deterministic offline page.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const facts = {};

const openDesktop = async (width) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    return { context, page, errors };
};

try {
    // ── gap 17: 560 … 720 px ─────────────────────────────────────────────────────
    // This band crosses the shell breakpoint: narrow windows get the PHONE shell (bottom
    // bar + More drawer), wider ones the desktop topbar. The check follows whichever
    // shell is live and measures the popover/sheet in it.
    for (const width of [560, 600, 640, 680, 720]) {
        const { context, page, errors } = await openDesktop(width);
        try {
            const shell = await page.evaluate(() => {
                const more = document.querySelector('.vela-mb-more');
                return more && more.offsetWidth > 0 ? 'phone' : 'desktop';
            });
            if (shell === 'phone') {
                await page.evaluate(() => document.querySelector('.vela-mb-more')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
                await page.waitForTimeout(400);
                // R87: Chart syncing is its OWN door now (the old "Sync" TAB inside the
                // Layout sheet is gone). Open the door directly to reach the matrix.
                await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Chart syncing'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
            } else {
                await page.click('button[aria-label^="Layout —"]');
            }
            await page.waitForTimeout(450);
            const m = await page.evaluate(() => {
                // The drawer keeps BOTH shells' tables in the DOM (one hidden) — take the live one.
                const wrap = [...document.querySelectorAll('.vela-md-matrixwrap')].find((w) => w.clientWidth > 0) ?? null;
                const sec = [...document.querySelectorAll('.vela-md-sec')].find((e) => e.getBoundingClientRect().width > 0);
                const pop = document.querySelector('.vela-lp');
                const sheet = pop && pop.getBoundingClientRect().width > 0 ? pop : sec;
                const r = sheet?.getBoundingClientRect();
                return {
                    page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
                    sheet: r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null,
                    table: wrap ? { sw: wrap.scrollWidth, cw: wrap.clientWidth } : null,
                };
            });
            assert(m.page.scroll <= m.page.client, `${width}px: the page does not scroll sideways`, m.page);
            assert(m.sheet && m.sheet.left >= 0 && m.sheet.right <= width + 1, `${width}px: the surface stays inside the window`, m.sheet);
            assert(m.table && m.table.cw <= width, `${width}px: the table fits its pane`, m.table);
            assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
            facts[width] = { shell, ...m };
        } finally {
            await context.close();
        }
    }

    // ── gap 12: a coarse pointer ─────────────────────────────────────────────────
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
        const context = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
        await page.waitForTimeout(1000);
        try {
            await page.locator('.vela-mb-more').tap();
            await page.waitForTimeout(350);
            // R87: "Chart syncing" is its own door (the old Sync TAB is gone).
            await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Chart syncing'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
            await page.waitForTimeout(400);
            const m = await page.evaluate(() => {
                const coarse = matchMedia('(pointer: coarse)').matches;
                const cell = document.querySelector('.vela-md-matrixwrap[data-shell="phone"] .vela-md-chip');
                const chip = document.querySelector('.vela-md-matrixwrap[data-shell="phone"] .vela-md-chip');
                const row = document.querySelector('.vela-md-row');
                const rect = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
                return { coarse, cell: rect(cell), tap: rect(chip ?? row), row: rect(row), page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth } };
            });
            assert(m.coarse, `${vp.width}: the context reports a coarse pointer`, m.coarse);
            assert(m.cell && m.cell.h >= 38 && m.cell.w >= 38, `${vp.width}: matrix cells are at least 38px`, m.cell);
            assert(m.tap && m.tap.h >= 34, `${vp.width}: the tap rows are at least 34px`, m.tap);
            assert(m.page.scroll <= m.page.client, `${vp.width}: no sideways page scroll`, m.page);
            assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
            facts[`touch-${vp.width}`] = m;
        } finally {
            await context.close();
        }
    }

    report('sync-responsive', facts);
} finally {
    await browser.close();
}
