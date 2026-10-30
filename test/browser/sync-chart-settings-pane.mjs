// Chart settings, alpha and tooltips through the real workspace in desktop/phone Chromium.
// No screenshots, synthetic HTML, or market-network dependency.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = { tooltips: [], phoneSizes: [] };

async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length && window.__ws.active.chart.lastBar, null, { timeout: 60000 });
    await page.waitForTimeout(350);
    return { context, page };
}

async function touchDrag(page, context, loc, dx, dy, start = { x: 0.5, y: 0.5 }) {
    const r = await loc.boundingBox();
    if (!r) throw new Error('Touch target is missing');
    const x = r.x + r.width * start.x, y = r.y + r.height * start.y;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
        await page.waitForTimeout(14);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(180);
}

async function geometry(page) {
    return page.evaluate(() => {
        const panel = document.querySelector('.vela-dialog--settings');
        const main = document.querySelector('.vela-ws-main');
        const p = panel.getBoundingClientRect(), h = main.getBoundingClientRect(), s = getComputedStyle(panel);
        return { mode: document.querySelector('.vela-workspace').dataset.layout, panel: p.toJSON(), host: h.toJSON(),
            radius: s.borderRadius, shadow: s.boxShadow, background: s.backgroundColor,
            grip: !!panel.querySelector('.vela-sd-pane-grip'), overflow: document.documentElement.scrollWidth - innerWidth,
            title: panel.querySelector('.vela-dialog-title')?.textContent };
    });
}

async function tip(page, selector, name) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    await page.waitForTimeout(100);
    const info = await page.evaluate((selector) => {
        const target = document.querySelector(selector), box = document.querySelector('.vela-tooltip[data-state="open"]');
        const style = box ? getComputedStyle(box) : null;
        return { text: box?.textContent, bg: style?.backgroundColor, fg: style?.color,
            describedBy: target?.getAttribute('aria-describedby'), nativeTitle: target?.getAttribute('title') };
    }, selector);
    assert(info.text === name && info.bg && !info.bg.startsWith('rgba(0, 0, 0, 0)') && info.describedBy && !info.nativeTitle,
        'toolbar button has the shared themed tooltip without a native duplicate', { selector, info });
    return info;
}

try {
    {
        const { context, page } = await boot({ width: 1440, height: 900 });
        for (const [selector, label] of [
            ['.vela-widget-indicators', 'Indicators'],
            ['.vela-widget-templates', 'Indicator templates'],
            ['.vela-widget-compare', 'Compare symbol'],
            ['.vela-widget-panel-dataWindow', 'Data window'],
            ['.vela-widget-panel-objects', 'Object tree'],
        ]) facts.tooltips.push(await tip(page, selector, label));
        await page.evaluate(() => window.__ws.topbar.setCompareSymbol('ETHUSD'));
        facts.compare = await tip(page, '.vela-widget-compare', 'Comparing with ETHUSD — click to change');
        await page.locator('.vela-widget-panel-dataWindow').click();
        await page.locator('.vela-dw').waitFor({ state: 'visible' });
        const close = page.locator('.vela-dw .vela-panel-close');
        assert((await close.getAttribute('title')) === 'Close', 'a dynamically mounted button starts with its native label');
        facts.automaticTip = await tip(page, '.vela-dw .vela-panel-close', 'Close');
        await page.mouse.move(30, 300);
        await page.waitForTimeout(350); // allow the hoverable-tooltip bridge to settle
        assert((await close.getAttribute('title')) === 'Close', 'automatic tooltip restores a dynamic button title on pointer exit');
        await close.click();

        await page.evaluate(() => window.__ws.active.chart.renderer.applyConfig({ crosshair: { color: '#ff000080', opacity: 0.4 } }));
        await page.locator('.vela-bb-settings').click();
        await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
        await page.waitForTimeout(180);
        const original = await geometry(page);
        assert(original.mode === 'desktop' && original.radius === '0px' && !original.grip, 'desktop settings remains a square floating card', original);
        const header = page.locator('.vela-dialog--settings .vela-dialog-header');
        const h = await header.boundingBox();
        await page.mouse.move(h.x + h.width * 0.45, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(h.x + h.width * 0.45 + 83, h.y + h.height / 2 + 56, { steps: 8 });
        await page.mouse.up();
        const moved = await geometry(page);
        assert(moved.panel.x > original.panel.x + 60 && moved.panel.y > original.panel.y + 40,
            'desktop settings still moves by dragging its header', { original, moved });
        const closeTip = await tip(page, '.vela-dialog--settings .vela-dialog-close', 'Close');
        await page.keyboard.press('Escape');
        assert(await page.locator('.vela-dialog--settings').isVisible() && await page.locator('.vela-tooltip[data-state="open"]').count() === 0,
            'Escape dismisses a tooltip without closing its settings parent', closeTip);
        await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
        await page.waitForTimeout(180); // allow the selected-color transition to finish
        const active = await page.locator('.vela-sd-tab.on').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor,
            color: getComputedStyle(el).color, pressed: el.getAttribute('aria-pressed') }));
        assert(active.bg === 'rgb(41, 98, 255)' && active.color === 'rgb(255, 255, 255)' && active.pressed === 'true',
            'the current section is visibly selected in the colored theme', active);
        assert(await page.locator('[data-sd-id="crosshair.style.opacity"]').count() === 0, 'duplicate crosshair opacity row is removed');
        await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').click();
        const picker = page.locator('.vela-color-field-pop');
        await picker.waitFor({ state: 'visible' });
        const pickerInfo = await picker.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), radius: getComputedStyle(el).borderRadius,
            heading: !!el.querySelector('.vela-dialog-title,.vela-panel-header,.vela-size-grip'),
            value: el.querySelector('[aria-label="Opacity percentage"]')?.value,
            role: el.querySelector('[role="slider"]')?.getAttribute('aria-valuenow') }));
        assert(pickerInfo.radius === '0px' && !pickerInfo.heading && pickerInfo.value === '20%' && pickerInfo.role === '20',
            'square compact picker exposes the existing effective alpha without changing it', pickerInfo);
        const old = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair);
        assert(old.color.toLowerCase() === '#ff000080' && old.opacity === 0.4, 'opening the picker does not alter a legacy color/opacity pair', old);
        const pct = picker.locator('[aria-label="Opacity percentage"]');
        await pct.fill('65');
        await pct.press('Enter');
        await picker.locator('button[data-c="#33adeb"]').click();
        const changed = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair);
        assert(changed.color === '#33adeb' && Math.abs(changed.opacity - 0.65) < 0.004,
            'picker changes hue and effective opacity without a second multiplier', changed);
        const slider = picker.locator('[role="slider"]');
        await slider.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        const keyAlpha = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair.opacity);
        assert(Math.abs(keyAlpha - 0.01) < 0.004 && await slider.getAttribute('aria-valuenow') === '1',
            'opacity slider has working keyboard and ARIA values', keyAlpha);
        await page.keyboard.press('Escape');
        assert(await page.locator('.vela-dialog--settings').isVisible(), 'Escape closes the child picker without closing settings');
        await page.locator('.vela-dialog--settings .vela-dialog-close').click();
        await page.waitForTimeout(180);
        await page.locator('.vela-bb-settings').click();
        await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
        await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').click();
        assert(await page.locator('.vela-color-field-pop [aria-label="Opacity percentage"]').inputValue() === '1%',
            'edited opacity survives closing and reopening settings');
        const externalColors = [];
        for (const sample of [
            { color: 'red', opacity: 0.75, expected: '75%', hue: '#ff0000' },
            { color: 'hsl(120 100% 50% / 0.5)', opacity: 0.8, expected: '40%', hue: '#00ff00' },
            { color: '#0af8', opacity: 0.5, expected: '27%', hue: '#00aaff' },
            { color: 'rgb(100% 0% 50% / 25%)', opacity: 0.8, expected: '20%', hue: '#ff0080' },
            { color: 'color(display-p3 1 0 0 / 0.4)', opacity: 0.5, expected: '20%', hue: '#ff0000' },
            { color: 'color-mix(in srgb, red 30%, transparent)', opacity: 0.5, expected: '15%', hue: '#ff0000' },
            { color: 'transparent', opacity: 0.5, expected: '0%', hue: '#000000' },
        ]) {
            await page.evaluate((s) => window.__ws.active.chart.renderer.applyConfig({ crosshair: { color: s.color, opacity: s.opacity } }), sample);
            const readout = await page.locator('.vela-color-field-pop [aria-label="Opacity percentage"]').inputValue();
            const swatch = await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field-swatch').getAttribute('style');
            const rgb = [1, 3, 5].map((i) => parseInt(sample.hue.slice(i, i + 2), 16)).join(', ');
            assert(readout === sample.expected && swatch?.includes(`rgba(${rgb},`),
                'open picker and swatch follow an external CSS color/opacity update without losing its value', { sample, readout, swatch });
            externalColors.push({ ...sample, readout });
        }
        await page.evaluate(() => {
            const renderer = window.__ws.active.chart.renderer;
            renderer.applyConfig({ crosshair: { color: '#ff000080', opacity: 0.4 } });
            renderer.setSettingsVisibility({ hidden: ['crosshair.style.opacity'] });
        });
        await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').click();
        assert(await page.locator('.vela-color-field-pop [role="slider"]').count() === 0,
            'the legacy opacity visibility policy hides the picker opacity editor');
        await page.locator('.vela-color-field-pop button[data-c="#33adeb"]').click();
        const hiddenOpacity = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair);
        assert(hiddenOpacity.color === '#33adeb80' && hiddenOpacity.opacity === 0.4,
            'choosing a hue with opacity hidden preserves both existing alpha sources', hiddenOpacity);
        await page.keyboard.press('Escape');
        await page.locator('.vela-dialog--settings .vela-dialog-close').click();
        await page.evaluate(() => {
            const chart = window.__ws.active.chart;
            const drawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }], style: { lineColor: '#e33e55' } });
            window.__settingsDrawingId = drawing.id;
            chart.drawings.openSettings(drawing.id);
        });
        const drawingColor = page.locator('.vela-dpop [aria-label="Line color, color"]');
        await drawingColor.waitFor({ state: 'visible' });
        const drawingTip = await tip(page, '.vela-dpop [aria-label="Line color, color"]', 'Line color');
        await drawingColor.click();
        const drawingPicker = page.locator('.vela-popover .vela-color-picker');
        const drawingPop = await drawingPicker.evaluate((el) => ({ radius: getComputedStyle(el.parentElement).borderRadius,
            heading: !!el.querySelector('.vela-dialog-title,.vela-size-grip') }));
        assert(drawingPop.radius === '0px' && !drawingPop.heading, 'drawing toolbar also uses a square compact color picker', drawingPop);
        await drawingPicker.locator('button[data-c="#33adeb"]').click();
        const drawingValue = await page.evaluate(() => window.__ws.active.chart.drawings.all().find((d) => d.id === window.__settingsDrawingId).style.lineColor);
        assert(drawingValue === '#33adeb' && await page.locator('.vela-dpop').isVisible(), 'drawing color changes without closing its parent toolbar', drawingValue);
        facts.desktop = { original, moved, active, pickerInfo, changed, keyAlpha, externalColors, hiddenOpacity, drawingTip, drawingPop, drawingValue };
        await context.close();
    }

    {
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        await page.locator('.vela-mb-settings').tap();
        await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
        await page.waitForTimeout(180);
        assert(await page.locator('.vela-tooltip[data-state="open"]').count() === 0, 'a touch tap does not leave a hover tooltip over the pane');
        const before = await geometry(page);
        assert(before.mode === 'mobile' && before.grip && before.radius === '0px' && before.shadow === 'none' &&
            Math.abs(before.panel.left - before.host.left) < 1 && Math.abs(before.panel.width - before.host.width) < 1 &&
            Math.abs(before.panel.bottom - before.host.bottom) < 1 && before.overflow <= 0,
        'phone settings matches the full-width, bottom-attached Data Window geometry', before);
        const grip = page.locator('.vela-sd-pane-grip');
        await touchDrag(page, context, grip, 0, -125);
        const after = await geometry(page);
        assert(after.panel.height > before.panel.height + 100 && Math.abs(after.panel.bottom - before.panel.bottom) < 1,
            'a real touch drag moves the top edge while holding the bottom', { before, after });
        await grip.focus();
        await page.keyboard.press('ArrowDown');
        const keyed = await geometry(page);
        assert(keyed.panel.height < after.panel.height - 20 && Math.abs(keyed.panel.bottom - before.panel.bottom) < 1,
            'the separator supports keyboard resizing', { after, keyed });
        await grip.tap();
        assert(await page.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0 &&
            await page.locator('.vela-dialog--settings').isVisible(), 'tapping the grip opens no size popup and keeps its parent open');

        await page.locator('.vela-sd-burger').tap();
        assert(await page.locator('.vela-sd-burger').getAttribute('aria-expanded') === 'true', 'sections control reports its expanded state');
        await page.getByRole('button', { name: 'Crosshair', exact: true }).tap();
        assert((await geometry(page)).title.includes('Crosshair') && await page.locator('.vela-sd-burger').getAttribute('aria-expanded') === 'false',
            'choosing a section closes the rail and updates the pane title');
        await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').tap();
        const pop = page.locator('.vela-color-field-pop');
        await pop.waitFor({ state: 'visible' });
        const colorBefore = await pop.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), radius: getComputedStyle(el).borderRadius }));
        assert(colorBefore.radius === '0px' && colorBefore.rect.left >= 0 && colorBefore.rect.right <= 390 &&
            colorBefore.rect.top >= 0 && colorBefore.rect.bottom <= 780, 'phone color picker remains square and inside the viewport', colorBefore);
        const track = pop.locator('[role="slider"]');
        const trackBox = await track.boundingBox();
        const targets = await pop.evaluate((el) => {
            const slider = el.querySelector('[role="slider"]').getBoundingClientRect();
            const field = el.querySelector('[aria-label="Opacity percentage"]').getBoundingClientRect();
            const swatches = [...el.querySelectorAll('.vela-color-picker button[data-c]')].slice(0, 2).map((node) => node.getBoundingClientRect());
            return { sliderHeight: slider.height, fieldHeight: field.height,
                swatchStep: swatches[1].left + swatches[1].width / 2 - swatches[0].left - swatches[0].width / 2 };
        });
        assert(targets.sliderHeight >= 24 && targets.fieldHeight >= 24 && targets.swatchStep >= 24,
            'compact controls retain distinct, usable touch targets', targets);
        await touchDrag(page, context, track, trackBox.width * 0.25, 0, { x: 0.25, y: 0.5 });
        const phoneAlpha = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair.opacity);
        assert(Math.abs(phoneAlpha - 0.5) < 0.02, 'touch-dragging opacity updates the actual chart setting', phoneAlpha);
        await page.keyboard.press('Escape');
        assert(await page.locator('.vela-dialog--settings').isVisible(), 'closing the mobile color picker preserves settings');
        const scroller = page.locator('.vela-sd-pane');
        const initialScroll = await scroller.evaluate((el) => el.scrollTop);
        await touchDrag(page, context, scroller, 0, -120, { x: 0.8, y: 0.75 });
        const finalScroll = await scroller.evaluate((el) => el.scrollTop);
        assert(finalScroll > initialScroll + 20, 'the settings body scrolls independently of the resize handle', { initialScroll, finalScroll });
        // Simulate the visual viewport shrinking for an on-screen keyboard without
        // pretending desktop Chromium can reproduce a physical iOS keyboard.
        await page.evaluate(() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 480 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(80);
        const keyboard = await geometry(page);
        assert(Math.abs(keyboard.panel.bottom - 480) < 1 && keyboard.panel.top >= 0,
            'the pane stays within a reduced visual viewport', keyboard);
        await page.evaluate(() => {
            delete window.visualViewport.height;
            window.visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(80);
        assert(Math.abs((await geometry(page)).panel.bottom - before.panel.bottom) < 1, 'the pane reattaches when the visual viewport returns');
        const chartHit = await page.evaluate(() => {
            const hit = document.elementFromPoint(30, 150);
            window.__chartTapCount = 0;
            hit?.addEventListener('pointerdown', () => { window.__chartTapCount++; }, { once: true });
            return { tag: hit?.tagName, inert: !!hit?.closest('[inert]'), ariaModal: document.querySelector('.vela-dialog--settings')?.getAttribute('aria-modal') };
        });
        assert(chartHit.tag === 'CANVAS' && !chartHit.inert && chartHit.ariaModal === 'false',
            'the chart canvas remains hit-testable and non-inert behind the phone pane', chartHit);
        await page.touchscreen.tap(30, 150);
        assert(await page.evaluate(() => window.__chartTapCount) === 1 && await page.locator('.vela-dialog--settings').isVisible(),
            'a real chart tap reaches the canvas without dismissing the phone pane');
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await page.waitForTimeout(250);
        const landscape = await geometry(page);
        assert(landscape.mode === 'desktop' && !landscape.grip && landscape.radius === '0px' && landscape.overflow <= 0,
            'landscape switches to the desktop draggable presentation', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.waitForTimeout(250);
        const portrait = await geometry(page);
        assert(portrait.grip && Math.abs(portrait.panel.bottom - portrait.host.bottom) < 1 && portrait.panel.height > before.panel.height,
            'rotation restores the bottom pane and its chosen height', portrait);
        await page.locator('[data-sd-id="crosshair.style.color"] .vela-color-field').tap();
        assert(await page.locator('.vela-color-field-pop [aria-label="Opacity percentage"]').inputValue() === '50%',
            'the edited opacity and active section remain correct after rotation');
        facts.phone = { before, after, keyed, colorBefore, phoneAlpha, initialScroll, finalScroll, landscape, portrait };
        await context.close();
    }

    {
        const { context, page } = await boot({ width: 1000, height: 800 }, true);
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style,
            { inset: 'auto', left: '100px', top: '110px', width: '280px', height: '350px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.locator('.vela-mb-settings').tap();
        await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
        await page.waitForTimeout(180);
        const embedded = await geometry(page);
        assert(embedded.panel.left === embedded.host.left && embedded.panel.width === embedded.host.width &&
            Math.abs(embedded.panel.bottom - embedded.host.bottom) < 1 && embedded.panel.left >= 100 && embedded.panel.top >= 110,
            'an embedded phone-size workspace owns and bounds its settings pane', embedded);
        facts.embedded = embedded;
        await context.close();
    }

    for (const size of [{ width: 320, height: 568 }, { width: 240, height: 320 }]) {
        const { context, page } = await boot(size, true);
        await page.locator('.vela-mb-settings').tap();
        await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
        await page.waitForTimeout(150);
        const sizeFacts = await geometry(page);
        assert(sizeFacts.overflow <= 0 && sizeFacts.panel.width <= size.width + 1 && sizeFacts.panel.left >= 0 &&
            Math.abs(sizeFacts.panel.bottom - sizeFacts.host.bottom) < 1, 'compact phone has a reachable, contained pane', { size, sizeFacts });
        await page.locator('.vela-color-field:visible').first().tap();
        const popup = await page.locator('.vela-color-field-pop').evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), radius: getComputedStyle(el).borderRadius }));
        assert(popup.rect.left >= 0 && popup.rect.right <= size.width && popup.rect.top >= 0 && popup.rect.bottom <= size.height && popup.radius === '0px',
            'compact color picker fits a narrow phone', { size, popup });
        const narrowSlider = page.locator('.vela-color-field-pop [role="slider"]');
        await narrowSlider.scrollIntoViewIfNeeded();
        await narrowSlider.tap();
        assert(await page.locator('.vela-color-field-pop [aria-label="Opacity percentage"]').inputValue() === '50%',
            'a narrow, scrollable picker still offers tap-to-set opacity', size);
        facts.phoneSizes.push({ size, sizeFacts, popup });
        await context.close();
    }
    assert(errors.length === 0, 'no uncaught browser exceptions', errors);
    report('chart-settings-pane', { ...facts, errors });
} finally {
    await browser.close();
}
