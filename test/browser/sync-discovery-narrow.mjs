// Portrait phone interaction at a 240px viewport: real controls, no page overflow,
// full-size actions, and separate Indicators/Indicator templates panes.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';
const engine = process.env.SYNC_BROWSER ?? 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 240, height: 600 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage(), errors = [], facts = {};
page.on('pageerror', e => { if (!String(e).includes('ResizeObserver loop completed')) errors.push(String(e)); });
const dims = pane => pane.evaluate(el => {
    const body = el.querySelector('.vela-panel-body'), root = el.closest('.vela-workspace');
    return { panel: el.getBoundingClientRect().toJSON(), host: el.parentElement.getBoundingClientRect().toJSON(),
        body: [body.clientWidth, body.scrollWidth], page: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
        layout: root.dataset.layout };
});
const clean = (info, name) => assert(info.layout === 'mobile' && Math.abs(info.panel.bottom - info.host.bottom) < 3 &&
    info.page[1] <= info.page[0] + 1 && info.body[1] <= info.body[0] + 1,
    `${name} remains attached and does not overflow at 240px`, info);
try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.active.chart.lastBar, null, { timeout: 60_000 });
    await page.locator('.vela-mb-indicators').tap();
    const indicators = page.locator('.vela-indicator-panel'); await indicators.waitFor({ state: 'visible' });
    clean(await dims(indicators), 'Indicators');
    await indicators.locator('.vela-ip-search').fill('Exponential Moving Average');
    await indicators.locator('.vela-ip-row[data-library] .vela-ip-pick').first().tap();
    assert(await indicators.isVisible(), 'Adding an indicator keeps the narrow pane open');
    const searchFont = await indicators.locator('.vela-ip-search').evaluate(el => getComputedStyle(el).fontSize);
    assert(parseFloat(searchFont) >= 16, 'phone indicator search avoids automatic input zoom', searchFont);
    await indicators.locator('.vela-ip-templates-door').tap();
    const templates = page.locator('.vela-templates-panel'); await templates.waitFor({ state: 'visible' });
    assert(!(await indicators.isVisible()) && await templates.getAttribute('aria-label') === 'Indicator templates',
        'the indicator shortcut opens the distinct templates pane');
    clean(await dims(templates), 'Indicator templates');
    await templates.locator('.vela-tm-save').tap();
    await templates.locator('.vela-tm-input').fill('Narrow');
    await templates.locator('.vela-tm-primary').tap();
    const saved = templates.locator('.vela-tm-item[data-name="Narrow"]'); await saved.waitFor();
    const icons = await saved.locator('.vela-tm-ico').evaluateAll(els => els.map(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })));
    assert(icons.length >= 3 && icons.every(icon => icon.w >= 39 && icon.h >= 39), 'template row actions have phone-sized targets', icons);
    clean(await dims(templates), 'Indicator templates with a saved row');
    await saved.locator('.vela-tm-kebab').tap();
    assert(await templates.locator('.vela-tm-chip').count() >= 3, 'template row actions remain usable at 240px');
    clean(await dims(templates), 'Indicator templates with open actions');
    await templates.locator('.vela-panel-close').tap();

    await page.locator('.vela-mb-symbol').tap();
    const symbol = page.locator('.vela-symbol-panel'); await symbol.waitFor({ state: 'visible' });
    clean(await dims(symbol), 'Symbol Search');
    await symbol.locator('.vela-sp-input').fill('BBB');
    const target = symbol.locator('.vela-sp-row[data-i="0"] .vela-sp-star');
    const targetBox = await target.boundingBox();
    assert(targetBox.width >= 39 && targetBox.height >= 39 && parseFloat(await symbol.locator('.vela-sp-input').evaluate(el => getComputedStyle(el).fontSize)) >= 16,
        'symbol favorite is touch-sized and search avoids auto-zoom', targetBox);
    await target.tap();
    assert(await symbol.isVisible(), 'watchlist favorite does not select a pair');
    await symbol.locator('.vela-panel-close').tap();

    await page.locator('.vela-mb-more').tap();
    await page.getByRole('button', { name: 'Compare', exact: true }).last().tap();
    const compare = page.locator('.vela-compare-panel'); await compare.waitFor({ state: 'visible' });
    clean(await dims(compare), 'Compare');
    facts.phone = { width: 240, templateActionTargets: icons, searchFont, symbolStar: [targetBox.width, targetBox.height] };
    assert(errors.length === 0, 'no page errors', errors);
} catch (error) { errors.push(String(error)); console.error(error); process.exitCode = 1; }
finally { report(`discovery-narrow-${engine}`, { ...facts, errors }); await context.close(); await browser.close(); }
