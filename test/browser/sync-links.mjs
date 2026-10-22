// Gaps 9–11 — the links I had only read in code, never watched move in a browser:
// crosshair (ghost crosshair + the follower's readout), time (a click re-centers the
// grid on that instant), style (our own link: presentation follows, settings do not),
// and the tab link across two REAL pages (BroadcastChannel — jsdom has no second tab).
//
// Runs on playground/offline.html: one deterministic bar array in every cell, so an
// instant, a click and a visible range mean the same thing on every machine.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const bootPage = async () => {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await p.waitForTimeout(1200);
    return p;
};

try {
    const page = await bootPage();

    // ── crosshair ────────────────────────────────────────────────────────────────
    const box = await page.evaluate(() => {
        const r = document.querySelector('.vela-cell').getBoundingClientRect();
        return { x: Math.round(r.x + r.width * 0.35), y: Math.round(r.y + r.height * 0.4) };
    });
    const readouts = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('.vela-cell')].map((c) =>
                (c.querySelector('.vela-sl-ohlc')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            ),
        );
    const rest = await readouts();
    assert(rest.every((t) => t.length > 0), 'a static series still shows its last bar at rest', rest);
    assert(new Set(rest).size === 1, 'the four cells start on the same bar', rest);

    await page.evaluate(() => window.__ws.sync.set('crosshair', true));
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(500);
    const hovered = await readouts();
    assert(hovered[0] !== rest[0], 'hovering rewrites the leader’s readout', { rest: rest[0], hovered: hovered[0] });
    assert(
        hovered.every((t) => t === hovered[0]),
        'every follower shows the SAME bar the leader hovers',
        { leader: hovered[0], followers: hovered.slice(1) },
    );

    // Leaving the chart clears the ghost — the followers go back to their own last bar.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const left = await readouts();
    assert(left.slice(1).every((t) => t === rest[0]), 'leaving the chart clears every ghost', left);

    // ── time (click-to-align) ────────────────────────────────────────────────────
    const ranges = () =>
        page.evaluate(() =>
            window.__ws.cells().map((c) => {
                const r = c.chart.getVisibleRange();
                return r ? [Math.round(r.from), Math.round(r.to)] : null;
            }),
        );
    await page.evaluate(() => window.__ws.sync.set('time', true));
    const beforeRanges = await ranges();
    const clickTime = await page.evaluate(() => {
        const r = window.__ws.active.chart.getVisibleRange();
        return r ? Math.round(r.from + (r.to - r.from) * 0.35) : null;
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(600);
    const afterRanges = await ranges();
    assert(
        JSON.stringify(afterRanges[0]) === JSON.stringify(beforeRanges[0]),
        'the click leaves the leader’s own window alone',
        { before: beforeRanges[0], after: afterRanges[0] },
    );
    const centers = afterRanges.slice(1).map(([from, to]) => Math.round((from + to) / 2));
    assert(
        afterRanges.slice(1).every((r, i) => JSON.stringify(r) !== JSON.stringify(beforeRanges[i + 1])) &&
            centers.every((c, i) => Math.abs(c - clickTime) <= (afterRanges[i + 1][1] - afterRanges[i + 1][0]) * 0.1),
        'every follower re-centers on the clicked instant, keeping its own span',
        { clickTime, centers },
    );

    // ── style (presentation follows, per-chart settings do not) ───────────────────
    await page.evaluate(() => window.__ws.sync.set('style', true));
    await page.evaluate(() => window.__ws.cell('a').setIndicatorTitlesVisible(false));
    await page.waitForTimeout(500);
    const prefs = await page.evaluate(() => window.__ws.cells().map((c) => `${c.id}:${c.statusPrefs().indicatorTitles}`));
    assert(prefs.every((p) => p.endsWith(':false')), 'the style link mirrors the status-line prefs', prefs);

    // The chart TYPE (candles/line/…) is the cell's own — the style link is cosmetic.
    await page.evaluate(() => window.__ws.cell('a').setPriceStyle('line'));
    await page.waitForTimeout(400);
    const styles = await page.evaluate(() => window.__ws.cells().map((c) => `${c.id}:${c.priceStyle}`));
    assert(styles[0].endsWith(':line') && styles.slice(1).every((s) => s.endsWith(':candles')), 'the chart type stays per cell', styles);

    // ── tab link across two pages ────────────────────────────────────────────────
    const peer = await bootPage();
    await page.evaluate(() => window.__ws.setLinkGroup('red'));
    await peer.evaluate(() => window.__ws.setLinkGroup('red'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__ws.cell('a').setSymbol('ZZZ'));
    await page.waitForTimeout(900);
    const mirrored = await peer.evaluate(() => ({ symbol: window.__ws.active.symbol, tag: window.__ws.getState().linkedGroup }));
    assert(mirrored.tag === 'red', 'the peer joined the tag', mirrored);
    assert(/ZZZ/.test(mirrored.symbol), 'the peer’s active chart follows the linked market', mirrored);

    // Unlink → the peer keeps its last market and stops following.
    await peer.evaluate(() => window.__ws.setLinkGroup(null));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__ws.cell('a').setSymbol('YYY'));
    await page.waitForTimeout(900);
    const unlinked = await peer.evaluate(() => window.__ws.active.symbol);
    assert(!/YYY/.test(unlinked), 'an unlinked peer stops following', unlinked);

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-links', { crosshair: hovered.slice(0, 2), clickTime, centers, prefs, styles, linked: mirrored, unlinked });
} finally {
    await browser.close();
}
