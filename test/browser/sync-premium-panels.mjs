// R87 — Premium UI. One dedicated panel per job, and a shared premium surface language
// (elevation ramp, kicker/icon-tile headers, restrained accent, focus rings, six
// microstates). This probe measures real Chromium: the jsdom unit tests can prove the
// DOM, not that the premium layer resolves its theme-derived CSS custom properties on
// the floating hosts — that is the whole point of this check.
import { open, assert, report } from './helpers.mjs';

const facts = {};

// ── 1. The premium design-token layer is installed on the document + UI hosts ────
{
    const { browser, page, errors } = await open({ viewport: { width: 1280, height: 820 } });
    // Open the templates dropdown first so a floating .vela-ui-layer host is mounted;
    // the derived tokens resolve against the theme vars set inline on that host.
    await page.evaluate(() => window.__ws.openIndicatorTemplates());
    await page.waitForSelector('.vela-tm-head', { timeout: 5000 });
    const tokens = await page.evaluate(() => {
        const html = document.documentElement;
        const layer = document.querySelector('.vela-ui-layer .vela-tm')?.closest('.vela-ui-layer')
            ?? document.querySelector('.vela-ui-layer')
            ?? document.querySelector('.vela-workspace');
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

    // Premium header: kicker + icon tile on the Indicator templates dropdown.
    const tm = await page.evaluate(() => {
        const head = document.querySelector('.vela-tm-headid');
        const mark = document.querySelector('.vela-tm-mark');
        const cs = getComputedStyle(document.querySelector('.vela-tm'));
        return {
            kicker: head?.getAttribute('data-kicker') ?? null,
            kickerText: head ? getComputedStyle(head, '::before').content : null,
            markBg: mark ? getComputedStyle(mark).backgroundColor : null,
            panelRadius: cs.borderRadius,
            panelShadow: cs.boxShadow.slice(0, 30),
        };
    });
    facts.templatesHead = tm;
    assert(tm.kicker === 'Library', 'the templates panel carries a Library kicker', tm.kicker);
    assert(tm.markBg && tm.markBg !== 'rgba(0, 0, 0, 0)', 'the icon tile has a tinted accent wash', tm.markBg);
    assert(parseFloat(tm.panelRadius) >= 12, 'panels use the larger premium radius', tm.panelRadius);

    // Premium dialog header on the Indicators picker: kicker + icon tile via the kit.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__ws.indicatorPicker?.open?.(''));
    await page.waitForSelector('.vela-dialog-header', { timeout: 5000 });
    const picker = await page.evaluate(() => ({
        kicker: document.querySelector('.vela-dialog-kicker')?.textContent ?? null,
        iconTile: !!document.querySelector('.vela-dialog-header .vela-prem-tile .vela-icon'),
        title: document.querySelector('.vela-dialog-title')?.textContent ?? null,
    }));
    facts.pickerHead = picker;
    assert(picker.kicker === 'Studies' && picker.iconTile && picker.title === 'Indicators', 'the Indicators dialog has a premium header', picker);
    assert(errors.length === 0, 'no desktop page errors', errors.slice(0, 3));
    await browser.close();
}

// ── 2. Phone: the Layout sheet has NO tab bar; each job is its own door ─────────
{
    const { browser, page, errors } = await open({ viewport: { width: 390, height: 780 }, mobile: true, settle: 1300 });
    await page.locator('.vela-mb-more').click();
    await page.waitForSelector('.vela-md-row', { timeout: 5000 });
    const doors = await page.evaluate(() => [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((r) => r.textContent ?? ''));
    facts.doors = doors;
    assert(doors.includes('Layout setup'), 'Layout setup is its own door', doors);
    assert(doors.includes('Chart syncing'), 'Chart syncing is its own door', doors);
    assert(doors.includes('Manage layouts'), 'Manage layouts is its own door', doors);
    assert(doors.includes('Indicator templates'), 'Indicator templates is its own door', doors);

    // Open the Layout setup door: ONE titled pane, no tab bar anywhere.
    await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Layout setup'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(350);
    const setup = await page.evaluate(() => ({
        navbtns: document.querySelectorAll('.vela-md-navbtn').length,
        pane: document.querySelector('.vela-md-panehead')?.getAttribute('data-pane') ?? null,
        title: document.querySelector('.vela-md-panetitle')?.textContent ?? null,
        kicker: document.querySelector('.vela-md-panekicker')?.textContent ?? null,
        mark: !!document.querySelector('.vela-md-panemark .vela-icon'),
        visible: [...document.querySelectorAll('.vela-md-sec')].filter((s) => !s.hidden).length,
    }));
    facts.layoutSetup = setup;
    assert(setup.navbtns === 0, 'the tab bar is gone', setup);
    assert(setup.pane === 'layouts' && setup.title === 'Layout setup' && setup.kicker === 'Workspace', 'Layout setup opens a titled pane', setup);
    assert(setup.mark && setup.visible === 1, 'one icon-tile header, one visible pane', setup);

    // Back → Chart syncing door opens the Sync pane with its own title.
    await page.evaluate(() => document.querySelector('.vela-md-paneback')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(200);
    await page.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => r.textContent?.trim().startsWith('Chart syncing'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(350);
    const sync = await page.evaluate(() => ({
        pane: document.querySelector('.vela-md-panehead')?.getAttribute('data-pane') ?? null,
        title: document.querySelector('.vela-md-panetitle')?.textContent ?? null,
        switches: document.querySelectorAll('.vela-md-sync[role="switch"]').length,
    }));
    facts.chartSyncing = sync;
    assert(sync.pane === 'sync' && sync.title === 'Chart syncing' && sync.switches >= 5, 'Chart syncing opens its own pane with the link switches', sync);
    assert(errors.length === 0, 'no phone page errors', errors.slice(0, 3));
    await browser.close();
}

report('sync-premium-panels', facts);
