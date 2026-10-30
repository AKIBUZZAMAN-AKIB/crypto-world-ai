// The real phone More → Chart actions path: a compact anchored menu using the same
// actions as desktop right-click. No screenshots, mock pages or live feed required.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { sizes: [] };
const source = `/@fs${resolve(dirname(fileURLToPath(import.meta.url)), '../../src/widget/contributions.ts')}`;

async function boot(viewport, touch = true) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    return { context, page };
}
async function openActions(page) {
    if (!await page.locator('.vela-more-panel').isVisible()) await page.locator('.vela-mb-more').tap();
    const drawer = page.locator('.vela-more-panel:visible');
    await drawer.waitFor({ state: 'visible' });
    await drawer.locator('.vela-md-row', { hasText: 'Chart actions' }).tap();
    const menu = page.locator('.vela-chart-actions[data-state="open"]');
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(320); // More's closing animation and focus restoration
    return menu;
}
async function pick(page, id) {
    const menu = await openActions(page);
    await menu.locator(`[data-vei-id="${id}"]`).tap();
    await page.waitForTimeout(300);
    assert(await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'a picked action closes the menu', id);
}

try {
    for (const spec of [{ width: 240, height: 320 }, { width: 280, height: 350 }, { width: 320, height: 640 }, { width: 390, height: 780 }]) {
        const { context, page } = await boot(spec);
        await openActions(page);
        const info = await page.evaluate(() => {
            const el = document.querySelector('.vela-chart-actions');
            const trigger = [...document.querySelectorAll('.vela-more-panel .vela-md-row')].find((r) => r.textContent.includes('Chart actions'));
            return {
                rect: el.getBoundingClientRect().toJSON(), anchor: trigger.getBoundingClientRect().toJSON(),
                role: el.getAttribute('role'), label: el.getAttribute('aria-label'), labelledby: el.getAttribute('aria-labelledby'),
                drawer: !!el.closest('.vela-drawer, .vela-dialog, [aria-modal="true"]'),
                grip: !!el.querySelector('.vela-size-grip, .vela-panel-grip, .vela-drawer-grab'),
                oldSheet: !!document.querySelector('.vela-cmd-list'),
                rowHeights: [...el.querySelectorAll('.vela-menu-item')].map((row) => row.getBoundingClientRect().height),
                overflow: document.documentElement.scrollWidth - innerWidth,
                focus: document.activeElement === el,
            };
        });
        assert(info.rect.left >= 0 && info.rect.right <= spec.width && info.rect.top >= 0 && info.rect.bottom <= spec.height && info.overflow <= 0, 'menu stays within a narrow portrait viewport', { spec, info });
        assert(info.rect.width <= 225 && info.rect.bottom <= info.anchor.top + 1 && info.role === 'menu' && info.label === 'Chart actions' && !info.labelledby && !info.drawer && !info.grip && !info.oldSheet, 'chart actions is a named, compact, non-modal anchored menu', { spec, info });
        assert(info.rowHeights.every((height) => height >= 39) && info.focus, 'touch rows are usable and menu receives focus', info);
        await page.keyboard.press('ArrowDown');
        assert(await page.locator('.vela-chart-actions [data-highlighted]').innerText() === 'Reset chart view', 'ArrowDown highlights the first action');
        await page.keyboard.press('ArrowDown');
        assert(await page.locator('.vela-chart-actions [data-highlighted]').innerText() === 'Chart syncing…', 'arrow keys navigate the live menu');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const close = await page.evaluate(() => ({ open: document.querySelector('.vela-chart-actions')?.dataset.state, focus: document.activeElement?.className }));
        assert(close.open === 'closed' && close.focus.includes('vela-md-row'), 'Escape dismisses and returns focus to the More row', close);
        facts.sizes.push({ viewport: [spec.width, spec.height], menu: [info.rect.x, info.rect.y, info.rect.width, info.rect.height] });
        await context.close();
    }

    // An embedded, offset workspace is a boundary even when the browser is much larger.
    {
        const { context, page } = await boot({ width: 1000, height: 750 });
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style, { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
        await page.waitForTimeout(400);
        await openActions(page);
        const box = await page.locator('.vela-chart-actions').boundingBox();
        assert(box.x >= 100 && box.x + box.width <= 380 && box.y >= 110 && box.y + box.height <= 460, 'menu fits an offset embedded host', box);
        await page.evaluate(() => { [...document.querySelectorAll('.vela-more-panel .vela-md-row')].find((r) => r.textContent.includes('Chart actions')).style.visibility = 'hidden'; });
        await page.waitForTimeout(250);
        assert(await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'menu closes if its anchor becomes hidden');
        facts.embedded = box;
        await context.close();
    }

    // Exercise real state on the SECOND chart; no private action methods are called.
    {
        const { context, page } = await boot({ width: 390, height: 780 });
        const seeded = await page.evaluate(() => {
            const ws = window.__ws;
            ws.setActiveCell('b');
            const a = ws.cell('a').chart, b = ws.cell('b').chart;
            for (const chart of [a, b]) {
                const bar = chart.lastBar;
                chart.drawings.add('hline', { anchors: [{ time: bar.time, price: bar.close }] });
                chart.renderer.set('autoScale', false);
            }
            return { active: ws.active.id, drawings: [a.drawings.all().length, b.drawings.all().length], indicators: [a.indicators().length, b.indicators().length] };
        });
        assert(seeded.active === 'b' && seeded.drawings.join(',') === '1,1' && seeded.indicators.join(',') === '1,1', 'two independent charts are seeded', seeded);
        await pick(page, 'reset-view');
        const reset = await page.evaluate(() => ['a', 'b'].map((id) => window.__ws.cell(id).chart.renderer.get('autoScale')));
        assert(reset.join(',') === 'false,true', 'Reset view targets only the active chart', reset);
        await pick(page, 'remove-drawings');
        const drawings = await page.evaluate(() => ['a', 'b'].map((id) => window.__ws.cell(id).chart.drawings.all().length));
        assert(drawings.join(',') === '1,0', 'Remove drawings targets the active chart', drawings);
        await pick(page, 'remove-indicators');
        const indicators = await page.evaluate(() => ['a', 'b'].map((id) => window.__ws.cell(id).chart.indicators().length));
        assert(indicators.join(',') === '1,0', 'Remove indicators targets the active chart', indicators);
        const menu = await openActions(page);
        const disabled = await menu.locator('[data-vei-id="remove-drawings"], [data-vei-id="remove-indicators"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-disabled')));
        assert(disabled.join(',') === 'true,true', 'empty clears stay visible but disabled', disabled);
        // An outside tap closes without selecting a menu row.
        await page.touchscreen.tap(8, 140);
        await page.waitForTimeout(250);
        assert(await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'outside tap dismisses');
        await page.evaluate(() => {
            // The outside tap may activate another chart; explicitly select b again.
            window.__ws.setActiveCell('b');
            const a = window.__ws.cell('a').chart, b = window.__ws.cell('b').chart;
            a.renderer.set('axisLabels', true); b.renderer.set('axisLabels', false);
        });
        await pick(page, 'apply-settings-all');
        const applied = await page.evaluate(() => window.__ws.cells().map((cell) => cell.chart.renderer.get('axisLabels')));
        assert(applied.every((value) => value === false), 'Apply settings copies the active chart onto every other chart', applied);
        await pick(page, 'chart-syncing');
        const syncPane = page.locator('.vela-layout-setup');
        await syncPane.waitFor({ state: 'visible' });
        assert(await syncPane.getByRole('tab', { name: 'Chart syncing' }).getAttribute('aria-selected') === 'true',
            'Chart syncing opens the shared setup pane on the syncing tab');
        await syncPane.locator('.vela-panel-close').click();
        await page.waitForTimeout(300);
        await pick(page, 'settings:Canvas');
        const settings = await page.locator('[role="dialog"]:visible').innerText();
        assert(settings.includes('Canvas') && settings.includes('Symbol'), 'Settings opens the real chart settings dialog', settings.slice(0, 120));
        facts.actions = { seeded, reset, drawings, indicators, disabled, applied, sync: true, settings: true };
        await context.close();
    }

    // Long contributed lists scroll internally; gated contributions, context and action
    // execution match the desktop body model, including a null off-plot pointer.
    {
        const { context, page } = await boot({ width: 280, height: 350 });
        await page.evaluate(async (url) => {
            const { registerWidgetAction } = await import(url);
            window.__chartActionOff = Array.from({ length: 18 }, (_, i) => registerWidgetAction({
                id: `browser.chart-action-${i}`, target: 'context:body', order: i,
                label: `Custom action ${String(i).padStart(2, '0')} with a deliberately long label`,
                run: (ctx) => { window.__chartActionResult = { index: i, pointer: ctx.pointer, activeChart: ctx.chart === window.__ws.active.chart }; },
            }));
            window.__chartActionOff.push(registerWidgetAction({ id: 'browser.hidden-action', target: 'context:body', label: 'Hidden gated action', when: () => false, run: () => {} }));
        }, source);
        const menu = await openActions(page);
        const before = await menu.evaluate((el) => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, labels: el.innerText, state: el.dataset.state }));
        assert(before.scrollHeight > before.height + 200 && !before.labels.includes('Hidden gated action'), 'long live contribution list scrolls and respects gating', { ...before, labels: before.labels.slice(0, 140) });
        const box = await menu.boundingBox();
        const cdp = await context.newCDPSession(page);
        const x = box.x + box.width / 2, start = box.y + box.height - 30, end = box.y + 40;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * i / 8 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForTimeout(300);
        const touchScroll = await menu.evaluate((el) => ({ top: el.scrollTop, state: el.dataset.state }));
        assert(touchScroll.top > 50 && touchScroll.state === 'open', 'a real touch swipe scrolls inside without selecting or dismissing', touchScroll);
        await menu.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(150);
        const scrolled = await menu.evaluate((el) => ({ top: el.scrollTop, state: el.dataset.state, rect: el.getBoundingClientRect().toJSON() }));
        assert(scrolled.top > 100 && scrolled.state === 'open', 'internal scrolling does not dismiss the menu', scrolled);
        await menu.locator('[data-vei-id="action:browser.chart-action-17"]').tap();
        const action = await page.evaluate(() => window.__chartActionResult);
        assert(action?.index === 17 && action.activeChart && action.pointer?.price === null && action.pointer?.time === null && action.pointer?.paneKind === null, 'contributed action runs with the active chart and off-plot pointer', action);
        facts.contributions = { height: before.height, scrollHeight: before.scrollHeight, touchScroll: touchScroll.top, scrolled: scrolled.top, action };
        await page.evaluate(() => window.__chartActionOff.forEach((off) => off()));
        await context.close();
    }

    // Rotation removes More; neither a stale floating menu nor its listeners survive.
    {
        const { context, page } = await boot({ width: 390, height: 780 });
        await openActions(page);
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForTimeout(600);
        const landscape = await page.evaluate(() => ({ mode: document.querySelector('.vela-workspace').dataset.layout, menu: document.querySelector('.vela-chart-actions')?.dataset.state, moreVisible: (document.querySelector('.vela-mb-more')?.getClientRects().length ?? 0) > 0, overflow: document.documentElement.scrollWidth - innerWidth }));
        assert(landscape.mode === 'desktop' && landscape.menu === 'open' && !landscape.moreVisible && landscape.overflow <= 0 && await page.locator('.vela-more-panel').isVisible(), 'rotation preserves More and its still-visible menu anchor', landscape);
        await page.keyboard.press('Escape'); await page.waitForTimeout(150);
        // More is deliberately hidden in landscape. Exercise the same menu's geometry
        // against a visible topbar anchor without inventing a new user-facing button.
        await page.evaluate(() => window.__ws.active.openChartMenu(document.querySelector('.vela-widget-symbol')));
        await page.locator('.vela-chart-actions[data-state="open"]').waitFor();
        await page.waitForTimeout(250);
        const flipped = await page.evaluate(() => ({ menu: document.querySelector('.vela-chart-actions').getBoundingClientRect().toJSON(), anchor: document.querySelector('.vela-widget-symbol').getBoundingClientRect().toJSON() }));
        assert(flipped.menu.left >= 0 && flipped.menu.right <= 780 && flipped.menu.top >= flipped.anchor.bottom && flipped.menu.bottom <= 390, 'landscape menu flips below a visible topbar anchor', flipped);
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(500);
        await openActions(page);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        assert(await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'menu works after rotating back');
        facts.rotation = { ...landscape, flipped: flipped.menu };
        await context.close();
    }

    // Desktop context menu must still open by right-click and retain its own body rows.
    {
        const { context, page } = await boot({ width: 1440, height: 900 }, false);
        const host = page.locator('.vela-cell').first();
        const box = await host.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.waitForTimeout(250);
        const desktop = await page.locator('.vela-menu[data-state="open"]:visible').first().innerText();
        assert(desktop.includes('Reset chart view') && desktop.includes('Remove drawings') && desktop.includes('Settings…') && await page.locator('.vela-chart-actions[data-state="open"]').count() === 0, 'desktop right-click body menu remains intact', desktop);
        facts.desktop = desktop.split('\n');
        await context.close();
    }
    assert(errors.length === 0, 'no chart actions page errors', errors);
    report('floating-chart-actions', { ...facts, errors });
} finally {
    await browser.close();
}
