// Minimal monochrome UI: one dedicated panel per job, neutral icons and a shared
// theme-aware surface language. This probe measures real Chromium: jsdom can prove the
// DOM, not that the premium layer resolves its theme-derived CSS custom properties on
// the floating hosts — that is the whole point of this check.
import { open, assert, report } from './helpers.mjs';

const facts = {};

// ── 1. The premium design-token layer is installed on the document + UI hosts ────
{
    const { browser, page, errors } = await open({ viewport: { width: 1280, height: 820 } });
    // The workspace-owned template pane inherits the premium theme tokens.
    await page.evaluate(() => window.__ws.openIndicatorTemplates());
    await page.waitForSelector('.vela-templates-panel:visible', { timeout: 5000 });
    const tokens = await page.evaluate(() => {
        const html = document.documentElement;
        const layer = document.querySelector('.vela-templates-panel') ?? document.querySelector('.vela-workspace');
        const g = (el, n) => (el ? getComputedStyle(el).getPropertyValue(n).trim() : '');
        return {
            host: layer?.className?.slice(0, 40) ?? 'none',
            rootMarked: html.classList.contains('vela-premium'),
            sheet: !!document.querySelector('style[id="vela-premium-surfaces"]'),
            line: g(layer, '--vp-line'),
            e2: g(layer, '--vp-e2'),
            accentWash: g(layer, '--vp-accent-wash'),
            radius: g(layer, '--vp-r-lg'),
        };
    });
    facts.tokens = tokens;
    assert(tokens.rootMarked && tokens.sheet, 'premium layer is installed once, on the document root', tokens);
    assert(tokens.line.includes('#') || tokens.line.startsWith('color-mix'), 'theme-derived line token resolves on the UI host', tokens);
    assert(tokens.e2.includes('#') || tokens.e2.startsWith('color-mix'), 'theme-derived elevation token resolves', tokens);
    assert(tokens.accentWash.length > 0 && tokens.radius === '14px', 'accent + radius tokens resolve', tokens);

    // A standard pane has one minimal header and an opaque, square surface.
    const tm = await page.evaluate(() => {
        const pane = document.querySelector('.vela-templates-panel'), cs = getComputedStyle(pane);
        return { title: pane.querySelector('.vela-panel-title')?.textContent, standard: pane.dataset.standardPane,
            kicker: pane.querySelector('.vela-dialog-kicker')?.textContent ?? null,
            radius: cs.borderRadius, background: cs.backgroundColor,
            dock: !!pane.querySelector('.vela-panel-dock-toggle'), close: !!pane.querySelector('.vela-panel-close') };
    });
    facts.templatesHead = tm;
    assert(tm.title === 'Indicator templates' && tm.standard === '1' && tm.kicker === null &&
        tm.radius === '0px' && tm.background !== 'rgba(0, 0, 0, 0)' && tm.dock && tm.close,
        'Indicator templates has the standard minimal square pane chrome', tm);

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__ws.indicatorPicker?.open?.());
    await page.waitForSelector('.vela-indicator-panel:visible', { timeout: 5000 });
    const picker = await page.evaluate(() => {
        const pane = document.querySelector('.vela-indicator-panel');
        return { title: pane.querySelector('.vela-panel-title')?.textContent,
            kicker: pane.querySelector('.vela-dialog-kicker')?.textContent ?? null,
            standard: pane.dataset.standardPane, radius: getComputedStyle(pane).borderRadius };
    });
    facts.pickerHead = picker;
    assert(picker.kicker === null && picker.standard === '1' && picker.radius === '0px' && picker.title === 'Indicators',
        'Indicators has the same minimal pane header', picker);
    assert(errors.length === 0, 'no desktop page errors', errors.slice(0, 3));
    await browser.close();
}

// ── 2. Phone: one Layout Setup door with two real tabs ────────────────────────
{
    const { browser, page, errors } = await open({ viewport: { width: 390, height: 780 }, mobile: true, settle: 1300 });
    await page.locator('.vela-mb-more').click();
    await page.waitForSelector('.vela-md-row', { timeout: 5000 });
    const doors = await page.evaluate(() => [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((r) => r.textContent ?? ''));
    facts.doors = doors;
    assert(doors.filter(x => x === 'Layout setup').length === 1 && !doors.includes('Chart syncing'), 'one Layout setup door replaces the separate sync row', doors);
    assert(doors.includes('Manage layouts') && doors.includes('Indicator templates'), 'the other compact management doors remain', doors);
    await page.locator('.vela-md-row', { hasText: 'Layout setup' }).click();
    const panel = page.locator('.vela-layout-setup'); await panel.waitFor({ state: 'visible' });
    const setup = await panel.evaluate(el => ({
        title: el.querySelector('.vela-panel-title')?.textContent,
        tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent),
        selected: el.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
        visible: [...el.querySelectorAll('[role="tabpanel"]')].filter(p => !p.hidden).length,
        standard: el.dataset.standardPane,
    }));
    facts.layoutSetup = setup;
    assert(setup.title === 'Layout setup' && setup.standard === '1' && setup.tabs.join('|') === 'Layout|Chart syncing'
        && setup.selected === 'Layout' && setup.visible === 1, 'Layout opens a minimal standard pane with one visible tab panel', setup);
    await panel.getByRole('tab', { name: 'Chart syncing' }).click();
    const sync = await panel.evaluate(el => ({
        selected: el.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
        switches: el.querySelectorAll('.vela-ls-syncrows [role="switch"]').length,
        visible: [...el.querySelectorAll('[role="tabpanel"]')].filter(p => !p.hidden).length,
    }));
    facts.chartSyncing = sync;
    assert(sync.selected === 'Chart syncing' && sync.switches === 7 && sync.visible === 1, 'Chart syncing is the second tab with all links', sync);
    assert(errors.length === 0, 'no phone page errors', errors.slice(0, 3));
    await browser.close();
}

report('sync-premium-panels', facts);
