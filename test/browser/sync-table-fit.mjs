// The table must never widen the page, and must scroll INSIDE itself — measured on the
// phone sheet and the desktop popover at the sizes the product actually ships.
import { open, assert, report } from './helpers.mjs';

const measure = async (page) => page.evaluate(() => {
    const wrap = document.querySelector('.vela-lp-charts .vela-md-matrixwrap, .vela-md-matrixwrap[data-shell="phone"]');
    const panel = document.querySelector('.vela-lp');
    return {
        table: wrap ? { sw: wrap.scrollWidth, cw: wrap.clientWidth, more: Boolean(wrap.dataset.more) } : null,
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
        if (Number(charts) > 4) assert(m.table.sw > m.table.cw && m.table.more, `${charts} charts: the table scrolls inside itself`, m.table);
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
        await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Layout'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await page.waitForTimeout(400);
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Sync')?.click());
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
            const wrap = document.querySelector('.vela-md-matrixwrap[data-shell="phone"]');
            return {
                table: wrap ? { sw: wrap.scrollWidth, cw: wrap.clientWidth } : null,
                page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
            };
        });
        assert(m.page.scroll <= m.page.client, `phone ${vp.width}: the page does not scroll sideways`, m.page);
        assert(m.table && m.table.cw <= m.page.client, `phone ${vp.width}: the table fits the sheet`, m.table);
        assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
        facts[`phone-${vp.width}`] = m;
    } finally {
        await browser.close();
    }
}

report('sync-table-fit', facts);
