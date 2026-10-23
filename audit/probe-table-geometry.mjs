// Round-21 probe: what does the sync table actually do at 4 / 8 / 16 charts?
// Measures the wrap, per-column cell widths, how many columns are fully visible, and
// whether the page itself ever scrolls sideways. The point is to decide whether the
// "8 charts must scroll" assertion is a product rule or a stale number.
import { open, report } from '../test/browser/helpers.mjs';

const measure = async (page) => page.evaluate(() => {
    const wrap = document.querySelector('.vela-lp-charts .vela-md-matrixwrap, .vela-md-matrixwrap[data-shell="phone"]');
    if (!wrap) return null;
    const box = wrap.getBoundingClientRect();
    const heads = [...wrap.querySelectorAll('.vela-md-matrix-head[data-cell]')];
    const label = wrap.querySelector('.vela-md-matrix-label');
    const widths = heads.map((h) => Math.round(h.getBoundingClientRect().width * 10) / 10);
    const visible = heads.filter((h) => {
        const r = h.getBoundingClientRect();
        return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
    }).length;
    return {
        sw: wrap.scrollWidth,
        cw: wrap.clientWidth,
        more: Boolean(wrap.dataset.more),
        cols: heads.length,
        labelW: label ? Math.round(label.getBoundingClientRect().width) : null,
        cell: { min: Math.min(...widths), max: Math.max(...widths) },
        fullyVisible: visible,
        page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
        overflowX: getComputedStyle(wrap).overflowX,
    };
});

const out = {};
for (const width of [1440, 1280, 1024, 900]) {
    for (const charts of ['4', '8', '16']) {
        const { browser, page, errors } = await open({ viewport: { width, height: 900 } });
        try {
            await page.evaluate((id) => window.__ws.setLayout(id), charts);
            await page.waitForTimeout(900);
            await page.click('button[aria-label^="Layout —"]');
            await page.waitForTimeout(500);
            out[`${width}px/${charts}`] = { ...(await measure(page)), errors: errors.length };
        } finally {
            await browser.close();
        }
    }
}
report('round21-table-geometry', out);
