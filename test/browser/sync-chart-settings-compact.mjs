// Desktop Settings keeps movement without a height grip. On portrait phones the
// secondary actions move out of the fixed footer without losing their real behavior.
// Exercises the real offline workspace; no screenshots or generated HTML fixtures.
import { chromium, webkit } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const browser = process.env.SYNC_BROWSER === 'webkit' ? await webkit.launch()
    : await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], resizeWarnings = [], facts = { compact: [] };
let phase = 'boot';

async function boot(viewport, touch = false) {
    const context = await browser.newContext({ viewport, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
        const detail = `${phase}: ${String(error)}`;
        // The existing workspace emits this non-fatal WebKit notification when the
        // entire host changes mode, before any Settings dialog has been opened.
        if (phase === 'embedded-resize' && String(error).includes('ResizeObserver loop completed with undelivered notifications')) resizeWarnings.push(detail);
        else errors.push(detail);
    });
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length === 4, null, { timeout: 60000 });
    return { context, page };
}

async function waitForSettledSettings(page, mobile) {
    await page.waitForFunction((isMobile) => {
        const card = document.querySelector('.vela-dialog--settings');
        const host = document.querySelector('.vela-workspace');
        if (!card || !host || Boolean(card.closest('.vela-sd-mobile')) !== isMobile) return false;
        if (card.getAnimations().some((animation) => animation.playState === 'running')) return false;
        return !isMobile || Math.abs(card.getBoundingClientRect().width - host.getBoundingClientRect().width) < 2;
    }, mobile, { timeout: 10000 });
}

async function openSettings(page, mobile) {
    if (mobile) await page.locator('.vela-mb-settings').tap();
    else await page.evaluate(() => window.__ws.active.chart.renderer.openSettings());
    await page.locator('.vela-dialog--settings').waitFor({ state: 'visible' });
    await waitForSettledSettings(page, mobile);
}

async function measure(page) {
    return page.evaluate(() => {
        const panel = document.querySelector('.vela-dialog--settings');
        const workspace = document.querySelector('.vela-workspace');
        const header = panel.querySelector('.vela-dialog-header');
        const pane = panel.querySelector('.vela-sd-pane');
        const template = panel.querySelector('.vela-sd-tplbtn');
        const close = panel.querySelector('.vela-dialog-close');
        const burger = panel.querySelector('.vela-sd-burger');
        const box = (node) => node?.getBoundingClientRect().toJSON() ?? null;
        const grip = panel.querySelector('.vela-sd-pane-grip');
        return { mode: workspace.dataset.layout, panel: box(panel), host: box(workspace), header: box(header), pane: box(pane),
            template: box(template), close: box(close), burger: box(burger), title: panel.querySelector('.vela-dialog-title')?.textContent,
            footer: !!panel.querySelector('.vela-dialog-footer'), resizeGrips: panel.querySelectorAll('.vela-size-grip').length,
            min: grip?.getAttribute('aria-valuemin'), now: grip?.getAttribute('aria-valuenow'),
            headerOverflow: header.scrollWidth - header.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
}

async function menuMetrics(page) {
    return page.locator('.vela-sd-tpl').evaluate((card) => ({
        rect: card.getBoundingClientRect().toJSON(), radius: getComputedStyle(card).borderRadius,
        background: getComputedStyle(card).backgroundColor, role: card.getAttribute('role'),
        name: card.getAttribute('aria-label'), heading: !!card.querySelector('.vela-sd-tpl-head'),
        scrollHeight: card.scrollHeight, clientHeight: card.clientHeight,
        apply: card.querySelector('.vela-sd-applyall')?.getBoundingClientRect().toJSON() ?? null,
    }));
}

try {
    {
        phase = 'desktop';
        const { context, page } = await boot({ width: 1440, height: 900 });
        await openSettings(page, false);
        const original = await measure(page);
        assert(original.mode === 'desktop' && original.resizeGrips === 0 && original.footer,
            'desktop chart settings has no height grip, with its existing footer intact', original);
        assert(await page.locator('.vela-dialog--settings .vela-sd-tplbtn').count() === 1 &&
            await page.locator('.vela-dialog--settings .vela-sd-applyall').count() === 1,
        'desktop Templates and Apply to all stay directly available');
        const header = page.locator('.vela-dialog--settings .vela-dialog-header');
        const closeBox = await page.locator('.vela-dialog--settings .vela-dialog-close').boundingBox();
        await page.mouse.click(closeBox.x - 12, closeBox.y + closeBox.height / 2);
        assert(await page.locator('.vela-panel-height-control').count() === 0 && await page.locator('.vela-dialog--settings').isVisible(),
            'clicking beside desktop Close cannot open the removed height control');
        const h = await header.boundingBox();
        await page.mouse.move(h.x + h.width * .45, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(h.x + h.width * .45 + 82, h.y + h.height / 2 + 55, { steps: 8 });
        await page.mouse.up();
        const moved = await measure(page);
        assert(moved.panel.x > original.panel.x + 60 && moved.panel.y > original.panel.y + 40 &&
            Math.abs(moved.panel.height - original.panel.height) < 2,
        'desktop header drag moves the card but does not resize it', { original, moved });
        await header.focus();
        await page.keyboard.press('ArrowDown');
        const keyed = await measure(page);
        assert(keyed.panel.y > moved.panel.y + 10 && Math.abs(keyed.panel.height - moved.panel.height) < 2 &&
            await page.locator('.vela-panel-height-control').count() === 0,
        'keyboard header movement remains and no height control opens', { moved, keyed });
        facts.desktop = { original, moved, keyed };
        await context.close();
    }

    {
        phase = 'phone';
        const { context, page } = await boot({ width: 390, height: 780 }, true);
        const factory = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair.color);
        await page.evaluate(() => {
            window.__ws.setActiveCell('a');
            window.__ws.cell('a').chart.renderer.applyConfig({ crosshair: { color: '#cc3355', opacity: .67 } });
            for (const id of ['b', 'c', 'd']) window.__ws.cell(id).chart.renderer.applyConfig({ crosshair: { color: '#3388cc', opacity: .2 } });
        });
        await openSettings(page, true);
        const initial = await measure(page);
        assert(initial.min === '200' && Math.abs(Number(initial.now) - initial.panel.height) < 2,
            'the phone resize grip announces the settled height and actual minimum', initial);
        const grip = page.locator('.vela-sd-pane-grip');
        await grip.focus();
        await page.keyboard.press('Home');
        await page.waitForTimeout(120);
        const small = await measure(page);
        assert(small.mode === 'mobile' && !small.footer && small.resizeGrips === 1 &&
            Math.abs(small.panel.height - 200) < 2 && small.pane.height >= 110 && small.min === '200' && small.now === '200',
        'the minimum phone pane keeps its resize grip, accurate limits and substantially more scrollable content', small);
        assert(small.template.width >= 44 && small.template.height >= 44 && small.close.width >= 40 && small.burger.width >= 40 &&
            small.headerOverflow <= 1 && small.pageOverflow <= 0,
        'phone header keeps reachable, non-overlapping controls without horizontal overflow', small);

        const template = page.locator('.vela-sd-tplbtn');
        await template.focus();
        await page.keyboard.press('Enter');
        await page.locator('.vela-sd-tpl').waitFor({ state: 'visible' });
        const keyboardOpen = await page.evaluate(() => ({
            inside: document.querySelector('.vela-sd-tpl')?.contains(document.activeElement),
            expanded: document.querySelector('.vela-sd-tplbtn')?.getAttribute('aria-expanded'),
            controlled: document.querySelector('.vela-sd-tplbtn')?.getAttribute('aria-controls') === document.querySelector('.vela-sd-tpl')?.id,
        }));
        assert(keyboardOpen.inside && keyboardOpen.expanded === 'true' && keyboardOpen.controlled,
            'keyboard opening transfers focus into the labelled action surface', keyboardOpen);
        await page.keyboard.press('Escape');
        const keyboardClose = await page.evaluate(() => ({
            open: !!document.querySelector('.vela-sd-tpl'),
            focused: document.activeElement === document.querySelector('.vela-sd-tplbtn'),
            expanded: document.querySelector('.vela-sd-tplbtn')?.getAttribute('aria-expanded'),
        }));
        assert(!keyboardClose.open && keyboardClose.focused && keyboardClose.expanded === 'false' &&
            await page.locator('.vela-dialog--settings').isVisible(), 'Escape returns focus to Templates without closing settings', keyboardClose);

        await template.tap();
        const menu = await menuMetrics(page);
        assert(menu.radius === '0px' && menu.role === 'dialog' && menu.name && !menu.heading &&
            menu.background !== 'rgba(0, 0, 0, 0)' && menu.apply?.height >= 44,
        'the mobile action surface is compact, square, labelled and touch-usable', menu);
        await page.locator('.vela-sd-tpl .vela-sd-applyall').tap();
        const applied = await page.evaluate(() => ['a', 'b', 'c', 'd'].map((id) => ({
            id, color: window.__ws.cell(id).chart.renderer.getConfig().crosshair.color,
            opacity: window.__ws.cell(id).chart.renderer.getConfig().crosshair.opacity,
        })));
        assert(applied.every((item) => item.color === '#cc3355' && Math.abs(item.opacity - .67) < .001) &&
            await page.locator('.vela-dialog--settings').isVisible() && await page.locator('.vela-sd-tpl').count() === 0,
        'Apply to all copies the actual current settings to every chart and leaves settings open', applied);

        phase = 'phone-save';
        await template.tap();
        await page.locator('.vela-sd-tpl-act[data-save]').tap();
        const input = page.locator('.vela-sd-tpl-input');
        await input.fill('A very long phone appearance template name');
        await page.locator('.vela-sd-tpl-ok').tap();
        const saved = await page.evaluate(() => ({ name: window.__ws.appearanceTemplateName('a'),
            text: document.querySelector('.vela-sd-tplbtn .vela-sd-tplname')?.textContent,
            aria: document.querySelector('.vela-sd-tplbtn')?.getAttribute('aria-label') }));
        assert(saved.name === 'A very long phone appearance template na' && saved.text === saved.name && saved.aria.includes(saved.name),
            'saving a template preserves its full accessible active name', saved);
        await page.locator('.vela-sd-tpl-act[data-house]').tap();
        const house = await page.evaluate(() => window.__ws.defaultAppearanceTemplate());
        assert(house === saved.name, 'the phone template menu can set the new-chart default', house);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__ws.cell('a').chart.renderer.applyConfig({ crosshair: { color: '#2255aa' } }));
        await template.tap();
        await page.locator('.vela-sd-tpl-row').first().tap();
        const restored = await page.evaluate(() => window.__ws.cell('a').chart.renderer.getConfig().crosshair.color);
        assert(restored === '#cc3355' && await page.locator('.vela-dialog--settings').isVisible(),
            'a saved phone template reapplies the chart settings without dismissing its parent', restored);

        phase = 'phone-visual-viewport';
        await template.tap();
        await page.locator('.vela-sd-tpl-act[data-save]').tap();
        await page.locator('.vela-sd-tpl-input').focus();
        await page.evaluate(() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 150 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(180);
        const shortViewport = await page.evaluate(() => {
            const card = document.querySelector('.vela-sd-tpl'), input = card.querySelector('.vela-sd-tpl-input');
            return { card: card.getBoundingClientRect().toJSON(), input: input.getBoundingClientRect().toJSON(),
                focused: document.activeElement === input, scroll: card.scrollTop };
        });
        assert(shortViewport.card.top >= 0 && shortViewport.card.bottom <= 151 && shortViewport.focused &&
            shortViewport.input.top >= shortViewport.card.top && shortViewport.input.bottom <= shortViewport.card.bottom + 1,
        'a reduced visual viewport keeps the focused template input visible inside the scrollable popup', shortViewport);
        await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForTimeout(100);
        await page.keyboard.press('Escape');

        phase = 'phone-rotation';
        await page.setViewportSize({ width: 780, height: 390 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'desktop');
        await waitForSettledSettings(page, false);
        const landscape = await measure(page);
        assert(landscape.mode === 'desktop' && landscape.resizeGrips === 0 && landscape.footer,
            'landscape switches to the draggable desktop card without a resize button', landscape);
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await waitForSettledSettings(page, true);
        const portrait = await measure(page);
        assert(!portrait.footer && portrait.resizeGrips === 1 && Math.abs(portrait.panel.height - 200) < 3,
            'rotation restores the compact resizable phone pane and its chosen height', portrait);
        phase = 'phone-delete-template';
        await page.locator('.vela-sd-tplbtn').tap();
        await page.locator('.vela-sd-tpl-del').tap();
        assert(await page.locator('.vela-sd-tpl-del[data-armed="1"]').count() === 1 &&
            await page.evaluate(() => window.__ws.appearanceTemplateList().length) === 1,
        'deleting a phone template requires a confirmation tap');
        await page.locator('.vela-sd-tpl-del').tap();
        const deleted = await page.evaluate(() => ({ count: window.__ws.appearanceTemplateList().length,
            house: window.__ws.defaultAppearanceTemplate() }));
        assert(deleted.count === 0 && deleted.house === null && await page.locator('.vela-dialog--settings').isVisible(),
            'confirmed phone template deletion also clears the default without closing settings', deleted);
        if (await page.locator('.vela-sd-tpl').count()) await page.keyboard.press('Escape');
        phase = 'phone-single-chart';
        await page.locator('.vela-dialog-close').tap();
        await page.waitForTimeout(200);
        await page.evaluate(() => {
            window.__ws.setLayout('1');
            window.__ws.active.chart.renderer.applyConfig({ crosshair: { color: '#aa3322' } });
        });
        await page.waitForFunction(() => window.__ws.cells().length === 1);
        await openSettings(page, true);
        await page.locator('.vela-sd-tplbtn').tap();
        assert(await page.locator('.vela-sd-tpl .vela-sd-applyall').count() === 0 &&
            await page.locator('.vela-sd-tpl-act[data-save]').count() === 1 &&
            await page.locator('.vela-sd-tpl-act[data-defaults]').count() === 1,
        'a single chart omits Apply to all while preserving template and default actions');
        await page.locator('.vela-sd-tpl-act[data-defaults]').tap();
        const afterDefaults = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair.color);
        assert(afterDefaults === factory && await page.locator('.vela-dialog--settings').isVisible(),
            'the phone template menu restores the actual default settings on a single chart', { factory, afterDefaults });
        if (await page.locator('.vela-sd-tpl').count()) await page.keyboard.press('Escape');
        await page.locator('.vela-dialog-close').tap();
        await page.waitForTimeout(200);
        phase = 'phone-reset';
        await page.evaluate(() => {
            const renderer = window.__ws.active.chart.renderer;
            renderer.setSettingsTemplates(null);
            renderer.applyConfig({ crosshair: { color: '#ab2233' } });
        });
        await openSettings(page, true);
        const reset = page.locator('.vela-dialog-header .vela-sd-reset');
        assert(await reset.count() === 1 && await reset.getAttribute('aria-label') === 'Reset defaults' &&
            await page.locator('.vela-dialog-footer').count() === 0,
        'a chart without a template host retains an accessible reset action in the header');
        await reset.tap();
        const afterReset = await page.evaluate(() => window.__ws.active.chart.renderer.getConfig().crosshair.color);
        assert(afterReset === factory && await page.locator('.vela-dialog--settings').isVisible(),
            'the no-template reset actually restores the factory chart setting', { factory, afterReset });
        facts.phone = { small, keyboardOpen, keyboardClose, menu, applied, saved, house, restored, shortViewport, landscape, portrait, deleted, factory, afterDefaults, afterReset };
        await context.close();
    }

    for (const size of [{ width: 320, height: 568 }, { width: 240, height: 320 }]) {
        phase = `phone-${size.width}`;
        const { context, page } = await boot(size, true);
        await page.evaluate(() => {
            window.__ws.setActiveCell('a');
            window.__ws.saveAppearanceTemplate('Extremely long saved mobile appearance', 'a');
        });
        await openSettings(page, true);
        const grip = page.locator('.vela-sd-pane-grip');
        await grip.focus(); await page.keyboard.press('Home');
        const panel = await measure(page);
        assert(!panel.footer && panel.pane.height >= 110 && panel.template.width >= 44 && panel.template.height >= 44 &&
            panel.headerOverflow <= 1 && panel.pageOverflow <= 0 && panel.template.right <= panel.close.left + 1,
        'a long template name cannot crowd or hide narrow-phone header controls', { size, panel });
        await page.locator('.vela-sd-tplbtn').tap();
        const menu = await menuMetrics(page);
        assert(menu.rect.left >= 0 && menu.rect.top >= 0 && menu.rect.right <= size.width + 1 && menu.rect.bottom <= size.height + 1 &&
            menu.radius === '0px' && menu.apply?.height >= 44,
        'the action surface and Apply to all remain usable on a narrow phone', { size, menu });
        facts.compact.push({ size, panel, menu });
        await context.close();
    }

    {
        phase = 'embedded';
        const { context, page } = await boot({ width: 1000, height: 800 }, true);
        phase = 'embedded-resize';
        await page.evaluate(() => Object.assign(document.querySelector('#workspace').style,
            { inset: 'auto', left: '100px', top: '110px', width: '240px', height: '350px' }));
        await page.waitForFunction(() => document.querySelector('.vela-workspace')?.dataset.layout === 'mobile');
        await page.waitForTimeout(180); // let the workspace's host-resize observers settle
        phase = 'embedded-settings';
        await openSettings(page, true);
        const panel = await measure(page);
        phase = 'embedded-menu';
        await page.locator('.vela-sd-tplbtn').tap();
        const menu = await menuMetrics(page);
        assert(menu.rect.left >= panel.host.left - 1 && menu.rect.right <= panel.host.right + 1 &&
            menu.rect.top >= panel.host.top - 1 && menu.rect.bottom <= panel.host.bottom + 1,
        'a small embedded workspace contains the phone actions popover', { panel, menu });
        facts.embedded = { panel, menu };
        await context.close();
    }
    assert(errors.length === 0, 'no unexpected browser errors', errors);
    report('chart-settings-compact', { ...facts, errors, resizeWarnings });
} finally {
    await browser.close();
}
