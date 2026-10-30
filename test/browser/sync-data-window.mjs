// Real docked panes and live Data/Table interactions on the deterministic workspace.
// No screenshots, mock HTML or network data. Browser geometry and clicks are measured.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { sizes: [] };

async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length && window.__ws.active.chart.lastBar, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    return { context, page };
}

async function openPanel(page, title, selector) {
    const mobile = await page.evaluate(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
    if (mobile) {
        await page.locator('.vela-mb-more').tap();
        await page.locator('.vela-more-panel:visible .vela-md-row', { hasText: title }).tap();
    } else {
        const door = page.locator(`button[aria-label="${title}"]`);
        await door.scrollIntoViewIfNeeded();
        await door.click();
    }
    const panel = page.locator(`.vela-panel${selector}`);
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    return panel;
}

async function geometry(page, selector) {
    return page.evaluate((selector) => {
        const panel = document.querySelector(selector), host = document.querySelector('.vela-ws-main');
        const p = panel.getBoundingClientRect(), h = host.getBoundingClientRect();
        const s = getComputedStyle(panel);
        return {
            mode: document.querySelector('.vela-workspace').dataset.layout,
            p: p.toJSON(), h: h.toJSON(), radius: s.borderRadius, shadow: s.boxShadow,
            position: s.position, max: getComputedStyle(panel.querySelector('.vela-panel-max')).display !== 'none',
            floating: panel.dataset.freeFloating ?? null, standard: panel.dataset.standardPane,
            overflow: document.documentElement.scrollWidth - innerWidth,
        };
    }, selector);
}

async function touchDrag(page, context, locator, dx, dy) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Missing touch target');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
        await page.waitForTimeout(15);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(250);
}

async function tableFacts(page) {
    return page.evaluate(() => {
        const panel = document.querySelector('.vela-dw'), table = panel.querySelector('.vela-dw-table');
        const scroller = panel.querySelector('.vela-dw-table-scroll');
        const rows = [...table.querySelectorAll('tbody tr:not(.vela-dw-table-spacer)')];
        const head = table.querySelector('th'), r = scroller.getBoundingClientRect();
        const expected = window.__ws.active.chart.renderer.dataWindowTable(0, 1);
        return {
            count: Number(table.getAttribute('aria-rowcount')), cols: Number(table.getAttribute('aria-colcount')),
            headers: [...table.querySelectorAll('th')].map((el) => el.textContent),
            rendered: rows.length, first: rows[0] ? { index: rows[0].getAttribute('aria-rowindex'), timestamp: Number(rows[0].dataset.timestamp), cells: [...rows[0].cells].map((c) => c.textContent) } : null,
            last: rows.at(-1) ? { index: rows.at(-1).getAttribute('aria-rowindex'), timestamp: Number(rows.at(-1).dataset.timestamp) } : null,
            scroll: { x: scroller.scrollLeft, y: scroller.scrollTop, width: scroller.clientWidth, contentWidth: scroller.scrollWidth, height: scroller.clientHeight, contentHeight: scroller.scrollHeight, top: r.top, left: r.left, headerTop: head?.getBoundingClientRect().top },
            scope: panel.querySelector('.vela-dw-table-scope').textContent,
            zone: panel.querySelector('.vela-dw-table-zone').textContent,
            expected,
        };
    });
}

try {
    // The two specified panels are square, bounded docks on desktop and full-width
    // bottom panes on portrait touch devices. Landscape still uses desktop chrome.
    for (const size of [
        { width: 240, height: 320, touch: true }, { width: 320, height: 640, touch: true },
        { width: 390, height: 780, touch: true }, { width: 768, height: 1024, touch: true },
        { width: 780, height: 390, touch: true }, { width: 1440, height: 900, touch: false },
    ]) {
        const { context, page } = await boot({ width: size.width, height: size.height }, size.touch);
        const gridBefore = await page.locator('.vela-ws-grid').boundingBox();
        const data = await openPanel(page, 'Data window', '.vela-dw');
        const g = await geometry(page, '.vela-panel.vela-dw');
        const gridAfter = await page.locator('.vela-ws-grid').boundingBox();
        assert(g.standard === '1' && g.radius === '0px' && g.shadow === 'none' && g.max === (g.mode === 'mobile') && !g.floating, 'Data window is square with a phone-only maximize toggle', { size, g });
        assert(g.p.left >= g.h.left - 1 && g.p.right <= g.h.right + 1 && g.p.top >= g.h.top - 1 && g.p.bottom <= g.h.bottom + 1 && g.overflow <= 0, 'Data window stays inside its host and causes no page overflow', { size, g });
        if (g.mode === 'mobile') {
            assert(Math.abs(g.p.left - g.h.left) < 1 && Math.abs(g.p.right - g.h.right) < 1 && Math.abs(g.p.bottom - g.h.bottom) < 1, 'phone Data window is full width and bottom attached', g);
        } else {
            assert(g.position === 'relative' && Math.abs(g.p.height - g.h.height) < 1 && gridAfter.width < gridBefore.width - 100, 'desktop Data window takes a full-height chart column', { g, gridBefore, gridAfter });
        }
        const dataFacts = await page.evaluate(() => {
            const root = document.querySelector('.vela-dw'), readout = window.__ws.active.chart.renderer.dataWindowReadout();
            const rows = [...root.querySelectorAll('.vela-dw-section[data-kind="price"] .vela-dw-row')].map((r) => [r.querySelector('.vela-dw-label').textContent, r.querySelector('.vela-dw-value').textContent]);
            const region = root.querySelector('.vela-dw-data-view');
            return { rows: Object.fromEntries(rows), readout, source: root.querySelector('.vela-dw-source').textContent, role: region.getAttribute('role'), width: region.clientWidth, contentWidth: region.scrollWidth, hold: !!root.querySelector('.vela-dw-hold') };
        });
        assert(dataFacts.rows.Open === dataFacts.readout.ohlc.o && dataFacts.rows.High === dataFacts.readout.ohlc.h && dataFacts.rows.Low === dataFacts.readout.ohlc.l && dataFacts.rows.Close === dataFacts.readout.ohlc.c && dataFacts.rows.Volume === dataFacts.readout.ohlc.vol && dataFacts.source === 'Latest bar' && !dataFacts.hold, 'Data tab follows the renderer without hold controls', { size, dataFacts });
        assert(dataFacts.role === 'tabpanel' && dataFacts.contentWidth <= dataFacts.width + 1, 'Data tab reflows within its own scroll region', { size, dataFacts });
        const tableTab = page.getByRole('tab', { name: 'Table' });
        if (size.touch) await tableTab.tap(); else await tableTab.click();
        await page.waitForTimeout(150);
        const initial = await tableFacts(page);
        assert(initial.count === 801 && initial.cols === 6 && initial.rendered < 60 && initial.first.index === '2' && initial.first.timestamp === initial.expected.rows[0].timestamp, 'table is bounded, semantic and newest first', { size, initial });
        assert(initial.first.cells[1] === initial.expected.rows[0].ohlc.o && initial.first.cells[4] === initial.expected.rows[0].ohlc.c && initial.first.cells[5] === initial.expected.rows[0].volume && initial.scope.includes('800 loaded') && initial.zone === 'UTC', 'table matches chart prices and full volume', { size, initial });
        assert(initial.scroll.contentHeight > initial.scroll.height && initial.scroll.height >= 32 && initial.scroll.contentWidth >= initial.scroll.width, 'table retains a usable internal scroller; wide tablets can fit all columns', { size, initial });
        await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth, behavior: 'instant' }));
        await page.waitForTimeout(150);
        const oldest = await tableFacts(page);
        const oldestTime = await page.evaluate(() => window.__ws.active.chart.renderer.getBars()[0].time);
        assert(oldest.last.index === '801' && oldest.last.timestamp === oldestTime && oldest.rendered < 60 && (oldest.scroll.contentWidth <= oldest.scroll.width || oldest.scroll.x > 0) && Math.abs(oldest.scroll.headerTop - oldest.scroll.top) < 2, 'oldest loaded row and sticky header stay reachable', { size, oldest, oldestTime });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'table scrolling never widens the page', size);
        if (size.width === 240) {
            await page.evaluate(async () => {
                const chart = window.__ws.active.chart;
                await chart.setMarket({ symbol: 'VERYVERYLONGSYMBOLNAMEWITHANEXTREMELYLONGQUOTECURRENCYTHATNEEDSMOREROOMUSDT', data: chart.renderer.getBars().slice(0, 5) });
                chart.renderer.set('timezone', 'America/Argentina/Buenos_Aires');
            });
            await page.waitForTimeout(100);
            const longLabels = await page.evaluate(() => {
                const p = document.querySelector('.vela-dw'), meta = p.querySelector('.vela-dw-table-meta'), scroller = p.querySelector('.vela-dw-table-scroll');
                return { height: scroller.clientHeight, identity: meta.querySelector('.vela-dw-table-identity').title, zone: meta.querySelector('.vela-dw-table-zone').title, overflow: document.documentElement.scrollWidth - innerWidth };
            });
            assert(longLabels.height >= 64 && longLabels.identity.startsWith('VERYVERYLONG') && longLabels.zone === 'America/Argentina/Buenos_Aires' && longLabels.overflow <= 0, 'long symbol and timezone leave a usable candle on a tiny phone', longLabels);
        }
        await data.locator('.vela-panel-close').click();
        await page.waitForTimeout(200);
        const tree = await openPanel(page, 'Object tree', '.vela-ot');
        const t = await geometry(page, '.vela-panel.vela-ot');
        assert(t.standard === '1' && t.radius === '0px' && t.shadow === 'none' && t.max === (t.mode === 'mobile') && !t.floating && t.overflow <= 0, 'Object Tree is also a square standard pane with phone maximize', { size, t });
        if (t.mode === 'mobile') assert(Math.abs(t.p.left - t.h.left) < 1 && Math.abs(t.p.right - t.h.right) < 1 && Math.abs(t.p.bottom - t.h.bottom) < 1, 'phone Object Tree is attached to the bottom', t);
        else assert(t.position === 'relative' && Math.abs(t.p.height - t.h.height) < 1, 'desktop Object Tree is a full-height column', t);
        facts.sizes.push({ viewport: [size.width, size.height], mode: g.mode, panel: [g.p.x, g.p.y, g.p.width, g.p.height], rendered: initial.rendered });
        await tree.locator('.vela-panel-close').click();
        await context.close();
    }

    // A narrow embedded host is resolved by its own size, not the browser window.
    {
        const { context, page } = await boot({ width: 1000, height: 750 }, true);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
        await page.waitForTimeout(350);
        await openPanel(page, 'Data window', '.vela-dw');
        const g = await geometry(page, '.vela-panel.vela-dw');
        await page.getByRole('tab', { name: 'Table' }).tap();
        const table = await tableFacts(page);
        assert(g.mode === 'mobile' && g.p.left >= 100 && g.p.right <= 380 && g.p.bottom <= 460 && table.scroll.contentWidth > table.scroll.width && g.overflow <= 0, 'embedded table scrolls within its bounded host', { g, table });
        facts.embedded = [g.p.x, g.p.y, g.p.width, g.p.height];
        await context.close();
    }

    // Resize a phone pane by touch; its header stays still and keyboard resizing remains available.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        const panel = await openPanel(page, 'Object tree', '.vela-ot');
        const before = await panel.boundingBox();
        await touchDrag(page, context, panel.locator('.vela-panel-grip'), 0, -110);
        const enlarged = await panel.boundingBox();
        assert(enlarged.height > before.height + 80 && Math.abs(enlarged.y + enlarged.height - before.y - before.height) < 2, 'phone top-edge drag resizes without moving the bottom', { before, enlarged });
        const title = panel.locator('.vela-panel-title');
        await touchDrag(page, context, title, 0, -50);
        const afterTitle = await panel.boundingBox();
        assert(Math.abs(afterTitle.y - enlarged.y) < 2 && Math.abs(afterTitle.height - enlarged.height) < 2, 'phone header does not move or resize the pane', { enlarged, afterTitle });
        const grip = panel.locator('.vela-panel-grip');
        await grip.focus();
        await page.keyboard.press('ArrowDown');
        const keyboard = await panel.boundingBox();
        assert(keyboard.height < afterTitle.height - 20 && Math.abs(keyboard.y + keyboard.height - afterTitle.y - afterTitle.height) < 2, 'keyboard resizes while keeping bottom fixed', { afterTitle, keyboard });
        await grip.click();
        assert(await panel.locator('.vela-panel-height-control').count() === 0, 'grip click opens no numeric height popup');
        const afterGripClick = await panel.boundingBox();
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForTimeout(400);
        const landscape = await geometry(page, '.vela-panel.vela-ot');
        assert(landscape.mode === 'desktop' && Math.abs(landscape.p.height - landscape.h.height) < 2 && landscape.radius === '0px', 'rotation makes the same tree a desktop dock', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(400);
        const portrait = await panel.boundingBox();
        assert(Math.abs(portrait.height - afterGripClick.height) < 3 && Math.abs(portrait.y + portrait.height - afterGripClick.y - afterGripClick.height) < 3, 'rotation restores the chosen phone height', { afterGripClick, portrait });
        await panel.locator('.vela-panel-close').tap();
        await page.waitForTimeout(200);
        await openPanel(page, 'Data window', '.vela-dw');
        await page.getByRole('tab', { name: 'Table' }).tap();
        const scroll = page.locator('.vela-dw-table-scroll');
        await touchDrag(page, context, scroll, 0, -110);
        const vertical = await scroll.evaluate((el) => el.scrollTop);
        await touchDrag(page, context, scroll, -130, 0);
        const swipe = await scroll.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop, firstLeft: el.querySelector('tbody tr:not(.vela-dw-table-spacer) td').getBoundingClientRect().left, left: el.getBoundingClientRect().left }));
        assert(vertical > 40 && swipe.x > 40 && Math.abs(swipe.firstLeft - swipe.left) < 2, 'phone swipes scroll the virtual table in both directions while time stays pinned', { vertical, swipe });
        facts.phoneResize = { before, enlarged, afterTitle, keyboard, afterGripClick, landscape: landscape.p, portrait, vertical, swipe };
        await context.close();
    }

    // Desktop width changes do not create a floating card, and title dragging does not
    // undock either of the two standard panels.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        for (const [title, selector] of [['Object tree', '.vela-ot'], ['Data window', '.vela-dw']]) {
            const panel = await openPanel(page, title, selector);
            const before = await panel.boundingBox();
            const seam = await panel.locator('.vela-panel-resizer').boundingBox();
            await page.mouse.move(seam.x + seam.width / 2, seam.y + seam.height / 2);
            await page.mouse.down();
            await page.mouse.move(seam.x - 70, seam.y + seam.height / 2, { steps: 8 });
            await page.mouse.up();
            const wide = await panel.boundingBox();
            assert(wide.width > before.width + 50 && Math.abs(wide.height - before.height) < 2, 'desktop dock width is adjustable', { title, before, wide });
            const h = await panel.locator('.vela-panel-title').boundingBox();
            await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
            await page.mouse.down();
            await page.mouse.move(h.x - 70, h.y + 50, { steps: 8 });
            await page.mouse.up();
            const after = await panel.boundingBox();
            assert(await panel.getAttribute('data-free-floating') === null && Math.abs(after.x - wide.x) < 2 && Math.abs(after.y - wide.y) < 2, 'dragging a standard header never undocks it', { title, wide, after });
            await panel.locator('.vela-panel-close').click();
            await page.waitForTimeout(200);
        }
        await context.close();
    }

    // Live data, studies, selected text, replay and historical-scroll anchoring use a
    // real native renderer, not a fake table model.
    {
        const { context, page } = await boot({ width: 1440, height: 900 });
        await page.evaluate(() => window.__ws.setLayout('1'));
        await openPanel(page, 'Data window', '.vela-dw');
        const point = await page.evaluate(() => {
            const r = window.__ws.active.chart.renderer.renderer, b = r.dataCanvas.getBoundingClientRect();
            return { x: b.x + r.coords.width * .45, y: b.y + r.coords.height * .45 };
        });
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(100);
        const crosshair = await page.locator('.vela-dw-source').textContent();
        const panelBox = await page.locator('.vela-dw').boundingBox();
        await page.mouse.move(panelBox.x + 30, panelBox.y + 90);
        await page.waitForTimeout(100);
        const latest = await page.locator('.vela-dw-source').textContent();
        assert(crosshair === 'Crosshair' && latest === 'Latest bar', 'leaving the chart follows latest immediately instead of holding an old bar', { crosshair, latest });
        const selected = await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const row = [...document.querySelectorAll('.vela-dw-section[data-kind="price"] .vela-dw-row')].find((r) => r.querySelector('.vela-dw-label').textContent === 'Close');
            const value = row.querySelector('.vela-dw-value'), range = document.createRange();
            range.selectNodeContents(value);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            const before = value.textContent, bar = chart.lastBar;
            chart.orchestrator.onBar({ ...bar, close: 68427.31, high: 68428 });
            return { before, after: value.textContent, actual: chart.renderer.dataWindowReadout().ohlc.c, source: document.querySelector('.vela-dw-source').textContent };
        });
        assert(selected.after !== selected.before && selected.after === selected.actual && selected.source === 'Latest bar', 'selection never freezes live values', selected);
        await page.evaluate(() => { getSelection().removeAllRanges(); window.__sma = window.__ws.active.chart.addNativeIndicator('sma', { inputs: { length: 3 } }); });
        await page.waitForFunction(() => window.__ws.active.chart.renderer.dataWindowTable(0, 1)?.columns.some((c) => c.label.includes('Moving Average')), null, { timeout: 15000 });
        const dataTab = page.getByRole('tab', { name: 'Data' }), tableTab = page.getByRole('tab', { name: 'Table' });
        await dataTab.focus();
        await page.keyboard.press('ArrowLeft');
        assert(await tableTab.getAttribute('aria-selected') === 'true' && await tableTab.evaluate((el) => el === document.activeElement), 'tab arrows wrap and move focus');
        await page.keyboard.press('Home');
        assert(await dataTab.getAttribute('aria-selected') === 'true', 'Home selects the first tab');
        await page.keyboard.press('End');
        assert(await tableTab.getAttribute('aria-selected') === 'true', 'End selects the last tab');
        await page.waitForTimeout(200);
        const withIndicator = await tableFacts(page);
        assert(withIndicator.headers.some((x) => x.includes('Simple Moving Average')) && withIndicator.first.cells[6] === withIndicator.expected.rows[0].values[0], 'active indicator values align with the corresponding candle', withIndicator);
        await page.evaluate(() => {
            const c = window.__ws.active.chart, b = c.lastBar;
            c.orchestrator.onBar({ ...b, close: 70000.12, high: 70001 });
        });
        await page.waitForTimeout(250);
        const live = await tableFacts(page);
        assert(live.first.cells[4] === live.expected.rows[0].ohlc.c && live.first.cells[6] === live.expected.rows[0].values[0] && live.first.cells[4] !== withIndicator.first.cells[4], 'table updates forming candle and recomputed indicator', live);
        await page.evaluate(() => window.__sma.setVisible(false));
        await page.waitForTimeout(200);
        const hidden = await tableFacts(page);
        assert(hidden.cols === 6 && hidden.headers.every((h) => !h.includes('Moving Average')), 'hidden studies leave the table', hidden.headers);
        await page.evaluate(() => window.__ws.active.chart.renderer.set('timezone', 'Asia/Dhaka'));
        await page.waitForTimeout(150);
        const zoned = await tableFacts(page);
        assert(zoned.zone === 'Asia/Dhaka' && zoned.first.cells[0] === `${zoned.expected.rows[0].date} ${zoned.expected.rows[0].time}` && zoned.first.cells[0] !== hidden.first.cells[0], 'table follows chart timezone', zoned);
        await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: 3200, behavior: 'instant' }));
        await page.waitForTimeout(100);
        const anchorBefore = await page.evaluate(() => {
            const s = document.querySelector('.vela-dw-table-scroll'), index = Math.floor(s.scrollTop / 32) + 2;
            return { top: s.scrollTop, time: document.querySelector(`.vela-dw-table tr[aria-rowindex="${index}"]`)?.dataset.timestamp };
        });
        await page.evaluate(() => {
            const c = window.__ws.active.chart, b = c.lastBar;
            c.orchestrator.onBar({ ...b, time: b.time + 3_600_000, close: b.close + 1, high: b.high + 1 });
        });
        await page.waitForTimeout(150);
        const anchorAfter = await page.evaluate(() => {
            const s = document.querySelector('.vela-dw-table-scroll'), index = Math.floor(s.scrollTop / 32) + 2;
            return { top: s.scrollTop, time: document.querySelector(`.vela-dw-table tr[aria-rowindex="${index}"]`)?.dataset.timestamp };
        });
        assert(anchorAfter.time === anchorBefore.time && anchorAfter.top >= anchorBefore.top + 31, 'new rows preserve a historical reader’s scroll anchor', { anchorBefore, anchorAfter });
        await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
        const replay = await page.evaluate(async () => {
            const c = window.__ws.active.chart, bars = c.renderer.getBars(), cut = bars[199].time;
            await c.replay.start({ from: cut });
            const slice = c.renderer.dataWindowTable(0, 1);
            const table = document.querySelector('.vela-dw-table'), first = table.querySelector('tbody tr:not(.vela-dw-table-spacer)');
            return { cut, total: slice.total, latest: slice.rows[0].timestamp, uiCount: table.getAttribute('aria-rowcount'), uiTime: Number(first.dataset.timestamp), scope: document.querySelector('.vela-dw-table-scope').textContent };
        });
        assert(replay.total === 200 && replay.latest === replay.cut && replay.uiCount === '201' && replay.uiTime === replay.cut && replay.scope.includes('Replay'), 'replay table never leaks unrevealed bars', replay);
        await page.evaluate(() => window.__ws.active.chart.replay.stop());
        await page.waitForTimeout(200);
        assert((await tableFacts(page)).count === 802, 'ending replay restores the loaded table');
        // Exercise a genuinely large loaded series, not just a long visual spacer.
        await page.evaluate(async () => {
            const bars = Array.from({ length: 20_000 }, (_, i) => ({ time: 1700000000000 + i * 60_000, open: 100 + i / 1000, high: 102 + i / 1000, low: 99 + i / 1000, close: 101 + i / 1000, volume: 1234.56789 + i }));
            await window.__ws.active.chart.setMarket({ data: bars });
        });
        await page.waitForTimeout(200);
        const big = await tableFacts(page);
        assert(big.count === 20_001 && big.rendered < 60 && big.first.timestamp === 1700000000000 + 19_999 * 60_000 && big.first.cells[5] === String(1234.56789 + 19_999), '20,000 candles keep a bounded DOM and full volume', big);
        await page.locator('.vela-dw-table-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
        await page.waitForTimeout(150);
        const bigEnd = await tableFacts(page);
        assert(bigEnd.last.index === '20001' && bigEnd.last.timestamp === 1700000000000 && bigEnd.rendered < 60, 'large history remains scrollable to its oldest candle', bigEnd);
        facts.live = { selected, indicator: withIndicator.first.cells[6], live: live.first.cells.slice(4), anchorBefore, anchorAfter, replay, large: { total: big.count - 1, rendered: big.rendered, last: bigEnd.last } };
        await context.close();
    }

    // A linked follower must use its synchronized crosshair, and opening a new chart
    // must rebind the table rather than showing the previously active cell's series.
    {
        const { context, page } = await boot({ width: 1440, height: 900 });
        const setup = await page.evaluate(() => {
            const ws = window.__ws, [leader, follower] = ws.cells();
            ws.sync.set('crosshair', true);
            ws.setActiveCell(follower.id);
            const r = leader.chart.renderer.renderer, rect = r.dataCanvas.getBoundingClientRect();
            return { x: rect.x + r.coords.width * .4, y: rect.y + r.coords.height * .4, follower: follower.id };
        });
        await openPanel(page, 'Data window', '.vela-dw');
        // Opening the dock changes the chart geometry; resolve the leader canvas again.
        const point = await page.evaluate(() => {
            const r = window.__ws.cells()[0].chart.renderer.renderer, rect = r.dataCanvas.getBoundingClientRect();
            return { x: rect.x + r.coords.width * .4, y: rect.y + r.coords.height * .4 };
        });
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(300);
        const sync = await page.evaluate(() => ({ source: document.querySelector('.vela-dw-source').textContent, active: window.__ws.active.id, readout: window.__ws.active.chart.renderer.dataWindowReadout() }));
        assert(sync.active === setup.follower && sync.source === 'Synced crosshair' && sync.readout.source === 'synced', 'active follower follows the linked crosshair', sync);
        await page.mouse.move(5, 5);
        await page.waitForTimeout(200);
        assert(await page.locator('.vela-dw-source').textContent() === 'Latest bar', 'clearing the linked crosshair returns to latest');
        await page.getByRole('tab', { name: 'Table' }).click();
        await page.evaluate(async () => {
            const ws = window.__ws, first = ws.cells()[0];
            await first.chart.setMarket({ data: [{ time: 1700000000000, open: 7, high: 9, low: 6, close: 8, volume: 10 }] });
            ws.setActiveCell(first.id);
        });
        await page.waitForTimeout(200);
        const rebound = await tableFacts(page);
        assert(rebound.count === 2 && rebound.first.timestamp === 1700000000000 && Number(rebound.first.cells[4]) === 8, 'switching active chart rebinds the table', rebound);
        facts.sync = { source: sync.source, rebound: rebound.first };
        await context.close();
    }

    // During overlapping identity changes hide stale rows; a late old response cannot
    // overwrite the newer market. Both states are inspected in the real panel.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await page.evaluate(() => window.__ws.setLayout('1'));
        await openPanel(page, 'Data window', '.vela-dw');
        await page.getByRole('tab', { name: 'Table' }).click();
        await page.evaluate(() => {
            const chart = window.__ws.active.chart, feed = chart.orchestrator.feed;
            feed.loadProgressive = undefined;
            window.__pendingMarkets = [];
            feed.load = (market) => new Promise((resolve) => window.__pendingMarkets.push({ symbol: market.symbol, resolve }));
            void chart.setMarket({ symbol: 'SLOW' });
        });
        await page.waitForFunction(() => window.__pendingMarkets.some((p) => p.symbol === 'SLOW'));
        const slow = await page.evaluate(() => ({ hidden: document.querySelector('.vela-dw-table').hidden, message: document.querySelector('.vela-dw-table-empty').textContent, title: document.querySelector('.vela-dw-table-identity').textContent }));
        await page.evaluate(() => { void window.__ws.active.chart.setMarket({ symbol: 'FAST' }); });
        await page.waitForFunction(() => window.__pendingMarkets.some((p) => p.symbol === 'FAST'));
        const fast = await page.evaluate(() => ({ hidden: document.querySelector('.vela-dw-table').hidden, message: document.querySelector('.vela-dw-table-empty').textContent, title: document.querySelector('.vela-dw-table-identity').textContent }));
        assert(slow.hidden && fast.hidden && slow.message.includes('Loading') && fast.message.includes('Loading') && slow.title.includes('SLOW') && fast.title.includes('FAST'), 'overlapping loads never label old rows as the new market', { slow, fast });
        await page.evaluate(() => window.__pendingMarkets.find((p) => p.symbol === 'FAST').resolve([{ time: 1701000000000, open: 241, high: 245, low: 240, close: 243.6, volume: 13 }]));
        await page.waitForFunction(() => !document.querySelector('.vela-dw-table').hidden && document.querySelector('.vela-dw-table-identity').textContent.includes('FAST'));
        const winner = await tableFacts(page);
        await page.evaluate(() => window.__pendingMarkets.find((p) => p.symbol === 'SLOW').resolve([{ time: 1700000000000, open: 1, high: 3, low: 1, close: 2, volume: 1 }]));
        await page.waitForTimeout(250);
        const late = await tableFacts(page);
        assert(winner.count === 2 && Number(winner.first.cells[4]) === 243.6 && late.first.timestamp === winner.first.timestamp && late.first.cells[4] === winner.first.cells[4], 'superseded market response cannot replace the current table', { winner, late });
        facts.loading = { slow, fast, winner: winner.first, late: late.first };
        await context.close();
    }

    assert(errors.length === 0, 'no browser page errors', errors);
    report('data-window', { ...facts, errors });
} finally {
    await browser.close();
}
