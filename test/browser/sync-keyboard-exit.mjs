// R81 — the chart may not own Tab forever.
//
// `Tab` walks the charts (TradingView's chord), but the walk used to WRAP: from a focused
// chart, every press was swallowed by the grid, so focus never left it. That is a keyboard
// trap (WCAG 2.1.2) — the chrome after the grid (bottom bar, time-zone chip, footer) could
// not be reached going forward, only by walking backwards around the whole document.
// Now the walk stops at the last chart and the browser takes the keystroke back.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ viewport: { width: 1280, height: 800 } });
const facts = {};

const where = () =>
    page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { name: '(body)', inCell: false };
        const cell = el.closest('.vela-cell');
        return {
            name: (el.getAttribute('aria-label') || el.className || el.tagName).toString().trim().slice(0, 34),
            inCell: !!cell,
            cellId: cell?.getAttribute('data-cell-id') ?? null,
            canvas: el.tagName === 'CANVAS',
        };
    });

try {
    const cells = await page.evaluate(() => window.__ws.cells().length);
    facts.cells = cells;
    assert(cells >= 4, 'the grid has more than one chart', facts);

    // Focus the FIRST chart's plot, then Tab through the grid. Every press must move the
    // active chart, and one of them must finally leave the grid.
    await page.evaluate(() => {
        const first = window.__ws.cells()[0];
        first.chart.renderer.focus();
    });
    await page.waitForTimeout(120);

    const walk = [];
    for (let i = 0; i < 8; i++) {
        const before = await page.evaluate(() => window.__ws.active?.id ?? null);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(90);
        const after = await where();
        const activeNow = await page.evaluate(() => window.__ws.active?.id ?? null);
        walk.push({ i, before, active: activeNow, focus: after.name, inCell: after.inCell });
        if (!after.inCell) break;
    }
    facts.walk = walk;
    const moved = walk.filter((w) => w.before !== w.active).length;
    assert(moved >= cells - 1, 'Tab walks every chart of the grid', { moved, cells });
    const escaped = walk.find((w) => !w.inCell);
    assert(!!escaped, 'and then Tab LEAVES the grid instead of wrapping forever', walk);

    // The control it lands on is real chrome, not <body>.
    assert(escaped.focus !== '(body)', 'the escape lands on a control', escaped);

    // Shift+Tab still walks back into the grid — the way out is not one-way.
    await page.evaluate(() => window.__ws.cells()[1].chart.renderer.focus());
    await page.waitForTimeout(100);
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(120);
    const back = await where();
    facts.back = back;
    assert(back.name !== null, 'Shift+Tab leaves the focused chart too', back);

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-keyboard-exit', facts);
} finally {
    await browser.close();
}
