// Strategy Tester: standard-pane geometry, native report tables, touch/keyboard,
// live races and a real Pine run. Reuses the offline workspace; no screenshots.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
import { strategyTesterFixtures } from './fixtures/strategy-tester.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { geometry: [] };
const { wait, boot, openTester, seed, select } = strategyTesterFixtures(browser, errors);

async function rects(page) {
    return page.locator('.vela-st:visible').evaluate((p) => {
        const host = p.parentElement, body = p.querySelector('.vela-panel-body');
        const tabs = p.querySelector('.vela-st-tabs'), active = p.querySelector('.vela-st-view:not([hidden])');
        const scroll = active.querySelector('.vela-st-scroll');
        const head = scroll?.querySelector('thead th');
        const row = scroll?.querySelector('tbody tr:not(.group)');
        const rect = (el) => el?.getBoundingClientRect().toJSON();
        return {
            layout: p.closest('.vela-workspace').dataset.layout,
            standard: p.dataset.standardPane, max: getComputedStyle(p.querySelector('.vela-panel-max')).display !== 'none',
            free: p.dataset.freeFloating ?? null, radius: getComputedStyle(p).borderRadius,
            panel: rect(p), host: rect(host), body: rect(body),
            tabs: { width: tabs.clientWidth, scroll: tabs.scrollWidth,
                children: [...tabs.querySelectorAll('button')].map((b) => ({ text: b.textContent, width: b.clientWidth, textWidth: b.scrollWidth, minHeight: getComputedStyle(b).minHeight })) },
            scroll: scroll && { width: scroll.clientWidth, scrollWidth: scroll.scrollWidth, height: scroll.clientHeight, scrollHeight: scroll.scrollHeight, rect: rect(scroll) },
            header: rect(head), row: rect(row),
            selected: p.querySelector('[role=tab][aria-selected=true]')?.textContent,
            panels: p.querySelectorAll('.vela-st-view:not([hidden])').length,
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
        };
    });
}

async function tableGeometry(page) {
    return page.locator('.vela-st-view:not([hidden]) .vela-st-scroll').evaluate((scroll) => {
        const bounds = scroll.getBoundingClientRect();
        const all = [...scroll.querySelectorAll('tbody th.lbl')];
        const cell = all.find((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= bounds.top + 27 && r.bottom <= bounds.bottom + 2;
        }) ?? all[0];
        const header = scroll.querySelector('thead th:first-child');
        const value = cell?.nextElementSibling;
        const r = cell?.getBoundingClientRect(), v = value?.getBoundingClientRect(), h = header.getBoundingClientRect();
        const style = cell ? getComputedStyle(cell) : null;
        return { rect: r?.toJSON(), value: v?.toJSON(), scroll: bounds.toJSON(), header: h.toJSON(),
            left: scroll.scrollLeft, top: scroll.scrollTop,
            overlap: r && v ? Math.max(0, Math.min(r.right, v.right) - Math.max(r.left, v.left)) : 0,
            bg: style?.backgroundColor, image: style?.backgroundImage,
            z: style?.zIndex, hz: getComputedStyle(header).zIndex };
    });
}

async function touchDrag(context, page, locator, dx, dy) {
    const r = await locator.boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] });
        await wait(page, 12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await wait(page, 350);
}

try {
    // Narrow portrait through tablet, touch landscape and full desktop.
    for (const size of [
        { width: 240, height: 320, touch: true }, { width: 320, height: 640, touch: true },
        { width: 390, height: 780, touch: true }, { width: 768, height: 1024, touch: true },
        { width: 780, height: 390, touch: true }, { width: 1280, height: 820, touch: false },
    ]) {
        const { context, page } = await boot({ width: size.width, height: size.height }, size.touch);
        await openTester(page, size.touch);
        const empty = await page.locator('.vela-st-view:not([hidden])').innerText();
        assert(empty.includes('Add a strategy'), 'empty state is clear before a strategy', { size, empty });
        await seed(page, { amount: 1_234_567_890 });
        await select(page, 'Trades', size.touch);
        const g = await rects(page);
        assert(g.standard === '1' && g.max === (g.layout === 'mobile') && !g.free && g.radius === '0px' && g.panels === 1, 'tester is one square standard pane with phone-only maximize', { size, g });
        assert(g.pageOverflow <= 0 && g.tabs.children.every((t) => t.width >= t.textWidth - 1), 'tabs retain complete labels and never widen the page', { size, g });
        assert(g.scroll && g.scroll.height >= 60 && g.header.top >= g.scroll.rect.top - 1 && g.header.bottom <= g.scroll.rect.bottom + 1 && g.row.top < g.scroll.rect.bottom, 'header and a trade remain usable in the pane', { size, g });
        if (g.layout === 'mobile') {
            assert(Math.abs(g.panel.left - g.host.left) < 1 && Math.abs(g.panel.right - g.host.right) < 1 && Math.abs(g.panel.bottom - g.host.bottom) < 1, 'portrait pane is full width and bottom-attached', { size, g });
        } else {
            assert(Math.abs(g.panel.height - g.host.height) < 2 && g.panel.width < g.host.width, 'landscape/desktop uses a full-height docked column', { size, g });
        }
        const button = page.locator('.vela-st-view:not([hidden]) .vela-st-trade-toggle').first();
        if (size.touch) await button.tap(); else await button.click();
        await wait(page);
        const detail = await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-details').innerText();
        assert(detail.includes('Entry time (UTC)') && detail.includes('Exit time (UTC)') && detail.includes('101.50') && detail.includes('Bars held'), 'touch/click reveals real entry, exit, size and duration without hover', { size, detail });
        assert((await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-toggle').first().getAttribute('aria-expanded')) === 'true', 'trade detail disclosure is exposed accessibly', size);
        const revealed = await page.locator('.vela-st-view:not([hidden]) .vela-st-scroll').evaluate((el) => {
            const label = el.querySelector('.vela-st-trade-details dt').getBoundingClientRect();
            const viewport = el.getBoundingClientRect();
            return { label: label.toJSON(), viewport: viewport.toJSON() };
        });
        assert(revealed.label.top >= revealed.viewport.top && revealed.label.bottom <= revealed.viewport.bottom, 'the first detail is revealed inside even a short phone viewport', { size, revealed });
        await select(page, 'Performance', size.touch);
        const scroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        await scroll.evaluate((el) => el.scrollTo({ top: 145, left: 140, behavior: 'instant' }));
        await wait(page);
        const t = await tableGeometry(page);
        const needsHorizontal = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        assert(t.top > 20 && Math.abs(t.header.top - t.scroll.top) < 2 && Math.abs(t.rect.left - t.scroll.left) < 2 && Number(t.hz) > Number(t.z) && (!needsHorizontal || (t.left > 30 && t.overlap > 5)), 'table scrolls locally while metric labels and headers stay pinned', { size, t, needsHorizontal });
        const values = await page.locator('.vela-st-view:not([hidden]) .vela-st-perf td').evaluateAll((cells) => cells.map((cell) => {
            const range = document.createRange(); range.selectNodeContents(cell);
            return { text: cell.textContent, width: cell.getBoundingClientRect().width, textWidth: range.getBoundingClientRect().width, overflow: getComputedStyle(cell).overflowX };
        }));
        assert(values.every((v) => v.width >= v.textWidth + 15 && v.overflow !== 'hidden'), 'financial figures are not ellipsized or clipped', { size, first: values.slice(0, 5) });
        const overview = page.getByRole('tab', { name: 'Overview', exact: true });
        await overview.focus();
        await page.keyboard.press('End');
        assert(await page.getByRole('tab', { name: 'Properties', exact: true }).getAttribute('aria-selected') === 'true', 'End selects Properties', size);
        await page.keyboard.press('ArrowRight');
        assert(await overview.getAttribute('aria-selected') === 'true', 'right arrow wraps to Overview', size);
        const selected = await overview.evaluate((el) => {
            const view = document.getElementById(el.getAttribute('aria-controls'));
            return { active: document.activeElement === el, label: view?.getAttribute('aria-labelledby'), id: el.id, tabIndex: el.tabIndex };
        });
        assert(selected.active && selected.label === selected.id && selected.tabIndex === 0, 'roving tab focus and tabpanel relation stay coherent', { size, selected });
        facts.geometry.push({ viewport: [size.width, size.height], layout: g.layout, panel: g.panel, tabs: [g.tabs.width, g.tabs.scroll], scrollHeight: g.scroll.height });
        await context.close();
    }

    // Embedded mobile workspace follows its own container, not the browser window.
    {
        const { context, page } = await boot({ width: 1000, height: 750 }, true);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
        await wait(page, 400);
        await openTester(page, true);
        await seed(page);
        await select(page, 'Trades', true);
        const embedded = await rects(page);
        assert(embedded.layout === 'mobile' && embedded.panel.left >= 100 && embedded.panel.right <= 380 && embedded.panel.bottom <= 460 && embedded.scroll.scrollWidth > embedded.scroll.width && embedded.pageOverflow <= 0, 'embedded tester stays inside its host and scrolls its own report', embedded);
        facts.embedded = embedded.panel;
        await context.close();
    }

    // Touch resize, non-drag alternatives, persisted height, and rotation preserve the report.
    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await openTester(page, true);
        await seed(page);
        await select(page, 'Trades', true);
        const panel = page.locator('.vela-st:visible');
        const before = await panel.boundingBox();
        await touchDrag(context, page, panel.locator('.vela-panel-grip'), 0, -115);
        const after = await panel.boundingBox();
        const state = await page.evaluate(() => window.__ws.getState().panels);
        assert(after.height > before.height + 80 && Math.abs((after.y + after.height) - (before.y + before.height)) < 2 && state.heights?.strategyTester > 0.4, 'touch grip changes height while bottom stays fixed and geometry persists', { before, after, state });
        const touchScroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        await touchDrag(context, page, touchScroll, 0, -115);
        const vertical = await touchScroll.evaluate((el) => el.scrollTop);
        await touchDrag(context, page, touchScroll, -130, 0);
        const swiped = await touchScroll.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop, left: el.getBoundingClientRect().left,
            pinned: [...el.querySelectorAll('.vela-st-trade-row td:first-child')].find((cell) => { const r = cell.getBoundingClientRect(), b = el.getBoundingClientRect(); return r.top >= b.top + 27 && r.bottom <= b.bottom; })?.getBoundingClientRect().left }));
        assert(vertical > 40 && swiped.x > 40 && Math.abs(swiped.pinned - swiped.left) < 2, 'real touch swipes scroll both axes with trade number pinned', { vertical, swiped });
        const grip = panel.locator('.vela-panel-grip');
        await grip.tap();
        assert(await panel.locator('.vela-panel-height-control').count() === 0, 'tester grip has no height popup');
        await grip.focus(); await page.keyboard.press('ArrowDown'); await wait(page);
        const keyboard = await panel.boundingBox();
        assert(keyboard.height < after.height - 20 && Math.abs(keyboard.y + keyboard.height - before.y - before.height) < 2,
            'keyboard resizes the tester while its bottom stays attached', { before, after, keyboard });
        await page.setViewportSize({ width: 780, height: 390 });
        await wait(page, 500);
        const landscape = await rects(page);
        assert(landscape.layout === 'desktop' && landscape.selected === 'Trades' && Math.abs(landscape.panel.height - landscape.host.height) < 2, 'phone landscape switches to desktop dock without losing the selected report tab', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await wait(page, 500);
        const portrait = await rects(page);
        assert(portrait.layout === 'mobile' && portrait.selected === 'Trades' && Math.abs(portrait.panel.height - keyboard.height) < 3 && Math.abs(portrait.panel.bottom - portrait.host.bottom) < 2, 'portrait restores the chosen height and attached bottom', { portrait, keyboard });
        facts.rotation = { before, after, keyboard, vertical, swiped, landscape: landscape.panel, portrait: portrait.panel };
        await context.close();
    }

    // Desktop width, non-floating heading, sticky hover in both themes, and live repaint races.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        await openTester(page, false);
        await seed(page, { n: 150 });
        const panel = page.locator('.vela-st:visible');
        const before = await panel.boundingBox();
        const seam = await panel.locator('.vela-panel-resizer').boundingBox();
        await page.mouse.move(seam.x + seam.width / 2, seam.y + seam.height / 2);
        await page.mouse.down();
        await page.mouse.move(seam.x - 70, seam.y + seam.height / 2, { steps: 8 });
        await page.mouse.up();
        await wait(page, 250);
        const resized = await panel.boundingBox();
        assert(resized.width > before.width + 40 && Math.abs(resized.height - before.height) < 2, 'desktop seam widens the fixed dock', { before, resized });
        const title = await panel.locator('.vela-panel-title').boundingBox();
        await page.mouse.move(title.x + 20, title.y + title.height / 2);
        await page.mouse.down();
        await page.mouse.move(title.x - 80, title.y + 80, { steps: 8 });
        await page.mouse.up();
        assert(await panel.getAttribute('data-free-floating') === null, 'the standard heading cannot undock the panel');
        // Narrow again so a pinned column actually overlaps scrolled figures.
        const narrowSeam = await panel.locator('.vela-panel-resizer').boundingBox();
        await page.mouse.move(narrowSeam.x + narrowSeam.width / 2, narrowSeam.y + narrowSeam.height / 2);
        await page.mouse.down();
        await page.mouse.move(narrowSeam.x + 170, narrowSeam.y + narrowSeam.height / 2, { steps: 8 });
        await page.mouse.up();
        await wait(page, 250);
        await select(page, 'Performance');
        const scroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        await scroll.evaluate((el) => el.scrollTo({ top: 130, left: 150, behavior: 'instant' }));
        await wait(page);
        for (const theme of ['dark', 'light']) {
            await page.evaluate((value) => window.__ws.setTheme(value), theme);
            await wait(page);
            let t = await tableGeometry(page);
            await page.mouse.move(t.rect.left + 15, Math.max(t.rect.top, t.scroll.top + 27) + 5);
            await wait(page, 80);
            t = await tableGeometry(page);
            assert(t.bg?.startsWith('rgb(') && t.image?.includes('linear-gradient') && t.overlap > 0 && Number(t.hz) > Number(t.z), 'hovered pinned metric remains opaque above overlapping values', { theme, t });
        }
        await select(page, 'Trades');
        const tradeScroll = page.locator('.vela-st-view:not([hidden]) .vela-st-scroll');
        await tradeScroll.evaluate((el) => el.scrollTo({ top: 700, left: 90, behavior: 'instant' }));
        await wait(page);
        const beforeLive = await tradeScroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        // Same strategy id: a live update should preserve both scroll axes.
        await seed(page, { n: 160 });
        const afterLive = await tradeScroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        assert(Math.abs(beforeLive.top - afterLive.top) < 3 && Math.abs(beforeLive.left - afterLive.left) < 3, 'a live ledger refresh preserves both scroll axes', { beforeLive, afterLive });
        await select(page, 'Performance');
        await select(page, 'Trades');
        const afterTabs = await tradeScroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        assert(Math.abs(afterLive.top - afterTabs.top) < 3 && Math.abs(afterLive.left - afterTabs.left) < 3, 'switching tabs retains both trade-table scroll offsets', { afterLive, afterTabs });
        await page.locator('.vela-st .vela-panel-close').click();
        await wait(page, 350);
        await openTester(page, false);
        const reopened = await tradeScroll.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
        assert(Math.abs(afterTabs.top - reopened.top) < 3 && Math.abs(afterTabs.left - reopened.left) < 3, 'closing and reopening retains the selected tab and trade scroll', { afterTabs, reopened });
        await tradeScroll.evaluate((el) => el.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        await wait(page);
        const first = page.locator('.vela-st-view:not([hidden]) .vela-st-trade-toggle').first();
        const target = await first.boundingBox();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
        await page.mouse.down();
        await seed(page, { n: 161 });
        await page.mouse.up();
        await wait(page);
        assert(await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-toggle').first().getAttribute('aria-expanded') === 'true' && await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-details').count() === 1, 'a live result between mouse-down and release does not steal the trade disclosure click');
        await page.evaluate(() => {
            const cell = document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-row td:nth-child(4)');
            const range = document.createRange(); range.selectNodeContents(cell);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            window.__selectedTradeCell = cell;
        });
        await seed(page, { n: 162 });
        const selection = await page.evaluate(() => ({ text: getSelection().toString(), same: window.__selectedTradeCell === document.querySelector('.vela-st-view:not([hidden]) .vela-st-trade-row td:nth-child(4)') }));
        assert(selection.text && selection.same, 'a live repaint does not erase a text selection while the user copies', selection);
        await page.evaluate(() => getSelection().removeAllRanges());
        await wait(page);
        const painted = await page.locator('.vela-st-view:not([hidden]) .vela-st-trades').getAttribute('aria-rowcount');
        assert(painted === '164' && await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-row').count() < 100, 'the deferred live result paints once selection is cleared, with bounded rows', painted);
        facts.desktop = { before, resized, beforeLive, afterLive, selection };
        await context.close();
    }

    // Active-chart binding, background-market invalidation and the actual Pine broker.
    {
        const { context, page } = await boot({ width: 1280, height: 820 });
        const pine = await page.evaluate(async () => {
            const { PineEngine } = await import('/vendor/pine-libre/index.js');
            const { PINE_SCRIPTS } = await import('/pine-scripts.ts');
            const ws = window.__ws, script = PINE_SCRIPTS.find((s) => s.script.includes('strategy('));
            const c = ws.cell('a').chart;
            c.registerEngine('pine', new PineEngine());
            const result = await c.runScript(script.script, { language: 'pine' });
            window.__pineResult = result;
            return { ok: result.ok, title: result.run?.title, id: result.run?.id,
                trades: (await result.run?.trades() ?? []).length, pnl: result.run?.strategy?.netPnl };
        });
        await page.waitForSelector('.vela-st:visible'); // first real strategy run opens the tester
        await page.waitForFunction(() => document.querySelector('.vela-st-view:not([hidden]) .vela-st-title')?.textContent === 'MACD Strategy');
        await wait(page, 450);
        assert(pine.ok && pine.trades > 0 && Number.isFinite(pine.pnl), 'real Pine engine produced a broker state and ledger', pine);
        const actual = await page.locator('.vela-st-view:not([hidden]) .vela-st-stat-value').first().innerText();
        const mismatch = await page.locator('.vela-st-view:not([hidden]) .vela-st-status').innerText();
        assert(actual !== '—' && actual !== '', 'the real run populated the overview', { pine, actual });
        assert(mismatch.includes('Broker net') && mismatch.includes('ledger'), 'a real broker/ledger P&L discrepancy is disclosed rather than hidden', { pine, actual, mismatch });
        await select(page, 'Trades');
        const rows = await page.locator('.vela-st-view:not([hidden]) .vela-st-trade-row').count();
        assert(rows === pine.trades, 'trade list is fed by the actual Pine ledger', { pine, rows });
        await page.evaluate(() => window.__ws.setActiveCell('b'));
        await wait(page);
        assert((await page.locator('.vela-st-view:not([hidden])').innerText()).includes('Add a strategy'), 'switching to a chart without a strategy does not reuse chart A results');
        await seed(page, { cell: 'b', name: 'B strategy', n: 5 });
        assert((await page.locator('.vela-st-view:not([hidden]) .vela-st-title').innerText()) === 'B strategy', 'chart B receives its own report');
        // A same-symbol replacement of A's candle array is still a new dataset. Its
        // prior report must be invalidated while A is inactive, before the new run lands.
        await page.evaluate(async () => {
            const c = window.__ws.cell('a').chart;
            const bars = c.renderer.getBars().map((b) => ({ ...b, close: b.close + 1, high: b.high + 1 }));
            await c.setMarket({ data: bars });
        });
        await wait(page, 600);
        await page.evaluate(() => window.__ws.setActiveCell('a'));
        await wait(page, 500);
        const afterSwitch = await page.locator('.vela-st-view:not([hidden])').innerText();
        assert(!afterSwitch.includes('B strategy') && (afterSwitch.includes('MACD Strategy') || afterSwitch.includes('Waiting') || afterSwitch.includes('Add a strategy')), 'background market change never displays another chart’s report', afterSwitch.slice(0, 240));
        // Remove the actual strategy while another cell is active; its remembered run must not return.
        await page.evaluate(() => { window.__ws.setActiveCell('b'); window.__pineResult.remove(); });
        await wait(page, 200);
        await page.evaluate(() => window.__ws.setActiveCell('a'));
        await wait(page, 250);
        assert((await page.locator('.vela-st-view:not([hidden])').innerText()).includes('Add a strategy'), 'removing an inactive chart’s strategy clears its remembered run');
        facts.pine = { ...pine, overview: actual, discrepancy: mismatch, rows };
        await context.close();
    }
    assert(errors.length === 0, 'no browser page errors', errors);
    report('strategy-tester', facts);
} finally {
    await browser.close();
}
