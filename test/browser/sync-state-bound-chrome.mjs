// Chrome that only exists in a state, built BY that state (R70).
//
// Four surfaces used to be created with their chart and kept `display:none` until something
// happened: the "scroll to the latest bar" button, the REPLAY watermark line, the status
// line's replay badge and its show-chart eye. A workspace that never replays, never scrolls
// back and never hides a chart carried all of them — 68 nodes across four cells — and a phone
// paid the same. They are now built the first time their state arrives, and this check is what
// keeps them honest: absent at rest, present (and working) the moment the state lands, gone
// again when it ends — on both size classes.
import { open, assert, report } from './helpers.mjs';

const facts = {};
const HIDE_ROW = /hide chart/i;

// ── 1: nothing at rest, on either size class ───────────────────────────────────────────
const rest = async (page) =>
    page.evaluate(() => ({
        nodes: document.body.querySelectorAll('*').length,
        scrollButtons: document.querySelectorAll('button[aria-label="Scroll to most recent bar"]').length,
        replayWatermarks: document.querySelectorAll('.vela-watermark-replay').length,
        replayBadges: document.querySelectorAll('.vela-sl-replay-badge').length,
        eyes: document.querySelectorAll('.vela-sl-eye').length,
    }));

const desktop = await open({ settle: 2200 });
const d = desktop.page;
const dRest = await rest(d);
facts.desktopRest = dRest;
assert(
    dRest.scrollButtons === 0 && dRest.replayWatermarks === 0 && dRest.replayBadges === 0 && dRest.eyes === 0,
    'a desktop at rest carries none of the state-bound chrome',
    dRest,
);

// ── 2: scrolled back + cursor near the corner ⇒ the button is BUILT and shown ──────────
const cell = await d.evaluate(() => {
    window.__ws.active.chart.panBy(-0.9); // toward history
    const r = document.querySelector('.vela-cell').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await d.waitForTimeout(350);
const parked = await d.evaluate(() => document.querySelectorAll('button[aria-label="Scroll to most recent bar"]').length);
assert(parked === 0, 'scrolled back but with the cursor away, nothing is built yet', parked);
await d.mouse.move(cell.x + cell.w - 40, cell.y + cell.h - 50);
await d.waitForTimeout(250);
const nearCorner = await d.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Scroll to most recent bar"]')].map((b) => ({ display: b.style.display, rect: b.getBoundingClientRect().toJSON() })),
);
facts.nearCorner = nearCorner;
assert(nearCorner.length === 1 && nearCorner[0].display === 'flex', 'the cursor near the corner builds AND reveals it', nearCorner);
const box = nearCorner[0]?.rect;
if (box) await d.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await d.waitForTimeout(1100);
const afterJump = await d.evaluate(() => ({
    display: [...document.querySelectorAll('button[aria-label="Scroll to most recent bar"]')].map((b) => b.style.display),
    to: window.__ws.active.chart.getVisibleRange()?.to ?? null,
}));
facts.afterJump = afterJump;
assert(afterJump.display.every((s) => s === 'none'), 'one click jumps back and puts the button away', afterJump);
assert(
    !!afterJump.to && Date.now() - afterJump.to < 2 * 3600e3,
    '…with the newest bars (not history) on screen again',
    afterJump,
);

// ── 3: a replay builds its watermark + badge, and stopping hides them ──────────────────
await d.evaluate(() => window.__ws.replay.start({ from: Date.now() - 6 * 3600e3 }));
await d.waitForTimeout(1400);
const replaying = await d.evaluate(() => ({
    watermarks: document.querySelectorAll('.vela-watermark-replay').length,
    shownWatermarks: [...document.querySelectorAll('.vela-watermark-replay')].filter((e) => !e.hidden).length,
    badges: document.querySelectorAll('.vela-sl-replay-badge').length,
    shownBadges: [...document.querySelectorAll('.vela-sl-replay-badge')].filter((e) => !e.hidden).length,
    cells: window.__ws.cells().length,
}));
facts.replaying = replaying;
assert(replaying.watermarks === replaying.cells && replaying.shownWatermarks === replaying.cells, 'every chart grows its REPLAY watermark while replaying', replaying);
assert(replaying.badges === replaying.cells && replaying.shownBadges === replaying.cells, '…and its status line its replay badge', replaying);
await d.evaluate(() => window.__ws.replay.stop());
await d.waitForTimeout(900);
const stopped = await d.evaluate(() => ({
    shownWatermarks: [...document.querySelectorAll('.vela-watermark-replay')].filter((e) => !e.hidden).length,
    shownBadges: [...document.querySelectorAll('.vela-sl-replay-badge')].filter((e) => !e.hidden).length,
    status: document.querySelector('.vela-sl-market')?.dataset.status ?? null,
}));
facts.stopped = stopped;
assert(stopped.shownWatermarks === 0 && stopped.shownBadges === 0, 'leaving the replay hides both again', stopped);

// ── 4: hiding the chart builds the eye; clicking it restores the chart ─────────────────
const sl = await d.evaluate(() => document.querySelector('.vela-statusline').getBoundingClientRect().toJSON());
await d.mouse.click(sl.x + 60, sl.y + sl.height / 2, { button: 'right' });
await d.waitForTimeout(350);
const row = await d.evaluate(() => {
    const r = [...document.querySelectorAll('.vela-menu-item')].find((m) => /hide chart/i.test(m.textContent) && m.getBoundingClientRect().height > 0);
    const b = r?.getBoundingClientRect();
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
});
assert(!!row, 'the status line still offers its own menu with the Hide chart row', row);
if (row) await d.mouse.click(row.x, row.y);
await d.waitForTimeout(450);
const hiddenChart = await d.evaluate(() => ({
    eyes: document.querySelectorAll('.vela-sl-eye').length,
    shown: [...document.querySelectorAll('.vela-sl-eye')].filter((e) => e.style.display !== 'none').length,
    visible: (() => {
        try {
            return window.__ws.active.inner.renderer.get('candleVisible');
        } catch {
            return null;
        }
    })(),
    dimmed: document.querySelectorAll('.vela-sl-chart-hidden').length,
}));
facts.hiddenChart = hiddenChart;
assert(hiddenChart.visible === false && hiddenChart.eyes === 1 && hiddenChart.shown === 1, 'hiding the chart builds its show-chart eye', hiddenChart);
assert(hiddenChart.dimmed >= 1, '…and dims the status line like a hidden indicator', hiddenChart);
await d.evaluate(() => document.querySelector('.vela-sl-eye')?.click());
await d.waitForTimeout(450);
const shownAgain = await d.evaluate(() => ({
    visible: (() => {
        try {
            return window.__ws.active.inner.renderer.get('candleVisible');
        } catch {
            return null;
        }
    })(),
    shown: [...document.querySelectorAll('.vela-sl-eye')].filter((e) => e.style.display !== 'none').length,
    dimmed: document.querySelectorAll('.vela-sl-chart-hidden').length,
}));
facts.shownAgain = shownAgain;
assert(shownAgain.visible !== false && shownAgain.shown === 0 && shownAgain.dimmed === 0, 'the eye brings the chart back and puts itself away', shownAgain);
facts.desktopAfter = await d.evaluate(() => document.body.querySelectorAll('*').length);
assert(desktop.errors.length === 0, 'no page errors (desktop)', desktop.errors);
await desktop.browser.close();

// ── 5: a phone — no hover, so a scroll back alone must build the button ────────────────
const phone = await open({ settle: 2000, mobile: true, viewport: { width: 390, height: 780 } });
const m = phone.page;
const mRest = await rest(m);
facts.phoneRest = mRest;
assert(mRest.scrollButtons === 0 && mRest.replayWatermarks === 0 && mRest.eyes === 0, 'a phone at rest carries none of it either', mRest);
await m.evaluate(() => window.__ws.active.chart.panBy(-0.9));
await m.waitForTimeout(500);
const mScrolled = await m.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Scroll to most recent bar"]')].map((b) => ({ display: b.style.display, rect: b.getBoundingClientRect().toJSON() })),
);
facts.phoneScrolled = mScrolled;
assert(mScrolled.length === 1 && mScrolled[0].display === 'flex', 'a phone builds the button on the scroll itself (no hover to wait for)', mScrolled);
const mb = mScrolled[0]?.rect;
if (mb) await m.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
await m.waitForTimeout(900);
const mJumped = await m.evaluate(() => ({ display: [...document.querySelectorAll('button[aria-label="Scroll to most recent bar"]')].map((b) => b.style.display), to: window.__ws.active.chart.getVisibleRange()?.to ?? null }));
facts.phoneJumped = mJumped;
assert(mJumped.display.every((s) => s === 'none') && !!mJumped.to && Date.now() - mJumped.to < 2 * 3600e3, 'a tap jumps back to the latest bar', mJumped);
assert(phone.errors.length === 0, 'no page errors (phone)', phone.errors);
await phone.browser.close();

report('state-bound-chrome', facts);
