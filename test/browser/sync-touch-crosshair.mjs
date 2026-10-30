// Real Chromium/CDP touch stream against the existing deterministic offline workspace.
// Checks input ownership, actual canvas pixels, OHLC/volume values and synced charts;
// no synthetic HTML harness and no screenshots/files are created.
import { OFFLINE, open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ base: OFFLINE, viewport: { width: 390, height: 780 }, mobile: true, settle: 800 });
const client = await page.context().newCDPSession(page);
const wait = (ms = 120) => page.waitForTimeout(ms);
const touch = (type, points = []) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const point = (x, y, id = 1) => ({ x: Math.round(x), y: Math.round(y), id });
const down = (p) => touch('touchStart', [p]);
const move = (p) => touch('touchMove', [p]);
const up = () => touch('touchEnd', []);
const tap = async (p) => { await down(p); await wait(35); await up(); await wait(); };
const hold = async (p) => { await down(p); await wait(440); };

const geometry = (cellId) => page.evaluate((id) => {
    const cell = id ? window.__ws.cell(id) : window.__ws.active;
    const r = cell.chart.renderer.renderer;
    const b = r.dataCanvas.getBoundingClientRect();
    return { id: cell.id, x: b.x, y: b.y, width: r.coords.width, height: r.coords.height, canvasW: b.width, canvasH: b.height };
}, cellId);
const at = (g, fx, fy) => point(g.x + g.width * fx, g.y + g.height * fy);
const state = async () => {
    await wait();
    return page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        const ch = r.scene.crosshair;
        const pane = ch ? [...r.scene.panes.values()].find((p) => ch.y >= p.bounds.top && ch.y <= p.bounds.top + p.bounds.height) : null;
        const idx = ch ? Math.round(r.coords.xToLogical(ch.x)) : -1;
        const bar = idx >= 0 && idx < r.bars.length ? r.bars[idx] : null;
        const canvas = r.cursorCanvas;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let pixels = 0, rightChip = 0, bottomChip = 0;
        const dp = r.coords.dpr;
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                if (!data[(y * canvas.width + x) * 4 + 3]) continue;
                pixels++;
                if (x > (r.coords.width + 2) * dp && y < r.coords.height * dp) rightChip++;
                if (y > (r.coords.height + 2) * dp && x < r.coords.width * dp) bottomChip++;
            }
        }
        const event = window.__touchReadouts?.at(-1) ?? null;
        return {
            tracking: r.input.isTracking, dragging: r.input.dragging, touches: r.input.touches.size, introActive: r.introRaf !== null,
            flag: r.mountContainer.dataset.velaTracking ?? '', ch, pixels, rightChip, bottomChip,
            view: r.coords.getViewport(), width: r.coords.width, height: r.coords.height,
            barCount: r.bars.length, idx, bar,
            expectedPrice: ch && pane && r.bars.length ? r.coords.yToPrice(ch.y, pane.scale, pane.bounds) : null,
            event, dataWindow: r.getDataWindowReadout(),
            statusBarTime: window.__ws.active.statusline.lastBar?.time,
            visibleTo: window.__ws.active.chart.getVisibleRange()?.to,
            status: (window.__ws.active.host.querySelector('.vela-sl-ohlc')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        };
    });
};
const accurate = (s) => !!s.ch && !!s.bar && s.event?.time === s.bar.time && s.event?.ohlc?.close === s.bar.close && Math.abs(s.event.price - s.expectedPrice) < 1e-7;

try {
    await page.evaluate(() => {
        window.__ws.setLayout('1');
        window.__touchReadouts = [];
        window.__ws.active.chart.renderer.onCrosshairMove((e) => window.__touchReadouts.push({ time: e.time, price: e.price, paneKind: e.paneKind, ohlc: e.ohlc, values: [...e.values] }));
        window.__volumeId = window.__ws.active.chart.panes.list().flatMap((pane) => pane.indicators).find((indicator) => indicator.title === 'Volume')?.id;
    });
    await page.waitForFunction(() => window.__ws.active.chart.renderer.renderer.bars.length === 800, null, { timeout: 15000 });
    await wait(1000);
    let g = await geometry();
    const p = at(g, 0.42, 0.58);
    const before = await state();
    assert(before.statusBarTime === before.visibleTo, 'default OHLC uses the inclusive last visible candle', { statusBarTime: before.statusBarTime, visibleTo: before.visibleTo });

    // A natural small wobble must be treated as a hold, not as pan or a stale location.
    await down(p);
    await move(point(p.x + 6, p.y + 4));
    await wait(450);
    const held = await state();
    assert(held.tracking && held.flag === '1' && held.pixels > 1000, 'long hold paints the crosshair and marks tracking', held);
    assert(Math.abs(held.ch.x - (p.x + 6 - g.x)) < 1 && Math.abs(held.ch.y - (p.y + 4 - g.y)) < 1, 'hold follows the current contact, not the old landing point', held);
    assert(Math.abs(held.view.rightOffset - before.view.rightOffset) < 1e-8, 'wobble did not pan before activation', { before: before.view, held: held.view });
    assert(accurate(held), 'held crosshair reports the exact bar and pane price', held);
    const vol = held.dataWindow.groups.find((group) => group.name === 'Volume')?.rows?.[0]?.value;
    assert(vol === held.bar.volume.toFixed(2), 'indicator readout follows the inspected bar', { vol, bar: held.bar, dataWindow: held.dataWindow });
    assert(held.status.length > 0 && held.status !== before.status, 'status-line OHLC follows the inspected bar', { before: before.status, held: held.status });

    const draggedPoint = point(p.x + 65, p.y + 32);
    await move(draggedPoint);
    const dragged = await state();
    assert(accurate(dragged) && Math.abs(dragged.ch.x - (draggedPoint.x - g.x)) < 1, 'dragging updates bar and values correctly', dragged);
    assert(Math.abs(dragged.view.rightOffset - held.view.rightOffset) < 1e-8, 'tracking drag never pans', { held: held.view, dragged: dragged.view });

    // Capture continues beyond the plot edge; the cursor should remain on the nearest edge.
    await move(point(389, 779));
    const edge = await state();
    assert(edge.tracking && edge.ch && edge.ch.x === edge.width && edge.ch.y === edge.height && edge.pixels > 500, 'edge drag clamps rather than hiding the crosshair', edge);
    await move(draggedPoint);
    await up();
    const lifted = await state();
    assert(lifted.tracking && lifted.pixels > 1000 && accurate(lifted), 'lifting retains crosshair and readouts', lifted);
    await tap(at(g, 0.5, 0.55));
    const exited = await state();
    assert(!exited.tracking && !exited.flag && !exited.ch && exited.pixels === 0, 'the next single tap exits cleanly', exited);
    assert(exited.statusBarTime === before.visibleTo && exited.status === before.status, 'exiting tracking returns to the correct default OHLC', { before: before.status, exited: exited.status });

    // Once tracking is off, an ordinary one-finger pan still works.
    const panBefore = exited.view.rightOffset;
    await down(at(g, 0.38, 0.55));
    await move(at(g, 0.60, 0.55));
    await up();
    await wait(220);
    const panned = await state();
    assert(!panned.tracking && Math.abs(panned.view.rightOffset - panBefore) > 1, 'ordinary touch pan still navigates', { before: panBefore, after: panned.view });

    // Touch axis menus remain available in the portrait phone chrome too.
    const portraitTimePoint = point(g.x + g.width * 0.5, g.y + g.height + 10);
    await hold(portraitTimePoint); await up();
    const portraitTimeSheet = await page.locator('.vela-tzd-menu:visible').count();
    assert(portraitTimeSheet === 1, 'portrait touch hold opens the compact time-zone menu', { g, portraitTimePoint, portraitTimeSheet });
    await page.evaluate(() => window.__ws.timezoneDrawer?.close());
    await wait(350);
    const portraitPricePoint = point(g.x + g.width + (g.canvasW - g.width) * 0.5, g.y + g.height * 0.58);
    await hold(portraitPricePoint); await up();
    const portraitPriceSheet = await page.locator('.vela-price-scale-menu:visible').count();
    assert(portraitPriceSheet === 1, 'portrait touch hold opens the compact price-scale menu', { g, portraitPricePoint, portraitPriceSheet });
    await page.keyboard.press('Escape');
    await wait(350);

    // No bars: lines must still paint, but market labels and values must not be invented.
    await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        window.__savedBars = r.bars.map((b) => ({ ...b }));
        r.setBars([]);
    });
    await wait(300);
    await hold(at(g, 0.42, 0.58));
    await up();
    const empty = await state();
    assert(empty.barCount === 0 && empty.tracking && empty.ch && empty.pixels > 1000, 'empty chart still shows tracking lines', empty);
    assert(empty.event?.time === null && empty.event?.price === null && empty.event?.ohlc === null && empty.rightChip === 0 && empty.bottomChip === 0, 'empty chart does not fabricate time/price chips or OHLC', empty);

    // Re-arm the real first-data reveal: a fresh blank standalone page has never
    // played it. Values and chips must refresh *during* that independent rAF loop.
    await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        r.introPlayed = false;
        r.setBars(window.__savedBars);
    });
    await wait(120);
    const arrived = await state();
    assert(arrived.introActive && arrived.tracking && accurate(arrived) && arrived.rightChip > 0 && arrived.bottomChip > 0, 'stationary tracking refreshes during the first-data reveal', arrived);
    const arrivedVol = arrived.dataWindow.groups.find((group) => group.name === 'Volume')?.rows?.[0]?.value;
    assert(arrivedVol === arrived.bar.volume.toFixed(2), 'stationary indicator values refresh when bars arrive', { arrivedVol, arrived });

    // Magnet must publish the same price as its painted level, including live-bar animation.
    await page.evaluate(() => window.__ws.active.chart.renderer.renderer.applyConfig({ crosshair: { magnet: 'close' } }));
    await wait(250);
    const magnetTarget = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        const b = r.bars.at(-1);
        const pane = [...r.scene.panes.values()].find((p) => p.kind === 'price');
        const rect = r.dataCanvas.getBoundingClientRect();
        return { x: rect.x + r.coords.logicalToX(r.bars.length - 1), y: rect.y + r.coords.priceToY(b.close, pane.scale, pane.bounds) + 8, close: b.close };
    });
    // Re-contact is relative to the retained cursor, so start at that cursor when
    // steering to an absolute market point.
    await down(point(g.x + arrived.ch.x, g.y + arrived.ch.y));
    await move(point(magnetTarget.x, magnetTarget.y));
    await up();
    const magnet = await state();
    assert(magnet.tracking && accurate(magnet) && Math.abs(magnet.event.price - magnet.bar.close) < 1e-7, 'magnet event price equals the snapped candle close', { magnetTarget, magnet });
    const live = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        const bar = r.bars.at(-1);
        const first = { ...bar, close: bar.close + 0.05 };
        const next = { ...bar, close: bar.close + 0.4, high: Math.max(bar.high, bar.close + 0.5) };
        r.updateBar(first); // seeds the easing state
        r.animLiveBar.set(100);
        r.updateBar(next); // starts an actual animator frame
        return { expected: next.close, active: r.animator.active };
    });
    await page.waitForFunction((expected) => window.__touchReadouts.at(-1)?.ohlc?.close === expected, live.expected, { timeout: 5000 });
    const refreshed = await state();
    assert(live.active && accurate(refreshed) && refreshed.event.ohlc.close === live.expected, 'animated live-bar change refreshes a resting crosshair', { live, refreshed });
    assert(Math.abs(refreshed.event.price - refreshed.bar.close) < 1e-7, 'magnet follows the current actual close during animation', refreshed);

    // Resize/rotate with a resting pointer: the line is retained and re-resolved/clamped.
    await page.setViewportSize({ width: 780, height: 390 });
    await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop', null, { timeout: 8000 });
    await wait(500);
    g = await geometry();
    const rotated = await state();
    assert(rotated.tracking && rotated.ch && rotated.ch.x <= rotated.width && rotated.ch.y <= rotated.height && rotated.pixels > 500, 'rotation retains a visible in-bounds tracking cursor', rotated);
    assert(accurate(rotated) || rotated.event?.time === null, 'rotated readout matches its new position or is honestly off-bar', rotated);
    await tap(at(g, 0.45, 0.55));

    // Both axes receive a touch-only hold even though landscape uses desktop chrome.
    const timePoint = point(g.x + g.width * 0.50, g.y + g.height + 10);
    await hold(timePoint); await up();
    const timeSheet = await page.locator('.vela-tzd-menu:visible').count();
    assert(timeSheet === 1, 'landscape touch hold opens the compact time-zone menu', { timePoint, g, timeSheet });
    await page.evaluate(() => window.__ws.timezoneDrawer?.close());
    await wait(350);
    const pricePoint = point(g.x + g.width + (g.canvasW - g.width) * 0.5, g.y + g.height * 0.58);
    await hold(pricePoint); await up();
    const priceSheet = await page.locator('.vela-price-scale-menu:visible').count();
    assert(priceSheet === 1, 'landscape touch hold opens the compact price-scale menu', { pricePoint, g, priceSheet });
    await page.keyboard.press('Escape');
    await wait(350);

    // Escape must end the input mode, not merely erase its pixels.
    await hold(at(g, 0.45, 0.60)); await up();
    await page.evaluate(() => window.__ws.active.chart.renderer.renderer.dataCanvas.focus());
    await page.keyboard.press('Escape');
    const escaped = await state();
    assert(!escaped.tracking && !escaped.ch && !escaped.flag, 'Escape clears both tracking state and visible crosshair', escaped);

    // A pinch exits tracking, updates the host flag and still zooms the viewport.
    const one = at(g, 0.35, 0.60), two = at(g, 0.55, 0.60);
    await hold(one);
    const pinchBefore = await state();
    await touch('touchStart', [one, point(two.x, two.y, 2)]);
    await touch('touchMove', [point(one.x - 35, one.y, 1), point(two.x + 35, two.y, 2)]);
    const pinched = await state();
    assert(!pinched.tracking && !pinched.flag && !pinched.ch && pinched.view.barSpacing > pinchBefore.view.barSpacing, 'pinch exits tracking and zooms normally', { pinchBefore: pinchBefore.view, pinched });
    await up();
    await wait();

    // Browser cancellation preserves the last inspection point but drops pointer ownership.
    await hold(at(g, 0.42, 0.62));
    await touch('touchCancel', []);
    const cancelled = await state();
    assert(cancelled.tracking && cancelled.ch && !cancelled.dragging && cancelled.touches === 0, 'pointercancel keeps readout without a stuck drag/contact', cancelled);
    await tap(at(g, 0.45, 0.62));

    // A real indicator pane has its own scale; the candle-close magnet must not snap it.
    await page.evaluate(() => window.__ws.active.chart.panes.moveIndicator(window.__volumeId, { newPane: true }));
    await wait(500);
    const studyTarget = await page.evaluate(() => {
        const r = window.__ws.active.chart.renderer.renderer;
        const rect = r.dataCanvas.getBoundingClientRect();
        const pane = [...r.scene.panes.values()].find((p) => p.kind === 'study');
        return pane ? { x: rect.x + r.coords.width * 0.55, y: rect.y + pane.bounds.top + pane.bounds.height * 0.55, top: rect.y } : null;
    });
    assert(!!studyTarget, 'volume can occupy its own study pane', studyTarget);
    let studySnapshot = null;
    if (studyTarget) {
        await hold(point(studyTarget.x, studyTarget.y)); await up();
        studySnapshot = await state();
        assert(studySnapshot.tracking && studySnapshot.event?.paneKind === 'study' && accurate(studySnapshot) && Math.abs(studySnapshot.ch.y - (Math.round(studyTarget.y) - studyTarget.top)) < 1, 'study value follows its own scale without candle magnet snapping', studySnapshot);
        await tap(point(studyTarget.x, studyTarget.y));
    }
    await page.evaluate(() => window.__ws.active.chart.panes.moveIndicator(window.__volumeId, 'price'));
    await wait(400);

    // Linked multi-chart tracking: moving to another active cell clears the old local
    // leader, and later data frames on it cannot steal the new leader's synced ghost.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile', null, { timeout: 8000 });
    await page.evaluate(() => { window.__ws.setLayout('4'); window.__ws.sync.set('crosshair', true); });
    await wait(1100);
    const a = await geometry('a'), b = await geometry('b');
    await hold(at(a, 0.5, 0.65)); await up(); await wait();
    const leaderA = await page.evaluate(() => {
        const a = window.__ws.cell('a').chart.renderer.renderer;
        const b = window.__ws.cell('b').chart.renderer.renderer;
        return { tracking: a.input.isTracking, ghost: b.externalCross, logical: a.hoverLogical, time: a.bars[a.hoverLogical]?.time };
    });
    assert(leaderA.tracking && leaderA.ghost?.time === leaderA.time, 'tracked chart propagates a one-way ghost to its linked follower', leaderA);
    await hold(at(b, 0.45, 0.65)); await up(); await wait();
    const leaderB = await page.evaluate(() => {
        const a = window.__ws.cell('a').chart.renderer.renderer;
        const b = window.__ws.cell('b').chart.renderer.renderer;
        const last = a.bars.at(-1);
        a.updateBar({ ...last, close: last.close + 0.01 });
        return { active: window.__ws.active.id, aTracking: a.input.isTracking, aLocal: a.scene.crosshair, aGhost: a.externalCross,
            bTracking: b.input.isTracking, bTime: b.bars[b.hoverLogical]?.time };
    });
    await wait(300);
    const afterOldFrame = await page.evaluate(() => ({ aGhost: window.__ws.cell('a').chart.renderer.renderer.externalCross, bTracking: window.__ws.cell('b').chart.renderer.renderer.input.isTracking }));
    assert(leaderB.active === 'b' && !leaderB.aTracking && !leaderB.aLocal && leaderB.bTracking && leaderB.aGhost?.time === leaderB.bTime, 'switching cells transfers tracking ownership and sync', leaderB);
    assert(afterOldFrame.bTracking && afterOldFrame.aGhost?.time === leaderB.bTime, 'old chart data frame cannot steal the new sync leader', afterOldFrame);

    // The leader stays still while the *follower's* forming candle changes. Its own
    // synced OHLC must refresh too, rather than retaining the old bar object forever.
    const latestPoint = await page.evaluate(() => {
        const r = window.__ws.cell('b').chart.renderer.renderer;
        const rect = r.dataCanvas.getBoundingClientRect();
        return { x: rect.x + r.coords.logicalToX(r.bars.length - 1), y: rect.y + r.coords.height * 0.65 };
    });
    const leaderPoint = await page.evaluate(() => {
        const r = window.__ws.cell('b').chart.renderer.renderer;
        const rect = r.dataCanvas.getBoundingClientRect();
        return { x: rect.x + r.scene.crosshair.x, y: rect.y + r.scene.crosshair.y };
    });
    await down(point(leaderPoint.x, leaderPoint.y));
    await move(point(latestPoint.x, latestPoint.y));
    await up(); await wait();
    const followerBefore = await page.evaluate(() => ({
        time: window.__ws.cell('a').statusline.syncedBar?.time,
        close: window.__ws.cell('a').statusline.syncedBar?.close,
        lastTime: window.__ws.cell('a').chart.lastBar?.time,
    }));
    const followerTick = await page.evaluate(() => {
        const chart = window.__ws.cell('a').chart;
        const bar = chart.lastBar;
        const next = { ...bar, close: bar.close + 3, high: Math.max(bar.high, bar.close + 3) };
        chart.orchestrator.onBar(next); // the provider's normal bar-event path
        return next.close;
    });
    await wait(300);
    const followerAfter = await page.evaluate(() => ({
        close: window.__ws.cell('a').statusline.syncedBar?.close,
        rendered: window.__ws.cell('a').chart.renderer.renderer.bars.at(-1)?.close,
        status: window.__ws.cell('a').host.querySelector('.vela-sl-ohlc')?.textContent,
    }));
    assert(followerBefore.time === followerBefore.lastTime, 'linked follower is inspecting its current forming bar', followerBefore);
    assert(followerAfter.close === followerTick && followerAfter.rendered === followerTick, 'a stationary linked follower updates its own live OHLC', { followerBefore, followerTick, followerAfter });
    const followerLoad = await page.evaluate(() => {
        const cell = window.__ws.cell('a');
        const engine = cell.chart.orchestrator;
        const bars = engine.rawBars.map((bar) => ({ ...bar }));
        const leader = window.__ws.cell('b').chart.renderer.renderer;
        const time = leader.bars[leader.hoverLogical].time;
        engine.beginLoad(false);
        engine.setBarSeries([], { clearing: true });
        cell.setSyncedCrosshairAt(time);
        const waiting = { time: cell.syncedCrosshairTime, bar: cell.statusline.syncedBar, status: cell.host.querySelector('.vela-sl-ohlc')?.textContent?.trim() };
        engine.setBarSeries(bars, { preserveView: true }); // normal first-painted load:end path
        return { waiting, loaded: cell.statusline.syncedBar, time };
    });
    assert(followerLoad.waiting.time === followerLoad.time && followerLoad.waiting.bar === null && followerLoad.waiting.status === '' && followerLoad.loaded?.time === followerLoad.time && followerLoad.loaded?.close === followerTick, 'a follower remembers the leader time without stale OHLC until its own bars load', followerLoad);
    const followerDaily = await page.evaluate(() => {
        const cell = window.__ws.cell('a');
        const engine = cell.chart.orchestrator;
        const time = cell.syncedCrosshairTime;
        const day = 86_400_000;
        const lastStart = Math.floor(time / day) * day;
        const daily = Array.from({ length: 3 }, (_, i) => ({ time: lastStart - (2 - i) * day, open: 500, high: 505, low: 499, close: 501 + i, volume: 10 }));
        engine.beginLoad(false);
        engine.setBarSeries(daily, { preserveView: true });
        return { time, last: daily[2], readout: cell.statusline.syncedBar, pastEnd: cell.barAt(lastStart + day) };
    });
    assert(followerDaily.time > followerDaily.last.time && followerDaily.readout?.time === followerDaily.last.time && followerDaily.readout?.close === followerDaily.last.close && followerDaily.pastEnd === null, 'a different-timeframe follower resolves the entire forming candle, not just its opening instant', followerDaily);
    await tap(at(b, 0.5, 0.65));
    const clearedGhost = await page.evaluate(() => window.__ws.cell('a').chart.renderer.renderer.externalCross);
    assert(clearedGhost === null, 'exit clears the synced ghost', clearedGhost);

    assert(errors.length === 0, 'no browser page errors', errors.slice(0, 4));
    report('touch-crosshair-runtime', {
        held: { x: held.ch?.x, y: held.ch?.y, time: held.event?.time, price: held.event?.price, pixels: held.pixels, volume: vol },
        edge: { x: edge.ch?.x, y: edge.ch?.y, pixels: edge.pixels }, empty: { pixels: empty.pixels, priceChip: empty.rightChip, timeChip: empty.bottomChip },
        arrived: { time: arrived.event?.time, close: arrived.event?.ohlc?.close }, magnet: { price: magnet.event?.price, close: magnet.bar?.close },
        refreshed: { close: refreshed.event?.ohlc?.close, price: refreshed.event?.price }, rotated: { width: rotated.width, height: rotated.height, ch: rotated.ch },
        study: { pane: studySnapshot?.event?.paneKind, price: studySnapshot?.event?.price, y: studySnapshot?.ch?.y },
        pinch: { before: pinchBefore.view.barSpacing, after: pinched.view.barSpacing }, leaderA, leaderB,
        follower: { before: followerBefore.close, after: followerAfter.close, loadingStatus: followerLoad.waiting.status, loaded: followerLoad.loaded?.close, daily: followerDaily.readout?.close }, errors: errors.slice(0, 4),
    });
} finally {
    await browser.close();
}
