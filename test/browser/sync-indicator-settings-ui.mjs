// Settings dialog edits (including visible Style colors) propagate in both directions.
import { open, assert, report, OFFLINE } from './helpers.mjs';
const { browser, page, errors } = await open({ base: OFFLINE, settle: 900 });
try {
    const id = await page.evaluate(() => {
        const ws = window.__ws, h = ws.cell('a').chart.addNativeIndicator('rsi');
        ws.setIndicatorLiveSync([h.id], 'charts', ['b']);
        return h.id;
    });
    await page.waitForTimeout(700);
    await page.locator('button[aria-label="Object tree"]').click();
    await page.waitForTimeout(250);
    await page.locator(`.vela-ot-row[data-id="${id}"]`).click({ button: 'right' });
    await page.locator('.vela-menu-item:visible').filter({ hasText: /^Indicator settings$/ }).click();
    await page.waitForTimeout(300);
    assert(await page.locator('.vela-ind-dialog:visible').count() === 1 && await page.locator('.vela-ot-row:visible').count() > 0, 'settings opens without closing Object tree');
    const length = page.locator('.vela-ind-dialog input[id$="-length"]');
    await length.fill('17'); await length.press('Tab');
    await page.locator('.vela-ind-dialog button[id$="-overboughtColor"]').click();
    await page.locator('.vela-color-field-pop button[data-c="#33adeb"]').click();
    await page.waitForTimeout(800);
    const live = await page.evaluate(() => ['a', 'b', 'c'].map((id) => {
        const c = window.__ws.cell(id).chart, h = c.indicators().find((x) => x.nativeType === 'rsi');
        return h ? { values: h.inputValues(), color: c.renderer.dataWindowReadout()?.groups.find((g) => g.id === h.id)?.rows[0]?.color } : null;
    }));
    assert(live[0].values.length === 17 && live[1].values.length === 17 && live[0].values.overboughtColor === '#33adeb' && live[1].values.overboughtColor === '#33adeb' && live[0].color === '#33adeb' && live[1].color === '#33adeb' && live[2] === null, 'dialog input and actual rendered style sync only to the selected chart', live);
    await page.locator('.vela-ind-dialog button').filter({ hasText: /^Cancel$/ }).click();
    await page.waitForTimeout(350);
    const reverted = await page.evaluate(() => ['a', 'b'].map((id) => window.__ws.cell(id).chart.indicators().find((x) => x.nativeType === 'rsi').inputValues()));
    assert(reverted.every((x) => x.length === 14 && x.overboughtColor === '#f23645'), 'Cancel reverts both linked copies', reverted);
    await page.evaluate(() => {
        const ws = window.__ws; ws.setActiveCell('b');
        const h = ws.cell('b').chart.indicators().find((x) => x.nativeType === 'rsi');
        ws.cell('b').chart.renderer.openIndicatorSettings(h.id);
    });
    await page.waitForTimeout(250);
    await page.locator('.vela-ind-dialog input[id$="-length"]').fill('31');
    await page.locator('.vela-ind-dialog input[id$="-length"]').press('Tab');
    await page.locator('.vela-ind-dialog button').filter({ hasText: /^Ok$/ }).click();
    await page.waitForTimeout(350);
    const reverse = await page.evaluate(() => ['a', 'b'].map((id) => window.__ws.cell(id).chart.indicators().find((x) => x.nativeType === 'rsi').inputValues().length));
    assert(reverse.every((value) => value === 31), 'editing the follower through its settings dialog updates the source', reverse);
    assert(errors.length === 0, 'no browser errors', errors);
    report('indicator-settings-ui', { live, reverted, reverse });
} finally { await browser.close(); }
