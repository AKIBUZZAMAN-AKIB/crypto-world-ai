// Measure the real notification/hidden-chart badges and selected controls in both
// themes. No screenshots: use computed colors, actual events and workspace actions.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], facts = { badges: [], controls: [], layouts: [], menus: [], indicators: [], settings: [] };
const contrast = (a, b) => {
    const luminance = (rgb) => {
        const [r, g, bl] = rgb.map((n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * r + .7152 * g + .0722 * bl;
    };
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const saturated = (rgb) => Math.max(...rgb) - Math.min(...rgb) >= 25;

// Computed CSS colors may be rgba() or color(srgb ...). Canvas normalizes both;
// composite translucent backgrounds from the host outwards for a meaningful ratio.
async function read(page, selector, pseudo = null) {
    return page.locator(selector).first().evaluate((el, pseudo) => {
        const ctx = document.createElement('canvas').getContext('2d');
        function rgba(value) {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data];
        }
        function over(f, b) {
            const alpha = f[3] / 255;
            return [0, 1, 2].map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha))).concat(255);
        }
        const stack = [];
        for (let node = el; node; node = node.parentElement) stack.push(rgba(getComputedStyle(node).backgroundColor));
        let bg = [255, 255, 255, 255];
        for (const layer of stack.reverse()) bg = over(layer, bg);
        const style = getComputedStyle(el, pseudo), rect = el.getBoundingClientRect();
        const ownBg = rgba(style.backgroundColor);
        return { fg: over(rgba(style.color), bg).slice(0, 3), bg: (pseudo ? over(ownBg, bg) : bg).slice(0, 3),
            ownBg: ownBg.slice(0, 3), ownAlpha: ownBg[3], border: rgba(style.borderTopColor).slice(0, 3),
            opacity: style.opacity, text: el.textContent, disabled: el.disabled ?? false,
            filter: style.filter, hidden: el.hidden, width: rect.width, height: rect.height };
    }, pseudo);
}

try {
    for (const [device, viewport] of [['phone', { width: 390, height: 780 }], ['desktop', { width: 1280, height: 820 }]]) {
        const touch = device === 'phone';
        const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(`${device}: ${e}`));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length === 4);
        await page.evaluate(async () => {
            await Promise.all(window.__ws.cells().map((cell) => cell.chart.ready()));
            window.__ws.setActiveCell('a'); window.__ws.setLayout('1');
            const chart = window.__ws.active.chart;
            window.__accentDrawing = chart.drawings.add('hline', { anchors: [{ time: chart.lastBar.time, price: chart.lastBar.close + 5 }], style: { lineColor: '#e33e55' } }).id;
            window.__accentDownColor = chart.renderer.getConfig().candles.downColor;
            window.__ws.active.chart.orchestrator.events.emit('alert', { id: 'accent', indicator: 'RSI', title: 'Signal', message: 'event', time: Date.now() });
            window.__ws.openAlertCreate();
        });
        await page.waitForTimeout(250);
        for (const premium of [true, false]) for (const theme of ['dark', 'light']) {
            await page.evaluate(({ premium, theme }) => { window.__ws.setTheme(theme); document.documentElement.classList.toggle('vela-premium', premium); }, { premium, theme });
            await page.waitForTimeout(100);
            const market = await page.evaluate(() => ({ drawing: window.__ws.active.chart.drawings.all().find((d) => d.id === window.__accentDrawing)?.style.lineColor,
                down: window.__ws.active.chart.renderer.getConfig().candles.downColor, initialDown: window.__accentDownColor }));
            assert(market.drawing === '#e33e55' && market.down === market.initialDown, 'theme and accent styling preserve drawing and candle colors', { device, premium, theme, market });
            const selectors = touch ? ['.vela-mb-alerts .vela-mb-badge', '.vela-mb-more .vela-mb-badge'] : ['.vela-widget-alerts .vela-alerts-badge'];
            for (const selector of selectors) {
                const value = await read(page, selector), ratio = contrast(value.fg, value.bg);
                facts.badges.push({ device, premium, theme, selector, ...value, ratio });
                assert(!value.hidden && value.width > 0 && value.text === (selector.includes('more') ? '3' : '1'), 'real alert and hidden-chart counts are visible', { device, premium, theme, selector, value });
                assert(value.opacity === '1' && saturated(value.bg) && ratio >= 4.5, 'count badge uses a colored fill with legible text', { device, premium, theme, selector, value, ratio });
            }
            const form = page.locator('.vela-ap-create-view');
            await form.getByLabel('Alert level').fill('123');
            const enabled = await read(page, '.vela-ap-create-view .vela-ac-create');
            let hover = null;
            if (!touch) {
                await form.locator('.vela-ac-create').hover(); await page.waitForTimeout(180);
                hover = await read(page, '.vela-ap-create-view .vela-ac-create');
                assert(hover.filter === 'none' && contrast(hover.fg, hover.bg) >= 4.5, 'hovered Create keeps legible text without filtering its ink', { premium, theme, hover });
                await page.mouse.move(3, 3);
            }
            await form.getByLabel('Alert level').fill('');
            const disabled = await read(page, '.vela-ap-create-view .vela-ac-create');
            await form.getByLabel('Alert level').fill('123');
            const selected = await read(page, '.vela-ap-create-view .vela-ac-opt[aria-pressed="true"]');
            const tab = await read(page, '.vela-ap-tab[aria-selected="true"]', '::after');
            const entry = { device, premium, theme, enabled, disabled, selected, tab, enabledRatio: contrast(enabled.fg, enabled.bg), disabledRatio: contrast(disabled.fg, disabled.bg), selectedRatio: contrast(selected.fg, selected.bg) };
            facts.controls.push(entry);
            assert(!enabled.disabled && enabled.opacity === '1' && entry.enabledRatio >= 4.5, 'Create stays legible when enabled', entry);
            assert(disabled.disabled && disabled.opacity === '1' && entry.disabledRatio >= 4.5, 'Create remains legible when disabled', entry);
            assert(entry.selectedRatio >= 4.5 && saturated(selected.border) && saturated(tab.ownBg), 'selected frequency and tab are colored without losing text contrast', entry);
            if (premium) assert(saturated(enabled.bg), 'premium Create uses the selected color, not white-on-white', entry);
        }
        // Counts still obey the real cap and clear/reopen behavior.
        await page.evaluate(() => { const bus = window.__ws.active.chart.orchestrator.events; for (let i = 0; i < 10; i++) bus.emit('alert', { id: `accent-${i}`, indicator: 'RSI', title: 'Signal', message: 'event', time: Date.now() + i }); });
        const count = await page.locator(touch ? '.vela-mb-alerts .vela-mb-badge' : '.vela-widget-alerts .vela-alerts-badge').innerText();
        assert(count === '9+', 'colored alert badge retains the 9+ cap', { device, count });
        if (touch) {
            await page.locator('.vela-ap .vela-panel-close').click();
            await page.locator('.vela-mb-more').click();
            const row = page.locator('.vela-more-panel:visible .vela-md-row').filter({ hasText: /^Hidden charts/ });
            assert(await row.count() === 1 && /3/.test(await row.innerText()), 'hidden chart count remains actionable through More');
            await page.evaluate(() => window.__ws.sync.set('symbol', true));
            await page.locator('.vela-more-panel:visible .vela-md-row').filter({ hasText: /^Layout setup/ }).click();
            await page.locator('.vela-layout-setup').getByRole('tab', { name: 'Chart syncing' }).click();
            await page.waitForSelector('.vela-ls-syncrows [aria-checked="true"] .vela-ls-switch:visible');
            for (const theme of ['dark', 'light']) {
                await page.evaluate((theme) => { document.documentElement.classList.add('vela-premium'); window.__ws.setTheme(theme); }, theme);
                await page.waitForTimeout(180);
                const label = await read(page, '.vela-ls-syncrows [aria-checked="true"] .vela-ls-row-label');
                const track = await read(page, '.vela-ls-syncrows [aria-checked="true"] .vela-ls-switch');
                const thumb = await read(page, '.vela-ls-syncrows [aria-checked="true"] .vela-ls-switch', '::after');
                const phoneSwitch = { theme, label, track, thumb, labelRatio: contrast(label.fg, label.bg), thumbRatio: contrast(thumb.bg, track.bg) };
                facts.menus.push(phoneSwitch);
                assert(phoneSwitch.labelRatio >= 4.5 && saturated(track.bg) && phoneSwitch.thumbRatio >= 3,
                    'phone sync control keeps its label and colored on-switch readable', phoneSwitch);
            }
        } else {
            await page.locator('.vela-ap .vela-panel-close').click();
            const studyId = await page.evaluate(() => window.__ws.active.chart.addNativeIndicator('rsi').id);
            await page.waitForTimeout(250);
            for (const theme of ['dark', 'light']) {
                await page.evaluate((theme) => { document.documentElement.classList.add('vela-premium'); window.__ws.setTheme(theme); }, theme);
                await page.locator('button[aria-label^="Layout —"]').click();
                await page.waitForSelector('.vela-layout-setup .vela-lp-sq[data-on="1"]:visible'); await page.waitForTimeout(180);
                const on = await read(page, '.vela-layout-setup .vela-lp-sq[data-on="1"]'), off = await read(page, '.vela-layout-setup .vela-lp-sq:not([data-on="1"])');
                const entry = { theme, on, off, ratio: contrast(on.bg, off.bg) };
                facts.layouts.push(entry);
                assert(saturated(on.bg) && entry.ratio >= 3 && on.bg.join(',') !== off.bg.join(','), 'selected square grid boxes use a visible accent', entry);
                await page.locator('.vela-layout-setup .vela-panel-close').click(); await page.waitForTimeout(120);
                await page.locator('.vela-widget-style').first().click();
                const selectedRow = page.locator('.vela-menu-item[data-checked]:visible, .vela-menu-item[data-checkmark]:visible').filter({ has: page.locator('.vela-menu-badge .vela-icon') }).first();
                await selectedRow.waitFor(); await page.waitForTimeout(150);
                const iconBadge = await read(page, '.vela-menu-item[data-checked]:visible .vela-menu-badge, .vela-menu-item[data-checkmark]:visible .vela-menu-badge');
                await selectedRow.hover(); await page.waitForTimeout(120);
                const iconHover = await read(page, '.vela-menu-item[data-checked]:visible .vela-menu-badge, .vela-menu-item[data-checkmark]:visible .vela-menu-badge');
                const iconTile = { theme, iconBadge, iconHover, ratio: contrast(iconBadge.fg, iconBadge.bg), hoverRatio: contrast(iconHover.fg, iconHover.bg) };
                facts.menus.push(iconTile);
                assert(saturated(iconBadge.bg) && iconTile.ratio >= 4.5 && iconTile.hoverRatio >= 4.5,
                    'selected price-style icon badge keeps a colored fill and visible glyph on hover', iconTile);
                const priceStar = selectedRow.locator('.vela-menu-star');
                if (!await priceStar.evaluate((el) => el.classList.contains('vela-fav'))) await priceStar.click();
                await page.waitForTimeout(150);
                const menuStar = await read(page, '.vela-menu-star.vela-fav:visible');
                // Mask icons paint their own `background-color: currentColor`; their actual
                // surrounding surface is the row, not that masked glyph's paint color.
                const starSurface = await read(page, '.vela-menu-item:visible:has(.vela-menu-star.vela-fav)');
                assert(saturated(menuStar.fg) && menuStar.opacity === '1' && contrast(menuStar.fg, starSurface.bg) >= 3,
                    'favorite price-style star stays colored and distinguishable', { theme, menuStar, starSurface });
                await page.keyboard.press('Escape'); await page.waitForTimeout(120);
                await page.evaluate(() => { window.__ws.setAutosave(true); window.__ws.openLayoutManager(); });
                await page.waitForSelector('.vela-lmp .vela-menu-switch.on:visible'); await page.waitForTimeout(180);
                const toggle = await read(page, '.vela-lmp .vela-menu-switch.on');
                const thumb = await read(page, '.vela-lmp .vela-menu-switch.on', '::after');
                const menu = { theme, toggle, thumb, ratio: contrast(thumb.bg, toggle.bg) };
                facts.menus.push(menu);
                assert(saturated(toggle.bg) && menu.ratio >= 3, 'on switch in Manage layouts uses a colored track and a contrasting thumb', menu);
                await page.keyboard.press('Escape'); await page.waitForTimeout(120);
                await page.evaluate(() => { window.__ws.setAutosave(true); window.__ws.topbar.openLayoutMenu(); });
                await page.waitForSelector('.vela-lm-switch[aria-checked="true"]:visible'); await page.waitForTimeout(180);
                const autoHeading = await read(page, '.vela-lm-switch b');
                const autoDescription = await read(page, '.vela-lm-switch small');
                const autoTrack = await read(page, '.vela-lm-switch .vela-lm-pill');
                const autoThumb = await read(page, '.vela-lm-switch .vela-lm-pill', '::after');
                const autosave = { theme, autoHeading, autoDescription, autoTrack, autoThumb,
                    headingRatio: contrast(autoHeading.fg, autoHeading.bg), descriptionRatio: contrast(autoDescription.fg, autoDescription.bg), thumbRatio: contrast(autoThumb.ownBg, autoTrack.bg) };
                facts.menus.push(autosave);
                assert(autosave.headingRatio >= 4.5 && autosave.descriptionRatio >= 4.5 && saturated(autoTrack.bg) && autosave.thumbRatio >= 3,
                    'autosave keeps readable row text and a colored track with a contrasting thumb', autosave);
                for (const premium of [true, false]) {
                    await page.evaluate((premium) => document.documentElement.classList.toggle('vela-premium', premium), premium);
                    await page.waitForTimeout(120);
                    await page.locator('.vela-lm-primary').hover(); await page.waitForTimeout(160);
                    const saveHover = await read(page, '.vela-lm-primary');
                    assert(!saveHover.disabled && saveHover.filter === 'none' && contrast(saveHover.fg, saveHover.bg) >= 4.5,
                        'layout Save keeps legible colored ink on hover in both style modes', { theme, premium, saveHover });
                }
                await page.evaluate(() => document.documentElement.classList.add('vela-premium'));
                await page.keyboard.press('Escape'); await page.waitForTimeout(120);
                await page.evaluate(() => window.__ws.openIndicatorTemplates());
                await page.waitForSelector('.vela-tm-tab[data-active="1"]:visible'); await page.waitForTimeout(180);
                const active = await read(page, '.vela-tm-tab[data-active="1"]');
                await page.locator('.vela-tm-save').click();
                const primary = await read(page, '.vela-tm-primary');
                await page.locator('.vela-tm-primary').hover(); await page.waitForTimeout(180);
                const primaryHover = await read(page, '.vela-tm-primary');
                const template = { theme, active, primary, primaryHover, tabRatio: contrast(active.fg, active.bg),
                    primaryRatio: contrast(primary.fg, primary.bg), hoverRatio: contrast(primaryHover.fg, primaryHover.bg) };
                facts.menus.push(template);
                assert(saturated(active.fg) && template.tabRatio >= 4.5, 'selected template tab accent stays legible over its tinted surface', template);
                assert(saturated(primary.bg) && template.primaryRatio >= 4.5 && primaryHover.filter === 'none' && template.hoverRatio >= 4.5,
                    'template Save uses a legible colored fill in both normal and hover states', template);
                await page.evaluate(() => document.documentElement.classList.remove('vela-premium')); await page.waitForTimeout(160);
                await page.locator('.vela-tm-primary').hover(); await page.waitForTimeout(160);
                const plainSave = await read(page, '.vela-tm-primary');
                assert(saturated(plainSave.bg) && plainSave.filter === 'none' && contrast(plainSave.fg, plainSave.bg) >= 4.5,
                    'plain-mode template Save retains its colored, legible hover', { theme, plainSave });
                await page.evaluate(() => document.documentElement.classList.add('vela-premium'));
                await page.keyboard.press('Escape'); await page.waitForTimeout(120);
                await page.evaluate(() => window.__ws.indicatorPicker.open(''));
                await page.waitForSelector('.vela-ip-row[data-present="1"] .vela-ip-name:visible'); await page.waitForTimeout(150);
                const name = await read(page, '.vela-ip-row[data-present="1"] .vela-ip-name:visible');
                const starButton = page.locator('.vela-ip-row[data-present="1"] .vela-ip-star').first();
                if (await starButton.getAttribute('data-on') !== '1') await starButton.click();
                await page.waitForTimeout(120);
                const star = await read(page, '.vela-ip-star[data-on="1"]:visible');
                const indicator = { theme, name, star, nameRatio: contrast(name.fg, name.bg), starRatio: contrast(star.fg, star.bg) };
                facts.indicators.push(indicator);
                assert(saturated(name.fg) && indicator.nameRatio >= 4.5, 'present indicator name uses a readable colored ink', indicator);
                assert(saturated(star.fg) && indicator.starRatio >= 3, 'favorite star remains colored and distinct from its surface', indicator);
                await page.evaluate(() => window.__ws.indicatorPicker.close()); await page.waitForTimeout(200);
                await page.evaluate(() => window.__ws.active.chart.renderer.openSettings());
                await page.waitForSelector('.vela-dialog--settings .vela-switch[data-checked]:visible');
                const check = await read(page, '.vela-dialog--settings .vela-switch[data-checked]:visible');
                await page.locator('.vela-dialog--settings .vela-color-field').first().click();
                await page.waitForSelector('.vela-color-field-pop button[data-c="#33adeb"]:visible');
                const swatch = await read(page, '.vela-color-field-pop button[data-c="#33adeb"]');
                await page.locator('.vela-color-field-pop button[data-c="#33adeb"]').click();
                const chartColors = await page.evaluate(() => {
                    const chart = window.__ws.active.chart;
                    const knob = document.querySelector('.vela-color-field-pop .vela-color-opacity-thumb');
                    return { upColor: chart.renderer.getConfig().candles.upColor, handle: knob ? getComputedStyle(knob).backgroundColor : null,
                        handleShadow: knob ? getComputedStyle(knob).boxShadow : null };
                });
                const settings = { theme, check, checkRatio: contrast(check.fg, check.bg), swatch, chartColors };
                facts.settings.push(settings);
                assert(saturated(check.bg) && settings.checkRatio >= 4.5, 'checked settings controls use a colored fill with a contrasting mark', settings);
                assert(swatch.bg.join(',') === '51,173,235' && chartColors.upColor === '#33adeb' && chartColors.handle && chartColors.handleShadow !== 'none',
                    'real color swatches and their chosen chart color survive the accent styling', settings);
                await page.keyboard.press('Escape'); await page.waitForTimeout(120);
                await page.locator('.vela-dialog--settings .vela-dialog-close').click(); await page.waitForTimeout(180);
                for (const premium of [true, false]) {
                    await page.evaluate(({ premium, studyId }) => {
                        document.documentElement.classList.toggle('vela-premium', premium);
                        window.__ws.active.chart.renderer.openIndicatorSettings(studyId);
                    }, { premium, studyId });
                    await page.waitForSelector('.vela-ind-dialog .vela-dialog-btn-primary:visible'); await page.waitForTimeout(160);
                    const dialogButton = await read(page, '.vela-ind-dialog .vela-dialog-btn-primary');
                    await page.locator('.vela-ind-dialog .vela-dialog-btn-primary').hover(); await page.waitForTimeout(180);
                    const dialogHover = await read(page, '.vela-ind-dialog .vela-dialog-btn-primary');
                    const action = { theme, premium, dialogButton, dialogHover, ratio: contrast(dialogButton.fg, dialogButton.bg), hoverRatio: contrast(dialogHover.fg, dialogHover.bg) };
                    facts.settings.push(action);
                    assert(action.ratio >= 4.5 && dialogHover.opacity === '1' && action.hoverRatio >= 4.5,
                        'indicator settings OK stays readable when hovered in both style modes', action);
                    await page.locator('.vela-ind-dialog .vela-dialog-btn-primary').click(); await page.waitForTimeout(180);
                }
            }
            const customColor = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().candles.upColor);
            assert(customColor === '#33adeb', 'custom candle color survives switching the app theme', customColor);
        }
        await context.close();
    }
    assert(errors.length === 0, 'no browser errors', errors);
    report('accent-contrast', { ...facts, errors });
} finally { await browser.close(); }
