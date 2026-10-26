// R59 — chrome that has ROOM stays on screen, measured by height AND width. The indicator legend (title, values, eye,
// gear, ×) and the bottom chart controls must not be a per-device decision: a phone with
// space keeps its rows exactly as a desktop does, and only a genuinely cramped pane falls
// back to the count chip + the object tree. Measured at three real sizes, because the bug
// was a MODE switch, not a CSS rule: `setLayoutMode('mobile')` folded every legend, and
// the per-cell cluster was suspended outright, so a phone user had to drive everything
// through the object tree over a plot that was 80% empty.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};

const readonly = (page) =>
    page.evaluate(() => {
        const disp = (el) => (el ? getComputedStyle(el).display : 'missing');
        const lg = document.querySelector('[data-vela-pane="price"]');
        const rows = lg ? [...lg.children].filter((c) => !c.classList.contains('vela-ind-fold')) : [];
        const fold = lg?.querySelector('.vela-ind-fold') ?? null;
        const resetBtn = document.querySelector('.vela-cc-btn[aria-label="Reset chart"]');
        const reset = resetBtn ? resetBtn.parentElement : null;
        const scroll = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Scroll to most recent'));
        const box = (el) => (el ? Math.round(el.getBoundingClientRect().width) : 0);
        return {
            rows: rows.length,
            rowsShown: rows.filter((r) => getComputedStyle(r).display !== 'none').length,
            chip: fold ? { text: (fold.textContent ?? '').trim(), disp: disp(fold), label: fold.getAttribute('aria-label') } : null,
            reset: reset ? { disp: disp(reset), w: box(resetBtn), alone: reset.children.length } : null,
            studies: window.__ws.active.chart.indicators().length,
            scroll: scroll ? { disp: disp(scroll), w: box(scroll) } : null,
            paneH: Math.round(lg?.parentElement?.getBoundingClientRect().height ?? 0),
            inner: window.innerWidth,
            over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

const boot = async (width, height, mobile) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${width}x${height}: ${e}`));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(900);
    return { context, page };
};

try {
    // ── 1. a PHONE with room: rows, the fold chip, the reset chip, the go-right button ──
    {
        const { context, page } = await boot(390, 780, true);
        // One chart on the phone, exactly as the shell presents it: the pooled cells are
        // not on screen, so the plot really does have the room this case is about.
        await page.evaluate(() => window.__ws.setLayout('1'));
        await page.waitForTimeout(700);
        await page.evaluate(() => {
            const c = window.__ws.active.chart;
            c.addIndicator('moving-average');
            c.addIndicator('bollinger-bands');
        });
        await page.waitForTimeout(900);
        const m = await readonly(page);
        facts.phone = m;

        assert(m.rows >= 1, 'phone: the price legend has its indicator rows', m);
        assert(m.rowsShown === m.rows, 'phone: every row is VISIBLE over an empty plot (no forced fold)', m);
        assert(m.chip != null && m.chip.disp !== 'none', 'phone: the fold chip is there to tuck them away', m.chip);
        assert(m.reset != null && m.reset.disp !== 'none' && m.reset.w >= 24, 'phone: the Reset chart chip is out, at a finger-sized target', m.reset);

        // Pan into the past: the go-right door must appear on its own (no hover to reveal it).
        await page.evaluate(() => window.__ws.active.chart.panBy(-2));
        await page.waitForTimeout(700);
        const panned = await readonly(page);
        facts.phonePanned = panned;
        assert(panned.scroll != null && panned.scroll.disp !== 'none', 'phone: Scroll-to-latest appears once the newest bar is off screen', panned.scroll);
        assert(panned.scroll.w >= 32, 'phone: …at a finger-sized target (32px, not the 26px cursor chip)', panned.scroll);

        // …and the reset chip really resets.
        const before = await page.evaluate(() => window.__ws.active.chart.getVisibleRange()?.to ?? 0);
        const r = await page.evaluate(() => {
            const b = document.querySelector('.vela-cc-btn[aria-label="Reset chart"]');
            const box = b.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        await page.touchscreen.tap(r.x, r.y);
        await page.waitForTimeout(900);
        const after = await page.evaluate(() => window.__ws.active.chart.getVisibleRange()?.to ?? 0);
        facts.phoneReset = { before, after };
        assert(after > before, 'phone: tapping the chip frames the whole history again', facts.phoneReset);
        assert(m.over === 0, 'phone: nothing pans sideways', m.over);
        await context.close();
    }

    // ── 1b. a PHONE showing a 2x2 grid: that cell is genuinely narrow, so it folds ──
    {
        const { context, page } = await boot(390, 780, true);
        const m = await readonly(page);
        facts.phoneGrid = m;
        assert(m.rows >= 1, 'phone grid: the row exists', m);
        assert(m.rowsShown === 0 && m.chip != null && /^\d+$/.test(m.chip.text), 'phone grid: a ~190px cell folds its legend behind the count chip', m);
        await context.close();
    }

    // ── 2. a DESKTOP with room: unchanged (rows out, no chip for a lone row) ──
    {
        const { context, page } = await boot(1280, 900, false);
        await page.evaluate(() => window.__ws.active.chart.addIndicator('moving-average'));
        await page.waitForTimeout(900);
        const m = await readonly(page);
        facts.desktop = m;
        assert(m.rowsShown === m.rows && m.rows >= 1, 'desktop: rows out while the pane holds them', m);
        assert(m.chip === null, 'desktop: no chip for a single row (the old rule, kept)', m.chip);
        // The cluster is BUILT by the first hover, so on a pointer device that has not
        // hovered the bottom-centre yet there is nothing in the document at all.
        assert(m.reset == null || m.reset.disp === 'none', 'desktop: the cluster stays a hover reveal', m.reset);
        await context.close();
    }

    // ── 3. a DESKTOP with NO room: the same rule folds it, and the chip still opens it ──
    {
        const { context, page } = await boot(1280, 200, false);
        const m = await readonly(page);
        facts.cramped = m;
        assert(m.paneH > 0 && m.paneH < 80, 'cramped: the cell really is short (measured, not assumed)', m.paneH);
        assert(m.rows >= 1 && m.rowsShown === 0, 'cramped: the row folds away — space, not the device, decided it', m);
        assert(m.chip != null && /^\d+$/.test(m.chip.text), 'cramped: the chip counts what it folded', m.chip);
        // The user is never trapped: the chip's press unfolds in place, cramped or not.
        await page.evaluate(() => document.querySelector('.vela-ind-fold').click());
        await page.waitForTimeout(400);
        const opened = await readonly(page);
        facts.crampedOpened = opened;
        assert(opened.rowsShown === opened.rows, 'cramped: pressing the chip shows the rows anyway (manual override)', opened);
        await context.close();
    }

    // ── 4. the SAME short cell with room in it: rows stay out (the rule is not "short ⇒ fold") ──
    {
        const { context, page } = await boot(1280, 260, false);
        const m = await readonly(page);
        facts.roomy = m;
        assert(m.rowsShown === m.rows && m.rows >= 1, 'a cell just tall enough keeps its row visible', m);
        assert(m.chip === null, 'and grows no chip it does not need', m.chip);
        await context.close();
    }

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-legend-fit', facts);
} finally {
    await browser.close();
}
