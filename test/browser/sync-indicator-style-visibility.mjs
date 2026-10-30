// Indicator settings expose TradingView-style Inputs, Style and Visibility tabs with live effects.
import { open, assert, report, OFFLINE } from './helpers.mjs';
const { browser, page, errors } = await open({ base: OFFLINE, settle: 700, viewport: { width: 1280, height: 820 } });
try {
    const id = await page.evaluate(() => window.__ws.cell('a').chart.addNativeIndicator('moving-average').id);
    await page.waitForFunction((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.has(id), id);
    await page.evaluate((id) => window.__ws.cell('a').chart.renderer.openIndicatorSettings(id), id);
    await page.waitForSelector('.vela-ind-dialog [role="tablist"]');
    const tabs = await page.locator('.vela-ind-dialog [role="tab"]').allTextContents();
    assert(tabs.includes('Inputs') && tabs.includes('Style') && tabs.includes('Visibility'), 'all three standard tabs are present', tabs);

    await page.locator('.vela-ind-dialog [role="tab"]').filter({ hasText: 'Style' }).click();
    const initialStyle = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.get(id).series[0].style, id);
    const colorBefore = initialStyle.color;
    const widthBefore = initialStyle.width;
    const activePanel = page.locator('.vela-ind-dialog [role="tabpanel"]:not([style*="display: none"])');
    await activePanel.locator('[role="switch"][id$="visual:labelsOnScale"]').click();
    await activePanel.locator('[role="switch"][id$="visual:valuesInStatusLine"]').click();
    const displayAfterHide = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.get(id).series[0].display, id);
    assert(displayAfterHide.priceScale === false && displayAfterHide.legend === false, 'price-scale labels and status-line values have separate per-indicator controls', displayAfterHide);
    await activePanel.locator('[aria-label="Choose color"]').first().click();
    await page.locator('.vela-color-field-pop button[data-c="#de675e"]').click();
    const colorAfter = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.get(id).series[0].style.color, id);
    assert(colorBefore !== colorAfter && colorAfter === '#de675e', 'static plot color picker updates the rendered series immediately', { colorBefore, colorAfter });
    const widthInput = activePanel.locator('input[type="number"][id$=":width"]').first();
    await widthInput.fill('4');
    await widthInput.press('Tab');
    const widthAfter = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.get(id).series[0].style.width, id);
    assert(widthAfter === 4, 'line-width control updates rendered style without rerunning the indicator', widthAfter);
    const plotStyleSelect = activePanel.locator('button[id$=":plotStyle"]').first();
    await plotStyleSelect.click();
    await page.locator('.vela-select-item').filter({ hasText: /^histogram$/ }).click();
    const kindAfter = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.get(id).series[0].kind, id);
    assert(kindAfter === 'histogram', 'plot-style selector changes rendered series type without rerunning the indicator', kindAfter);
    await plotStyleSelect.click();
    await page.locator('.vela-select-item').filter({ hasText: /^line$/ }).click();
    const plotVisibleSwitch = page.locator('.vela-ind-dialog [role="tabpanel"]:not([style*="display: none"]) [role="switch"][id*="plot:"][id$=":visible"]').first();
    await plotVisibleSwitch.click();
    await page.waitForTimeout(100);
    const hiddenPlot = await page.evaluate((id) => {
        const renderer = window.__ws.cell('a').chart.renderer.renderer;
        const model = renderer.scene.indicators.get(id);
        return model.series.find((series) => series.visible === false && series.display?.pane === false)?.title;
    }, id);
    assert(Boolean(hiddenPlot), 'Style tab plot visibility switch hides its plot in the renderer', hiddenPlot);

    await page.locator('.vela-ind-dialog [role="tab"]').filter({ hasText: 'Visibility' }).click();
    await page.locator(`.vela-ind-dialog [role="tabpanel"]:not([style*="display: none"]) [role="switch"][id$="interval:hours"]`).click();
    await page.waitForTimeout(100);
    const intervalHidden = await page.evaluate((id) => !window.__ws.cell('a').chart.renderer.renderer.scene.indicators.has(id), id);
    assert(intervalHidden, 'disabling the active Hours family removes the indicator from the chart', intervalHidden);
    await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.setTimeframe('1D'), id);
    const dayVisible = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.has(id), id);
    assert(dayVisible, 'an excluded Hours interval does not hide the indicator on enabled Days intervals', dayVisible);
    await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.setTimeframe('60'), id);
    const hoursRemainHidden = await page.evaluate((id) => !window.__ws.cell('a').chart.renderer.renderer.scene.indicators.has(id), id);
    assert(hoursRemainHidden, 'switching back to the excluded Hours interval hides it again', hoursRemainHidden);
    await page.locator(`.vela-ind-dialog [role="tabpanel"]:not([style*="display: none"]) [role="switch"][id$="interval:hours"]`).click();
    await page.waitForTimeout(100);
    const intervalRestored = await page.evaluate((id) => window.__ws.cell('a').chart.renderer.renderer.scene.indicators.has(id), id);
    assert(intervalRestored, 're-enabling Hours restores the indicator without rerunning its inputs', intervalRestored);

    await page.locator('.vela-ind-dialog button').filter({ hasText: /^Cancel$/ }).click();
    const reverted = await page.evaluate((id) => {
        const renderer = window.__ws.cell('a').chart.renderer.renderer;
        const model = renderer.scene.indicators.get(id);
        return { visible: model?.series.every((series) => series.visible !== false), color: model?.series[0]?.style?.color, width: model?.series[0]?.style?.width, display: model?.series[0]?.display, interval: renderer.indicatorIntervalSettings.get(id)?.['interval:hours'] };
    }, id);
    assert(reverted.visible === true && reverted.color === colorBefore && reverted.width === widthBefore && reverted.display?.priceScale === true && reverted.display?.legend === true && (reverted.interval === undefined || reverted.interval === true), 'Cancel restores generated Style and Visibility settings to the open-time snapshot', reverted);
    assert(errors.length === 0, 'no browser errors', errors);
    report('indicator-style-visibility', { tabs, colorBefore, colorAfter, hiddenPlot, intervalHidden, intervalRestored, reverted });
} finally { await browser.close(); }
