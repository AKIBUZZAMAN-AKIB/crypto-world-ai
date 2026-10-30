// Real table geometry, sticky layering and candle navigation in the deterministic
// workspace. No screenshots, network feed or hand-built HTML fixture.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { widths: [] };

async function boot(viewport, { touch = false, reducedMotion = 'no-preference' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 30000 });
    await page.waitForTimeout(350);
    return { context, page };
}

async function openTable(page, touch = false) {
    const mobile = await page.evaluate(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
    if (mobile) {
        await page.locator('.vela-mb-more').tap();
        await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Data window' }).tap();
    } else {
        const button = page.locator('button[aria-label="Data window"]');
        await button.scrollIntoViewIfNeeded();
        await button.click();
    }
    const tab = page.getByRole('tab', { name: 'Table' });
    if (touch) await tab.tap(); else await tab.click();
    await page.waitForTimeout(300);
}

async function scrollRow(page, offset, left = 0) {
    const scroll = page.locator('.vela-dw-table-scroll');
    await scroll.evaluate((el, p) => el.scrollTo({ top: p.offset * 32, left: p.left, behavior: 'instant' }), { offset, left });
    await page.waitForTimeout(180);
    const row = page.locator(`.vela-dw-table tr[data-offset="${offset}"]`);
    await row.waitFor({ state: 'attached' });
    return row;
}

async function geometry(page) {
    return page.locator('.vela-dw-table tbody tr:not(.vela-dw-table-spacer) td:first-child').nth(5).evaluate((td) => {
        const row = td.parentElement, value = row.cells[1], range = document.createRange();
        range.selectNodeContents(td.firstElementChild ?? td);
        const t = td.getBoundingClientRect(), v = value.getBoundingClientRect(), text = range.getBoundingClientRect();
        const style = getComputedStyle(td), header = td.closest('table').querySelector('th:first-child');
        const scroll = td.closest('.vela-dw-table-scroll');
        return {
            text: td.textContent, width: t.width, textWidth: text.width, spare: t.width - text.width,
            background: style.backgroundColor, image: style.backgroundImage, z: style.zIndex,
            overlap: Math.max(0, Math.min(t.right, v.right) - Math.max(t.left, v.left)),
            pinned: Math.abs(t.left - scroll.getBoundingClientRect().left), headerZ: getComputedStyle(header).zIndex,
            scrollX: scroll.scrollLeft, docOverflow: document.documentElement.scrollWidth - innerWidth,
        };
    });
}

async function viewport(page, timestamp) {
    return page.evaluate((time) => {
        const r = window.__ws.active.chart.renderer.renderer;
        const bars = r.getBars(), index = bars.findIndex((bar) => bar.time === time);
        const marker = r.plot.querySelector('.vela-candle-locator');
        const band = marker?.querySelector('.vela-candle-locator-band');
        return {
            index, width: r.coords.width, x: index >= 0 ? r.coords.logicalToX(index) : null,
            viewport: { ...r.coords.getViewport() }, target: r.scrollTargetRO,
            marker: marker ? { timestamp: Number(marker.dataset.timestamp), index: Number(marker.dataset.index), visible: marker.dataset.visible === 'true', opacity: getComputedStyle(band).opacity, background: band.style.background, pointer: getComputedStyle(marker).pointerEvents } : null,
        };
    }, timestamp);
}

try {
    // Width, sticky overlap and screen containment at phone/tablet/landscape/desktop sizes.
    for (const size of [
        { width: 240, height: 320, touch: true }, { width: 390, height: 780, touch: true },
        { width: 768, height: 1024, touch: true }, { width: 780, height: 390, touch: true },
        { width: 1280, height: 820, touch: false },
    ]) {
        const { context, page } = await boot({ width: size.width, height: size.height }, { touch: size.touch });
        await openTable(page, size.touch);
        await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: 100, left: 120, behavior: 'instant' }));
        await page.waitForTimeout(150);
        const cell = page.locator('.vela-dw-table tbody tr:not(.vela-dw-table-spacer) td:first-child').nth(5);
        await cell.hover();
        const g = await geometry(page);
        assert(g.width < 145 && g.spare >= 18 && g.spare <= 26 && g.text.includes(':'), 'time column fits actual seconds text and padding', { size, g });
        assert(g.scrollX > 50 && g.overlap > 20 && g.pinned < 2 && g.background.startsWith('rgb(') && g.image.includes('linear-gradient') && Number(g.headerZ) > Number(g.z), 'hovered sticky time remains opaque above overlapping cells and below the corner header', { size, g });
        assert(g.docOverflow <= 0, 'the table does not widen the page', { size, g });
        facts.widths.push({ viewport: [size.width, size.height], width: g.width, textWidth: g.textWidth, spare: g.spare, bg: g.background });
        if (size.width === 1280) {
            await page.evaluate(() => window.__ws.setTheme('light'));
            await cell.hover();
            const light = await geometry(page);
            assert(light.background.startsWith('rgb(') && light.image.includes('linear-gradient') && light.overlap > 0, 'light theme also keeps a solid pinned hover surface', light);
            await page.evaluate(async () => {
                const c = window.__ws.active.chart;
                const bars = c.renderer.getBars().map((bar) => ({ ...bar, time: bar.time + 123 }));
                await c.setMarket({ data: bars });
            });
            await page.waitForTimeout(250);
            await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
            await page.waitForTimeout(150);
            const ms = await geometry(page);
            assert(ms.text.endsWith('.123') && ms.width > g.width && ms.spare >= 18 && ms.spare <= 26, 'millisecond timestamps grow just enough and remain readable', { seconds: g, milliseconds: ms });
            facts.milliseconds = ms;
            facts.light = light.background;
        }
        await context.close();
    }

    // Actual row clicks, keyboard, rapid retargeting, live append, multi-chart isolation,
    // selection and pre-existing drawings/highlights on the native renderer.
    {
        const { context, page } = await boot({ width: 1440, height: 900 });
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        await openTable(page);
        const setup = await page.evaluate(() => {
            const ws = window.__ws, c = ws.active.chart, bars = c.renderer.getBars();
            c.setVisibleRange({ from: bars[700].time, to: bars[799].time });
            const h = [{ from: bars[60].time, to: bars[80].time, color: 'rgba(255,0,0,0.17)' }];
            c.renderer.set('highlights', h);
            const drawing = c.drawings.add('hline', { anchors: [{ time: bars[200].time, price: bars[200].close }] });
            return { a: { ...ws.cell('a').chart.renderer.renderer.coords.getViewport() }, highlights: JSON.stringify(c.renderer.get('highlights')), drawings: JSON.stringify(c.drawings.toJSON()), drawing: !!drawing };
        });
        const row = await scrollRow(page, 400);
        const time = Number(await row.getAttribute('data-timestamp'));
        const before = await viewport(page, time);
        await row.locator('td').nth(1).click(); // any cell in a candle row is actionable
        const first = await viewport(page, time);
        await page.waitForTimeout(120);
        const moving = await viewport(page, time);
        await page.waitForTimeout(850);
        const arrived = await viewport(page, time);
        const preserved = await page.evaluate(() => {
            const ws = window.__ws, c = ws.active.chart;
            return { a: { ...ws.cell('a').chart.renderer.renderer.coords.getViewport() }, highlights: JSON.stringify(c.renderer.get('highlights')), drawings: JSON.stringify(c.drawings.toJSON()), active: ws.active.id };
        });
        assert(first.marker?.timestamp === time && Math.abs(moving.x - moving.width / 2) < Math.abs(before.x - before.width / 2) && Math.abs(moving.x - moving.width / 2) > 3, 'row click begins a smooth pan toward its own candle', { before, first, moving });
        assert(arrived.index >= 0 && Math.abs(arrived.x - arrived.width / 2) < 12 && arrived.viewport.barSpacing === before.viewport.barSpacing && arrived.marker?.visible && arrived.marker.pointer === 'none' && arrived.marker.background.includes('gradient'), 'candle arrives near center at the same zoom with a visible noninteractive background marker', arrived);
        assert(setup.drawing && preserved.active === 'b' && JSON.stringify(preserved.a) === JSON.stringify(setup.a) && preserved.highlights === setup.highlights && preserved.drawings === setup.drawings, 'only the active chart moves and drawings/existing highlights stay untouched', { setup, preserved });
        await page.waitForTimeout(1700);
        assert((await viewport(page, time)).marker === null, 'the first temporary marker removes itself');

        // A real drag selection in a numeric cell should never trigger navigation.
        const selectRow = await scrollRow(page, 410);
        const cell = selectRow.locator('td').nth(1);
        const textBox = await cell.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().toJSON(); });
        const prior = await viewport(page, time);
        await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(textBox.x + Math.min(textBox.width - 2, 65), textBox.y + textBox.height / 2, { steps: 8 });
        await page.mouse.up();
        const selection = await page.evaluate(() => getSelection().toString());
        const selected = await viewport(page, time);
        assert(selection.length > 0 && selected.marker === null && Math.abs(selected.viewport.rightOffset - prior.viewport.rightOffset) < 0.01, 'selecting table text does not navigate or remove selection', { selection, prior, selected });
        await page.evaluate(() => getSelection().removeAllRanges());

        // A new candle can repaint the same newest row between pointer-down and up.
        // The click must still go to what the user pressed, not its replacement.
        const newestRow = await scrollRow(page, 0);
        const pressedTime = Number(await newestRow.getAttribute('data-timestamp'));
        const buttonBox = await newestRow.locator('button').boundingBox();
        await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
        await page.mouse.down();
        const changedUnderPress = await page.evaluate(() => {
            const c = window.__ws.active.chart, b = c.lastBar;
            c.orchestrator.onBar({ ...b, time: b.time + 3_600_000, close: b.close + 0.2, high: b.high + 0.2 });
            return Number(document.querySelector('.vela-dw-table tr[data-offset="0"]').dataset.timestamp);
        });
        await page.mouse.up();
        const pressed = await viewport(page, pressedTime);
        assert(changedUnderPress !== pressedTime && pressed.marker?.timestamp === pressedTime, 'a live repaint between press and release preserves the pressed candle identity', { changedUnderPress, pressedTime, pressed });

        const firstRapid = await scrollRow(page, 110);
        const t1 = Number(await firstRapid.getAttribute('data-timestamp'));
        await firstRapid.locator('button').focus();
        await page.keyboard.press('Enter');
        const secondRapid = await scrollRow(page, 310);
        const t2 = Number(await secondRapid.getAttribute('data-timestamp'));
        await secondRapid.locator('button').focus();
        await page.keyboard.press('Space');
        await page.evaluate(() => {
            const c = window.__ws.active.chart, b = c.lastBar;
            c.orchestrator.onBar({ ...b, time: b.time + 3_600_000, close: b.close + 0.3, high: b.high + 0.3 });
        });
        await page.waitForTimeout(1100);
        const rapid = await viewport(page, t2);
        assert(t1 !== t2 && rapid.marker?.timestamp === t2 && rapid.marker.visible && Math.abs(rapid.x - rapid.width / 2) < 12, 'Enter/Space, repeated clicks and a live append settle on the latest selected candle', { t1, t2, rapid });
        await page.waitForTimeout(1600);
        assert((await viewport(page, t2)).marker === null, 'retargeted marker also cleans up');
        facts.navigation = { before, moving, arrived, rapid, preserved: { active: preserved.active, drawing: setup.drawing } };
        await context.close();
    }

    // Replay and transformed/rebucketed series resolve only the currently displayed bars.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await page.evaluate(() => window.__ws.setLayout('1'));
        await openTable(page);
        const replay = await page.evaluate(async () => {
            const c = window.__ws.active.chart, bars = c.renderer.getBars(), future = bars[400].time, cut = bars[199].time;
            await c.replay.start({ from: cut });
            const shown = c.renderer.getBars();
            c.setVisibleRange({ from: shown[150].time, to: shown[199].time });
            return { cut, future, count: shown.length, futureAccepted: c.renderer.revealTableCandle(future, 0) };
        });
        const replayRow = await scrollRow(page, 110);
        const replayTime = Number(await replayRow.getAttribute('data-timestamp'));
        await replayRow.locator('button').click();
        await page.waitForTimeout(1000);
        const replayView = await viewport(page, replayTime);
        assert(replay.count === 200 && !replay.futureAccepted && replayTime <= replay.cut && replayView.marker?.timestamp === replayTime && Math.abs(replayView.x - replayView.width / 2) < 15, 'replay navigation never reveals an unrevealed bar', { replay, replayTime, replayView });
        await page.evaluate(() => window.__ws.active.chart.replay.stop());
        await page.waitForTimeout(200);
        assert((await viewport(page, replayTime)).marker === null, 'replacing the replay series clears its temporary marker');
        const transformed = await page.evaluate(() => {
            const cell = window.__ws.active;
            cell.setPriceStyle('renko');
            const c = cell.chart, bars = c.renderer.getBars(), n = bars.length;
            if (n > 4) c.setVisibleRange({ from: bars[Math.max(0, n - 35)].time, to: bars[n - 1].time });
            return { style: cell.priceStyle, count: n, rawCount: c.orchestrator.rawBars.length };
        });
        await page.waitForTimeout(250);
        assert(transformed.style === 'renko' && transformed.count > 4 && transformed.count !== transformed.rawCount, 'the test is using a real rebucketed chart series', transformed);
        const transformedOffset = Math.floor(transformed.count / 2);
        const transformedRow = await scrollRow(page, transformedOffset);
        const transformedTime = Number(await transformedRow.getAttribute('data-timestamp'));
        await transformedRow.locator('button').click();
        await page.waitForTimeout(1100);
        const transformedView = await viewport(page, transformedTime);
        assert(transformedView.index >= 0 && transformedView.marker?.timestamp === transformedTime && Math.abs(transformedView.x - transformedView.width / 2) < 15, 'navigation tracks the displayed transformed candle, not a raw-source index', { transformed, transformedOffset, transformedView });
        const transformedReplay = await page.evaluate(async () => {
            const c = window.__ws.active.chart;
            const raw = c.orchestrator.rawBars, cut = raw[399].time;
            const before = c.renderer.getBars(), future = before[before.length - 1].time;
            await c.replay.start({ from: cut });
            const shown = c.renderer.getBars(), n = shown.length;
            if (n > 4) c.setVisibleRange({ from: shown[Math.max(0, n - 15)].time, to: shown[n - 1].time });
            return { cut, future, count: n, futureAccepted: c.renderer.revealTableCandle(future, 0) };
        });
        assert(transformedReplay.count > 4 && transformedReplay.future > transformedReplay.cut && !transformedReplay.futureAccepted, 'transformed replay hides future bricks', transformedReplay);
        const trOffset = Math.floor(transformedReplay.count * 0.65);
        const trRow = await scrollRow(page, trOffset);
        const trTime = Number(await trRow.getAttribute('data-timestamp'));
        await trRow.locator('button').click();
        await page.waitForTimeout(1000);
        const trView = await viewport(page, trTime);
        assert(trTime <= transformedReplay.cut && trView.marker?.timestamp === trTime && Math.abs(trView.x - trView.width / 2) < 15, 'replay and rebucketing together navigate the displayed brick', { transformedReplay, trView });
        facts.replay = { replay, replayView, transformedReplay };
        facts.transformed = { transformed, transformedView, replayView: trView };
        await context.close();
    }

    // A deep 20,000-bar virtual table can navigate its oldest real candle without
    // materializing the entire history or losing the marker during a long glide.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await page.evaluate(() => window.__ws.setLayout('1'));
        await openTable(page);
        await page.evaluate(async () => {
            const c = window.__ws.active.chart;
            const bars = Array.from({ length: 20_000 }, (_, i) => ({ time: 1700000000000 + i * 60_000, open: 100 + i / 1000, high: 102 + i / 1000, low: 99 + i / 1000, close: 101 + i / 1000, volume: 12 + i }));
            await c.setMarket({ data: bars });
            c.setVisibleRange({ from: bars[19_899].time, to: bars[19_999].time });
        });
        await page.waitForTimeout(250);
        const row = await scrollRow(page, 19_999);
        const time = Number(await row.getAttribute('data-timestamp'));
        const before = await viewport(page, time);
        await row.locator('button').click();
        await page.waitForTimeout(1600);
        const deep = await viewport(page, time);
        const count = await page.locator('.vela-dw-table tbody tr:not(.vela-dw-table-spacer)').count();
        assert(time === 1700000000000 && deep.index === 0 && Math.abs(deep.x - deep.width / 2) < 15 && deep.viewport.barSpacing === before.viewport.barSpacing && deep.marker?.visible && count < 60, 'oldest of 20,000 rows is reached at unchanged zoom with a bounded DOM', { deep, before, count });
        await page.waitForTimeout(1700);
        assert((await viewport(page, time)).marker === null, 'deep-history marker is removed');
        facts.deepHistory = { deep, rendered: count };
        await context.close();
    }

    // Reduced motion snaps the chart and shows a non-animated, temporary indicator.
    {
        const { context, page } = await boot({ width: 1280, height: 820 }, { reducedMotion: 'reduce' });
        await page.evaluate(() => {
            const c = window.__ws.active.chart, bars = c.renderer.getBars();
            c.setVisibleRange({ from: bars[700].time, to: bars[799].time });
            // Even an explicit motion setting should not force this interaction to animate.
            c.renderer.set('animScroll', 1000);
        });
        await openTable(page);
        const row = await scrollRow(page, 400);
        const time = Number(await row.getAttribute('data-timestamp'));
        await row.locator('button').click();
        const reduced = await viewport(page, time);
        const style = await page.evaluate(() => {
            const band = document.querySelector('.vela-candle-locator-band');
            return { transition: band?.style.transition, opacity: band?.style.opacity };
        });
        assert(Math.abs(reduced.x - reduced.width / 2) < 2 && reduced.target === null && reduced.marker?.visible && style.transition === 'none' && style.opacity === '1', 'reduced motion uses an instant pan and static indication', { reduced, style });
        await page.waitForTimeout(1300);
        assert((await viewport(page, time)).marker === null, 'reduced-motion indication is removed');
        facts.reducedMotion = { reduced, style };
        await context.close();
    }

    // Portrait touch: the standard bottom pane stays open while a real tap moves the chart.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, { touch: true });
        await openTable(page, true);
        const row = await scrollRow(page, 300);
        const time = Number(await row.getAttribute('data-timestamp'));
        await row.locator('button').tap();
        await page.waitForTimeout(1000);
        const touch = await viewport(page, time);
        const pane = await page.locator('.vela-panel.vela-dw').isVisible();
        assert(pane && touch.marker?.timestamp === time && Math.abs(touch.x - touch.width / 2) < 15, 'touch tap reveals the selected candle without closing the bottom pane', { touch, pane });
        facts.touch = touch;
        await context.close();
    }

    assert(errors.length === 0, 'no browser page errors', errors.slice(0, 4));
    report('sync-data-window-navigation', facts);
} finally {
    await browser.close();
}
