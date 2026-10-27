// The table must never widen the page, and must scroll INSIDE itself — measured on the
// phone sheet and the desktop popover at the sizes the product actually ships.
//
// The rule used to be "more than 4 charts ⇒ the table overflows", which was true when
// the cells were wide. The compact table (28px floor, `minmax(28px, 1fr)`) changed the
// fact, not the intent: measured at 1440/1280/1024/900, every desktop width gives a
// 382px table, and 8 columns share it at 30.8px each — all eight visible, well over the
// 24px WCAG 2.2 AA target, no page scroll. Only 16 charts cannot fit (16 × 28 + 74 =
// 522 > 382), and that is the case that must scroll inside its own box and SAY so.
//
// So the assertion is the invariant, not a chart count:
//   • the page never scrolls sideways;
//   • an overflowing table always shows the "more" fade, and a table that fits never
//     claims there is more (both directions — a lying affordance is the real bug);
//   • the overflow is contained in the wrap, so the hidden columns stay reachable;
//   • every column keeps the 28px design floor at every chart count.
import { open, assert, report } from './helpers.mjs';

const FLOOR = 28; // --vela-sx-cell: the design floor; WCAG 2.2 AA wants 24

const measure = async (page) => page.evaluate(() => {
    const wrap = document.querySelector('.vela-lp-charts .vela-md-matrixwrap, .vela-md-matrixwrap[data-shell="phone"]');
    const panel = document.querySelector('.vela-lp');
    if (!wrap) return { table: null, page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }, panel: null };
    const box = wrap.getBoundingClientRect();
    const heads = [...wrap.querySelectorAll('.vela-md-matrix-head[data-cell]')];
    const sizes = heads.map((h) => {
        const r = h.getBoundingClientRect();
        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, visible: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 };
    });
    return {
        table: {
            sw: wrap.scrollWidth,
            cw: wrap.clientWidth,
            more: Boolean(wrap.dataset.more),
            overflowX: getComputedStyle(wrap).overflowX,
            cols: heads.length,
            seen: sizes.filter((s) => s.visible).length,
            cell: { minW: Math.min(...sizes.map((s) => s.w)), minH: Math.min(...sizes.map((s) => s.h)) },
        },
        page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
        panel: panel ? { w: Math.round(panel.getBoundingClientRect().width), right: Math.round(panel.getBoundingClientRect().right) } : null,
    };
});

const facts = {};
for (const charts of ['4', '8', '16']) {
    const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
    try {
        await page.evaluate((id) => window.__ws.setLayout(id), charts);
        await page.waitForTimeout(900);
        await page.click('button[aria-label^="Layout —"]');
        await page.waitForTimeout(500);
        const m = await measure(page);
        const heads = await page.evaluate(() => document.querySelectorAll('.vela-lp-charts .vela-md-matrix-head[data-cell]').length);
        assert(heads === Number(charts), `${charts} charts ⇒ ${charts} columns`, heads);
        assert(m.page.scroll <= m.page.client, `${charts} charts: the page does not scroll sideways`, m.page);
        // The wrap is the scroll container, so extra columns are reachable without moving
        // the page; 'visible' here would let them spill over the panel.
        assert(m.table.overflowX === 'auto' || m.table.overflowX === 'scroll', `${charts} charts: the overflow stays inside the wrap`, m.table.overflowX);
        // Fade ⟺ overflow, in both directions.
        if (m.table.sw > m.table.cw) assert(m.table.more, `${charts} charts: an overflowing table shows the more fade`, m.table);
        else assert(!m.table.more, `${charts} charts: a table that fits does not claim there is more`, m.table);
        // The floor is the rule that replaced the chart count.
        assert(m.table.cell.minW >= FLOOR && m.table.cell.minH >= FLOOR, `${charts} charts: every column keeps the ${FLOOR}px floor`, m.table.cell);
        // If it fits, nothing may be cut off; if it does not, the last column must be out
        // of view — otherwise the fade is pointing at a table that is already whole.
        if (m.table.sw <= m.table.cw) assert(m.table.seen === Number(charts), `${charts} charts: a fitting table shows every column`, m.table.seen);
        else assert(m.table.seen < Number(charts), `${charts} charts: an overflowing table hides what the fade promises`, m.table.seen);
        assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
        facts[charts] = m;
    } finally {
        await browser.close();
    }
}

// Phone: the sheet is the surface; the page still must not scroll sideways.
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const { browser, page, errors } = await open({ viewport: vp, mobile: true });
    try {
        await page.locator('.vela-mb-more').tap();
        await page.waitForTimeout(400);
        // R87: "Chart syncing" is its own door now (the old Sync TAB inside the Layout
        // sheet is gone). Open the door directly to reach the phone matrix.
        await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Chart syncing'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
            const wrap = document.querySelector('.vela-md-matrixwrap[data-shell="phone"]');
            const heads = wrap ? [...wrap.querySelectorAll('.vela-md-matrix-head[data-cell]')] : [];
            const sizes = heads.map((h) => h.getBoundingClientRect());
            return {
                table: wrap
                    ? {
                          sw: wrap.scrollWidth,
                          cw: wrap.clientWidth,
                          cell: sizes.length ? { minW: Math.min(...sizes.map((r) => Math.round(r.width))), minH: Math.min(...sizes.map((r) => Math.round(r.height))) } : null,
                      }
                    : null,
                page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
            };
        });
        assert(m.page.scroll <= m.page.client, `phone ${vp.width}: the page does not scroll sideways`, m.page);
        assert(m.table && m.table.cw <= m.page.client, `phone ${vp.width}: the table fits the sheet`, m.table);
        // A finger-sized cell, not the desktop 28px: the coarse-pointer block must win.
        assert(m.table?.cell && m.table.cell.minW >= 44 && m.table.cell.minH >= 44, `phone ${vp.width}: cells keep the 44px touch target`, m.table?.cell);
        assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
        facts[`phone-${vp.width}`] = m;
    } finally {
        await browser.close();
    }
}

report('sync-table-fit', facts);
